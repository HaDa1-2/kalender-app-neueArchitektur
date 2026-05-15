# Kalender App – Revision 083 Cleanup

Ausgangsbasis: Revision 082 / modularer Zwischenstand.

## Ziel dieser Revision

Diese Revision ist eine risikoarme Verschlankungsrevision. Der Schwerpunkt liegt nicht auf neuen Funktionen, sondern auf dem Entfernen eindeutig überschatteter Alt-Funktionsblöcke im Hauptcode.

## Änderungen in Revision 083

- `js/app.js` bereinigt: 16 überschattete Top-Level-Funktionsdeklarationen entfernt.
- Entfernte Alt-Funktionsblöcke waren durch spätere gleichnamige Funktionen ersetzt und damit im aktuellen Laufzeitstand nicht mehr maßgeblich.
- Keine Änderung an Supabase-URL, anon key, Tabellenstruktur oder RLS-Logik.
- Keine Änderung an ICS-Proxy, ICS-Parser, Datenbanktabellen oder Speicherstrategie.
- Modulstruktur beibehalten: `config.js`, `utils.js`, `ics-parser.js`, `icons.js`, `app.js`.
- Syntaxprüfung mit `node --check` für alle JavaScript-Dateien erfolgreich.

## Auszutauschende Dateien

- `js/app.js`
- optional: `README.md`
- optional: `package.json`

## Nicht umgesetzt

- Keine Entfernung alter Rev-CSS-Blöcke, weil dort viele spätere Designregeln bewusst frühere Regeln überschreiben. Eine automatische Bereinigung wäre optisch riskant.
- Keine fachliche Zerlegung von `app.js` in viele weitere Module, weil zuerst diese Cleanup-Revision getestet werden sollte.
- Keine Änderungen an Datenbank-Schreib-/Löschlogik, um Datenverlust oder Seiteneffekte zu vermeiden.

## Prüfstand

- `node --check js/app.js`: erfolgreich
- `node --check js/core/config.js`: erfolgreich
- `node --check js/core/utils.js`: erfolgreich
- `node --check js/core/ics-parser.js`: erfolgreich
- `node --check js/ui/icons.js`: erfolgreich
