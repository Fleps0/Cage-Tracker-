// Cage Tracker: Watchlist-Verwaltung mit Echtzeit-Anmeldung bei twitterapi.io.
//
// Wird von der Seite selbst per supabase.functions.invoke("watchlist", ...) aufgerufen
// (nicht vom Cron-Job) -- deshalb inkl. CORS-Handling. Macht zwei Dinge in einem Aufruf:
// die eigentliche Watchlist-Änderung in der Datenbank UND -- falls nötig -- das An-/Abmelden
// des Profils bei twitterapi.io's Echtzeit-Produkt ("x_user_stream", siehe
// https://twitterapi.io/twitter-stream). Beides gehört zusammen: ein Profil, das niemand
// mehr auf seiner Watchlist hat, muss auch bei twitterapi.io abgemeldet werden, sonst
// zahlen wir für Beobachtung, die niemand mehr will.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const X_API_KEY = Deno.env.get("X_API_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Meldet ein Profil bei twitterapi.io für Echtzeit-Beobachtung an und liefert die
// stream_monitor_id (id_for_user), die für eine spätere Abmeldung gebraucht wird.
async function registerStream(handle: string): Promise<string | null> {
  const addRes = await fetch("https://api.twitterapi.io/oapi/x_user_stream/add_user_to_monitor_tweet", {
    method: "POST",
    headers: { "X-API-Key": X_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ x_user_name: handle }),
  });
  if (!addRes.ok) {
    console.error(`twitterapi.io add_user_to_monitor_tweet fehlgeschlagen für @${handle}:`, await addRes.text());
    return null;
  }

  // Die Anmelde-Antwort liefert keine ID zurück -- einmal die Liste abrufen und den
  // passenden Eintrag per Screen-Name suchen.
  const listRes = await fetch("https://api.twitterapi.io/oapi/x_user_stream/get_user_to_monitor_tweet", {
    headers: { "X-API-Key": X_API_KEY },
  });
  if (!listRes.ok) {
    console.error("twitterapi.io get_user_to_monitor_tweet fehlgeschlagen:", await listRes.text());
    return null;
  }
  const listData = await listRes.json();
  const entries: Array<{ id_for_user: string; x_user_screen_name: string }> = listData?.data ?? [];
  const match = entries.find((e) => e.x_user_screen_name?.toLowerCase() === handle.toLowerCase());
  return match?.id_for_user ?? null;
}

// Holt die Profilbild-URL von X. Wird nur einmal pro Handle gebraucht (danach in
// tracked_handles zwischengespeichert), deshalb kein Aufwand, das isoliert zu halten.
async function fetchAvatarUrl(handle: string): Promise<string | null> {
  const res = await fetch(`https://api.twitterapi.io/twitter/user/info?userName=${encodeURIComponent(handle)}`, {
    headers: { "X-API-Key": X_API_KEY },
  });
  if (!res.ok) {
    console.error(`twitterapi.io user/info fehlgeschlagen für @${handle}:`, await res.text());
    return null;
  }
  const data = await res.json();
  return data?.data?.profilePicture ?? null;
}

