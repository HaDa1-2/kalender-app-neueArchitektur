# Kalender App – Revision 069 modular

Ausgangsbasis: `kalender_rev_068_monolith_final_clean.html`.

Dieses Paket ist die modulare Projektstruktur für GitHub + Vercel + Supabase:

- `index.html` enthält nur die HTML-Struktur und bindet CSS/JavaScript ein.
- `css/styles.css` enthält die komplette Oberfläche und alle bisherigen Design-Overrides.
- `js/app.js` enthält die komplette Kalenderlogik, Supabase-Anbindung, AppState-Logik, ICS-Logik, Tasks, Projekte, Einstellungen und Rev068-Overrides.
- `assets/architektur-kalender-app.png` enthält die Architekturvisualisierung als Referenz.
- `api/` bleibt für spätere Vercel-Serverless-Funktionen reserviert.
- `vercel.json` ist die minimale Vercel-Konfiguration.
- `.env.example` dokumentiert die aktuell verwendeten Supabase-/Proxy-Werte.

## Architekturprinzip

Die Fach-/Nutzdaten bleiben in Supabase-Tabellen: Kalendergruppen, Kalenderquellen, eigene Termine, Tagestasks, langfristige Tasks, Projekte und Gruppen.

Der AppState ist nur für UI-/Anzeigeeinstellungen vorgesehen: sichtbare Tage, Zeilen, Startmodus, Ansichtsmodus, Theme, Kanten, Markierungen, Zeitstrahl-Einstellungen, Urlaubstage-/Arbeitstag-Anzeige und ähnliche Darstellungsoptionen.

## Deployment

1. Inhalt dieses Ordners in ein GitHub-Repository hochladen.
2. Vercel-Projekt mit dem Repository verbinden.
3. Deployment starten.
4. Supabase-Projekt und Edge Function `ics-proxy` müssen erreichbar bleiben, sobald externe ICS-Kalender genutzt werden.

## Revisionen künftig

Bei kleineren Änderungen sollen nur die betroffenen Dateien ersetzt werden, z. B. nur `css/styles.css` für reine Designänderungen oder nur `js/app.js` für Funktionsänderungen.
