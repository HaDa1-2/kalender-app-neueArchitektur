# Supabase-Produktivumschaltung – Checkliste Rev085

Diese Datei ist für den Wechsel von Testdatenbank auf scharfe Datenbank gedacht.

## Vor dem Umschalten

1. Backup der scharfen Supabase-Tabellen ziehen.
2. Prüfen, ob alle benötigten Tabellen existieren.
3. Row Level Security für alle nutzerbezogenen Tabellen aktivieren.
4. Policies prüfen: Nutzer dürfen nur Zeilen mit `user_id = auth.uid()` lesen, anlegen, ändern und löschen.
5. Edge Function `ics-proxy` in der scharfen Supabase-Instanz bereitstellen.
6. In `js/core/config.js` gemeinsam anpassen:
   - `DATABASE_ENVIRONMENT`
   - `DATABASE_LABEL`
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `DEFAULT_PROXY_URL`
   - `EXPECTED_SUPABASE_REF`
   - `STORE_KEY`
   - danach erst `DATABASE_SWITCH_LOCK` auf `false`

## Tabellen aus der gelieferten Schema-Datei

- `app_state`
- `calendar_groups`
- `calendar_sources`
- `task_groups`
- `tasks`
- `long_task_groups`
- `long_tasks`
- `own_events`

Zusätzlich im Code verwendet und deshalb ebenfalls zu prüfen:

- `projects`
- `project_tasks`
- `project_task_logs`
- `own_event_logs`
- `completed_tasks`

## Funktionstest nach Umschaltung

1. Login mit Produktivnutzer.
2. Kalendergruppe anlegen.
3. ICS-Quelle anlegen und synchronisieren.
4. Eigenen Kalender anlegen.
5. Eigenen Termin erstellen, bearbeiten, löschen.
6. Tagestask erstellen, abhaken, wieder öffnen, löschen.
7. Langfristigen Task erstellen, abhaken, löschen.
8. Projekt und Projekt-Task testen, falls genutzt.
9. Reload-Button drücken.
10. Logout/Login testen.

## Abbruchkriterien

Nicht auf produktiv weiterarbeiten, wenn:

- die App „Datenbankprüfung blockiert“ meldet,
- URL, Anon-Key und Proxy auf unterschiedliche Supabase-Refs zeigen,
- eigene Termine nach Reload verschwinden,
- erledigte Tasks nicht mehr erscheinen,
- Tabellenzugriffe RLS-Fehler oder Fremdschlüssel-Fehler werfen.
