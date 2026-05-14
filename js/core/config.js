// Rev080: zentrale Konfiguration und Default-State.
// Keine Laufzeitlogik in dieser Datei.
window.KalenderConfig = {
  SUPABASE_URL: 'https://peikohfbuxmpxhzmxrbj.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBlaWtvaGZidXhtcHhoem14cmJqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg2MDA5ODYsImV4cCI6MjA5NDE3Njk4Nn0.KIsmCS19Jiy4DnYLoUyVbKDvJ6hOa_xFCB7CDLQ0vSA',
  DEFAULT_PROXY_URL: 'https://peikohfbuxmpxhzmxrbj.supabase.co/functions/v1/ics-proxy?url=',
  STORE_KEY: 'kalender_rev_024_login_gate',
  DB_TABLES: {
    appState: 'app_state',
    calendarGroups: 'calendar_groups',
    calendarSources: 'calendar_sources',
    taskGroups: 'task_groups',
    tasks: 'tasks',
    longTaskGroups: 'long_task_groups',
    longTasks: 'long_tasks',
    ownEvents: 'own_events'
  },
  DEFAULT_COLORS: { event: '#7c5cff', task: '#ffb020', overdue: '#ff5050', long: '#48d38b' },
  PALETTE: ['#7c5cff','#39bdf8','#22c55e','#ffb020','#ff5050','#ec4899','#14b8a6','#f97316','#a855f7','#64748b','#111827','#ffffff'],
  BLANK_INITIAL_STATE: {
    days: 4,
    dayRows: 1,
    startMode: 'rolling',
    panes: 1,
    offset: 0,
    syncInterval: 15,
    fetchMode: 'proxy',
    proxyUrl: '',
    taskColumns: [{ id: 'default', name: 'Allgemein', color: '#ffb020', visible: true }],
    calendars: [{
      name: 'Mein Kalender',
      links: [],
      events: [],
      ownEvents: [],
      status: 'Bitte anmelden, um Kalenderdaten zu laden.',
      visible: true
    }],
    tasks: [],
    longterm: [],
    longColumns: [{ id: 'long_default', name: 'Allgemein', color: '#48d38b', visible: true }],
    viewModes: [],
    activeViewMode: '',
    theme: 'light',
    cornerStyle: 'rounded'
  }
};
