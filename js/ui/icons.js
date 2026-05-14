// Rev080: zentrale SVG-Icons für UI-Schaltflächen.
(function(){
function iconEye(isVisible){
  return isVisible
    ? `<svg viewBox="0 0 24 24" fill="none" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"/><circle cx="12" cy="12" r="2.8"/></svg>`
    : `<svg viewBox="0 0 24 24" fill="none" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 12s3.5-6 9.5-6c2.2 0 4 .8 5.4 1.8"/><path d="M21.5 12s-3.5 6-9.5 6c-2.2 0-4-.8-5.4-1.8"/><circle cx="12" cy="12" r="2.8"/><path d="M4 4l16 16"/></svg>`;
}

function iconSettings(){
  return `<svg viewBox="0 0 24 24" fill="none" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.05.05a2 2 0 1 1-2.83 2.83l-.05-.05A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21a2 2 0 1 1-4 0v-.08A1.7 1.7 0 0 0 8.6 19.4a1.7 1.7 0 0 0-1.88.34l-.05.05a2 2 0 1 1-2.83-2.83l.05-.05A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H3a2 2 0 1 1 0-4h.08A1.7 1.7 0 0 0 4.6 8.6a1.7 1.7 0 0 0-.34-1.88l-.05-.05a2 2 0 1 1 2.83-2.83l.05.05A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V3a2 2 0 1 1 4 0v.08A1.7 1.7 0 0 0 15.4 4.6a1.7 1.7 0 0 0 1.88-.34l.05-.05a2 2 0 1 1 2.83 2.83l-.05.05A1.7 1.7 0 0 0 19.4 9c.2.36.5.67.9.86.32.15.68.22 1.1.22H21a2 2 0 1 1 0 4h-.08a1.7 1.7 0 0 0-1.52.92Z"/></svg>`;
}


function iconArrowUp(){
  return `<svg viewBox="0 0 24 24" fill="none" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5"/><path d="M6 11l6-6 6 6"/></svg>`;
}

function iconArrowDown(){
  return `<svg viewBox="0 0 24 24" fill="none" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="M18 13l-6 6-6-6"/></svg>`;
}

function iconEdit(){
  return `<svg viewBox="0 0 24 24" fill="none" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4 11.5-11.5Z"/></svg>`;
}

function iconPlus(){
  return `<svg viewBox="0 0 24 24" fill="none" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>`;
}

function iconChevronRight(){
  return `<svg viewBox="0 0 24 24" fill="none" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>`;
}

function iconChevronDown(){
  return `<svg viewBox="0 0 24 24" fill="none" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>`;
}

function iconColorBucket(){
  return `<svg viewBox="0 0 24 24" fill="none" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M4 13.5 12.5 5l6.5 6.5-8.5 8.5a2.1 2.1 0 0 1-3 0L4 16.5a2.1 2.1 0 0 1 0-3Z"/><path d="M9 4l8 8"/><path d="M19 16.5s2 2.2 2 3.4A2 2 0 0 1 17 20c0-1.3 2-3.5 2-3.5Z"/></svg>`;
}

function iconPalette(){
  return `<svg viewBox="0 0 24 24" fill="none" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a9 9 0 0 0 0 18h1.5a1.8 1.8 0 0 0 1.1-3.2 1.8 1.8 0 0 1 1.1-3.2H18a6 6 0 0 0 0-12h-6Z"/><circle cx="7.5" cy="10" r="1"/><circle cx="10" cy="6.8" r="1"/><circle cx="14" cy="6.8" r="1"/><circle cx="16.5" cy="10" r="1"/></svg>`;
}

function iconCalendar(){
  return `<svg viewBox="0 0 24 24" fill="none" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M7 3v4"/><path d="M17 3v4"/><path d="M4 8h16"/><rect x="4" y="5" width="16" height="16" rx="2"/><path d="M8 12h3"/><path d="M13 12h3"/><path d="M8 16h3"/></svg>`;
}

function iconRefresh(){
  return `<svg viewBox="0 0 24 24" fill="none" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 11a8 8 0 0 0-14.6-4.5L4 8"/><path d="M4 4v4h4"/><path d="M4 13a8 8 0 0 0 14.6 4.5L20 16"/><path d="M20 20v-4h-4"/></svg>`;
}

function iconTrash(){
  return `<svg viewBox="0 0 24 24" fill="none" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M6 7l1 14h10l1-14"/><path d="M9 7V4h6v3"/></svg>`;
}
  window.KalenderIcons = { iconEye, iconSettings, iconTrash, iconArrowUp, iconArrowDown, iconEdit, iconPlus, iconChevronRight, iconChevronDown, iconColorBucket, iconPalette, iconCalendar, iconRefresh };
})();
