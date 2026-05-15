// Rev080: zentrale Konfiguration und Default-State.
// Keine Laufzeitlogik in dieser Datei.
window.KalenderConfig = {
  APP_REVISION: '086',
  DATABASE_ENVIRONMENT: 'production',
  DATABASE_LABEL: 'Scharfe Datenbank',
  DATABASE_SWITCH_LOCK: false,
  EXPECTED_SUPABASE_REF: 'ihvhghzbhrujtkgkyhdi',
  REQUIRE_PRODUCTION_CONFIRMATION: true,
  SUPABASE_URL: 'https://ihvhghzbhrujtkgkyhdi.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_RhDAx0XhL2WVqcr9fR50LA_tweSTVVi',
  DEFAULT_PROXY_URL: 'https://ihvhghzbhrujtkgkyhdi.supabase.co/functions/v1/ics-proxy?url=',
  PRODUCTION_SWITCH_NOTE: 'Vor Umstellung auf die scharfe Datenbank DATABASE_ENVIRONMENT, DATABASE_LABEL, SUPABASE_URL, SUPABASE_ANON_KEY, DEFAULT_PROXY_URL und EXPECTED_SUPABASE_REF gemeinsam anpassen.',
  STORE_KEY: 'kalender_rev_086_ihvhghzbhrujtkgkyhdi_production_login_gate',
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
