# Kalender App – Revision 085 DB Safety

Ausgangsbasis: funktionierende Revision 084 Cleanup 2.

## Ziel dieser Revision

Vorbereitung auf den Wechsel von Testdatenbank auf scharfe Supabase-Datenbank, ohne die bestehende Fachlogik, Renderlogik oder Datenbankstruktur umzubauen.

## Änderungen in Revision 085

- Datenbank-Sicherheitslayer in `js/app.js` ergänzt.
- Sichtbarer Datenbank-Badge im Kopfbereich ergänzt.
- Cloud-Modal und Einstellungs-Modal zeigen jetzt eine Datenbank-Sicherheitsprüfung.
- Schreibvorgänge in `app_state` werden blockiert, wenn die Supabase-Konfiguration widersprüchlich ist.
- `config.js` um klare Datenbank-Umgebungsparameter erweitert:
  - `APP_REVISION`
  - `DATABASE_ENVIRONMENT`
  - `DATABASE_LABEL`
  - `DATABASE_SWITCH_LOCK`
  - `EXPECTED_SUPABASE_REF`
  - `REQUIRE_PRODUCTION_CONFIRMATION`
  - `PRODUCTION_SWITCH_NOTE`
- Lokaler Speicher-Key wurde datenbankbezogen gemacht, damit Test- und Produktivumgebung nicht denselben LocalStorage-Zwischenstand verwenden.
- CSS für Datenbank-Badge und Sicherheitspanel ergänzt.
- Dokument `docs/supabase_production_checklist.md` ergänzt.

## Geänderte Dateien

- `js/core/config.js`
- `js/app.js`
- `css/styles.css`
- `package.json`
- `README.md`
- `docs/supabase_production_checklist.md`

## Nicht umgesetzt

- Die Supabase-Zugangsdaten wurden noch nicht auf die scharfe Datenbank umgestellt, weil die Produktiv-URL und der Produktiv-Anon-Key nicht in dieser Revision vorliegen.
- Keine automatische Migration von Testdaten in die scharfe Datenbank.
- Keine aggressive Bereinigung alter CSS- oder JS-Blöcke.
- Keine Änderung an Tabellenstruktur, RLS-Policies oder Edge Function Deployment direkt in Supabase.

## Umschaltung auf scharfe Datenbank

In `js/core/config.js` müssen beim späteren Wechsel alle produktiven Werte gemeinsam angepasst werden. Danach muss `DATABASE_SWITCH_LOCK` bewusst auf `false` gesetzt werden. Solange der Lock aktiv ist und die Umgebung als Produktivdatenbank markiert wird, blockiert die App Schreibvorgänge in `app_state`.

## Prüfung

- `node --check js/app.js` erfolgreich.
- `node --check js/core/config.js` erfolgreich.
- `node --check js/core/utils.js` erfolgreich.
- `node --check js/core/ics-parser.js` erfolgreich.
- `node --check js/ui/icons.js` erfolgreich.