async function unregisterStream(streamMonitorId: string): Promise<void> {
  const res = await fetch("https://api.twitterapi.io/oapi/x_user_stream/remove_user_to_monitor_tweet", {
    method: "POST",
    headers: { "X-API-Key": X_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ id_for_user: streamMonitorId }),
  });
  if (!res.ok) {
    console.error(`twitterapi.io remove_user_to_monitor_tweet fehlgeschlagen für ${streamMonitorId}:`, await res.text());
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Nicht eingeloggt." }, 401);

  // Nutzer-Client: respektiert Row Level Security als der aufrufende Nutzer.
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData?.user) return json({ error: "Nicht eingeloggt." }, 401);

  // Service-Client: für alles, was über die Rechte eines einzelnen Nutzers hinausgeht
  // (globale tracked_handles-Tabelle prüfen/ändern).
  const serviceClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  let body: { action?: string; handle?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Ungültige Anfrage." }, 400);
  }

  const handle = (body.handle || "").trim().toLowerCase();
  if (!handle) return json({ error: "Handle fehlt." }, 400);

  if (body.action === "add") {
    const { data: wasNew, error } = await userClient.rpc("add_to_watchlist", { p_handle: handle });
    if (error) {
      const message = error.code === "23505" ? `@${handle} ist schon auf deiner Watchlist.` : "Konnte nicht gespeichert werden.";
      return json({ error: message }, 400);
    }

    if (wasNew) {
      const streamMonitorId = await registerStream(handle);
      if (streamMonitorId) {
        await serviceClient.from("tracked_handles").update({ stream_monitor_id: streamMonitorId }).eq("handle", handle);
      }
      // Kein Abbruch, falls die Anmeldung bei twitterapi.io scheitert -- das Profil bleibt
      // dann vom seltenen poll-x-Sicherheitsnetz mit abgedeckt, nur eben nicht in Echtzeit.
      // Wird beim nächsten Hinzufügen desselben Handles (durch einen anderen Nutzer) erneut
      // versucht, weil wasNew dann zwar false ist, stream_monitor_id aber weiterhin fehlt --
      // das ist ein bekanntes, kleines Restrisiko, kein stiller Datenverlust.
    }

    // Profilbild besorgen -- nur einmal pro Handle von twitterapi.io abfragen, danach
    // aus tracked_handles wiederverwenden (spart Abfragen, wenn mehrere Nutzer dasselbe
    // Profil eintragen).
    const { data: trackedRow } = await serviceClient
      .from("tracked_handles")
      .select("avatar_url")
      .eq("handle", handle)
      .maybeSingle();
    let avatarUrl = trackedRow?.avatar_url ?? null;
    if (!avatarUrl) {
      avatarUrl = await fetchAvatarUrl(handle);
      if (avatarUrl) {
        await serviceClient.from("tracked_handles").update({ avatar_url: avatarUrl }).eq("handle", handle);
      }
    }
    if (avatarUrl) {
      await serviceClient
        .from("watchlist")
        .update({ avatar_url: avatarUrl })
        .eq("user_id", userData.user.id)
        .eq("handle", handle);
    }

    return json({ ok: true });
  }

  if (body.action === "remove") {
    // WICHTIG: erst prüfen/nachschlagen, DANN löschen -- der bestehende Trigger
    // cleanup_tracked_handle löscht tracked_handles synchron mit, sobald die letzte
    // watchlist-Zeile weg ist. Würden wir das erst danach prüfen, wäre stream_monitor_id
    // schon unwiderruflich weg, bevor wir twitterapi.io abmelden könnten.
    const { data: existingRows } = await serviceClient.from("watchlist").select("id").eq("handle", handle);
    const isLastOne = (existingRows?.length ?? 0) <= 1;

    let streamMonitorId: string | null = null;
    if (isLastOne) {
      const { data: trackedRow } = await serviceClient
        .from("tracked_handles")
        .select("stream_monitor_id")
        .eq("handle", handle)
        .maybeSingle();
      streamMonitorId = trackedRow?.stream_monitor_id ?? null;
    }

    const { error: deleteError } = await userClient.from("watchlist").delete().eq("handle", handle);
    if (deleteError) return json({ error: "Konnte nicht entfernt werden." }, 400);

    if (isLastOne && streamMonitorId) {
      await unregisterStream(streamMonitorId);
    }
    // tracked_handles (und die zugehörigen posts, per on delete cascade) hat der
    // bestehende DB-Trigger cleanup_tracked_handle automatisch aufgeräumt, sobald die
    // watchlist-Zeile oben gelöscht wurde -- hier nichts weiter zu tun.

    return json({ ok: true });
  }

  return json({ error: "Unbekannte Aktion." }, 400);
});
