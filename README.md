# Cage Tracker — X-Profil-Watchlist mit Push-Alarm

Eine eigenständige Seite für den CAGE-Discord: die Community trägt wichtige X-(Twitter)-Profile in eine gemeinsame Watchlist ein, und sobald eines davon postet, kommt automatisch eine Browser-Benachrichtigung direkt von der Seite — mit Direkt-Link zum Post. Alles läuft über die Seite selbst, kein Discord-Bot, kein Umweg. Gebaut für schnelles Reagieren ("Trenchen"), nicht als Analyse-Tool.

## Was drinsteckt

- **Persönliche Watchlist**: jeder Nutzer hat seine eigene, private Liste — niemand sonst sieht, wen du beobachtest. Im Hintergrund wird dasselbe Profil trotzdem nur einmal abgefragt, auch wenn mehrere Leute es getrackt haben (spart Kosten bei der X-Datenquelle).
- **Gemeinsamer Feed**: erkannte Posts landen für alle im selben Live-Feed, egal wer das Profil eingetragen hat — bewusst so, damit die ganze Community mitbekommt, was läuft.
- **Echter Browser-Push-Alarm**: postet ein beobachtetes Profil etwas Neues, bekommst du eine echte Benachrichtigung auf jedem Gerät, auf dem du "Push aktivieren" angetippt hast — wie bei einer App, auch wenn die Seite gerade nicht offen ist. Der Alarm geht an alle, die Push aktiviert haben (passend zum gemeinsamen Feed), nicht nur an den, der das Profil eingetragen hat.
- **Live-Feed auf der Seite**: alle erkannten Posts, neueste zuerst, mit Button "Zum Post" (öffnet den echten X-Post in einem neuen Tab). Praktisch als Verlauf, falls du eine Benachrichtigung verpasst hast.
- **Login mit Discord, Pflicht**: ohne Anmeldung siehst du nur den Login-Bildschirm.

## Wie Login & Speicherung funktionieren

Genau wie bei [cage-quiz](../cage-quiz/README.md): Die Seite selbst bleibt eine reine HTML/JS-Datei ohne eigenen Server. **Supabase** (kostenloser Cloud-Dienst) übernimmt Auth ("Login mit Discord") und Datenbank (Watchlist, Feed, Push-Abos), mit Row-Level-Security, damit jeder nur seine eigenen Einträge ändern kann.

## Wie der Alarm technisch funktioniert

Das ist der Teil, der über das Quiz hinausgeht:

1. Eine **Supabase Edge Function** (`supabase/functions/poll-x/`) wird von einem **Cron-Job in Supabase selbst** alle paar Minuten automatisch angestoßen — läuft unabhängig davon, ob Lasses PC an ist oder die Seite gerade jemand offen hat.
2. Sie fragt für jedes Profil auf der Watchlist über eine Dritt-API die neuesten X-Posts ab.
3. Findet sie einen neuen Post: trägt sie ihn in die Datenbank ein **und** schickt eine **echte Browser-Push-Benachrichtigung** (Web-Push-Standard, VAPID) an jeden, der sich auf der Seite dafür angemeldet hat.

Kein Discord-Bot, kein Webhook, kein Firebase — reiner offener Web-Push-Standard, denselben, den z. B. auch Lasses Jarvis-App nutzt.

**Ehrlicher Hinweis zu Browser-Push:**
- Funktioniert in Chrome, Edge, Firefox auf Desktop und Android direkt im normalen Browser.
- **iPhone/iPad:** Web Push funktioniert nur ab iOS 16.4 **und** nur, wenn die Seite über "Zum Home-Bildschirm hinzufügen" installiert wurde — nicht im normalen Safari-Tab.
- Push muss **pro Gerät/Browser einmalig aktiviert** werden (Knopf oben rechts). Mehrere Geräte desselben Nutzers bekommen die Benachrichtigung alle, wenn auf allen aktiviert wurde.

**Ehrlicher Hinweis: kein Echtzeit-System.** Je nach eingestelltem Poll-Intervall (empfohlen: alle 5 Minuten) können ein paar Minuten zwischen dem echten Post und der Benachrichtigung liegen — schnell genug fürs Trenchen, aber kein Sekunden-Ticker.

**Ehrlicher Kosten-Hinweis:** Anders als Supabase und GitHub Pages ist die X-Datenquelle **nicht kostenlos** (Push-Benachrichtigungen selbst sind es, wie GitHub Pages/Supabase). Die offizielle X-API ist für diesen Zweck unverhältnismäßig teuer (Lesezugriff auf fremde Timelines beginnt im dreistelligen Dollar-Bereich pro Monat), deshalb nutzt dieses Tool eine deutlich günstigere, in der Crypto-Szene übliche Dritt-API (pay-per-request, keine Grundgebühr — Details in `SETUP.md`). Grobe Kostenrechnung:

> Abfragen pro Tag ≈ Anzahl Profile × (24 × 60 / Poll-Intervall in Minuten)

Bei z. B. 20 Profilen und einem 5-Minuten-Intervall sind das ca. 5.760 Abfragen/Tag — das gegen die aktuelle Preisliste des gewählten Anbieters halten, bevor die Watchlist stark wächst.

## Wie du die Seite an den Discord bringst

1. Zuerst **[SETUP.md](SETUP.md)** komplett durchgehen (Discord-App, Supabase-Projekt, Dritt-API-Key, VAPID-Schlüssel, Edge Function, Cron).
2. **Eigenes, separates GitHub-Repo** anlegen, nur für Cage Tracker — **niemals das private CEO-GPT-Repo verwenden**, das enthält private Finanzdaten und Notizen.
3. Inhalt dieses Ordners (inkl. der neu erstellten `config.js`) in das neue Repo hochladen, **GitHub Pages** aktivieren (Settings → Pages → Branch `main`).
4. Du bekommst eine dauerhafte, kostenlose Adresse wie `https://deinname.github.io/cage-tracker/` — die postest du im CAGE-Discord.

Für einen schnellen lokalen Test ohne Login/Supabase-Anbindung: Doppelklick auf `index.html` zeigt zumindest den Login-Bildschirm (bzw. eine Fehlermeldung, solange `config.js` noch fehlt) — für den vollen Ablauf inklusive Push-Alarm muss die Einrichtung aus `SETUP.md` stehen (Push braucht außerdem eine echte `https://`-Adresse, funktioniert nicht per Doppelklick auf die lokale Datei).

## Watchlist-Regeln & Grenzen

- Ein X-Handle kann nicht doppelt auf **deiner eigenen** Liste stehen (Duplikate werden abgewiesen) — andere Nutzer können dasselbe Profil unabhängig auf ihrer eigenen Liste haben, ohne dass sich das gegenseitig stört.
- Entfernst du als letzter Nutzer ein Profil von deiner Watchlist (niemand sonst trackt es mehr), wird es automatisch komplett vergessen — inklusive seiner bisherigen Posts im Feed.
- Beim Hinzufügen eines neuen Profils wird bewusst **keine alte Historie nachgemeldet** — nur Posts, die nach dem Hinzufügen kommen, lösen einen Alarm aus. Sonst gäbe es beim Eintragen eines aktiven Accounts eine Alarm-Flut aus der Vergangenheit.
- Gespeichert wird nur ein kurzer Text-Ausschnitt (ca. 200 Zeichen), nie der vollständige Post — der Link führt immer zum echten Original.

## Poll-Intervall ändern

Läuft über einen SQL-Cron-Eintrag in Supabase, kein Code-Update nötig — siehe `SETUP.md`, Schritt 9, für den genauen Befehl.
