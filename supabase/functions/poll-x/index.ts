// Cage Tracker: die eigentliche Alarm-Funktion.
//
// Läuft NICHT im Browser, sondern als Supabase Edge Function -- angestoßen von einem
// Cron-Job in Supabase selbst (siehe SETUP.md). Geht bei jedem Aufruf die gemeinsame
// Watchlist durch, prüft pro Profil über eine Dritt-API auf neue X-Posts, trägt Funde
// in die Datenbank ein und schickt eine Browser-Push-Benachrichtigung an jeden, der
// sich auf der Seite dafür angemeldet hat -- kein Discord-Umweg, alles läuft über die
// Seite selbst.
//
// Datenquelle für X-Posts: twitterapi.io (unofficial, pay-as-you-go -- siehe README.md
// für die Kosten-Abwägung). Der Aufruf steckt bewusst nur in fetchLatestPosts(), damit
// sich der Anbieter später austauschen lässt, ohne den Rest der Funktion anzufassen.
// Doku zum Zeitpunkt der Umsetzung: https://docs.twitterapi.io/api-reference/endpoint/get_user_last_tweets
//
// Push-Versand: jsr:@negrel/webpush -- reiner Web-Push/VAPID-Standard, keine
// Fremd-Cloud wie Firebase nötig. Doku: https://github.com/negrel/webpush

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as webpush from "jsr:@negrel/webpush";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const X_API_KEY = Deno.env.get("X_API_KEY")!;
const VAPID_KEYS_JSON = Deno.env.get("VAPID_KEYS_JSON")!;
const VAPID_CONTACT_EMAIL = Deno.env.get("VAPID_CONTACT_EMAIL")!;

const TEXT_PREVIEW_MAX_LENGTH = 200;

// Einmal beim Kaltstart der Function laden -- wird über alle Aufrufe wiederverwendet.
const vapidKeys = await webpush.importVapidKeys(JSON.parse(VAPID_KEYS_JSON), { extractable: false });
const appServer = await webpush.ApplicationServer.new({
  contactInformation: "mailto:" + VAPID_CONTACT_EMAIL,
  vapidKeys,
});

interface RawTweet {
  id: string;
  url?: string;
  text?: string;
  createdAt?: string;
}

interface WatchlistRow {
  id: string;
  handle: string;
  last_seen_post_id: string | null;
}

interface PushSubRow {
  id: string;
  endpoint: string;
  p256dh: string;
  auth_key: string;
}

