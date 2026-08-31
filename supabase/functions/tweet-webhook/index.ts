// Cage Tracker: der Echtzeit-Weg.
//
// Öffentlich erreichbare URL, die twitterapi.io aufruft, sobald ein beobachtetes Profil
// (angemeldet über die watchlist-Function, Produkt "x_user_stream", siehe
// https://twitterapi.io/twitter-stream) etwas Neues postet -- typischerweise innerhalb
// weniger Sekunden nach dem echten Post. Ersetzt für die Geschwindigkeit den bisherigen
// 5-Minuten-Poll-Takt; poll-x/index.ts bleibt als selteneres Sicherheitsnetz bestehen.
//
// WICHTIG (siehe Plan plans/2026-08-31-cage-tracker-realtime-und-sound.md, "Offene
// Fragen"): Das genaue Feld-Format, das twitterapi.io hier tatsächlich POSTet, stand
// nicht in der öffentlichen API-Referenz. Diese Function loggt den kompletten Payload
// (siehe console.log unten) und probiert mehrere plausible Feld-Pfade -- beim ersten
// echten Test in den Supabase-Dashboard-Logs (Edge Functions -> tweet-webhook -> Logs)
// nachsehen und extractTweets() bei Bedarf an das tatsächliche Format anpassen.
//
// Absicherung: twitterapi.io signiert Webhook-Aufrufe laut öffentlicher Doku nicht
// nachweisbar -- deshalb ein geheimer Token als Query-Parameter (siehe SETUP.md), den nur
// wir und die bei twitterapi.io hinterlegte Webhook-URL kennen.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { notifySubscribers, postUrl, truncate, type PushSubRow, type TweetLike } from "../_shared/push.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WEBHOOK_TOKEN = Deno.env.get("WEBHOOK_TOKEN")!;

interface TrackedHandleRow {
  id: string;
  handle: string;
  last_seen_post_id: string | null;
  avatar_url: string | null;
}

interface IncomingTweet {
  handle: string;
  tweet: TweetLike;
}

// Sucht in mehreren plausiblen Payload-Formen nach den eigentlichen Tweet-Daten.
// Ein Aufruf kann laut Produktbeschreibung mehrere Tweets auf einmal enthalten.
function extractTweets(body: any): IncomingTweet[] {
  const rawList: any[] = body?.tweets ?? body?.data?.tweets ?? (Array.isArray(body?.data) ? body.data : null) ??
    (body?.tweet ? [body.tweet] : null) ?? (Array.isArray(body) ? body : null) ?? [body];

  const result: IncomingTweet[] = [];
  for (const item of rawList) {
    if (!item || !item.id) continue;
    const handle =
      item.author?.userName ?? item.author?.screen_name ?? item.user?.screen_name ??
      item.authorScreenName ?? item.screen_name ?? item.x_user_screen_name ?? body?.x_user_screen_name ?? null;
    if (!handle) continue;
    result.push({
      handle: String(handle).toLowerCase(),
      tweet: { id: String(item.id), url: item.url, text: item.text, createdAt: item.createdAt },
    });
  }
  return result;
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  if (url.searchParams.get("token") !== WEBHOOK_TOKEN) {
    return new Response("unauthorized", { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new Response("bad request", { status: 400 });
  }

  // Solange das genaue Format nicht endgültig bestätigt ist: kompletten Payload loggen.
  console.log("tweet-webhook Payload:", JSON.stringify(body));

  const incoming = extractTweets(body);
  if (incoming.length === 0) {
    return new Response(JSON.stringify({ ok: true, processed: 0 }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data: subsData, error: subsError } = await supabase
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth_key");
  if (subsError) console.error("Push-Abos konnten nicht geladen werden:", subsError);
  const subscribers = (subsData ?? []) as PushSubRow[];

  let processed = 0;

  for (const { handle, tweet } of incoming) {
    try {
      const { data: trackedRow, error: trackedError } = await supabase
        .from("tracked_handles")
        .select("id, handle, last_seen_post_id, avatar_url")
        .eq("handle", handle)
        .maybeSingle();

      if (trackedError || !trackedRow) {
        // Handle wird (mehr) nicht getrackt -- z.B. gerade erst entfernt, Abmeldung bei
        // twitterapi.io noch nicht durch. Kein Fehler, einfach überspringen.
        continue;
      }
      const row = trackedRow as TrackedHandleRow;

      if (row.last_seen_post_id !== null && BigInt(tweet.id) <= BigInt(row.last_seen_post_id)) {
        continue; // schon bekannt (z.B. vom Sicherheitsnetz poll-x schon eingetragen)
      }

      const { error: insertError } = await supabase.from("posts").insert({
        tracked_handle_id: row.id,
        handle: row.handle,
        post_id: tweet.id,
        post_url: postUrl(row.handle, tweet),
        text_preview: truncate(tweet.text),
        avatar_url: row.avatar_url,
        posted_at: tweet.createdAt ? new Date(tweet.createdAt).toISOString() : null,
      });

      if (insertError) {
        if (insertError.code !== "23505") console.error(`Insert-Fehler für @${row.handle}:`, insertError);
        continue; // Duplikat oder Fehler -- kein Alarm, kein last_seen_post_id-Update nötig
      }

      await notifySubscribers(supabase, row.handle, tweet, subscribers);
      await supabase.from("tracked_handles").update({ last_seen_post_id: tweet.id }).eq("id", row.id);
      processed++;
    } catch (err) {
      // Ein Tweet mit Problemen darf die anderen im selben Aufruf nicht abbrechen.
      console.error(`Fehler bei @${handle}:`, err);
    }
  }

  // Immer 200 zurückgeben, auch wenn einzelne Tweets übersprungen wurden -- sonst könnte
  // twitterapi.io denselben Aufruf wiederholt zustellen.
  return new Response(JSON.stringify({ ok: true, processed }), {
    headers: { "Content-Type": "application/json" },
  });
});
