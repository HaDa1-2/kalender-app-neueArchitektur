# Kalender App – Revision 075 Cleanup

Bereinigter modularer Stand auf Basis Revision 074.

## Inhalt

- `index.html` – HTML-Grundstruktur.
- `css/styles.css` – bereinigte Oberflächenregeln ohne Revisionskommentare.
- `js/app.js` – bereinigte Kalenderlogik ohne Revisionskommentare, mit globaler Sofort-Speicherung und neutralem Zeitstrahl.
- `api/` – reserviert für spätere Vercel Serverless Functions. Aktuell läuft ICS über die Supabase Edge Function `ics-proxy`.
- `assets/` – runtime-relevante Assets. Die alte Architekturgrafik wurde entfernt, weil sie für das Deployment nicht benötigt wird.

## Bereinigung in Revision 075

- Revisionskommentare aus JavaScript und CSS entfernt.
- Überholte Zeitstrahl-Schrittweiten-Hinweise aus der aktiven Oberfläche entfernt. Der Zeitstrahl bleibt fest im Halbstundentakt.
- Alte Theme-Reste für Blau/Rot/Grün aus CSS entfernt. Es bleiben Hell/Dunkel und die aktuellen Anzeigeoptionen.
- Nicht benötigte Architekturgrafik aus dem Deployment-Paket entfernt.
- Paketmetadaten auf Revision 075 aktualisiert.

## Architekturregel

Fachliche Daten liegen in Supabase-Tabellen. Der `app_state` enthält nur UI-/Anzeigeeinstellungen.

## Wichtiger Hinweis

Diese Revision ist eine sichere Bereinigungsrevision. Es wurden keine Funktionsnamen großflächig umbenannt, weil das bei dem bestehenden Revisions-Code unnötig hohes Bruchrisiko hätte. Die eigentliche strukturelle Bereinigung folgt sinnvollerweise in einer späteren echten Modularisierungsrunde.
