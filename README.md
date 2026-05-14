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


## Revision 072

Änderungen:
- Zeitstrahl wird nach Klick auf Heute, Tag vor und Tag zurück wieder neutral bereinigt.
- Alte Urlaubs-/Wochenend-Inline-Styles am Zeitstrahl werden entfernt, damit der braune Hintergrund nicht hängen bleibt.
- Einstellungen-Button wird nach Render-Vorgängen erneut robust gebunden.
- Wochenendoption bleibt im Allgemein-Reiter sichtbar und getrennt von Urlaub steuerbar.

Auszutauschende Dateien:
- `js/app.js`
- optional `README.md` und `package.json` für Versionsdokumentation


## Revision 073

Änderungen:
- Neue Kalendergruppen werden erst nach erfolgreichem INSERT/UPSERT in `calendar_groups` lokal angezeigt.
- Neue Tagestask-Gruppen werden sofort in `task_groups` gespeichert.
- Neue langfristige Gruppen werden sofort in `long_task_groups` gespeichert.
- Neue ICS- und eigene Kalenderquellen sichern vorher die Kalendergruppe und schreiben anschließend direkt in `calendar_sources`.
- Der grüne Refresh-Button speichert ausstehende relationale Änderungen vor dem Neuladen.
- `saveRelationalSnapshot` ist wieder aktiv, aber weiterhin sicher: nur UPSERT, keine automatische Löschung fehlender Datensätze.

Nicht umgesetzt:
- Keine automatische Tabellenbereinigung beim Speichern, damit ein Reload oder Zwischenstand keine bestehenden Supabase-Daten versehentlich löscht.


## Revision 074

Änderungen:
- Globale Sofort-Speicherung für Kalendergruppen, Kalenderquellen, Tagestask-Gruppen, Tagestasks, langfristige Gruppen, langfristige Tasks, eigene Termine, Projekte und Projekt-Tasks ergänzt.
- Der grüne Refresh nutzt weiterhin vorher die aktive Speicherung, damit lokale Änderungen nicht durch einen Datenbank-Reload überschrieben werden.
- Der Zeitstrahl ist von Urlaubs-, Wochenend- und Heute-Hintergründen entkoppelt und bleibt neutral/weiß.
- Bestehende Wochenend-/Urlaubs-Klassen werden am Zeitstrahl nach Navigation aktiv entfernt, um Flackern zu unterbinden.

Nicht umgesetzt:
- Keine automatische Löschung fehlender Zeilen beim Snapshot. Das bleibt absichtlich deaktiviert, um Datenverlust in Supabase zu vermeiden.
