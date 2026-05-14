# Kalender App – Revision 071 modular

Ausgangsbasis: Revision 070 modular.

## Änderungen in Revision 071

- Wochenendtage sind im Einstellungsdialog unter „Allgemein“ einstellbar: aktivieren/deaktivieren, Farbe, Deckkraft.
- Samstag und Sonntag werden eindeutig als Wochenende behandelt.
- Urlaubstage werden nur noch an Nicht-Wochenendtagen markiert.
- Monatsübersicht wurde stabilisiert, damit Urlaubstage am Wochenende nicht kurz orange aufflackern.
- Hinweise-Reiter wurde mit konkreten Hinweisen zu Urlaub, Wochenende, Speicherlogik und ICS-Link-Änderungen befüllt.
- Zeitstrahl-Färbung wurde isoliert: alte Urlaubs-/Wochenendklassen werden entfernt, damit der Sidebar-Zeitstrahl nicht braun/orange durchgefärbt wird.
- Bestehende ICS-Kalenderquellen speichern Änderungen an Name, Link und Farbe sofort in `calendar_sources`.
- Wenn ein ICS-Link geändert wird, wird der lokale ICS-Cache dieser Quelle geleert und der Kalender neu geladen.

## Struktur

- `index.html` enthält die HTML-Grundstruktur.
- `css/styles.css` enthält die Oberfläche und bestehende Designregeln.
- `js/app.js` enthält aktuell noch die Hauptlogik und Rev071-Overrides.
- `api/` ist für spätere Vercel-Serverless-Funktionen reserviert.

## Hinweis

Die Datei ist noch nicht fachlich vollständig modularisiert. Diese Revision behebt gezielt die aktuell genannten Darstellungs- und Speicherprobleme im bestehenden modularen Stand.
