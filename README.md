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

Das ist der Teil, der über das Quiz hinausgeht — und der Weg dahin ist bewusst zweistufig:

**Echtzeit-Weg (der Hauptweg):** Sobald ein Profil zur Watchlist hinzugefügt wird, meldet Cage Tracker es bei twitterapi.io für **Echtzeit-Beobachtung** an. Postet das Profil etwas, schickt twitterapi.io **sofort** (typischerweise innerhalb weniger Sekunden) einen Webhook-Aufruf an eine eigene Supabase Edge Function (`supabase/functions/tweet-webhook/`) — die trägt den Post in die Datenbank ein und schickt eine **echte Browser-Push-Benachrichtigung** (Web-Push-Standard, VAPID) an jeden, der sich auf der Seite dafür angemeldet hat.

**Sicherheitsnetz (der Ersatzweg):** Eine zweite Supabase Edge Function (`supabase/functions/poll-x/`) läuft zusätzlich alle 30 Minuten über einen Cron-Job und fragt sicherheitshalber nochmal alle Profile ab — falls der Webhook mal ausfällt (Störung bei twitterapi.io, falsch konfigurierte Adresse, o. Ä.), geht so trotzdem nichts dauerhaft verloren, nur eben mit Verzögerung.

Kein Discord-Bot, kein Firebase — reiner offener Web-Push-Standard für die Benachrichtigung selbst, denselben, den z. B. auch Lasses Jarvis-App nutzt.

**Ehrlicher Hinweis zu Browser-Push:**
- Funktioniert in Chrome, Edge, Firefox auf Desktop und Android direkt im normalen Browser.
- **iPhone/iPad:** Web Push funktioniert nur ab iOS 16.4 **und** nur, wenn die Seite über "Zum Home-Bildschirm hinzufügen" installiert wurde — nicht im normalen Safari-Tab.
- Push muss **pro Gerät/Browser einmalig aktiviert** werden (Knopf oben rechts). Mehrere Geräte desselben Nutzers bekommen die Benachrichtigung alle, wenn auf allen aktiviert wurde.

**Sehr wichtiger Kosten-Hinweis:** Der Echtzeit-Weg ist **kein Pay-per-Abfrage mehr, sondern ein monatliches Abo** bei twitterapi.io — ab **29 $/Monat für bis zu 6 beobachtete Profile**, gestaffelt höher für mehr Profile (siehe aktuelle Preisliste bei twitterapi.io). Das gilt unabhängig davon, ob überhaupt gepostet wird, und wächst mit der **Gesamtzahl** beobachteter Profile über alle Nutzer hinweg (nicht pro Nutzer einzeln, da dasselbe Profil global nur einmal beobachtet wird). Je mehr die Community trackt, desto eher wird ein teurerer Tarif nötig — das im Blick behalten. Das Sicherheitsnetz (`poll-x`) bleibt separat und günstig pay-per-request abgerechnet.

## Eigener Benachrichtigungston

Im Tab "Watchlist" lässt sich einer von drei kurzen Tönen auswählen (oder "Aus") — er spielt ab, sobald ein neuer Post im Feed erscheint. **Wichtige Einschränkung:** das funktioniert nur, solange die Seite/der Tab gerade **offen** ist — echte Browser/OS-Push-Benachrichtigungen (wenn die Seite geschlossen ist) erlauben grundsätzlich keinen frei wählbaren Sound, das hat kein Browser der Welt (wurde 2018 aus dem Web-Standard gestrichen). Der Ton ist also eine Zusatzfunktion für offene Tabs, kein Ersatz für die echte Push-Benachrichtigung. Die Auswahl wird pro Gerät im Browser gespeichert (nicht in der Datenbank).

## Wie du die Seite an den Discord bringst

1. Zuerst **[SETUP.md](SETUP.md)** komplett durchgehen (Discord-App, Supabase-Projekt, Dritt-API-Key, twitterapi.io-Streaming-Abo, VAPID-Schlüssel, Edge Functions, Cron).
2. **Eigenes, separates GitHub-Repo** anlegen, nur für Cage Tracker — **niemals das private CEO-GPT-Repo verwenden**, das enthält private Finanzdaten und Notizen.
3. Inhalt dieses Ordners (inkl. der neu erstellten `config.js`) in das neue Repo hochladen, **GitHub Pages** aktivieren (Settings → Pages → Branch `main`).
4. Du bekommst eine dauerhafte, kostenlose Adresse wie `https://deinname.github.io/cage-tracker/` — die postest du im CAGE-Discord.

Für einen schnellen lokalen Test ohne Login/Supabase-Anbindung: Doppelklick auf `index.html` zeigt zumindest den Login-Bildschirm (bzw. eine Fehlermeldung, solange `config.js` noch fehlt) — für den vollen Ablauf inklusive Push-Alarm muss die Einrichtung aus `SETUP.md` stehen (Push braucht außerdem eine echte `https://`-Adresse, funktioniert nicht per Doppelklick auf die lokale Datei).

## Watchlist-Regeln & Grenzen

- Ein X-Handle kann nicht doppelt auf **deiner eigenen** Liste stehen (Duplikate werden abgewiesen) — andere Nutzer können dasselbe Profil unabhängig auf ihrer eigenen Liste haben, ohne dass sich das gegenseitig stört.
- Entfernst du als letzter Nutzer ein Profil von deiner Watchlist (niemand sonst trackt es mehr), wird es automatisch komplett vergessen — inklusive seiner bisherigen Posts im Feed und der Abmeldung von der Echtzeit-Beobachtung bei twitterapi.io (damit dafür nicht weiter bezahlt wird).
- Hinzufügen/Entfernen kann jetzt spürbar länger dauern als vorher (bis zu ein paar Sekunden) — im Hintergrund wird bei Bedarf auch die An-/Abmeldung bei twitterapi.io erledigt, nicht nur ein Datenbank-Eintrag.
- Beim Hinzufügen eines neuen Profils wird bewusst **keine alte Historie nachgemeldet** — nur Posts, die nach dem Hinzufügen kommen, lösen einen Alarm aus. Sonst gäbe es beim Eintragen eines aktiven Accounts eine Alarm-Flut aus der Vergangenheit.
- Gespeichert wird nur ein kurzer Text-Ausschnitt (ca. 200 Zeichen), nie der vollständige Post — der Link führt immer zum echten Original.

## Sicherheitsnetz-Takt ändern

Der 30-Minuten-Takt von `poll-x` läuft über einen SQL-Cron-Eintrag in Supabase, kein Code-Update nötig — siehe `SETUP.md` für den genauen Befehl.
