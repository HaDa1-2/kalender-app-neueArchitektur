# Sichtbarkeit von Frontend-Code

Der Code einer reinen Frontend-App ist im Browser grundsätzlich sichtbar. HTML, CSS und JavaScript müssen an den Browser ausgeliefert werden, damit die App ausgeführt werden kann. Dadurch kann ein Nutzer über die Entwicklertools Dateien ansehen und kopieren.

Was daraus folgt:
- Frontend-Code ist kein geeigneter Ort für echte Geheimnisse.
- Supabase-Anon-Keys dürfen öffentlich sein, solange Row Level Security korrekt gesetzt ist.
- Service-Role-Keys, private API-Schlüssel und administrative Logik dürfen niemals ins Frontend.
- Sicherheitskritische Prüfungen gehören in Supabase RLS, Datenbank-Policies oder Edge Functions.
- Minifizierung oder Obfuskation erschwert nur das Lesen, schützt aber nicht zuverlässig vor Kopieren.

Für den aktuellen privaten Einsatz ist entscheidend, dass keine geheimen Schlüssel im Frontend stehen und dass die Supabase-Tabellen per RLS nutzerbezogen abgesichert sind.