// Fragt die neuesten Posts eines Profils ab. Isolierter Baustein -- hier setzt ein
// Anbieter-Wechsel an, sonst nichts in dieser Datei.
async function fetchLatestPosts(handle: string): Promise<RawTweet[]> {
  const res = await fetch(
    `https://api.twitterapi.io/twitter/user/last_tweets?userName=${encodeURIComponent(handle)}`,
    { headers: { "X-API-Key": X_API_KEY } },
  );
  if (!res.ok) {
    throw new Error(`X-API-Fehler für @${handle}: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  // twitterapi.io liefert die Tweets aktuell unter data.tweets -- je nach Anbieter/Version
  // kann sich das ändern, deshalb hier robust auf mehrere plausible Formen prüfen.
  const tweets: RawTweet[] = data?.tweets ?? data?.data?.tweets ?? data?.data ?? [];
  return Array.isArray(tweets) ? tweets : [];
}

function postUrl(handle: string, tweet: RawTweet): string {
  return tweet.url || `https://x.com/${handle}/status/${tweet.id}`;
}

function truncate(text: string | undefined): string | null {
  if (!text) return null;
  return text.length > TEXT_PREVIEW_MAX_LENGTH
    ? text.slice(0, TEXT_PREVIEW_MAX_LENGTH) + "…"
    : text;
}

// Schickt eine Push-Benachrichtigung an jedes gespeicherte Abo. Abos, die der Push-Dienst
// als nicht mehr existent meldet (410 Gone -- Browser-Daten gelöscht, Gerät abgemeldet),
// werden gleich aus der Datenbank entfernt, damit künftige Läufe nicht wieder daran scheitern.
async function notifySubscribers(
  supabase: ReturnType<typeof createClient>,
  handle: string,
  tweet: RawTweet,
  subscribers: PushSubRow[],
): Promise<void> {
  const payload = JSON.stringify({
    title: `@${handle} hat gepostet`,
    body: truncate(tweet.text) ?? "",
    url: postUrl(handle, tweet),
  });

  for (const sub of subscribers) {
    try {
      const subscriber = appServer.subscribe({
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dh, auth: sub.auth_key },
      });
      await subscriber.pushTextMessage(payload, {});
    } catch (err) {
      if (err instanceof webpush.PushMessageError && err.isGone()) {
        await supabase.from("push_subscriptions").delete().eq("id", sub.id);
      } else {
        console.error(`Push fehlgeschlagen für Subscription ${sub.id}:`, err);
      }
    }
  }
}

Deno.serve(async () => {
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const [watchlistRes, subsRes] = await Promise.all([
    supabase.from("watchlist").select("id, handle, last_seen_post_id"),
    supabase.from("push_subscriptions").select("id, endpoint, p256dh, auth_key"),
  ]);

  if (watchlistRes.error) {
    console.error("Watchlist konnte nicht geladen werden:", watchlistRes.error);
    return new Response(JSON.stringify({ error: watchlistRes.error.message }), { status: 500 });
  }
  if (subsRes.error) {
    console.error("Push-Abos konnten nicht geladen werden:", subsRes.error);
  }

  const rows = (watchlistRes.data ?? []) as WatchlistRow[];
  const subscribers = (subsRes.data ?? []) as PushSubRow[];
  let totalNewPosts = 0;

  for (const row of rows) {
    try {
      const tweets = await fetchLatestPosts(row.handle);
      if (tweets.length === 0) continue;

      // Nach Post-ID absteigend sortieren (twitterapi.io liefert i.d.R. schon so,
      // hier zur Sicherheit nochmal explizit).
      tweets.sort((a, b) => (BigInt(b.id) > BigInt(a.id) ? 1 : -1));
      const newestId = tweets[0].id;

      if (row.last_seen_post_id === null) {
        // Erster Lauf für dieses Profil: nur die Basis merken, keine Alt-Posts nachmelden.
        await supabase.from("watchlist").update({ last_seen_post_id: newestId }).eq("id", row.id);
        continue;
      }

      const lastSeen = BigInt(row.last_seen_post_id);
      const freshTweets = tweets.filter((t) => BigInt(t.id) > lastSeen).reverse(); // älteste zuerst posten

      for (const tweet of freshTweets) {
        const { error: insertError } = await supabase.from("posts").insert({
          watchlist_id: row.id,
          handle: row.handle,
          post_id: tweet.id,
          post_url: postUrl(row.handle, tweet),
          text_preview: truncate(tweet.text),
          posted_at: tweet.createdAt ? new Date(tweet.createdAt).toISOString() : null,
        });
        if (insertError) {
          // unique(handle, post_id) -- ein Duplikat ist kein echter Fehler, nur überspringen.
          if (insertError.code !== "23505") console.error(`Insert-Fehler für @${row.handle}:`, insertError);
          continue;
        }
        await notifySubscribers(supabase, row.handle, tweet, subscribers);
        totalNewPosts++;
      }

      await supabase.from("watchlist").update({ last_seen_post_id: newestId }).eq("id", row.id);
    } catch (err) {
      // Ein Profil mit Problemen darf den Lauf für alle anderen nicht abbrechen.
      console.error(`Fehler bei @${row.handle}:`, err);
    }
  }

  return new Response(
    JSON.stringify({ checked: rows.length, newPosts: totalNewPosts, subscribers: subscribers.length }),
    { headers: { "Content-Type": "application/json" } },
  );
});
