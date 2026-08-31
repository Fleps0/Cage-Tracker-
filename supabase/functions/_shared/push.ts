// Cage Tracker: gemeinsamer Push-Versand-Code, genutzt von poll-x (Sicherheitsnetz) und
// tweet-webhook (Echtzeit-Weg) -- an einer Stelle gepflegt statt zweimal dupliziert.
// Reiner Web-Push/VAPID-Standard über jsr:@negrel/webpush, keine Fremd-Cloud wie Firebase.
// Doku: https://github.com/negrel/webpush

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as webpush from "jsr:@negrel/webpush";

const VAPID_KEYS_JSON = Deno.env.get("VAPID_KEYS_JSON")!;
const VAPID_CONTACT_EMAIL = Deno.env.get("VAPID_CONTACT_EMAIL")!;

const TEXT_PREVIEW_MAX_LENGTH = 200;

// Einmal beim Kaltstart der jeweiligen Function geladen -- wird über alle Aufrufe
// dieser Function-Instanz wiederverwendet.
const vapidKeys = await webpush.importVapidKeys(JSON.parse(VAPID_KEYS_JSON), { extractable: false });
const appServer = await webpush.ApplicationServer.new({
  contactInformation: "mailto:" + VAPID_CONTACT_EMAIL,
  vapidKeys,
});

export interface TweetLike {
  id: string;
  url?: string;
  text?: string;
  createdAt?: string;
}

export interface PushSubRow {
  id: string;
  endpoint: string;
  p256dh: string;
  auth_key: string;
}

export function postUrl(handle: string, tweet: TweetLike): string {
  return tweet.url || `https://x.com/${handle}/status/${tweet.id}`;
}

export function truncate(text: string | undefined): string | null {
  if (!text) return null;
  return text.length > TEXT_PREVIEW_MAX_LENGTH
    ? text.slice(0, TEXT_PREVIEW_MAX_LENGTH) + "…"
    : text;
}

// Schickt eine Push-Benachrichtigung an jedes gespeicherte Abo. Abos, die der Push-Dienst
// als nicht mehr existent meldet (410 Gone -- Browser-Daten gelöscht, Gerät abgemeldet),
// werden gleich aus der Datenbank entfernt, damit künftige Läufe nicht wieder daran scheitern.
export async function notifySubscribers(
  supabase: ReturnType<typeof createClient>,
  handle: string,
  tweet: TweetLike,
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
