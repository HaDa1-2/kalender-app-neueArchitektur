# Kalender App – Revision 064 modular

Ausgangsbasis: `kalender_rev_063.html`.

Diese Revision trennt die bisherige Single-File-App in eine deployfähige Struktur:

```text
index.html
css/styles.css
js/app.js
assets/
api/
vercel.json
package.json
.env.example
```

## Deployment über GitHub + Vercel

1. Neues GitHub-Repository erstellen.
2. Den Inhalt dieses Ordners in das Repository hochladen.
3. Neues Vercel-Projekt erstellen.
4. Repository verbinden.
5. Deploy ausführen.

## Supabase-Hinweis

Die Supabase-URL, der Anon-Key und die Proxy-URL stehen aktuell noch in `js/app.js`, weil diese Revision bewusst ohne Build-System bleibt.

Suche in `js/app.js` nach:

```js
const SUPABASE_URL = ...
const SUPABASE_ANON_KEY = ...
const DEFAULT_PROXY_URL = ...
```

Dort kannst du später die Werte der neuen Supabase-Testdatenbank eintragen.

## Edge Function / ICS Proxy

Für reine Testdaten ohne externe ICS-Kalender ist die Edge Function zunächst nicht notwendig.
Sobald externe ICS-Kalender eingebunden werden, muss der Proxy im neuen Supabase-Projekt wieder bereitstehen.
