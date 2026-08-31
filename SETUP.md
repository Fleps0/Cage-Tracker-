# Cage Tracker einrichten

Diese Anleitung führt einmalig durch die komplette Einrichtung: Login, Speicherung und den automatischen Push-Alarm. Danach läuft alles dauerhaft, ohne dass du etwas am Laufen halten musst. Rechne mit ca. 45–60 Minuten für den ersten Durchlauf (etwas mehr als beim Quiz, wegen der Edge Function und dem Cron-Job).

Kurz zum Prinzip: **Supabase** speichert Accounts, Watchlist, Feed und Push-Abos (kostenlos) und stößt im Hintergrund den Alarm-Check an. **Discord** ist nur noch der Login-Anbieter — der Alarm selbst kommt als echte **Browser-Push-Benachrichtigung direkt von der Seite**, kein Discord-Bot nötig. **GitHub Pages** hostet die eigentliche Seite (kostenlos). Eine **Dritt-API** liefert die X-Post-Daten (bezahlt, aber günstig — siehe README.md für die Kostenrechnung). Nichts davon muss auf deinem PC laufen.

---

## 1. Discord-App anlegen

Falls für `cage-quiz` schon eine Discord-App existiert, kannst du dieselbe App und denselben OAuth-Redirect für Cage Tracker mitnutzen — dann reicht in Schritt 4 ein zusätzlicher Redirect-Eintrag für die neue Supabase-Callback-URL. Sonst neu anlegen:

1. Öffne https://discord.com/developers/applications und logg dich mit deinem Discord-Account ein.
2. "New Application" → Name z. B. "Cage Tracker" → erstellen.
3. Links auf "OAuth2" klicken.
4. **Client ID** und **Client Secret** notieren (Secret erst per Klick sichtbar machen).

---

## 2. Supabase-Projekt anlegen

1. Öffne https://supabase.com und leg einen kostenlosen Account an (oder nutze deinen bestehenden vom Quiz — für Cage Tracker trotzdem ein **eigenes, neues Projekt** anlegen, damit Watchlist/Feed nicht mit dem Quiz-Fortschritt vermischt werden).
2. "New Project" → Namen vergeben (z. B. "cage-tracker"), ein Datenbank-Passwort setzen, Region wählen (z. B. Frankfurt).
3. Warten, bis das Projekt fertig eingerichtet ist.
4. Notier dir die **Projekt-Referenz** (der Teil vor `.supabase.co` in deiner Projekt-URL, z. B. `abcdefghijkl`) — brauchst du in Schritt 8 und 9.

---

## 3. Discord-Login in Supabase aktivieren

1. Im Supabase-Dashboard: **Authentication → Providers → Discord** → aktivieren.
2. **Client ID** und **Client Secret** aus Schritt 1 eintragen, speichern.
3. Supabase zeigt jetzt eine **Callback URL** an (`https://xxxxx.supabase.co/auth/v1/callback`) — kopieren.

---

## 4. Redirect bei Discord eintragen

1. Zurück im Discord Developer Portal → deine App → **OAuth2 → Redirects**.
2. "Add Redirect" → die kopierte Supabase-Callback-URL einfügen → speichern.

---

## 5. Datenbank-Schema anlegen

1. Im Supabase-Dashboard: **SQL Editor** → "New query".
2. Öffne `supabase-schema.sql` aus diesem Ordner, kopiere den gesamten Inhalt, füg ihn ein.
3. "Run" klicken. Es sollte "Success" erscheinen — damit existieren die Tabellen `watchlist`, `posts` und `push_subscriptions` inklusive Zugriffsregeln und Realtime.

---

## 6. Dritt-API für X-Daten einrichten

