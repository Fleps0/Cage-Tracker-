// Kopiere diese Datei zu "config.js" und trag deine eigenen Werte ein.
// Alle drei Werte sind für den Browser gedacht und kein Geheimnis — der Zugriff auf
// echte Daten wird über Row-Level-Security-Regeln in Supabase abgesichert
// (siehe supabase-schema.sql). Der "service_role"-Key, der X-API-Key und der private
// VAPID-Schlüssel gehören NIRGENDS in diese Datei oder sonst in den Code — die tragen
// nur als Supabase-Secrets für die Edge Function ein (siehe SETUP.md).
//
// SUPABASE_URL / SUPABASE_ANON_KEY: Supabase-Dashboard -> Project Settings -> API.
// VAPID_PUBLIC_KEY: Ausgabe von "node scripts/generate-vapid-keys.js" (siehe SETUP.md).

const SUPABASE_URL = "https://vvporagapfxytnvqtqex.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ2cG9yYWdhcGZ4eXRudnF0cWV4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgxMjE5NDksImV4cCI6MjEwMzY5Nzk0OX0.adT_BhiZpfXOOpFxXW3c6WdGppZ9FDYozUcrLE8NAhw";
const VAPID_PUBLIC_KEY = "BPOBR9WZFNXbA-bJDlAA7qpiJ_sJS4hcIxJcoNweoL3GMJelNFtmgvJZvv-5S-6HtwGqni-tsRSFvEdPCLVzzog";





