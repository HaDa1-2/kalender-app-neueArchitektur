# Kalender App – Revision 084 Cleanup 2

Ausgangsbasis: Revision 083 Cleanup.

## Ziel dieser Revision

Weitere Verschlankung des Hauptcodes ohne Änderung an Datenbankstruktur, Supabase-Tabellen, Speicherlogik oder ICS-Proxy.

## Änderungen in Revision 084

- Doppelten `Rev 051`-Funktionsblock am Anfang von `js/app.js` entfernt.
- Die spätere `Rev 051`-Implementierung bleibt erhalten, weil sie in der gewachsenen Override-Kette an der richtigen Position liegt.
- Zwei alte, nicht mehr referenzierte Alias-Variablen entfernt.
- Vier alte globale Kompatibilitäts-Exports aus `Rev 056` entfernt, weil sie im Code und im Markup nicht referenziert werden.
- Keine fachliche Funktion bewusst verändert.

## Geänderte Dateien

- `js/app.js`
- `package.json`
- `README.md`

## Nicht umgesetzt

- Keine Entfernung kompletter späterer Rev-Blöcke wie Rev 033 bis Rev 078. Diese Blöcke sind trotz alter Nummern Teil der aktuellen Override-Kette und greifen in Render-, Speicher-, Projekt-, Zeitstrahl- oder Monatslogik ein.
- Keine CSS-Bereinigung. Die CSS-Datei enthält viele alte Revisionskommentare, aber spätere Regeln überschreiben frühere Regeln bewusst. Eine aggressive Entfernung wäre aktuell zu riskant.
- Keine Änderung an Supabase, RLS, Tabellen, Edge Function oder Login-Verhalten.

## Prüfung

- `node --check js/app.js` erfolgreich.
- `node --check` für `js/core/config.js`, `js/core/utils.js`, `js/core/ics-parser.js` und `js/ui/icons.js` erfolgreich.

## Revision 085

Änderungen:
- Weitere risikoarme Verschlankung in `js/app.js`.
- Entfernt wurde die alte Basis-`renderMonthView`-Funktion, weil die Monatsansicht später durch Revision 078 vollständig ersetzt wird.
- Entfernt wurde die alte Rev051-Monatsrenderlogik inklusive `monthEventsForDayRev51`, weil sie durch spätere Monatslogik überschrieben wird.
- Entfernt wurden nachweislich ungenutzte Hilfsfunktionen: `rev55TaskTable`, `rev55GroupFk`, `rev73Delete`.

Nicht umgesetzt:
- Keine Entfernung aktiver Override-Ketten für eigene Termine, Projekte, Einstellungen, Zeitstrahl oder Datenbank-Speicherung. Diese Blöcke sind weiterhin miteinander verschachtelt und daher nicht risikofrei löschbar.
- Keine CSS-Bereinigung, weil ältere CSS-Blöcke weiterhin durch spätere Regeln übersteuert werden und ein Entfernen Layout-Rückfälle auslösen kann.

Prüfung:
- `node --check` für `js/app.js`, `js/core/utils.js`, `js/core/config.js`, `js/core/ics-parser.js` und `js/ui/icons.js` erfolgreich.