Die offizielle X-API ist für diesen Zweck zu teuer (siehe README.md). Empfohlen und in diesem Projekt bereits eingebaut: **[twitterapi.io](https://twitterapi.io)** — pay-as-you-go, keine Grundgebühr, keine Kreditkarte für den Start nötig.

1. Auf https://twitterapi.io registrieren.
2. Im Dashboard einen **API-Key** erzeugen und kopieren.
3. Etwas Guthaben aufladen (ein paar Dollar reichen für den Start und viele Tests).

**Wichtig:** Prüf zum Zeitpunkt deiner Einrichtung kurz die aktuelle Preisliste — diese Anbieter ändern ihre Konditionen gelegentlich. Falls du lieber einen anderen Anbieter nutzen willst: die Anbindung steckt komplett isoliert in `supabase/functions/poll-x/index.ts` in der Funktion `fetchLatestPosts()` — dort den Aufruf gegen die neue API austauschen, der Rest der Funktion bleibt gleich.

---

## 7. VAPID-Schlüssel erzeugen (für den Push-Alarm)

Browser-Push braucht ein einmaliges Schlüsselpaar (VAPID) — der öffentliche Teil landet in `config.js`, der private nur als Supabase-Secret.

1. Braucht [Node.js](https://nodejs.org) — hast du für Schritt 8 sowieso gleich nötig, kannst diesen Schritt also auch direkt danach machen.
2. In diesem Ordner (`cage-tracker/`) ausführen:
   ```bash
   node scripts/generate-vapid-keys.js > vapid.json
   ```
3. Die Konsole zeigt jetzt eine Zeile wie `Dein VAPID_PUBLIC_KEY (für config.js): BN...` — **kopieren**, brauchst du in Schritt 10.
4. Die Datei `vapid.json` (enthält beide Schlüssel) bleibt liegen — brauchst du gleich in Schritt 8. Sie steht in `.gitignore`, landet also nicht versehentlich im GitHub-Repo.

---

## 8. Supabase CLI installieren und Edge Function deployen

1. Supabase CLI installieren:
   ```bash
   npm install -g supabase
   ```
2. Einloggen (öffnet den Browser zur Bestätigung):
   ```bash
   supabase login
   ```
3. In diesem Ordner (`cage-tracker/`) das Projekt verknüpfen (Projekt-Referenz aus Schritt 2):
   ```bash
   supabase link --project-ref DEINE-PROJEKT-REFERENZ
   ```
4. Die Edge Function deployen:
   ```bash
   supabase functions deploy poll-x --project-ref DEINE-PROJEKT-REFERENZ
   ```
5. Secrets setzen — **über das Supabase-Dashboard, nicht über die Kommandozeile** (die drei Werte sind zu lang/zu speziell fürs normale cmd-Fenster, im Dashboard ist es ein simples Formular):
   1. Im Supabase-Dashboard: **Edge Functions → Secrets** (oder **Project Settings → Edge Functions**, je nach Dashboard-Version).
   2. Drei Secrets anlegen (Name/Wert):
      - `X_API_KEY` → dein Key aus Schritt 6.
      - `VAPID_CONTACT_EMAIL` → deine E-Mail-Adresse (Pflicht für den Web-Push-Standard, falls ein Push-Dienst euch mal kontaktieren müsste).
      - `VAPID_KEYS_JSON` → öffne `vapid.json` aus diesem Ordner (Rechtsklick → Öffnen mit → Editor), markier den **gesamten Inhalt** (Strg+A), kopier ihn (Strg+C) und füg ihn als Wert ein.
   3. Speichern. `SUPABASE_URL` und der Service-Role-Key stellt Supabase der Funktion automatisch bereit, die musst du nicht selbst setzen.

   *(Falls du lieber die Kommandozeile nutzt und dich mit Anführungszeichen/Escaping auskennst: `supabase secrets set X_API_KEY=... VAPID_CONTACT_EMAIL=... VAPID_KEYS_JSON="$(cat vapid.json)" --project-ref DEINE-PROJEKT-REFERENZ` — funktioniert in Bash/Git Bash/PowerShell (dort `$(Get-Content vapid.json -Raw)` statt `$(cat ...)`), aber **nicht** im normalen cmd.exe.)*

---

## 9. Cron einrichten (der eigentliche Hintergrund-Job)

1. Im Supabase-Dashboard: **Database → Extensions** → `pg_cron` und `pg_net` aktivieren (falls noch nicht an).
2. Im Supabase-Dashboard: **Project Settings → API** → den **`service_role`-Key** kopieren (geheim! nur hier verwenden, nirgends in Code oder `config.js`).
3. Im **SQL Editor** folgenden Block einfügen (Projekt-Referenz und Service-Role-Key ersetzen) und ausführen:
   ```sql
   select cron.schedule(
     'cage-tracker-poll-x',
     '*/5 * * * *',
     $$
     select net.http_post(
       url := 'https://DEINE-PROJEKT-REFERENZ.functions.supabase.co/poll-x',
       headers := jsonb_build_object(
         'Content-Type', 'application/json',
         'Authorization', 'Bearer DEIN-SERVICE-ROLE-KEY'
       ),
       body := jsonb_build_object()
     );
     $$
   );
   ```
   `*/5 * * * *` bedeutet "alle 5 Minuten" — die empfohlene Starteinstellung.

**Intervall später ändern:** Job löschen und neu anlegen (einfacher als "alter_job"):
```sql
select cron.unschedule('cage-tracker-poll-x');
-- danach den obigen cron.schedule-Block mit neuem Zeitplan erneut ausführen,
-- z. B. '*/10 * * * *' für alle 10 Minuten.
```

**Job-Status prüfen:** `select * from cron.job;` im SQL Editor zeigt alle laufenden Jobs.

---

## 10. Projekt-Werte in config.js eintragen

1. Im Supabase-Dashboard: **Project Settings → API**.
2. **Project URL** und den **"anon" / "public"**-Schlüssel kopieren (nicht den `service_role`-Key — der gehört nur in Schritt 9, nirgends in diese Datei).
3. In diesem Ordner (`cage-tracker/`) eine neue Datei `config.js` anlegen (Kopie von `config.example.js`) und eintragen:
   - `SUPABASE_URL` und `SUPABASE_ANON_KEY` aus diesem Schritt.
   - `VAPID_PUBLIC_KEY` aus Schritt 7 (die Zeile, die die Konsole ausgegeben hat).

---

## 11. Eigenes GitHub-Repo anlegen + GitHub Pages aktivieren

**Wichtig:** Niemals das private CEO-GPT-Repo verwenden.

1. Auf github.com ein neues Repository anlegen, z. B. `cage-tracker` (öffentlich).
2. Den Inhalt dieses Ordners hochladen — **inklusive** `config.js`, `index.html`, `sw.js` (wichtig, sonst funktioniert Push nicht!), **aber ohne** `vapid.json` und ohne echte Secrets (die stecken nur in Supabase).
3. **Settings → Pages** → Branch `main` (Ordner `/root`) auswählen → Speichern.
4. Nach ein bis zwei Minuten erreichbar unter `https://DEIN-GITHUB-NAME.github.io/cage-tracker/`.

---

## 12. Erlaubte Adresse bei Supabase eintragen

1. Im Supabase-Dashboard: **Authentication → URL Configuration**.
2. Die GitHub-Pages-Adresse aus Schritt 11 als **Site URL** eintragen und zusätzlich unter **Redirect URLs** hinzufügen.

---

## 13. Testen

1. Die GitHub-Pages-Adresse öffnen, mit Discord anmelden.
2. Oben rechts auf **🔕 Push aktivieren** tippen → Browser fragt nach der Benachrichtigungs-Erlaubnis → erlauben. Der Knopf wird zu **🔔 Push an**.
3. Im Tab "Watchlist" ein Profil hinzufügen, das erfahrungsgemäß oft postet.
4. Warten (maximal ein Poll-Intervall, standardmäßig 5 Minuten) und prüfen:
   - Kam eine Browser-Benachrichtigung an?
   - Erscheint der Post im Tab "Feed" mit funktionierendem "Zum Post"-Link?
5. Funktioniert es nicht: siehe "Bei Problemen" unten.

**iPhone-Test:** Safari → Teilen-Symbol → "Zum Home-Bildschirm" → die Seite von dort öffnen, erst dann erscheint der Push-Knopf funktionsfähig (siehe README.md).

---

## Bei Problemen

- **Push-Knopf bleibt grau/verschwindet:** Browser unterstützt evtl. kein Web Push, oder `VAPID_PUBLIC_KEY` in `config.js` fehlt noch/hat noch den Platzhalter-Wert.
- **Keine Benachrichtigung nach mehreren Minuten:** Im Supabase-Dashboard unter **Edge Functions → poll-x → Logs** nachsehen, ob die Funktion überhaupt läuft und ob Fehler auftauchen (häufigste Ursache: falscher/fehlender `X_API_KEY` oder `VAPID_KEYS_JSON` in den Secrets — Schritt 8 nochmal prüfen).
- **Cron scheint nicht zu laufen:** `select * from cron.job;` im SQL Editor prüfen, ob der Job existiert und aktiv ist. `select * from cron.job_run_details order by start_time desc limit 5;` zeigt die letzten Ausführungen und eventuelle Fehler.
- **Login schlägt fehl:** am wahrscheinlichsten Schritt 12 (Redirect URLs) noch offen, oder `config.js` hat noch Platzhalter-Werte.
- **"Dieses Profil ist schon auf der Watchlist":** Handle wurde schon eingetragen (Duplikate sind absichtlich blockiert) — im Tab "Watchlist" nachsehen, wer es hinzugefügt hat.

---

## Ehrlicher Hinweis

Supabase-Projekte auf der kostenlosen Stufe pausieren automatisch, wenn eine Woche lang niemand die Seite nutzt bzw. keine Datenbank-Aktivität stattfindet. Da der Cron-Job alle paar Minuten selbst aktiv wird, sollte das bei Cage Tracker praktisch nicht vorkommen — falls doch (z. B. weil der Cron-Job selbst pausiert wurde), erscheint im Supabase-Dashboard ein "Restore"-Knopf.
