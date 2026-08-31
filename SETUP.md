# Cage Tracker einrichten

Diese Anleitung führt einmalig durch die komplette Einrichtung: Login, Speicherung und den automatischen Echtzeit-Alarm. Danach läuft alles dauerhaft, ohne dass du etwas am Laufen halten musst. Rechne mit ca. **75–90 Minuten** für den ersten Durchlauf (mehr als beim Quiz, wegen dreier Edge Functions, dem Streaming-Abo und dem Cron-Job als Sicherheitsnetz).

Kurz zum Prinzip: **Supabase** speichert Accounts, Watchlist, Feed und Push-Abos (kostenlos) und betreibt drei kleine Funktionen im Hintergrund. **Discord** ist nur der Login-Anbieter. Der Alarm selbst läuft in zwei Stufen: **Echtzeit per Webhook** (Hauptweg, sofort — über einen kleinen kostenlosen **Cloudflare**-Zwischenschritt, siehe Schritt 11) und ein **Sicherheitsnetz alle 30 Minuten** (falls der Webhook mal ausfällt) — beides kommt am Ende als echte **Browser-Push-Benachrichtigung direkt von der Seite** an, kein Discord-Bot nötig. **GitHub Pages** hostet die eigentliche Seite (kostenlos). **twitterapi.io** liefert die X-Post-Daten — **wichtig: das ist ab hier nicht mehr nur ein paar Cent, sondern ein Abo ab 29 $/Monat** (siehe Schritt 7, und README.md für die volle Kostenrechnung). Nichts davon muss auf deinem PC laufen.

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
4. Notier dir die **Projekt-Referenz** (der Teil vor `.supabase.co` in deiner Projekt-URL, z. B. `abcdefghijkl`) — brauchst du mehrfach weiter unten.

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
3. "Run" klicken. Es sollte "Success" erscheinen — damit existieren die Tabellen `tracked_handles`, `watchlist` (persönlich pro Nutzer), `posts` (gemeinsamer Feed) und `push_subscriptions`, inklusive Profilbild-Spalten, Zugriffsregeln, Aufräum-Automatik, dem Mitglieder-Zähler und Realtime.

*(Schon ein älteres Cage-Tracker-Projekt am Laufen? Dann brauchst du stattdessen die Migration, die dir separat mitgegeben wurde, statt dieser Datei — sonst gehen bestehende Watchlist-Einträge verloren.)*

---

## 6. Dritt-API-Key für X-Daten einrichten (Sicherheitsnetz)

