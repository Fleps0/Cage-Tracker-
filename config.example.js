// Kopiere diese Datei zu "config.js" und trag deine eigenen Werte ein.
// Alle drei Werte sind für den Browser gedacht und kein Geheimnis — der Zugriff auf
// echte Daten wird über Row-Level-Security-Regeln in Supabase abgesichert
// (siehe supabase-schema.sql). Der "service_role"-Key, der X-API-Key und der private
// VAPID-Schlüssel gehören NIRGENDS in diese Datei oder sonst in den Code — die tragen
// nur als Supabase-Secrets für die Edge Function ein (siehe SETUP.md).
//
// SUPABASE_URL / SUPABASE_ANON_KEY: Supabase-Dashboard -> Project Settings -> API.
// VAPID_PUBLIC_KEY: Ausgabe von "node scripts/generate-vapid-keys.js" (siehe SETUP.md).

const SUPABASE_URL = "https://DEIN-PROJEKT.supabase.co";
const SUPABASE_ANON_KEY = "DEIN-ANON-PUBLIC-KEY";
const VAPID_PUBLIC_KEY = "DEIN-VAPID-PUBLIC-KEY";
