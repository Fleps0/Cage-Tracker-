// Cage Tracker: Webhook-Weiterleitung über Cloudflare Workers.
//
// Warum das nötig ist: twitterapi.io lehnt *.supabase.co als Webhook-Ziel ab
// ("webhook_url is not valid" -- vom twitterapi.io-Support bestätigt, 2026-08-31).
// Dieser Worker bekommt eine andere, akzeptierte Domain (*.workers.dev) und leitet
// jeden eingehenden Aufruf 1:1 (inkl. Methode, Query-String, Body) an die echte
// Supabase Edge Function tweet-webhook weiter -- reine Durchleitung, keine eigene
// Logik, kein eigener Geheimnis-Speicher nötig (der Token steckt im Query-String,
// der unverändert durchgereicht wird).
//
// Wird NICHT über GitHub Pages gehostet und braucht KEIN GitHub-Repo -- läuft direkt
// über "wrangler deploy" von deinem PC aus. Siehe SETUP.md für die Einrichtung.

export default {
  async fetch(request, env) {
    const incoming = new URL(request.url);
    const target = env.TARGET_URL + incoming.search;
    const proxied = new Request(target, request);
    return fetch(proxied);
  },
};