Dieser Key wird für das seltene 30-Minuten-Sicherheitsnetz gebraucht (und für die Echtzeit-Anmeldung in Schritt 7 — derselbe Key, zwei Zwecke). Empfohlen und in diesem Projekt bereits eingebaut: **[twitterapi.io](https://twitterapi.io)**.

1. Auf https://twitterapi.io registrieren.
2. Im Dashboard einen **API-Key** erzeugen und kopieren (brauchst du gleich mehrfach).
3. Etwas Guthaben aufladen (ein paar Dollar reichen für das Sicherheitsnetz und viele Tests — das Streaming-Abo in Schritt 7 ist separat).

---

## 7. Echtzeit-Streaming-Abo abschließen

Das ist der Teil, der Cage Tracker von "alle paar Minuten" auf "innerhalb von Sekunden" bringt — **und der Teil mit den laufenden Kosten**: ab 29 $/Monat für bis zu 6 beobachtete Profile, mehr Profile kosten mehr (siehe https://twitterapi.io/twitter-stream für die aktuelle Preisliste). Das ist ein festes Abo, unabhängig davon, ob gepostet wird.

1. Im twitterapi.io-Dashboard den Bereich für **Echtzeit-/Streaming-Beobachtung** suchen (Stand der Umsetzung: oft unter einem Menüpunkt wie "Stream" oder "Real-time Monitoring" — die genaue Bezeichnung kann sich ändern, notfalls den Support/die Docs von twitterapi.io konsultieren).
2. Passenden Tarif wählen (Starter reicht meist für den Anfang, z. B. bis 6 Profile) und abschließen.
3. **Noch nichts einstellen müssen** — die eigentliche Anmeldung einzelner Profile passiert automatisch über die Seite selbst (`watchlist`-Edge-Function), sobald jemand ein Profil zur Watchlist hinzufügt.

Die **Webhook-Adresse** (wohin twitterapi.io die neuen Posts schickt) tragen wir erst in Schritt 11 ein, wenn die Edge Function dafür schon deployed und die Adresse damit fertig ist.

---

## 8. VAPID-Schlüssel erzeugen (für den Push-Alarm)

Browser-Push braucht ein einmaliges Schlüsselpaar (VAPID) — der öffentliche Teil landet in `config.js`, der private nur als Supabase-Secret.

1. Braucht [Node.js](https://nodejs.org) — hast du für Schritt 10 sowieso gleich nötig, kannst diesen Schritt also auch direkt danach machen.
2. In diesem Ordner (`cage-tracker/`) ausführen:
   ```bash
   node scripts/generate-vapid-keys.js > vapid.json
   ```
3. Die Konsole zeigt jetzt eine Zeile wie `Dein VAPID_PUBLIC_KEY (für config.js): BN...` — **kopieren**, brauchst du in Schritt 12.
4. Die Datei `vapid.json` (enthält beide Schlüssel) bleibt liegen — brauchst du gleich in Schritt 10. Sie steht in `.gitignore`, landet also nicht versehentlich im GitHub-Repo.

---

## 9. Geheimen Webhook-Token erzeugen

Ein zufälliger, langer Wert, der sicherstellt, dass niemand außer twitterapi.io gefälschte "neuer Post"-Meldungen an deine Seite schicken kann.

Im selben Terminal-Fenster (Node ist ja schon da):
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```
Die ausgegebene lange Zeichenkette **kopieren und irgendwo kurz zwischenspeichern** (z. B. in einer Textdatei) — brauchst du gleich in Schritt 10 **und** in Schritt 11.

---

## 10. Supabase CLI installieren und alle drei Edge Functions deployen

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
4. **Alle drei** Edge Functions deployen — `tweet-webhook` mit `--no-verify-jwt`, weil sie von twitterapi.io aufgerufen wird, das keinen Supabase-Login-Nachweis mitschickt (abgesichert wird sie stattdessen über den `WEBHOOK_TOKEN` im Code selbst, siehe Schritt 9):
   ```bash
   supabase functions deploy poll-x --project-ref DEINE-PROJEKT-REFERENZ
   supabase functions deploy watchlist --project-ref DEINE-PROJEKT-REFERENZ
   supabase functions deploy tweet-webhook --no-verify-jwt --project-ref DEINE-PROJEKT-REFERENZ
   ```
5. Secrets setzen — **über das Supabase-Dashboard, nicht über die Kommandozeile** (die Werte sind zu lang/zu speziell fürs normale cmd-Fenster, im Dashboard ist es ein simples Formular):
   1. Im Supabase-Dashboard: **Edge Functions → Secrets** (oder **Project Settings → Edge Functions**, je nach Dashboard-Version).
   2. Vier Secrets anlegen (Name/Wert):
      - `X_API_KEY` → dein Key aus Schritt 6.
      - `VAPID_CONTACT_EMAIL` → deine E-Mail-Adresse.
      - `VAPID_KEYS_JSON` → öffne `vapid.json` aus diesem Ordner (Rechtsklick → Öffnen mit → Editor), markier den **gesamten Inhalt** (Strg+A), kopier ihn (Strg+C) und füg ihn als Wert ein.
      - `WEBHOOK_TOKEN` → der lange Zufallswert aus Schritt 9.
   3. Speichern. `SUPABASE_URL`, `SUPABASE_ANON_KEY` und der Service-Role-Key stellt Supabase den Funktionen automatisch bereit, die musst du nicht selbst setzen.

   *(Falls du lieber die Kommandozeile nutzt und dich mit Anführungszeichen/Escaping auskennst: `supabase secrets set X_API_KEY=... VAPID_CONTACT_EMAIL=... WEBHOOK_TOKEN=... VAPID_KEYS_JSON="$(cat vapid.json)" --project-ref DEINE-PROJEKT-REFERENZ` — funktioniert in Bash/Git Bash/PowerShell (dort `$(Get-Content vapid.json -Raw)` statt `$(cat ...)`), aber **nicht** im normalen cmd.exe.)*

---

## 11. Webhook-Adresse bei twitterapi.io hinterlegen

**Wichtig, vom twitterapi.io-Support bestätigt (2026-08-31): `*.supabase.co`-Adressen werden als Webhook-Ziel abgelehnt** ("webhook_url is not valid"). Deshalb braucht es einen kleinen kostenlosen Zwischen-Schritt über **Cloudflare Workers** — der bekommt eine andere, akzeptierte Adresse (`*.workers.dev`) und leitet alles unverändert an die echte Supabase-Funktion weiter. Fertiger Code liegt schon in `cage-tracker/cloudflare-webhook-proxy/`.

### 11a. Cloudflare-Weiterleitung einrichten

1. Kostenlosen Account anlegen: https://dash.cloudflare.com/sign-up
2. Wrangler (Cloudflare's Kommandozeilen-Werkzeug, wie die Supabase CLI) installieren:
   ```bash
   npm install -g wrangler
   ```
3. Einloggen (öffnet den Browser):
   ```bash
   wrangler login
   ```
4. In den Ordner `cage-tracker/cloudflare-webhook-proxy/` wechseln:
   ```bash
   cd cloudflare-webhook-proxy
   ```
5. `wrangler.toml` in diesem Ordner öffnen (Editor) und `DEINE-PROJEKT-REFERENZ` in der `TARGET_URL`-Zeile durch deine echte Supabase-Projekt-Referenz ersetzen, speichern.
6. Deployen:
   ```bash
   wrangler deploy
   ```
7. Die Konsole zeigt am Ende eine Adresse wie `https://cage-tracker-webhook-proxy.DEIN-CLOUDFLARE-NAME.workers.dev` — **kopieren**.

### 11b. Diese Adresse bei twitterapi.io eintragen

Komplette Webhook-Adresse (Worker-Adresse aus 11a + `/tweet-webhook?token=` + Webhook-Token aus Schritt 9):

```
https://cage-tracker-webhook-proxy.DEIN-CLOUDFLARE-NAME.workers.dev/tweet-webhook?token=DEIN-WEBHOOK-TOKEN
```

1. Im twitterapi.io-Dashboard: **https://twitterapi.io/twitter-stream/manage** → **"Webhook Configuration"** → Feld **"Endpoint URL"**.
2. Die oben zusammengesetzte Worker-Adresse dort eintragen, speichern — sollte jetzt ohne "not valid"-Fehler klappen.

**Falls "Webhook Configuration" nicht zu finden ist:** Menüpunkt kann sich mit Dashboard-Updates verschieben — notfalls Support fragen oder in der aktuellen Doku (https://docs.twitterapi.io) nachsehen.

---

## 12. Cron einrichten (das Sicherheitsnetz)

1. Im Supabase-Dashboard: **Database → Extensions** → `pg_cron` und `pg_net` aktivieren (falls noch nicht an).
2. Im Supabase-Dashboard: **Project Settings → API** → den **`service_role`-Key** kopieren (geheim! nur hier verwenden, nirgends in Code oder `config.js`).
3. Im **SQL Editor** folgenden Block einfügen (Projekt-Referenz und Service-Role-Key ersetzen) und ausführen:
   ```sql
   select cron.schedule(
     'cage-tracker-poll-x',
     '*/30 * * * *',
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
   `*/30 * * * *` bedeutet "alle 30 Minuten" — reicht als Sicherheitsnetz, da der Webhook (Schritt 11) der eigentliche, schnelle Weg ist.

**Takt später ändern:** Job löschen und neu anlegen (einfacher als "alter_job"):
```sql
select cron.unschedule('cage-tracker-poll-x');
-- danach den obigen cron.schedule-Block mit neuem Zeitplan erneut ausführen.
```

**Job-Status prüfen:** `select * from cron.job;` im SQL Editor zeigt alle laufenden Jobs.

---

## 13. Projekt-Werte in config.js eintragen

1. Im Supabase-Dashboard: **Project Settings → API**.
2. **Project URL** und den **"anon" / "public"**-Schlüssel kopieren (nicht den `service_role`-Key — der gehört nur in Schritt 12, nirgends in diese Datei).
3. In diesem Ordner (`cage-tracker/`) eine neue Datei `config.js` anlegen (Kopie von `config.example.js`) und eintragen:
   - `SUPABASE_URL` und `SUPABASE_ANON_KEY` aus diesem Schritt.
   - `VAPID_PUBLIC_KEY` aus Schritt 8 (die Zeile, die die Konsole ausgegeben hat).
4. **Genau prüfen:** alle drei Werte in Anführungszeichen (`"..."`), `SUPABASE_URL` endet auf `.supabase.co` (ohne `/auth/v1/callback` oder sonstigen Zusatz dahinter — das ist ein anderer Wert aus Schritt 3, nicht dieser hier).

---

## 14. Eigenes GitHub-Repo anlegen + GitHub Pages aktivieren

**Wichtig:** Niemals das private CEO-GPT-Repo verwenden.

1. Auf github.com ein neues Repository anlegen, z. B. `cage-tracker` (öffentlich).
2. Den Inhalt dieses Ordners hochladen — **inklusive** `config.js`, `index.html`, `sw.js` (wichtig, sonst funktioniert Push nicht!), **aber ohne** `vapid.json` und ohne echte Secrets (die stecken nur in Supabase).
3. **Settings → Pages** → Branch `main` (Ordner `/root`) auswählen → Speichern.
4. Nach ein bis zwei Minuten erreichbar unter `https://DEIN-GITHUB-NAME.github.io/cage-tracker/`.

---

## 15. Erlaubte Adresse bei Supabase eintragen

1. Im Supabase-Dashboard: **Authentication → URL Configuration**.
2. Die GitHub-Pages-Adresse aus Schritt 14 als **Site URL** eintragen und zusätzlich unter **Redirect URLs** hinzufügen.

---

## 16. Testen

1. Die GitHub-Pages-Adresse öffnen (bei Cache-Problemen: Strg+F5), mit Discord anmelden.
2. Oben rechts auf **🔕 Push aktivieren** tippen → Browser fragt nach der Benachrichtigungs-Erlaubnis → erlauben. Der Knopf wird zu **🔔 Push an**.
3. Im Tab "Watchlist" ein Profil hinzufügen, das erfahrungsgemäß oft postet. Das kann jetzt ein bis zwei Sekunden dauern (im Hintergrund wird es bei twitterapi.io angemeldet) — das ist normal.
4. Im Supabase-Dashboard unter **Edge Functions → watchlist → Logs** kurz prüfen, dass kein Fehler beim Anmelden aufgetaucht ist.
5. Warten, bis das Profil tatsächlich postet, und prüfen:
   - Kommt die Browser-Benachrichtigung **innerhalb weniger Sekunden** (nicht erst nach 30 Minuten)? Das ist der eigentliche Beweis, dass der Echtzeit-Weg funktioniert.
   - Erscheint der Post im Tab "Feed" mit funktionierendem "Zum Post"-Link?
6. Im Tab "Watchlist" testweise einen Ton auswählen — er sollte sofort als Vorschau abspielen.
7. Ein Profil wieder entfernen und im twitterapi.io-Dashboard prüfen, dass es aus der Liste der beobachteten Profile verschwindet (sonst zahlst du weiter dafür).
8. Funktioniert etwas nicht: siehe "Bei Problemen" unten.

**iPhone-Test:** Safari → Teilen-Symbol → "Zum Home-Bildschirm" → die Seite von dort öffnen, erst dann erscheint der Push-Knopf funktionsfähig (siehe README.md).

---

## Bei Problemen

- **Push-Knopf bleibt grau/verschwindet:** Browser unterstützt evtl. kein Web Push, oder `VAPID_PUBLIC_KEY` in `config.js` fehlt noch/hat noch den Platzhalter-Wert.
- **Hinzufügen zur Watchlist schlägt fehl oder hängt:** Im Supabase-Dashboard unter **Edge Functions → watchlist → Logs** nachsehen. Häufigste Ursache: `X_API_KEY` fehlt/falsch, oder das Streaming-Abo (Schritt 7) ist noch nicht aktiv.
- **"webhook_url is not valid" beim Speichern bei twitterapi.io:** Das ist die bekannte Sperre gegen `*.supabase.co`-Adressen (siehe Schritt 11) — die Cloudflare-Weiterleitung aus Schritt 11a/11b umgehen das. Testen kannst du das Feld selbst mit einer https://webhook.site-Adresse (kein Login nötig) — speichert die, liegt es wirklich an der Domain, nicht an der Formatierung deiner Adresse.
- **Keine Benachrichtigung innerhalb von Sekunden (aber nach bis zu 30 Minuten schon):** Der Echtzeit-Weg greift nicht, das Sicherheitsnetz schon. Prüfen, in dieser Reihenfolge: (1) Läuft der Cloudflare-Worker? `wrangler deploy` nochmal ausführen, sollte ohne Fehler durchlaufen. (2) In **Edge Functions → tweet-webhook → Logs** nachsehen, ob überhaupt Aufrufe ankommen. Kommt gar nichts an: Adresse in Schritt 11b nochmal genau prüfen (Worker-Adresse + Pfad + Token). Kommen Aufrufe an, aber mit Fehlern: den geloggten Payload (`tweet-webhook Payload: ...`) anschauen — das Nachrichtenformat könnte von den Annahmen im Code abweichen und muss in `extractTweets()` in `tweet-webhook/index.ts` angepasst werden.
- **Gar keine Benachrichtigung, auch nicht nach 30 Minuten:** Im Supabase-Dashboard unter **Edge Functions → poll-x → Logs** nachsehen, ob die Funktion überhaupt läuft und ob Fehler auftauchen (häufigste Ursache: falscher/fehlender `X_API_KEY` oder `VAPID_KEYS_JSON` in den Secrets — Schritt 10 nochmal prüfen).
- **Cron scheint nicht zu laufen:** `select * from cron.job;` im SQL Editor prüfen, ob der Job existiert und aktiv ist. `select * from cron.job_run_details order by start_time desc limit 5;` zeigt die letzten Ausführungen und eventuelle Fehler.
- **Login schlägt fehl:** am wahrscheinlichsten Schritt 15 (Redirect URLs) noch offen, oder `config.js` hat noch Platzhalter-Werte oder fehlende Anführungszeichen.
- **"@... ist schon auf deiner Watchlist":** Handle wurde von dir schon eingetragen (Duplikate sind absichtlich blockiert) — im Tab "Watchlist" nachsehen.
- **Seite zeigt nach einer Änderung immer noch den alten Stand:** Browser-Cache — Strg+F5 (Hard-Refresh) auf der Seite, notfalls in einem anderen Browser/Inkognito-Fenster testen.
- **Verwirrung bei "anon"/"service_role" vs. "publishable"/"secret key":** neuere Supabase-Dashboards haben die Begriffe umbenannt — "Publishable key" = der frühere "anon"-Key (gehört in `config.js`), "Secret key(s)" = der frühere "service_role"-Key (gehört **nirgends** in `config.js`, nur in Schritt 12 als Cron-Header und automatisch in den Edge Functions).

---

## Ehrlicher Hinweis

Supabase-Projekte auf der kostenlosen Stufe pausieren automatisch, wenn eine Woche lang niemand die Seite nutzt bzw. keine Datenbank-Aktivität stattfindet. Da der Cron-Job und die Webhook-Aufrufe regelmäßig aktiv werden, sollte das bei Cage Tracker praktisch nicht vorkommen — falls doch, erscheint im Supabase-Dashboard ein "Restore"-Knopf.
