// Cage Tracker: das Sicherheitsnetz.
//
// Seit der Umstellung auf Echtzeit-Alarme (siehe tweet-webhook/index.ts) ist dies NICHT
// mehr der Hauptweg für Benachrichtigungen -- twitterapi.io liefert neue Posts jetzt per
// Webhook sofort. Dieser Cron-Job läuft nur noch selten (empfohlen: alle 30 Minuten statt
// vorher 5) als Auffangnetz, falls der Webhook mal ausfällt (twitterapi.io-Störung, falsch
// konfigurierte Webhook-URL, Supabase-Ausfall). Läuft NICHT im Browser, sondern als
// Supabase Edge Function -- angestoßen von einem Cron-Job in Supabase selbst (siehe
// SETUP.md). Geht bei jedem Aufruf die Liste der global gepollten Handles durch
// (tracked_handles -- ein Eintrag pro Profil, egal wie viele Nutzer es auf ihrer
// PERSÖNLICHEN Watchlist haben), prüft über eine Dritt-API auf neue X-Posts, trägt Funde
// in den gemeinsamen Feed ein und schickt eine Browser-Push-Benachrichtigung an jeden, der
// sich auf der Seite dafür angemeldet hat.
//
// Datenquelle für X-Posts: twitterapi.io (unofficial, pay-as-you-go -- siehe README.md
// für die Kosten-Abwägung). Der Aufruf steckt bewusst nur in fetchLatestPosts(), damit
// sich der Anbieter später austauschen lässt, ohne den Rest der Funktion anzufassen.
// Doku zum Zeitpunkt der Umsetzung: https://docs.twitterapi.io/api-reference/endpoint/get_user_last_tweets
//
// Push-Versand: ausgelagert nach ../_shared/push.ts (gemeinsam mit tweet-webhook genutzt).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { notifySubscribers, postUrl, truncate, type PushSubRow, type TweetLike } from "../_shared/push.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const X_API_KEY = Deno.env.get("X_API_KEY")!;

interface TrackedHandleRow {
  id: string;
  handle: string;
  last_seen_post_id: string | null;
}

// Fragt die neuesten Posts eines Profils ab. Isolierter Baustein -- hier setzt ein
// Anbieter-Wechsel an, sonst nichts in dieser Datei.
async function fetchLatestPosts(handle: string): Promise<TweetLike[]> {
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
  const tweets: TweetLike[] = data?.tweets ?? data?.data?.tweets ?? data?.data ?? [];
  return Array.isArray(tweets) ? tweets : [];
}

Deno.serve(async () => {
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const [handlesRes, subsRes] = await Promise.all([
    supabase.from("tracked_handles").select("id, handle, last_seen_post_id"),
    supabase.from("push_subscriptions").select("id, endpoint, p256dh, auth_key"),
  ]);

  if (handlesRes.error) {
    console.error("tracked_handles konnte nicht geladen werden:", handlesRes.error);
    return new Response(JSON.stringify({ error: handlesRes.error.message }), { status: 500 });
  }
  if (subsRes.error) {
    console.error("Push-Abos konnten nicht geladen werden:", subsRes.error);
  }

  const rows = (handlesRes.data ?? []) as TrackedHandleRow[];
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
        await supabase.from("tracked_handles").update({ last_seen_post_id: newestId }).eq("id", row.id);
        continue;
      }

      const lastSeen = BigInt(row.last_seen_post_id);
      // Älteste zuerst: derselbe Post kann inzwischen schon per Webhook eingetragen worden
      // sein -- das ist kein Fehler, nur ein übersprungenes Duplikat (unique(handle, post_id)).
      const freshTweets = tweets.filter((t) => BigInt(t.id) > lastSeen).reverse();

      for (const tweet of freshTweets) {
        const { error: insertError } = await supabase.from("posts").insert({
          tracked_handle_id: row.id,
          handle: row.handle,
          post_id: tweet.id,
          post_url: postUrl(row.handle, tweet),
          text_preview: truncate(tweet.text),
          posted_at: tweet.createdAt ? new Date(tweet.createdAt).toISOString() : null,
        });
        if (insertError) {
          // unique(handle, post_id) -- ein Duplikat ist kein echter Fehler (z.B. weil der
          // Echtzeit-Webhook denselben Post schon gemeldet hat), nur überspringen.
          if (insertError.code !== "23505") console.error(`Insert-Fehler für @${row.handle}:`, insertError);
          continue;
        }
        await notifySubscribers(supabase, row.handle, tweet, subscribers);
        totalNewPosts++;
      }

      await supabase.from("tracked_handles").update({ last_seen_post_id: newestId }).eq("id", row.id);
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
