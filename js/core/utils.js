/* Revision 079: zentrale, risikoarme Hilfsfunktionen
   Reine Utilities ohne Supabase-, Speicher- oder UI-Zustandslogik. */
function $(selector){
  return document.querySelector(selector);
}

function $$(selector){
  return Array.from(document.querySelectorAll(selector));
}

function makeId(prefix='id'){
  return prefix+'_'+Math.random().toString(36).slice(2)+'_'+Date.now().toString(36);
}

function escapeHtml(value){
  return String(value ?? '').replace(/[&<>\"]/g,function(match){
    return {'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[match];
  });
}

function shortText(value,max=30){
  const text=String(value ?? '').trim();
  return text.length>max ? text.slice(0,Math.max(0,max-1)).trimEnd()+'…' : text;
}

function fmtDate(date){
  const x=new Date(date);
  const y=x.getFullYear();
  const m=String(x.getMonth()+1).padStart(2,'0');
  const d=String(x.getDate()).padStart(2,'0');
  return `${y}-${m}-${d}`;
}

function addDays(date,days){
  const x=new Date(date);
  x.setDate(x.getDate()+days);
  return x;
}

function sameDay(a,b){
  return fmtDate(a)===fmtDate(b);
}

function deDate(date){
  return date.toLocaleDateString('de-DE',{weekday:'long',day:'2-digit',month:'2-digit',year:'numeric'});
}

function dayNum(date){
  return date.toLocaleDateString('de-DE',{weekday:'short',day:'2-digit',month:'2-digit'});
}

function dayHeaderLabel(date){
  return date.toLocaleDateString('de-DE',{weekday:'long',day:'numeric',month:'numeric',year:'numeric'});
}

function getISOWeek(date){
  const x=new Date(Date.UTC(date.getFullYear(),date.getMonth(),date.getDate()));
  const day=x.getUTCDay()||7;
  x.setUTCDate(x.getUTCDate()+4-day);
  const yearStart=new Date(Date.UTC(x.getUTCFullYear(),0,1));
  return Math.ceil((((x-yearStart)/86400000)+1)/7);
}

function recurrenceLabel(rule){
  return ({none:'Keine Wiederholung',weekly:'Wöchentlich',monthly:'Monatlich',yearly:'Jährlich'})[rule||'none']||'Keine Wiederholung';
}
