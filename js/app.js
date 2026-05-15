const {
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  DEFAULT_PROXY_URL,
  STORE_KEY: storeKey,
  DB_TABLES,
  BLANK_INITIAL_STATE: blankInitialState,
  DEFAULT_COLORS: defaultColors,
  PALETTE: palette
} = window.KalenderConfig;
const supabaseClient=window.supabase.createClient(SUPABASE_URL,SUPABASE_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
const { iconEye, iconSettings, iconTrash, iconArrowUp, iconArrowDown, iconEdit, iconPlus, iconChevronRight, iconChevronDown, iconColorBucket, iconPalette, iconCalendar, iconRefresh } = window.KalenderIcons;
const { parseICS, parseICalDate, normalizeICSUrl } = window.KalenderICS;
let currentUser=null;
let cloudReady=false;
let cloudSaveTimer=null;
let suppressCloudSave=false;
function getBlankState(){return structuredClone(blankInitialState);}
let state=getBlankState();
function ensureSettings(){
  state.theme=state.theme||'light';
  state.dayRows=Number(state.dayRows||1);
  state.startMode=state.startMode||'rolling';
  state.cornerStyle=state.cornerStyle||'rounded';
  state.colors=Object.assign({},defaultColors,state.colors||{});
  state.taskColumns=state.taskColumns&&state.taskColumns.length?state.taskColumns:[{id:'default',name:'Allgemein',color:state.colors.task||defaultColors.task,visible:true}];
  state.taskColumns.forEach(c=>{c.id=c.id||makeId('tc');c.name=c.name||'Allgemein';c.color=c.color||state.colors.task||defaultColors.task;if(c.visible===undefined)c.visible=true;});
  const defaultCol=state.taskColumns[0]?.id||'default';
  state.tasks=state.tasks||[];
  state.tasks.forEach(t=>{t.columnId=t.columnId||defaultCol;});
  state.calendars=state.calendars||[];
  state.calendars.forEach(c=>{
    c.ownEvents=c.ownEvents||[];
    c.events=c.events||[];
    c.links=c.links||[];
    c.links.forEach(l=>{l.id=l.id||makeId('ics');l.type=l.type||'ics';l.color=l.color||state.colors?.event||defaultColors.event;if(l.visible===undefined)l.visible=true;});
    (c.events||[]).forEach(e=>{if(!e.icsId){const match=c.links.find(l=>l.name===e.icsName||l.name===e.source);if(match){e.icsId=match.id;e.icsColor=match.color;e.icsName=match.name;}}});
    if(c.visible===undefined)c.visible=true;
  });
  state.panes=Math.max(1,state.calendars.filter(c=>c.visible!==false).length);
}
ensureSettings();
function resetVisibleStateAfterLogout(){
  clearTimeout(cloudSaveTimer);
  localStorage.removeItem(storeKey);
  suppressCloudSave=true;
  state=getBlankState();
  ensureSettings();
  render();
  suppressCloudSave=false;
  const diag=document.querySelector('#diagBox');
  if(diag)diag.textContent='Nicht angemeldet. Kalenderdaten sind ausgeblendet.';
}
function requireLogin(){
  if(currentUser)return true;
  toast('Bitte zuerst in der Cloud anmelden.');
  openCloudModal();
  return false;
}
function persist(){
  if(currentUser){
    localStorage.setItem(storeKey,JSON.stringify(stripRuntimeICSCache(state)));
  }else{
    localStorage.removeItem(storeKey);
  }
  if(cloudReady && currentUser && !suppressCloudSave) scheduleCloudSave();
}
function setCloudStatus(msg,type='warn'){
  const el=document.querySelector('#cloudStatus');
  if(!el)return;
  el.textContent=msg;
  el.className='cloud-status '+type;
}
function updateCloudUserLabel(){
  const el=document.querySelector('#cloudUserLabel');
  if(el)el.textContent=currentUser?('Angemeldet: '+currentUser.email):'Nicht angemeldet';
  const box=document.querySelector('#cloudModalStatusBox');
  if(box)box.textContent=currentUser?('Angemeldet: '+currentUser.email):'Nicht angemeldet';
}
function stripRuntimeICSCache(sourceState){
  const cloudState=structuredClone(sourceState||state);
  (cloudState.calendars||[]).forEach(cal=>{cal.events=[];});
  return cloudState;
}
function clearRuntimeICSCache(){
  (state.calendars||[]).forEach(cal=>{cal.events=[];});
}
function hasICSLinks(){
  return (state.calendars||[]).some(cal=>(cal.links||[]).some(l=>l.type!=='own'&&l.url));
}
function scheduleInitialICSSync(delay=700){
  if(!currentUser||!hasICSLinks())return;
  setTimeout(()=>{if(currentUser&&hasICSLinks())syncAllICS();},delay);
}
function scheduleCloudSave(){
  clearTimeout(cloudSaveTimer);
  cloudSaveTimer=setTimeout(saveStateToCloud,900);
}
async function saveStateToCloud(){
  if(!currentUser)return setCloudStatus('Nicht angemeldet. Online-Speicherung nicht möglich.','bad');
  const cloudState=stripRuntimeICSCache(state);
  const payload={user_id:currentUser.id,state:cloudState,updated_at:new Date().toISOString()};
  const {error}=await supabaseClient.from('app_state').upsert(payload,{onConflict:'user_id'});
  if(error){setCloudStatus('Online-Speichern fehlgeschlagen: '+error.message,'bad');return;}
  setCloudStatus('Online gespeichert: '+new Date().toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'}),'ok');
}
async function loadStateFromCloud(){
  if(!currentUser)return setCloudStatus('Nicht angemeldet. Online-Laden nicht möglich.','bad');
  const {data,error}=await supabaseClient.from('app_state').select('state,updated_at').eq('user_id',currentUser.id).maybeSingle();
  if(error){setCloudStatus('Online-Laden fehlgeschlagen: '+error.message,'bad');return;}
  if(!data || !data.state){
    suppressCloudSave=true;
    state=getBlankState();
    ensureSettings();
    render();
    suppressCloudSave=false;
    setCloudStatus('Noch kein Online-Stand vorhanden. Leerer Startzustand geladen.','warn');
    return;
  }
  suppressCloudSave=true;
  state=data.state;
  ensureSettings();
  clearRuntimeICSCache();
  render();
  setupAutoSync();
  suppressCloudSave=false;
  localStorage.setItem(storeKey,JSON.stringify(stripRuntimeICSCache(state)));
  setCloudStatus('Online-Daten geladen. Stand: '+new Date(data.updated_at).toLocaleString('de-DE'),'ok');
  scheduleInitialICSSync(900);
}
async function initCloud(){
  const {data}=await supabaseClient.auth.getUser();
  currentUser=data?.user||null;
  cloudReady=!!currentUser;
  updateCloudUserLabel();
  if(currentUser){
    setCloudStatus('Cloud verbunden. Lade Online-Daten...','ok');
    await loadStateFromCloud();
  }else{
    resetVisibleStateAfterLogout();
    setCloudStatus('Nicht angemeldet. Kalenderdaten sind ausgeblendet.','warn');setTimeout(openCloudModal,150);
  }
}
async function cloudLogin(){
  const email=document.querySelector('#cloudEmail')?.value.trim();
  const password=document.querySelector('#cloudPassword')?.value;
  if(!email||!password)return setCloudStatus('E-Mail und Passwort eintragen.','bad');
  const {data,error}=await supabaseClient.auth.signInWithPassword({email,password});
  if(error)return setCloudStatus('Login fehlgeschlagen: '+error.message,'bad');
  currentUser=data.user;cloudReady=true;document.body.classList.remove('login-required');updateCloudUserLabel();setCloudStatus('Login erfolgreich. Lade Online-Daten...','ok');await loadStateFromCloud();closeModal();
}
async function cloudSignup(){
  const email=document.querySelector('#cloudEmail')?.value.trim();
  const password=document.querySelector('#cloudPassword')?.value;
  if(!email||!password)return setCloudStatus('E-Mail und Passwort eintragen.','bad');
  const {data,error}=await supabaseClient.auth.signUp({email,password});
  if(error)return setCloudStatus('Registrierung fehlgeschlagen: '+error.message,'bad');
  currentUser=data.user||null;
  if(currentUser){cloudReady=true;document.body.classList.remove('login-required');updateCloudUserLabel();await saveStateToCloud();setCloudStatus('Registriert und Online-Stand angelegt.','ok');closeModal();}
  else setCloudStatus('Registrierung erstellt. Prüfe ggf. deine E-Mail zur Bestätigung.','warn');
}
async function cloudLogout(){
  await supabaseClient.auth.signOut();
  currentUser=null;
  cloudReady=false;
  updateCloudUserLabel();
  resetVisibleStateAfterLogout();
  setCloudStatus('Abgemeldet. Kalenderdaten wurden aus dieser Ansicht entfernt.','warn');document.body.classList.add('login-required');openCloudModal();
}
function parseRRule(rrule){const out={};String(rrule||'').split(';').forEach(part=>{const [k,v]=part.split('=');if(k)out[k.toUpperCase()]=v;});return out;}
function parseUntil(v){if(!v)return null;const p=parseICalDate(v.replace(/Z$/,'Z'));return p?new Date(p.iso):null;}
function recurrenceMatches(e,date){
  const start=new Date(e.start);if(isNaN(start))return false;
  const sd=new Date(start);sd.setHours(0,0,0,0);const td=new Date(date);td.setHours(0,0,0,0);if(td<sd)return false;
  if(e.rrule){
    const r=parseRRule(e.rrule);const freq=(r.FREQ||'').toUpperCase();const interval=Math.max(1,Number(r.INTERVAL||1));const until=parseUntil(r.UNTIL);if(until&&td>until)return false;
    const diffDays=Math.round((td-sd)/86400000);
    if(r.COUNT){
      const count=Number(r.COUNT);let approx=0;
      if(freq==='DAILY')approx=Math.floor(diffDays/interval)+1;
      if(freq==='WEEKLY')approx=Math.floor(diffDays/(7*interval))+1;
      if(freq==='MONTHLY')approx=(td.getFullYear()-sd.getFullYear())*12+(td.getMonth()-sd.getMonth())+1;
      if(freq==='YEARLY')approx=td.getFullYear()-sd.getFullYear()+1;
      if(approx>count)return false;
    }
    if(freq==='DAILY')return diffDays%interval===0;
    if(freq==='WEEKLY'){
      if(diffDays%(7*interval)!==0 && !r.BYDAY)return false;
      if(r.BYDAY){const map=['SU','MO','TU','WE','TH','FR','SA'];if(!r.BYDAY.split(',').includes(map[td.getDay()]))return false;return Math.floor(diffDays/7)%interval===0;}
      return true;
    }
    if(freq==='MONTHLY'){const months=(td.getFullYear()-sd.getFullYear())*12+(td.getMonth()-sd.getMonth());return months%interval===0&&td.getDate()===sd.getDate();}
    if(freq==='YEARLY'){const years=td.getFullYear()-sd.getFullYear();return years%interval===0&&td.getDate()===sd.getDate()&&td.getMonth()===sd.getMonth();}
    return fmtDate(sd)===fmtDate(td);
  }
  const r=e.recurrence||'none';
  if(r==='none'){if(e.end){const ed=new Date(e.end);ed.setHours(0,0,0,0);if(e.allDay)return td>=sd&&td<ed;return td>=sd&&td<=ed;}return fmtDate(sd)===fmtDate(td);}const diffDays=Math.round((td-sd)/86400000);
  if(r==='weekly')return diffDays%7===0;if(r==='monthly')return td.getDate()===sd.getDate();if(r==='yearly')return td.getDate()===sd.getDate()&&td.getMonth()===sd.getMonth();return false;
}
function eventOccurrenceForDate(e,date){if(!recurrenceMatches(e,date))return null;if((!e.rrule)&&((e.recurrence||'none')==='none')&&e.end){const out=Object.assign({},e,{_occurrenceDate:fmtDate(date)});return out;}const startBase=new Date(e.start);const endBase=e.end?new Date(e.end):null;const target=new Date(date);const start=new Date(target.getFullYear(),target.getMonth(),target.getDate(),startBase.getHours(),startBase.getMinutes(),startBase.getSeconds());let end=null;if(endBase&&!isNaN(endBase)){const duration=endBase-startBase;end=new Date(start.getTime()+duration);}return Object.assign({},e,{start:start.toISOString(),end:end?end.toISOString():null,_occurrenceDate:fmtDate(date)});} 
function toast(msg){const t=$('#toast');t.textContent=msg;t.style.display='block';clearTimeout(window.__toast);window.__toast=setTimeout(()=>t.style.display='none',4200)}
function visibleCalendars(){return state.calendars.map((c,i)=>({cal:c,idx:i})).filter(x=>x.cal.visible!==false);}
function applyAppearance(){ensureSettings();document.body.classList.toggle('light',state.theme==='light');document.body.classList.toggle('sharp-corners',state.cornerStyle==='sharp');document.documentElement.style.setProperty('--eventColor',state.colors.event);document.documentElement.style.setProperty('--taskColor',state.colors.task);document.documentElement.style.setProperty('--overdueColor',state.colors.overdue);document.documentElement.style.setProperty('--longColor',state.colors.long);}
function render(){ensureSettings();applyAppearance();state.panes=state.calendars.filter(c=>c.visible!==false).length||1;document.documentElement.style.setProperty('--days',state.days);document.documentElement.style.setProperty('--daycols',Math.ceil(state.days/(state.dayRows||1)));document.documentElement.style.setProperty('--calpanes',state.panes);if($('#daysSelect'))$('#daysSelect').value=state.days;if($('#rowsSelect'))$('#rowsSelect').value=String(state.dayRows||1);if($('#startModeSelect'))$('#startModeSelect').value=state.startMode||'rolling';if($('#syncInterval'))$('#syncInterval').value=String(state.syncInterval??15);if($('#proxyUrl'))$('#proxyUrl').value=currentUser?(state.proxyUrl||DEFAULT_PROXY_URL):'';renderViewModeSelect();renderCalendarConfig();renderTaskColumnConfig();renderLongColumnConfig();renderTimeline();renderLong();persist();}
function moveCalendar(from,to){
  if(!requireLogin())return;
  if(to<0||to>=state.calendars.length||from===to)return;
  const [moved]=state.calendars.splice(from,1);
  state.calendars.splice(to,0,moved);
  render();
}
function moveTaskColumn(from,to){
  if(!requireLogin())return;
  if(to<0||to>=state.taskColumns.length||from===to)return;
  const [moved]=state.taskColumns.splice(from,1);
  state.taskColumns.splice(to,0,moved);
  render();
}
function renderTaskColumnConfig(){
  const root=$('#taskColumnConfig');
  if(!root)return;
  ensureSettings();
  root.innerHTML=state.taskColumns.map((col,idx)=>`<div class="taskcol-item ${col.visible===false?'hidden-col':''}" data-taskcol-index="${idx}"><div class="taskcol-main"><span class="ics-color-dot" style="background:${escapeHtml(col.color)}"></span><b lang="de" title="${escapeHtml(col.name)}">${escapeHtml(col.name)}</b></div><div class="taskcol-actions"><span class="order-stack"><button class="btn small ui-icon-btn order-btn" data-move-taskcol="${idx}:-1" title="Nach oben" ${idx===0?'disabled':''}>${iconArrowUp()}</button><button class="btn small ui-icon-btn order-btn" data-move-taskcol="${idx}:1" title="Nach unten" ${idx===state.taskColumns.length-1?'disabled':''}>${iconArrowDown()}</button></span><button class="btn small ui-icon-btn visibility-btn" data-toggle-taskcol="${idx}" title="${col.visible===false?'Einblenden':'Ausblenden'}">${iconEye(col.visible!==false)}</button><button class="btn small ui-icon-btn" data-edit-taskcol="${idx}" title="Spalte bearbeiten">${iconSettings()}</button><button class="btn small ui-icon-btn trash-unified" data-delete-taskcol="${idx}" title="Spalte löschen">${iconTrash()}</button></div></div>`).join('')+`<div class="add-calendar-box"><div><b>Tagestask-Gruppe hinzufügen</b><div class="hint">Unterteilung für Tagestasks, z. B. Geschäftlich, Arbeit, Mannschaft.</div></div><button class="btn primary small" id="addTaskColumnBtn">${iconPlus()} Spalte</button></div>`;
  $$('[data-toggle-taskcol]').forEach(b=>b.onclick=()=>{if(!requireLogin())return;const c=state.taskColumns[Number(b.dataset.toggleTaskcol)];c.visible=c.visible===false;render();});
  $$('[data-move-taskcol]').forEach(b=>b.onclick=(ev)=>{ev.stopPropagation();const [i,d]=b.dataset.moveTaskcol.split(':').map(Number);moveTaskColumn(i,i+d);});
  $$('[data-edit-taskcol]').forEach(b=>b.onclick=()=>{if(requireLogin())openTaskColumnModal(Number(b.dataset.editTaskcol));});
  $$('[data-delete-taskcol]').forEach(b=>b.onclick=()=>{if(!requireLogin())return;const idx=Number(b.dataset.deleteTaskcol);if(state.taskColumns.length<=1)return toast('Mindestens eine Tagestask-Gruppe bleibt erhalten.');const col=state.taskColumns[idx];if(!confirm('Tagestask-Gruppe löschen? Bestehende Tasks werden in die erste verfügbare Spalte verschoben.'))return;const fallback=state.taskColumns.find((_,i)=>i!==idx)?.id||'default';state.tasks.forEach(t=>{if(t.columnId===col.id)t.columnId=fallback;});state.taskColumns.splice(idx,1);render();});
  const add=$('#addTaskColumnBtn');if(add)add.onclick=()=>{if(requireLogin())openTaskColumnModal(null);};
}
function openTaskColumnModal(idx){
  const isNew=idx===null||idx===undefined;
  const col=isNew?{name:'',color:state.colors.task||defaultColors.task,visible:true}:state.taskColumns[idx];
  const current=col.color||state.colors.task;
  openModal(isNew?'Tagestask-Gruppe hinzufügen':'Tagestask-Gruppe bearbeiten',`<input id="mTaskColName" value="${escapeHtml(col.name||'')}" placeholder="Name, z. B. Geschäftlich"><div class="hint">Diese Gruppen unterteilen die Tagestasks innerhalb eines Tages.</div><div class="color-palette" data-taskcol-color-picker>${palette.map(c=>`<button type="button" class="color-choice ${c.toLowerCase()===String(current).toLowerCase()?'active':''}" data-color="${c}" style="background:${c}" title="${c}"></button>`).join('')}</div>`,()=>{const name=$('#mTaskColName').value.trim()||'Neue Spalte'; if(isNew)state.taskColumns.push({id:makeId('tc'),name,color:col.color||current,visible:true}); else col.name=name;});
  $$('[data-taskcol-color-picker] .color-choice').forEach(btn=>btn.onclick=()=>{col.color=btn.dataset.color; if(!isNew){const name=$('#mTaskColName')?.value.trim(); if(name)col.name=name; persist();render();closeModal();}});
}

function renderTimeline(){const root=$('#timeline');root.innerHTML='';let start=addDays(new Date(new Date().setHours(0,0,0,0)),state.offset);if((state.startMode||'rolling')==='week'){const base=new Date();base.setHours(0,0,0,0);start=addDays(base,-((base.getDay()+6)%7)+state.offset);}if((state.startMode||'rolling')==='workweek'){const base=new Date();base.setHours(0,0,0,0);start=addDays(base,-((base.getDay()+6)%7)+state.offset);state.days=Math.min(state.days,5);}const end=addDays(start,state.days-1);$('#rangeLabel').textContent=`${deDate(start)} bis ${deDate(end)}`;for(let i=0;i<state.days;i++)root.appendChild(dayCard(addDays(start,i)));}function eventVisualHeight(e){
  if(e.allDay)return 46;
  const st=new Date(e.start), en=e.end?new Date(e.end):null;
  if(!en||isNaN(st)||isNaN(en))return 46;
  const mins=Math.max(15,(en-st)/60000);
  return Math.max(34,Math.min(96,30+mins*0.32));
}
function calendarLanes(date){const iso=fmtDate(date);const visible=visibleCalendars();return visible.map(({cal,idx:ci})=>{const visibleOwnIds=(cal.links||[]).filter(l=>l.type==='own'&&l.visible!==false).map(l=>l.id);const icsEvents=(cal.events||[]).map((e,ei)=>{const occ=eventOccurrenceForDate(e,date);return occ?Object.assign(occ,{_type:'ics',_cal:ci,_idx:ei}):null;}).filter(e=>{if(!e)return false;const l=(cal.links||[]).find(x=>x.id===e.icsId);return (!l||l.visible!==false);});const ownEvents=(cal.ownEvents||[]).map((e,ei)=>{const occ=eventOccurrenceForDate(e,date);return occ?Object.assign(occ,{_type:'own',_cal:ci,_idx:ei}):null;}).filter(e=>e&&visibleOwnIds.includes(e.sourceId));const events=[...icsEvents,...ownEvents].sort((a,b)=>new Date(a.start)-new Date(b.start));const ownSources=(cal.links||[]).filter(l=>l.type==='own'&&l.visible!==false);return `<div class="lane"><div class="lane-title" style="display:flex;align-items:center;gap:8px"><span>${escapeHtml(cal.name)}</span>${ownSources.length?`<button class="btn small own-event-btn plus-only" data-add-own-event="${ci}:${iso}" title="Eigenen Termin hinzufügen">+</button>`:''}</div>${events.length?events.map(e=>{const tp=eventTimeParts(e);const ref=e._type==='own'?`${e._type}:${e._cal}:${e._idx}:${iso}`:`${e._type}:${e._cal}:${e._idx}:${iso}`;const recur=(e.recurrence&&e.recurrence!=='none')?` · ${recurrenceLabel(e.recurrence)}`:(e.rrule?` · Wiederholung`:'');const cancelled=(String(e.status||'').toUpperCase()==='CANCELLED');const label=cancelled?' · Abgesagt':'';const h=eventVisualHeight(e);return `<div class="card event ${cancelled?'cancelled':''}" data-event-ref="${ref}" data-ics-color="1" style="border-left-color:${escapeHtml(e.icsColor||state.colors.event)}!important;min-height:${h}px;padding-top:${h<42?'7':'11'}px;padding-bottom:${h<42?'7':'11'}px" title="${escapeHtml(e.summary)}"><div class="event-row"><div class="event-timebox"><span>${escapeHtml(tp.start)}</span><span>${escapeHtml(tp.end)}</span></div><div class="event-title"><b>${escapeHtml(shortText(e.summary+(cancelled?' (abgesagt)':''),30))}</b><small>${escapeHtml(shortText((e.icsName||e.source||cal.name)+recur+label,34))}</small></div></div></div>`}).join(''):'<div class="empty">Keine Einträge.</div>'}</div>`;}).join('');}
function eventTimeParts(e){if(e.allDay)return {start:'Ganz-',end:'tägig'};const s=new Date(e.start);const end=e.end?new Date(e.end):null;const f=d=>d.toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'});if(isNaN(s))return {start:'',end:''};return {start:f(s),end:(end&&!isNaN(end))?f(end):''};}
function eventTime(e){if(e.allDay)return 'Ganztägig';const s=new Date(e.start);const end=e.end?new Date(e.end):null;const f=d=>d.toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'});return isNaN(s)?'':(end&&!isNaN(end)?`${f(s)}–${f(end)}`:f(s));}

function taskCardHtml(t,overdue=false,completedView=false){
  const col=(state.taskColumns||[]).find(c=>c.id===t.columnId)||state.taskColumns?.[0]||{name:'Allgemein',color:state.colors.task};
  const meta=completedView?`Erledigt am ${t.completedDate||''}`:(t.note||'Soll: '+t.date);
  if(completedView){
    return `<div class="card task task-card-compact completed-task-card" data-task-ref="task:${t.id}" style="border-left-color:${escapeHtml(col.color||state.colors.task)}!important"><div class="task-row"><input type="checkbox" checked data-toggle-task="${t.id}"><div><span class="completed-title" title="${escapeHtml(t.title)}">${escapeHtml(shortText(t.title,34))}</span><span class="completed-meta">${escapeHtml(meta)}</span></div><button class="kebab" data-delete-task="${t.id}">×</button></div></div>`;
  }
  return `<div class="card task task-card-compact ${overdue?'overdue':''}" data-task-ref="task:${t.id}" style="border-left-color:${escapeHtml(overdue?state.colors.overdue:(col.color||state.colors.task))}!important"><div class="task-row"><input type="checkbox" ${t.done?'checked':''} data-toggle-task="${t.id}"><div><b title="${escapeHtml(t.title)}">${escapeHtml(shortText(t.title,32))}</b><small title="${escapeHtml(meta)}">${escapeHtml(shortText(meta,38))}</small></div><button class="kebab" data-delete-task="${t.id}">×</button></div></div>`;
}
function taskColumnsList(list){
  ensureSettings();
  const visibleCols=(state.taskColumns||[]).filter(c=>c.visible!==false);
  if(!visibleCols.length)return '<div class="empty">Keine sichtbaren Tagestask-Gruppen.</div>';
  return `<div class="task-columns">${visibleCols.map(col=>{const tasks=list.filter(t=>(t.columnId||state.taskColumns[0].id)===col.id);return `<div class="task-column-lane"><div class="task-column-title"><span class="task-column-dot" style="background:${escapeHtml(col.color)}"></span><span lang="de">${escapeHtml(col.name)}</span></div>${tasks.length?tasks.map(t=>taskCardHtml(t,false,false)).join(''):'<div class="empty">Keine Einträge.</div>'}</div>`}).join('')}</div>`;
}
function completedDoneList(tasks,longs){
  const a=(tasks||[]).map(t=>taskCardHtml(t,false,true)).join('');
  const b=(longs||[]).map(t=>`<div class="card completed-long completed-task-card" data-task-ref="long:${t.id}"><div><span class="completed-title">${escapeHtml(shortText(t.title,34))}</span><span class="completed-meta">Langfristiger Task erledigt am ${escapeHtml(t.completedDate)}</span></div></div>`).join('');
  return `<div class="completed-grid">${a}${b}</div>`;
}function taskList(list,overdue=false){if(!list.length)return'<div class="empty">Keine Einträge.</div>';return list.map(t=>taskCardHtml(t,overdue,false)).join('');}function closeModal(){if(document.body.classList.contains('login-required')&&!currentUser)return;const md=document.querySelector('#deleteModeBtnAction');if(md)md.remove();$('#modalBackdrop').style.display='none';$('#saveModal').style.display='';$('#modalContent').onkeydown=null;} function openModal(title,html,onSave){$('#saveModal').style.display='';$('#modalTitle').textContent=title;$('#modalContent').innerHTML=html;$('#modalBackdrop').style.display='flex';setTimeout(()=>{const focusEl=$('#modalContent input:not([disabled]):not([readonly]), #modalContent textarea:not([disabled]):not([readonly]), #modalContent select:not([disabled])');if(focusEl){focusEl.focus();if(focusEl.select&&focusEl.tagName==='INPUT')focusEl.select();}},0);const doSave=()=>{onSave();closeModal();render();};$('#saveModal').onclick=doSave;$('#modalContent').onkeydown=e=>{if(e.key==='Enter'&&e.target.tagName!=='TEXTAREA'){e.preventDefault();doSave();}else if(e.key==='Enter'&&e.ctrlKey){e.preventDefault();doSave();}};} $('#cancelModal').onclick=closeModal;$('#modalBackdrop').onclick=e=>{if(e.target.id==='modalBackdrop')closeModal()};
function openAddCalendarModal(){if(!requireLogin())return;openModal('Kalender hinzufügen',`<input id="mNewCalName" placeholder="Kalendername, z. B. Geschäftskalender"><div class="hint">Der Kalender wird direkt sichtbar angelegt. Danach kannst du mehrere ICS-Links hinzufügen oder ihn ausblenden.</div>`,()=>{const name=$('#mNewCalName').value.trim()||`Kalender ${state.calendars.length+1}`;state.calendars.push({name,links:[],events:[],ownEvents:[],status:'Noch kein ICS-Link hinterlegt.',visible:true});});}
function openSourceChoiceModal(pane){
  if(!requireLogin())return;
  $('#modalTitle').textContent='Kalenderquelle hinzufügen';
  $('#modalContent').innerHTML=`<div class="option-btns"><button class="option-card" id="chooseICS"><b>ICS-Kalender</b><span class="hint">Externen Kalender per ICS-Link einbinden.</span></button><button class="option-card" id="chooseOwn"><b>Eigener Kalender</b><span class="hint">Termine direkt in dieser Oberfläche erstellen und löschen.</span></button></div>`;
  $('#modalBackdrop').style.display='flex';
  $('#saveModal').style.display='none';
  $('#chooseICS').onclick=()=>{closeModal();openICSModal(pane);};
  $('#chooseOwn').onclick=()=>{closeModal();openCreateOwnSourceModal(pane);};
}
function openCreateOwnSourceModal(pane){
  if(!requireLogin())return;
  openModal(`Eigenen Kalender hinzufügen · ${state.calendars[pane].name}`,`<input id="mOwnName" placeholder="Name, z. B. Eigene Termine"><div class="hint">Eigene Kalender enthalten Termine, die du hier manuell einträgst. Nur diese eigenen Termine sind löschbar.</div>`,()=>{
    const name=$('#mOwnName').value.trim()||'Eigener Kalender';
    state.calendars[pane].links.push({id:makeId('own'),type:'own',name,color:state.colors?.event||defaultColors.event,visible:true});
  });
}
function openOwnSourceModal(pane,idx){
  if(!requireLogin())return;
  const link=state.calendars[pane]?.links?.[idx];
  if(!link)return;
  const current=link.color||state.colors.event;
  openModal(`Eigener Kalender · ${escapeHtml(link.name)}`,`<input id="mOwnSourceName" value="${escapeHtml(link.name)}" placeholder="Name des eigenen Kalenders"><div class="hint">Hier kannst du den eigenen Kalender umbenennen und farblich markieren.</div><div class="color-palette" data-own-color-picker>${palette.map(c=>`<button type="button" class="color-choice ${c.toLowerCase()===String(current).toLowerCase()?'active':''}" data-color="${c}" style="background:${c}" title="${c}"></button>`).join('')}</div>`,()=>{
    const newName=$('#mOwnSourceName').value.trim();
    if(newName)link.name=newName;
    (state.calendars[pane].ownEvents||[]).forEach(e=>{if(e.sourceId===link.id){e.source=link.name;e.icsName=link.name;e.icsColor=link.color||state.colors.event;}});
  });
  $$('[data-own-color-picker] .color-choice').forEach(btn=>btn.onclick=()=>{
    link.color=btn.dataset.color;
    const newName=$('#mOwnSourceName')?.value.trim();
    if(newName)link.name=newName;
    (state.calendars[pane].ownEvents||[]).forEach(e=>{if(e.sourceId===link.id){e.source=link.name;e.icsName=link.name;e.icsColor=link.color;}});
    persist();render();closeModal();
  });
}
function openCalendarNameModal(pane){if(!requireLogin())return;const cal=state.calendars[pane];openModal('Kalendername ändern',`<input id="mCalName" value="${escapeHtml(cal.name)}" placeholder="z. B. Geschäftskalender"><div class="hint">Ändert nur den sichtbaren Namen in der Oberfläche. ICS-Links bleiben unverändert.</div>`,()=>{const v=$('#mCalName').value.trim();if(v)cal.name=v;});}
function openTaskModal(date=fmtDate(new Date())){if(!requireLogin())return;ensureSettings();openModal('Tagestask hinzufügen',`<input id="mTitle" placeholder="Aufgabe"><select id="mTaskColumn">${state.taskColumns.map(c=>`<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`).join('')}</select><input id="mDate" type="date" value="${date}"><textarea id="mNote" rows="3" placeholder="Notiz / Kontext"></textarea>`,()=>{const title=$('#mTitle').value.trim();if(!title)return toast('Aufgabe ohne Titel wurde nicht gespeichert.');state.tasks.push({id:crypto.randomUUID(),title,date:$('#mDate').value,done:false,note:$('#mNote').value.trim(),columnId:$('#mTaskColumn').value});});}function openICSModal(pane){if(!requireLogin())return;openModal(`ICS-Link hinzufügen · ${state.calendars[pane].name}`,`<input id="mName" placeholder="Name, z. B. Privat Kalender"><input id="mUrl" placeholder="webcal://... oder https://.../calendar.ics"><div class="hint">webcal:// wird automatisch in https:// umgewandelt. Der Link wird gespeichert, aber in der Oberfläche nicht ausgeschrieben.</div>`,async()=>{const name=$('#mName').value.trim()||'ICS Kalender';const url=normalizeICSUrl($('#mUrl').value.trim());if(!url)return toast('Kein ICS-Link gespeichert.');state.calendars[pane].links.push({id:makeId('ics'),type:'ics',name,url,color:state.colors?.event||defaultColors.event,visible:true});await loadICS(pane);});}
async function loadICS(pane){if(!requireLogin())return;const cal=state.calendars[pane];cal.events=[];cal.status='Lade ICS...';renderCalendarConfig();persist();let errors=[];for(const link of (cal.links||[])){if(link.type==='own'||!link.url)continue;try{const sourceUrl=normalizeICSUrl(link.url);const res=await fetch(buildICSFetchUrl(sourceUrl),{cache:'no-store'});if(!res.ok)throw new Error('HTTP '+res.status);const text=await res.text();if(!/BEGIN:VCALENDAR|BEGIN:VEVENT/i.test(text))throw new Error('Antwort ist keine ICS-Datei. Link/Freigabe/Proxy prüfen.');const parsed=parseICS(text,link.name).map(e=>Object.assign(e,{icsId:link.id,icsColor:link.color||state.colors.event,icsName:link.name}));cal.events.push(...parsed);if(!parsed.length)errors.push(`${link.name}: ICS geladen, aber keine Termine gefunden.`);}catch(e){errors.push(`${link.name}: ${e.message}`);}}cal.events=dedupeEvents(cal.events);const stamp=new Date().toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'});cal.status=errors.length?`${cal.events.length} Termine geladen. Fehler: ${errors.join(' | ')}. Zuletzt: ${stamp}`:`${cal.events.length} Termine geladen. Zuletzt: ${stamp}`;$('#diagBox').textContent=cal.status;persist();}
function dedupeEvents(events){const map=new Map();(events||[]).forEach(e=>{const norm=v=>String(v||'').trim().toLowerCase();const key=[e.icsId||'',norm(e.summary),e.start||'',e.end||''].join('|');const old=map.get(key);if(!old||(!old.rrule&&e.rrule))map.set(key,e);});return Array.from(map.values());}
function buildICSFetchUrl(url){let base=(state.proxyUrl||DEFAULT_PROXY_URL).trim();if(!base)return url;if(!/[?&]url=$/.test(base)){base=base.replace(/\/+$/,'')+'/?url=';}return base+encodeURIComponent(url);}
async function syncAllICS(){if(!requireLogin())return;const total=state.calendars.reduce((s,c)=>s+(c.links?.length||0),0);if(!total){toast('Keine ICS-Links hinterlegt.');return;}toast('Synchronisierung gestartet...');for(let i=0;i<state.calendars.length;i++)await loadICS(i);render();toast('ICS-Synchronisierung abgeschlossen.');}


function openOwnEventModal(pane,date=fmtDate(new Date())){
  if(!requireLogin())return;
  const cal=state.calendars[pane];
  const ownSources=(cal.links||[]).filter(l=>l.type==='own'&&l.visible!==false);
  if(!ownSources.length)return toast('Kein eigener Kalender sichtbar. Füge zuerst einen eigenen Kalender hinzu.');
  openModal(`Termin hinzufügen · ${escapeHtml(cal.name)}`,`<input id="mEventTitle" placeholder="Titel des Termins"><select id="mEventSource">${ownSources.map(l=>`<option value="${escapeHtml(l.id)}">${escapeHtml(l.name)}</option>`).join('')}</select><input id="mEventLocation" placeholder="Ort"><div class="field"><label>Datum</label><div class="date-row"><input id="mEventDate" type="date" value="${date}"></div></div><div class="field"><label>Wiederholung</label><select id="mEventRecurrence"><option value="none">Keine Wiederholung</option><option value="weekly">Wöchentlich</option><option value="monthly">Monatlich</option><option value="yearly">Jährlich</option></select></div><div class="field"><label>Ganztägig</label><select id="mEventAllDay"><option value="false">Nein</option><option value="true">Ja</option></select></div><div class="field"><label>Startzeit</label><input id="mEventStart" type="time" value="09:00"></div><div class="field"><label>Endzeit</label><input id="mEventEnd" type="time" value="10:00"></div><input id="mEventTravel" placeholder="Wegzeit, z. B. 20 Min."><textarea id="mEventDescription" rows="4" placeholder="Details / Notizen"></textarea>`,()=>{
    const title=$('#mEventTitle').value.trim();
    if(!title)return toast('Termin ohne Titel wurde nicht gespeichert.');
    const sourceId=$('#mEventSource').value;
    const src=(cal.links||[]).find(l=>l.id===sourceId);
    const d=$('#mEventDate').value||date;
    const allDay=$('#mEventAllDay').value==='true';
    const recurrence=$('#mEventRecurrence').value||'none';
    const st=$('#mEventStart').value||'00:00';
    const en=$('#mEventEnd').value||st;
    const start=allDay?new Date(d+'T00:00:00'):new Date(d+'T'+st+':00');
    const end=allDay?new Date(d+'T23:59:00'):new Date(d+'T'+en+':00');
    cal.ownEvents=cal.ownEvents||[];
    cal.ownEvents.push({id:makeId('evt'),sourceId,summary:title,location:$('#mEventLocation').value.trim(),start:start.toISOString(),end:end.toISOString(),allDay,recurrence,source:src?.name||cal.name,icsName:src?.name||cal.name,icsColor:src?.color||state.colors.event,travelTime:$('#mEventTravel').value.trim(),description:$('#mEventDescription').value.trim(),manual:true});
  });
}
function openEventDetailModal(ref){
  if(!requireLogin())return;
  const [type,calIdx,evtIdx,occIso]=ref.split(':');
  const cal=state.calendars[Number(calIdx)];
  let e=type==='own'?(cal.ownEvents||[])[Number(evtIdx)]:(cal.events||[])[Number(evtIdx)];
  if(occIso){e=eventOccurrenceForDate(e,new Date(occIso+'T00:00:00'))||e;}
  if(!e)return;
  const tp=eventTimeParts(e);
  const repeat=type==='own'?recurrenceLabel(e.recurrence):(e.rrule?('ICS-Wiederholung: '+e.rrule):'—');
  const cancelled=String(e.status||'').toUpperCase()==='CANCELLED';
  const rows=[['Titel',e.summary||''],['Kalender',cal.name||e.source||''],['Quelle',e.manual?'Eigener Termin':(e.source||'ICS')],['Status',cancelled?'Abgesagt':'Aktiv'],['Datum',deDate(new Date(e.start))],['Zeit',e.allDay?'Ganztägig':`${tp.start}${tp.end?' – '+tp.end:''}`],['Ort',e.location||''],['Wiederholung',repeat],['Wegzeit',e.travelTime||''],['Link',e.url||'']];
  const desc=e.description||'';
  $('#modalTitle').textContent='Termindetails';
  $('#modalContent').innerHTML=`<div class="event-detail-grid">${rows.map(([k,v])=>`<b>${escapeHtml(k)}</b><div>${escapeHtml(v||'—')}</div>`).join('')}<b>Details</b><div>${desc?`<div id="detailLongText" class="detail-long">${escapeHtml(desc)}</div><button class="btn small more-btn" id="toggleDetailLong" type="button">Mehr anzeigen</button>`:'—'}</div></div>${type==='own'?'<button class="btn event-delete-btn" id="deleteOwnEvent">Eigenen Termin / Serie löschen</button>':'<div class="hint">ICS-Termine sind nur lesbar und können hier nicht gelöscht werden.</div>'}`;
  $('#modalBackdrop').style.display='flex';
  $('#saveModal').style.display='none';
  const more=$('#toggleDetailLong');if(more)more.onclick=()=>{const box=$('#detailLongText');box.classList.toggle('expanded');more.textContent=box.classList.contains('expanded')?'Weniger anzeigen':'Mehr anzeigen';};
  const del=$('#deleteOwnEvent');
  if(del)del.onclick=()=>{if(confirm('Eigenen Termin / Serie löschen?')){cal.ownEvents.splice(Number(evtIdx),1);closeModal();render();}};
}


function openICSSettingsModal(pane,idx){
  const link=state.calendars[pane]?.links?.[idx];
  if(!link)return;
  link.id=link.id||makeId('ics');
  const current=link.color||state.colors.event;
  openModal(`ICS-Einstellungen · ${escapeHtml(link.name)}`,`<input id="mIcsName" value="${escapeHtml(link.name)}" placeholder="Name des ICS-Kalenders"><input id="mIcsUrl" value="${escapeHtml(link.url||'')}" placeholder="ICS-Link"><div class="hint">Name, Link und Farbe gelten nur für diesen einzelnen ICS-Kalender. Wenn du den Link änderst, danach synchronisieren.</div><div class="color-palette" data-ics-color-picker>${palette.map(c=>`<button type="button" class="color-choice ${c.toLowerCase()===String(current).toLowerCase()?'active':''}" data-color="${c}" style="background:${c}" title="${c}"></button>`).join('')}</div>`,()=>{
    const newName=$('#mIcsName').value.trim();
    const newUrl=normalizeICSUrl($('#mIcsUrl').value.trim());
    if(newName)link.name=newName;
    if(newUrl)link.url=newUrl;
    (state.calendars[pane].events||[]).forEach(e=>{if(e.icsId===link.id){e.icsName=link.name;e.source=link.name;e.icsColor=link.color||state.colors.event;}});
    persist();render();
  });
  $$('[data-ics-color-picker] .color-choice').forEach(btn=>btn.onclick=()=>{
    link.color=btn.dataset.color;
    const newName=$('#mIcsName')?.value.trim();
    const newUrl=normalizeICSUrl($('#mIcsUrl')?.value.trim());
    if(newName)link.name=newName;
    if(newUrl)link.url=newUrl;
    (state.calendars[pane].events||[]).forEach(e=>{if(e.icsId===link.id){e.icsName=link.name;e.source=link.name;e.icsColor=link.color;}});
    persist();render();
    closeModal();
  });
}


function openCloudModal(){
  if(!currentUser)document.body.classList.add('login-required');
  $('#modalTitle').textContent='Cloud-Speicherung';
  $('#modalContent').innerHTML=`<div class="cloud-user-box" id="cloudModalStatusBox">${currentUser?'Angemeldet: '+escapeHtml(currentUser.email):'Nicht angemeldet'}</div><div class="hint">Login mit E-Mail und Passwort. Nach dem Login werden deine persönlichen Kalenderdaten automatisch aus Supabase geladen. Jede relevante Änderung wird im eingeloggten Zustand automatisch gespeichert. Beim Logout werden die Daten aus dieser Ansicht entfernt.</div><div class="cloud-modal-grid"><input id="cloudEmail" type="email" placeholder="E-Mail"><div class="password-row"><input id="cloudPassword" type="password" placeholder="Passwort"><button class="btn small ui-icon-btn password-eye" id="showPasswordBtn" type="button" title="Passwort anzeigen">${iconEye(false)}</button></div></div><div class="cloud-actions"><button class="btn primary" id="cloudLoginBtn" type="button">Login</button><button class="btn" id="cloudSignupBtn" type="button">Registrieren</button><button class="btn danger" id="cloudLogoutBtn" type="button">Logout</button></div><div id="cloudStatus" class="cloud-status warn">Cloud-Status wird hier angezeigt.</div>`;
  $('#modalBackdrop').style.display='flex';
  $('#saveModal').style.display='none';
  updateCloudUserLabel();
  setCloudStatus(currentUser?'Cloud verbunden. Änderungen werden automatisch gespeichert.':'Nicht angemeldet. Kalenderdaten sind ausgeblendet.',currentUser?'ok':'warn');
  let passwordVisible=false;$('#showPasswordBtn').onclick=()=>{passwordVisible=!passwordVisible;const p=$('#cloudPassword'); if(p)p.type=passwordVisible?'text':'password'; $('#showPasswordBtn').innerHTML=iconEye(passwordVisible); $('#showPasswordBtn').title=passwordVisible?'Passwort ausblenden':'Passwort anzeigen';};
  $('#cloudLoginBtn').onclick=cloudLogin;
  $('#cloudSignupBtn').onclick=cloudSignup;
  $('#cloudLogoutBtn').onclick=cloudLogout;
}function openLegendModal(){openModal('Legende',`<div class="legend-grid">
<div class="legend-row static-legend"><div class="legend-main"><div><b>Kalenderereignis</b><div class="hint">Die Farbe wird direkt am jeweiligen ICS- oder eigenen Kalender eingestellt.</div></div></div></div>
<div class="legend-row static-legend"><div class="legend-main"><div><b>Tagestask</b><div class="hint">Aufgaben mit konkretem Datum. Die Gruppierung erfolgt über Tagestask-Gruppen.</div></div></div></div>
<div class="legend-row static-legend"><div class="legend-main"><div><b>Überzogener Task</b><div class="hint">Offene Aufgaben und Projekt-Tasks aus vergangenen Tagen.</div></div></div></div>
<div class="legend-row static-legend"><div class="legend-main"><div><b>Langfristiger Task</b><div class="hint">Aufgaben ohne feste Tagesbindung. Die Zuordnung erfolgt über langfristige Gruppen.</div></div></div></div>
</div>`,()=>{persist();render();});}
let syncTimer=null;function setupAutoSync(){if(syncTimer)clearInterval(syncTimer);syncTimer=null;const hint=$('#syncHint')||$('#mSyncHint');if(!currentUser){if(hint)hint.textContent='Nicht angemeldet. Automatische Synchronisierung ist deaktiviert.';return;}state.fetchMode='proxy';state.proxyUrl=state.proxyUrl||DEFAULT_PROXY_URL;const m=Number(state.syncInterval||0);if(hint)hint.textContent=m?`Automatische Synchronisierung aktiv: alle ${m} Minuten. ICS-Links werden über den fest hinterlegten Proxy geladen.`:'Automatische Synchronisierung aus. Manuell über den Button aktualisieren.';if(m>0){syncTimer=setInterval(syncAllICS,m*60*1000);}}
let monthCursor=new Date();monthCursor.setDate(1);monthCursor.setHours(0,0,0,0);function openMonthModal(){monthCursor=new Date();monthCursor.setDate(1);monthCursor.setHours(0,0,0,0);$('#modalTitle').textContent='Monatsübersicht';$('#modalContent').innerHTML='<div id="monthView"></div>';$('#modalBackdrop').style.display='flex';$('#saveModal').style.display='none';renderMonthView();}
function collectSearchItems(){
  const items=[];
  (state.tasks||[]).forEach(t=>items.push({type:'Task',title:t.title||'',date:t.date||fmtDate(new Date()),meta:t.note||'Tagestask'}));
  (state.longterm||[]).forEach(t=>items.push({type:'Langfristig',title:t.title||'',date:t.createdDate||fmtDate(new Date()),meta:t.note||'Langfristiger Task'}));
  (state.calendars||[]).forEach(cal=>{
    [...(cal.events||[]),...(cal.ownEvents||[])].forEach(e=>items.push({type:'Termin',title:e.summary||'',date:fmtDate(new Date(e.start)),meta:(cal.name||'')+' · '+eventTime(e)}));
  });
  return items;
}
function openDateInTimeline(iso){const target=new Date(iso+'T00:00:00');const base=new Date();base.setHours(0,0,0,0);state.offset=Math.round((target-base)/86400000);closeModal();render();}
function setupGlobalSearch(){const input=$('#globalSearch'), box=$('#searchResults');if(!input||!box)return;input.oninput=()=>{const q=input.value.trim().toLowerCase();if(q.length<2){box.classList.remove('open');box.innerHTML='';return;}const hits=collectSearchItems().filter(x=>(x.title+' '+x.meta+' '+x.date).toLowerCase().includes(q)).slice(0,18);box.innerHTML=hits.length?hits.map((h,i)=>`<div class="search-hit" data-hit="${i}"><b>${escapeHtml(h.title||'Ohne Titel')}</b><small>${escapeHtml(h.type)} · ${escapeHtml(h.date)} · ${escapeHtml(shortText(h.meta,70))}</small></div>`).join(''):'<div class="search-hit"><small>Keine Treffer.</small></div>';box.classList.add('open');$$('[data-hit]').forEach(el=>el.onclick=()=>{const h=hits[Number(el.dataset.hit)];if(h){input.value='';box.classList.remove('open');openDateInTimeline(h.date);}});};document.addEventListener('click',ev=>{if(!ev.target.closest('.search-wrap'))box.classList.remove('open');});}


/* Rev 033: Funktionspatches ohne Eingriff in die ICS-Ladebasis */
function ensureRev033State(){
  state.longColumns=state.longColumns&&state.longColumns.length?state.longColumns:[{id:'long_default',name:'Allgemein',color:state.colors?.long||defaultColors.long,visible:true}];
  state.longColumns.forEach(c=>{c.id=c.id||makeId('lg');c.name=c.name||'Allgemein';c.color=c.color||state.colors?.long||defaultColors.long;if(c.visible===undefined)c.visible=true;});
  const fallback=state.longColumns[0]?.id||'long_default';
  state.longterm=state.longterm||[];
  state.longterm.forEach(t=>{t.columnId=t.columnId||fallback;});
  if(!state.viewModes||!Array.isArray(state.viewModes)||!state.viewModes.length){
    state.viewModes=[
      {id:'work',name:'Arbeitsmodus',calendarVisible:{},taskVisible:{},longVisible:{}},
      {id:'private',name:'Privater Modus',calendarVisible:{},taskVisible:{},longVisible:{}},
      {id:'holiday',name:'Urlaubsmodus',calendarVisible:{},taskVisible:{},longVisible:{}}
    ];
  }
}
const __oldEnsureSettings=ensureSettings;
ensureSettings=function(){__oldEnsureSettings();ensureRev033State();};function renderViewModeSelect(){
  ensureRev033State(); const sel=$('#viewModeSelect'); if(!sel)return;
  sel.innerHTML='<option value="">Kein Modus</option>'+state.viewModes.map(m=>`<option value="${escapeHtml(m.id)}">${escapeHtml(m.name)}</option>`).join('')+'<option value="__new__">+ Neuer Modus hinzufügen</option>';
  sel.value=state.activeViewMode||'';
  sel.onchange=()=>{
    if(sel.value==='__new__'){
      const name=prompt('Name des neuen Modus:', 'Neuer Modus');
      if(name){const m=snapshotCurrentVisibility(name.trim()||'Neuer Modus');state.viewModes.push(m);state.activeViewMode=m.id;openViewModeConfigModal(m.id);} else {render();}
      return;
    }
    if(sel.value){applyViewMode(sel.value);}else state.activeViewMode='';
    render();
  };
  const gear=$('#modeConfigBtn');
  if(gear) gear.onclick=()=>{
    if(!state.activeViewMode){toast('Bitte zuerst einen Ansichtsmodus auswählen oder neu anlegen.');return;}
    openViewModeConfigModal(state.activeViewMode);
  };
}
function modeCheckbox(label,checked,attrs,extraClass=''){return `<label class="mode-check ${extraClass}"><span title="${escapeHtml(label)}">${escapeHtml(label)}</span><input type="checkbox" ${checked?'checked':''} ${attrs}></label>`;}function openLongColumnModal(idx){
  const isNew=idx===null||idx===undefined; ensureRev033State();
  const col=isNew?{name:'',color:state.colors.long||defaultColors.long,visible:true}:state.longColumns[idx]; const current=col.color||state.colors.long;
  openModal(isNew?'Langfristige Gruppe hinzufügen':'Langfristige Gruppe bearbeiten',`<input id="mLongColName" value="${escapeHtml(col.name||'')}" placeholder="Name, z. B. Geschäftlich"><div class="color-palette" data-longcol-color-picker>${palette.map(c=>`<button type="button" class="color-choice ${c.toLowerCase()===String(current).toLowerCase()?'active':''}" data-color="${c}" style="background:${c}" title="${c}"></button>`).join('')}</div>`,()=>{const name=$('#mLongColName').value.trim()||'Neue Gruppe';if(isNew)state.longColumns.push({id:makeId('lg'),name,color:col.color||current,visible:true});else col.name=name;});
  $$('[data-longcol-color-picker] .color-choice').forEach(btn=>btn.onclick=()=>{col.color=btn.dataset.color;if(!isNew){const name=$('#mLongColName')?.value.trim();if(name)col.name=name;persist();render();closeModal();}});
}
function renderLong(){
  const root=$('#longTermList'); if(!root)return; ensureRev033State();
  const visible=(state.longColumns||[]).filter(c=>c.visible!==false);
  if(!state.longterm.length){root.innerHTML='<div class="empty">Keine langfristigen Aufgaben.</div>';return;}
  root.innerHTML=visible.map(col=>{const list=state.longterm.filter(t=>(t.columnId||state.longColumns[0].id)===col.id);return `<section class="long-group"><div class="long-group-title"><span class="ics-color-dot" style="background:${escapeHtml(col.color)}"></span>${escapeHtml(col.name)}</div><div class="long-group-grid">${list.length?list.map(t=>{const meta=t.completedDate?`Erledigt am ${t.completedDate}`:`Erstellt am ${t.createdDate||'unbekannt'}`;const note=t.note?`<span class="long-note" title="${escapeHtml(t.note)}">${escapeHtml(shortText(t.note,80))}</span>`:'';return `<div class="long-card ${t.done?'completed-task-card':''}" data-task-ref="long:${t.id}" style="border-left-color:${escapeHtml(col.color)}!important"><div class="task-row"><input type="checkbox" ${t.done?'checked':''} data-toggle-long="${t.id}"><div><span class="long-title" title="${escapeHtml(t.title)}">${escapeHtml(t.title)}</span><span class="long-meta">${escapeHtml(meta)}</span>${note}</div><button class="kebab" data-delete-long="${t.id}">×</button></div></div>`;}).join(''):'<div class="empty">Keine Einträge.</div>'}</div></section>`;}).join('');
  $$('[data-toggle-long]').forEach(c=>{c.onclick=ev=>ev.stopPropagation();c.onchange=(ev)=>{ev.stopPropagation();const t=state.longterm.find(x=>x.id===c.dataset.toggleLong);if(!requireLogin()){c.checked=!c.checked;return;}if(t){t.done=c.checked;t.completedDate=c.checked?fmtDate(new Date()):null;render();}}});
  $$('[data-delete-long]').forEach(b=>b.onclick=(ev)=>{ev.stopPropagation();if(!requireLogin())return;state.longterm=state.longterm.filter(x=>x.id!==b.dataset.deleteLong);render();});
  $$('#longTermList [data-task-ref]').forEach(card=>card.onclick=()=>openTaskDetailModal(card.dataset.taskRef));
}
function openLongModal(){
  if(!requireLogin())return; ensureRev033State();
  openModal('Langfristigen Task hinzufügen',`<input id="mTitle" placeholder="Langfristiger Task"><select id="mLongColumn">${state.longColumns.map(c=>`<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`).join('')}</select><textarea id="mNote" rows="3" placeholder="Notiz"></textarea>`,()=>{const title=$('#mTitle').value.trim();if(!title)return toast('Aufgabe ohne Titel wurde nicht gespeichert.');state.longterm.push({id:crypto.randomUUID(),title,done:false,note:$('#mNote').value.trim(),createdDate:fmtDate(new Date()),completedDate:null,columnId:$('#mLongColumn').value});});
}
function openTaskDetailModal(ref){
  if(!requireLogin())return; ensureRev033State(); const [type,id]=ref.split(':'); const isLong=type==='long'; const t=isLong?state.longterm.find(x=>x.id===id):state.tasks.find(x=>x.id===id); if(!t)return;
  $('#modalTitle').textContent=isLong?'Langfristigen Task bearbeiten':'Tagestask bearbeiten';
  $('#modalContent').innerHTML=`<div class="edit-grid"><label>Titel</label><input id="editTaskTitle" value="${escapeHtml(t.title||'')}">${isLong?`<label>Langfristige Gruppe</label><select id="editLongColumn">${state.longColumns.map(c=>`<option value="${escapeHtml(c.id)}" ${(t.columnId||state.longColumns[0].id)===c.id?'selected':''}>${escapeHtml(c.name)}</option>`).join('')}</select><label>Verschieben</label><select id="moveLongToTask"><option value="keep">Langfristiger Task bleiben</option><option value="today">In Tagestask für heute verschieben</option></select>`:`<label>Tagestask-Gruppe</label><select id="editTaskColumn">${state.taskColumns.map(c=>`<option value="${escapeHtml(c.id)}" ${(t.columnId||state.taskColumns[0].id)===c.id?'selected':''}>${escapeHtml(c.name)}</option>`).join('')}</select><label>Soll-Datum</label><input id="editTaskDate" type="date" value="${escapeHtml(t.date||fmtDate(new Date()))}"><label>Verschieben</label><select id="moveTaskToLong"><option value="keep">Tagestask bleiben</option><option value="long">In langfristige Tasks verschieben</option></select><label>Zielgruppe langfristig</label><select id="targetLongColumn">${state.longColumns.map(c=>`<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`).join('')}</select>`}<label>Status</label><select id="editTaskDone"><option value="false" ${!t.done?'selected':''}>Offen</option><option value="true" ${t.done?'selected':''}>Erledigt</option></select><label>Erledigt am</label><input id="editTaskCompleted" type="date" value="${escapeHtml(t.completedDate||'')}"><label>Notiz</label><textarea id="editTaskNote" rows="7">${escapeHtml(t.note||'')}</textarea></div>`;
  $('#modalBackdrop').style.display='flex'; $('#saveModal').style.display='';
  $('#saveModal').onclick=()=>{
    const title=$('#editTaskTitle').value.trim(); if(title)t.title=title; t.done=$('#editTaskDone').value==='true'; t.completedDate=$('#editTaskCompleted').value||null; if(t.done&&!t.completedDate)t.completedDate=fmtDate(new Date()); if(!t.done)t.completedDate=null; t.note=$('#editTaskNote').value.trim();
    if(isLong){
      t.columnId=$('#editLongColumn').value;
      if($('#moveLongToTask').value==='today'){state.tasks.push({id:crypto.randomUUID(),title:t.title,date:fmtDate(new Date()),done:t.done,note:t.note,columnId:state.taskColumns[0]?.id||'default',completedDate:t.completedDate});state.longterm=state.longterm.filter(x=>x.id!==t.id);}
    }else{
      if($('#moveTaskToLong').value==='long'){state.longterm.push({id:crypto.randomUUID(),title:t.title,done:t.done,note:t.note,createdDate:fmtDate(new Date()),completedDate:t.completedDate,columnId:$('#targetLongColumn').value});state.tasks=state.tasks.filter(x=>x.id!==t.id);}else{t.date=$('#editTaskDate').value||t.date;t.columnId=$('#editTaskColumn').value;}
    }
    closeModal();render();
  };
  $('#modalContent').onkeydown=e=>{if(e.key==='Enter'&&e.target.tagName!=='TEXTAREA'){e.preventDefault();$('#saveModal').click();}else if(e.key==='Enter'&&e.ctrlKey){e.preventDefault();$('#saveModal').click();}};
}
/* Rev 037: Frontend-State-Persistenz und UI-Logik ohne neue Supabase-Tabellen */
const __rev037EnsureSettings=ensureSettings;
ensureSettings=function(){
  __rev037EnsureSettings();
  state.sidebarCollapsed=!!state.sidebarCollapsed;
  state.configCollapsed=state.configCollapsed||{};
  state.sidebarAllCollapsed=!!state.sidebarAllCollapsed;
  (state.calendars||[]).forEach(c=>{
    if(c.collapsed===undefined)c.collapsed=true;
    c.links=c.links||[];
  });
};
function immediatePersist(){
  persist();
  if(cloudReady&&currentUser&&!suppressCloudSave){clearTimeout(cloudSaveTimer);saveStateToCloud();}
}
function moveLongColumn(from,to){
  if(!requireLogin())return;
  ensureRev033State();
  if(to<0||to>=state.longColumns.length||from===to)return;
  const [moved]=state.longColumns.splice(from,1);
  state.longColumns.splice(to,0,moved);
  render();
}
function setAllConfigBlocksCollapsed(collapsed){
  ensureSettings();
  state.sidebarAllCollapsed=!!collapsed;
  $$('.config-block').forEach(block=>{
    const key=block.dataset.configBlock;
    if(key)state.configCollapsed[key]=!!collapsed;
    block.classList.toggle('collapsed',!!collapsed);
    const chev=block.querySelector('.config-chevron');
    if(chev)chev.innerHTML=collapsed?iconChevronRight():iconChevronDown();
  });
  updateCollapseAllButton();
  immediatePersist();
}
function updateCollapseAllButton(){
  const btn=document.querySelector('#collapseAllConfigBtn');
  if(!btn)return;
  const all=$$('.config-block').every(b=>b.classList.contains('collapsed'));
  state.sidebarAllCollapsed=all;
  btn.innerHTML=(all?iconChevronDown():iconChevronRight())+' '+(all?'Alle ausklappen':'Alle einklappen');
  btn.title=all?'Alle Bereiche in der Seitenleiste ausklappen':'Alle Bereiche in der Seitenleiste einklappen';
}
function initConfigBlocks(){
  ensureSettings();
  // Rev040 Fix: globaler Einklapp-Button steht statisch oben in der Seitenleiste, nicht unter Ansicht konfigurieren.
  $$('.config-block').forEach(block=>{
    const key=block.dataset.configBlock;
    const collapsed=!!state.configCollapsed[key];
    block.classList.toggle('collapsed',collapsed);
    const chev=block.querySelector('.config-chevron');
    if(chev)chev.innerHTML=collapsed?iconChevronRight():iconChevronDown();
  });
  $$('.config-toggle').forEach(btn=>{btn.onclick=()=>{
    const block=btn.closest('.config-block');if(!block)return;
    block.classList.toggle('collapsed');
    const key=block.dataset.configBlock;if(key)state.configCollapsed[key]=block.classList.contains('collapsed');
    const chev=block.querySelector('.config-chevron');if(chev)chev.innerHTML=block.classList.contains('collapsed')?iconChevronRight():iconChevronDown();
    updateCollapseAllButton();
    immediatePersist();
  };});
  const allBtn=document.querySelector('#collapseAllConfigBtn');
  if(allBtn)allBtn.onclick=()=>setAllConfigBlocksCollapsed(!$$('.config-block').every(b=>b.classList.contains('collapsed')));
  updateCollapseAllButton();
}
function updateSidebarToggle(){const collapsed=!!state.sidebarCollapsed;document.body.classList.toggle('sidebar-collapsed',collapsed);const btn=document.querySelector('#sidebarToggleBtn');if(!btn)return;btn.innerHTML=`<span class="sidebar-toggle-tab">${collapsed?'›':'‹'}</span>`;btn.title=collapsed?'Seitenleiste aufklappen':'Seitenleiste einklappen';}
function initSidebarToggle(){ensureSettings();document.body.classList.toggle('sidebar-collapsed',!!state.sidebarCollapsed);updateSidebarToggle();const btn=document.querySelector('#sidebarToggleBtn');if(btn)btn.onclick=()=>{state.sidebarCollapsed=!state.sidebarCollapsed;updateSidebarToggle();immediatePersist();};}
function renderCalendarConfig(){
  const root=$('#calendarConfig');root.innerHTML='';ensureSettings();
  state.calendars.forEach((cal,i)=>{
    const visible=cal.visible!==false;const collapsed=cal.collapsed!==false;
    const div=document.createElement('div');div.className='calendar-pane'+(!visible?' hidden-cal':'')+(collapsed?' cal-collapsed':'');div.dataset.calIndex=i;
    const sources=cal.links.length?cal.links.map((l,idx)=>{const lv=l.visible!==false;const isOwn=l.type==='own';return `<div class="ics-item ${lv?'':'hidden-ics'}"><div class="ics-click" title="${isOwn?'Eigener Kalender':'ICS-Kalender'}"><b title="${escapeHtml(l.name)}"><span class="ics-color-dot" style="background:${escapeHtml(l.color||state.colors.event)}"></span>${escapeHtml(shortText(l.name,34))}</b><span>${isOwn?'Eigener Kalender':'ICS-Kalender aktiv'}</span></div><div class="ics-actions"><button class="btn small ui-icon-btn visibility-btn" data-toggle-ics="${i}:${idx}" title="${lv?'Ausblenden':'Einblenden'}">${iconEye(lv)}</button><button class="btn small ui-icon-btn" data-ics-settings="${i}:${idx}" title="${isOwn?'Eigenen Kalender einstellen':'ICS-Kalender einstellen'}">${iconSettings()}</button><button class="btn small ui-icon-btn trash-unified" data-del-ics="${i}:${idx}" title="Kalenderquelle entfernen">${iconTrash()}</button></div></div>`}).join(''):'<div class="empty">Noch keine Kalenderquelle.</div>';
    div.innerHTML=`<div class="pane-head"><div class="cal-title-line"><button class="cal-title-click" data-edit-cal="${i}" title="Kalendername ändern"><span class="pane-name">${escapeHtml(cal.name)}</span><span class="cal-edit-icon">${iconEdit()}</span></button></div><div class="pane-actions"><span class="order-stack"><button class="btn small ui-icon-btn order-btn" data-move-cal="${i}:-1" title="Nach oben" ${i===0?'disabled':''}>${iconArrowUp()}</button><button class="btn small ui-icon-btn order-btn" data-move-cal="${i}:1" title="Nach unten" ${i===state.calendars.length-1?'disabled':''}>${iconArrowDown()}</button></span><button class="btn small ui-icon-btn" data-collapse-cal="${i}" title="${collapsed?'Kalender aufklappen':'Kalender einklappen'}"><span class="cal-collapse-icon">${collapsed?iconChevronRight():iconChevronDown()}</span></button><button class="btn small ui-icon-btn visibility-btn ${visible?'':'hidden-state'}" data-toggle-cal="${i}" title="${visible?'Kalender ausblenden':'Kalender einblenden'}">${iconEye(visible)}</button><button class="btn small add-source-plus" data-add-source="${i}" title="Kalenderquelle hinzufügen">${iconPlus()}</button><button class="btn small ui-icon-btn trash-unified" data-delete-cal="${i}" title="Kalender löschen">${iconTrash()}</button></div></div><div class="calendar-source-wrap">${sources}</div><div class="status">${escapeHtml(cal.status||'')}</div>`;
    root.appendChild(div);
  });
  if(!state.calendars.length){const note=document.createElement('div');note.className='no-calendar-note';note.innerHTML='Noch kein Kalender angelegt. Lege unten einen Kalender an und füge danach einen oder mehrere ICS- oder eigene Kalender hinzu.';root.appendChild(note);}
  const add=document.createElement('div');add.className='add-calendar-box';add.innerHTML=`<div><b>Kalender hinzufügen</b><div class="hint">Neuen Kalenderbereich erstellen und anschließend Kalenderquellen hinterlegen.</div></div><button class="btn primary small" id="addCalendarBtn">${iconPlus()} Kalender</button>`;root.appendChild(add);
  $$('[data-collapse-cal]').forEach(b=>b.onclick=(ev)=>{ev.stopPropagation();if(!requireLogin())return;const i=Number(b.dataset.collapseCal);state.calendars[i].collapsed=state.calendars[i].collapsed===false;render();});
  $$('[data-toggle-cal]').forEach(b=>b.onclick=()=>{if(!requireLogin())return;const i=Number(b.dataset.toggleCal);state.calendars[i].visible=state.calendars[i].visible===false;render();});
  $$('[data-move-cal]').forEach(b=>b.onclick=(ev)=>{ev.stopPropagation();const [i,d]=b.dataset.moveCal.split(':').map(Number);moveCalendar(i,i+d);});
  $$('[data-toggle-ics]').forEach(b=>b.onclick=(ev)=>{ev.stopPropagation();if(!requireLogin())return;const [i,idx]=b.dataset.toggleIcs.split(':').map(Number);const l=state.calendars[i].links[idx];l.visible=l.visible===false;render();});
  $$('[data-edit-cal]').forEach(b=>b.onclick=()=>{if(requireLogin())openCalendarNameModal(Number(b.dataset.editCal));});
  $$('[data-add-source]').forEach(b=>b.onclick=()=>{if(requireLogin())openSourceChoiceModal(Number(b.dataset.addSource));});
  $$('[data-ics-settings]').forEach(b=>b.onclick=(ev)=>{ev.stopPropagation();const [i,idx]=b.dataset.icsSettings.split(':').map(Number);const link=state.calendars[i].links[idx];if(link?.type==='own')openOwnSourceModal(i,idx);else openICSSettingsModal(i,idx);});
  $$('[data-del-ics]').forEach(b=>b.onclick=()=>{const [i,idx]=b.dataset.delIcs.split(':').map(Number);const target=state.calendars[i].links[idx];if(target?.type==='own'){const count=(state.calendars[i].ownEvents||[]).filter(e=>e.sourceId===target.id).length;const ok=confirm(`Sind Sie sicher, dass Sie diesen eigenen Kalender löschen möchten?\n\nAlle darin erstellten Termine werden unwiderruflich gelöscht.\nBetroffene Termine: ${count}`);if(!ok)return;}else{const ok=confirm('Diese Kalenderquelle wirklich entfernen?');if(!ok)return;}const removed=state.calendars[i].links.splice(idx,1)[0];if(removed?.id){state.calendars[i].events=(state.calendars[i].events||[]).filter(e=>e.icsId!==removed.id);state.calendars[i].ownEvents=(state.calendars[i].ownEvents||[]).filter(e=>e.sourceId!==removed.id);}else{state.calendars[i].events=[];}state.calendars[i].status='Kalenderquelle entfernt.';render();});
  $$('[data-delete-cal]').forEach(b=>b.onclick=()=>{const i=Number(b.dataset.deleteCal);if(confirm('Kalender inklusive aller Quellen und eigenen Terminen löschen?')){state.calendars.splice(i,1);render();}});
  const addBtn=$('#addCalendarBtn');if(addBtn)addBtn.onclick=()=>{if(requireLogin())openAddCalendarModal();};
}
function renderLongColumnConfig(){
  const root=$('#longColumnConfig'); if(!root)return; ensureRev033State();
  root.innerHTML=state.longColumns.map((col,idx)=>`<div class="taskcol-item ${col.visible===false?'hidden-col':''}"><div class="taskcol-main"><span class="ics-color-dot" style="background:${escapeHtml(col.color)}"></span><b title="${escapeHtml(col.name)}">${escapeHtml(col.name)}</b></div><div class="taskcol-actions"><span class="order-stack"><button class="btn small ui-icon-btn order-btn" data-move-longcol="${idx}:-1" title="Nach oben" ${idx===0?'disabled':''}>${iconArrowUp()}</button><button class="btn small ui-icon-btn order-btn" data-move-longcol="${idx}:1" title="Nach unten" ${idx===state.longColumns.length-1?'disabled':''}>${iconArrowDown()}</button></span><button class="btn small ui-icon-btn visibility-btn" data-toggle-longcol="${idx}" title="${col.visible===false?'Einblenden':'Ausblenden'}">${iconEye(col.visible!==false)}</button><button class="btn small ui-icon-btn" data-edit-longcol="${idx}" title="Gruppe bearbeiten">${iconSettings()}</button><button class="btn small ui-icon-btn trash-unified" data-delete-longcol="${idx}" title="Gruppe löschen">${iconTrash()}</button></div></div>`).join('')+`<div class="add-calendar-box"><div><b>Langfristige Gruppe hinzufügen</b><div class="hint">Gruppen für langfristige Tasks, z. B. Allgemein, Geschäftlich.</div></div><button class="btn primary small" id="addLongColumnBtn">${iconPlus()} Gruppe</button></div>`;
  $$('[data-move-longcol]').forEach(b=>b.onclick=(ev)=>{ev.stopPropagation();const [i,d]=b.dataset.moveLongcol.split(':').map(Number);moveLongColumn(i,i+d);});
  $$('[data-toggle-longcol]').forEach(b=>b.onclick=()=>{if(!requireLogin())return;const c=state.longColumns[Number(b.dataset.toggleLongcol)];c.visible=c.visible===false;render();});
  $$('[data-edit-longcol]').forEach(b=>b.onclick=()=>{if(requireLogin())openLongColumnModal(Number(b.dataset.editLongcol));});
  $$('[data-delete-longcol]').forEach(b=>b.onclick=()=>{if(!requireLogin())return;const idx=Number(b.dataset.deleteLongcol);if(state.longColumns.length<=1)return toast('Mindestens eine langfristige Gruppe bleibt erhalten.');const col=state.longColumns[idx];if(!confirm('Langfristige Gruppe löschen? Bestehende Tasks werden in die erste verfügbare Gruppe verschoben.'))return;const fallback=state.longColumns.find((_,i)=>i!==idx)?.id;state.longterm.forEach(t=>{if(t.columnId===col.id)t.columnId=fallback;});state.longColumns.splice(idx,1);render();});
  const add=$('#addLongColumnBtn'); if(add)add.onclick=()=>{if(requireLogin())openLongColumnModal(null);};
}
function visibleTaskColumnIds(){return (state.taskColumns||[]).filter(c=>c.visible!==false).map(c=>c.id);}
function visibleLongColumnIds(){return (state.longColumns||[]).filter(c=>c.visible!==false).map(c=>c.id);}
function dayCard(date){
  const today=new Date();today.setHours(0,0,0,0);const iso=fmtDate(date);
  const openTasks=state.tasks.filter(t=>t.date===iso&&!t.done);
  const overdue=sameDay(date,today)?state.tasks.filter(t=>t.date<fmtDate(today)&&!t.done):[];
  const visibleTaskIds=visibleTaskColumnIds(); const visibleLongIds=visibleLongColumnIds();
  const completedTasks=state.tasks.filter(t=>t.done&&t.completedDate===iso&&visibleTaskIds.includes(t.columnId||state.taskColumns?.[0]?.id));
  const completedLong=state.longterm.filter(t=>t.done&&t.completedDate===iso&&visibleLongIds.includes(t.columnId||state.longColumns?.[0]?.id));
  const showCompleted=completedTasks.length||completedLong.length;
  const day=document.createElement('div');day.className='day'+(sameDay(date,today)?' today':'');
  day.innerHTML=`<div class="day-head"><div class="day-num"><span class="day-title-weekday">${escapeHtml(date.toLocaleDateString('de-DE',{weekday:'long'}))}</span><span class="day-title-date">${escapeHtml(date.toLocaleDateString('de-DE',{day:'2-digit',month:'2-digit',year:'numeric'}))}</span></div>${sameDay(date,today)?'<span class="badge">Aktueller Tag</span>':''}</div><div class="day-body"><div class="partition"><div class="part-head"><div class="part-title">1. Terminkalender</div></div><div class="split">${calendarLanes(date)}</div></div><div class="partition"><div class="part-head"><div class="part-title">2. Tagestasks</div><button class="btn small" data-task-date="${iso}">${iconPlus()} Hinzufügen</button></div>${taskColumnsList(openTasks)}</div>${sameDay(date,today)?`<div class="partition"><div class="part-head"><div class="part-title">3. Überzogene Tasks</div></div>${taskList(overdue,true)}</div>`:''}${showCompleted?`<div class="partition"><div class="part-head"><div class="part-title">${sameDay(date,today)?'4':'3'}. An diesem Tag erledigte Tasks</div></div>${completedDoneList(completedTasks,completedLong)}</div>`:''}</div>`;
  day.querySelector('[data-task-date]').onclick=()=>openTaskModal(iso);
  day.querySelectorAll('[data-toggle-task]').forEach(c=>{c.onclick=ev=>ev.stopPropagation();c.onchange=(ev)=>{ev.stopPropagation();const t=state.tasks.find(x=>x.id===c.dataset.toggleTask);if(!requireLogin()){c.checked=!c.checked;return;}if(t){t.done=c.checked;t.completedDate=c.checked?fmtDate(new Date()):null;render();}}});
  day.querySelectorAll('[data-delete-task]').forEach(b=>b.onclick=(ev)=>{ev.stopPropagation();if(!requireLogin())return;state.tasks=state.tasks.filter(x=>x.id!==b.dataset.deleteTask);render();});
  day.querySelectorAll('[data-task-ref]').forEach(card=>card.onclick=()=>openTaskDetailModal(card.dataset.taskRef));
  day.querySelectorAll('[data-add-own-event]').forEach(b=>b.onclick=(ev)=>{ev.stopPropagation();const [ci,iso]=b.dataset.addOwnEvent.split(':');openOwnEventModal(Number(ci),iso);});
  day.querySelectorAll('[data-event-ref]').forEach(card=>card.onclick=()=>openEventDetailModal(card.dataset.eventRef));
  return day;
}
function snapshotCurrentVisibility(name){
  const cal={}, ics={}, task={}, lng={};
  (state.calendars||[]).forEach((c,i)=>{cal[c.id||c.name||('cal_'+i)]=c.visible!==false;(c.links||[]).forEach(l=>ics[l.id||l.name]=l.visible!==false);});
  (state.taskColumns||[]).forEach(c=>task[c.id]=c.visible!==false);
  (state.longColumns||[]).forEach(c=>lng[c.id]=c.visible!==false);
  return {id:makeId('mode'),name,calendarVisible:cal,icsVisible:ics,taskVisible:task,longVisible:lng};
}
function applyViewMode(id){
  const mode=(state.viewModes||[]).find(m=>m.id===id); if(!mode)return;
  (state.calendars||[]).forEach((c,i)=>{const key=c.id||c.name||('cal_'+i); if(Object.prototype.hasOwnProperty.call(mode.calendarVisible||{},key))c.visible=!!mode.calendarVisible[key]; (c.links||[]).forEach(l=>{const lkey=l.id||l.name; if(Object.prototype.hasOwnProperty.call(mode.icsVisible||{},lkey))l.visible=!!mode.icsVisible[lkey]; if(c.visible===false)l.visible=false;});});
  (state.taskColumns||[]).forEach(c=>{if(Object.prototype.hasOwnProperty.call(mode.taskVisible||{},c.id))c.visible=!!mode.taskVisible[c.id];});
  (state.longColumns||[]).forEach(c=>{if(Object.prototype.hasOwnProperty.call(mode.longVisible||{},c.id))c.visible=!!mode.longVisible[c.id];});
  state.activeViewMode=id;
}function openViewModeConfigModal(id){
  if(!requireLogin())return; ensureRev033State();
  const mode=(state.viewModes||[]).find(m=>m.id===id); if(!mode)return;
  const calHtml=(state.calendars||[]).map((c,i)=>{
    const calKey=c.id||c.name||('cal_'+i);
    const checked=Object.prototype.hasOwnProperty.call(mode.calendarVisible||{},calKey)?!!mode.calendarVisible[calKey]:c.visible!==false;
    const links=(c.links||[]).map(l=>{
      const lkey=l.id||l.name;
      const lchecked=checked&&(Object.prototype.hasOwnProperty.call(mode.icsVisible||{},lkey)?!!mode.icsVisible[lkey]:l.visible!==false);
      return modeCheckbox((l.name||'Kalenderquelle'),lchecked,`data-mode-ics="${escapeHtml(lkey)}" ${checked?'':'disabled'}`,'child '+(checked?'':'disabled-child'));
    }).join('');
    return `<div class="mode-config-calgroup"><div class="mode-config-subtitle">${escapeHtml(c.name||('Kalender '+(i+1)))}</div>${modeCheckbox('Kalender anzeigen',checked,`data-mode-cal="${escapeHtml(calKey)}"`)}${links||'<div class="hint">Keine Quellen.</div>'}</div>`;
  }).join('');
  const taskHtml=(state.taskColumns||[]).map(c=>modeCheckbox(c.name,Object.prototype.hasOwnProperty.call(mode.taskVisible||{},c.id)?!!mode.taskVisible[c.id]:c.visible!==false,`data-mode-task="${escapeHtml(c.id)}"`)).join('')||'<div class="hint">Keine Tagestask-Gruppen.</div>';
  const longHtml=(state.longColumns||[]).map(c=>modeCheckbox(c.name,Object.prototype.hasOwnProperty.call(mode.longVisible||{},c.id)?!!mode.longVisible[c.id]:c.visible!==false,`data-mode-long="${escapeHtml(c.id)}"`)).join('')||'<div class="hint">Keine Langfrist-Gruppen.</div>';
  $('#modalTitle').textContent='Modus konfigurieren';
  $('#modalContent').innerHTML=`<div class="edit-grid"><label>Name des Modus</label><input id="modeNameInput" value="${escapeHtml(mode.name)}"><div class="mode-config-list"><div class="mode-config-section"><div class="mode-config-section-title">Kalender und ICS-Links</div><div class="mode-config-grid">${calHtml}</div></div><div class="mode-config-section"><div class="mode-config-section-title">Tagestask-Gruppen</div><div class="mode-config-grid">${taskHtml}</div></div><div class="mode-config-section"><div class="mode-config-section-title">Langfristige Task-Gruppen</div><div class="mode-config-grid">${longHtml}</div></div></div></div>`;
  $('#modalBackdrop').style.display='flex'; $('#saveModal').style.display='';
  $$('[data-mode-cal]').forEach(x=>x.onchange=syncModeChildrenInModal);
  syncModeChildrenInModal();
  $('#saveModal').onclick=()=>{
    mode.name=$('#modeNameInput').value.trim()||mode.name||'Modus'; mode.calendarVisible={}; mode.icsVisible={}; mode.taskVisible={}; mode.longVisible={};
    $$('[data-mode-cal]').forEach(x=>mode.calendarVisible[x.dataset.modeCal]=x.checked);
    $$('[data-mode-ics]').forEach(x=>mode.icsVisible[x.dataset.modeIcs]=!x.disabled&&x.checked);
    $$('[data-mode-task]').forEach(x=>mode.taskVisible[x.dataset.modeTask]=x.checked);
    $$('[data-mode-long]').forEach(x=>mode.longVisible[x.dataset.modeLong]=x.checked);
    state.activeViewMode=mode.id; applyViewMode(mode.id); closeModal(); render(); toast('Modus gespeichert.');
  };
}
function openSyncSettingsModal(){
  openModal('Allgemeine Einstellungen',`<div class="settings-grid"><div class="field"><label>Erscheinung</label><select id="mTheme"><option value="light">Hell</option><option value="dark">Dunkel</option></select></div><div class="field"><label>Kanten</label><select id="mCornerStyle"><option value="rounded">Abgerundet</option><option value="sharp">Eckig / 90°</option></select></div><div class="section-title">Synchronisierung</div><button class="btn primary" id="mSyncNow" type="button">Alle ICS-Links aktualisieren</button><div class="field"><label>Intervall</label><select id="mSyncInterval"><option value="0">Aus / manuell</option><option value="5">Alle 5 Min.</option><option value="15">Alle 15 Min.</option><option value="30">Alle 30 Min.</option><option value="60">Alle 60 Min.</option></select></div><div class="hint" id="mSyncHint">ICS-Links werden über den intern fest hinterlegten Proxy geladen. Die Proxy-URL wird nicht mehr angezeigt.</div></div>`,()=>{state.theme=$('#mTheme').value;state.cornerStyle=$('#mCornerStyle').value;state.syncInterval=Number($('#mSyncInterval').value);state.fetchMode='proxy';state.proxyUrl=state.proxyUrl||DEFAULT_PROXY_URL;setupAutoSync();});
  $('#mTheme').value=state.theme||'light';$('#mCornerStyle').value=state.cornerStyle||'rounded';$('#mSyncInterval').value=String(state.syncInterval??15);
  $('#mSyncNow').onclick=async()=>{state.theme=$('#mTheme').value;state.cornerStyle=$('#mCornerStyle').value;state.syncInterval=Number($('#mSyncInterval').value);state.fetchMode='proxy';state.proxyUrl=state.proxyUrl||DEFAULT_PROXY_URL;persist();setupAutoSync();applyAppearance();await syncAllICS();};
}



/* Rev 039: echte Tabellen-Persistenz + Proxy-404-Fix
   - App-State speichert nur UI/Ansichtsoptionen.
   - Fachliche Daten werden als relationaler Snapshot in Supabase-Tabellen gespeichert.
   - Der ICS-Proxy zeigt bewusst noch auf die vorhandene funktionierende Edge Function, weil im neuen Supabase-Projekt noch keine Function deployed ist. */
const UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
let relationalSaveTimer=null;
let relationalSaveRunning=false;
let relationalSaveQueued=false;
function isUuid(v){return UUID_RE.test(String(v||''));}
function newUuid(){return crypto.randomUUID();}
function uiStateOnly(){
  return {
    days:state.days,dayRows:state.dayRows,startMode:state.startMode,panes:state.panes,offset:state.offset,
    syncInterval:state.syncInterval,fetchMode:'proxy',proxyUrl:'',viewModes:state.viewModes||[],activeViewMode:state.activeViewMode||'',
    theme:state.theme||'light',cornerStyle:state.cornerStyle||'rounded',colors:state.colors||defaultColors,
    sidebarCollapseAll:state.sidebarCollapseAll||false,configCollapsed:state.configCollapsed||{}
  };
}
function applyUiState(ui){
  if(!ui)return;
  ['days','dayRows','startMode','panes','offset','syncInterval','viewModes','activeViewMode','theme','cornerStyle','colors','sidebarCollapseAll','configCollapsed'].forEach(k=>{if(ui[k]!==undefined)state[k]=ui[k];});
  state.fetchMode='proxy';state.proxyUrl='';
}
function normalizeRelationalIds(){
  const calMap=new Map(), sourceMap=new Map(), taskGroupMap=new Map(), longGroupMap=new Map();
  (state.calendars||[]).forEach(cal=>{
    const old=cal.id||cal.dbId;
    if(!isUuid(old)){cal.id=newUuid();}else cal.id=old;
    cal.dbId=cal.id;
    if(old&&old!==cal.id)calMap.set(old,cal.id);
    (cal.links||[]).forEach(src=>{
      const so=src.id;
      if(!isUuid(so)){src.id=newUuid();sourceMap.set(so,src.id);} 
      src.calendarGroupId=cal.id;
    });
  });
  (state.taskColumns||[]).forEach(g=>{const old=g.id;if(!isUuid(old)){g.id=newUuid();taskGroupMap.set(old,g.id);}});
  (state.tasks||[]).forEach(t=>{if(!isUuid(t.id))t.id=newUuid(); if(taskGroupMap.has(t.columnId))t.columnId=taskGroupMap.get(t.columnId);});
  (state.longColumns||[]).forEach(g=>{const old=g.id;if(!isUuid(old)){g.id=newUuid();longGroupMap.set(old,g.id);}});
  (state.longterm||[]).forEach(t=>{if(!isUuid(t.id))t.id=newUuid(); if(longGroupMap.has(t.columnId))t.columnId=longGroupMap.get(t.columnId);});
  (state.calendars||[]).forEach(cal=>(cal.ownEvents||[]).forEach(e=>{if(!isUuid(e.id))e.id=newUuid(); if(sourceMap.has(e.sourceId))e.sourceId=sourceMap.get(e.sourceId);}));
}
async function deleteMissing(table,ids){
  let q=supabaseClient.from(table).delete().eq('user_id',currentUser.id);
  if(ids&&ids.length) q=q.not('id','in',`(${ids.join(',')})`);
  const {error}=await q;
  if(error)throw error;
}
async function upsertRows(table,rows){
  if(!rows.length)return;
  const {error}=await supabaseClient.from(table).upsert(rows,{onConflict:'id'});
  if(error)throw error;
}
function scheduleRelationalSave(){
  if(!currentUser||suppressCloudSave)return;
  clearTimeout(relationalSaveTimer);
  relationalSaveTimer=setTimeout(saveRelationalSnapshot,650);
}
async function saveRelationalSnapshot(){
  if(!currentUser||suppressCloudSave)return;
  if(relationalSaveRunning){relationalSaveQueued=true;return;}
  relationalSaveRunning=true;
  try{
    normalizeRelationalIds();
    const uid=currentUser.id;
    const calendarGroups=(state.calendars||[]).map((c,i)=>({id:c.id,user_id:uid,name:c.name||`Kalender ${i+1}`,visible:c.visible!==false,collapsed:c.collapsed!==false,position:i}));
    const calendarSources=[];
    (state.calendars||[]).forEach((c)=>{(c.links||[]).forEach((l,j)=>calendarSources.push({id:l.id,user_id:uid,calendar_group_id:c.id,type:l.type||'ics',name:l.name||'Kalenderquelle',url:l.type==='own'?null:(l.url||null),color:l.color||state.colors?.event||defaultColors.event,visible:l.visible!==false,position:j}));});
    const taskGroups=(state.taskColumns||[]).map((g,i)=>({id:g.id,user_id:uid,name:g.name||`Gruppe ${i+1}`,color:g.color||state.colors?.task||defaultColors.task,visible:g.visible!==false,position:i}));
    const tasks=(state.tasks||[]).map((t,i)=>({id:t.id,user_id:uid,task_group_id:isUuid(t.columnId)?t.columnId:null,title:t.title||'Ohne Titel',note:t.note||null,task_date:t.date||fmtDate(new Date()),done:!!t.done,completed_date:t.completedDate||null,position:i}));
    const longTaskGroups=(state.longColumns||[]).map((g,i)=>({id:g.id,user_id:uid,name:g.name||`Gruppe ${i+1}`,color:g.color||state.colors?.long||defaultColors.long,visible:g.visible!==false,position:i}));
    const longTasks=(state.longterm||[]).map((t,i)=>({id:t.id,user_id:uid,long_task_group_id:isUuid(t.columnId)?t.columnId:null,title:t.title||'Ohne Titel',note:t.note||null,done:!!t.done,completed_date:t.completedDate||null,position:i}));
    const ownEvents=[];
    (state.calendars||[]).forEach(c=>(c.ownEvents||[]).forEach((e,i)=>ownEvents.push({id:e.id,user_id:uid,calendar_source_id:e.sourceId,title:e.summary||e.title||'Ohne Titel',location:e.location||null,description:e.description||null,start_time:e.start,end_time:e.end||null,all_day:!!e.allDay,recurrence:e.recurrence||'none',travel_time:e.travelTime||null,status:e.status||'active'})));

    await upsertRows('calendar_groups',calendarGroups);
    await deleteMissing('calendar_groups',calendarGroups.map(x=>x.id));
    await upsertRows('calendar_sources',calendarSources);
    await deleteMissing('calendar_sources',calendarSources.map(x=>x.id));
    await upsertRows('task_groups',taskGroups);
    await deleteMissing('task_groups',taskGroups.map(x=>x.id));
    await upsertRows('tasks',tasks);
    await deleteMissing('tasks',tasks.map(x=>x.id));
    await upsertRows('long_task_groups',longTaskGroups);
    await deleteMissing('long_task_groups',longTaskGroups.map(x=>x.id));
    await upsertRows('long_tasks',longTasks);
    await deleteMissing('long_tasks',longTasks.map(x=>x.id));
    await upsertRows('own_events',ownEvents);
    await deleteMissing('own_events',ownEvents.map(x=>x.id));
    const diag=document.querySelector('#diagBox'); if(diag)diag.textContent='Relationale Daten gespeichert: '+new Date().toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'});
    setCloudStatus('Tabellen gespeichert: '+new Date().toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'}),'ok');
  }catch(error){
    console.error('Relationale Speicherung fehlgeschlagen',error);
    setCloudStatus('Tabellen-Speichern fehlgeschlagen: '+(error.message||error),'bad');
    const diag=document.querySelector('#diagBox'); if(diag)diag.textContent='Tabellen-Speichern fehlgeschlagen: '+(error.message||error);
  }finally{
    relationalSaveRunning=false;
    if(relationalSaveQueued){relationalSaveQueued=false;scheduleRelationalSave();}
  }
}
async function ensureDefaultRelationalRows(){
  const uid=currentUser.id;
  const {data:cg}=await supabaseClient.from('calendar_groups').select('id').eq('user_id',uid).limit(1);
  if(!cg||!cg.length)await supabaseClient.from('calendar_groups').insert({user_id:uid,name:'Mein Kalender',visible:true,collapsed:true,position:0});
  const {data:tg}=await supabaseClient.from('task_groups').select('id').eq('user_id',uid).limit(1);
  if(!tg||!tg.length)await supabaseClient.from('task_groups').insert({user_id:uid,name:'Allgemein',color:'#ffb020',visible:true,position:0});
  const {data:lg}=await supabaseClient.from('long_task_groups').select('id').eq('user_id',uid).limit(1);
  if(!lg||!lg.length)await supabaseClient.from('long_task_groups').insert({user_id:uid,name:'Allgemein',color:'#48d38b',visible:true,position:0});
}
async function loadRelationalData(){
  if(!currentUser)return;
  await ensureDefaultRelationalRows();
  const uid=currentUser.id;
  const [cg,cs,tg,ts,lg,lt,oe]=await Promise.all([
    supabaseClient.from('calendar_groups').select('*').eq('user_id',uid).order('position'),
    supabaseClient.from('calendar_sources').select('*').eq('user_id',uid).order('position'),
    supabaseClient.from('task_groups').select('*').eq('user_id',uid).order('position'),
    supabaseClient.from('tasks').select('*').eq('user_id',uid).order('position'),
    supabaseClient.from('long_task_groups').select('*').eq('user_id',uid).order('position'),
    supabaseClient.from('long_tasks').select('*').eq('user_id',uid).order('position'),
    supabaseClient.from('own_events').select('*').eq('user_id',uid).order('created_at')
  ]);
  const errors=[cg,cs,tg,ts,lg,lt,oe].map(r=>r.error).filter(Boolean); if(errors.length)throw errors[0];
  const sourcesByGroup=new Map();(cs.data||[]).forEach(s=>{if(!sourcesByGroup.has(s.calendar_group_id))sourcesByGroup.set(s.calendar_group_id,[]);sourcesByGroup.get(s.calendar_group_id).push(s);});
  const eventsBySource=new Map();(oe.data||[]).forEach(e=>{if(!eventsBySource.has(e.calendar_source_id))eventsBySource.set(e.calendar_source_id,[]);eventsBySource.get(e.calendar_source_id).push(e);});
  state.calendars=(cg.data||[]).map(g=>{
    const links=(sourcesByGroup.get(g.id)||[]).map(s=>({id:s.id,type:s.type,name:s.name,url:s.url||'',color:s.color||state.colors?.event||defaultColors.event,visible:s.visible!==false,calendarGroupId:g.id}));
    const ownEvents=links.filter(l=>l.type==='own').flatMap(l=>(eventsBySource.get(l.id)||[]).map(e=>({id:e.id,sourceId:l.id,summary:e.title,location:e.location||'',description:e.description||'',start:e.start_time,end:e.end_time,allDay:!!e.all_day,recurrence:e.recurrence||'none',source:l.name,icsName:l.name,icsColor:l.color,travelTime:e.travel_time||'',status:e.status||'active',manual:true})));
    return {id:g.id,dbId:g.id,name:g.name,visible:g.visible!==false,collapsed:g.collapsed!==false,links,events:[],ownEvents,status:'Aus Tabellen geladen.'};
  });
  state.taskColumns=(tg.data||[]).map(g=>({id:g.id,name:g.name,color:g.color,visible:g.visible!==false}));
  state.tasks=(ts.data||[]).map(t=>({id:t.id,title:t.title,note:t.note||'',date:t.task_date,done:!!t.done,completedDate:t.completed_date||null,columnId:t.task_group_id||state.taskColumns[0]?.id}));
  state.longColumns=(lg.data||[]).map(g=>({id:g.id,name:g.name,color:g.color,visible:g.visible!==false}));
  state.longterm=(lt.data||[]).map(t=>({id:t.id,title:t.title,note:t.note||'',done:!!t.done,completedDate:t.completed_date||null,columnId:t.long_task_group_id||state.longColumns[0]?.id,createdDate:t.created_at?fmtDate(new Date(t.created_at)):fmtDate(new Date())}));
}

// App-State speichert ab Rev039 nur noch UI-Einstellungen; fachliche Daten laufen über Tabellen.
saveStateToCloud=async function(){
  if(!currentUser)return setCloudStatus('Nicht angemeldet. Online-Speicherung nicht möglich.','bad');
  const payload={user_id:currentUser.id,state:uiStateOnly(),updated_at:new Date().toISOString()};
  const {error}=await supabaseClient.from('app_state').upsert(payload,{onConflict:'user_id'});
  if(error){setCloudStatus('UI-State speichern fehlgeschlagen: '+error.message,'bad');return;}
  scheduleRelationalSave();
};
loadStateFromCloud=async function(){
  if(!currentUser)return setCloudStatus('Nicht angemeldet. Online-Laden nicht möglich.','bad');
  suppressCloudSave=true;
  try{
    const {data,error}=await supabaseClient.from('app_state').select('state,updated_at').eq('user_id',currentUser.id).maybeSingle();
    if(error)throw error;
    state=getBlankState();ensureSettings();
    if(data&&data.state)applyUiState(data.state);
    await loadRelationalData();
    ensureSettings();clearRuntimeICSCache();render();setupAutoSync();
    setCloudStatus('Tabellendaten geladen. Stand: '+new Date().toLocaleString('de-DE'),'ok');
    scheduleInitialICSSync(900);
  }catch(error){
    console.error(error);setCloudStatus('Laden aus Tabellen fehlgeschlagen: '+(error.message||error),'bad');
  }finally{suppressCloudSave=false;}
};

// Persistenz: UI-State + relationaler Snapshot werden beide geschrieben.
persist=function(){
  if(currentUser){localStorage.setItem(storeKey,JSON.stringify(uiStateOnly()));}else{localStorage.removeItem(storeKey);}
  if(cloudReady&&currentUser&&!suppressCloudSave){scheduleCloudSave();scheduleRelationalSave();}
};

// Kalendergruppen standardmäßig einklappbar machen, ohne Quellen aus der DB zu verlieren.
const __rev39_renderCalendarConfig=renderCalendarConfig;
renderCalendarConfig=function(){
  __rev39_renderCalendarConfig();
  $$('.calendar-pane').forEach(pane=>{
    const i=Number(pane.dataset.calIndex); const cal=state.calendars[i]; if(!cal)return;
    const items=Array.from(pane.querySelectorAll('.ics-item,.status,.empty'));
    if(cal.collapsed!==false)items.forEach(x=>x.style.display='none');
    const head=pane.querySelector('.pane-head');
    if(head&&!head.querySelector('[data-collapse-cal]')){
      const btn=document.createElement('button');btn.className='btn small ui-icon-btn';btn.type='button';btn.title=cal.collapsed!==false?'Kalendergruppe ausklappen':'Kalendergruppe einklappen';btn.innerHTML=cal.collapsed!==false?iconChevronRight():iconChevronDown();btn.dataset.collapseCal=String(i);
      const actions=head.querySelector('.pane-actions'); if(actions)actions.prepend(btn);
      btn.onclick=(ev)=>{ev.stopPropagation();cal.collapsed=!(cal.collapsed!==false);render();};
    }
  });
};

// Bestehende Neuanlage von Kalenderquellen schreibt sofort in die Tabellen, damit der Eintrag direkt in calendar_sources sichtbar ist.
openICSModal=function(pane){
  if(!requireLogin())return;
  openModal(`ICS-Link hinzufügen · ${state.calendars[pane].name}`,`<input id="mName" placeholder="Name, z. B. Privat Kalender"><input id="mUrl" placeholder="webcal://... oder https://.../calendar.ics"><div class="hint">Der Link wird sofort in calendar_sources gespeichert. Danach wird der ICS-Kalender über den Proxy geladen.</div>`,async()=>{
    const name=$('#mName').value.trim()||'ICS Kalender';const url=normalizeICSUrl($('#mUrl').value.trim());if(!url)return toast('Kein ICS-Link gespeichert.');
    normalizeRelationalIds(); const cal=state.calendars[pane];
    const row={user_id:currentUser.id,calendar_group_id:cal.id,type:'ics',name,url,color:state.colors?.event||defaultColors.event,visible:true,position:(cal.links||[]).length};
    const {data,error}=await supabaseClient.from('calendar_sources').insert(row).select('*').single();
    if(error){toast('ICS-Quelle konnte nicht gespeichert werden: '+error.message);return;}
    cal.links.push({id:data.id,type:'ics',name:data.name,url:data.url,color:data.color,visible:data.visible!==false,calendarGroupId:cal.id});
    await loadICS(pane);
    scheduleRelationalSave();
  });
};

openCreateOwnSourceModal=function(pane){
  if(!requireLogin())return;
  openModal(`Eigenen Kalender hinzufügen · ${state.calendars[pane].name}`,`<input id="mOwnName" placeholder="Name, z. B. Eigene Termine"><div class="hint">Der eigene Kalender wird sofort in calendar_sources gespeichert.</div>`,async()=>{
    const name=$('#mOwnName').value.trim()||'Eigener Kalender';normalizeRelationalIds();const cal=state.calendars[pane];
    const row={user_id:currentUser.id,calendar_group_id:cal.id,type:'own',name,url:null,color:state.colors?.event||defaultColors.event,visible:true,position:(cal.links||[]).length};
    const {data,error}=await supabaseClient.from('calendar_sources').insert(row).select('*').single();
    if(error){toast('Eigener Kalender konnte nicht gespeichert werden: '+error.message);return;}
    cal.links.push({id:data.id,type:'own',name:data.name,color:data.color,visible:data.visible!==false,calendarGroupId:cal.id});scheduleRelationalSave();
  });
};

// Proxy-Build robuster: falls versehentlich /rest/v1/ eingetragen wäre, wird trotzdem die fest gesetzte Edge Function genutzt.
buildICSFetchUrl=function(url){const sourceUrl=normalizeICSUrl(url);return DEFAULT_PROXY_URL+encodeURIComponent(sourceUrl);};


/* Rev 040: Design-/Bedienrevision - Funktionspatches */
function openNativeColorPicker(initial,onPick){
  const input=document.createElement('input');
  input.type='color'; input.className='hidden-color-input'; input.value=initial||'#7c5cff';
  document.body.appendChild(input);
  input.oninput=()=>{ if(onPick)onPick(input.value); };
  input.onchange=()=>{ if(onPick)onPick(input.value); setTimeout(()=>input.remove(),120); };
  input.click();
}
function colorBucketButtonHtml(color,attr='data-color-bucket'){
  return `<button type="button" class="btn small color-bucket-btn" ${attr} title="Weitere Farbe wählen">${iconColorBucket()}</button><span class="color-bucket-preview" style="background:${escapeHtml(color||'#7c5cff')}"></span>`;
}

// Kalendergruppen-Collapse oben rechts statt in der Aktionszeile
const __rev40_renderCalendarConfig=renderCalendarConfig;
renderCalendarConfig=function(){
  __rev40_renderCalendarConfig();
  $$('.calendar-pane').forEach(pane=>{
    const i=Number(pane.dataset.calIndex); const cal=state.calendars[i]; if(!cal)return;
    pane.querySelectorAll('[data-collapse-cal]').forEach((b,idx)=>{ if(idx>0)b.remove(); });
    const old=pane.querySelector('[data-collapse-cal]');
    if(old){old.classList.add('cal-collapse-corner'); if(old.parentElement?.classList.contains('pane-actions')) pane.appendChild(old);}
    const btn=pane.querySelector('[data-collapse-cal]');
    if(btn){btn.innerHTML=cal.collapsed!==false?iconChevronRight():iconChevronDown();btn.title=cal.collapsed!==false?'Kalendergruppe ausklappen':'Kalendergruppe einklappen';}
  });
};

// Tagestask-Konfiguration: Farbe für überzogene Tagestasks ergänzen
const __rev40_renderTaskColumnConfig=renderTaskColumnConfig;
renderTaskColumnConfig=function(){
  __rev40_renderTaskColumnConfig();
  const root=$('#taskColumnConfig'); if(!root)return;
  if(!root.querySelector('#overdueColorBtn')){
    const box=document.createElement('div');
    box.className='overdue-color-row';
    box.innerHTML=`<div class="color-bucket-label"><span class="color-bucket-preview" style="background:${escapeHtml(state.colors?.overdue||defaultColors.overdue)}"></span><span>Überzogene Tasks</span></div><button class="btn small color-bucket-btn" id="overdueColorBtn" title="Farbe wählen">${iconColorBucket()}</button>`;
    root.prepend(box);
    $('#overdueColorBtn').onclick=()=>openNativeColorPicker(state.colors?.overdue||defaultColors.overdue,(c)=>{state.colors=Object.assign({},defaultColors,state.colors||{});state.colors.overdue=c;persist();render();});
  }
};

// Task-/Long-/ICS-Farbmodal: zusätzlichen Farbeimer nach vorhandenen Paletten ermöglichen
function attachPaletteBucket(scopeSelector, targetObj, prop='color', fallback='#7c5cff'){
  const wrap=document.querySelector(scopeSelector); if(!wrap||wrap.dataset.bucketReady)return; wrap.dataset.bucketReady='1';
  const bucket=document.createElement('div'); bucket.style.marginTop='8px'; bucket.innerHTML=colorBucketButtonHtml(targetObj?.[prop]||fallback);
  wrap.after(bucket);
  bucket.querySelector('[data-color-bucket]').onclick=()=>openNativeColorPicker(targetObj?.[prop]||fallback,(c)=>{targetObj[prop]=c;persist();render();closeModal();});
}
const __rev40_openTaskColumnModal=openTaskColumnModal;
openTaskColumnModal=function(idx){__rev40_openTaskColumnModal(idx);setTimeout(()=>{const isNew=idx===null||idx===undefined;const obj=isNew?{}:state.taskColumns[idx];attachPaletteBucket('[data-taskcol-color-picker]',obj,'color',state.colors?.task||defaultColors.task);},0);};
const __rev40_openLongColumnModal=openLongColumnModal;
openLongColumnModal=function(idx){__rev40_openLongColumnModal(idx);setTimeout(()=>{const isNew=idx===null||idx===undefined;const obj=isNew?{}:state.longColumns[idx];attachPaletteBucket('[data-longcol-color-picker]',obj,'color',state.colors?.long||defaultColors.long);},0);};
const __rev40_openICSSettingsModal=openICSSettingsModal;
openICSSettingsModal=function(pane,idx){__rev40_openICSSettingsModal(pane,idx);setTimeout(()=>{const obj=state.calendars[pane]?.links?.[idx]||{};attachPaletteBucket('[data-ics-color-picker]',obj,'color',state.colors?.event||defaultColors.event);},0);};
const __rev40_openOwnSourceModal=openOwnSourceModal;
openOwnSourceModal=function(pane,idx){__rev40_openOwnSourceModal(pane,idx);setTimeout(()=>{const obj=state.calendars[pane]?.links?.[idx]||{};attachPaletteBucket('[data-own-color-picker]',obj,'color',state.colors?.event||defaultColors.event);},0);};

// Robusteres Dedupe: zusätzlich bei Tagesdarstellung nach tatsächlicher Occurrence deduplizieren
function dedupeOccurrences(events){
  const map=new Map(); const norm=v=>String(v||'').trim().toLowerCase().replace(/\s+/g,' ');
  (events||[]).forEach(e=>{
    const start=new Date(e.start); const end=e.end?new Date(e.end):null;
    const key=[e.icsId||e.sourceId||'',norm(e.summary),isNaN(start)?String(e.start):start.toISOString(),end&&!isNaN(end)?end.toISOString():''].join('|');
    const old=map.get(key);
    if(!old)map.set(key,e);
    else if(old.rrule && !e.rrule)map.set(key,e);
  });
  return Array.from(map.values());
}
const __rev40_calendarLanes=calendarLanes;
calendarLanes=function(date){
  // Kopie der Originallogik mit deduplizierter Eventliste
  const iso=fmtDate(date);const visible=visibleCalendars();return visible.map(({cal,idx:ci})=>{
    const visibleOwnIds=(cal.links||[]).filter(l=>l.type==='own'&&l.visible!==false).map(l=>l.id);
    const icsEvents=(cal.events||[]).map((e,ei)=>{const occ=eventOccurrenceForDate(e,date);return occ?Object.assign(occ,{_type:'ics',_cal:ci,_idx:ei}):null;}).filter(e=>{if(!e)return false;const l=(cal.links||[]).find(x=>x.id===e.icsId);return (!l||l.visible!==false);});
    const ownEvents=(cal.ownEvents||[]).map((e,ei)=>{const occ=eventOccurrenceForDate(e,date);return occ?Object.assign(occ,{_type:'own',_cal:ci,_idx:ei}):null;}).filter(e=>e&&visibleOwnIds.includes(e.sourceId));
    const events=dedupeOccurrences([...icsEvents,...ownEvents]).sort((a,b)=>new Date(a.start)-new Date(b.start));
    const ownSources=(cal.links||[]).filter(l=>l.type==='own'&&l.visible!==false);
    return `<div class="lane"><div class="lane-title" style="display:flex;align-items:center;gap:8px"><span>${escapeHtml(cal.name)}</span>${ownSources.length?`<button class="btn small own-event-btn plus-only" data-add-own-event="${ci}:${iso}" title="Eigenen Termin hinzufügen">+</button>`:''}</div>${events.length?events.map(e=>{const tp=eventTimeParts(e);const ref=`${e._type}:${e._cal}:${e._idx}:${iso}`;const recur=(e.recurrence&&e.recurrence!=='none')?` · ${recurrenceLabel(e.recurrence)}`:(e.rrule?` · Wiederholung`:'');const cancelled=(String(e.status||'').toUpperCase()==='CANCELLED');const label=cancelled?' · Abgesagt':'';const h=eventVisualHeight(e);return `<div class="card event ${cancelled?'cancelled':''}" data-event-ref="${ref}" data-ics-color="1" style="border-left-color:${escapeHtml(e.icsColor||state.colors.event)}!important;min-height:${h}px;padding-top:${h<42?'7':'11'}px;padding-bottom:${h<42?'7':'11'}px" title="${escapeHtml(e.summary)}"><div class="event-row"><div class="event-timebox"><span>${escapeHtml(tp.start)}</span><span>${escapeHtml(tp.end)}</span></div><div class="event-title"><b>${escapeHtml(shortText(e.summary+(cancelled?' (abgesagt)':''),30))}</b><small>${escapeHtml(shortText((e.icsName||e.source||cal.name)+recur+label,34))}</small></div></div></div>`}).join(''):'<div class="empty">Keine Einträge.</div>'}</div>`;
  }).join('');
};

// Login per Enter in E-Mail-/Passwortfeld
const __rev40_openCloudModal=openCloudModal;
openCloudModal=function(){
  __rev40_openCloudModal();
  setTimeout(()=>{['#cloudEmail','#cloudPassword'].forEach(sel=>{const el=$(sel); if(el)el.onkeydown=(e)=>{if(e.key==='Enter'){e.preventDefault();cloudLogin();}};});},0);
};

// Einstellungen: Sicherheitshinweis + mehr Erscheinungsoptionen
openSyncSettingsModal=function(){
  openModal('Allgemeine Einstellungen',`<div class="settings-grid"><div class="field"><label>Erscheinung</label><select id="mTheme"><option value="light">Hell</option><option value="dark">Dunkel</option><option value="blue">Bläulich</option><option value="red">Rötlich</option><option value="green">Grünlich</option></select></div><div class="field"><label>Kanten</label><select id="mCornerStyle"><option value="rounded">Abgerundet</option><option value="sharp">Eckig / 90°</option></select></div><div class="section-title">Synchronisierung</div><button class="btn primary" id="mSyncNow" type="button">Alle ICS-Links aktualisieren</button><div class="field"><label>Intervall</label><select id="mSyncInterval"><option value="0">Aus / manuell</option><option value="5">Alle 5 Min.</option><option value="15">Alle 15 Min.</option><option value="30">Alle 30 Min.</option><option value="60">Alle 60 Min.</option></select></div><div class="hint" id="mSyncHint">ICS-Links werden über den intern fest hinterlegten Proxy geladen.</div><div class="security-note"><b>Datenschutzhinweis:</b> Kalenderbezogene Informationen wie Kalenderquellen, ICS-Links, Tasks und eigene Termine liegen nutzerbezogen in der Datenbank. Der Entwickler könnte diese Daten hypothetisch administrativ aus der Datenbank auslesen, tut dies aber nicht. <br><br><b>Wichtig:</b> Passwörter und Anmeldeinformationen können nicht angezeigt werden. Die Authentifizierung wird über Supabase Auth verwaltet; Passwörter liegen nicht im Klartext vor.</div></div>`,()=>{state.theme=$('#mTheme').value;state.cornerStyle=$('#mCornerStyle').value;state.syncInterval=Number($('#mSyncInterval').value);state.fetchMode='proxy';state.proxyUrl=state.proxyUrl||DEFAULT_PROXY_URL;setupAutoSync();});
  $('#mTheme').value=state.theme||'light';$('#mCornerStyle').value=state.cornerStyle||'rounded';$('#mSyncInterval').value=String(state.syncInterval??15);
  $('#mSyncNow').onclick=async()=>{state.theme=$('#mTheme').value;state.cornerStyle=$('#mCornerStyle').value;state.syncInterval=Number($('#mSyncInterval').value);state.fetchMode='proxy';state.proxyUrl=state.proxyUrl||DEFAULT_PROXY_URL;persist();setupAutoSync();applyAppearance();await syncAllICS();};
};
const __rev40_applyAppearance=applyAppearance;
applyAppearance=function(){
  __rev40_applyAppearance();
  document.body.classList.toggle('theme-blue',state.theme==='blue');
  document.body.classList.toggle('theme-red',state.theme==='red');
  document.body.classList.toggle('theme-green',state.theme==='green');
};

// Modus-Konfiguration: Modusauswahl + Löschen, Kalender-Haken in Titelzeile, Unterkalender behalten ihre Haken
function syncModeChildrenInModal(){
  $$('[data-mode-cal]').forEach(parent=>{
    const section=parent.closest('.mode-config-calgroup'); if(!section)return;
    section.querySelectorAll('[data-mode-ics]').forEach(child=>{
      child.disabled=!parent.checked;
      child.closest('.mode-check')?.classList.toggle('disabled-child',!parent.checked);
    });
  });
}
openViewModeConfigModal=function(id){
  if(!requireLogin())return; ensureRev033State();
  let mode=(state.viewModes||[]).find(m=>m.id===id); if(!mode)return;
  const modeOptions=(state.viewModes||[]).map(m=>`<option value="${escapeHtml(m.id)}" ${m.id===mode.id?'selected':''}>${escapeHtml(m.name)}</option>`).join('');
  const calHtml=(state.calendars||[]).map((c,i)=>{
    const calKey=c.id||c.name||('cal_'+i);
    const checked=Object.prototype.hasOwnProperty.call(mode.calendarVisible||{},calKey)?!!mode.calendarVisible[calKey]:c.visible!==false;
    const links=(c.links||[]).map(l=>{
      const lkey=l.id||l.name;
      const lchecked=Object.prototype.hasOwnProperty.call(mode.icsVisible||{},lkey)?!!mode.icsVisible[lkey]:l.visible!==false;
      return modeCheckbox((l.name||'Kalenderquelle'),lchecked,`data-mode-ics="${escapeHtml(lkey)}" ${checked?'':'disabled'}`,'child '+(checked?'':'disabled-child'));
    }).join('');
    return `<div class="mode-config-calgroup"><div class="mode-config-calgroup-head"><div class="mode-config-calgroup-title">${escapeHtml(c.name||('Kalender '+(i+1)))}</div><input class="mode-parent-check" type="checkbox" ${checked?'checked':''} data-mode-cal="${escapeHtml(calKey)}"></div>${links||'<div class="hint">Keine Quellen.</div>'}</div>`;
  }).join('');
  const taskHtml=(state.taskColumns||[]).map(c=>modeCheckbox(c.name,Object.prototype.hasOwnProperty.call(mode.taskVisible||{},c.id)?!!mode.taskVisible[c.id]:c.visible!==false,`data-mode-task="${escapeHtml(c.id)}"`)).join('')||'<div class="hint">Keine Tagestask-Gruppen.</div>';
  const longHtml=(state.longColumns||[]).map(c=>modeCheckbox(c.name,Object.prototype.hasOwnProperty.call(mode.longVisible||{},c.id)?!!mode.longVisible[c.id]:c.visible!==false,`data-mode-long="${escapeHtml(c.id)}"`)).join('')||'<div class="hint">Keine Langfrist-Gruppen.</div>';
  $('#modalTitle').textContent='Modus konfigurieren';
  $('#modalContent').innerHTML=`<div class="edit-grid"><div class="mode-config-toolbar"><select id="modePickerTop">${modeOptions}</select></div><label>Name des Modus</label><input id="modeNameInput" value="${escapeHtml(mode.name)}"><div class="mode-config-list"><div class="mode-config-section"><div class="mode-config-section-title">Kalender und ICS-Links</div><div class="mode-config-grid">${calHtml}</div></div><div class="mode-config-section"><div class="mode-config-section-title">Tagestask-Gruppen</div><div class="mode-config-grid">${taskHtml}</div></div><div class="mode-config-section"><div class="mode-config-section-title">Langfristige Task-Gruppen</div><div class="mode-config-grid">${longHtml}</div></div></div></div>`;
  $('#modalBackdrop').style.display='flex'; $('#saveModal').style.display='';
  const actions=document.querySelector('.modal-actions');
  let oldDelete=document.querySelector('#deleteModeBtnAction'); if(oldDelete)oldDelete.remove();
  const deleteBtn=document.createElement('button'); deleteBtn.className='btn danger mode-delete-action'; deleteBtn.id='deleteModeBtnAction'; deleteBtn.type='button'; deleteBtn.textContent='Löschen';
  actions.insertBefore(deleteBtn,$('#saveModal'));
  $('#modePickerTop').onchange=e=>openViewModeConfigModal(e.target.value);
  deleteBtn.onclick=()=>{if(!confirm('Diesen Ansichtsmodus löschen?'))return; state.viewModes=state.viewModes.filter(m=>m.id!==mode.id); state.activeViewMode=state.viewModes[0]?.id||''; deleteBtn.remove(); closeModal(); render(); toast('Modus gelöscht.');};
  $$('[data-mode-cal]').forEach(x=>x.onchange=syncModeChildrenInModal); syncModeChildrenInModal();
  $('#saveModal').onclick=()=>{
    mode.name=$('#modeNameInput').value.trim()||mode.name||'Modus'; mode.calendarVisible={}; mode.icsVisible={}; mode.taskVisible={}; mode.longVisible={};
    $$('[data-mode-cal]').forEach(x=>mode.calendarVisible[x.dataset.modeCal]=x.checked);
    $$('[data-mode-ics]').forEach(x=>mode.icsVisible[x.dataset.modeIcs]=x.checked);
    $$('[data-mode-task]').forEach(x=>mode.taskVisible[x.dataset.modeTask]=x.checked);
    $$('[data-mode-long]').forEach(x=>mode.longVisible[x.dataset.modeLong]=x.checked);
    state.activeViewMode=mode.id; applyViewMode(mode.id); closeModal(); render(); toast('Modus gespeichert.');
  };
};



/* Rev 041: Schutz gegen unbeabsichtigtes Löschen tabellarischer Fachdatensätze
   Problemursache: Der bisherige relationale Snapshot hat nicht nur geupsertet,
   sondern auch alle Tabellenzeilen gelöscht, die im aktuellen Frontend-State fehlten.
   Wenn ein Reload/Versionswechsel/Load-Fehler kurzzeitig einen leeren state.tasks erzeugt,
   konnten dadurch vorhandene Tagestasks aus Supabase verschwinden.
   Korrektur: Snapshot-Speicherung löscht nichts mehr automatisch. Löschungen erfolgen nur noch
   explizit über Nutzeraktionen und dann gezielt per DELETE auf der passenden Tabelle. */
async function dbDeleteRowRev041(table,id){
  if(!currentUser||!id)return;
  const {error}=await supabaseClient.from(table).delete().eq('user_id',currentUser.id).eq('id',id);
  if(error){console.error('DELETE fehlgeschlagen',table,id,error);toast('Löschen in Tabelle fehlgeschlagen: '+error.message);}
}
async function dbUpdateRowRev041(table,id,values){
  if(!currentUser||!id)return;
  const {error}=await supabaseClient.from(table).update(values).eq('user_id',currentUser.id).eq('id',id);
  if(error){console.error('UPDATE fehlgeschlagen',table,id,error);toast('Speichern in Tabelle fehlgeschlagen: '+error.message);}
}
// WICHTIG: kein automatisches Tabellen-Bereinigungs-DELETE mehr beim Snapshot.
deleteMissing=async function(table,ids){ return; };
// Schnellere, aber weiterhin entprellte Speicherung.
scheduleRelationalSave=function(){
  if(!currentUser||suppressCloudSave)return;
  clearTimeout(relationalSaveTimer);
  relationalSaveTimer=setTimeout(saveRelationalSnapshot,150);
};

// Tagestask-Tageskarte mit expliziter Tabellenlöschung und sofortigem Update beim Abhaken.
dayCard=function(date){
  const today=new Date();today.setHours(0,0,0,0);const iso=fmtDate(date);
  const visibleTaskIds=(state.taskColumns||[]).filter(c=>c.visible!==false).map(c=>c.id);
  const visibleLongIds=(state.longColumns||[]).filter(c=>c.visible!==false).map(c=>c.id);
  const openTasks=state.tasks.filter(t=>t.date===iso&&!t.done&&visibleTaskIds.includes(t.columnId||state.taskColumns?.[0]?.id));
  const overdue=sameDay(date,today)?state.tasks.filter(t=>t.date<fmtDate(today)&&!t.done&&visibleTaskIds.includes(t.columnId||state.taskColumns?.[0]?.id)):[];
  const completedLong=state.longterm.filter(t=>t.done&&t.completedDate===iso&&visibleLongIds.includes(t.columnId||state.longColumns?.[0]?.id));
  const completedTasks=state.tasks.filter(t=>t.done&&t.completedDate===iso&&visibleTaskIds.includes(t.columnId||state.taskColumns?.[0]?.id));
  const showCompleted=completedTasks.length||completedLong.length;
  const day=document.createElement('div');day.className='day'+(sameDay(date,today)?' today':'');
  day.innerHTML=`<div class="day-head"><div class="day-num"><span class="day-title-weekday">${escapeHtml(date.toLocaleDateString('de-DE',{weekday:'long'}))}</span><span class="day-title-date">${escapeHtml(date.toLocaleDateString('de-DE',{day:'2-digit',month:'2-digit',year:'numeric'}))}</span></div>${sameDay(date,today)?'<span class="badge">Aktueller Tag</span>':''}</div><div class="day-body"><div class="partition"><div class="part-head"><div class="part-title">1. Terminkalender</div></div><div class="split">${calendarLanes(date)}</div></div><div class="partition"><div class="part-head"><div class="part-title">2. Tagestasks</div><button class="btn small" data-task-date="${iso}">${iconPlus()} Hinzufügen</button></div>${taskColumnsList(openTasks)}</div>${sameDay(date,today)?`<div class="partition"><div class="part-head"><div class="part-title">3. Überzogene Tasks</div></div>${taskList(overdue,true)}</div>`:''}${showCompleted?`<div class="partition"><div class="part-head"><div class="part-title">${sameDay(date,today)?'4':'3'}. An diesem Tag erledigte Tasks</div></div>${completedDoneList(completedTasks,completedLong)}</div>`:''}</div>`;
  day.querySelector('[data-task-date]').onclick=()=>openTaskModal(iso);
  day.querySelectorAll('[data-toggle-task]').forEach(c=>{c.onclick=ev=>ev.stopPropagation();c.onchange=async(ev)=>{ev.stopPropagation();const t=state.tasks.find(x=>x.id===c.dataset.toggleTask);if(!requireLogin()){c.checked=!c.checked;return;}if(t){t.done=c.checked;t.completedDate=c.checked?fmtDate(new Date()):null;render();await dbUpdateRowRev041('tasks',t.id,{done:!!t.done,completed_date:t.completedDate||null});scheduleRelationalSave();}}});
  day.querySelectorAll('[data-delete-task]').forEach(b=>b.onclick=async(ev)=>{ev.stopPropagation();if(!requireLogin())return;const id=b.dataset.deleteTask;state.tasks=state.tasks.filter(x=>x.id!==id);render();await dbDeleteRowRev041('tasks',id);});
  day.querySelectorAll('[data-task-ref]').forEach(card=>card.onclick=()=>openTaskDetailModal(card.dataset.taskRef));
  day.querySelectorAll('[data-add-own-event]').forEach(b=>b.onclick=(ev)=>{ev.stopPropagation();const [ci,iso]=b.dataset.addOwnEvent.split(':');openOwnEventModal(Number(ci),iso);});
  day.querySelectorAll('[data-event-ref]').forEach(card=>card.onclick=()=>openEventDetailModal(card.dataset.eventRef));
  return day;
};

// Langfristige Tasks: explizites DELETE statt indirektem Snapshot-Löschen.
const __rev041_renderLong=renderLong;
renderLong=function(){
  __rev041_renderLong();
  $$('[data-delete-long]').forEach(b=>b.onclick=async(ev)=>{ev.stopPropagation();if(!requireLogin())return;const id=b.dataset.deleteLong;state.longterm=state.longterm.filter(x=>x.id!==id);render();await dbDeleteRowRev041('long_tasks',id);});
  $$('[data-toggle-long]').forEach(c=>{c.onchange=async(ev)=>{ev.stopPropagation();const t=state.longterm.find(x=>x.id===c.dataset.toggleLong);if(!requireLogin()){c.checked=!c.checked;return;}if(t){t.done=c.checked;t.completedDate=c.checked?fmtDate(new Date()):null;render();await dbUpdateRowRev041('long_tasks',t.id,{done:!!t.done,completed_date:t.completedDate||null});scheduleRelationalSave();}}});
};

// Kalendergruppen und Kalenderquellen: Löschungen nur gezielt per Nutzeraktion.
const __rev041_renderCalendarConfig=renderCalendarConfig;
renderCalendarConfig=function(){
  __rev041_renderCalendarConfig();
  $$('[data-del-ics]').forEach(b=>b.onclick=async(ev)=>{ev.stopPropagation();if(!requireLogin())return;const [i,idx]=b.dataset.delIcs.split(':').map(Number);const target=state.calendars[i]?.links?.[idx];if(!target)return;
    if(target.type==='own'){
      const count=(state.calendars[i].ownEvents||[]).filter(e=>e.sourceId===target.id).length;
      if(!confirm(`Sind Sie sicher, dass Sie diesen eigenen Kalender löschen möchten?\n\nAlle darin erstellten Termine werden unwiderruflich gelöscht.\nBetroffene Termine: ${count}`))return;
    }else if(!confirm('Diese Kalenderquelle wirklich entfernen?'))return;
    state.calendars[i].links.splice(idx,1);
    state.calendars[i].events=(state.calendars[i].events||[]).filter(e=>e.icsId!==target.id);
    state.calendars[i].ownEvents=(state.calendars[i].ownEvents||[]).filter(e=>e.sourceId!==target.id);
    render();
    await dbDeleteRowRev041('calendar_sources',target.id);
  });
  $$('[data-delete-cal]').forEach(b=>b.onclick=async(ev)=>{ev.stopPropagation();if(!requireLogin())return;const i=Number(b.dataset.deleteCal);const cal=state.calendars[i];if(!cal)return;if(!confirm('Kalender inklusive aller Quellen und eigenen Terminen löschen?'))return;state.calendars.splice(i,1);render();await dbDeleteRowRev041('calendar_groups',cal.id);});
};

// Gruppenlöschung: zuerst betroffene Tasks lokal und tabellarisch auf Fallback-Gruppe verschieben, dann Gruppe gezielt löschen.
const __rev041_renderTaskColumnConfig=renderTaskColumnConfig;
renderTaskColumnConfig=function(){
  __rev041_renderTaskColumnConfig();
  $$('[data-delete-taskcol]').forEach(b=>b.onclick=async()=>{if(!requireLogin())return;const idx=Number(b.dataset.deleteTaskcol);if(state.taskColumns.length<=1)return toast('Mindestens eine Tagestask-Gruppe bleibt erhalten.');const col=state.taskColumns[idx];if(!confirm('Tagestask-Gruppe löschen? Bestehende Tasks werden in die erste verfügbare Spalte verschoben.'))return;const fallback=state.taskColumns.find((_,i)=>i!==idx)?.id||null;state.tasks.forEach(t=>{if(t.columnId===col.id)t.columnId=fallback;});state.taskColumns.splice(idx,1);render();if(fallback)await supabaseClient.from('tasks').update({task_group_id:fallback}).eq('user_id',currentUser.id).eq('task_group_id',col.id);await dbDeleteRowRev041('task_groups',col.id);scheduleRelationalSave();});
};
const __rev041_renderLongColumnConfig=renderLongColumnConfig;
renderLongColumnConfig=function(){
  __rev041_renderLongColumnConfig();
  $$('[data-delete-longcol]').forEach(b=>b.onclick=async()=>{if(!requireLogin())return;const idx=Number(b.dataset.deleteLongcol);if(state.longColumns.length<=1)return toast('Mindestens eine langfristige Gruppe bleibt erhalten.');const col=state.longColumns[idx];if(!confirm('Langfristige Gruppe löschen? Bestehende Tasks werden in die erste verfügbare Gruppe verschoben.'))return;const fallback=state.longColumns.find((_,i)=>i!==idx)?.id||null;state.longterm.forEach(t=>{if(t.columnId===col.id)t.columnId=fallback;});state.longColumns.splice(idx,1);render();if(fallback)await supabaseClient.from('long_tasks').update({long_task_group_id:fallback}).eq('user_id',currentUser.id).eq('long_task_group_id',col.id);await dbDeleteRowRev041('long_task_groups',col.id);scheduleRelationalSave();});
};


/* Rev 042 Sicherheitsfix: Tabellen sind Quelle der Wahrheit, keine Löschung bei Reload/Schließen. */
let relationalDataLoadedRev042=false;
const __rev042_loadStateFromCloud=loadStateFromCloud;
loadStateFromCloud=async function(){
  relationalDataLoadedRev042=false;
  await __rev042_loadStateFromCloud();
  if(currentUser) relationalDataLoadedRev042=true;
};

// Relationale Speicherung darf nur nach vollständig geladenen Tabellen laufen.
scheduleRelationalSave=function(){
  if(!currentUser||suppressCloudSave||!relationalDataLoadedRev042)return;
  clearTimeout(relationalSaveTimer);
  relationalSaveTimer=setTimeout(saveRelationalSnapshot,180);
};

// Vollständig entschärfter Snapshot: nur UPSERT, niemals automatisches DELETE.
saveRelationalSnapshot=async function(){
  if(!currentUser||suppressCloudSave||!relationalDataLoadedRev042)return;
  if(relationalSaveRunning){relationalSaveQueued=true;return;}
  relationalSaveRunning=true;
  try{
    normalizeRelationalIds();
    const uid=currentUser.id;
    const calendarGroups=(state.calendars||[]).map((c,i)=>({id:c.id,user_id:uid,name:c.name||`Kalender ${i+1}`,visible:c.visible!==false,collapsed:c.collapsed!==false,position:i}));
    const calendarSources=[];
    (state.calendars||[]).forEach((c)=>{(c.links||[]).forEach((l,j)=>calendarSources.push({id:l.id,user_id:uid,calendar_group_id:c.id,type:l.type||'ics',name:l.name||'Kalenderquelle',url:l.type==='own'?null:(l.url||null),color:l.color||state.colors?.event||defaultColors.event,visible:l.visible!==false,position:j}));});
    const taskGroups=(state.taskColumns||[]).map((g,i)=>({id:g.id,user_id:uid,name:g.name||`Gruppe ${i+1}`,color:g.color||state.colors?.task||defaultColors.task,visible:g.visible!==false,position:i}));
    const tasks=(state.tasks||[]).map((t,i)=>({id:t.id,user_id:uid,task_group_id:isUuid(t.columnId)?t.columnId:null,title:t.title||'Ohne Titel',note:t.note||null,task_date:t.date||fmtDate(new Date()),done:!!t.done,completed_date:t.completedDate||null,position:i}));
    const longTaskGroups=(state.longColumns||[]).map((g,i)=>({id:g.id,user_id:uid,name:g.name||`Gruppe ${i+1}`,color:g.color||state.colors?.long||defaultColors.long,visible:g.visible!==false,position:i}));
    const longTasks=(state.longterm||[]).map((t,i)=>({id:t.id,user_id:uid,long_task_group_id:isUuid(t.columnId)?t.columnId:null,title:t.title||'Ohne Titel',note:t.note||null,done:!!t.done,completed_date:t.completedDate||null,position:i}));
    const ownEvents=[];
    (state.calendars||[]).forEach(c=>(c.ownEvents||[]).forEach((e,i)=>ownEvents.push({id:e.id,user_id:uid,calendar_source_id:e.sourceId,title:e.summary||e.title||'Ohne Titel',location:e.location||null,description:e.description||null,start_time:e.start,end_time:e.end||null,all_day:!!e.allDay,recurrence:e.recurrence||'none',travel_time:e.travelTime||null,status:e.status||'active'})));
    await upsertRows('calendar_groups',calendarGroups);
    await upsertRows('calendar_sources',calendarSources);
    await upsertRows('task_groups',taskGroups);
    await upsertRows('tasks',tasks);
    await upsertRows('long_task_groups',longTaskGroups);
    await upsertRows('long_tasks',longTasks);
    await upsertRows('own_events',ownEvents);
    const diag=document.querySelector('#diagBox'); if(diag)diag.textContent='Tabellen sicher gespeichert: '+new Date().toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'});
  }catch(error){
    console.error('Sichere Tabellen-Speicherung fehlgeschlagen',error);
    setCloudStatus('Tabellen-Speichern fehlgeschlagen: '+(error.message||error),'bad');
  }finally{
    relationalSaveRunning=false;
    if(relationalSaveQueued){relationalSaveQueued=false;scheduleRelationalSave();}
  }
};

// AppState bleibt UI-only. Fachdatenspeicherung wird nicht beim Entladen erzwungen.
persist=function(){
  if(currentUser){localStorage.setItem(storeKey,JSON.stringify(uiStateOnly()));}else{localStorage.removeItem(storeKey);}
  if(cloudReady&&currentUser&&!suppressCloudSave){scheduleCloudSave();}
};

// Sicherheitsregel: Beim Schließen/Reload niemals signOut/reset/render/save auslösen.
function noopPagehideRev042(){ localStorage.removeItem(storeKey); }



/* Rev 043 Sicherheitsfix Multi-Gerät: Keine Frontend-Snapshots mehr für Fachdaten.
   Datenbanktabellen sind Quelle der Wahrheit. Fachliche Änderungen laufen nur noch
   über gezielte INSERT/UPDATE/DELETE-Operationen. Dadurch kann ein zweites Gerät
   mit leerem/teilgeladenem State keine Task-Tabelle mehr überschreiben oder leeren. */
function currentTaskGroupIdRev043(){
  ensureSettings();
  const g=(state.taskColumns||[]).find(x=>isUuid(x.id))||(state.taskColumns||[])[0];
  return g?.id||null;
}
function currentLongGroupIdRev043(){
  ensureRev033State();
  const g=(state.longColumns||[]).find(x=>isUuid(x.id))||(state.longColumns||[])[0];
  return g?.id||null;
}
async function insertTaskRev043(task){
  if(!currentUser)throw new Error('Nicht angemeldet');
  const row={
    user_id:currentUser.id,
    task_group_id:isUuid(task.columnId)?task.columnId:null,
    title:task.title||'Ohne Titel',
    note:task.note||null,
    task_date:task.date||fmtDate(new Date()),
    done:!!task.done,
    completed_date:task.completedDate||null,
    position:state.tasks?.length||0
  };
  const {data,error}=await supabaseClient.from('tasks').insert(row).select('*').single();
  if(error)throw error;
  return {id:data.id,title:data.title,note:data.note||'',date:data.task_date,done:!!data.done,completedDate:data.completed_date||null,columnId:data.task_group_id||currentTaskGroupIdRev043()};
}
async function insertLongTaskRev043(task){
  if(!currentUser)throw new Error('Nicht angemeldet');
  const row={
    user_id:currentUser.id,
    long_task_group_id:isUuid(task.columnId)?task.columnId:null,
    title:task.title||'Ohne Titel',
    note:task.note||null,
    done:!!task.done,
    completed_date:task.completedDate||null,
    position:state.longterm?.length||0
  };
  const {data,error}=await supabaseClient.from('long_tasks').insert(row).select('*').single();
  if(error)throw error;
  return {id:data.id,title:data.title,note:data.note||'',done:!!data.done,completedDate:data.completed_date||null,columnId:data.long_task_group_id||currentLongGroupIdRev043(),createdDate:data.created_at?fmtDate(new Date(data.created_at)):fmtDate(new Date())};
}
async function updateTaskRev043(id,patch){
  if(!currentUser||!isUuid(id))return;
  const {error}=await supabaseClient.from('tasks').update(patch).eq('user_id',currentUser.id).eq('id',id);
  if(error)throw error;
}
async function updateLongTaskRev043(id,patch){
  if(!currentUser||!isUuid(id))return;
  const {error}=await supabaseClient.from('long_tasks').update(patch).eq('user_id',currentUser.id).eq('id',id);
  if(error)throw error;
}

// Keine automatischen Fachdatensnapshots mehr. AppState speichert weiterhin nur UI.
scheduleRelationalSave=function(){ return; };
saveRelationalSnapshot=async function(){ return; };
persist=function(){
  if(currentUser){localStorage.setItem(storeKey,JSON.stringify(uiStateOnly()));}else{localStorage.removeItem(storeKey);}
  if(cloudReady&&currentUser&&!suppressCloudSave){scheduleCloudSave();}
};

// Tagestask-Anlage: erst Datenbank INSERT, dann lokaler State. Kein Snapshot.
openTaskModal=function(date=fmtDate(new Date())){
  if(!requireLogin())return;ensureSettings();
  openModal('Tagestask hinzufügen',`<input id="mTitle" placeholder="Aufgabe"><select id="mTaskColumn">${state.taskColumns.map(c=>`<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`).join('')}</select><input id="mDate" type="date" value="${date}"><textarea id="mNote" rows="3" placeholder="Notiz / Kontext"></textarea>`,async()=>{
    const title=$('#mTitle').value.trim();
    if(!title)return toast('Aufgabe ohne Titel wurde nicht gespeichert.');
    try{
      const saved=await insertTaskRev043({title,date:$('#mDate').value,done:false,note:$('#mNote').value.trim(),columnId:$('#mTaskColumn').value});
      state.tasks.push(saved);render();toast('Tagestask gespeichert.');
    }catch(error){toast('Tagestask konnte nicht gespeichert werden: '+(error.message||error));}
  });
};

// Langfristige Task-Anlage: erst Datenbank INSERT, dann lokaler State. Kein Snapshot.
openLongModal=function(){
  if(!requireLogin())return;ensureRev033State();
  openModal('Langfristigen Task hinzufügen',`<input id="mTitle" placeholder="Langfristiger Task"><select id="mLongColumn">${state.longColumns.map(c=>`<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`).join('')}</select><textarea id="mNote" rows="3" placeholder="Notiz"></textarea>`,async()=>{
    const title=$('#mTitle').value.trim();
    if(!title)return toast('Aufgabe ohne Titel wurde nicht gespeichert.');
    try{
      const saved=await insertLongTaskRev043({title,done:false,note:$('#mNote').value.trim(),columnId:$('#mLongColumn').value});
      state.longterm.push(saved);render();toast('Langfristiger Task gespeichert.');
    }catch(error){toast('Langfristiger Task konnte nicht gespeichert werden: '+(error.message||error));}
  });
};

// Task-Detail: Änderungen gezielt per UPDATE/INSERT/DELETE speichern.
openTaskDetailModal=function(ref){
  if(!requireLogin())return;ensureRev033State();
  const [type,id]=ref.split(':');const isLong=type==='long';
  const t=isLong?state.longterm.find(x=>x.id===id):state.tasks.find(x=>x.id===id);if(!t)return;
  $('#modalTitle').textContent=isLong?'Langfristigen Task bearbeiten':'Tagestask bearbeiten';
  const moveOptions=!isLong?`${state.taskColumns.map(c=>`<option value="task:${escapeHtml(c.id)}" ${(t.columnId||state.taskColumns[0]?.id)===c.id?'selected':''}>${escapeHtml(c.name)}</option>`).join('')}${state.longColumns.map(c=>`<option value="long:${escapeHtml(c.id)}">${escapeHtml(c.name)} (langfristig)</option>`).join('')}`:'';
  $('#modalContent').innerHTML=`<div class="edit-grid"><label>Titel</label><input id="editTaskTitle" value="${escapeHtml(t.title||'')}">${isLong?`<label>Gruppe</label><select id="editLongColumn">${state.longColumns.map(c=>`<option value="${escapeHtml(c.id)}" ${(t.columnId||state.longColumns[0]?.id)===c.id?'selected':''}>${escapeHtml(c.name)}</option>`).join('')}</select><label>Verschieben</label><select id="moveLongToTask"><option value="keep">Langfristiger Task bleiben</option><option value="today">In Tagestask für heute verschieben</option></select>`:`<label>Verschieben</label><select id="moveTaskTarget">${moveOptions}</select><label>Soll-Datum</label><input id="editTaskDate" type="date" value="${escapeHtml(t.date||fmtDate(new Date()))}">`}<label>Status</label><select id="editTaskDone"><option value="false" ${!t.done?'selected':''}>Offen</option><option value="true" ${t.done?'selected':''}>Erledigt</option></select><label>Erledigt am</label><input id="editTaskCompleted" type="date" value="${escapeHtml(t.completedDate||'')}"><label>Notiz</label><textarea id="editTaskNote" rows="7">${escapeHtml(t.note||'')}</textarea></div>`;
  $('#modalBackdrop').style.display='flex';$('#saveModal').style.display='';
  $('#saveModal').onclick=async()=>{
    try{
      const title=$('#editTaskTitle').value.trim()||t.title||'Ohne Titel';
      const done=$('#editTaskDone').value==='true';
      let completed=$('#editTaskCompleted').value||null;if(done&&!completed)completed=fmtDate(new Date());if(!done)completed=null;
      const note=$('#editTaskNote').value.trim();
      if(isLong){
        if($('#moveLongToTask').value==='today'){
          const saved=await insertTaskRev043({title,date:fmtDate(new Date()),done,note,columnId:currentTaskGroupIdRev043(),completedDate:completed});
          await dbDeleteRowRev041('long_tasks',t.id);
          state.tasks.push(saved);state.longterm=state.longterm.filter(x=>x.id!==t.id);
        }else{
          t.title=title;t.done=done;t.completedDate=completed;t.note=note;t.columnId=$('#editLongColumn').value;
          await updateLongTaskRev043(t.id,{title,note:note||null,done,completed_date:completed,long_task_group_id:isUuid(t.columnId)?t.columnId:null});
        }
      }else{
        const target=$('#moveTaskTarget').value;
        if(target.startsWith('long:')){
          const longGroupId=target.slice(5);
          const saved=await insertLongTaskRev043({title,done,note,columnId:longGroupId,completedDate:completed});
          await dbDeleteRowRev041('tasks',t.id);
          state.longterm.push(saved);state.tasks=state.tasks.filter(x=>x.id!==t.id);
        }else{
          const taskGroupId=target.replace(/^task:/,'');
          t.title=title;t.done=done;t.completedDate=completed;t.note=note;t.date=$('#editTaskDate').value||t.date;t.columnId=taskGroupId;
          await updateTaskRev043(t.id,{title,note:note||null,task_date:t.date,done,completed_date:completed,task_group_id:isUuid(taskGroupId)?taskGroupId:null});
        }
      }
      closeModal();render();toast('Änderung gespeichert.');
    }catch(error){toast('Änderung konnte nicht gespeichert werden: '+(error.message||error));}
  };
  $('#modalContent').onkeydown=e=>{if(e.key==='Enter'&&e.target.tagName!=='TEXTAREA'){e.preventDefault();$('#saveModal').click();}else if(e.key==='Enter'&&e.ctrlKey){e.preventDefault();$('#saveModal').click();}};
};



/* Rev 044: UI-Korrekturen ohne Änderung der Tabellenarchitektur */
const __rev044_loadRelationalData=loadRelationalData;
loadRelationalData=async function(){
  await __rev044_loadRelationalData();
  // Beim frischen Öffnen standardmäßig Kalendergruppen einklappen; Quellen bleiben erhalten.
  (state.calendars||[]).forEach(c=>{c.collapsed=true;});
};

async function reloadDatabaseDataRev044(){
  if(!requireLogin())return;
  try{
    toast('Lade Daten aus Supabase neu...');
    await loadStateFromCloud();
    toast('Daten aus Datenbanken neu geladen.');
  }catch(error){
    toast('Neuladen fehlgeschlagen: '+(error.message||error));
  }
}

const __rev044_renderTaskColumnConfig=renderTaskColumnConfig;
renderTaskColumnConfig=function(){
  __rev044_renderTaskColumnConfig();
  const root=$('#taskColumnConfig'); if(!root)return;
  const row=root.querySelector('.overdue-color-row');
  const add=root.querySelector('.add-calendar-box');
  if(row){
    // Überzogene Tasks immer nach der letzten Gruppe, aber vor dem Hinzufügen-Block.
    if(add)root.insertBefore(row,add); else root.appendChild(row);
    row.querySelector('span:last-child')?.style.setProperty('font-size','13px','important');
  }
};

const __rev044_renderCalendarConfig=renderCalendarConfig;
renderCalendarConfig=function(){
  __rev044_renderCalendarConfig();
  $$('.calendar-pane').forEach(pane=>{
    // Kalenderquellen sollen beim ersten Rendern eingeklappt bleiben, manuelles Öffnen bleibt in der Session möglich.
    const btn=pane.querySelector('[data-collapse-cal]');
    if(btn)btn.classList.add('cal-collapse-corner');
  });
};

window.addEventListener('pagehide',noopPagehideRev042);


/* Rev 045: zentrierter Farbdialog statt Browser-Farbpicker */
const rev045ExtendedPalette=[
  '#7c5cff','#39bdf8','#22c55e','#ffb020','#ff5050','#ec4899','#14b8a6','#f97316','#a855f7','#64748b','#111827','#ffffff',
  '#ef4444','#dc2626','#b91c1c','#fb7185','#f43f5e','#e11d48','#f97316','#ea580c','#c2410c','#f59e0b','#d97706','#b45309',
  '#84cc16','#65a30d','#4d7c0f','#22c55e','#16a34a','#15803d','#10b981','#059669','#047857','#06b6d4','#0891b2','#0e7490',
  '#38bdf8','#0ea5e9','#0284c7','#3b82f6','#2563eb','#1d4ed8','#6366f1','#4f46e5','#4338ca','#8b5cf6','#7c3aed','#6d28d9',
  '#d946ef','#c026d3','#a21caf','#ec4899','#db2777','#be185d','#94a3b8','#64748b','#475569','#334155','#1e293b','#0f172a'
];
function normalizeHexColorRev045(c){
  c=String(c||'').trim();
  return /^#[0-9a-fA-F]{6}$/.test(c)?c:'#7c5cff';
}
openNativeColorPicker=function(initial,onPick){
  const start=normalizeHexColorRev045(initial);
  let selected=start;
  const old=document.querySelector('.color-dialog-backdrop');
  if(old)old.remove();
  const backdrop=document.createElement('div');
  backdrop.className='color-dialog-backdrop';
  backdrop.innerHTML=`<div class="color-dialog" role="dialog" aria-modal="true">
    <h3>Farbe auswählen</h3>
    <div class="hint">Wähle eine Standardfarbe oder lege eine eigene Farbe fest.</div>
    <div class="color-dialog-main">
      <div class="color-dialog-preview" id="rev045ColorPreview" style="background:${escapeHtml(start)}"></div>
      <div>
        <label class="hint" for="rev045ColorInput">Eigene Farbe</label>
        <input id="rev045ColorInput" type="color" value="${escapeHtml(start)}">
      </div>
    </div>
    <div class="color-dialog-palette">${rev045ExtendedPalette.map(c=>`<button type="button" class="color-dialog-choice ${c.toLowerCase()===start.toLowerCase()?'active':''}" data-rev045-color="${c}" style="background:${c}" title="${c}"></button>`).join('')}</div>
    <div class="color-dialog-actions">
      <button class="btn" type="button" id="rev045ColorCancel">Abbrechen</button>
      <button class="btn primary" type="button" id="rev045ColorSave">Speichern</button>
    </div>
  </div>`;
  document.body.appendChild(backdrop);
  const input=backdrop.querySelector('#rev045ColorInput');
  const preview=backdrop.querySelector('#rev045ColorPreview');
  function setSelected(c){
    selected=normalizeHexColorRev045(c);
    input.value=selected;
    preview.style.background=selected;
    backdrop.querySelectorAll('.color-dialog-choice').forEach(b=>b.classList.toggle('active',String(b.dataset.rev045Color).toLowerCase()===selected.toLowerCase()));
  }
  input.oninput=()=>setSelected(input.value);
  backdrop.querySelectorAll('[data-rev045-color]').forEach(btn=>btn.onclick=()=>setSelected(btn.dataset.rev045Color));
  backdrop.querySelector('#rev045ColorCancel').onclick=()=>backdrop.remove();
  backdrop.querySelector('#rev045ColorSave').onclick=()=>{ if(onPick)onPick(selected); backdrop.remove(); };
  backdrop.onclick=e=>{if(e.target===backdrop)backdrop.remove();};
  setTimeout(()=>input.focus(),0);
};

/* Rev 045: Überzogene Tasks in der Konfiguration unten halten */
const __rev045_renderTaskColumnConfig=renderTaskColumnConfig;
renderTaskColumnConfig=function(){
  __rev045_renderTaskColumnConfig();
  const root=document.querySelector('#taskColumnConfig');
  const row=document.querySelector('.overdue-color-row');
  if(root&&row){
    const add=root.querySelector('.add-calendar-box');
    if(add)root.insertBefore(row,add);
    else root.appendChild(row);
  }
};



/* Rev 046: Datumsausgabe, Settings ohne manuellen ICS-Button, Own-Events INSERT, Projekt-Vorbereitung */
function dateDERev046(value){
  if(!value)return '';
  let d=value instanceof Date?new Date(value):new Date(String(value).includes('T')?String(value):String(value)+'T00:00:00');
  if(isNaN(d))return String(value);
  return `${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')}.${d.getFullYear()}`;
}
function dateWeekdayDERev046(value){
  const d=value instanceof Date?new Date(value):new Date(String(value).includes('T')?String(value):String(value)+'T00:00:00');
  if(isNaN(d))return String(value||'');
  return `${d.toLocaleDateString('de-DE',{weekday:'long'})}, ${dateDERev046(d)}`;
}
deDate=function(d){return dateWeekdayDERev046(d);};
dayHeaderLabel=function(d){return dateWeekdayDERev046(d);};

const __rev046_taskCardHtml=taskCardHtml;
taskCardHtml=function(t,overdue=false,completedView=false){
  const col=(state.taskColumns||[]).find(c=>c.id===t.columnId)||state.taskColumns?.[0]||{name:'Allgemein',color:state.colors.task};
  const shownDate=dateDERev046(t.date);
  const meta=completedView?`Erledigt am ${dateDERev046(t.completedDate)||''}`:(t.note||'Soll: '+shownDate);
  if(completedView){
    return `<div class="card task task-card-compact completed-task-card" data-task-ref="task:${t.id}" style="border-left-color:${escapeHtml(col.color||state.colors.task)}!important"><div class="task-row"><input type="checkbox" checked data-toggle-task="${t.id}"><div><span class="completed-title" title="${escapeHtml(t.title)}">${escapeHtml(shortText(t.title,34))}</span><span class="completed-meta">${escapeHtml(meta)}</span></div><button class="kebab" data-delete-task="${t.id}">×</button></div></div>`;
  }
  return `<div class="card task task-card-compact ${overdue?'overdue':''}" data-task-ref="task:${t.id}" style="border-left-color:${escapeHtml(overdue?state.colors.overdue:(col.color||state.colors.task))}!important"><div class="task-row"><input type="checkbox" ${t.done?'checked':''} data-toggle-task="${t.id}"><div><b title="${escapeHtml(t.title)}">${escapeHtml(shortText(t.title,32))}</b><small title="${escapeHtml(meta)}">${escapeHtml(shortText(meta,38))}</small></div><button class="kebab" data-delete-task="${t.id}">×</button></div></div>`;
};

const __rev046_completedDoneList=completedDoneList;
completedDoneList=function(tasks,longs){
  const a=(tasks||[]).map(t=>taskCardHtml(t,false,true)).join('');
  const b=(longs||[]).map(t=>`<div class="card completed-long completed-task-card" data-task-ref="long:${t.id}"><div><span class="completed-title">${escapeHtml(shortText(t.title,34))}</span><span class="completed-meta">Langfristiger Task erledigt am ${escapeHtml(dateDERev046(t.completedDate))}</span></div></div>`).join('');
  return `<div class="completed-grid">${a}${b}</div>`;
};

openSyncSettingsModal=function(){
  openModal('Allgemeine Einstellungen',`<div class="settings-grid"><div class="field"><label>Erscheinung</label><select id="mTheme"><option value="light">Hell</option><option value="dark">Dunkel</option><option value="blue">Bläulich</option><option value="red">Rötlich</option><option value="green">Grünlich</option></select></div><div class="field"><label>Kanten</label><select id="mCornerStyle"><option value="rounded">Abgerundet</option><option value="sharp">Eckig / 90°</option></select></div><div class="section-title">Synchronisierung</div><div class="field"><label>Intervall</label><select id="mSyncInterval"><option value="0">Aus</option><option value="5">Alle 5 Min.</option><option value="15">Alle 15 Min.</option><option value="30">Alle 30 Min.</option><option value="60">Alle 60 Min.</option></select></div><div class="hint" id="mSyncHint">ICS-Links werden über den automatischen Aktualisierungsplan geladen. Der frühere Button „Alle ICS-Links aktualisieren“ wurde entfernt.</div><div class="security-note"><b>Datenschutzhinweis:</b> Kalenderbezogene Informationen wie Kalenderquellen, ICS-Links, Tasks und eigene Termine liegen nutzerbezogen in der Datenbank. Passwörter werden über Supabase Auth verwaltet und nicht im Klartext angezeigt.</div></div>`,()=>{state.theme=$('#mTheme').value;state.cornerStyle=$('#mCornerStyle').value;state.syncInterval=Number($('#mSyncInterval').value);state.fetchMode='proxy';state.proxyUrl=state.proxyUrl||DEFAULT_PROXY_URL;setupAutoSync();});
  $('#mTheme').value=state.theme||'light';
  $('#mCornerStyle').value=state.cornerStyle||'rounded';
  $('#mSyncInterval').value=String(state.syncInterval??15);
};

async function insertOwnEventRev046(event){
  if(!currentUser)throw new Error('Nicht angemeldet');
  if(!isUuid(event.sourceId))throw new Error('Eigene Kalenderquelle ist noch nicht korrekt in der Datenbank gespeichert. Bitte Daten neu laden und erneut versuchen.');
  const row={
    user_id:currentUser.id,
    calendar_source_id:event.sourceId,
    title:event.summary||event.title||'Ohne Titel',
    location:event.location||null,
    description:event.description||null,
    start_time:event.start,
    end_time:event.end||null,
    all_day:!!event.allDay,
    recurrence:event.recurrence||'none',
    travel_time:event.travelTime||null,
    status:event.status||'active'
  };
  const {data,error}=await supabaseClient.from('own_events').insert(row).select('*').single();
  if(error)throw error;
  return Object.assign({},event,{id:data.id});
}
async function ownEventExistsRev046(id){
  if(!currentUser||!isUuid(id))return false;
  const {data,error}=await supabaseClient.from('own_events').select('id').eq('user_id',currentUser.id).eq('id',id).maybeSingle();
  if(error)throw error;
  return !!data;
}
async function deleteOwnEventRev046(id){
  if(!currentUser||!isUuid(id))throw new Error('Termin ist nicht sauber in der Datenbank referenziert.');
  const exists=await ownEventExistsRev046(id);
  if(!exists)throw new Error('Der Termin existiert nicht mehr. Er wurde vermutlich auf einem anderen Gerät gelöscht.');
  const {error}=await supabaseClient.from('own_events').delete().eq('user_id',currentUser.id).eq('id',id);
  if(error)throw error;
}

openOwnEventModal=function(pane,date=fmtDate(new Date())){
  if(!requireLogin())return;
  const cal=state.calendars[pane];
  const ownSources=(cal.links||[]).filter(l=>l.type==='own'&&l.visible!==false);
  if(!ownSources.length)return toast('Kein eigener Kalender sichtbar. Füge zuerst einen eigenen Kalender hinzu.');
  openModal(`Termin hinzufügen · ${escapeHtml(cal.name)}`,`<input id="mEventTitle" placeholder="Titel des Termins"><select id="mEventSource">${ownSources.map(l=>`<option value="${escapeHtml(l.id)}">${escapeHtml(l.name)}</option>`).join('')}</select><input id="mEventLocation" placeholder="Ort"><div class="field"><label>Datum</label><div class="date-row"><input id="mEventDate" type="date" value="${date}"></div></div><div class="field"><label>Wiederholung</label><select id="mEventRecurrence"><option value="none">Keine Wiederholung</option><option value="weekly">Wöchentlich</option><option value="monthly">Monatlich</option><option value="yearly">Jährlich</option></select></div><div class="field"><label>Ganztägig</label><select id="mEventAllDay"><option value="false">Nein</option><option value="true">Ja</option></select></div><div class="field"><label>Startzeit</label><input id="mEventStart" type="time" value="09:00"></div><div class="field"><label>Endzeit</label><input id="mEventEnd" type="time" value="10:00"></div><input id="mEventTravel" placeholder="Wegzeit, z. B. 20 Min."><textarea id="mEventDescription" rows="4" placeholder="Details / Notizen"></textarea>`,async()=>{
    const title=$('#mEventTitle').value.trim();
    if(!title)return toast('Termin ohne Titel wurde nicht gespeichert.');
    const sourceId=$('#mEventSource').value;
    const src=(cal.links||[]).find(l=>l.id===sourceId);
    const d=$('#mEventDate').value||date;
    const allDay=$('#mEventAllDay').value==='true';
    const recurrence=$('#mEventRecurrence').value||'none';
    const st=$('#mEventStart').value||'00:00';
    const en=$('#mEventEnd').value||st;
    const start=allDay?new Date(d+'T00:00:00'):new Date(d+'T'+st+':00');
    const end=allDay?new Date(d+'T23:59:00'):new Date(d+'T'+en+':00');
    const event={sourceId,summary:title,location:$('#mEventLocation').value.trim(),start:start.toISOString(),end:end.toISOString(),allDay,recurrence,source:src?.name||cal.name,icsName:src?.name||cal.name,icsColor:src?.color||state.colors.event,travelTime:$('#mEventTravel').value.trim(),description:$('#mEventDescription').value.trim(),manual:true,status:'active'};
    try{
      const saved=await insertOwnEventRev046(event);
      cal.ownEvents=cal.ownEvents||[];
      cal.ownEvents.push(saved);
      render();
      toast('Eigener Termin in own_events gespeichert.');
    }catch(error){toast('Eigener Termin konnte nicht gespeichert werden: '+(error.message||error));}
  });
};

const __rev046_openEventDetailModal=openEventDetailModal;
openEventDetailModal=function(ref){
  __rev046_openEventDetailModal(ref);
  const [type,calIdx,evtIdx]=ref.split(':');
  if(type!=='own')return;
  const del=$('#deleteOwnEvent');
  if(!del)return;
  del.onclick=async()=>{
    const cal=state.calendars[Number(calIdx)];
    const evt=(cal.ownEvents||[])[Number(evtIdx)];
    if(!evt)return toast('Termin lokal nicht gefunden.');
    if(!confirm('Eigenen Termin / Serie löschen?'))return;
    try{
      await deleteOwnEventRev046(evt.id);
      cal.ownEvents.splice(Number(evtIdx),1);
      closeModal();render();toast('Eigener Termin gelöscht.');
    }catch(error){toast(error.message||String(error));closeModal();await loadStateFromCloud();}
  };
};

const __rev046_renderLong=renderLong;
renderLong=function(){
  __rev046_renderLong();
  const box=document.querySelector('.main-longterm');
  if(box && !document.querySelector('#rev046ProjectPlanningNote')){
    const note=document.createElement('div');
    note.id='rev046ProjectPlanningNote';
    note.className='rev046-planning-note';
    note.innerHTML='<b>Aufgenommen für nächste Revision:</b> Projektpartition mit Projekten, Projekt-Tasks, Tagesintegration und späteren Tabellen für Projekte, Projekt-Tasks und Audit-Logs. Noch keine neuen SQL-Tabellen in dieser Revision.';
    box.appendChild(note);
  }
};



/* Rev 047: Projekte, Projekt-Tasks und Audit-Logs */
function ensureProjectsRev047(){
  state.projects=Array.isArray(state.projects)?state.projects:[];
  state.projectTasks=Array.isArray(state.projectTasks)?state.projectTasks:[];
}
const __rev047_ensureSettings=ensureSettings;
ensureSettings=function(){__rev047_ensureSettings();ensureProjectsRev047();};

const rev047Css=document.createElement('style');
rev047Css.textContent=`
.project-section{margin-top:18px;box-shadow:none;width:100%}
.project-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px;align-items:start}
.project-card{background:#070d1a;border:1px solid #293955;border-radius:16px;padding:12px;border-left:4px solid var(--violet);min-width:0;overflow:hidden}
.project-card-head{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:start;margin-bottom:8px}
.project-card-title{font-weight:1000;line-height:1.2;white-space:normal;overflow-wrap:anywhere}
.project-card-desc{font-size:12px;color:var(--muted);line-height:1.35;margin-top:4px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.project-actions{display:flex;gap:6px;align-items:center;justify-content:flex-end;flex-wrap:nowrap}
.project-task-list{display:grid;gap:7px;margin-top:10px}
.project-task-item{background:#060b16;border:1px solid #23324d;border-radius:12px;padding:8px;display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:8px;align-items:start}
.project-task-item.done{opacity:.62}.project-task-item.done b{text-decoration:line-through}
.project-task-item b{font-size:13px;line-height:1.2;display:block;white-space:normal;overflow-wrap:anywhere}
.project-task-item small{display:block;color:var(--muted);font-size:11px;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.project-day-lane{background:#070d1a;border:1px dashed #293955;border-radius:14px;padding:8px;min-width:0}
.project-day-title{font-size:11px;font-weight:1000;color:var(--muted);margin-bottom:6px;display:flex;align-items:center;gap:6px;text-transform:uppercase;letter-spacing:.06em}
.project-dot{width:12px;height:12px;border-radius:999px;border:1px solid rgba(255,255,255,.28);flex:0 0 12px}
body.light .project-card,body.light .project-day-lane,body.light .project-task-item{background:#f8fbff;border-color:#cbd6e7;color:#152033}
body.sharp-corners .project-card,body.sharp-corners .project-day-lane,body.sharp-corners .project-task-item{border-radius:0!important}
`;
document.head.appendChild(rev047Css);

async function logProjectTaskRev047(action,oldData,newData){
  if(!currentUser)return;
  try{
    await supabaseClient.from('project_task_logs').insert({
      user_id:currentUser.id,
      project_id:(newData&&newData.projectId)||(oldData&&oldData.projectId)||null,
      project_task_id:(newData&&newData.id)||(oldData&&oldData.id)||null,
      action,old_data:oldData||null,new_data:newData||null
    });
  }catch(e){console.warn('Projekt-Task-Log fehlgeschlagen',e);}
}
async function logOwnEventRev047(action,oldData,newData){
  if(!currentUser)return;
  try{
    await supabaseClient.from('own_event_logs').insert({
      user_id:currentUser.id,
      own_event_id:(newData&&newData.id)||(oldData&&oldData.id)||null,
      action,old_data:oldData||null,new_data:newData||null
    });
  }catch(e){console.warn('Own-Event-Log fehlgeschlagen',e);}
}

const __rev047_insertOwnEventRev046=insertOwnEventRev046;
insertOwnEventRev046=async function(event){
  const saved=await __rev047_insertOwnEventRev046(event);
  await logOwnEventRev047('create',null,saved);
  return saved;
};
const __rev047_deleteOwnEventRev046=deleteOwnEventRev046;
deleteOwnEventRev046=async function(id){
  let oldData=null;
  try{
    const {data}=await supabaseClient.from('own_events').select('*').eq('user_id',currentUser.id).eq('id',id).maybeSingle();
    oldData=data||null;
  }catch(e){}
  await __rev047_deleteOwnEventRev046(id);
  await logOwnEventRev047('delete',oldData,{id});
};

const __rev047_loadRelationalData=loadRelationalData;
loadRelationalData=async function(){
  await __rev047_loadRelationalData();
  ensureProjectsRev047();
  if(!currentUser)return;
  const uid=currentUser.id;
  try{
    const [pr,pt]=await Promise.all([
      supabaseClient.from('projects').select('*').eq('user_id',uid).order('sort_order',{ascending:true}),
      supabaseClient.from('project_tasks').select('*').eq('user_id',uid).order('sort_order',{ascending:true})
    ]);
    if(pr.error)throw pr.error;if(pt.error)throw pt.error;
    state.projects=(pr.data||[]).map(p=>({id:p.id,name:p.name,description:p.description||'',color:p.color||'#7c5cff',sortOrder:p.sort_order||0,isArchived:!!p.is_archived,createdAt:p.created_at,updatedAt:p.updated_at}));
    state.projectTasks=(pt.data||[]).map(t=>({id:t.id,projectId:t.project_id,title:t.title,note:t.note||'',dueDate:t.due_date||'',done:!!t.done,completedDate:t.completed_date||null,sortOrder:t.sort_order||0,createdAt:t.created_at,updatedAt:t.updated_at}));
  }catch(error){
    console.error('Projekt-Daten konnten nicht geladen werden',error);
    toast('Projekt-Daten konnten nicht geladen werden: '+(error.message||error));
  }
};

function projectByIdRev047(id){ensureProjectsRev047();return state.projects.find(p=>p.id===id);}
function projectTasksForRev047(projectId){ensureProjectsRev047();return state.projectTasks.filter(t=>t.projectId===projectId).sort((a,b)=>(a.done-b.done)||String(a.dueDate||'9999').localeCompare(String(b.dueDate||'9999'))||(a.sortOrder||0)-(b.sortOrder||0));}
async function insertProjectRev047(project){
  if(!currentUser)throw new Error('Nicht angemeldet');
  const row={user_id:currentUser.id,name:project.name||'Neues Projekt',description:project.description||null,color:project.color||'#7c5cff',sort_order:state.projects.length,is_archived:false};
  const {data,error}=await supabaseClient.from('projects').insert(row).select('*').single();
  if(error)throw error;
  return {id:data.id,name:data.name,description:data.description||'',color:data.color||'#7c5cff',sortOrder:data.sort_order||0,isArchived:!!data.is_archived,createdAt:data.created_at,updatedAt:data.updated_at};
}
async function updateProjectRev047(id,patch){
  if(!currentUser||!isUuid(id))throw new Error('Projekt ist nicht sauber in der Datenbank referenziert.');
  const {data:exists,error:readError}=await supabaseClient.from('projects').select('id').eq('user_id',currentUser.id).eq('id',id).maybeSingle();
  if(readError)throw readError;if(!exists)throw new Error('Das Projekt existiert nicht mehr. Es wurde vermutlich auf einem anderen Gerät gelöscht.');
  const dbPatch={updated_at:new Date().toISOString()};
  if(patch.name!==undefined)dbPatch.name=patch.name;
  if(patch.description!==undefined)dbPatch.description=patch.description||null;
  if(patch.color!==undefined)dbPatch.color=patch.color;
  if(patch.isArchived!==undefined)dbPatch.is_archived=!!patch.isArchived;
  const {error}=await supabaseClient.from('projects').update(dbPatch).eq('user_id',currentUser.id).eq('id',id);
  if(error)throw error;
}
async function deleteProjectRev047(id){
  if(!currentUser||!isUuid(id))throw new Error('Projekt ist nicht sauber in der Datenbank referenziert.');
  const oldProject=projectByIdRev047(id)||{id};
  const oldTasks=projectTasksForRev047(id);
  const {error}=await supabaseClient.from('projects').delete().eq('user_id',currentUser.id).eq('id',id);
  if(error)throw error;
  for(const t of oldTasks){await logProjectTaskRev047('delete_project_cascade',t,null);}
  await logProjectTaskRev047('delete_project',oldProject,null);
}
async function insertProjectTaskRev047(task){
  if(!currentUser)throw new Error('Nicht angemeldet');
  if(!isUuid(task.projectId))throw new Error('Projekt ist nicht sauber in der Datenbank referenziert.');
  const row={user_id:currentUser.id,project_id:task.projectId,title:task.title||'Ohne Titel',note:task.note||null,due_date:task.dueDate||null,done:!!task.done,completed_date:task.completedDate||null,sort_order:state.projectTasks.length};
  const {data,error}=await supabaseClient.from('project_tasks').insert(row).select('*').single();
  if(error)throw error;
  const saved={id:data.id,projectId:data.project_id,title:data.title,note:data.note||'',dueDate:data.due_date||'',done:!!data.done,completedDate:data.completed_date||null,sortOrder:data.sort_order||0,createdAt:data.created_at,updatedAt:data.updated_at};
  await logProjectTaskRev047('create',null,saved);
  return saved;
}
async function updateProjectTaskRev047(id,patch){
  if(!currentUser||!isUuid(id))throw new Error('Projekt-Task ist nicht sauber in der Datenbank referenziert.');
  const old=state.projectTasks.find(t=>t.id===id)||null;
  const {data:exists,error:readError}=await supabaseClient.from('project_tasks').select('id').eq('user_id',currentUser.id).eq('id',id).maybeSingle();
  if(readError)throw readError;if(!exists)throw new Error('Der Projekt-Task existiert nicht mehr. Er wurde vermutlich auf einem anderen Gerät gelöscht.');
  const dbPatch={updated_at:new Date().toISOString()};
  if(patch.projectId!==undefined)dbPatch.project_id=patch.projectId;
  if(patch.title!==undefined)dbPatch.title=patch.title;
  if(patch.note!==undefined)dbPatch.note=patch.note||null;
  if(patch.dueDate!==undefined)dbPatch.due_date=patch.dueDate||null;
  if(patch.done!==undefined)dbPatch.done=!!patch.done;
  if(patch.completedDate!==undefined)dbPatch.completed_date=patch.completedDate||null;
  const {error}=await supabaseClient.from('project_tasks').update(dbPatch).eq('user_id',currentUser.id).eq('id',id);
  if(error)throw error;
  await logProjectTaskRev047('update',old,Object.assign({},old||{},patch,{id}));
}
async function deleteProjectTaskRev047(id){
  if(!currentUser||!isUuid(id))throw new Error('Projekt-Task ist nicht sauber in der Datenbank referenziert.');
  const old=state.projectTasks.find(t=>t.id===id)||{id};
  const {data:exists,error:readError}=await supabaseClient.from('project_tasks').select('id').eq('user_id',currentUser.id).eq('id',id).maybeSingle();
  if(readError)throw readError;if(!exists)throw new Error('Der Projekt-Task existiert nicht mehr. Er wurde vermutlich auf einem anderen Gerät gelöscht.');
  const {error}=await supabaseClient.from('project_tasks').delete().eq('user_id',currentUser.id).eq('id',id);
  if(error)throw error;
  await logProjectTaskRev047('delete',old,null);
}

function projectTaskCardHtmlRev047(t,compact=false){
  const p=projectByIdRev047(t.projectId)||{name:'Projekt',color:'#7c5cff'};
  const meta=[p.name,t.dueDate?('Soll: '+dateDERev046(t.dueDate)):'ohne Datum',t.note||''].filter(Boolean).join(' · ');
  return `<div class="project-task-item ${t.done?'done':''}" data-project-task-ref="${escapeHtml(t.id)}" style="border-left:4px solid ${escapeHtml(p.color||'#7c5cff')}"><input type="checkbox" ${t.done?'checked':''} data-toggle-project-task="${escapeHtml(t.id)}"><div><b title="${escapeHtml(t.title)}">${escapeHtml(shortText(t.title,compact?30:46))}</b><small title="${escapeHtml(meta)}">${escapeHtml(shortText(meta,compact?42:70))}</small></div><button class="kebab" data-delete-project-task="${escapeHtml(t.id)}">×</button></div>`;
}
function projectTasksForDateHtmlRev047(date){
  ensureProjectsRev047();
  const iso=fmtDate(date);
  const due=state.projectTasks.filter(t=>t.dueDate===iso&&!t.done);
  if(!due.length)return '<div class="empty">Keine Projekt-Tasks.</div>';
  const byProject=new Map();
  due.forEach(t=>{const p=projectByIdRev047(t.projectId)||{id:'_',name:'Projekt',color:'#7c5cff'};if(!byProject.has(p.id))byProject.set(p.id,{project:p,tasks:[]});byProject.get(p.id).tasks.push(t);});
  return `<div class="task-columns">${Array.from(byProject.values()).map(g=>`<div class="project-day-lane"><div class="project-day-title"><span class="project-dot" style="background:${escapeHtml(g.project.color||'#7c5cff')}"></span><span>Projekt: ${escapeHtml(g.project.name)}</span></div>${g.tasks.map(t=>projectTaskCardHtmlRev047(t,true)).join('')}</div>`).join('')}</div>`;
}
function bindProjectTaskEventsRev047(scope=document){
  scope.querySelectorAll('[data-toggle-project-task]').forEach(c=>{c.onclick=ev=>ev.stopPropagation();c.onchange=async(ev)=>{ev.stopPropagation();if(!requireLogin()){c.checked=!c.checked;return;}const t=state.projectTasks.find(x=>x.id===c.dataset.toggleProjectTask);if(!t)return;const old=Object.assign({},t);const done=c.checked;const completed=done?fmtDate(new Date()):null;try{await updateProjectTaskRev047(t.id,{done,completedDate:completed});t.done=done;t.completedDate=completed;render();toast('Projekt-Task aktualisiert.');}catch(error){Object.assign(t,old);c.checked=!done;toast(error.message||String(error));}};});
  scope.querySelectorAll('[data-delete-project-task]').forEach(b=>b.onclick=async(ev)=>{ev.stopPropagation();if(!requireLogin())return;const id=b.dataset.deleteProjectTask;if(!confirm('Projekt-Task löschen?'))return;try{await deleteProjectTaskRev047(id);state.projectTasks=state.projectTasks.filter(t=>t.id!==id);render();toast('Projekt-Task gelöscht.');}catch(error){toast(error.message||String(error));}});
  scope.querySelectorAll('[data-project-task-ref]').forEach(card=>card.onclick=ev=>{if(ev.target.closest('input,button'))return;openProjectTaskDetailModalRev047(card.dataset.projectTaskRef);});
}

const __rev047_dayCard=dayCard;
dayCard=function(date){
  const today=new Date();today.setHours(0,0,0,0);const iso=fmtDate(date);
  const openTasks=state.tasks.filter(t=>t.date===iso&&!t.done);
  const overdue=sameDay(date,today)?state.tasks.filter(t=>t.date<fmtDate(today)&&!t.done):[];
  const visibleTaskIds=visibleTaskColumnIds(); const visibleLongIds=visibleLongColumnIds();
  const completedTasks=state.tasks.filter(t=>t.done&&t.completedDate===iso&&visibleTaskIds.includes(t.columnId||state.taskColumns?.[0]?.id));
  const completedLong=state.longterm.filter(t=>t.done&&t.completedDate===iso&&visibleLongIds.includes(t.columnId||state.longColumns?.[0]?.id));
  const completedProjects=state.projectTasks.filter(t=>t.done&&t.completedDate===iso);
  const showCompleted=completedTasks.length||completedLong.length||completedProjects.length;
  const day=document.createElement('div');day.className='day'+(sameDay(date,today)?' today':'');
  const projectDoneHtml=completedProjects.length?completedProjects.map(t=>projectTaskCardHtmlRev047(t,true)).join(''):'';
  day.innerHTML=`<div class="day-head"><div class="day-num"><span class="day-title-weekday">${escapeHtml(date.toLocaleDateString('de-DE',{weekday:'long'}))}</span><span class="day-title-date">${escapeHtml(dateDERev046(date))}</span></div>${sameDay(date,today)?'<span class="badge">Aktueller Tag</span>':''}</div><div class="day-body"><div class="partition"><div class="part-head"><div class="part-title">1. Terminkalender</div></div><div class="split">${calendarLanes(date)}</div></div><div class="partition"><div class="part-head"><div class="part-title">2. Tagestasks</div><button class="btn small" data-task-date="${iso}">${iconPlus()} Hinzufügen</button></div>${taskColumnsList(openTasks)}</div><div class="partition"><div class="part-head"><div class="part-title">3. Projekt-Tasks</div></div>${projectTasksForDateHtmlRev047(date)}</div>${sameDay(date,today)?`<div class="partition"><div class="part-head"><div class="part-title">4. Überzogene Tasks</div></div>${taskList(overdue,true)}</div>`:''}${showCompleted?`<div class="partition"><div class="part-head"><div class="part-title">${sameDay(date,today)?'5':'4'}. An diesem Tag erledigte Tasks</div></div>${completedDoneList(completedTasks,completedLong)}${projectDoneHtml?`<div class="completed-grid" style="margin-top:8px">${projectDoneHtml}</div>`:''}</div>`:''}</div>`;
  day.querySelector('[data-task-date]').onclick=()=>openTaskModal(iso);
  day.querySelectorAll('[data-toggle-task]').forEach(c=>{c.onclick=ev=>ev.stopPropagation();c.onchange=(ev)=>{ev.stopPropagation();const t=state.tasks.find(x=>x.id===c.dataset.toggleTask);if(!requireLogin()){c.checked=!c.checked;return;}if(t){const done=c.checked;t.done=done;t.completedDate=done?fmtDate(new Date()):null;updateTaskRev043(t.id,{done,completed_date:t.completedDate}).catch(error=>toast(error.message||String(error)));render();}}});
  day.querySelectorAll('[data-delete-task]').forEach(b=>b.onclick=(ev)=>{ev.stopPropagation();if(!requireLogin())return;state.tasks=state.tasks.filter(x=>x.id!==b.dataset.deleteTask);dbDeleteRowRev041('tasks',b.dataset.deleteTask).catch(error=>toast(error.message||String(error)));render();});
  day.querySelectorAll('[data-task-ref]').forEach(card=>card.onclick=()=>openTaskDetailModal(card.dataset.taskRef));
  day.querySelectorAll('[data-add-own-event]').forEach(b=>b.onclick=(ev)=>{ev.stopPropagation();const [ci,iso]=b.dataset.addOwnEvent.split(':');openOwnEventModal(Number(ci),iso);});
  day.querySelectorAll('[data-event-ref]').forEach(card=>card.onclick=()=>openEventDetailModal(card.dataset.eventRef));
  bindProjectTaskEventsRev047(day);
  return day;
};

function renderProjectsRev047(){
  ensureProjectsRev047();
  let section=document.querySelector('#projectsSectionRev047');
  const longBox=document.querySelector('.main-longterm');
  if(!section&&longBox){
    section=document.createElement('section');
    section.id='projectsSectionRev047';
    section.className='longterm project-section';
    longBox.insertAdjacentElement('afterend',section);
  }
  if(!section)return;
  const visibleProjects=state.projects.filter(p=>!p.isArchived);
  section.innerHTML=`<div class="timeline-controls"><div><b>Projekte</b><div class="hint">Projektgruppen mit Projekt-Tasks. Fällige Projekt-Tasks erscheinen zusätzlich im Tagesplaner.</div></div><button class="btn small" id="addProjectBtnRev047">${iconPlus()} Projekt</button></div><div class="project-grid">${visibleProjects.length?visibleProjects.map(p=>{const tasks=projectTasksForRev047(p.id);return `<article class="project-card" style="border-left-color:${escapeHtml(p.color||'#7c5cff')}"><div class="project-card-head"><div><div class="project-card-title">${escapeHtml(p.name)}</div>${p.description?`<div class="project-card-desc">${escapeHtml(p.description)}</div>`:''}</div><div class="project-actions"><button class="btn small ui-icon-btn" data-edit-project="${escapeHtml(p.id)}" title="Projekt bearbeiten">${iconSettings()}</button><button class="btn small add-source-plus" data-add-project-task="${escapeHtml(p.id)}" title="Projekt-Task hinzufügen">${iconPlus()}</button><button class="btn small ui-icon-btn trash-unified" data-delete-project="${escapeHtml(p.id)}" title="Projekt löschen">${iconTrash()}</button></div></div><div class="project-task-list">${tasks.length?tasks.map(t=>projectTaskCardHtmlRev047(t)).join(''):'<div class="empty">Noch keine Projekt-Tasks.</div>'}</div></article>`}).join(''):'<div class="empty">Noch keine Projekte angelegt.</div>'}</div>`;
  const add=section.querySelector('#addProjectBtnRev047');if(add)add.onclick=()=>openProjectModalRev047(null);
  section.querySelectorAll('[data-edit-project]').forEach(b=>b.onclick=()=>openProjectModalRev047(b.dataset.editProject));
  section.querySelectorAll('[data-add-project-task]').forEach(b=>b.onclick=()=>openProjectTaskModalRev047(b.dataset.addProjectTask));
  section.querySelectorAll('[data-delete-project]').forEach(b=>b.onclick=async()=>{if(!requireLogin())return;const id=b.dataset.deleteProject;if(!confirm('Projekt inklusive aller Projekt-Tasks löschen?'))return;try{await deleteProjectRev047(id);state.projects=state.projects.filter(p=>p.id!==id);state.projectTasks=state.projectTasks.filter(t=>t.projectId!==id);render();toast('Projekt gelöscht.');}catch(error){toast(error.message||String(error));}});
  bindProjectTaskEventsRev047(section);
}

const __rev047_renderLong=renderLong;
renderLong=function(){
  __rev047_renderLong();
  const old=document.querySelector('#rev046ProjectPlanningNote');if(old)old.remove();
  renderProjectsRev047();
};

function openProjectModalRev047(id){
  if(!requireLogin())return;ensureProjectsRev047();
  const isNew=!id;const p=isNew?{name:'',description:'',color:'#7c5cff'}:projectByIdRev047(id);if(!p)return;
  openModal(isNew?'Projekt hinzufügen':'Projekt bearbeiten',`<input id="mProjectName" value="${escapeHtml(p.name||'')}" placeholder="Projektname"><textarea id="mProjectDesc" rows="4" placeholder="Beschreibung / Kontext">${escapeHtml(p.description||'')}</textarea><div class="overdue-color-row"><div class="color-bucket-label"><span class="color-bucket-preview" id="mProjectColorPreview" style="background:${escapeHtml(p.color||'#7c5cff')}"></span><span>Projektfarbe</span></div><button class="btn small color-bucket-btn" id="mProjectColorBtn" type="button">${iconPalette()}</button></div>`,async()=>{
    const name=$('#mProjectName').value.trim();if(!name)return toast('Projekt ohne Namen wurde nicht gespeichert.');
    const description=$('#mProjectDesc').value.trim();const color=$('#mProjectColorPreview').dataset.color||p.color||'#7c5cff';
    try{
      if(isNew){const saved=await insertProjectRev047({name,description,color});state.projects.push(saved);toast('Projekt gespeichert.');}
      else{await updateProjectRev047(p.id,{name,description,color});p.name=name;p.description=description;p.color=color;toast('Projekt aktualisiert.');}
      render();
    }catch(error){toast('Projekt konnte nicht gespeichert werden: '+(error.message||error));}
  });
  const preview=$('#mProjectColorPreview');preview.dataset.color=p.color||'#7c5cff';
  $('#mProjectColorBtn').onclick=()=>openNativeColorPicker(preview.dataset.color,c=>{preview.dataset.color=c;preview.style.background=c;});
}
function openProjectTaskModalRev047(projectId){
  if(!requireLogin())return;const p=projectByIdRev047(projectId);if(!p)return toast('Projekt nicht gefunden.');
  openModal(`Projekt-Task hinzufügen · ${escapeHtml(p.name)}`,`<input id="mProjectTaskTitle" placeholder="Aufgabe"><input id="mProjectTaskDue" type="date"><textarea id="mProjectTaskNote" rows="4" placeholder="Notiz / Kontext"></textarea>`,async()=>{
    const title=$('#mProjectTaskTitle').value.trim();if(!title)return toast('Projekt-Task ohne Titel wurde nicht gespeichert.');
    try{const saved=await insertProjectTaskRev047({projectId,title,dueDate:$('#mProjectTaskDue').value,note:$('#mProjectTaskNote').value.trim(),done:false});state.projectTasks.push(saved);render();toast('Projekt-Task gespeichert.');}catch(error){toast('Projekt-Task konnte nicht gespeichert werden: '+(error.message||error));}
  });
}
function openProjectTaskDetailModalRev047(id){
  if(!requireLogin())return;ensureProjectsRev047();const t=state.projectTasks.find(x=>x.id===id);if(!t)return;
  $('#modalTitle').textContent='Projekt-Task bearbeiten';
  $('#modalContent').innerHTML=`<div class="edit-grid"><label>Projekt</label><select id="editProjectTaskProject">${state.projects.filter(p=>!p.isArchived).map(p=>`<option value="${escapeHtml(p.id)}" ${t.projectId===p.id?'selected':''}>${escapeHtml(p.name)}</option>`).join('')}</select><label>Titel</label><input id="editProjectTaskTitle" value="${escapeHtml(t.title||'')}"><label>Soll-Datum</label><input id="editProjectTaskDue" type="date" value="${escapeHtml(t.dueDate||'')}"><label>Status</label><select id="editProjectTaskDone"><option value="false" ${!t.done?'selected':''}>Offen</option><option value="true" ${t.done?'selected':''}>Erledigt</option></select><label>Erledigt am</label><input id="editProjectTaskCompleted" type="date" value="${escapeHtml(t.completedDate||'')}"><label>Notiz</label><textarea id="editProjectTaskNote" rows="7">${escapeHtml(t.note||'')}</textarea></div>`;
  $('#modalBackdrop').style.display='flex';$('#saveModal').style.display='';
  $('#saveModal').onclick=async()=>{
    try{
      const patch={projectId:$('#editProjectTaskProject').value,title:$('#editProjectTaskTitle').value.trim()||t.title||'Ohne Titel',dueDate:$('#editProjectTaskDue').value,note:$('#editProjectTaskNote').value.trim(),done:$('#editProjectTaskDone').value==='true',completedDate:$('#editProjectTaskCompleted').value||null};
      if(patch.done&&!patch.completedDate)patch.completedDate=fmtDate(new Date());if(!patch.done)patch.completedDate=null;
      await updateProjectTaskRev047(t.id,patch);Object.assign(t,patch);closeModal();render();toast('Projekt-Task gespeichert.');
    }catch(error){toast('Projekt-Task konnte nicht gespeichert werden: '+(error.message||error));}
  };
}

const __rev047_collectSearchItems=collectSearchItems;
collectSearchItems=function(){
  const items=__rev047_collectSearchItems();
  ensureProjectsRev047();
  state.projects.forEach(p=>items.push({type:'Projekt',title:p.name,date:fmtDate(new Date()),meta:p.description||'Projekt'}));
  state.projectTasks.forEach(t=>{const p=projectByIdRev047(t.projectId)||{name:'Projekt'};items.push({type:'Projekt-Task',title:t.title,date:t.dueDate||fmtDate(new Date()),meta:p.name+(t.note?' · '+t.note:'')});});
  return items;
};

$('#daysSelect').onchange=e=>{state.days=Number(e.target.value);render()};if($('#rowsSelect'))$('#rowsSelect').onchange=e=>{state.dayRows=Number(e.target.value);render()};if($('#startModeSelect'))$('#startModeSelect').onchange=e=>{state.startMode=e.target.value;if(state.startMode==='week'){state.days=7;state.dayRows=1;state.offset=0;}if(state.startMode==='workweek'){state.days=5;state.dayRows=1;state.offset=0;}render()};$('#prevBtn').onclick=()=>{state.offset-=1;render()};$('#nextBtn').onclick=()=>{state.offset+=1;render()};$('#todayBtn').onclick=()=>{state.offset=0;render()};$('#monthBtn').onclick=openMonthModal;const reloadBtnRev044=$('#reloadDbBtn');if(reloadBtnRev044)reloadBtnRev044.onclick=reloadDatabaseDataRev044;$('#settingsBtn').onclick=openSyncSettingsModal;$('#legendBtn').onclick=openLegendModal;$('#cloudBtn').onclick=openCloudModal;$('#addLongBtn2').onclick=()=>{if(requireLogin())openLongModal();};initSidebarToggle();setupGlobalSearch();initConfigBlocks();render();setupAutoSync();
supabaseClient.auth.onAuthStateChange((event,session)=>{
  currentUser=session?.user||null;
  cloudReady=!!currentUser;
  updateCloudUserLabel();
  if(event==='SIGNED_OUT')resetVisibleStateAfterLogout();
  if(event==='SIGNED_IN')setupAutoSync();
});
initCloud();


/* Rev 048: Projekt-Tasks werden bei überzogenen Tasks mitgeführt */
function overdueProjectTasksHtmlRev048(today){
  ensureProjectsRev047();
  const todayIso=fmtDate(today);
  const overdueProjects=state.projectTasks.filter(t=>t.dueDate&&t.dueDate<todayIso&&!t.done);
  if(!overdueProjects.length)return '';
  const byProject=new Map();
  overdueProjects.forEach(t=>{
    const p=projectByIdRev047(t.projectId)||{id:'_',name:'Projekt',color:'#7c5cff'};
    if(!byProject.has(p.id))byProject.set(p.id,{project:p,tasks:[]});
    byProject.get(p.id).tasks.push(t);
  });
  return `<div class="task-columns" style="margin-top:8px">${Array.from(byProject.values()).map(g=>`<div class="project-day-lane"><div class="project-day-title"><span class="project-dot" style="background:${escapeHtml(g.project.color||'#7c5cff')}"></span><span>Projekt: ${escapeHtml(g.project.name)}</span></div>${g.tasks.map(t=>projectTaskCardHtmlRev047(t,true)).join('')}</div>`).join('')}</div>`;
}

const __rev048_dayCard=dayCard;
dayCard=function(date){
  const today=new Date();today.setHours(0,0,0,0);const iso=fmtDate(date);
  const openTasks=state.tasks.filter(t=>t.date===iso&&!t.done);
  const overdue=sameDay(date,today)?state.tasks.filter(t=>t.date<fmtDate(today)&&!t.done):[];
  const overdueProjectsHtml=sameDay(date,today)?overdueProjectTasksHtmlRev048(today):'';
  const hasOverdueBlock=sameDay(date,today)&&(overdue.length||overdueProjectsHtml);
  const visibleTaskIds=visibleTaskColumnIds(); const visibleLongIds=visibleLongColumnIds();
  const completedTasks=state.tasks.filter(t=>t.done&&t.completedDate===iso&&visibleTaskIds.includes(t.columnId||state.taskColumns?.[0]?.id));
  const completedLong=state.longterm.filter(t=>t.done&&t.completedDate===iso&&visibleLongIds.includes(t.columnId||state.longColumns?.[0]?.id));
  const completedProjects=state.projectTasks.filter(t=>t.done&&t.completedDate===iso);
  const showCompleted=completedTasks.length||completedLong.length||completedProjects.length;
  const day=document.createElement('div');day.className='day'+(sameDay(date,today)?' today':'');
  const projectDoneHtml=completedProjects.length?completedProjects.map(t=>projectTaskCardHtmlRev047(t,true)).join(''):'';
  day.innerHTML=`<div class="day-head"><div class="day-num"><span class="day-title-weekday">${escapeHtml(date.toLocaleDateString('de-DE',{weekday:'long'}))}</span><span class="day-title-date">${escapeHtml(dateDERev046(date))}</span></div>${sameDay(date,today)?'<span class="badge">Aktueller Tag</span>':''}</div><div class="day-body"><div class="partition"><div class="part-head"><div class="part-title">1. Terminkalender</div></div><div class="split">${calendarLanes(date)}</div></div><div class="partition"><div class="part-head"><div class="part-title">2. Tagestasks</div><button class="btn small" data-task-date="${iso}">${iconPlus()} Hinzufügen</button></div>${taskColumnsList(openTasks)}</div><div class="partition"><div class="part-head"><div class="part-title">3. Projekt-Tasks</div></div>${projectTasksForDateHtmlRev047(date)}</div>${sameDay(date,today)?`<div class="partition"><div class="part-head"><div class="part-title">4. Überzogene Tasks</div></div>${overdue.length?taskList(overdue,true):'<div class="empty">Keine überzogenen normalen Tasks.</div>'}${overdueProjectsHtml}</div>`:''}${showCompleted?`<div class="partition"><div class="part-head"><div class="part-title">${sameDay(date,today)?'5':'4'}. An diesem Tag erledigte Tasks</div></div>${completedDoneList(completedTasks,completedLong)}${projectDoneHtml?`<div class="completed-grid" style="margin-top:8px">${projectDoneHtml}</div>`:''}</div>`:''}</div>`;
  day.querySelector('[data-task-date]').onclick=()=>openTaskModal(iso);
  day.querySelectorAll('[data-toggle-task]').forEach(c=>{c.onclick=ev=>ev.stopPropagation();c.onchange=(ev)=>{ev.stopPropagation();const t=state.tasks.find(x=>x.id===c.dataset.toggleTask);if(!requireLogin()){c.checked=!c.checked;return;}if(t){const done=c.checked;t.done=done;t.completedDate=done?fmtDate(new Date()):null;updateTaskRev043(t.id,{done,completed_date:t.completedDate}).catch(error=>toast(error.message||String(error)));render();}}});
  day.querySelectorAll('[data-delete-task]').forEach(b=>b.onclick=(ev)=>{ev.stopPropagation();if(!requireLogin())return;state.tasks=state.tasks.filter(x=>x.id!==b.dataset.deleteTask);dbDeleteRowRev041('tasks',b.dataset.deleteTask).catch(error=>toast(error.message||String(error)));render();});
  day.querySelectorAll('[data-task-ref]').forEach(card=>card.onclick=()=>openTaskDetailModal(card.dataset.taskRef));
  day.querySelectorAll('[data-add-own-event]').forEach(b=>b.onclick=(ev)=>{ev.stopPropagation();const [ci,iso]=b.dataset.addOwnEvent.split(':');openOwnEventModal(Number(ci),iso);});
  day.querySelectorAll('[data-event-ref]').forEach(card=>card.onclick=()=>openEventDetailModal(card.dataset.eventRef));
  bindProjectTaskEventsRev047(day);
  return day;
};



/* Rev 049: Zeitstrahl unter Seitenleiste + Projektübersicht */
(function(){
  function ensureRev049State(){
    if(!['light','dark'].includes(state.theme))state.theme='light';
    state.timelineStep=Number(state.timelineStep||30);
    if(![15,30,60].includes(state.timelineStep))state.timelineStep=30;
    state.workStartTime=state.workStartTime||'';
  }
  function minutesOfDate(d){return d.getHours()*60+d.getMinutes();}
  function hhmmFromMinutes(min){min=((min%1440)+1440)%1440;return String(Math.floor(min/60)).padStart(2,'0')+':'+String(min%60).padStart(2,'0');}
  function parseHHMM(v){const m=String(v||'').match(/^(\d{1,2}):(\d{2})$/);if(!m)return null;const h=Number(m[1]),mi=Number(m[2]);if(h<0||h>23||mi<0||mi>59)return null;return h*60+mi;}
  function visibleTimelineEventsRev049(day){
    const out=[];
    visibleCalendars().forEach(({cal,idx:ci})=>{
      const links=cal.links||[];
      (cal.events||[]).forEach((e,ei)=>{
        const l=links.find(x=>x.id===e.icsId); if(l&&l.visible===false)return;
        const occ=eventOccurrenceForDate(e,day); if(!occ||occ.allDay)return;
        const s=new Date(occ.start), en=occ.end?new Date(occ.end):new Date(s.getTime()+30*60000);
        if(isNaN(s)||isNaN(en))return;
        out.push({summary:occ.summary||'Termin',source:occ.icsName||occ.source||cal.name,start:s,end:en,color:occ.icsColor||l?.color||state.colors.event,ref:`ics:${ci}:${ei}:${fmtDate(day)}`});
      });
      (cal.ownEvents||[]).forEach((e,ei)=>{
        const l=links.find(x=>x.id===e.sourceId); if(!l||l.visible===false)return;
        const occ=eventOccurrenceForDate(e,day); if(!occ||occ.allDay)return;
        const s=new Date(occ.start), en=occ.end?new Date(occ.end):new Date(s.getTime()+30*60000);
        if(isNaN(s)||isNaN(en))return;
        out.push({summary:occ.summary||'Termin',source:occ.icsName||occ.source||cal.name,start:s,end:en,color:occ.icsColor||l.color||state.colors.event,ref:`own:${ci}:${ei}:${fmtDate(day)}`});
      });
    });
    return out.sort((a,b)=>a.start-b.start);
  }
  function layoutOverlapRev049(events){
    const items=events.map((e,idx)=>({e,idx,start:minutesOfDate(e.start),end:Math.max(minutesOfDate(e.start)+15,minutesOfDate(e.end))}));
    const groups=[];
    items.forEach(it=>{
      let g=groups.find(gr=>it.start<gr.maxEnd && it.end>gr.minStart);
      if(!g){g={items:[],minStart:it.start,maxEnd:it.end};groups.push(g);} 
      g.items.push(it);g.minStart=Math.min(g.minStart,it.start);g.maxEnd=Math.max(g.maxEnd,it.end);
    });
    groups.forEach(g=>{
      const cols=[];
      g.items.sort((a,b)=>a.start-b.start).forEach(it=>{
        let col=cols.findIndex(end=>end<=it.start);
        if(col<0){col=cols.length;cols.push(it.end);}else cols[col]=it.end;
        it.col=col;it.cols=cols.length;
      });
      g.items.forEach(it=>it.cols=Math.max(it.cols,cols.length));
    });
    return items;
  }
  function renderSidebarTimelineRev049(){
    ensureRev049State();
    const sidebar=document.querySelector('.sidebar'); if(!sidebar)return;
    let box=document.querySelector('#sidebarDayTimelineRev049');
    if(!box){box=document.createElement('section');box.id='sidebarDayTimelineRev049';box.className='sidebar-day-timeline';sidebar.appendChild(box);} 
    const today=new Date();today.setHours(0,0,0,0);
    const events=layoutOverlapRev049(visibleTimelineEventsRev049(today));
    const pxPerMin=0.55, totalH=1440*pxPerMin;
    const step=Number(state.timelineStep||30);
    const lines=[];
    for(let m=0;m<=1440;m+=step){
      const major=m%60===0;
      lines.push(`<div class="timeline-line ${major?'major':''}" style="top:${m*pxPerMin}px">${major?`<span class="timeline-line-label">${hhmmFromMinutes(m)}</span>`:''}</div>`);
    }
    const now=new Date();const nowMin=now.getHours()*60+now.getMinutes()+now.getSeconds()/60;
    const nowLine=sameDay(today,now)?`<div class="timeline-now-line" data-now-line-rev49 style="top:${nowMin*pxPerMin}px"><span class="timeline-now-label">${hhmmFromMinutes(Math.floor(nowMin))}</span></div>`:'';
    const evHtml=events.map(it=>{
      const top=Math.max(0,it.start*pxPerMin), h=Math.max(18,(it.end-it.start)*pxPerMin);
      const w=100/it.cols, left=it.col*w;
      return `<div class="timeline-event-block" data-event-ref="${escapeHtml(it.e.ref)}" style="top:${top}px;height:${h}px;left:calc(${left}% + 42px);width:calc(${w}% - 46px);border-left-color:${escapeHtml(it.e.color)};background:${escapeHtml(it.e.color)}cc"><b>${escapeHtml(shortText(it.e.summary,28))}</b><small>${escapeHtml(hhmmFromMinutes(it.start)+'–'+hhmmFromMinutes(it.end)+' · '+shortText(it.e.source,22))}</small></div>`;
    }).join('');
    const start=parseHHMM(state.workStartTime);const endText=start===null?'—':hhmmFromMinutes(start+8*60);
    box.innerHTML=`<div class="sidebar-timeline-head"><div><div class="sidebar-timeline-title">Zeitstrahl heute</div><div class="sidebar-timeline-date">${escapeHtml(dateDERev046(today))}</div></div></div><div class="timeline-step-row"><select id="timelineStepSelectRev49"><option value="60">Stunden</option><option value="30">Halbstunden</option><option value="15">Viertelstunden</option></select><button class="btn small timeline-clock-btn" id="timelineWorkClockRev49" title="Arbeitsbeginn eintragen">🕘</button></div><div class="timeline-work-row"><button class="btn small timeline-clock-btn" id="timelineWorkClockRev49b" title="Arbeitsbeginn eintragen">⏱</button><input id="timelineWorkStartRev49" type="time" value="${escapeHtml(state.workStartTime||'')}"></div><div class="timeline-eod">Feierabend Zeit: <b>${escapeHtml(endText)}</b> 🍺</div><div class="timeline-canvas-wrap"><div class="timeline-canvas" style="height:${totalH}px;min-height:${totalH}px">${lines.join('')}${nowLine}${evHtml||'<div class="timeline-empty">Keine sichtbaren Termine für heute.</div>'}</div></div>`;
    const stepSel=box.querySelector('#timelineStepSelectRev49');stepSel.value=String(state.timelineStep);stepSel.onchange=()=>{state.timelineStep=Number(stepSel.value);persist();renderSidebarTimelineRev49();};
    const input=box.querySelector('#timelineWorkStartRev49');input.onchange=()=>{state.workStartTime=input.value;persist();renderSidebarTimelineRev49();};
    box.querySelector('#timelineWorkClockRev49').onclick=()=>input.showPicker?input.showPicker():input.focus();
    box.querySelector('#timelineWorkClockRev49b').onclick=()=>input.showPicker?input.showPicker():input.focus();
    box.querySelectorAll('[data-event-ref]').forEach(el=>el.onclick=()=>openEventDetailModal(el.dataset.eventRef));
  }
  function updateNowLineRev049(){
    const line=document.querySelector('[data-now-line-rev49]'); if(!line)return;
    const now=new Date();const min=now.getHours()*60+now.getMinutes()+now.getSeconds()/60;
    line.style.top=(min*0.55)+'px';const lab=line.querySelector('.timeline-now-label'); if(lab)lab.textContent=hhmmFromMinutes(Math.floor(min));
  }
  const __renderRev49=render;
  render=function(){__renderRev49();renderSidebarTimelineRev049();bindProjectCardsRev049();};
  function projectTaskBucketHtmlRev49(tasks){
    return tasks.length?tasks.map(t=>projectTaskCardHtmlRev047(t,true)).join(''):'<div class="empty">Keine Einträge.</div>';
  }
  window.openProjectOverviewModalRev49=function(projectId){
    if(!requireLogin())return;ensureProjectsRev047();
    const p=state.projects.find(x=>x.id===projectId);if(!p)return toast('Projekt nicht gefunden.');
    const tasks=projectTasksForRev047(p.id);
    const open=tasks.filter(t=>!t.done), done=tasks.filter(t=>t.done), overdue=tasks.filter(t=>t.dueDate&&t.dueDate<fmtDate(new Date())&&!t.done);
    $('#modalTitle').textContent='Projektübersicht';
    $('#modalContent').innerHTML=`<div class="project-overview"><div class="project-overview-head" style="border-left-color:${escapeHtml(p.color||'#7c5cff')}"><div class="project-overview-title">${escapeHtml(p.name)}</div><div class="project-overview-desc">${escapeHtml(p.description||'Keine Beschreibung hinterlegt.')}</div></div><div class="project-overview-grid"><section class="project-overview-section"><h3>Offen</h3>${projectTaskBucketHtmlRev49(open)}</section><section class="project-overview-section"><h3>Überzogen</h3>${projectTaskBucketHtmlRev49(overdue)}</section><section class="project-overview-section"><h3>Erledigt</h3>${projectTaskBucketHtmlRev49(done)}</section></div></div>`;
    $('#modalBackdrop').style.display='flex';$('#saveModal').style.display='none';bindProjectTaskEventsRev047($('#modalContent'));
  };
  function bindProjectCardsRev049(){
    const projects=(state.projects||[]).filter(p=>!p.isArchived);
    document.querySelectorAll('.project-card').forEach((card,i)=>{
      if(card.dataset.rev49Bound)return;card.dataset.rev49Bound='1';
      const p=projects[i]; if(!p)return;
      card.addEventListener('click',ev=>{if(ev.target.closest('button,input,select,textarea,[data-project-task-ref]'))return;openProjectOverviewModalRev49(p.id);});
    });
  }
  const __renderProjectsRev49=window.renderProjectsRev047||renderProjectsRev047;
  renderProjectsRev047=function(){__renderProjectsRev49();bindProjectCardsRev049();renderSidebarTimelineRev049();};
  window.renderProjectsRev047=renderProjectsRev047;
  setInterval(updateNowLineRev049,30000);
  setTimeout(()=>{ensureRev049State();renderSidebarTimelineRev049();bindProjectCardsRev049();},150);
})();



/* Rev 050: bereinigter Tages-Zeitstrahl, Projekt-Tasks in Partition 2, Overdue-Projekt-Tasks, einklappbare erledigte Tasks */
(function(){
  function ensureRev050State(){
    if(!state) return;
    state.timelineStep=Number(state.timelineStep||30);
    if(![15,30,60].includes(state.timelineStep)) state.timelineStep=30;
    state.workStartTime=state.workStartTime||'';
    state.timelinePauseMinutes=Number(state.timelinePauseMinutes||0);
    if(isNaN(state.timelinePauseMinutes)||state.timelinePauseMinutes<0) state.timelinePauseMinutes=0;
  }
  function minutesRev050(d){return d.getHours()*60+d.getMinutes()+d.getSeconds()/60;}
  function hhmmRev050(m){m=Math.max(0,Math.min(24*60,Math.round(m)));const h=Math.floor(m/60)%24;const mi=m%60;return String(h).padStart(2,'0')+':'+String(mi).padStart(2,'0');}
  function parseHHMMRev050(v){const m=String(v||'').match(/^(\d{1,2}):(\d{2})$/);if(!m)return null;const h=+m[1],mi=+m[2];if(h<0||h>23||mi<0||mi>59)return null;return h*60+mi;}
  function visibleTimelineEventsRev050(day){
    const out=[];
    visibleCalendars().forEach(({cal,idx:ci})=>{
      const links=cal.links||[];
      (cal.events||[]).forEach((e,ei)=>{
        const l=links.find(x=>x.id===e.icsId); if(l&&l.visible===false)return;
        const occ=eventOccurrenceForDate(e,day); if(!occ||occ.allDay)return;
        const st=new Date(occ.start), en=occ.end?new Date(occ.end):new Date(st.getTime()+30*60000);
        if(isNaN(st)||isNaN(en))return;
        out.push({summary:occ.summary||'Termin',source:occ.icsName||occ.source||cal.name,start:st,end:en,color:occ.icsColor||l?.color||state.colors.event,ref:`ics:${ci}:${ei}:${fmtDate(day)}`});
      });
      (cal.ownEvents||[]).forEach((e,ei)=>{
        const l=links.find(x=>x.id===e.sourceId); if(!l||l.visible===false)return;
        const occ=eventOccurrenceForDate(e,day); if(!occ||occ.allDay)return;
        const st=new Date(occ.start), en=occ.end?new Date(occ.end):new Date(st.getTime()+30*60000);
        if(isNaN(st)||isNaN(en))return;
        out.push({summary:occ.summary||'Termin',source:occ.icsName||occ.source||cal.name,start:st,end:en,color:occ.icsColor||l.color||state.colors.event,ref:`own:${ci}:${ei}:${fmtDate(day)}`});
      });
    });
    return out.sort((a,b)=>a.start-b.start);
  }
  function layoutOverlapRev050(events){
    const items=events.map((e,idx)=>({e,idx,start:minutesRev050(e.start),end:Math.max(minutesRev050(e.start)+15,minutesRev050(e.end))}));
    const groups=[];
    items.forEach(it=>{
      let g=groups.find(gr=>it.start<gr.maxEnd && it.end>gr.minStart);
      if(!g){g={items:[],minStart:it.start,maxEnd:it.end};groups.push(g);}
      g.items.push(it);g.minStart=Math.min(g.minStart,it.start);g.maxEnd=Math.max(g.maxEnd,it.end);
    });
    groups.forEach(g=>{
      const cols=[];
      g.items.sort((a,b)=>a.start-b.start).forEach(it=>{
        let col=cols.findIndex(end=>end<=it.start);
        if(col<0){col=cols.length;cols.push(it.end);}else cols[col]=it.end;
        it.col=col;it.cols=cols.length;
      });
      g.items.forEach(it=>it.cols=Math.max(it.cols,cols.length));
    });
    return items;
  }
  function openTimelineSettingsRev050(){
    ensureRev050State();
    openModal('Zeitstrahl einstellen',`<div class="edit-grid"><label>Schrittweite</label><select id="timelineStepModalRev50"><option value="60">Stundentakt</option><option value="30">Halbstundentakt</option><option value="15">Viertelstundentakt</option></select><label>Pausenzeit in Minuten</label><input id="timelinePauseModalRev50" type="number" min="0" step="5" value="${escapeHtml(state.timelinePauseMinutes)}"><div class="hint">Pausenzeit wird bei der Feierabendzeit addiert, weil sie nicht als Arbeitszeit zählt.</div></div>`,()=>{
      state.timelineStep=Number(document.querySelector('#timelineStepModalRev50')?.value||30);
      state.timelinePauseMinutes=Math.max(0,Number(document.querySelector('#timelinePauseModalRev50')?.value||0));
      persist();
      renderSidebarTimelineRev050();
    });
    const sel=document.querySelector('#timelineStepModalRev50'); if(sel)sel.value=String(state.timelineStep||30);
  }
  window.renderSidebarTimelineRev050=function(){
    ensureRev050State();
    const sidebar=document.querySelector('.sidebar'); if(!sidebar)return;
    let box=document.querySelector('#sidebarDayTimelineRev049');
    if(!box){box=document.createElement('section');box.id='sidebarDayTimelineRev049';box.className='sidebar-day-timeline';sidebar.appendChild(box);} 
    const today=new Date();today.setHours(0,0,0,0);
    const events=layoutOverlapRev050(visibleTimelineEventsRev050(today));
    const pxPerMin=0.55,totalH=1440*pxPerMin,step=Number(state.timelineStep||30);
    const lines=[];
    for(let m=0;m<=1440;m+=step){
      const major=m%60===0;
      lines.push(`<div class="timeline-line ${major?'major':''}" style="top:${m*pxPerMin}px">${major?`<span class="timeline-line-label">${hhmmRev050(m)}</span>`:''}</div>`);
    }
    const now=new Date();const nowMin=now.getHours()*60+now.getMinutes()+now.getSeconds()/60;
    const nowLine=`<div class="timeline-now-line" data-now-line-rev50 style="top:${nowMin*pxPerMin}px"><span class="timeline-now-label">${hhmmRev050(nowMin)}</span></div>`;
    const evHtml=events.map(it=>{
      const top=Math.max(0,it.start*pxPerMin),h=Math.max(18,(it.end-it.start)*pxPerMin),w=100/it.cols,left=it.col*w;
      return `<div class="timeline-event-block" data-event-ref="${escapeHtml(it.e.ref)}" style="top:${top}px;height:${h}px;left:calc(${left}% + 42px);width:calc(${w}% - 46px);border-left-color:${escapeHtml(it.e.color)};background:${escapeHtml(it.e.color)}cc"><b>${escapeHtml(shortText(it.e.summary,28))}</b><small>${escapeHtml(hhmmRev050(it.start)+'–'+hhmmRev050(it.end)+' · '+shortText(it.e.source,22))}</small></div>`;
    }).join('');
    const start=parseHHMMRev050(state.workStartTime);const pause=Number(state.timelinePauseMinutes||0);const endText=start===null?'—':hhmmRev050(start+8*60+pause);
    const pauseText=pause?`Pause: ${pause} Min. · zählt nicht als Arbeitszeit.`:'Keine Pause hinterlegt.';
    box.innerHTML=`<div class="sidebar-timeline-head"><div><div class="sidebar-timeline-title">Zeitstrahl heute</div><div class="sidebar-timeline-date">${escapeHtml(dateDERev046(today))}</div></div></div><div class="timeline-work-row"><input id="timelineWorkStartRev50" type="time" value="${escapeHtml(state.workStartTime||'')}" title="Arbeitsbeginn"><button class="btn small ui-icon-btn timeline-settings-btn" id="timelineSettingsRev50" title="Zeitstrahl einstellen">${iconSettings()}</button></div><div class="timeline-pause-note">${escapeHtml(pauseText)}</div><div class="timeline-eod">Feierabend Zeit: <b>${escapeHtml(endText)}</b> 🍺</div><div class="timeline-canvas-wrap"><div class="timeline-canvas" style="height:${totalH}px;min-height:${totalH}px">${lines.join('')}${nowLine}${evHtml||'<div class="timeline-empty">Keine sichtbaren Termine für heute.</div>'}</div></div>`;
    const input=box.querySelector('#timelineWorkStartRev50');
    if(input)input.onchange=()=>{state.workStartTime=input.value;persist();renderSidebarTimelineRev050();};
    const gear=box.querySelector('#timelineSettingsRev50'); if(gear)gear.onclick=openTimelineSettingsRev050;
    box.querySelectorAll('[data-event-ref]').forEach(el=>el.onclick=()=>openEventDetailModal(el.dataset.eventRef));
  };
  function projectTasksForDateGroupHtmlRev050(date){
    ensureProjectsRev047();
    const iso=fmtDate(date);
    const due=(state.projectTasks||[]).filter(t=>t.dueDate===iso&&!t.done);
    if(!due.length)return '';
    return `<div class="task-columns project-task-day-group"><div class="project-day-lane"><div class="project-day-title"><span class="project-dot" style="background:#7c5cff"></span><span>Projekt-Tasks</span></div>${due.map(t=>projectTaskCardHtmlRev047(t,true)).join('')}</div></div>`;
  }
  function overdueProjectTasksHtmlRev050(tasks){
    if(!tasks.length)return '';
    return tasks.map(t=>{
      const p=projectByIdRev047(t.projectId)||{name:'Projekt',color:'#7c5cff'};
      const meta=`Projekt: ${p.name}${t.dueDate?' · Soll: '+dateDERev046(new Date(t.dueDate+'T00:00:00')):''}`;
      return `<div class="card task task-card-compact overdue project-overdue-card" data-project-task-ref="${escapeHtml(t.id)}" style="border-left-color:${escapeHtml(state.colors?.overdue||'#ff5050')}!important"><div class="task-row"><input type="checkbox" data-toggle-project-task="${escapeHtml(t.id)}"><div><b title="${escapeHtml(t.title)}">${escapeHtml(shortText(t.title,32))}</b><small title="${escapeHtml(meta)}">${escapeHtml(shortText(meta,42))}</small></div><button class="kebab" data-delete-project-task="${escapeHtml(t.id)}">×</button></div></div>`;
    }).join('');
  }
  function overdueCombinedHtmlRev050(dayTasks,projectTasks){
    const a=taskList(dayTasks,true);
    const b=overdueProjectTasksHtmlRev050(projectTasks);
    if(!dayTasks.length&&!projectTasks.length)return '<div class="empty">Keine Einträge.</div>';
    return (dayTasks.length?a:'')+b;
  }
  window.dayCard=function(date){
    const today=new Date();today.setHours(0,0,0,0);const iso=fmtDate(date);
    const openTasks=state.tasks.filter(t=>t.date===iso&&!t.done);
    const overdue=sameDay(date,today)?state.tasks.filter(t=>t.date<fmtDate(today)&&!t.done):[];
    const overdueProjects=sameDay(date,today)?(state.projectTasks||[]).filter(t=>t.dueDate&&t.dueDate<fmtDate(today)&&!t.done):[];
    const visibleTaskIds=visibleTaskColumnIds(); const visibleLongIds=visibleLongColumnIds();
    const completedTasks=state.tasks.filter(t=>t.done&&t.completedDate===iso&&visibleTaskIds.includes(t.columnId||state.taskColumns?.[0]?.id));
    const completedLong=state.longterm.filter(t=>t.done&&t.completedDate===iso&&visibleLongIds.includes(t.columnId||state.longColumns?.[0]?.id));
    const completedProjects=(state.projectTasks||[]).filter(t=>t.done&&t.completedDate===iso);
    const showCompleted=completedTasks.length||completedLong.length||completedProjects.length;
    const projectDoneHtml=completedProjects.length?completedProjects.map(t=>projectTaskCardHtmlRev047(t,true)).join(''):'';
    const day=document.createElement('div');day.className='day'+(sameDay(date,today)?' today':'');
    day.innerHTML=`<div class="day-head"><div class="day-num"><span class="day-title-weekday">${escapeHtml(date.toLocaleDateString('de-DE',{weekday:'long'}))}</span><span class="day-title-date">${escapeHtml(dateDERev046(date))}</span></div>${sameDay(date,today)?'<span class="badge">Aktueller Tag</span>':''}</div><div class="day-body"><div class="partition"><div class="part-head"><div class="part-title">1. Terminkalender</div></div><div class="split">${calendarLanes(date)}</div></div><div class="partition"><div class="part-head"><div class="part-title">2. Tagestasks</div><button class="btn small" data-task-date="${iso}">${iconPlus()} Hinzufügen</button></div>${taskColumnsList(openTasks)}${projectTasksForDateGroupHtmlRev050(date)}</div>${sameDay(date,today)?`<div class="partition"><div class="part-head"><div class="part-title">3. Überzogene Tasks</div></div>${overdueCombinedHtmlRev050(overdue,overdueProjects)}</div>`:''}${showCompleted?`<div class="partition"><details class="completed-collapse"><summary>${sameDay(date,today)?'4':'3'}. An diesem Tag erledigte Tasks</summary><div class="completed-collapse-body">${completedDoneList(completedTasks,completedLong)}${projectDoneHtml?`<div class="completed-grid" style="margin-top:8px">${projectDoneHtml}</div>`:''}</div></details></div>`:''}</div>`;
    day.querySelector('[data-task-date]').onclick=()=>openTaskModal(iso);
    day.querySelectorAll('[data-toggle-task]').forEach(c=>{c.onclick=ev=>ev.stopPropagation();c.onchange=(ev)=>{ev.stopPropagation();const t=state.tasks.find(x=>x.id===c.dataset.toggleTask);if(!requireLogin()){c.checked=!c.checked;return;}if(t){const done=c.checked;t.done=done;t.completedDate=done?fmtDate(new Date()):null;updateTaskRev043(t.id,{done,completed_date:t.completedDate}).catch(error=>toast(error.message||String(error)));render();}}});
    day.querySelectorAll('[data-delete-task]').forEach(b=>b.onclick=(ev)=>{ev.stopPropagation();if(!requireLogin())return;state.tasks=state.tasks.filter(x=>x.id!==b.dataset.deleteTask);dbDeleteRowRev041('tasks',b.dataset.deleteTask).catch(error=>toast(error.message||String(error)));render();});
    day.querySelectorAll('[data-task-ref]').forEach(card=>card.onclick=()=>openTaskDetailModal(card.dataset.taskRef));
    day.querySelectorAll('[data-add-own-event]').forEach(b=>b.onclick=(ev)=>{ev.stopPropagation();const [ci,iso]=b.dataset.addOwnEvent.split(':');openOwnEventModal(Number(ci),iso);});
    day.querySelectorAll('[data-event-ref]').forEach(card=>card.onclick=()=>openEventDetailModal(card.dataset.eventRef));
    bindProjectTaskEventsRev047(day);
    return day;
  };
  const __renderRev050=render;
  render=function(){__renderRev050();renderSidebarTimelineRev050();};
  function updateNowLineRev050(){const line=document.querySelector('[data-now-line-rev50]');if(!line)return;const now=new Date();const min=now.getHours()*60+now.getMinutes()+now.getSeconds()/60;line.style.top=(min*0.55)+'px';const lab=line.querySelector('.timeline-now-label');if(lab)lab.textContent=hhmmRev050(min);}
  setInterval(updateNowLineRev050,30000);
  setTimeout(()=>{ensureRev050State();renderSidebarTimelineRev050();},200);
})();



/* Rev 051: Monatslogik, Zeitstrahl-Schrift, eigene Termine bearbeitbar */
(function(){
  function toDateInputRev51(d){
    const x=new Date(d); if(isNaN(x))return fmtDate(new Date()); return fmtDate(x);
  }
  function toTimeInputRev51(d, fallback='09:00'){
    const x=new Date(d); if(isNaN(x))return fallback;
    return String(x.getHours()).padStart(2,'0')+':'+String(x.getMinutes()).padStart(2,'0');
  }
  function parseLocalDateTimeRev51(date,time,allDay,endOfDay=false){
    if(allDay)return new Date(date+(endOfDay?'T23:59:00':'T00:00:00'));
    return new Date(date+'T'+(time||'00:00')+':00');
  }

  async function updateOwnEventRev51(event, oldData){
    if(!currentUser||!isUuid(event.id))throw new Error('Termin ist nicht sauber in der Datenbank referenziert.');
    const exists=await ownEventExistsRev046(event.id);
    if(!exists)throw new Error('Der Termin existiert nicht mehr. Er wurde vermutlich auf einem anderen Gerät gelöscht.');
    const row={
      calendar_source_id:event.sourceId,
      title:event.summary||'Ohne Titel',
      location:event.location||null,
      description:event.description||null,
      start_time:event.start,
      end_time:event.end||null,
      all_day:!!event.allDay,
      recurrence:event.recurrence||'none',
      travel_time:event.travelTime||null,
      status:event.status||'active',
      updated_at:new Date().toISOString()
    };
    const {error}=await supabaseClient.from('own_events').update(row).eq('user_id',currentUser.id).eq('id',event.id);
    if(error)throw error;
    if(typeof logOwnEventRev047==='function')await logOwnEventRev047('update',oldData,event);
  }
  function openOwnEventEditModalRev51(calIdx,evtIdx){
    if(!requireLogin())return;
    const cal=state.calendars[Number(calIdx)];
    const evt=(cal?.ownEvents||[])[Number(evtIdx)];
    if(!cal||!evt)return toast('Eigener Termin lokal nicht gefunden.');
    const ownSources=(cal.links||[]).filter(l=>l.type==='own');
    const dateVal=toDateInputRev51(evt.start), startVal=toTimeInputRev51(evt.start,'09:00'), endVal=toTimeInputRev51(evt.end,'10:00');
    $('#modalTitle').textContent='Eigenen Termin bearbeiten';
    $('#modalContent').innerHTML=`<div class="own-event-edit-grid"><label>Titel</label><input id="editOwnTitleRev51" value="${escapeHtml(evt.summary||'')}"><label>Eigener Kalender</label><select id="editOwnSourceRev51">${ownSources.map(l=>`<option value="${escapeHtml(l.id)}" ${evt.sourceId===l.id?'selected':''}>${escapeHtml(l.name)}</option>`).join('')}</select><label>Ort</label><input id="editOwnLocationRev51" value="${escapeHtml(evt.location||'')}"><label>Datum</label><input id="editOwnDateRev51" type="date" value="${escapeHtml(dateVal)}"><label>Wiederholung</label><select id="editOwnRecurrenceRev51"><option value="none">Keine Wiederholung</option><option value="weekly">Wöchentlich</option><option value="monthly">Monatlich</option><option value="yearly">Jährlich</option></select><label>Ganztägig</label><select id="editOwnAllDayRev51"><option value="false">Nein</option><option value="true">Ja</option></select><label>Startzeit</label><input id="editOwnStartRev51" type="time" value="${escapeHtml(startVal)}"><label>Endzeit</label><input id="editOwnEndRev51" type="time" value="${escapeHtml(endVal)}"><label>Wegzeit</label><input id="editOwnTravelRev51" value="${escapeHtml(evt.travelTime||'')}" placeholder="z. B. 20 Min."><label>Details / Notizen</label><textarea id="editOwnDescriptionRev51" rows="5">${escapeHtml(evt.description||'')}</textarea><button class="btn danger" id="deleteOwnFromEditRev51" type="button">Eigenen Termin / Serie löschen</button></div>`;
    $('#editOwnRecurrenceRev51').value=evt.recurrence||'none';
    $('#editOwnAllDayRev51').value=evt.allDay?'true':'false';
    $('#modalBackdrop').style.display='flex';$('#saveModal').style.display='';
    $('#saveModal').onclick=async()=>{
      const oldData=structuredClone(evt);
      const sourceId=$('#editOwnSourceRev51').value;
      const src=ownSources.find(l=>l.id===sourceId)||ownSources[0];
      const title=$('#editOwnTitleRev51').value.trim(); if(!title)return toast('Termin ohne Titel wird nicht gespeichert.');
      const date=$('#editOwnDateRev51').value||dateVal;
      const allDay=$('#editOwnAllDayRev51').value==='true';
      evt.sourceId=sourceId;evt.summary=title;evt.location=$('#editOwnLocationRev51').value.trim();evt.recurrence=$('#editOwnRecurrenceRev51').value||'none';evt.allDay=allDay;
      evt.start=parseLocalDateTimeRev51(date,$('#editOwnStartRev51').value,allDay,false).toISOString();
      evt.end=parseLocalDateTimeRev51(date,$('#editOwnEndRev51').value,allDay,true).toISOString();
      evt.travelTime=$('#editOwnTravelRev51').value.trim();evt.description=$('#editOwnDescriptionRev51').value.trim();evt.source=src?.name||cal.name;evt.icsName=src?.name||cal.name;evt.icsColor=src?.color||state.colors.event;evt.status=evt.status||'active';
      try{await updateOwnEventRev51(evt,oldData);closeModal();render();toast('Eigener Termin aktualisiert.');}
      catch(error){toast(error.message||String(error));closeModal();await loadStateFromCloud();}
    };
    $('#deleteOwnFromEditRev51').onclick=async()=>{
      if(!confirm('Eigenen Termin / Serie löschen?'))return;
      try{await deleteOwnEventRev046(evt.id);cal.ownEvents.splice(Number(evtIdx),1);closeModal();render();toast('Eigener Termin gelöscht.');}
      catch(error){toast(error.message||String(error));closeModal();await loadStateFromCloud();}
    };
  }
  const prevOpenEventDetailRev51=openEventDetailModal;
  openEventDetailModal=function(ref){
    const [type,calIdx,evtIdx]=String(ref||'').split(':');
    if(type==='own')return openOwnEventEditModalRev51(calIdx,evtIdx);
    return prevOpenEventDetailRev51(ref);
  };

  const prevRenderSidebarTimelineRev51=window.renderSidebarTimelineRev050;
  window.renderSidebarTimelineRev050=function(){
    prevRenderSidebarTimelineRev51();
    document.querySelectorAll('.timeline-event-block').forEach(block=>{
      const h=parseFloat(block.style.height)||block.offsetHeight||0;
      if(h<28)block.classList.add('timeline-event-tiny');
    });
  };
})();



/* Rev 052: Zeitstrahl-Tagwechsel, App-State-Zeitstrahlwerte, Settings-Reiter, Konturen, Urlaubstage, erledigte Task-Snapshots */
(function(){
  const REV52_PALETTE=['#7c5cff','#39bdf8','#22c55e','#ffb020','#ff5050','#ec4899','#14b8a6','#f97316','#a855f7','#64748b','#111827','#ffffff'];
  const OUTLINE_OPTIONS={current:'Wie aktuell',black:'Schwarz',gray:'Grau'};
  function todayBaseRev52(){const d=new Date();d.setHours(0,0,0,0);return d;}
  function selectedTimelineDateRev52(){return addDays(todayBaseRev52(),Number(state.timelineDayOffset||0));}
  function isSelectedTodayRev52(d){return sameDay(d,todayBaseRev52());}
  function ensureRev52State(){
    state.timelineStep=Number(state.timelineStep||30);
    state.timelinePauseMinutes=Math.max(0,Number(state.timelinePauseMinutes||0));
    state.workStartTime=state.workStartTime||'08:00';
    state.timelineDayOffset=Number(state.timelineDayOffset||0);
    state.outlineStyle=state.outlineStyle||'current';
    state.vacationHighlight=Object.assign({enabled:false,color:'#f97316',opacity:0.18},state.vacationHighlight||{});
    state.completedTaskArchive=state.completedTaskArchive||[];
  }
  const prevEnsureRev52=ensureSettings;
  ensureSettings=function(){prevEnsureRev52();ensureRev52State();};
  function outlineColorRev52(){
    if(state.outlineStyle==='black')return '#000000';
    if(state.outlineStyle==='gray')return '#7b8494';
    return getComputedStyle(document.documentElement).getPropertyValue('--line').trim()||'#31405e';
  }
  const prevApplyAppearanceRev52=applyAppearance;
  applyAppearance=function(){prevApplyAppearanceRev52();ensureRev52State();document.documentElement.style.setProperty('--outlineColorRev52',outlineColorRev52());};
  function allVisibleEventsForDayRev52(d){
    return visibleCalendars().flatMap(({cal:c,idx:ci})=>{
      const ics=(c.events||[]).map((e,ei)=>{const occ=eventOccurrenceForDate(e,d);return occ?Object.assign(occ,{_type:'ics',_cal:ci,_idx:ei}):null;}).filter(e=>{if(!e)return false;const l=(c.links||[]).find(x=>x.id===e.icsId);return !l||l.visible!==false;});
      const own=(c.ownEvents||[]).map((e,ei)=>{const occ=eventOccurrenceForDate(e,d);return occ?Object.assign(occ,{_type:'own',_cal:ci,_idx:ei}):null;}).filter(e=>{if(!e)return false;const l=(c.links||[]).find(x=>x.id===e.sourceId);return l&&l.visible!==false;});
      return [...ics,...own];
    });
  }
  function isVacationEventRev52(e){
    return !!e && !!e.allDay && String(e.summary||'').trim().toLowerCase()==='urlaub';
  }
  function isVacationDayRev52(d){
    ensureRev52State();
    return !!state.vacationHighlight.enabled && allVisibleEventsForDayRev52(d).some(isVacationEventRev52);
  }
  function vacationStyleRev52(){
    ensureRev52State();
    const c=state.vacationHighlight.color||'#f97316';
    const o=Math.max(0.05,Math.min(0.55,Number(state.vacationHighlight.opacity||0.18)));
    return `background:linear-gradient(0deg, color-mix(in srgb, ${c} ${Math.round(o*100)}%, transparent), color-mix(in srgb, ${c} ${Math.round(o*100)}%, transparent))!important;box-shadow:inset 0 0 0 9999px color-mix(in srgb, ${c} ${Math.round(o*55)}%, transparent)!important;`;
  }
  function groupNameForTaskRev52(t,isLong=false){
    const list=isLong?(state.longColumns||[]):(state.taskColumns||[]);
    const id=t.columnId||(list[0]&&list[0].id);
    return (list.find(c=>c.id===id)||{}).name||'Allgemein';
  }
  function upsertCompletedArchiveRev52(t,type){
    ensureRev52State();
    const isLong=type==='long';
    const groupName=groupNameForTaskRev52(t,isLong);
    const id=String(t.id);
    const old=state.completedTaskArchive.find(x=>x.taskId===id&&x.type===type);
    const snap={taskId:id,type,title:t.title||'',note:t.note||'',completedDate:t.completedDate||fmtDate(new Date()),groupId:t.columnId||'',groupName,archivedAt:new Date().toISOString()};
    if(old)Object.assign(old,snap);else state.completedTaskArchive.push(snap);
  }
  function removeCompletedArchiveRev52(id,type){
    ensureRev52State();
    state.completedTaskArchive=state.completedTaskArchive.filter(x=>!(x.taskId===String(id)&&x.type===type));
  }
  function archiveForRev52(id,type){
    ensureRev52State();
    return state.completedTaskArchive.find(x=>x.taskId===String(id)&&x.type===type)||null;
  }
  window.markTaskDoneSnapshotRev52=function(t,type,done){
    if(!t)return;
    if(done){t.done=true;t.completedDate=t.completedDate||fmtDate(new Date());upsertCompletedArchiveRev52(t,type);}else{t.done=false;t.completedDate=null;removeCompletedArchiveRev52(t.id,type);}
  };
  window.completedDoneList=function(tasks,longs){
    const a=(tasks||[]).map(t=>{const ar=archiveForRev52(t.id,'task');const g=ar?.groupName||groupNameForTaskRev52(t,false);return `<div class="card task task-card-compact completed-task-card" data-task-ref="task:${escapeHtml(t.id)}"><div class="task-row"><input type="checkbox" checked data-toggle-task="${escapeHtml(t.id)}"><div><span class="completed-title" title="${escapeHtml(ar?.title||t.title)}">${escapeHtml(shortText(ar?.title||t.title,34))}</span><span class="completed-meta">Erledigt am ${escapeHtml(t.completedDate||ar?.completedDate||'')} · Gruppe damals: ${escapeHtml(g)}</span></div><button class="kebab" data-delete-task="${escapeHtml(t.id)}">×</button></div></div>`;}).join('');
    const b=(longs||[]).map(t=>{const ar=archiveForRev52(t.id,'long');const g=ar?.groupName||groupNameForTaskRev52(t,true);return `<div class="card completed-long completed-task-card" data-task-ref="long:${escapeHtml(t.id)}"><div><span class="completed-title">${escapeHtml(shortText(ar?.title||t.title,34))}</span><span class="completed-meta">Langfristiger Task erledigt am ${escapeHtml(t.completedDate||ar?.completedDate||'')} · Gruppe damals: ${escapeHtml(g)}</span></div></div>`;}).join('');
    return `<div class="completed-grid">${a}${b}</div>`;
  };
  const prevTaskCardHtmlRev52=taskCardHtml;
  window.taskCardHtml=function(t,overdue=false,completedView=false){
    if(completedView){const ar=archiveForRev52(t.id,'task');const g=ar?.groupName||groupNameForTaskRev52(t,false);return `<div class="card task task-card-compact completed-task-card" data-task-ref="task:${escapeHtml(t.id)}"><div class="task-row"><input type="checkbox" checked data-toggle-task="${escapeHtml(t.id)}"><div><span class="completed-title" title="${escapeHtml(ar?.title||t.title)}">${escapeHtml(shortText(ar?.title||t.title,34))}</span><span class="completed-meta">Erledigt am ${escapeHtml(t.completedDate||ar?.completedDate||'')} · Gruppe damals: ${escapeHtml(g)}</span></div><button class="kebab" data-delete-task="${escapeHtml(t.id)}">×</button></div></div>`;}
    return prevTaskCardHtmlRev52(t,overdue,completedView);
  };

  function hhmm52(min){min=Math.max(0,Math.min(1439,Math.round(min)));return String(Math.floor(min/60)).padStart(2,'0')+':'+String(min%60).padStart(2,'0');}
  function parseHHMM52(v){const m=String(v||'').match(/^(\d{1,2}):(\d{2})$/);if(!m)return null;return Number(m[1])*60+Number(m[2]);}
  function eventRef52(e){return `${e._type}:${e._cal}:${e._idx}:${fmtDate(new Date(e.start))}`;}
  function timelineEventsForDate52(date){
    return allVisibleEventsForDayRev52(date).filter(e=>!e.allDay).map(e=>{const s=new Date(e.start),en=e.end?new Date(e.end):null;if(isNaN(s))return null;const start=s.getHours()*60+s.getMinutes();let end=en&&!isNaN(en)?en.getHours()*60+en.getMinutes():start+30;if(end<=start)end=start+30;return {summary:e.summary||'Ohne Titel',source:e.icsName||e.source||'Kalender',color:e.icsColor||state.colors.event,start,end,ref:eventRef52(e)};}).filter(Boolean).sort((a,b)=>a.start-b.start);
  }
  function layoutEvents52(items){
    const groups=[];
    items.forEach(it=>{let g=groups.find(gr=>it.start<gr.end);if(!g){g={end:it.end,items:[]};groups.push(g);}g.items.push(it);g.end=Math.max(g.end,it.end);});
    groups.forEach(g=>{const cols=[];g.items.forEach(it=>{let col=cols.findIndex(end=>end<=it.start);if(col<0){col=cols.length;cols.push(it.end);}else cols[col]=it.end;it.col=col;it.cols=cols.length;});g.items.forEach(it=>it.cols=Math.max(it.cols,cols.length));});
    return items;
  }
  window.renderSidebarTimelineRev050=function(){
    ensureRev52State();
    const sidebar=document.querySelector('.sidebar'); if(!sidebar)return;
    let box=document.querySelector('#sidebarDayTimelineRev049');
    if(!box){box=document.createElement('section');box.id='sidebarDayTimelineRev049';box.className='sidebar-day-timeline';sidebar.appendChild(box);} 
    const shown=selectedTimelineDateRev52();
    const events=layoutEvents52(timelineEventsForDate52(shown));
    const pxPerMin=0.55,totalH=1440*pxPerMin,step=Number(state.timelineStep||30),lines=[];
    for(let m=0;m<=1440;m+=step){const major=m%60===0;lines.push(`<div class="timeline-line ${major?'major':''}" style="top:${m*pxPerMin}px">${major?`<span class="timeline-line-label">${hhmm52(m)}</span>`:''}</div>`);}
    let nowLine='';
    if(isSelectedTodayRev52(shown)){const now=new Date();const nowMin=now.getHours()*60+now.getMinutes()+now.getSeconds()/60;nowLine=`<div class="timeline-now-line" data-now-line-rev50 style="top:${nowMin*pxPerMin}px"><span class="timeline-now-label">${hhmm52(nowMin)}</span></div>`;}
    const evHtml=events.map(it=>{const top=Math.max(0,it.start*pxPerMin),h=Math.max(18,(it.end-it.start)*pxPerMin),w=100/it.cols,left=it.col*w;const tiny=h<28;return `<div class="timeline-event-block ${tiny?'timeline-event-tiny':''}" data-event-ref="${escapeHtml(it.ref)}" style="top:${top}px;height:${h}px;left:calc(${left}% + 42px);width:calc(${w}% - 46px);border-left-color:${escapeHtml(it.color)};background:${escapeHtml(it.color)}cc"><b>${escapeHtml(shortText(it.summary,28))}</b><small>${escapeHtml(hhmm52(it.start)+'–'+hhmm52(it.end)+' · '+shortText(it.source,22))}</small></div>`;}).join('');
    const start=parseHHMM52(state.workStartTime),pause=Number(state.timelinePauseMinutes||0),endText=start===null?'—':hhmm52(start+8*60+pause),pauseText=pause?`Pause: ${pause} Min. · zählt nicht als Arbeitszeit.`:'Keine Pause hinterlegt.';
    const vacClass=isVacationDayRev52(shown)?' vacation-active':'';
    box.innerHTML=`<div class="sidebar-timeline-head"><div><div class="sidebar-timeline-title">Zeitstrahl</div><div class="sidebar-timeline-date">${escapeHtml(dateDERev046(shown))}</div></div><div class="timeline-day-nav"><button class="btn small ui-icon-btn" id="timelinePrevDay52" title="Vorheriger Tag">‹</button><button class="btn small" id="timelineToday52" title="Heute anzeigen">Heute</button><button class="btn small ui-icon-btn" id="timelineNextDay52" title="Nächster Tag">›</button></div></div><div class="timeline-work-row"><input id="timelineWorkStartRev50" type="time" value="${escapeHtml(state.workStartTime||'')}" title="Arbeitsbeginn"><button class="btn small ui-icon-btn timeline-settings-btn" id="timelineSettingsRev50" title="Zeitstrahl einstellen">${iconSettings()}</button></div><div class="timeline-pause-note">${escapeHtml(pauseText)}</div><div class="timeline-eod">Feierabend Zeit: <b>${escapeHtml(endText)}</b> 🍺</div><div class="timeline-canvas-wrap${vacClass}" ${vacClass?`style="${vacationStyleRev52()}"`:''}><div class="timeline-canvas" style="height:${totalH}px;min-height:${totalH}px">${lines.join('')}${nowLine}${evHtml||'<div class="timeline-empty">Keine sichtbaren Termine für diesen Tag.</div>'}</div></div>`;
    box.querySelector('#timelinePrevDay52').onclick=()=>{state.timelineDayOffset=Number(state.timelineDayOffset||0)-1;persist();renderSidebarTimelineRev050();};
    box.querySelector('#timelineToday52').onclick=()=>{state.timelineDayOffset=0;persist();renderSidebarTimelineRev050();};
    box.querySelector('#timelineNextDay52').onclick=()=>{state.timelineDayOffset=Number(state.timelineDayOffset||0)+1;persist();renderSidebarTimelineRev050();};
    const input=box.querySelector('#timelineWorkStartRev50'); if(input)input.onchange=()=>{state.workStartTime=input.value;persist();renderSidebarTimelineRev050();};
    const gear=box.querySelector('#timelineSettingsRev50'); if(gear)gear.onclick=openTimelineSettingsRev52;
    box.querySelectorAll('[data-event-ref]').forEach(el=>el.onclick=()=>openEventDetailModal(el.dataset.eventRef));
  };
  function openTimelineSettingsRev52(){
    ensureRev52State();
    openModal('Zeitstrahl einstellen',`<div class="edit-grid"><label>Schrittweite</label><select id="timelineStepModalRev52"><option value="60">Stundentakt</option><option value="30">Halbstundentakt</option><option value="15">Viertelstundentakt</option></select><label>Pausenzeit in Minuten</label><input id="timelinePauseModalRev52" type="number" min="0" step="5" value="${escapeHtml(state.timelinePauseMinutes)}"><div class="hint">Diese Werte werden als aktueller Stand im App-State gespeichert und bei Änderung überschrieben, nicht historisiert.</div></div>`,()=>{state.timelineStep=Number(document.querySelector('#timelineStepModalRev52')?.value||30);state.timelinePauseMinutes=Math.max(0,Number(document.querySelector('#timelinePauseModalRev52')?.value||0));persist();renderSidebarTimelineRev050();});
    const sel=document.querySelector('#timelineStepModalRev52'); if(sel)sel.value=String(state.timelineStep||30);
  }

  window.openSyncSettingsModal=function(){
    ensureRev52State();
    $('#modalTitle').textContent='Einstellungen';
    $('#modalContent').innerHTML=`<div class="settings-tabs-rev52"><button class="settings-tab-rev52 active" data-settings-tab="display">Anzeige</button><button class="settings-tab-rev52" data-settings-tab="sync">Synchronisierung</button><button class="settings-tab-rev52" data-settings-tab="special">Sonderlogik</button></div><div id="settingsTabContentRev52"></div>`;
    $('#modalBackdrop').style.display='flex';$('#saveModal').style.display='';
    let active='display';
    function renderTab(){
      const root=$('#settingsTabContentRev52');
      if(active==='display')root.innerHTML=`<div class="settings-grid"><div class="field"><label>Erscheinung</label><select id="mTheme"><option value="light">Hell</option><option value="dark">Dunkel</option></select></div><div class="field"><label>Kanten</label><select id="mCornerStyle"><option value="rounded">Abgerundet</option><option value="sharp">Eckig / 90°</option></select></div><div class="field"><label>Konturen</label><select id="mOutlineStyle"><option value="current">Wie aktuell</option><option value="gray">Grau</option><option value="black">Schwarz</option></select></div><div class="hint">Konturen betreffen die größeren Rahmen: Projekte, langfristige Task-Gruppen, Tagesrahmen, Kalender-/Task-Container.</div></div>`;
      if(active==='sync')root.innerHTML=`<div class="settings-grid"><button class="btn primary" id="mSyncNow" type="button">Alle ICS-Links aktualisieren</button><div class="field"><label>Intervall</label><select id="mSyncInterval"><option value="0">Aus / manuell</option><option value="5">Alle 5 Min.</option><option value="15">Alle 15 Min.</option><option value="30">Alle 30 Min.</option><option value="60">Alle 60 Min.</option></select></div><div class="field"><label>Proxy-URL</label><input id="mProxyUrl" class="readonly-input" value="${escapeHtml(currentUser?(state.proxyUrl||DEFAULT_PROXY_URL):'')}" readonly disabled></div><div class="dev-note">Nur während der Entwicklung sichtbar. Der Proxy wird automatisch verwendet.</div></div>`;
      if(active==='special')root.innerHTML=`<div class="settings-grid"><label class="settings-check-rev52"><span><b>Urlaubstage anders anzeigen</b><small>Wenn ein sichtbarer ICS- oder eigener Kalender einen Termin enthält, der exakt „Urlaub“ heißt und ganztägig ist, wird der ganze Tag farblich hinterlegt.</small></span><input id="mVacationEnabled" type="checkbox"></label><div class="field"><label>Urlaubsfarbe</label><input id="mVacationColor" type="color" value="${escapeHtml(state.vacationHighlight.color||'#f97316')}"></div><div class="hint">Die Logik greift nur bei ganztägigen Terminen mit exakt dem Titel „Urlaub“. Andere Begriffe wie „Urlaub Mallorca“ werden bewusst nicht automatisch erkannt.</div></div>`;
      const mt=$('#mTheme'); if(mt)mt.value=state.theme||'light';
      const mc=$('#mCornerStyle'); if(mc)mc.value=state.cornerStyle||'rounded';
      const mo=$('#mOutlineStyle'); if(mo)mo.value=state.outlineStyle||'current';
      const mi=$('#mSyncInterval'); if(mi)mi.value=String(state.syncInterval??15);
      const ms=$('#mSyncNow'); if(ms)ms.onclick=async()=>{saveSettingsFromModal();setupAutoSync();applyAppearance();await syncAllICS();};
      const ve=$('#mVacationEnabled'); if(ve)ve.checked=!!state.vacationHighlight.enabled;
    }
    function saveSettingsFromModal(){
      const mt=$('#mTheme'); if(mt)state.theme=mt.value;
      const mc=$('#mCornerStyle'); if(mc)state.cornerStyle=mc.value;
      const mo=$('#mOutlineStyle'); if(mo)state.outlineStyle=mo.value;
      const mi=$('#mSyncInterval'); if(mi)state.syncInterval=Number(mi.value);
      const ve=$('#mVacationEnabled'); if(ve)state.vacationHighlight.enabled=ve.checked;
      const vc=$('#mVacationColor'); if(vc)state.vacationHighlight.color=vc.value;
      state.fetchMode='proxy';state.proxyUrl=state.proxyUrl||DEFAULT_PROXY_URL;persist();applyAppearance();
    }
    $$('.settings-tab-rev52').forEach(btn=>btn.onclick=()=>{saveSettingsFromModal();active=btn.dataset.settingsTab;$$('.settings-tab-rev52').forEach(b=>b.classList.toggle('active',b===btn));renderTab();});
    renderTab();
    $('#saveModal').onclick=()=>{saveSettingsFromModal();setupAutoSync();closeModal();render();};
  };
  const oldRenderMonthViewRev52=renderMonthView;
  window.renderMonthView=function(){
    oldRenderMonthViewRev52();
    if(!state.vacationHighlight?.enabled)return;
    document.querySelectorAll('[data-month-date]').forEach(cell=>{const d=new Date(cell.dataset.monthDate+'T00:00:00');if(isVacationDayRev52(d)){cell.classList.add('vacation-day-rev52');cell.setAttribute('style',(cell.getAttribute('style')||'')+vacationStyleRev52());}});
  };
  const prevDayCardRev52=dayCard;
  window.dayCard=function(date){
    const node=prevDayCardRev52(date);
    if(isVacationDayRev52(date)){node.classList.add('vacation-day-rev52');node.setAttribute('style',(node.getAttribute('style')||'')+vacationStyleRev52());}
    node.querySelectorAll('[data-toggle-task]').forEach(c=>{const old=c.onchange;c.onchange=(ev)=>{ev.stopPropagation();const t=state.tasks.find(x=>x.id===c.dataset.toggleTask);if(t)markTaskDoneSnapshotRev52(t,'task',c.checked);if(old)old(ev);};});
    node.querySelectorAll('[data-toggle-long]').forEach(c=>{const old=c.onchange;c.onchange=(ev)=>{ev.stopPropagation();const t=state.longterm.find(x=>x.id===c.dataset.toggleLong);if(t)markTaskDoneSnapshotRev52(t,'long',c.checked);if(old)old(ev);};});
    return node;
  };
  setTimeout(()=>{ensureRev52State();applyAppearance();renderSidebarTimelineRev050();},250);
})();



/* Rev 053: Settings-Modal wirklich an Optionen > Einstellungen anbinden, Konturfarbe + Urlaubs-Lowlight in Allgemein */
(function(){
  function ensureRev53State(){
    state.outlineStyle=state.outlineStyle||'current';
    state.vacationHighlight=Object.assign({enabled:false,color:'#f97316',opacity:0.18},state.vacationHighlight||{});
  }
  function outlineColor53(){
    ensureRev53State();
    if(state.outlineStyle==='black')return '#000000';
    if(state.outlineStyle==='gray')return '#7b8494';
    return getComputedStyle(document.documentElement).getPropertyValue('--line').trim()||'#31405e';
  }
  const prevApplyAppearance53=applyAppearance;
  applyAppearance=function(){
    prevApplyAppearance53();
    ensureRev53State();
    document.documentElement.style.setProperty('--outlineColorRev52',outlineColor53());
    document.documentElement.style.setProperty('--frameBorderColor53',outlineColor53());
  };
  function saveSettings53(){
    const theme=document.querySelector('#mTheme53'); if(theme)state.theme=theme.value;
    const corners=document.querySelector('#mCornerStyle53'); if(corners)state.cornerStyle=corners.value;
    const outline=document.querySelector('#mOutlineStyle53'); if(outline)state.outlineStyle=outline.value;
    const vacation=document.querySelector('#mVacationEnabled53'); if(vacation)state.vacationHighlight.enabled=vacation.checked;
    const vacationColor=document.querySelector('#mVacationColor53'); if(vacationColor)state.vacationHighlight.color=vacationColor.value;
    const interval=document.querySelector('#mSyncInterval53'); if(interval)state.syncInterval=Number(interval.value);
    state.fetchMode='proxy';
    state.proxyUrl=state.proxyUrl||DEFAULT_PROXY_URL;
    persist();
    applyAppearance();
  }
  function tabButton53(id,label,active){return `<button class="settings-tab-rev53 ${active?'active':''}" data-settings-tab53="${id}" type="button">${label}</button>`;}
  function renderSettingsTab53(active){
    const root=document.querySelector('#settingsTabContentRev53'); if(!root)return;
    ensureRev53State();
    if(active==='general'){
      root.innerHTML=`<div class="settings-grid">
        <div class="field"><label>Erscheinung</label><select id="mTheme53"><option value="light">Hell</option><option value="dark">Dunkel</option></select></div>
        <div class="field"><label>Kanten</label><select id="mCornerStyle53"><option value="rounded">Abgerundet</option><option value="sharp">Eckig / 90°</option></select></div>
        <div class="field"><label>Konturfarbe</label><select id="mOutlineStyle53"><option value="current">Wie aktuell</option><option value="gray">Grau</option><option value="black">Schwarz</option></select></div>
        <div class="hint">Die Konturfarbe betrifft die größeren Rahmen der Oberfläche: Tagesrahmen, Kalendergruppen, Projekt-/Langfristgruppen, Monatszellen und Container. Einzelne Task-Karten bleiben unverändert.</div>
        <label class="settings-check-rev53"><span><b>Urlaubstage anders anzeigen</b><small>Aktiviert ein farbiges Lowlight für ganze Tage. Die Erkennung greift nur, wenn ein sichtbarer ICS-Kalender oder eigener Kalender einen ganztägigen Termin mit exakt dem Titel „Urlaub“ enthält.</small></span><input id="mVacationEnabled53" type="checkbox"></label>
        <div class="field"><label>Urlaubsfarbe</label><input id="mVacationColor53" type="color" value="${escapeHtml(state.vacationHighlight.color||'#f97316')}"></div>
      </div>`;
      document.querySelector('#mTheme53').value=state.theme||'light';
      document.querySelector('#mCornerStyle53').value=state.cornerStyle||'rounded';
      document.querySelector('#mOutlineStyle53').value=state.outlineStyle||'current';
      document.querySelector('#mVacationEnabled53').checked=!!state.vacationHighlight.enabled;
      ['#mTheme53','#mCornerStyle53','#mOutlineStyle53','#mVacationEnabled53','#mVacationColor53'].forEach(sel=>{const el=document.querySelector(sel);if(el)el.onchange=()=>{saveSettings53();render();};});
    }
    if(active==='sync'){
      root.innerHTML=`<div class="settings-grid">
        <button class="btn primary" id="mSyncNow53" type="button">Alle ICS-Links aktualisieren</button>
        <div class="field"><label>Intervall</label><select id="mSyncInterval53"><option value="0">Aus / manuell</option><option value="5">Alle 5 Min.</option><option value="15">Alle 15 Min.</option><option value="30">Alle 30 Min.</option><option value="60">Alle 60 Min.</option></select></div>
        <div class="field"><label>Proxy-URL</label><input class="readonly-input" value="${escapeHtml(currentUser?(state.proxyUrl||DEFAULT_PROXY_URL):'')}" readonly disabled></div>
        <div class="dev-note">Der Proxy wird automatisch verwendet. Die Adresse ist nur zur Kontrolle sichtbar und hier nicht bearbeitbar.</div>
      </div>`;
      document.querySelector('#mSyncInterval53').value=String(state.syncInterval??15);
      document.querySelector('#mSyncInterval53').onchange=()=>{saveSettings53();setupAutoSync();};
      document.querySelector('#mSyncNow53').onclick=async()=>{saveSettings53();setupAutoSync();applyAppearance();await syncAllICS();};
    }
    if(active==='info'){
      root.innerHTML=`<div class="settings-grid"><div class="security-note"><b>Urlaubslogik</b><br>Ein Tag wird nur dann farbig hinterlegt, wenn ein sichtbarer Termin exakt „Urlaub“ heißt und ganztägig ist. Das verhindert Fehlmarkierungen bei normalen Terminen wie „Urlaub planen“ oder „Urlaub beantragen“.</div><div class="security-note"><b>Speicherlogik</b><br>Konturfarbe, Urlaubs-Lowlight, Urlaubsfarbe und Synchronisationsintervall werden als aktuelle UI-/Anzeigeeinstellung im App-State gespeichert und bei Änderung überschrieben.</div></div>`;
    }
  }
  function openSettingsRev53(){
    ensureRev53State();
    document.querySelector('#modalTitle').textContent='Allgemeine Einstellungen';
    document.querySelector('#modalContent').innerHTML=`<div class="settings-layout-rev53"><div class="settings-tabs-rev53">${tabButton53('general','Allgemein',true)}${tabButton53('sync','Synchronisierung',false)}${tabButton53('info','Hinweise',false)}</div><div id="settingsTabContentRev53" class="settings-tab-content-rev53"></div></div>`;
    document.querySelector('#modalBackdrop').style.display='flex';
    document.querySelector('#saveModal').style.display='';
    let active='general';
    renderSettingsTab53(active);
    document.querySelectorAll('[data-settings-tab53]').forEach(btn=>btn.onclick=()=>{saveSettings53();active=btn.dataset.settingsTab53;document.querySelectorAll('[data-settings-tab53]').forEach(b=>b.classList.toggle('active',b===btn));renderSettingsTab53(active);});
    document.querySelector('#saveModal').onclick=()=>{saveSettings53();setupAutoSync();closeModal();render();};
  }
  window.openSettingsRev53=openSettingsRev53;
  window.openSyncSettingsModal=openSettingsRev53;
  function bindSettingsButton53(){
    const btn=document.querySelector('#settingsBtn');
    if(btn)btn.onclick=openSettingsRev53;
  }
  document.addEventListener('DOMContentLoaded',bindSettingsButton53);
  setTimeout(bindSettingsButton53,0);
  setTimeout(bindSettingsButton53,400);
  setTimeout(()=>{ensureRev53State();applyAppearance();},200);
})();


/* Rev 054: completed_tasks als echte Verlaufstabelle + kontrolliertes Wiederöffnen */
(function(){
  const COMPLETED_TABLE_REV54='completed_tasks';

  function ensureRev54State(){
    state.completedTasksTable=Array.isArray(state.completedTasksTable)?state.completedTasksTable:[];
  }
  function groupSnapshotRev54(t,type){
    if(type==='long'){
      const g=(state.longColumns||[]).find(x=>x.id===(t.columnId||t.longTaskGroupId));
      return {id:t.columnId||t.longTaskGroupId||'',name:g?.name||t.originalGroupName||'Unbekannte Gruppe',color:g?.color||t.originalGroupColor||state.colors?.long||defaultColors.long};
    }
    const g=(state.taskColumns||[]).find(x=>x.id===(t.columnId||t.taskGroupId));
    return {id:t.columnId||t.taskGroupId||'',name:g?.name||t.originalGroupName||'Unbekannte Gruppe',color:g?.color||t.originalGroupColor||state.colors?.task||defaultColors.task};
  }
  function completedFromRowRev54(r){
    return {
      completedId:r.id,
      originalTaskId:r.original_task_id,
      type:r.task_type||'daily',
      title:r.title||'Ohne Titel',
      note:r.note||'',
      originalDate:r.original_date||null,
      completedDate:r.completed_date||fmtDate(new Date()),
      originalGroupId:r.original_group_id||'',
      originalGroupName:r.original_group_name||'Unbekannte Gruppe',
      originalGroupColor:r.original_group_color||null,
      createdAt:r.created_at||null
    };
  }
  function completedToInsertRev54(t,type){
    const g=groupSnapshotRev54(t,type);
    return {
      user_id:currentUser.id,
      original_task_id:isUuid(t.id)?t.id:null,
      task_type:type==='long'?'long':'daily',
      title:t.title||'Ohne Titel',
      note:t.note||null,
      original_date:type==='long'?null:(t.date||fmtDate(new Date())),
      completed_date:fmtDate(new Date()),
      original_group_id:String(g.id||''),
      original_group_name:g.name||'Unbekannte Gruppe',
      original_group_color:g.color||null
    };
  }
  async function loadCompletedTasksRev54(){
    ensureRev54State();
    if(!currentUser)return;
    const {data,error}=await supabaseClient.from(COMPLETED_TABLE_REV54).select('*').eq('user_id',currentUser.id).order('completed_date',{ascending:false}).order('created_at',{ascending:false});
    if(error){
      console.error('completed_tasks laden fehlgeschlagen',error);
      const msg=(error.message||'').toLowerCase().includes('does not exist')?'Tabelle completed_tasks fehlt in Supabase. SQL-Skript ausführen.':('completed_tasks konnte nicht geladen werden: '+error.message);
      toast(msg);
      state.completedTasksTable=[];
      return;
    }
    state.completedTasksTable=(data||[]).map(completedFromRowRev54);
  }
  async function completeTaskToTableRev54(t,type){
    if(!currentUser||!t)return;
    ensureRev54State();
    const row=completedToInsertRev54(t,type);
    const {data,error}=await supabaseClient.from(COMPLETED_TABLE_REV54).insert(row).select('*').single();
    if(error){
      console.error('completed_tasks INSERT fehlgeschlagen',error);
      toast('Erledigter Task konnte nicht in completed_tasks gespeichert werden: '+error.message);
      return;
    }
    const completed=completedFromRowRev54(data);
    state.completedTasksTable.unshift(completed);
    if(type==='long'){
      state.longterm=state.longterm.filter(x=>x.id!==t.id);
      await dbDeleteRowRev041('long_tasks',t.id);
    }else{
      state.tasks=state.tasks.filter(x=>x.id!==t.id);
      await dbDeleteRowRev041('tasks',t.id);
    }
    render();
  }
  function originalGroupExistsRev54(c){
    if(c.type==='long')return !!(state.longColumns||[]).find(g=>g.id===c.originalGroupId);
    return !!(state.taskColumns||[]).find(g=>g.id===c.originalGroupId);
  }
  async function reopenCompletedTaskRev54(completedId,checkbox){
    ensureRev54State();
    const c=state.completedTasksTable.find(x=>x.completedId===completedId);
    if(!c)return;
    if(!originalGroupExistsRev54(c)){
      if(checkbox)checkbox.checked=true;
      toast('Diese Gruppe existiert nicht mehr. Der Task kann nicht wieder geöffnet werden. Details bleiben weiterhin einsehbar.');
      return;
    }
    const restoredId=isUuid(c.originalTaskId)?c.originalTaskId:crypto.randomUUID();
    if(c.type==='long'){
      const task={id:restoredId,title:c.title,note:c.note||'',done:false,completedDate:null,columnId:c.originalGroupId,createdDate:fmtDate(new Date())};
      state.longterm.push(task);
      const row={id:task.id,user_id:currentUser.id,long_task_group_id:task.columnId,title:task.title,note:task.note||null,done:false,completed_date:null,position:(state.longterm||[]).length};
      const {error}=await supabaseClient.from('long_tasks').upsert(row,{onConflict:'id'});
      if(error){if(checkbox)checkbox.checked=true;toast('Wiederöffnen fehlgeschlagen: '+error.message);state.longterm=state.longterm.filter(x=>x.id!==task.id);return;}
    }else{
      const task={id:restoredId,title:c.title,note:c.note||'',date:c.originalDate||fmtDate(new Date()),done:false,completedDate:null,columnId:c.originalGroupId};
      state.tasks.push(task);
      const row={id:task.id,user_id:currentUser.id,task_group_id:task.columnId,title:task.title,note:task.note||null,task_date:task.date,done:false,completed_date:null,position:(state.tasks||[]).length};
      const {error}=await supabaseClient.from('tasks').upsert(row,{onConflict:'id'});
      if(error){if(checkbox)checkbox.checked=true;toast('Wiederöffnen fehlgeschlagen: '+error.message);state.tasks=state.tasks.filter(x=>x.id!==task.id);return;}
    }
    const {error:delError}=await supabaseClient.from(COMPLETED_TABLE_REV54).delete().eq('user_id',currentUser.id).eq('id',completedId);
    if(delError){toast('Aktiver Task wurde wiederhergestellt, aber completed_tasks konnte nicht bereinigt werden: '+delError.message);}
    state.completedTasksTable=state.completedTasksTable.filter(x=>x.completedId!==completedId);
    render();
  }
  function completedCardRev54(c){
    const col=c.originalGroupColor||state.colors?.task||defaultColors.task;
    const kind=c.type==='long'?'Langfristig':'Tagestask';
    const originalDate=c.originalDate?` · Ursprünglich: ${escapeHtml(c.originalDate)}`:'';
    const groupMissing=!originalGroupExistsRev54(c);
    return `<div class="card task task-card-compact completed-task-card completed-table-card-rev54" data-completed-ref="${escapeHtml(c.completedId)}" style="border-left-color:${escapeHtml(col)}!important"><div class="task-row"><input type="checkbox" checked data-toggle-completed-rev54="${escapeHtml(c.completedId)}" title="Wieder öffnen"><div><span class="completed-title" title="${escapeHtml(c.title)}">${escapeHtml(shortText(c.title,34))}</span><span class="completed-meta">${escapeHtml(kind)} · Erledigt am ${escapeHtml(c.completedDate||'')} · Gruppe damals: ${escapeHtml(c.originalGroupName||'—')}${originalDate}${groupMissing?' · Gruppe gelöscht':''}</span></div><button class="kebab" data-completed-detail-rev54="${escapeHtml(c.completedId)}" title="Details">⋯</button></div></div>`;
  }
  function completedForDayRev54(iso){
    ensureRev54State();
    return (state.completedTasksTable||[]).filter(c=>c.completedDate===iso);
  }
  function completedTableHtmlRev54(iso){
    const list=completedForDayRev54(iso);
    if(!list.length)return '';
    return `<div class="completed-grid completed-table-grid-rev54">${list.map(completedCardRev54).join('')}</div>`;
  }
  function openCompletedDetailRev54(id){
    ensureRev54State();
    const c=state.completedTasksTable.find(x=>x.completedId===id);
    if(!c)return;
    const exists=originalGroupExistsRev54(c);
    $('#modalTitle').textContent='Erledigter Task · Details';
    $('#modalContent').innerHTML=`<div class="event-detail-grid"><b>Titel</b><div>${escapeHtml(c.title||'—')}</div><b>Typ</b><div>${escapeHtml(c.type==='long'?'Langfristiger Task':'Tagestask')}</div><b>Erledigt am</b><div>${escapeHtml(c.completedDate||'—')}</div><b>Ursprüngliches Datum</b><div>${escapeHtml(c.originalDate||'—')}</div><b>Damals in Gruppe</b><div>${escapeHtml(c.originalGroupName||'—')}</div><b>Gruppenstatus</b><div>${exists?'Gruppe existiert noch. Wiederöffnen ist möglich.':'Diese Gruppe existiert nicht mehr. Wiederöffnen ist gesperrt.'}</div><b>Notiz</b><div>${c.note?`<div class="detail-long expanded">${escapeHtml(c.note)}</div>`:'—'}</div></div>`;
    $('#modalBackdrop').style.display='flex';
    $('#saveModal').style.display='none';
  }

  const oldLoadRelationalRev54=loadRelationalData;
  loadRelationalData=async function(){
    await oldLoadRelationalRev54();
    await loadCompletedTasksRev54();
  };

  const oldSaveSnapshotRev54=saveRelationalSnapshot;
  saveRelationalSnapshot=async function(){
    // completed_tasks wird absichtlich nicht per Snapshot überschrieben.
    // Erledigungen werden nur durch explite Aktionen INSERT/DELETE bewegt.
    await oldSaveSnapshotRev54();
  };

  const prevDayCardRev54=dayCard;
  dayCard=function(date){
    const node=prevDayCardRev54(date);
    const iso=fmtDate(date);
    const completedHtml=completedTableHtmlRev54(iso);
    if(completedHtml){
      const body=node.querySelector('.day-body');
      const details=node.querySelector('.completed-collapse .completed-collapse-body');
      if(details){details.insertAdjacentHTML('afterbegin',completedHtml);}
      else if(body){
        const today=new Date();today.setHours(0,0,0,0);
        body.insertAdjacentHTML('beforeend',`<div class="partition"><details class="completed-collapse" open><summary>${sameDay(date,today)?'4':'3'}. An diesem Tag erledigte Tasks</summary><div class="completed-collapse-body">${completedHtml}</div></details></div>`);
      }
    }
    node.querySelectorAll('[data-toggle-task]').forEach(c=>{
      const old=c.onchange;
      c.onchange=async(ev)=>{
        ev.stopPropagation();
        if(!requireLogin()){c.checked=!c.checked;return;}
        const t=state.tasks.find(x=>x.id===c.dataset.toggleTask);
        if(t&&c.checked){await completeTaskToTableRev54(t,'daily');return;}
        if(old)old(ev);
      };
    });
    node.querySelectorAll('[data-toggle-long]').forEach(c=>{
      const old=c.onchange;
      c.onchange=async(ev)=>{
        ev.stopPropagation();
        if(!requireLogin()){c.checked=!c.checked;return;}
        const t=state.longterm.find(x=>x.id===c.dataset.toggleLong);
        if(t&&c.checked){await completeTaskToTableRev54(t,'long');return;}
        if(old)old(ev);
      };
    });
    node.querySelectorAll('[data-toggle-completed-rev54]').forEach(c=>{
      c.onclick=ev=>ev.stopPropagation();
      c.onchange=async(ev)=>{ev.stopPropagation(); if(!c.checked)await reopenCompletedTaskRev54(c.dataset.toggleCompletedRev54,c);};
    });
    node.querySelectorAll('[data-completed-detail-rev54]').forEach(b=>b.onclick=(ev)=>{ev.stopPropagation();openCompletedDetailRev54(b.dataset.completedDetailRev54);});
    node.querySelectorAll('[data-completed-ref]').forEach(card=>card.onclick=()=>openCompletedDetailRev54(card.dataset.completedRef));
    return node;
  };

  const oldRenderLongRev54=renderLong;
  renderLong=function(){
    oldRenderLongRev54();
    document.querySelectorAll('#longTermList [data-toggle-long]').forEach(c=>{
      const old=c.onchange;
      c.onchange=async(ev)=>{
        ev.stopPropagation();
        if(!requireLogin()){c.checked=!c.checked;return;}
        const t=state.longterm.find(x=>x.id===c.dataset.toggleLong);
        if(t&&c.checked){await completeTaskToTableRev54(t,'long');return;}
        if(old)old(ev);
      };
    });
  };

  // Detailfenster: completed-Archiv aus App-State bleibt lesbar, neue Tabelle ist führend.
  window.loadCompletedTasksRev54=loadCompletedTasksRev54;
  window.reopenCompletedTaskRev54=reopenCompletedTaskRev54;
  window.completeTaskToTableRev54=completeTaskToTableRev54;
  ensureRev54State();
})();



/* Rev 055: UUID-Reparatur für Gruppen, korrektes Wiederöffnen erledigter Tasks, Long-Task-Zielgruppe fix, alte AppState-Erledigt-Snapshots deaktiviert */
(function(){
  const COMPLETED_TABLE_REV55='completed_tasks';

  // Die alte Rev52-AppState-Archivfunktion wird ab jetzt bewusst stillgelegt.
  // completed_tasks ist die führende Historientabelle.
  window.markTaskDoneSnapshotRev52=function(){ return; };
  function clearLegacyCompletedArchiveRev55(){
    if(state && Array.isArray(state.completedTaskArchive) && state.completedTaskArchive.length){
      state.completedTaskArchive=[];
    }
  }

  function rev55GroupList(kind){ return kind==='long' ? (state.longColumns||[]) : (state.taskColumns||[]); }
  function rev55Table(kind){ return kind==='long' ? 'long_task_groups' : 'task_groups'; }
  function rev55DefaultColor(kind){ return kind==='long' ? (state.colors?.long||defaultColors.long) : (state.colors?.task||defaultColors.task); }
  function rev55FindGroup(kind, groupId, groupName){
    const list=rev55GroupList(kind);
    return list.find(g=>String(g.id)===String(groupId||'')) || (groupName ? list.find(g=>String(g.name||'')===String(groupName||'')) : null);
  }

  async function ensureGroupUuidRev55(kind, groupId, groupName='', groupColor=null){
    if(!currentUser)return null;
    ensureSettings(); if(kind==='long')ensureRev033State();
    const list=rev55GroupList(kind);
    let g=rev55FindGroup(kind, groupId, groupName);
    if(!g)return null;
    if(isUuid(g.id))return g.id;

    const oldId=String(g.id||'');
    const newId=crypto.randomUUID();
    g.id=newId;
    g.color=g.color||groupColor||rev55DefaultColor(kind);

    if(kind==='long'){
      (state.longterm||[]).forEach(t=>{ if(String(t.columnId||'')===oldId)t.columnId=newId; });
    }else{
      (state.tasks||[]).forEach(t=>{ if(String(t.columnId||'')===oldId)t.columnId=newId; });
    }

    // Bereits geladene completed_tasks auf die reparierte UUID umbiegen, damit Wiederöffnen künftig stabil bleibt.
    (state.completedTasksTable||[]).forEach(c=>{
      const sameId=String(c.originalGroupId||'')===oldId;
      const sameName=groupName && String(c.originalGroupName||'')===String(groupName||'');
      const sameKind=(kind==='long'&&c.type==='long')||(kind!=='long'&&c.type!=='long');
      if(sameKind&&(sameId||sameName))c.originalGroupId=newId;
    });

    const row={id:newId,user_id:currentUser.id,name:g.name||groupName||'Allgemein',color:g.color||rev55DefaultColor(kind),visible:g.visible!==false,position:Math.max(0,list.indexOf(g))};
    const {error}=await supabaseClient.from(rev55Table(kind)).upsert(row,{onConflict:'id'});
    if(error)throw error;

    // Falls Archivzeilen noch die alte Pseudo-ID gespeichert haben, reparieren wir sie ebenfalls.
    await supabaseClient.from(COMPLETED_TABLE_REV55)
      .update({original_group_id:newId})
      .eq('user_id',currentUser.id)
      .eq('original_group_id',oldId);

    return newId;
  }

  async function resolveExistingGroupForRestoreRev55(c){
    const kind=c.type==='long'?'long':'task';
    const g=rev55FindGroup(kind,c.originalGroupId,c.originalGroupName);
    if(!g)return null;
    return await ensureGroupUuidRev55(kind,g.id,c.originalGroupName,c.originalGroupColor);
  }

  // Insert-Funktionen überschreiben: ausgewählte Gruppe bleibt erhalten, auch wenn sie aus alten AppState-IDs stammt.
  insertTaskRev043=async function(task){
    if(!currentUser)throw new Error('Nicht angemeldet');
    const gid=await ensureGroupUuidRev55('task',task.columnId,'',null);
    if(!gid)throw new Error('Die ausgewählte Tagestask-Gruppe existiert nicht mehr.');
    const row={user_id:currentUser.id,task_group_id:gid,title:task.title||'Ohne Titel',note:task.note||null,task_date:task.date||fmtDate(new Date()),done:!!task.done,completed_date:task.completedDate||null,position:state.tasks?.length||0};
    const {data,error}=await supabaseClient.from('tasks').insert(row).select('*').single();
    if(error)throw error;
    return {id:data.id,title:data.title,note:data.note||'',date:data.task_date,done:!!data.done,completedDate:data.completed_date||null,columnId:data.task_group_id};
  };

  insertLongTaskRev043=async function(task){
    if(!currentUser)throw new Error('Nicht angemeldet');
    const gid=await ensureGroupUuidRev55('long',task.columnId,'',null);
    if(!gid)throw new Error('Die ausgewählte langfristige Task-Gruppe existiert nicht mehr.');
    const row={user_id:currentUser.id,long_task_group_id:gid,title:task.title||'Ohne Titel',note:task.note||null,done:!!task.done,completed_date:task.completedDate||null,position:state.longterm?.length||0};
    const {data,error}=await supabaseClient.from('long_tasks').insert(row).select('*').single();
    if(error)throw error;
    return {id:data.id,title:data.title,note:data.note||'',done:!!data.done,completedDate:data.completed_date||null,columnId:data.long_task_group_id,createdDate:data.created_at?fmtDate(new Date(data.created_at)):fmtDate(new Date())};
  };

  async function reopenCompletedTaskRev55(completedId,checkbox){
    const c=(state.completedTasksTable||[]).find(x=>x.completedId===completedId);
    if(!c)return;
    try{
      const kind=c.type==='long'?'long':'task';
      const groupUuid=await resolveExistingGroupForRestoreRev55(c);
      if(!groupUuid){
        if(checkbox)checkbox.checked=true;
        toast('Diese Gruppe existiert nicht mehr. Der Task kann nicht wieder geöffnet werden. Details bleiben weiterhin einsehbar.');
        return;
      }
      const restoredId=isUuid(c.originalTaskId)?c.originalTaskId:crypto.randomUUID();
      if(kind==='long'){
        const task={id:restoredId,title:c.title,note:c.note||'',done:false,completedDate:null,columnId:groupUuid,createdDate:fmtDate(new Date())};
        const row={id:task.id,user_id:currentUser.id,long_task_group_id:groupUuid,title:task.title,note:task.note||null,done:false,completed_date:null,position:(state.longterm||[]).length};
        const {error}=await supabaseClient.from('long_tasks').upsert(row,{onConflict:'id'});
        if(error)throw error;
        state.longterm.push(task);
      }else{
        const task={id:restoredId,title:c.title,note:c.note||'',date:c.originalDate||fmtDate(new Date()),done:false,completedDate:null,columnId:groupUuid};
        const row={id:task.id,user_id:currentUser.id,task_group_id:groupUuid,title:task.title,note:task.note||null,task_date:task.date,done:false,completed_date:null,position:(state.tasks||[]).length};
        const {error}=await supabaseClient.from('tasks').upsert(row,{onConflict:'id'});
        if(error)throw error;
        state.tasks.push(task);
      }
      const {error:delError}=await supabaseClient.from(COMPLETED_TABLE_REV55).delete().eq('user_id',currentUser.id).eq('id',completedId);
      if(delError)throw delError;
      state.completedTasksTable=(state.completedTasksTable||[]).filter(x=>x.completedId!==completedId);
      render();
      toast('Task wieder geöffnet.');
    }catch(error){
      if(checkbox)checkbox.checked=true;
      toast('Wieder öffnen fehlgeschlagen: '+(error.message||error));
    }
  }

  // completed_tasks-Checkboxen nach Rev54 erneut binden, damit die reparierte Wiederöffnen-Logik greift.
  const oldDayCardRev55=dayCard;
  dayCard=function(date){
    const node=oldDayCardRev55(date);
    clearLegacyCompletedArchiveRev55();
    node.querySelectorAll('[data-toggle-completed-rev54]').forEach(c=>{
      c.onclick=ev=>ev.stopPropagation();
      c.onchange=async(ev)=>{ev.stopPropagation(); if(!c.checked)await reopenCompletedTaskRev55(c.dataset.toggleCompletedRev54,c);};
    });
    return node;
  };

  // Long-Task-Modal explizit neu binden, damit die gewählte Gruppe nicht auf die erste Gruppe zurückfällt.
  openLongModal=function(){
    if(!requireLogin())return;ensureRev033State();
    openModal('Langfristigen Task hinzufügen',`<input id="mTitle" placeholder="Langfristiger Task"><select id="mLongColumn">${state.longColumns.map(c=>`<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`).join('')}</select><textarea id="mNote" rows="3" placeholder="Notiz"></textarea>`,async()=>{
      const title=$('#mTitle').value.trim();
      if(!title)return toast('Aufgabe ohne Titel wurde nicht gespeichert.');
      try{
        const selectedGroup=$('#mLongColumn').value;
        const saved=await insertLongTaskRev043({title,done:false,note:$('#mNote').value.trim(),columnId:selectedGroup});
        state.longterm.push(saved);render();toast('Langfristiger Task gespeichert.');
      }catch(error){toast('Langfristiger Task konnte nicht gespeichert werden: '+(error.message||error));}
    });
  };

  window.reopenCompletedTaskRev54=reopenCompletedTaskRev55;
  window.reopenCompletedTaskRev55=reopenCompletedTaskRev55;
  window.ensureGroupUuidRev55=ensureGroupUuidRev55;
})();



/* Rev 056: Settings-Bereinigung, App-State-Farben, Serverzeit, Completed-Tasks für alle Tasktypen, UI-Politur */
(function(){
  const COMPLETED_TABLE_REV56='completed_tasks';
  const NATIVE_DATE_REV56=window.Date;
  const OUTLINE_PALETTE_REV56=['#64748b','#000000','#ffffff','#7c5cff','#39bdf8','#22c55e','#ffb020','#ff5050','#ec4899','#14b8a6','#f97316','#a855f7'];

  function ensureRev56State(){
    state.outlineStyle=state.outlineStyle||'current';
    state.outlineCustomColor=state.outlineCustomColor||'#64748b';
    state.vacationHighlight=Object.assign({enabled:false,color:'#f97316',opacity:0.18},state.vacationHighlight||{});
    state.todayHighlight=Object.assign({borderWidth:4,borderColor:'#0284c7',opacity:0.18},state.todayHighlight||{});
    state.timelineStep=Number(state.timelineStep||30);
    state.timelinePauseMinutes=Math.max(0,Number(state.timelinePauseMinutes||0));
    state.workStartTime=state.workStartTime||'08:00';
  }
  function rev56SafeColor(v,fallback){return /^#[0-9a-f]{6}$/i.test(String(v||''))?String(v):fallback;}
  function outlineColor56(){
    ensureRev56State();
    if(state.outlineStyle==='none')return 'transparent';
    if(state.outlineStyle==='black')return '#000000';
    if(state.outlineStyle==='gray')return '#7b8494';
    if(state.outlineStyle==='custom')return rev56SafeColor(state.outlineCustomColor,'#64748b');
    return getComputedStyle(document.documentElement).getPropertyValue('--line').trim()||'#31405e';
  }
  const prevApplyAppearance56=applyAppearance;
  applyAppearance=function(){
    prevApplyAppearance56();
    ensureRev56State();
    const outline=outlineColor56();
    document.documentElement.style.setProperty('--outlineColorRev52',outline);
    document.documentElement.style.setProperty('--frameBorderColor53',outline);
    document.documentElement.style.setProperty('--todayBorderWidth56',Math.max(1,Math.min(10,Number(state.todayHighlight.borderWidth||4)))+'px');
    document.documentElement.style.setProperty('--todayBorderColor56',rev56SafeColor(state.todayHighlight.borderColor,'#0284c7'));
    document.documentElement.style.setProperty('--todayFillOpacity56',String(Math.max(0,Math.min(0.65,Number(state.todayHighlight.opacity||0.18)))));
    document.documentElement.style.setProperty('--todayFillOpacityPercent56',(Math.round(Math.max(0,Math.min(0.65,Number(state.todayHighlight.opacity||0.18)))*100))+'%');
  };

  // Best-Effort-Web-/Serverzeit: nutzt den Date-Header des Supabase-Projekts. Fallback bleibt Geräteeinstellung.
  async function syncServerTimeRev56(){
    try{
      const res=await fetch(SUPABASE_URL,{method:'HEAD',cache:'no-store'});
      const hdr=res.headers.get('date');
      if(!hdr)return;
      const server=NATIVE_DATE_REV56.parse(hdr);
      if(!Number.isFinite(server))return;
      const diff=server-NATIVE_DATE_REV56.now();
      if(Math.abs(diff)<12*60*60*1000){
        state.serverTimeOffsetMs=diff;
        state.serverTimeCheckedAt=new NATIVE_DATE_REV56().toISOString();
        persist();
      }
    }catch(e){console.warn('Serverzeit konnte nicht geladen werden',e);}
  }
  // Date patch bewusst erst nach erfolgreicher Plausibilität. Parsing mit Argumenten bleibt nativ.
  if(!window.__rev56DatePatched){
    window.__rev56DatePatched=true;
    const Native=NATIVE_DATE_REV56;
    class ServerAwareDate extends Native{
      constructor(...args){args.length?super(...args):super(Native.now()+Number(state?.serverTimeOffsetMs||0));}
      static now(){return Native.now()+Number(state?.serverTimeOffsetMs||0);}
      static parse(v){return Native.parse(v);}
      static UTC(...args){return Native.UTC(...args);}
    }
    window.Date=ServerAwareDate;
  }

  function colorButtonHtml56(id,color,title='Farbe wählen'){
    return `<button class="btn small ui-icon-btn color-bucket-btn rev56-color-btn" id="${id}" type="button" title="${escapeHtml(title)}"><span class="rev56-bucket-dot" style="background:${escapeHtml(color)}"></span>${iconColorBucket()}</button>`;
  }
  function paletteHtml56(targetId,current){
    const cur=rev56SafeColor(current,'#64748b');
    return `<div class="rev56-palette" id="${targetId}" style="display:none">${OUTLINE_PALETTE_REV56.map(c=>`<button type="button" class="color-choice ${c.toLowerCase()===cur.toLowerCase()?'active':''}" data-rev56-color="${c}" style="background:${c}" title="${c}"></button>`).join('')}<input type="color" class="rev56-inline-color" value="${escapeHtml(cur)}"></div>`;
  }
  function bindPalette56(paletteId,onPick){
    const pal=document.querySelector('#'+paletteId); if(!pal)return;
    pal.querySelectorAll('[data-rev56-color]').forEach(b=>b.onclick=()=>{onPick(b.dataset.rev56Color);});
    const inp=pal.querySelector('.rev56-inline-color'); if(inp)inp.oninput=()=>onPick(inp.value);
  }
  function saveSettings56(){
    const theme=document.querySelector('#mTheme56'); if(theme)state.theme=theme.value;
    const corners=document.querySelector('#mCornerStyle56'); if(corners)state.cornerStyle=corners.value;
    const outline=document.querySelector('#mOutlineStyle56'); if(outline)state.outlineStyle=outline.value;
    const interval=document.querySelector('#mSyncInterval56'); if(interval)state.syncInterval=Number(interval.value);
    const vac=document.querySelector('#mVacationEnabled56'); if(vac)state.vacationHighlight.enabled=vac.checked;
    const vacOpacity=document.querySelector('#mVacationOpacity56'); if(vacOpacity)state.vacationHighlight.opacity=Number(vacOpacity.value);
    const todayWidth=document.querySelector('#mTodayBorderWidth56'); if(todayWidth)state.todayHighlight.borderWidth=Number(todayWidth.value);
    const todayOpacity=document.querySelector('#mTodayOpacity56'); if(todayOpacity)state.todayHighlight.opacity=Number(todayOpacity.value);
    state.fetchMode='proxy';state.proxyUrl=state.proxyUrl||DEFAULT_PROXY_URL;
    persist();applyAppearance();setupAutoSync();
  }
  function renderSettingsGeneral56(){
    const root=document.querySelector('#settingsTabContentRev56'); if(!root)return; ensureRev56State();
    root.innerHTML=`<div class="settings-grid">
      <div class="field"><label>Erscheinung</label><select id="mTheme56"><option value="light">Hell</option><option value="dark">Dunkel</option></select></div>
      <div class="field"><label>Kanten</label><select id="mCornerStyle56"><option value="rounded">Abgerundet</option><option value="sharp">Eckig / 90°</option></select></div>
      <div class="field"><label><b>Konturfarbe</b></label><div class="rev56-color-row"><select id="mOutlineStyle56"><option value="current">Wie aktuell</option><option value="none">Keine</option><option value="gray">Grau</option><option value="black">Schwarz</option><option value="custom">Farbpalette</option></select>${colorButtonHtml56('mOutlineColorBtn56',outlineColor56(),'Konturfarbe wählen')}</div></div>
      ${paletteHtml56('mOutlinePalette56',state.outlineCustomColor||'#64748b')}
      <div class="hint">Die Konturfarbe gilt für größere Rahmen: Kalendergruppen, Tagesrahmen, Tagesplaner-Spalten, Projekt-Tasks, Projektbereiche, langfristige Gruppen, Monatszellen und Container. Einzelne Task-Karten bleiben als Inhaltskarten separat.</div>
      <label class="settings-check-rev53"><span><b>Urlaubstage anders anzeigen</b><small>Wenn ein sichtbarer ICS- oder eigener Kalender einen ganztägigen Termin mit exakt dem Titel „Urlaub“ enthält, wird der ganze Tag farblich als Lowlight hinterlegt.</small></span><input id="mVacationEnabled56" type="checkbox"></label>
      <div class="field"><label><b>Urlaubsfarbe</b></label><div class="rev56-color-row">${colorButtonHtml56('mVacationColorBtn56',state.vacationHighlight.color||'#f97316','Urlaubsfarbe wählen')}<span class="hint">Farbe des Urlaubs-Lowlights</span></div></div>
      ${paletteHtml56('mVacationPalette56',state.vacationHighlight.color||'#f97316')}
      <div class="field"><label>Urlaubs-Deckkraft</label><input id="mVacationOpacity56" type="range" min="0.05" max="0.55" step="0.01" value="${escapeHtml(state.vacationHighlight.opacity||0.18)}"></div>
      <div class="section-title">Aktueller Tag</div>
      <div class="field"><label>Linienstärke</label><input id="mTodayBorderWidth56" type="range" min="1" max="10" step="1" value="${escapeHtml(state.todayHighlight.borderWidth||4)}"></div>
      <div class="field"><label><b>Linienfarbe</b></label><div class="rev56-color-row">${colorButtonHtml56('mTodayBorderColorBtn56',state.todayHighlight.borderColor||'#0284c7','Linienfarbe aktueller Tag wählen')}<span class="hint">Kontur des aktuellen Tages</span></div></div>
      ${paletteHtml56('mTodayBorderPalette56',state.todayHighlight.borderColor||'#0284c7')}
      <div class="field"><label>Flächen-Deckkraft</label><input id="mTodayOpacity56" type="range" min="0" max="0.65" step="0.01" value="${escapeHtml(state.todayHighlight.opacity||0.18)}"></div>
    </div>`;
    document.querySelector('#mTheme56').value=state.theme||'light';
    document.querySelector('#mCornerStyle56').value=state.cornerStyle||'rounded';
    document.querySelector('#mOutlineStyle56').value=state.outlineStyle||'current';
    document.querySelector('#mVacationEnabled56').checked=!!state.vacationHighlight.enabled;
    ['#mTheme56','#mCornerStyle56','#mOutlineStyle56','#mVacationEnabled56','#mVacationOpacity56','#mTodayBorderWidth56','#mTodayOpacity56'].forEach(sel=>{const el=document.querySelector(sel);if(el)el.onchange=()=>{saveSettings56();render();};});
    const outlineBtn=document.querySelector('#mOutlineColorBtn56'); if(outlineBtn)outlineBtn.onclick=()=>{const p=document.querySelector('#mOutlinePalette56');if(p)p.style.display=p.style.display==='none'?'grid':'none';};
    const vacBtn=document.querySelector('#mVacationColorBtn56'); if(vacBtn)vacBtn.onclick=()=>{const p=document.querySelector('#mVacationPalette56');if(p)p.style.display=p.style.display==='none'?'grid':'none';};
    const todayBtn=document.querySelector('#mTodayBorderColorBtn56'); if(todayBtn)todayBtn.onclick=()=>{const p=document.querySelector('#mTodayBorderPalette56');if(p)p.style.display=p.style.display==='none'?'grid':'none';};
    bindPalette56('mOutlinePalette56',c=>{state.outlineStyle='custom';state.outlineCustomColor=c;saveSettings56();renderSettingsGeneral56();render();});
    bindPalette56('mVacationPalette56',c=>{state.vacationHighlight.color=c;saveSettings56();renderSettingsGeneral56();render();});
    bindPalette56('mTodayBorderPalette56',c=>{state.todayHighlight.borderColor=c;saveSettings56();renderSettingsGeneral56();render();});
  }
  function renderSettingsSync56(){
    const root=document.querySelector('#settingsTabContentRev56'); if(!root)return;
    root.innerHTML=`<div class="settings-grid"><div class="field"><label>Intervall</label><select id="mSyncInterval56"><option value="0">Aus / manuell</option><option value="5">Alle 5 Min.</option><option value="15">Alle 15 Min.</option><option value="30">Alle 30 Min.</option><option value="60">Alle 60 Min.</option></select></div><div class="hint">Manuelles Aktualisieren läuft weiterhin über den grünen Reload-Button oben rechts. Proxy-URL und separater ICS-Button werden hier nicht mehr angezeigt.</div></div>`;
    document.querySelector('#mSyncInterval56').value=String(state.syncInterval??15);
    document.querySelector('#mSyncInterval56').onchange=()=>saveSettings56();
  }
  function renderSettingsInfo56(){
    const root=document.querySelector('#settingsTabContentRev56'); if(!root)return;
    const checked=state.serverTimeCheckedAt?new NATIVE_DATE_REV56(state.serverTimeCheckedAt).toLocaleString('de-DE'):'noch nicht geprüft';
    root.innerHTML=`<div class="settings-grid"><div class="security-note"><b>Serverzeit</b><br>Die App versucht beim Laden, die Zeit über den Server-Header des Supabase-Projekts abzugleichen. Falls das wegen Browser-/CORS-Headern nicht möglich ist, bleibt die Geräteeinstellung als Fallback aktiv.<br><br>Letzte Prüfung: ${escapeHtml(checked)}</div><div class="security-note"><b>completed_tasks</b><br>Erledigte Tages-, Langfrist- und Projekt-Tasks werden in der gemeinsamen Tabelle <code>completed_tasks</code> historisiert. Wiederöffnen ist nur möglich, wenn die ursprüngliche Gruppe beziehungsweise das ursprüngliche Projekt noch existiert.</div></div>`;
  }
  function openSettingsRev56(){
    ensureRev56State();
    document.querySelector('#modalTitle').textContent='Allgemeine Einstellungen';
    document.querySelector('#modalContent').innerHTML=`<div class="settings-layout-rev53 settings-layout-rev56"><div class="settings-tabs-rev53 settings-tabs-rev56"><button class="settings-tab-rev53 settings-tab-rev56 active" data-tab56="general" type="button">Allgemein</button><button class="settings-tab-rev53 settings-tab-rev56" data-tab56="sync" type="button">Synchronisierung</button><button class="settings-tab-rev53 settings-tab-rev56" data-tab56="info" type="button">Hinweise</button></div><div id="settingsTabContentRev56" class="settings-tab-content-rev53"></div></div>`;
    document.querySelector('#modalBackdrop').style.display='flex';
    document.querySelector('#saveModal').style.display='';
    let active='general';
    const renderActive=()=>{if(active==='general')renderSettingsGeneral56();if(active==='sync')renderSettingsSync56();if(active==='info')renderSettingsInfo56();};
    renderActive();
    document.querySelectorAll('[data-tab56]').forEach(btn=>btn.onclick=()=>{saveSettings56();active=btn.dataset.tab56;document.querySelectorAll('[data-tab56]').forEach(b=>b.classList.toggle('active',b===btn));renderActive();});
    document.querySelector('#saveModal').onclick=()=>{saveSettings56();closeModal();render();};
  }

  function bindOptions56(){
    const settings=document.querySelector('#settingsBtn'); if(settings)settings.onclick=openSettingsRev56;
    const legend=document.querySelector('#legendBtn'); if(legend)legend.remove();
    const cloud=document.querySelector('#cloudBtn'); if(cloud)cloud.textContent='Login';
    const opt=document.querySelector('[data-config-block="opt"] .config-content > div'); if(opt)opt.style.gridTemplateColumns='1fr 1fr';
  }

  // Ganztägige eigene Termine: Endzeit 23:59 desselben Tags darf die Anzeige nicht verhindern.
  const oldRecurrenceMatches56=recurrenceMatches;
  recurrenceMatches=function(e,date){
    if(e&&e.allDay&&!e.rrule&&((e.recurrence||'none')==='none')){
      const sd=new Date(e.start),td=new Date(date); if(isNaN(sd)||isNaN(td))return false;
      sd.setHours(0,0,0,0);td.setHours(0,0,0,0);
      if(e.end){const ed=new Date(e.end); if(!isNaN(ed)){ed.setHours(0,0,0,0); if(ed<=sd)return sameDay(td,sd); return td>=sd&&td<=ed;}}
      return sameDay(td,sd);
    }
    return oldRecurrenceMatches56(e,date);
  };

  function completedTypeLabel56(c){return c.type==='long'?'Langfristig':(c.type==='project'?'Projekt-Task':'Tagestask');}
  function projectByCompleted56(c){return (state.projects||[]).find(p=>String(p.id)===String(c.originalGroupId));}
  function originalGroupExists56(c){
    if(c.type==='long')return !!(state.longColumns||[]).find(g=>String(g.id)===String(c.originalGroupId));
    if(c.type==='project')return !!projectByCompleted56(c);
    return !!(state.taskColumns||[]).find(g=>String(g.id)===String(c.originalGroupId));
  }
  function completedCard56(c){
    const color=c.originalGroupColor||state.colors?.task||defaultColors.task;
    const missing=!originalGroupExists56(c);
    const originalDate=c.originalDate?` · Ursprünglich: ${escapeHtml(c.originalDate)}`:'';
    return `<div class="card task task-card-compact completed-task-card completed-table-card-rev54" data-completed-ref="${escapeHtml(c.completedId)}" style="border-left-color:${escapeHtml(color)}!important"><div class="task-row"><input type="checkbox" checked data-toggle-completed-rev54="${escapeHtml(c.completedId)}" title="Wieder öffnen"><div><span class="completed-title" title="${escapeHtml(c.title)}">${escapeHtml(shortText(c.title,34))}</span><span class="completed-meta">${escapeHtml(completedTypeLabel56(c))} · Erledigt am ${escapeHtml(c.completedDate||'')} · Gruppe damals: ${escapeHtml(c.originalGroupName||'—')}${originalDate}${missing?' · Gruppe gelöscht':''}</span></div><button class="kebab completed-delete56" data-delete-completed56="${escapeHtml(c.completedId)}" title="Erledigten Eintrag löschen">×</button></div></div>`;
  }
  function completedHtmlForDay56(iso){
    const list=(state.completedTasksTable||[]).filter(c=>c.completedDate===iso);
    return list.length?`<div class="completed-grid completed-table-grid-rev54">${list.map(completedCard56).join('')}</div>`:'';
  }
  function groupSnapshotForComplete56(t,type){
    if(type==='long'){
      const g=(state.longColumns||[]).find(x=>String(x.id)===String(t.columnId));
      return {id:t.columnId||'',name:g?.name||'Unbekannte Gruppe',color:g?.color||state.colors?.long||defaultColors.long};
    }
    if(type==='project'){
      const p=(state.projects||[]).find(x=>String(x.id)===String(t.projectId));
      return {id:t.projectId||'',name:p?.name||'Unbekanntes Projekt',color:p?.color||'#7c5cff'};
    }
    const g=(state.taskColumns||[]).find(x=>String(x.id)===String(t.columnId));
    return {id:t.columnId||'',name:g?.name||'Unbekannte Gruppe',color:g?.color||state.colors?.task||defaultColors.task};
  }
  async function completeAnyTask56(t,type){
    if(!currentUser||!t)return;
    const g=groupSnapshotForComplete56(t,type);
    const row={user_id:currentUser.id,original_task_id:isUuid(t.id)?t.id:null,task_type:type,title:t.title||'Ohne Titel',note:t.note||null,original_date:type==='long'?null:(t.date||t.dueDate||fmtDate(new Date())),completed_date:fmtDate(new Date()),original_group_id:String(g.id||''),original_group_name:g.name,original_group_color:g.color||null};
    const {data,error}=await supabaseClient.from(COMPLETED_TABLE_REV56).insert(row).select('*').single();
    if(error){toast('Erledigter Task konnte nicht gespeichert werden: '+error.message);throw error;}
    const completed={completedId:data.id,originalTaskId:data.original_task_id,type:data.task_type,title:data.title,note:data.note||'',originalDate:data.original_date||null,completedDate:data.completed_date||fmtDate(new Date()),originalGroupId:data.original_group_id||'',originalGroupName:data.original_group_name||'Unbekannte Gruppe',originalGroupColor:data.original_group_color||null,createdAt:data.created_at||null};
    state.completedTasksTable=state.completedTasksTable||[];state.completedTasksTable.unshift(completed);
    if(type==='long'){state.longterm=(state.longterm||[]).filter(x=>x.id!==t.id);await dbDeleteRowRev041('long_tasks',t.id);} 
    else if(type==='project'){state.projectTasks=(state.projectTasks||[]).filter(x=>x.id!==t.id);await deleteProjectTaskRev047(t.id);} 
    else {state.tasks=(state.tasks||[]).filter(x=>x.id!==t.id);await dbDeleteRowRev041('tasks',t.id);} 
    render();
  }
  async function deleteCompleted56(id){
    if(!requireLogin())return;
    if(!confirm('Erledigten Eintrag endgültig löschen?'))return;
    const {error}=await supabaseClient.from(COMPLETED_TABLE_REV56).delete().eq('user_id',currentUser.id).eq('id',id);
    if(error){toast('Löschen fehlgeschlagen: '+error.message);return;}
    state.completedTasksTable=(state.completedTasksTable||[]).filter(x=>x.completedId!==id);
    render();toast('Erledigter Eintrag gelöscht.');
  }
  async function reopenCompleted56(id,checkbox){
    const c=(state.completedTasksTable||[]).find(x=>x.completedId===id); if(!c)return;
    try{
      if(!originalGroupExists56(c)){if(checkbox)checkbox.checked=true;toast('Diese Gruppe existiert nicht mehr. Der Task kann nicht wieder geöffnet werden. Details bleiben weiterhin einsehbar.');return;}
      const restoredId=isUuid(c.originalTaskId)?c.originalTaskId:crypto.randomUUID();
      if(c.type==='project'){
        const p=projectByCompleted56(c); if(!p)throw new Error('Projekt existiert nicht mehr.');
        const row={id:restoredId,user_id:currentUser.id,project_id:p.id,title:c.title||'Ohne Titel',note:c.note||null,due_date:c.originalDate||null,done:false,completed_date:null,sort_order:(state.projectTasks||[]).length};
        const {data,error}=await supabaseClient.from('project_tasks').upsert(row,{onConflict:'id'}).select('*').single(); if(error)throw error;
        state.projectTasks.push({id:data.id,projectId:data.project_id,title:data.title,note:data.note||'',dueDate:data.due_date||'',done:false,completedDate:null,sortOrder:data.sort_order||0,createdAt:data.created_at,updatedAt:data.updated_at});
      }else if(c.type==='long'){
        await window.reopenCompletedTaskRev55(id,checkbox);return;
      }else{
        await window.reopenCompletedTaskRev55(id,checkbox);return;
      }
      const {error:delError}=await supabaseClient.from(COMPLETED_TABLE_REV56).delete().eq('user_id',currentUser.id).eq('id',id); if(delError)throw delError;
      state.completedTasksTable=(state.completedTasksTable||[]).filter(x=>x.completedId!==id);
      render();toast('Task wieder geöffnet.');
    }catch(error){if(checkbox)checkbox.checked=true;toast('Wieder öffnen fehlgeschlagen: '+(error.message||error));}
  }
  function openCompletedDetail56(id){
    const c=(state.completedTasksTable||[]).find(x=>x.completedId===id);
    if(!c)return;
    const exists=originalGroupExists56(c);
    $('#modalTitle').textContent='Erledigter Task · Details';
    $('#modalContent').innerHTML=`<div class="event-detail-grid"><b>Titel</b><div>${escapeHtml(c.title||'—')}</div><b>Typ</b><div>${escapeHtml(completedTypeLabel56(c))}</div><b>Erledigt am</b><div>${escapeHtml(c.completedDate||'—')}</div><b>Ursprüngliches Datum</b><div>${escapeHtml(c.originalDate||'—')}</div><b>Damals in Gruppe/Projekt</b><div>${escapeHtml(c.originalGroupName||'—')}</div><b>Status</b><div>${exists?'Originalgruppe existiert noch. Wiederöffnen ist möglich.':'Originalgruppe existiert nicht mehr. Wiederöffnen ist gesperrt, Löschen ist weiterhin möglich.'}</div><b>Notiz</b><div>${c.note?`<div class="detail-long expanded">${escapeHtml(c.note)}</div>`:'—'}</div></div>`;
    $('#modalBackdrop').style.display='flex';
    $('#saveModal').style.display='none';
  }

  function bindCompletedAndProject56(scope=document){
    scope.querySelectorAll('[data-toggle-completed-rev54]').forEach(c=>{c.onclick=ev=>ev.stopPropagation();c.onchange=async ev=>{ev.stopPropagation();if(!c.checked)await reopenCompleted56(c.dataset.toggleCompletedRev54,c);};});
    scope.querySelectorAll('[data-delete-completed56]').forEach(b=>b.onclick=ev=>{ev.stopPropagation();deleteCompleted56(b.dataset.deleteCompleted56);});
    scope.querySelectorAll('[data-completed-ref]').forEach(card=>card.onclick=ev=>{if(ev.target.closest('input,button'))return;openCompletedDetail56(card.dataset.completedRef);});
    scope.querySelectorAll('[data-toggle-project-task]').forEach(c=>{c.onclick=ev=>ev.stopPropagation();c.onchange=async ev=>{ev.stopPropagation();if(!requireLogin()){c.checked=!c.checked;return;}const t=(state.projectTasks||[]).find(x=>x.id===c.dataset.toggleProjectTask);if(t&&c.checked){try{await completeAnyTask56(t,'project');}catch(e){c.checked=false;}return;} if(t){try{await updateProjectTaskRev047(t.id,{done:false,completedDate:null});t.done=false;t.completedDate=null;render();}catch(error){toast(error.message||String(error));}}};});
  }

  const oldDayCard56=dayCard;
  dayCard=function(date){
    const node=oldDayCard56(date);
    const iso=fmtDate(date);
    // alte App-State-/aktive erledigte Projektcards entfernen; completed_tasks ist führend.
    node.querySelectorAll('.project-task-item.done').forEach(el=>el.remove());
    node.querySelectorAll('.completed-table-grid-rev54').forEach(el=>el.remove());
    const html=completedHtmlForDay56(iso);
    if(html){
      const body=node.querySelector('.day-body');
      const partTitles=Array.from(node.querySelectorAll('.part-title'));
      let target=partTitles.find(x=>x.textContent.includes('An diesem Tag erledigte Tasks'))?.closest('.partition');
      if(!target&&body){
        const today=new Date();today.setHours(0,0,0,0);
        body.insertAdjacentHTML('beforeend',`<div class="partition"><div class="part-head"><div class="part-title">${sameDay(date,today)?'5':'4'}. An diesem Tag erledigte Tasks</div></div></div>`);
        target=body.lastElementChild;
      }
      if(target)target.insertAdjacentHTML('beforeend',html);
    }
    node.querySelectorAll('[data-toggle-task]').forEach(c=>{c.onclick=ev=>ev.stopPropagation();c.onchange=async ev=>{ev.stopPropagation();if(!requireLogin()){c.checked=!c.checked;return;}const t=(state.tasks||[]).find(x=>x.id===c.dataset.toggleTask);if(t&&c.checked){try{await completeAnyTask56(t,'daily');}catch(e){c.checked=false;}}};});
    node.querySelectorAll('[data-toggle-long]').forEach(c=>{c.onclick=ev=>ev.stopPropagation();c.onchange=async ev=>{ev.stopPropagation();if(!requireLogin()){c.checked=!c.checked;return;}const t=(state.longterm||[]).find(x=>x.id===c.dataset.toggleLong);if(t&&c.checked){try{await completeAnyTask56(t,'long');}catch(e){c.checked=false;}}};});
    bindCompletedAndProject56(node);
    return node;
  };
  const oldRenderLong56=renderLong;
  renderLong=function(){oldRenderLong56();document.querySelectorAll('#longTermList [data-toggle-long]').forEach(c=>{c.onclick=ev=>ev.stopPropagation();c.onchange=async ev=>{ev.stopPropagation();if(!requireLogin()){c.checked=!c.checked;return;}const t=(state.longterm||[]).find(x=>x.id===c.dataset.toggleLong);if(t&&c.checked){try{await completeAnyTask56(t,'long');}catch(e){c.checked=false;}}};});};
  const oldRenderProjects56=typeof renderProjectsRev047==='function'?renderProjectsRev047:null;
  if(oldRenderProjects56){renderProjectsRev047=function(){oldRenderProjects56();bindCompletedAndProject56(document.querySelector('#projectsSectionRev047')||document);};}

  // Zeitstrahlwerte sofort überschreiben.
  const oldRenderSidebarTimeline56=renderSidebarTimelineRev050;
  renderSidebarTimelineRev050=function(){
    oldRenderSidebarTimeline56();
    const input=document.querySelector('#timelineWorkStartRev50');
    if(input){const save=()=>{state.workStartTime=input.value||'08:00';persist();};input.oninput=save;input.onchange=()=>{save();renderSidebarTimelineRev050();};}
  };
  const oldOpenTimelineSettings56=typeof openTimelineSettingsRev52==='function'?openTimelineSettingsRev52:null;
  if(oldOpenTimelineSettings56){openTimelineSettingsRev52=function(){oldOpenTimelineSettings56();setTimeout(()=>{const step=document.querySelector('#timelineStepModalRev52');const pause=document.querySelector('#timelinePauseModalRev52');if(step)step.onchange=()=>{state.timelineStep=Number(step.value||30);persist();};if(pause)pause.oninput=()=>{state.timelinePauseMinutes=Math.max(0,Number(pause.value||0));persist();};},0);};}

  // Eigener Termin: Löschbutton links in Modal-Aktionsleiste als quadratischer Mülleimer.
  function moveOwnDeleteButton56(){
    const del=document.querySelector('#deleteOwnFromEditRev51'); const actions=document.querySelector('.modal-actions');
    if(del&&actions&&!del.classList.contains('own-delete-square56')){
      del.className='btn danger own-delete-square56';del.innerHTML=iconTrash();del.title='Eigenen Termin löschen';
      actions.insertBefore(del,actions.firstChild);
    }
  }
  new MutationObserver(moveOwnDeleteButton56).observe(document.body,{childList:true,subtree:true});

  // Klick-Cursor und Unterstreichung für alle Task-/Projektkarten.
  function decorateClickableTasks56(){
    document.querySelectorAll('[data-task-ref],[data-project-task-ref],[data-completed-ref]').forEach(el=>el.classList.add('task-clickable56'));
  }
  const oldRender56=render;
  render=function(){oldRender56();bindOptions56();decorateClickableTasks56();renderSidebarTimelineRev050();};

  window.openSyncSettingsModal=openSettingsRev56;
  window.openSettingsRev56=openSettingsRev56;

  setTimeout(()=>{ensureRev56State();bindOptions56();applyAppearance();decorateClickableTasks56();syncServerTimeRev56().then(()=>{applyAppearance();render();});},300);
})();



/* Rev 057: Persistenz-/UI-Korrekturen nach Test */
(function(){
  function safeColor57(v,fallback){return /^#[0-9a-f]{6}$/i.test(String(v||''))?String(v):fallback;}
  function ensureRev57State(){
    if(typeof ensureRev56State==='function') ensureRev56State();
    state.timelineStep=Number(state.timelineStep||30);
    if(![15,30,60].includes(state.timelineStep)) state.timelineStep=30;
    state.timelinePauseMinutes=Math.max(0,Number(state.timelinePauseMinutes||0));
    state.workStartTime=state.workStartTime||'08:00';
    state.vacationHighlight=Object.assign({enabled:false,color:'#f97316',opacity:0.18},state.vacationHighlight||{});
    state.todayHighlight=Object.assign({borderWidth:4,borderColor:'#0284c7',opacity:0.18},state.todayHighlight||{});
    state.outlineStyle=state.outlineStyle||'current';
    state.outlineCustomColor=state.outlineCustomColor||'#64748b';
  }
  function saveUiState57(){
    ensureRev57State();
    persist();
    if(typeof saveStateToCloud==='function' && currentUser){
      clearTimeout(window.__rev57CloudSaveTimer);
      window.__rev57CloudSaveTimer=setTimeout(()=>saveStateToCloud(),250);
    }
  }


  function palette57(id,current,onPick){
    const colors=['#64748b','#000000','#ffffff','#0284c7','#7c5cff','#22c55e','#ffb020','#f97316','#ff5050','#ec4899','#14b8a6','#a855f7'];
    return `<div class="rev57-color-palette" id="${id}">${colors.map(c=>`<button type="button" class="color-choice" data-color57="${c}" style="background:${c}" title="${c}"></button>`).join('')}<input type="color" value="${escapeHtml(safeColor57(current,'#64748b'))}" data-color57-input="1"></div>`;
  }
  function bindPalette57(id,onPick){
    const pal=document.querySelector('#'+id); if(!pal)return;
    pal.querySelectorAll('[data-color57]').forEach(b=>b.onclick=()=>onPick(b.dataset.color57));
    const input=pal.querySelector('[data-color57-input]'); if(input)input.oninput=()=>onPick(input.value);
  }
  function colorBtn57(id,color,label){
    return `<button type="button" class="btn small rev57-color-button" id="${id}" title="${escapeHtml(label)}"><span class="rev57-color-dot" style="background:${escapeHtml(color)}"></span>${iconColorBucket()}</button>`;
  }
  function saveSettingsFromDom57(){
    ensureRev57State();
    const q=s=>document.querySelector(s);
    if(q('#mTheme57')) state.theme=q('#mTheme57').value;
    if(q('#mCornerStyle57')) state.cornerStyle=q('#mCornerStyle57').value;
    if(q('#mOutlineStyle57')) state.outlineStyle=q('#mOutlineStyle57').value;
    if(q('#mVacationEnabled57')) state.vacationHighlight.enabled=q('#mVacationEnabled57').checked;
    if(q('#mVacationOpacity57')) state.vacationHighlight.opacity=Number(q('#mVacationOpacity57').value);
    if(q('#mTodayBorderWidth57')) state.todayHighlight.borderWidth=Number(q('#mTodayBorderWidth57').value);
    if(q('#mTodayOpacity57')) state.todayHighlight.opacity=Number(q('#mTodayOpacity57').value);
    if(q('#mSyncInterval57')){ state.syncInterval=Number(q('#mSyncInterval57').value); if(typeof setupAutoSync==='function') setupAutoSync(); }
    saveUiState57();
    if(typeof applyAppearance==='function') applyAppearance();
  }
  function renderSettingsGeneral57(){
    ensureRev57State();
    const root=document.querySelector('#settingsTabContentRev56'); if(!root)return;
    root.innerHTML=`<div class="settings-grid">
      <div class="rev57-outline-card">
        <div class="rev57-card-title">Darstellung</div>
        <div class="rev57-row"><label>Erscheinung</label><select id="mTheme57"><option value="light">Hell</option><option value="dark">Dunkel</option></select></div>
        <div class="rev57-row"><label>Kanten</label><select id="mCornerStyle57"><option value="rounded">Abgerundet</option><option value="sharp">Eckig / 90°</option></select></div>
        <div class="rev57-row"><label>Konturfarbe</label><div style="display:flex;gap:8px;align-items:center"><select id="mOutlineStyle57"><option value="current">Wie aktuell</option><option value="none">Keine</option><option value="gray">Grau</option><option value="black">Schwarz</option><option value="custom">Farbpalette</option></select>${colorBtn57('mOutlineColorBtn57',state.outlineStyle==='custom'?state.outlineCustomColor:(typeof outlineColor56==='function'?outlineColor56():'#64748b'),'Konturfarbe wählen')}</div></div>
        ${palette57('mOutlinePalette57',state.outlineCustomColor,()=>{})}
        <div class="hint">Die Konturfarbe gilt für große Rahmen und gestrichelte Gruppenlinien. Einzelne Task-Karten behalten ihre normale Kartenoptik.</div>
      </div>
      <div class="rev57-vacation-card">
        <label class="settings-check-rev53"><span class="rev57-card-title">Urlaubstage anders anzeigen<small>Wenn ein sichtbarer ICS- oder eigener Kalender einen ganztägigen Termin mit exakt dem Titel „Urlaub“ enthält, wird der gesamte Tag farblich hinterlegt.</small></span><input id="mVacationEnabled57" type="checkbox"></label>
        <div class="rev57-row"><label>Urlaubsfarbe</label><div>${colorBtn57('mVacationColorBtn57',state.vacationHighlight.color,'Urlaubsfarbe wählen')}</div></div>
        ${palette57('mVacationPalette57',state.vacationHighlight.color,()=>{})}
        <div class="rev57-row"><label>Deckkraft</label><input id="mVacationOpacity57" type="range" min="0.05" max="0.55" step="0.01" value="${escapeHtml(state.vacationHighlight.opacity)}"></div>
      </div>
      <div class="rev57-today-card">
        <div class="rev57-card-title">Aktueller Tag<small>Hier stellst du ein, wie stark der heutige Tag optisch hervorgehoben wird.</small></div>
        <div class="rev57-row"><label>Linienstärke</label><input id="mTodayBorderWidth57" type="range" min="1" max="10" step="1" value="${escapeHtml(state.todayHighlight.borderWidth)}"></div>
        <div class="rev57-row"><label>Linienfarbe</label><div>${colorBtn57('mTodayBorderColorBtn57',state.todayHighlight.borderColor,'Linienfarbe aktueller Tag wählen')}</div></div>
        ${palette57('mTodayBorderPalette57',state.todayHighlight.borderColor,()=>{})}
        <div class="rev57-row"><label>Flächen-Deckkraft</label><input id="mTodayOpacity57" type="range" min="0" max="0.65" step="0.01" value="${escapeHtml(state.todayHighlight.opacity)}"></div>
      </div>
    </div>`;
    document.querySelector('#mTheme57').value=state.theme||'light';
    document.querySelector('#mCornerStyle57').value=state.cornerStyle||'rounded';
    document.querySelector('#mOutlineStyle57').value=state.outlineStyle||'current';
    document.querySelector('#mVacationEnabled57').checked=!!state.vacationHighlight.enabled;
    ['#mTheme57','#mCornerStyle57','#mOutlineStyle57','#mVacationEnabled57','#mVacationOpacity57','#mTodayBorderWidth57','#mTodayOpacity57'].forEach(s=>{const el=document.querySelector(s);if(el){el.oninput=saveSettingsFromDom57;el.onchange=saveSettingsFromDom57;}});
    const toggle=(btnId,palId)=>{const b=document.querySelector('#'+btnId);const p=document.querySelector('#'+palId);if(b&&p)b.onclick=()=>p.classList.toggle('open');};
    toggle('mOutlineColorBtn57','mOutlinePalette57'); toggle('mVacationColorBtn57','mVacationPalette57'); toggle('mTodayBorderColorBtn57','mTodayBorderPalette57');
    bindPalette57('mOutlinePalette57',c=>{state.outlineStyle='custom';state.outlineCustomColor=c;saveUiState57();renderSettingsGeneral57();render();});
    bindPalette57('mVacationPalette57',c=>{state.vacationHighlight.color=c;saveUiState57();renderSettingsGeneral57();render();});
    bindPalette57('mTodayBorderPalette57',c=>{state.todayHighlight.borderColor=c;saveUiState57();renderSettingsGeneral57();render();});
  }
  function renderSettingsSync57(){
    const root=document.querySelector('#settingsTabContentRev56'); if(!root)return;
    root.innerHTML=`<div class="settings-grid"><div class="rev57-outline-card"><div class="rev57-card-title">Synchronisierung</div><div class="rev57-row"><label>Intervall</label><select id="mSyncInterval57"><option value="0">Aus / manuell</option><option value="5">Alle 5 Min.</option><option value="15">Alle 15 Min.</option><option value="30">Alle 30 Min.</option><option value="60">Alle 60 Min.</option></select></div><div class="hint">Manuelles Neuladen erfolgt über den grünen Reload-Button oben. Proxy-URL und separater ICS-Button bleiben ausgeblendet.</div></div></div>`;
    document.querySelector('#mSyncInterval57').value=String(state.syncInterval??15);
    document.querySelector('#mSyncInterval57').onchange=saveSettingsFromDom57;
  }
  function openSettingsRev57(){
    ensureRev57State();
    document.querySelector('#modalTitle').textContent='Allgemeine Einstellungen';
    document.querySelector('#modalContent').innerHTML=`<div class="settings-layout-rev53 settings-layout-rev56"><div class="settings-tabs-rev53 settings-tabs-rev56"><button class="settings-tab-rev53 settings-tab-rev56 active" data-tab57="general" type="button">Allgemein</button><button class="settings-tab-rev53 settings-tab-rev56" data-tab57="sync" type="button">Synchronisierung</button><button class="settings-tab-rev53 settings-tab-rev56" data-tab57="info" type="button">Hinweise</button></div><div id="settingsTabContentRev56" class="settings-tab-content-rev53"></div></div>`;
    document.querySelector('#modalBackdrop').style.display='flex';
    document.querySelector('#saveModal').style.display='';
    let active='general';
    const renderActive=()=>{if(active==='general')renderSettingsGeneral57();else if(active==='sync')renderSettingsSync57();else if(typeof renderSettingsInfo56==='function')renderSettingsInfo56();};
    renderActive();
    document.querySelectorAll('[data-tab57]').forEach(btn=>btn.onclick=()=>{saveSettingsFromDom57();active=btn.dataset.tab57;document.querySelectorAll('[data-tab57]').forEach(b=>b.classList.toggle('active',b===btn));renderActive();});
    document.querySelector('#saveModal').onclick=()=>{saveSettingsFromDom57();closeModal();render();};
    cleanupTrashButtons57();
  }

  function cleanupTrashButtons57(){
    const isOwn=/Eigenen Termin bearbeiten|Termin hinzufügen/.test(document.querySelector('#modalTitle')?.textContent||'') && !!document.querySelector('#deleteOwnFromEditRev51');
    const actions=document.querySelector('.modal-actions');
    const ownButtons=Array.from(document.querySelectorAll('.own-delete-square56,.rev57-trash-left,#deleteOwnFromEditRev51'));
    if(!isOwn){ownButtons.forEach(b=>{ if(b.closest('.modal-actions')) b.remove(); }); return; }
    const del=document.querySelector('#deleteOwnFromEditRev51');
    if(del&&actions){
      Array.from(actions.querySelectorAll('.own-delete-square56,.rev57-trash-left')).forEach((b,i)=>{if(b!==del)b.remove();});
      del.className='btn danger rev57-trash-left'; del.innerHTML=iconTrash(); del.title='Eigenen Termin löschen';
      if(actions.firstElementChild!==del) actions.insertBefore(del,actions.firstChild);
    }
  }
  new MutationObserver(cleanupTrashButtons57).observe(document.body,{childList:true,subtree:true});

  function bindTimelinePersistence57(){
    ensureRev57State();
    const input=document.querySelector('#timelineWorkStartRev50,#timelineWorkStartRev49');
    if(input){
      input.value=state.workStartTime||input.value||'08:00';
      const save=()=>{state.workStartTime=input.value||'08:00';saveUiState57();};
      input.oninput=save;
      input.onchange=()=>{save(); if(typeof renderSidebarTimelineRev050==='function')renderSidebarTimelineRev050();};
    }
    const step=document.querySelector('#timelineStepModalRev52,#timelineStepModalRev50');
    const pause=document.querySelector('#timelinePauseModalRev52,#timelinePauseModalRev50');
    if(step){step.value=String(state.timelineStep||30); step.oninput=step.onchange=()=>{state.timelineStep=Number(step.value||30);saveUiState57();};}
    if(pause){pause.value=String(state.timelinePauseMinutes||0); pause.oninput=pause.onchange=()=>{state.timelinePauseMinutes=Math.max(0,Number(pause.value||0));saveUiState57();};}
  }
  const oldRenderSidebarTimeline57=typeof renderSidebarTimelineRev050==='function'?renderSidebarTimelineRev050:null;
  if(oldRenderSidebarTimeline57){
    renderSidebarTimelineRev050=function(){oldRenderSidebarTimeline57();bindTimelinePersistence57();};
  }
  const oldOpenTimelineSettings57=typeof openTimelineSettingsRev52==='function'?openTimelineSettingsRev52:null;
  if(oldOpenTimelineSettings57){
    openTimelineSettingsRev52=function(){oldOpenTimelineSettings57();setTimeout(bindTimelinePersistence57,0);};
  }

  const oldEnsureSettings57=ensureSettings;
  ensureSettings=function(){oldEnsureSettings57();ensureRev57State();};
  const oldRender57=render;
  render=function(){oldRender57();const s=document.querySelector('#settingsBtn');if(s)s.onclick=openSettingsRev57;cleanupTrashButtons57();bindTimelinePersistence57();};
  window.openSettingsRev56=openSettingsRev57;
  window.openSyncSettingsModal=openSettingsRev57;

  setTimeout(()=>{ensureRev57State();const s=document.querySelector('#settingsBtn');if(s)s.onclick=openSettingsRev57;cleanupTrashButtons57();bindTimelinePersistence57();saveUiState57();},250);
})();

/* Rev 058: Stabiler Editor für eigene Termine ohne Rev057-MutationObserver-Schleife */
(function(){
  function rev58IsUuid(v){return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(v||''));}
  function rev58DateInput(v){const d=new Date(v); if(isNaN(d))return fmtDate(new Date()); return fmtDate(d);}
  function rev58TimeInput(v,fallback='09:00'){const d=new Date(v); if(isNaN(d))return fallback; return String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');}
  function rev58ParseLocal(date,time,allDay,end){
    if(allDay)return new Date(date+(end?'T23:59:00':'T00:00:00'));
    return new Date(date+'T'+(time||'00:00')+':00');
  }
  async function rev58UpdateOwnEvent(evt){
    if(!currentUser || !rev58IsUuid(evt.id)){ persist(); return; }
    const row={
      calendar_source_id:evt.sourceId,
      title:evt.summary||'Ohne Titel',
      location:evt.location||null,
      description:evt.description||null,
      start_time:evt.start,
      end_time:evt.end||null,
      all_day:!!evt.allDay,
      recurrence:evt.recurrence||'none',
      travel_time:evt.travelTime||null,
      status:evt.status||'active',
      updated_at:new Date().toISOString()
    };
    const {error}=await supabaseClient.from('own_events').update(row).eq('user_id',currentUser.id).eq('id',evt.id);
    if(error)throw error;
  }
  function rev58OpenOwnEventEditor(calIdx,evtIdx){
    if(!requireLogin())return;
    const cal=state.calendars[Number(calIdx)];
    const evt=(cal?.ownEvents||[])[Number(evtIdx)];
    if(!cal||!evt)return toast('Eigener Termin lokal nicht gefunden.');
    const ownSources=(cal.links||[]).filter(l=>l.type==='own');
    const dateVal=rev58DateInput(evt.start);
    const startVal=rev58TimeInput(evt.start,'09:00');
    const endVal=rev58TimeInput(evt.end,'10:00');
    const modalTitle=document.querySelector('#modalTitle');
    const modalContent=document.querySelector('#modalContent');
    const modalBackdrop=document.querySelector('#modalBackdrop');
    const actions=document.querySelector('.modal-actions');
    const save=document.querySelector('#saveModal');
    const cancel=document.querySelector('#cancelModal');
    if(!modalTitle||!modalContent||!modalBackdrop||!actions||!save)return;
    modalTitle.textContent='Eigenen Termin bearbeiten';
    modalContent.innerHTML=`<div class="own-event-edit-grid rev58-own-editor">
      <label>Titel</label><input id="rev58OwnTitle" value="${escapeHtml(evt.summary||'')}">
      <label>Eigener Kalender</label><select id="rev58OwnSource">${ownSources.map(l=>`<option value="${escapeHtml(l.id)}" ${evt.sourceId===l.id?'selected':''}>${escapeHtml(l.name)}</option>`).join('')}</select>
      <label>Ort</label><input id="rev58OwnLocation" value="${escapeHtml(evt.location||'')}">
      <label>Datum</label><input id="rev58OwnDate" type="date" value="${escapeHtml(dateVal)}">
      <label>Wiederholung</label><select id="rev58OwnRecurrence"><option value="none">Keine Wiederholung</option><option value="weekly">Wöchentlich</option><option value="monthly">Monatlich</option><option value="yearly">Jährlich</option></select>
      <label>Ganztägig</label><select id="rev58OwnAllDay"><option value="false">Nein</option><option value="true">Ja</option></select>
      <label>Startzeit</label><input id="rev58OwnStart" type="time" value="${escapeHtml(startVal)}">
      <label>Endzeit</label><input id="rev58OwnEnd" type="time" value="${escapeHtml(endVal)}">
      <label>Wegzeit</label><input id="rev58OwnTravel" value="${escapeHtml(evt.travelTime||'')}" placeholder="z. B. 20 Min.">
      <label>Details / Notizen</label><textarea id="rev58OwnDescription" rows="5">${escapeHtml(evt.description||'')}</textarea>
    </div>`;
    document.querySelector('#rev58OwnRecurrence').value=evt.recurrence||'none';
    document.querySelector('#rev58OwnAllDay').value=evt.allDay?'true':'false';
    actions.querySelectorAll('#rev58DeleteOwnEvent,.own-delete-square56,.rev57-trash-left,#deleteOwnFromEditRev51').forEach(x=>x.remove());
    const del=document.createElement('button');
    del.id='rev58DeleteOwnEvent';
    del.type='button';
    del.className='btn danger rev58-own-trash';
    del.title='Eigenen Termin löschen';
    del.innerHTML=(typeof iconTrash==='function')?iconTrash():'${iconTrash()}';
    actions.insertBefore(del, actions.firstChild);
    modalBackdrop.style.display='flex';
    save.style.display='';
    del.onclick=async()=>{
      if(!confirm('Eigenen Termin / Serie löschen?'))return;
      try{
        if(typeof deleteOwnEventRev046==='function' && rev58IsUuid(evt.id)) await deleteOwnEventRev046(evt.id);
        cal.ownEvents.splice(Number(evtIdx),1);
        closeModal(); render(); toast('Eigener Termin gelöscht.');
      }catch(error){toast(error.message||String(error));closeModal();await loadStateFromCloud();}
    };
    save.onclick=async()=>{
      const title=document.querySelector('#rev58OwnTitle').value.trim();
      if(!title)return toast('Termin ohne Titel wird nicht gespeichert.');
      const sourceId=document.querySelector('#rev58OwnSource').value;
      const src=ownSources.find(l=>l.id===sourceId)||ownSources[0];
      const date=document.querySelector('#rev58OwnDate').value||dateVal;
      const allDay=document.querySelector('#rev58OwnAllDay').value==='true';
      evt.sourceId=sourceId;
      evt.summary=title;
      evt.location=document.querySelector('#rev58OwnLocation').value.trim();
      evt.recurrence=document.querySelector('#rev58OwnRecurrence').value||'none';
      evt.allDay=allDay;
      evt.start=rev58ParseLocal(date,document.querySelector('#rev58OwnStart').value,allDay,false).toISOString();
      evt.end=rev58ParseLocal(date,document.querySelector('#rev58OwnEnd').value,allDay,true).toISOString();
      evt.travelTime=document.querySelector('#rev58OwnTravel').value.trim();
      evt.description=document.querySelector('#rev58OwnDescription').value.trim();
      evt.source=src?.name||cal.name;
      evt.icsName=src?.name||cal.name;
      evt.icsColor=src?.color||state.colors.event;
      evt.status=evt.status||'active';
      try{await rev58UpdateOwnEvent(evt); closeModal(); render(); toast('Eigener Termin aktualisiert.');}
      catch(error){toast('Eigener Termin konnte nicht aktualisiert werden: '+(error.message||String(error)));closeModal();await loadStateFromCloud();}
    };
    modalContent.onkeydown=e=>{if(e.key==='Enter'&&e.target.tagName!=='TEXTAREA'){e.preventDefault();save.click();}else if(e.key==='Enter'&&e.ctrlKey){e.preventDefault();save.click();}};
  }
  const prevOpenEventDetailRev58=window.openEventDetailModal || openEventDetailModal;
  window.openEventDetailModal=openEventDetailModal=function(ref){
    const [type,calIdx,evtIdx]=String(ref||'').split(':');
    if(type==='own')return rev58OpenOwnEventEditor(calIdx,evtIdx);
    return prevOpenEventDetailRev58(ref);
  };
  const style=document.createElement('style');
  style.textContent=`.rev58-own-trash{width:42px!important;min-width:42px!important;height:42px!important;padding:0!important;display:inline-flex!important;align-items:center!important;justify-content:center!important}.rev58-own-trash svg{width:21px;height:21px}`;
  document.head.appendChild(style);
})();

/* Rev 059: Projekt-Task-Seitenfarbe + Papierkorb nur im eigenen Termin-Editor */
(function(){
  function rev59ProjectColorForTask(id){
    try{
      const t=(state.projectTasks||[]).find(x=>String(x.id)===String(id));
      const p=t&&(state.projects||[]).find(x=>String(x.id)===String(t.projectId));
      return (p&&p.color)||'#7c5cff';
    }catch(e){return '#7c5cff';}
  }
  function rev59DecorateProjectTaskColors(scope=document){
    scope.querySelectorAll('.project-task-item[data-project-task-ref]').forEach(el=>{
      const color=rev59ProjectColorForTask(el.dataset.projectTaskRef);
      el.style.setProperty('border-left-color',color,'important');
      el.style.setProperty('border-left-width','4px','important');
      el.style.setProperty('border-left-style','solid','important');
      // normale Kartenoptik behalten: nur linke Farbleiste projektabhängig.
      if(document.body.classList.contains('light')){
        el.style.setProperty('background','#f8fbff','important');
        el.style.setProperty('border-top-color','#cbd6e7','important');
        el.style.setProperty('border-right-color','#cbd6e7','important');
        el.style.setProperty('border-bottom-color','#cbd6e7','important');
      }else{
        el.style.setProperty('background','#060b16','important');
        el.style.setProperty('border-top-color','#23324d','important');
        el.style.setProperty('border-right-color','#23324d','important');
        el.style.setProperty('border-bottom-color','#23324d','important');
      }
    });
  }
  function rev59CleanupForeignTrash(){
    const title=(document.querySelector('#modalTitle')?.textContent||'').trim();
    const isOwnTitle=/^Eigenen Termin bearbeiten/.test(title);
    const isSettings=/Einstellungen|Allgemeine Einstellungen|Synchronisierung|Hinweise/.test(title) || !!document.querySelector('.settings-layout-rev56,.settings-layout-rev53');
    const actions=document.querySelector('.modal-actions');
    if(!actions)return;
    if(isSettings || !isOwnTitle){
      actions.querySelectorAll('#rev58DeleteOwnEvent,.rev58-own-trash,.own-delete-square56,.rev57-trash-left,#deleteOwnFromEditRev51').forEach(b=>b.remove());
    }
  }

  const style=document.createElement('style');
  style.textContent=`
    /* Rev059: bestehendes Rev057-border-color überschreiben, aber Projekt-Farbleiste behalten */
    .project-task-item[data-project-task-ref]{cursor:pointer!important;}
    .project-task-item[data-project-task-ref]:hover b{text-decoration:underline!important;}
    .settings-layout-rev56 ~ .own-delete-square56,
    .settings-layout-rev53 ~ .own-delete-square56{display:none!important;}
  `;
  document.head.appendChild(style);

  const prevRender=window.render || render;
  window.render=render=function(){
    prevRender();
    rev59DecorateProjectTaskColors(document);
    rev59CleanupForeignTrash();
  };

  const prevOpenSettings=window.openSettingsRev56 || window.openSyncSettingsModal;
  function wrapSettingsOpen(fn){
    return function(){
      const r=fn&&fn.apply(this,arguments);
      setTimeout(rev59CleanupForeignTrash,0);
      setTimeout(rev59CleanupForeignTrash,60);
      return r;
    };
  }
  if(prevOpenSettings){
    window.openSettingsRev56=wrapSettingsOpen(prevOpenSettings);
    window.openSyncSettingsModal=window.openSettingsRev56;
  }
  setTimeout(()=>{
    const s=document.querySelector('#settingsBtn');
    if(s&&window.openSettingsRev56)s.onclick=window.openSettingsRev56;
    rev59DecorateProjectTaskColors(document);
    rev59CleanupForeignTrash();
  },250);
})();

/* Rev 060: Persistenz der allgemeinen Einstellungen explizit über Speichern + Zeitstrahlwerte zuverlässig im App-State */
(function(){
  function isHex60(v){return /^#[0-9a-f]{6}$/i.test(String(v||''));}
  function ensureRev60State(){
    state.vacationHighlight=Object.assign({enabled:false,color:'#f97316',opacity:0.18},state.vacationHighlight||{});
    state.todayHighlight=Object.assign({borderWidth:4,borderColor:'#0284c7',opacity:0.18},state.todayHighlight||{});
    state.outlineStyle=state.outlineStyle||'current';
    state.outlineCustomColor=isHex60(state.outlineCustomColor)?state.outlineCustomColor:'#64748b';
    state.timelineStep=Number(state.timelineStep||30);
    if(![15,30,60].includes(state.timelineStep))state.timelineStep=30;
    state.timelinePauseMinutes=Math.max(0,Number(state.timelinePauseMinutes||0));
    state.workStartTime=state.workStartTime||'08:00';
  }
  async function forceSaveAppState60(){
    ensureRev60State();
    try{persist();}catch(e){console.warn(e);}
    if(currentUser && typeof saveStateToCloud==='function'){
      clearTimeout(cloudSaveTimer);
      await saveStateToCloud();
    }
  }
  function readSettingsDom60(){
    ensureRev60State();
    const q=s=>document.querySelector(s);
    const theme=q('#mTheme60,#mTheme57,#mTheme56'); if(theme)state.theme=theme.value;
    const corners=q('#mCornerStyle60,#mCornerStyle57,#mCornerStyle56'); if(corners)state.cornerStyle=corners.value;
    const outline=q('#mOutlineStyle60,#mOutlineStyle57,#mOutlineStyle56'); if(outline)state.outlineStyle=outline.value;
    const vacEnabled=q('#mVacationEnabled60,#mVacationEnabled57,#mVacationEnabled56,#mVacationEnabled53'); if(vacEnabled)state.vacationHighlight.enabled=!!vacEnabled.checked;
    const vacOpacity=q('#mVacationOpacity60,#mVacationOpacity57,#mVacationOpacity56'); if(vacOpacity)state.vacationHighlight.opacity=Number(vacOpacity.value);
    const todayWidth=q('#mTodayBorderWidth60,#mTodayBorderWidth57,#mTodayBorderWidth56'); if(todayWidth)state.todayHighlight.borderWidth=Number(todayWidth.value);
    const todayOpacity=q('#mTodayOpacity60,#mTodayOpacity57,#mTodayOpacity56'); if(todayOpacity)state.todayHighlight.opacity=Number(todayOpacity.value);
    const sync=q('#mSyncInterval60,#mSyncInterval57,#mSyncInterval56'); if(sync)state.syncInterval=Number(sync.value);
    const work=q('#timelineWorkStartRev50,#timelineWorkStartRev49,#timelineWorkStartRev60'); if(work)state.workStartTime=work.value||'08:00';
    const step=q('#timelineStepModalRev52,#timelineStepModalRev50,#timelineStepModalRev60'); if(step)state.timelineStep=Number(step.value||30);
    const pause=q('#timelinePauseModalRev52,#timelinePauseModalRev50,#timelinePauseModalRev60'); if(pause)state.timelinePauseMinutes=Math.max(0,Number(pause.value||0));
    state.fetchMode='proxy';
    state.proxyUrl=state.proxyUrl||DEFAULT_PROXY_URL;
  }
  function bindTimeline60(){
    ensureRev60State();
    const input=document.querySelector('#timelineWorkStartRev50,#timelineWorkStartRev49');
    if(input){
      input.value=state.workStartTime||'08:00';
      input.oninput=async()=>{state.workStartTime=input.value||'08:00';await forceSaveAppState60();};
      input.onchange=async()=>{state.workStartTime=input.value||'08:00';await forceSaveAppState60();if(typeof renderSidebarTimelineRev050==='function')renderSidebarTimelineRev050();};
    }
    const step=document.querySelector('#timelineStepModalRev52,#timelineStepModalRev50');
    const pause=document.querySelector('#timelinePauseModalRev52,#timelinePauseModalRev50');
    if(step){step.value=String(state.timelineStep||30);step.onchange=async()=>{state.timelineStep=Number(step.value||30);await forceSaveAppState60();};}
    if(pause){pause.value=String(state.timelinePauseMinutes||0);pause.oninput=pause.onchange=async()=>{state.timelinePauseMinutes=Math.max(0,Number(pause.value||0));await forceSaveAppState60();};}
  }
  const oldRender60=window.render||render;
  window.render=render=function(){oldRender60();bindTimeline60();};
  const oldSidebar60=typeof renderSidebarTimelineRev050==='function'?renderSidebarTimelineRev050:null;
  if(oldSidebar60){renderSidebarTimelineRev050=function(){oldSidebar60();bindTimeline60();};}
  const oldOpenTimeline60=typeof openTimelineSettingsRev52==='function'?openTimelineSettingsRev52:null;
  if(oldOpenTimeline60){openTimelineSettingsRev52=function(){oldOpenTimeline60();setTimeout(bindTimeline60,0);};}

  const colors60=['#64748b','#000000','#ffffff','#0284c7','#7c5cff','#22c55e','#ffb020','#f97316','#ff5050','#ec4899','#14b8a6','#a855f7'];
  function colorBtn60(id,color,label){return `<button type="button" class="btn small rev60-color-button" id="${id}" title="${escapeHtml(label)}"><span class="rev60-color-dot" style="background:${escapeHtml(color)}"></span>${iconColorBucket()}</button>`;}
  function palette60(id,current){const cur=isHex60(current)?current:'#64748b';return `<div class="rev60-palette" id="${id}">${colors60.map(c=>`<button type="button" class="color-choice" data-color60="${c}" style="background:${c}" title="${c}"></button>`).join('')}<input type="color" value="${escapeHtml(cur)}" data-color60-input="1"></div>`;}
  function bindPalette60(id,onPick){
    const pal=document.querySelector('#'+id);if(!pal)return;
    pal.querySelectorAll('[data-color60]').forEach(b=>b.onclick=()=>onPick(b.dataset.color60));
    const inp=pal.querySelector('[data-color60-input]');if(inp)inp.oninput=()=>onPick(inp.value);
  }
  function togglePalette60(btnId,palId){const b=document.querySelector('#'+btnId),p=document.querySelector('#'+palId);if(b&&p)b.onclick=()=>p.classList.toggle('open');}
  function renderGeneral60(){
    ensureRev60State();
    const root=document.querySelector('#settingsTabContentRev60');if(!root)return;
    root.innerHTML=`<div class="settings-grid">
      <div class="rev60-card"><div class="rev60-card-title">Darstellung</div>
        <div class="rev60-row"><label>Erscheinung</label><select id="mTheme60"><option value="light">Hell</option><option value="dark">Dunkel</option></select></div>
        <div class="rev60-row"><label>Kanten</label><select id="mCornerStyle60"><option value="rounded">Abgerundet</option><option value="sharp">Eckig / 90°</option></select></div>
        <div class="rev60-row"><label>Konturfarbe</label><div class="rev60-inline"><select id="mOutlineStyle60"><option value="current">Wie aktuell</option><option value="none">Keine</option><option value="gray">Grau</option><option value="black">Schwarz</option><option value="custom">Farbpalette</option></select>${colorBtn60('mOutlineColorBtn60',state.outlineCustomColor,'Konturfarbe wählen')}</div></div>
        ${palette60('mOutlinePalette60',state.outlineCustomColor)}
      </div>
      <div class="rev60-card"><label class="rev60-check"><span><b>Urlaubstage anders anzeigen</b><small>Wenn ein sichtbarer ICS- oder eigener Kalender einen ganztägigen Termin mit exakt dem Titel „Urlaub“ enthält, wird der ganze Tag farblich hinterlegt.</small></span><input id="mVacationEnabled60" type="checkbox"></label>
        <div class="rev60-row"><label>Urlaubsfarbe</label><div>${colorBtn60('mVacationColorBtn60',state.vacationHighlight.color,'Urlaubsfarbe wählen')}</div></div>
        ${palette60('mVacationPalette60',state.vacationHighlight.color)}
        <div class="rev60-row"><label>Deckkraft</label><input id="mVacationOpacity60" type="range" min="0.05" max="0.55" step="0.01" value="${escapeHtml(state.vacationHighlight.opacity)}"></div>
      </div>
      <div class="rev60-card"><div class="rev60-card-title">Aktueller Tag<small>Hier stellst du Konturfarbe, Linienstärke und Flächenintensität des heutigen Tages ein.</small></div>
        <div class="rev60-row"><label>Linienstärke</label><input id="mTodayBorderWidth60" type="range" min="1" max="10" step="1" value="${escapeHtml(state.todayHighlight.borderWidth)}"></div>
        <div class="rev60-row"><label>Linienfarbe</label><div>${colorBtn60('mTodayBorderColorBtn60',state.todayHighlight.borderColor,'Linienfarbe wählen')}</div></div>
        ${palette60('mTodayBorderPalette60',state.todayHighlight.borderColor)}
        <div class="rev60-row"><label>Flächen-Deckkraft</label><input id="mTodayOpacity60" type="range" min="0" max="0.65" step="0.01" value="${escapeHtml(state.todayHighlight.opacity)}"></div>
      </div>
      <div class="hint">Diese Werte werden erst beim Klick auf „Speichern“ verbindlich in den App-State übernommen und danach in Supabase gespeichert.</div>
    </div>`;
    document.querySelector('#mTheme60').value=state.theme||'light';
    document.querySelector('#mCornerStyle60').value=state.cornerStyle||'rounded';
    document.querySelector('#mOutlineStyle60').value=state.outlineStyle||'current';
    document.querySelector('#mVacationEnabled60').checked=!!state.vacationHighlight.enabled;
    togglePalette60('mOutlineColorBtn60','mOutlinePalette60');togglePalette60('mVacationColorBtn60','mVacationPalette60');togglePalette60('mTodayBorderColorBtn60','mTodayBorderPalette60');
    bindPalette60('mOutlinePalette60',c=>{state.outlineStyle='custom';state.outlineCustomColor=c;renderGeneral60();});
    bindPalette60('mVacationPalette60',c=>{state.vacationHighlight.color=c;renderGeneral60();});
    bindPalette60('mTodayBorderPalette60',c=>{state.todayHighlight.borderColor=c;renderGeneral60();});
  }
  function renderSync60(){
    const root=document.querySelector('#settingsTabContentRev60');if(!root)return;
    root.innerHTML=`<div class="settings-grid"><div class="rev60-card"><div class="rev60-card-title">Synchronisierung</div><div class="rev60-row"><label>Intervall</label><select id="mSyncInterval60"><option value="0">Aus / manuell</option><option value="5">Alle 5 Min.</option><option value="15">Alle 15 Min.</option><option value="30">Alle 30 Min.</option><option value="60">Alle 60 Min.</option></select></div><div class="hint">Proxy-URL und separater ICS-Aktualisieren-Button bleiben ausgeblendet. Manuelles Neuladen läuft über den grünen Reload-Button oben.</div></div></div>`;
    document.querySelector('#mSyncInterval60').value=String(state.syncInterval??15);
  }
  function renderInfo60(){
    const root=document.querySelector('#settingsTabContentRev60');if(!root)return;
    root.innerHTML=`<div class="settings-grid"><div class="security-note"><b>Speicherlogik</b><br>Beim Klick auf „Speichern“ werden die aktuellen Anzeigeparameter vollständig in <code>app_state</code> gespeichert. Zeitstrahlwerte werden zusätzlich direkt beim Ändern gespeichert.</div></div>`;
  }
  function openSettings60(){
    ensureRev60State();
    document.querySelector('#modalTitle').textContent='Allgemeine Einstellungen';
    document.querySelector('#modalContent').innerHTML=`<div class="settings-layout-rev56 rev60-settings"><div class="settings-tabs-rev56"><button class="settings-tab-rev56 active" data-tab60="general" type="button">Allgemein</button><button class="settings-tab-rev56" data-tab60="sync" type="button">Synchronisierung</button><button class="settings-tab-rev56" data-tab60="info" type="button">Hinweise</button></div><div id="settingsTabContentRev60" class="settings-tab-content-rev53"></div></div>`;
    document.querySelector('#modalBackdrop').style.display='flex';
    const save=document.querySelector('#saveModal');save.style.display='';
    let active='general';
    const renderActive=()=>{if(active==='general')renderGeneral60();else if(active==='sync')renderSync60();else renderInfo60();};
    renderActive();
    document.querySelectorAll('[data-tab60]').forEach(btn=>btn.onclick=async()=>{readSettingsDom60();active=btn.dataset.tab60;document.querySelectorAll('[data-tab60]').forEach(b=>b.classList.toggle('active',b===btn));renderActive();});
    save.onclick=async()=>{readSettingsDom60();await forceSaveAppState60();if(typeof setupAutoSync==='function')setupAutoSync();if(typeof applyAppearance==='function')applyAppearance();closeModal();render();toast('Einstellungen im App-State gespeichert.');};
    document.querySelectorAll('.modal-actions #rev58DeleteOwnEvent,.modal-actions .rev58-own-trash,.modal-actions .rev57-trash-left,.modal-actions .own-delete-square56,.modal-actions #deleteOwnFromEditRev51').forEach(x=>x.remove());
  }
  const style=document.createElement('style');
  style.textContent=`
    .rev60-settings .settings-tab-rev56{color:#111827!important;background:#f8fafc!important;border:1px solid #cbd5e1!important;}
    .rev60-settings .settings-tab-rev56.active{background:#d1d5db!important;color:#111827!important;font-weight:1000!important;}
    .rev60-card{border:1px solid #cbd5e1;border-radius:14px;padding:12px;background:#f8fafc;display:grid;gap:10px;color:#111827;}
    .rev60-card-title{font-weight:1000;color:#111827;display:block;}
    .rev60-card-title small,.rev60-check small{display:block;color:#475569;font-weight:600;line-height:1.35;margin-top:3px;}
    .rev60-row{display:grid;grid-template-columns:minmax(145px,210px) minmax(0,1fr);gap:10px;align-items:center;}
    .rev60-row label{font-weight:800;color:#111827;font-size:13px;}
    .rev60-row input,.rev60-row select{min-width:0;}
    .rev60-inline{display:flex;gap:8px;align-items:center;}
    .rev60-check{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;align-items:center;}
    .rev60-check b{color:#111827;font-weight:1000;}
    .rev60-color-button{height:40px!important;min-width:46px!important;border-radius:12px!important;display:inline-flex!important;align-items:center!important;justify-content:center!important;gap:6px!important;}
    .rev60-color-dot{width:18px;height:18px;border-radius:6px;border:1px solid rgba(0,0,0,.25);display:inline-block;}
    .rev60-palette{display:none;grid-template-columns:repeat(auto-fill,minmax(34px,1fr));gap:8px;margin-top:8px;}
    .rev60-palette.open{display:grid;}
    .rev60-palette input[type="color"]{height:34px;padding:2px;border-radius:9px;}
    @media(max-width:700px){.rev60-row{grid-template-columns:1fr;gap:5px;}}
  `;
  document.head.appendChild(style);
  const oldEnsure60=ensureSettings;
  ensureSettings=function(){oldEnsure60();ensureRev60State();};
  window.openSettingsRev56=openSettings60;
  window.openSyncSettingsModal=openSettings60;
  setTimeout(()=>{const s=document.querySelector('#settingsBtn');if(s)s.onclick=openSettings60;bindTimeline60();},200);
})();

/* Rev 061: robuste AppState-Persistenz + saubere Own-Event-Löschaktion nur bei bestehenden eigenen Terminen */
(function(){
  const REV61_DEFAULTS={
    vacationHighlight:{enabled:false,color:'#f97316',opacity:0.18},
    todayHighlight:{borderWidth:4,borderColor:'#0284c7',opacity:0.18},
    outlineStyle:'current',outlineCustomColor:'#64748b',timelineStep:30,timelinePauseMinutes:0,workStartTime:'08:00'
  };
  const isHex=v=>/^#[0-9a-f]{6}$/i.test(String(v||''));
  function clamp(n,min,max){n=Number(n);return Number.isFinite(n)?Math.max(min,Math.min(max,n)):min;}
  function ensureRev61State(){
    state.vacationHighlight=Object.assign({},REV61_DEFAULTS.vacationHighlight,state.vacationHighlight||{});
    state.todayHighlight=Object.assign({},REV61_DEFAULTS.todayHighlight,state.todayHighlight||{});
    state.vacationHighlight.color=isHex(state.vacationHighlight.color)?state.vacationHighlight.color:REV61_DEFAULTS.vacationHighlight.color;
    state.vacationHighlight.opacity=clamp(state.vacationHighlight.opacity,0.05,0.55);
    state.todayHighlight.borderColor=isHex(state.todayHighlight.borderColor)?state.todayHighlight.borderColor:REV61_DEFAULTS.todayHighlight.borderColor;
    state.todayHighlight.borderWidth=clamp(state.todayHighlight.borderWidth,1,10);
    state.todayHighlight.opacity=clamp(state.todayHighlight.opacity,0,0.65);
    state.outlineStyle=['current','none','gray','black','custom'].includes(state.outlineStyle)?state.outlineStyle:REV61_DEFAULTS.outlineStyle;
    state.outlineCustomColor=isHex(state.outlineCustomColor)?state.outlineCustomColor:REV61_DEFAULTS.outlineCustomColor;
    state.timelineStep=[15,30,60].includes(Number(state.timelineStep))?Number(state.timelineStep):30;
    state.timelinePauseMinutes=Math.max(0,Number(state.timelinePauseMinutes||0));
    state.workStartTime=/^\d{2}:\d{2}$/.test(String(state.workStartTime||''))?state.workStartTime:'08:00';
    state.fetchMode='proxy';
    state.proxyUrl=state.proxyUrl||DEFAULT_PROXY_URL;
  }
  async function saveAppStateRev61(){
    ensureRev61State();
    try{localStorage.setItem(storeKey,JSON.stringify(stripRuntimeICSCache(state)));}catch(e){}
    try{persist();}catch(e){}
    if(currentUser){
      clearTimeout(cloudSaveTimer);
      const payload={user_id:currentUser.id,state:stripRuntimeICSCache(state),updated_at:new Date().toISOString()};
      const {error}=await supabaseClient.from('app_state').upsert(payload,{onConflict:'user_id'});
      if(error){toast('App-State konnte nicht gespeichert werden: '+error.message);return false;}
      if(typeof setCloudStatus==='function')setCloudStatus('App-State gespeichert: '+new Date().toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'}),'ok');
    }
    return true;
  }
  const prevEnsure61=ensureSettings;
  ensureSettings=function(){prevEnsure61();ensureRev61State();};
  const prevApply61=applyAppearance;
  applyAppearance=function(){
    prevApply61();ensureRev61State();
    const outline=state.outlineStyle==='none'?'transparent':state.outlineStyle==='black'?'#000000':state.outlineStyle==='gray'?'#7b8494':state.outlineStyle==='custom'?state.outlineCustomColor:(getComputedStyle(document.documentElement).getPropertyValue('--line')||'#31405e');
    document.documentElement.style.setProperty('--frameBorderColor53',outline);
    document.documentElement.style.setProperty('--outlineColorRev52',outline);
    document.documentElement.style.setProperty('--todayBorderWidth56',state.todayHighlight.borderWidth+'px');
    document.documentElement.style.setProperty('--todayBorderColor56',state.todayHighlight.borderColor);
    document.documentElement.style.setProperty('--todayFillOpacity56',String(state.todayHighlight.opacity));
    document.documentElement.style.setProperty('--todayFillOpacityPercent56',Math.round(state.todayHighlight.opacity*100)+'%');
  };

  const colors=['#64748b','#000000','#ffffff','#0284c7','#7c5cff','#22c55e','#ffb020','#f97316','#ff5050','#ec4899','#14b8a6','#a855f7'];
  const esc=s=>escapeHtml(String(s??''));
  function deepDraft(){ensureRev61State();return JSON.parse(JSON.stringify({theme:state.theme,cornerStyle:state.cornerStyle,outlineStyle:state.outlineStyle,outlineCustomColor:state.outlineCustomColor,vacationHighlight:state.vacationHighlight,todayHighlight:state.todayHighlight,syncInterval:state.syncInterval}));}
  function colorButton(id,color,label){return `<button type="button" class="btn small rev61-color-button" id="${id}" title="${esc(label)}"><span class="rev61-color-dot" style="background:${esc(color)}"></span>${iconColorBucket()}</button>`;}
  function palette(id,current){return `<div class="rev61-palette" id="${id}">${colors.map(c=>`<button type="button" class="color-choice" data-rev61-color="${c}" style="background:${c}" title="${c}"></button>`).join('')}<input type="color" value="${esc(isHex(current)?current:'#64748b')}" data-rev61-input="1"></div>`;}
  function bindPalette(id,cb){const p=document.querySelector('#'+id);if(!p)return;p.querySelectorAll('[data-rev61-color]').forEach(b=>b.onclick=()=>cb(b.dataset.rev61Color));const i=p.querySelector('[data-rev61-input]');if(i)i.oninput=()=>cb(i.value);}
  function togglePalette(btn,pal){const b=document.querySelector('#'+btn),p=document.querySelector('#'+pal);if(b&&p)b.onclick=()=>p.classList.toggle('open');}
  function openSettings61(){
    ensureRev61State();
    const draft=deepDraft();
    let active='general';
    document.querySelector('#modalTitle').textContent='Allgemeine Einstellungen';
    document.querySelector('#modalContent').innerHTML=`<div class="settings-layout-rev56 rev61-settings"><div class="settings-tabs-rev56"><button class="settings-tab-rev56 active" data-rev61-tab="general" type="button">Allgemein</button><button class="settings-tab-rev56" data-rev61-tab="sync" type="button">Synchronisierung</button><button class="settings-tab-rev56" data-rev61-tab="info" type="button">Hinweise</button></div><div id="settingsTabContentRev61" class="settings-tab-content-rev53"></div></div>`;
    document.querySelector('#modalBackdrop').style.display='flex';
    document.querySelector('#saveModal').style.display='';
    function readVisible(){
      const q=s=>document.querySelector(s);
      if(q('#mTheme61'))draft.theme=q('#mTheme61').value;
      if(q('#mCornerStyle61'))draft.cornerStyle=q('#mCornerStyle61').value;
      if(q('#mOutlineStyle61'))draft.outlineStyle=q('#mOutlineStyle61').value;
      if(q('#mVacationEnabled61'))draft.vacationHighlight.enabled=q('#mVacationEnabled61').checked;
      if(q('#mVacationOpacity61'))draft.vacationHighlight.opacity=clamp(q('#mVacationOpacity61').value,0.05,0.55);
      if(q('#mTodayBorderWidth61'))draft.todayHighlight.borderWidth=clamp(q('#mTodayBorderWidth61').value,1,10);
      if(q('#mTodayOpacity61'))draft.todayHighlight.opacity=clamp(q('#mTodayOpacity61').value,0,0.65);
      if(q('#mSyncInterval61'))draft.syncInterval=Number(q('#mSyncInterval61').value);
    }
    function renderGeneral(){
      const root=document.querySelector('#settingsTabContentRev61');if(!root)return;
      root.innerHTML=`<div class="settings-grid">
        <div class="rev61-card"><div class="rev61-card-title">Darstellung</div>
          <div class="rev61-row"><label>Erscheinung</label><select id="mTheme61"><option value="light">Hell</option><option value="dark">Dunkel</option></select></div>
          <div class="rev61-row"><label>Kanten</label><select id="mCornerStyle61"><option value="rounded">Abgerundet</option><option value="sharp">Eckig / 90°</option></select></div>
          <div class="rev61-row"><label>Konturfarbe</label><div class="rev61-inline"><select id="mOutlineStyle61"><option value="current">Wie aktuell</option><option value="none">Keine</option><option value="gray">Grau</option><option value="black">Schwarz</option><option value="custom">Farbpalette</option></select>${colorButton('mOutlineColorBtn61',draft.outlineCustomColor,'Konturfarbe wählen')}</div></div>
          ${palette('mOutlinePalette61',draft.outlineCustomColor)}
        </div>
        <div class="rev61-card"><label class="rev61-check"><span><b>Urlaubstage anders anzeigen</b><small>Ganztägige Termine mit exakt dem Titel „Urlaub“ markieren den gesamten Tag.</small></span><input id="mVacationEnabled61" type="checkbox"></label>
          <div class="rev61-row"><label>Urlaubsfarbe</label><div>${colorButton('mVacationColorBtn61',draft.vacationHighlight.color,'Urlaubsfarbe wählen')}</div></div>
          ${palette('mVacationPalette61',draft.vacationHighlight.color)}
          <div class="rev61-row"><label>Deckkraft</label><input id="mVacationOpacity61" type="range" min="0.05" max="0.55" step="0.01" value="${esc(draft.vacationHighlight.opacity)}"></div>
        </div>
        <div class="rev61-card"><div class="rev61-card-title">Aktueller Tag<small>Kontur und Füllung des heutigen Tages.</small></div>
          <div class="rev61-row"><label>Linienstärke</label><input id="mTodayBorderWidth61" type="range" min="1" max="10" step="1" value="${esc(draft.todayHighlight.borderWidth)}"></div>
          <div class="rev61-row"><label>Linienfarbe</label><div>${colorButton('mTodayBorderColorBtn61',draft.todayHighlight.borderColor,'Linienfarbe wählen')}</div></div>
          ${palette('mTodayBorderPalette61',draft.todayHighlight.borderColor)}
          <div class="rev61-row"><label>Flächen-Deckkraft</label><input id="mTodayOpacity61" type="range" min="0" max="0.65" step="0.01" value="${esc(draft.todayHighlight.opacity)}"></div>
        </div>
        <div class="hint">Wichtig: Diese Werte werden erst beim Klick auf „Speichern“ in den App-State geschrieben und danach explizit in Supabase gespeichert.</div>
      </div>`;
      document.querySelector('#mTheme61').value=draft.theme||'light';
      document.querySelector('#mCornerStyle61').value=draft.cornerStyle||'rounded';
      document.querySelector('#mOutlineStyle61').value=draft.outlineStyle||'current';
      document.querySelector('#mVacationEnabled61').checked=!!draft.vacationHighlight.enabled;
      togglePalette('mOutlineColorBtn61','mOutlinePalette61');togglePalette('mVacationColorBtn61','mVacationPalette61');togglePalette('mTodayBorderColorBtn61','mTodayBorderPalette61');
      bindPalette('mOutlinePalette61',c=>{readVisible();draft.outlineStyle='custom';draft.outlineCustomColor=c;renderGeneral();});
      bindPalette('mVacationPalette61',c=>{readVisible();draft.vacationHighlight.color=c;renderGeneral();});
      bindPalette('mTodayBorderPalette61',c=>{readVisible();draft.todayHighlight.borderColor=c;renderGeneral();});
    }
    function renderSync(){
      const root=document.querySelector('#settingsTabContentRev61');if(!root)return;
      root.innerHTML=`<div class="settings-grid"><div class="rev61-card"><div class="rev61-card-title">Synchronisierung</div><div class="rev61-row"><label>Intervall</label><select id="mSyncInterval61"><option value="0">Aus / manuell</option><option value="5">Alle 5 Min.</option><option value="15">Alle 15 Min.</option><option value="30">Alle 30 Min.</option><option value="60">Alle 60 Min.</option></select></div><div class="hint">Der obere grüne Reload-Button lädt Daten manuell neu.</div></div></div>`;
      document.querySelector('#mSyncInterval61').value=String(draft.syncInterval??15);
    }
    function renderInfo(){const root=document.querySelector('#settingsTabContentRev61');if(root)root.innerHTML=`<div class="settings-grid"><div class="security-note"><b>Speicherprotokoll</b><br>Gespeichert werden hier nur UI-/Anzeigeparameter im <code>app_state</code>. Fachliche Daten wie Termine, Tasks und Kalenderquellen bleiben in ihren eigenen Tabellen beziehungsweise Strukturen.</div></div>`;}
    function renderActive(){if(active==='general')renderGeneral();else if(active==='sync')renderSync();else renderInfo();}
    renderActive();
    document.querySelectorAll('[data-rev61-tab]').forEach(btn=>btn.onclick=()=>{readVisible();active=btn.dataset.rev61Tab;document.querySelectorAll('[data-rev61-tab]').forEach(b=>b.classList.toggle('active',b===btn));renderActive();});
    document.querySelector('#saveModal').onclick=async()=>{
      readVisible();
      state.theme=draft.theme||'light';state.cornerStyle=draft.cornerStyle||'rounded';state.outlineStyle=draft.outlineStyle||'current';state.outlineCustomColor=draft.outlineCustomColor;
      state.vacationHighlight=Object.assign({},draft.vacationHighlight);state.todayHighlight=Object.assign({},draft.todayHighlight);state.syncInterval=Number(draft.syncInterval??15);
      ensureRev61State();if(typeof setupAutoSync==='function')setupAutoSync();if(typeof applyAppearance==='function')applyAppearance();
      const ok=await saveAppStateRev61();closeModal();render();toast(ok?'Einstellungen im App-State gespeichert.':'Einstellungen lokal übernommen, Cloud-Speicherung fehlgeschlagen.');
    };
    cleanupForeignTrashRev61();
  }

  function bindTimelineRev61(){
    ensureRev61State();
    const input=document.querySelector('#timelineWorkStartRev50,#timelineWorkStartRev49,#timelineWorkStartRev60');
    if(input&&!input.dataset.rev61Bound){
      input.dataset.rev61Bound='1';input.value=state.workStartTime||'08:00';
      const save=async()=>{state.workStartTime=input.value||'08:00';await saveAppStateRev61();};
      input.addEventListener('input',save);input.addEventListener('change',async()=>{await save();if(typeof renderSidebarTimelineRev050==='function')renderSidebarTimelineRev050();});
    }
    const step=document.querySelector('#timelineStepModalRev52,#timelineStepModalRev50,#timelineStepModalRev60');
    const pause=document.querySelector('#timelinePauseModalRev52,#timelinePauseModalRev50,#timelinePauseModalRev60');
    if(step&&!step.dataset.rev61Bound){step.dataset.rev61Bound='1';step.value=String(state.timelineStep||30);step.addEventListener('change',async()=>{state.timelineStep=Number(step.value||30);await saveAppStateRev61();});}
    if(pause&&!pause.dataset.rev61Bound){pause.dataset.rev61Bound='1';pause.value=String(state.timelinePauseMinutes||0);pause.addEventListener('input',async()=>{state.timelinePauseMinutes=Math.max(0,Number(pause.value||0));await saveAppStateRev61();});pause.addEventListener('change',async()=>{state.timelinePauseMinutes=Math.max(0,Number(pause.value||0));await saveAppStateRev61();});}
  }

  function cleanupForeignTrashRev61(){
    const title=(document.querySelector('#modalTitle')?.textContent||'').trim();
    const actions=document.querySelector('.modal-actions');if(!actions)return;
    const original=document.querySelector('#modalContent #deleteOwnFromEditRev51,#modalContent #deleteOwnEvent');
    const isOwnExisting=/Eigenen Termin bearbeiten|Termindetails/.test(title) && !!original;
    actions.querySelectorAll('.rev58-own-trash,.rev57-trash-left,.own-delete-square56,#rev58DeleteOwnEvent,#deleteOwnFromEditRev51,#deleteOwnEvent').forEach(b=>b.remove());
    if(!isOwnExisting){
      actions.querySelectorAll('.rev61-trash-left').forEach(b=>b.remove());
      document.querySelectorAll('#modalContent #deleteOwnFromEditRev51,#modalContent #deleteOwnEvent,.settings-layout-rev56 .own-delete-square56,.settings-layout-rev53 .own-delete-square56').forEach(b=>b.remove());
      return;
    }
    if(actions.querySelector('.rev61-trash-left')){original.style.display='none';return;}
    const handler=original.onclick;
    original.style.display='none';
    const btn=document.createElement('button');
    btn.type='button';btn.className='btn danger rev61-trash-left';btn.title='Eigenen Termin löschen';btn.innerHTML=iconTrash();
    btn.onclick=ev=>{ev.preventDefault();ev.stopPropagation(); if(typeof handler==='function')handler.call(original,ev); else original.click();};
    actions.prepend(btn);
  }
  const style=document.createElement('style');
  style.textContent=`
    .rev61-settings .settings-tab-rev56{color:#111827!important;background:#f8fafc!important;border:1px solid #cbd5e1!important;}
    .rev61-settings .settings-tab-rev56.active{background:#d1d5db!important;color:#111827!important;font-weight:1000!important;}
    .rev61-card{border:1px solid #cbd5e1;border-radius:14px;padding:12px;background:#f8fafc;display:grid;gap:10px;color:#111827;}
    .rev61-card-title{font-weight:1000;color:#111827;display:block;}
    .rev61-card-title small,.rev61-check small{display:block;color:#475569;font-weight:600;line-height:1.35;margin-top:3px;}
    .rev61-row{display:grid;grid-template-columns:minmax(145px,210px) minmax(0,1fr);gap:10px;align-items:center;}
    .rev61-row label{font-weight:800;color:#111827;font-size:13px;}.rev61-row input,.rev61-row select{min-width:0;}
    .rev61-inline{display:flex;gap:8px;align-items:center;}.rev61-check{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;align-items:center;}.rev61-check b{color:#111827;font-weight:1000;}
    .rev61-color-button{height:40px!important;min-width:46px!important;border-radius:12px!important;display:inline-flex!important;align-items:center!important;justify-content:center!important;gap:6px!important;}
    .rev61-color-dot{width:18px;height:18px;border-radius:6px;border:1px solid rgba(0,0,0,.25);display:inline-block;}.rev61-palette{display:none;grid-template-columns:repeat(auto-fill,minmax(34px,1fr));gap:8px;margin-top:8px;}.rev61-palette.open{display:grid;}.rev61-palette input[type="color"]{height:34px;padding:2px;border-radius:9px;}
    .modal-actions{display:flex!important;align-items:center!important;gap:10px!important;}.rev61-trash-left{margin-right:auto!important;width:42px!important;height:42px!important;min-width:42px!important;padding:0!important;display:inline-flex!important;align-items:center!important;justify-content:center!important;border-radius:12px!important;}.rev61-trash-left svg{width:22px!important;height:22px!important;stroke:currentColor!important;}body.sharp-corners .rev61-trash-left{border-radius:0!important;}
    @media(max-width:700px){.rev61-row{grid-template-columns:1fr;gap:5px;}}
  `;
  document.head.appendChild(style);

  window.openSettingsRev56=openSettings61;window.openSyncSettingsModal=openSettings61;
  const prevRender61=window.render||render;window.render=render=function(){const r=prevRender61();bindTimelineRev61();setTimeout(cleanupForeignTrashRev61,0);return r;};
  if(typeof renderSidebarTimelineRev050==='function'){const old=renderSidebarTimelineRev050;renderSidebarTimelineRev050=function(){const r=old();bindTimelineRev61();return r;};}
  if(typeof openTimelineSettingsRev52==='function'){const old=openTimelineSettingsRev52;openTimelineSettingsRev52=function(){const r=old.apply(this,arguments);setTimeout(bindTimelineRev61,0);return r;};}
  const observer=new MutationObserver(()=>{cleanupForeignTrashRev61();bindTimelineRev61();});
  setTimeout(()=>{const modal=document.querySelector('#modalBackdrop');if(modal)observer.observe(modal,{childList:true,subtree:true,attributes:true,attributeFilter:['style','class']});const s=document.querySelector('#settingsBtn');if(s)s.onclick=openSettings61;ensureRev61State();applyAppearance();bindTimelineRev61();cleanupForeignTrashRev61();},150);
})();

/* Rev 062: Kontextgenaue Löschbuttons + Zeitstrahl ohne Zahnrad, Halbstundentakt fix, Start/Pause persistent */
(function(){
  function rev62EnsureState(){
    if(!state) return;
    state.timelineStep=30; // feste Vorgabe: Halbstundentakt
    state.workStartTime=/^\d{2}:\d{2}$/.test(String(state.workStartTime||''))?state.workStartTime:'08:00';
    state.timelinePauseMinutes=Math.max(0,Number(state.timelinePauseMinutes||0));
    state.fetchMode='proxy';
    state.proxyUrl=state.proxyUrl||DEFAULT_PROXY_URL;
  }
  async function rev62SaveAppState(){
    rev62EnsureState();
    try{localStorage.setItem(storeKey,JSON.stringify(stripRuntimeICSCache(state)));}catch(e){}
    try{persist();}catch(e){}
    if(currentUser){
      clearTimeout(cloudSaveTimer);
      const payload={user_id:currentUser.id,state:stripRuntimeICSCache(state),updated_at:new Date().toISOString()};
      const {error}=await supabaseClient.from('app_state').upsert(payload,{onConflict:'user_id'});
      if(error){toast('App-State konnte nicht gespeichert werden: '+error.message);return false;}
      if(typeof setCloudStatus==='function')setCloudStatus('App-State gespeichert: '+new Date().toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'}),'ok');
    }
    return true;
  }
  const prevEnsure62=ensureSettings;
  ensureSettings=function(){prevEnsure62();rev62EnsureState();};

  function rev62HHMM(min){min=((Math.round(min)%1440)+1440)%1440;return String(Math.floor(min/60)).padStart(2,'0')+':'+String(min%60).padStart(2,'0');}
  function rev62ParseHHMM(v){const m=String(v||'').match(/^(\d{1,2}):(\d{2})$/);if(!m)return null;const h=Number(m[1]),mi=Number(m[2]);if(h<0||h>23||mi<0||mi>59)return null;return h*60+mi;}
  function rev62TodayBase(){const d=new Date();d.setHours(0,0,0,0);return d;}
  function rev62ShownDate(){return addDays(rev62TodayBase(),Number(state.timelineDayOffset||0));}
  function rev62MinutesOfDate(d){return d.getHours()*60+d.getMinutes();}
  function rev62VisibleEventsForDate(day){
    const out=[];
    visibleCalendars().forEach(({cal,idx:ci})=>{
      const links=cal.links||[];
      (cal.events||[]).forEach((e,ei)=>{
        const l=links.find(x=>x.id===e.icsId); if(l&&l.visible===false)return;
        const occ=eventOccurrenceForDate(e,day); if(!occ||occ.allDay)return;
        const s=new Date(occ.start), en=occ.end?new Date(occ.end):new Date(s.getTime()+30*60000);
        if(isNaN(s)||isNaN(en))return;
        out.push({summary:occ.summary||'Termin',source:occ.icsName||occ.source||cal.name,start:rev62MinutesOfDate(s),end:Math.max(rev62MinutesOfDate(s)+15,rev62MinutesOfDate(en)),color:occ.icsColor||l?.color||state.colors.event,ref:`ics:${ci}:${ei}:${fmtDate(day)}`});
      });
      (cal.ownEvents||[]).forEach((e,ei)=>{
        const l=links.find(x=>x.id===e.sourceId); if(!l||l.visible===false)return;
        const occ=eventOccurrenceForDate(e,day); if(!occ||occ.allDay)return;
        const s=new Date(occ.start), en=occ.end?new Date(occ.end):new Date(s.getTime()+30*60000);
        if(isNaN(s)||isNaN(en))return;
        out.push({summary:occ.summary||'Termin',source:occ.icsName||occ.source||cal.name,start:rev62MinutesOfDate(s),end:Math.max(rev62MinutesOfDate(s)+15,rev62MinutesOfDate(en)),color:occ.icsColor||l.color||state.colors.event,ref:`own:${ci}:${ei}:${fmtDate(day)}`});
      });
    });
    return out.sort((a,b)=>a.start-b.start);
  }
  function rev62LayoutEvents(items){
    const groups=[];
    items.forEach(it=>{let g=groups.find(gr=>it.start<gr.end);if(!g){g={end:it.end,items:[]};groups.push(g);}g.items.push(it);g.end=Math.max(g.end,it.end);});
    groups.forEach(g=>{const cols=[];g.items.forEach(it=>{let col=cols.findIndex(end=>end<=it.start);if(col<0){col=cols.length;cols.push(it.end);}else cols[col]=it.end;it.col=col;it.cols=cols.length;});g.items.forEach(it=>it.cols=Math.max(it.cols,cols.length));});
    return items;
  }
  function rev62IsVacationDay(day){
    try{
      if(!state.vacationHighlight?.enabled)return false;
      return visibleCalendars().some(({cal})=>{
        const links=cal.links||[];
        const all=[...(cal.events||[]),...(cal.ownEvents||[])];
        return all.some(e=>{
          const link=links.find(l=>l.id===e.icsId||l.id===e.sourceId); if(link&&link.visible===false)return false;
          const occ=eventOccurrenceForDate(e,day); return occ&&occ.allDay&&String(occ.summary||'').trim().toLowerCase()==='urlaub';
        });
      });
    }catch(e){return false;}
  }
  function rev62VacationStyle(){
    const color=state.vacationHighlight?.color||'#f97316';
    const opacity=Math.max(0.05,Math.min(0.55,Number(state.vacationHighlight?.opacity||0.18)));
    return `background:linear-gradient(0deg, color-mix(in srgb, ${color} ${Math.round(opacity*100)}%, transparent), color-mix(in srgb, ${color} ${Math.round(opacity*100)}%, transparent)), var(--panel2);`;
  }
  window.renderSidebarTimelineRev050=function(){
    rev62EnsureState();
    const sidebar=document.querySelector('.sidebar'); if(!sidebar)return;
    let box=document.querySelector('#sidebarDayTimelineRev049');
    if(!box){box=document.createElement('section');box.id='sidebarDayTimelineRev049';box.className='sidebar-day-timeline';sidebar.appendChild(box);} 
    const shown=rev62ShownDate();
    const events=rev62LayoutEvents(rev62VisibleEventsForDate(shown));
    const pxPerMin=0.55,totalH=1440*pxPerMin,step=30,lines=[];
    for(let m=0;m<=1440;m+=step){const major=m%60===0;lines.push(`<div class="timeline-line ${major?'major':''}" style="top:${m*pxPerMin}px">${major?`<span class="timeline-line-label">${rev62HHMM(m)}</span>`:''}</div>`);}
    let nowLine='';
    const today=rev62TodayBase();
    if(sameDay(shown,today)){const now=new Date();const nowMin=now.getHours()*60+now.getMinutes()+now.getSeconds()/60;nowLine=`<div class="timeline-now-line" data-now-line-rev50 style="top:${nowMin*pxPerMin}px"><span class="timeline-now-label">${rev62HHMM(nowMin)}</span></div>`;}
    const evHtml=events.map(it=>{const top=Math.max(0,it.start*pxPerMin),h=Math.max(18,(it.end-it.start)*pxPerMin),w=100/it.cols,left=it.col*w;const tiny=h<28;return `<div class="timeline-event-block ${tiny?'timeline-event-tiny':''}" data-event-ref="${escapeHtml(it.ref)}" style="top:${top}px;height:${h}px;left:calc(${left}% + 42px);width:calc(${w}% - 46px);border-left-color:${escapeHtml(it.color)};background:${escapeHtml(it.color)}cc"><b>${escapeHtml(shortText(it.summary,28))}</b><small>${escapeHtml(rev62HHMM(it.start)+'–'+rev62HHMM(it.end)+' · '+shortText(it.source,22))}</small></div>`;}).join('');
    const start=rev62ParseHHMM(state.workStartTime),pause=Number(state.timelinePauseMinutes||0),endText=start===null?'—':rev62HHMM(start+8*60+pause);
    const vacClass=rev62IsVacationDay(shown)?' vacation-active':'';
    box.innerHTML=`<div class="sidebar-timeline-head"><div><div class="sidebar-timeline-title">Zeitstrahl</div><div class="sidebar-timeline-date">${escapeHtml(typeof dateDERev046==='function'?dateDERev046(shown):deDate(shown))}</div></div><div class="timeline-day-nav"><button class="btn small ui-icon-btn" id="timelinePrevDay52" title="Vorheriger Tag">‹</button><button class="btn small" id="timelineToday52" title="Heute anzeigen">Heute</button><button class="btn small ui-icon-btn" id="timelineNextDay52" title="Nächster Tag">›</button></div></div><div class="timeline-field-stack-rev62"><label>Start Arbeitstag</label><input id="timelineWorkStartRev62" type="time" value="${escapeHtml(state.workStartTime||'08:00')}" title="Arbeitsbeginn"><label>Pausenzeit in Minuten</label><input id="timelinePauseRev62" type="number" min="0" step="5" value="${escapeHtml(state.timelinePauseMinutes||0)}" title="Pausenzeit in Minuten"></div><div class="timeline-pause-note">Schrittweite: Halbstundentakt fest eingestellt.</div><div class="timeline-eod">Feierabend Zeit: <b>${escapeHtml(endText)}</b> 🍺</div><div class="timeline-canvas-wrap${vacClass}" ${vacClass?`style="${rev62VacationStyle()}"`:''}><div class="timeline-canvas" style="height:${totalH}px;min-height:${totalH}px">${lines.join('')}${nowLine}${evHtml||'<div class="timeline-empty">Keine sichtbaren Termine für diesen Tag.</div>'}</div></div>`;
    box.querySelector('#timelinePrevDay52').onclick=async()=>{state.timelineDayOffset=Number(state.timelineDayOffset||0)-1;await rev62SaveAppState();renderSidebarTimelineRev050();};
    box.querySelector('#timelineToday52').onclick=async()=>{state.timelineDayOffset=0;await rev62SaveAppState();renderSidebarTimelineRev050();};
    box.querySelector('#timelineNextDay52').onclick=async()=>{state.timelineDayOffset=Number(state.timelineDayOffset||0)+1;await rev62SaveAppState();renderSidebarTimelineRev050();};
    const work=box.querySelector('#timelineWorkStartRev62');
    const pauseInput=box.querySelector('#timelinePauseRev62');
    if(work){work.oninput=async()=>{state.workStartTime=work.value||'08:00';await rev62SaveAppState();};work.onchange=async()=>{state.workStartTime=work.value||'08:00';await rev62SaveAppState();renderSidebarTimelineRev050();};}
    if(pauseInput){pauseInput.oninput=async()=>{state.timelinePauseMinutes=Math.max(0,Number(pauseInput.value||0));await rev62SaveAppState();};pauseInput.onchange=async()=>{state.timelinePauseMinutes=Math.max(0,Number(pauseInput.value||0));await rev62SaveAppState();renderSidebarTimelineRev050();};}
    box.querySelectorAll('[data-event-ref]').forEach(el=>el.onclick=()=>openEventDetailModal(el.dataset.eventRef));
  };
  window.openTimelineSettingsRev52=function(){toast('Die Zeitstrahl-Einstellungen sind jetzt direkt im Zeitstrahl sichtbar.');};

  function rev62DeleteButton(onDelete,title='Löschen'){
    const actions=document.querySelector('.modal-actions'); if(!actions)return null;
    actions.querySelectorAll('.rev62-delete-left,.rev61-trash-left,.rev58-own-trash,.rev57-trash-left,.own-delete-square56,#rev58DeleteOwnEvent,#deleteOwnFromEditRev51,#deleteOwnEvent').forEach(b=>b.remove());
    const btn=document.createElement('button');
    btn.type='button';btn.className='btn danger rev62-delete-left';btn.title=title;btn.innerHTML=iconTrash();
    btn.onclick=async ev=>{ev.preventDefault();ev.stopPropagation();await onDelete();};
    actions.prepend(btn);
    setTimeout(()=>{const ref=actions.querySelector('#saveModal,#cancelModal');const h=Math.round(ref?.getBoundingClientRect?.().height||42);btn.style.width=h+'px';btn.style.height=h+'px';btn.style.minWidth=h+'px';},0);
    return btn;
  }
  function rev62ModalIsCreate(){const title=(document.querySelector('#modalTitle')?.textContent||'').toLowerCase();return /hinzufügen|anlegen|erstellen/.test(title);}
  function rev62RemoveDeleteIfForbidden(){
    const title=(document.querySelector('#modalTitle')?.textContent||'').toLowerCase();
    if(rev62ModalIsCreate()||/einstellung|synchronisierung|hinweise|legende|cloud|login|modus konfigurieren/.test(title)){
      document.querySelectorAll('.modal-actions .rev62-delete-left,.modal-actions .rev61-trash-left,.modal-actions .rev58-own-trash,.modal-actions .rev57-trash-left,.modal-actions .own-delete-square56,.modal-actions #rev58DeleteOwnEvent,.modal-actions #deleteOwnFromEditRev51,.modal-actions #deleteOwnEvent,#modalContent #deleteOwnFromEditRev51,#modalContent #deleteOwnEvent').forEach(b=>b.remove());
    }
  }
  const oldOpenEventDetail62=window.openEventDetailModal||openEventDetailModal;
  window.openEventDetailModal=openEventDetailModal=function(ref){
    const r=oldOpenEventDetail62.apply(this,arguments);
    setTimeout(()=>{
      const type=String(ref||'').split(':')[0];
      const parts=String(ref||'').split(':');
      if(type!=='own'||rev62ModalIsCreate())return rev62RemoveDeleteIfForbidden();
      const cal=state.calendars?.[Number(parts[1])]; const idx=Number(parts[2]); const evt=cal?.ownEvents?.[idx]; if(!cal||!evt)return;
      const original=document.querySelector('#modalContent #deleteOwnFromEditRev51,#modalContent #deleteOwnEvent'); if(original)original.style.display='none';
      rev62DeleteButton(async()=>{
        if(!confirm('Eigenen Termin / Serie löschen?'))return;
        try{
          if(typeof deleteOwnEventRev046==='function'&&evt.id)await deleteOwnEventRev046(evt.id);
          cal.ownEvents.splice(idx,1);closeModal();render();toast('Eigener Termin gelöscht.');
        }catch(error){toast(error.message||String(error));}
      },'Eigenen Termin löschen');
    },0);
    return r;
  };
  const oldOpenTaskDetail62=window.openTaskDetailModal||openTaskDetailModal;
  window.openTaskDetailModal=openTaskDetailModal=function(ref){
    const r=oldOpenTaskDetail62.apply(this,arguments);
    setTimeout(()=>{
      if(rev62ModalIsCreate())return rev62RemoveDeleteIfForbidden();
      const [type,id]=String(ref||'').split(':');
      const arr=type==='long'?state.longterm:state.tasks; const label=type==='long'?'Langfristigen Task löschen':'Tagestask löschen';
      if(!arr||!arr.find(x=>String(x.id)===String(id)))return;
      rev62DeleteButton(async()=>{if(!confirm(label+'?'))return; if(type==='long')state.longterm=state.longterm.filter(x=>String(x.id)!==String(id)); else state.tasks=state.tasks.filter(x=>String(x.id)!==String(id)); await rev62SaveAppState();closeModal();render();toast(type==='long'?'Langfristiger Task gelöscht.':'Tagestask gelöscht.');},label);
    },0);
    return r;
  };
  if(typeof openProjectTaskDetailModalRev047==='function'){
    const oldProjectTaskDetail62=openProjectTaskDetailModalRev047;
    openProjectTaskDetailModalRev047=function(id){
      const r=oldProjectTaskDetail62.apply(this,arguments);
      setTimeout(()=>{
        if(rev62ModalIsCreate())return rev62RemoveDeleteIfForbidden();
        const t=(state.projectTasks||[]).find(x=>String(x.id)===String(id)); if(!t)return;
        rev62DeleteButton(async()=>{if(!confirm('Projekt-Task löschen?'))return;try{if(typeof deleteProjectTaskRev047==='function')await deleteProjectTaskRev047(id);state.projectTasks=(state.projectTasks||[]).filter(x=>String(x.id)!==String(id));closeModal();render();toast('Projekt-Task gelöscht.');}catch(error){toast(error.message||String(error));}},'Projekt-Task löschen');
      },0);
      return r;
    };
    window.openProjectTaskDetailModalRev047=openProjectTaskDetailModalRev047;
  }
  const style=document.createElement('style');
  style.textContent=`
    .timeline-step-row,.timeline-settings-btn,#timelineSettingsRev50,#timelineStepSelectRev49{display:none!important;}
    .timeline-field-stack-rev62{display:grid;grid-template-columns:1fr;gap:6px;margin:8px 0 6px 0;}
    .timeline-field-stack-rev62 label{font-size:12px;color:var(--muted);font-weight:900;}
    .timeline-field-stack-rev62 input{width:100%;height:40px;background:#050a16;border:1px solid var(--line);border-radius:12px;color:var(--text);padding:9px;}
    body.light .timeline-field-stack-rev62 input{background:#fff;border-color:#cbd6e7;color:#152033;}
    .modal-actions{display:flex!important;align-items:center!important;gap:10px!important;}
    .rev62-delete-left{margin-right:auto!important;padding:0!important;display:inline-flex!important;align-items:center!important;justify-content:center!important;border-radius:12px!important;}
    .rev62-delete-left svg{width:22px!important;height:22px!important;stroke:currentColor!important;}
    body.sharp-corners .rev62-delete-left{border-radius:0!important;}
  `;
  document.head.appendChild(style);
  const oldRender62=window.render||render;
  window.render=render=function(){const r=oldRender62();rev62EnsureState();renderSidebarTimelineRev050();setTimeout(rev62RemoveDeleteIfForbidden,0);return r;};
  const observer=new MutationObserver(()=>{rev62RemoveDeleteIfForbidden();});
  setTimeout(()=>{rev62EnsureState();renderSidebarTimelineRev050();const modal=document.querySelector('#modalBackdrop');if(modal)observer.observe(modal,{childList:true,subtree:true,attributes:true,attributeFilter:['style','class']});},200);
})();

/* Rev 063: AppState-Protokoll vollständig für Anzeige-/Zeitstrahl-Einstellungen */
(function(){
  const REV63_DEFAULTS={
    vacationHighlight:{enabled:false,color:'#f97316',opacity:0.18},
    todayHighlight:{borderWidth:4,borderColor:'#0284c7',opacity:0.18},
    outlineStyle:'current',
    outlineCustomColor:'#64748b',
    timelineStep:30,
    timelinePauseMinutes:0,
    workStartTime:'08:00',
    timelineDayOffset:0
  };
  const isHex=v=>/^#[0-9a-f]{6}$/i.test(String(v||''));
  const clamp=(v,min,max,fb)=>{v=Number(v);return Number.isFinite(v)?Math.max(min,Math.min(max,v)):fb;};
  function normHHMM(v){return /^\d{2}:\d{2}$/.test(String(v||''))?String(v):REV63_DEFAULTS.workStartTime;}
  function ensureRev63State(){
    if(!window.state && typeof state==='undefined')return;
    state.vacationHighlight=Object.assign({},REV63_DEFAULTS.vacationHighlight,state.vacationHighlight||{});
    state.todayHighlight=Object.assign({},REV63_DEFAULTS.todayHighlight,state.todayHighlight||{});
    state.vacationHighlight.color=isHex(state.vacationHighlight.color)?state.vacationHighlight.color:REV63_DEFAULTS.vacationHighlight.color;
    state.vacationHighlight.opacity=clamp(state.vacationHighlight.opacity,0.05,0.55,REV63_DEFAULTS.vacationHighlight.opacity);
    state.todayHighlight.borderColor=isHex(state.todayHighlight.borderColor)?state.todayHighlight.borderColor:REV63_DEFAULTS.todayHighlight.borderColor;
    state.todayHighlight.borderWidth=clamp(state.todayHighlight.borderWidth,1,10,REV63_DEFAULTS.todayHighlight.borderWidth);
    state.todayHighlight.opacity=clamp(state.todayHighlight.opacity,0,0.65,REV63_DEFAULTS.todayHighlight.opacity);
    state.outlineStyle=['current','none','gray','black','custom'].includes(state.outlineStyle)?state.outlineStyle:REV63_DEFAULTS.outlineStyle;
    state.outlineCustomColor=isHex(state.outlineCustomColor)?state.outlineCustomColor:REV63_DEFAULTS.outlineCustomColor;
    state.timelineStep=30;
    state.timelinePauseMinutes=Math.max(0,Number(state.timelinePauseMinutes||0));
    state.workStartTime=normHHMM(state.workStartTime);
    state.timelineDayOffset=Number(state.timelineDayOffset||0);
    state.fetchMode='proxy';
    state.proxyUrl=state.proxyUrl||DEFAULT_PROXY_URL;
  }

  const prevEnsure63=ensureSettings;
  ensureSettings=function(){prevEnsure63();ensureRev63State();};

  const oldUiStateOnly=uiStateOnly;
  uiStateOnly=function(){
    ensureRev63State();
    const ui=oldUiStateOnly?oldUiStateOnly():{};
    return Object.assign({},ui,{
      // Rev063: alle reinen Nutzer-/Anzeigeeinstellungen gehören explizit in app_state.
      vacationHighlight:JSON.parse(JSON.stringify(state.vacationHighlight)),
      todayHighlight:JSON.parse(JSON.stringify(state.todayHighlight)),
      outlineStyle:state.outlineStyle,
      outlineCustomColor:state.outlineCustomColor,
      timelineStep:30,
      timelinePauseMinutes:state.timelinePauseMinutes,
      workStartTime:state.workStartTime,
      timelineDayOffset:state.timelineDayOffset
    });
  };

  const oldApplyUiState=applyUiState;
  applyUiState=function(ui){
    if(oldApplyUiState)oldApplyUiState(ui);
    if(ui){
      if(ui.vacationHighlight!==undefined)state.vacationHighlight=Object.assign({},REV63_DEFAULTS.vacationHighlight,ui.vacationHighlight||{});
      if(ui.todayHighlight!==undefined)state.todayHighlight=Object.assign({},REV63_DEFAULTS.todayHighlight,ui.todayHighlight||{});
      if(ui.outlineStyle!==undefined)state.outlineStyle=ui.outlineStyle;
      if(ui.outlineCustomColor!==undefined)state.outlineCustomColor=ui.outlineCustomColor;
      if(ui.timelinePauseMinutes!==undefined)state.timelinePauseMinutes=Number(ui.timelinePauseMinutes||0);
      if(ui.workStartTime!==undefined)state.workStartTime=ui.workStartTime;
      if(ui.timelineDayOffset!==undefined)state.timelineDayOffset=Number(ui.timelineDayOffset||0);
    }
    ensureRev63State();
  };

  async function saveAppStateRev63(){
    ensureRev63State();
    try{localStorage.setItem(storeKey,JSON.stringify(uiStateOnly()));}catch(e){}
    if(currentUser){
      clearTimeout(cloudSaveTimer);
      const payload={user_id:currentUser.id,state:uiStateOnly(),updated_at:new Date().toISOString()};
      const {error}=await supabaseClient.from('app_state').upsert(payload,{onConflict:'user_id'});
      if(error){toast('App-State konnte nicht gespeichert werden: '+error.message);return false;}
      if(typeof setCloudStatus==='function')setCloudStatus('App-State gespeichert: '+new Date().toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'}),'ok');
    }
    return true;
  }

  // Globales Speichern wieder auf das UI-Protokoll legen, damit spätere Auto-Saves die neuen Felder nicht mehr aus app_state herauslöschen.
  saveStateToCloud=async function(){
    if(!currentUser)return setCloudStatus('Nicht angemeldet. Online-Speicherung nicht möglich.','bad');
    const ok=await saveAppStateRev63();
    if(ok && typeof scheduleRelationalSave==='function')scheduleRelationalSave();
  };

  const oldPersist63=persist;
  persist=function(){
    ensureRev63State();
    if(currentUser){try{localStorage.setItem(storeKey,JSON.stringify(uiStateOnly()));}catch(e){}}
    else{try{localStorage.removeItem(storeKey);}catch(e){}}
    if(cloudReady && currentUser && !suppressCloudSave){
      clearTimeout(cloudSaveTimer);
      cloudSaveTimer=setTimeout(saveStateToCloud,900);
    }
  };

  const oldLoad63=loadStateFromCloud;
  loadStateFromCloud=async function(){
    await oldLoad63();
    ensureRev63State();
    if(typeof applyAppearance==='function')applyAppearance();
    if(typeof renderSidebarTimelineRev050==='function')renderSidebarTimelineRev050();
  };

  const oldReload63=window.reloadDatabaseDataRev044||reloadDatabaseDataRev044;
  reloadDatabaseDataRev044=async function(){
    if(!requireLogin())return;
    // Schutz gegen Rücksetzen direkt nach Einstellungsänderung: aktuelle UI-Einstellungen zuerst in app_state schreiben, dann neu laden.
    await saveAppStateRev63();
    return oldReload63.apply(this,arguments);
  };
  window.reloadDatabaseDataRev044=reloadDatabaseDataRev044;

  // Falls der Reload-Button vor diesem Patch bereits gebunden wurde, erneut binden.
  setTimeout(()=>{
    ensureRev63State();
    const btn=document.querySelector('#reloadDbBtn');
    if(btn)btn.onclick=reloadDatabaseDataRev044;
    const settings=document.querySelector('#settingsBtn');
    if(settings && typeof openSyncSettingsModal==='function')settings.onclick=openSyncSettingsModal;
  },250);
})();

/* Rev 064: monolithischer Fix für erledigte Tasks, Monatsmodal-Papierkorb, Wochenenden/Urlaub, Projekt-Erledigt-Ansicht */
(function(){
  const COMPLETED_TABLE_REV64='completed_tasks';
  const REV64_WEEKEND_DEFAULT={enabled:false,color:'#e2e8f0',opacity:0.28};
  const esc=v=>escapeHtml(String(v??''));
  const isHex=v=>/^#[0-9a-f]{6}$/i.test(String(v||''));
  const clamp=(v,min,max,fb)=>{v=Number(v);return Number.isFinite(v)?Math.max(min,Math.min(max,v)):fb;};
  function isWeekend64(d){const day=new Date(d).getDay();return day===0||day===6;}
  function todayIso64(){return fmtDate(new Date());}
  function completedType64(c){return c.type==='long'?'Langfristig':(c.type==='project'?'Projekt-Task':'Tagestask');}
  function getCompletedList64(){state.completedTasksTable=Array.isArray(state.completedTasksTable)?state.completedTasksTable:[];return state.completedTasksTable;}
  function normalizeCompleted64(c){
    c.completedId=c.completedId||c.id||c.completed_id;
    c.originalTaskId=c.originalTaskId||c.original_task_id||null;
    c.type=c.type||c.task_type||'daily';
    c.title=c.title||'Ohne Titel';
    c.note=c.note||'';
    c.originalDate=c.originalDate||c.original_date||null;
    c.completedDate=c.completedDate||c.completed_date||todayIso64();
    c.originalGroupId=String(c.originalGroupId||c.original_group_id||'');
    c.originalGroupName=c.originalGroupName||c.original_group_name||'Unbekannte Gruppe';
    c.originalGroupColor=c.originalGroupColor||c.original_group_color||null;
    return c;
  }
  function ensureRev64State(){
    state.completedTasksTable=getCompletedList64().map(normalizeCompleted64);
    state.weekendHighlight=Object.assign({},REV64_WEEKEND_DEFAULT,state.weekendHighlight||{});
    state.weekendHighlight.enabled=!!state.weekendHighlight.enabled;
    state.weekendHighlight.color=isHex(state.weekendHighlight.color)?state.weekendHighlight.color:REV64_WEEKEND_DEFAULT.color;
    state.weekendHighlight.opacity=clamp(state.weekendHighlight.opacity,0.05,0.70,REV64_WEEKEND_DEFAULT.opacity);
  }
  function groupMatch64(list,id,name){
    id=String(id||''); name=String(name||'').trim().toLowerCase();
    return (list||[]).find(g=>String(g.id)===id) || (name?(list||[]).find(g=>String(g.name||'').trim().toLowerCase()===name):null) || null;
  }
  function currentGroup64(c){
    c=normalizeCompleted64(Object.assign({},c));
    if(c.type==='long')return groupMatch64(state.longColumns||[],c.originalGroupId,c.originalGroupName);
    if(c.type==='project')return groupMatch64(state.projects||[],c.originalGroupId,c.originalGroupName);
    return groupMatch64(state.taskColumns||[],c.originalGroupId,c.originalGroupName);
  }
  function groupExists64(c){return !!currentGroup64(c);}
  function completedColor64(c){
    const g=currentGroup64(c);
    return g?.color || c.originalGroupColor || (c.type==='long'?(state.colors?.long||defaultColors.long):(c.type==='project'?'#7c5cff':(state.colors?.task||defaultColors.task)));
  }
  function card64(c,opts={}){
    c=normalizeCompleted64(c);
    const missing=!groupExists64(c);
    const originalDate=c.originalDate?` · Ursprünglich: ${esc(c.originalDate)}`:'';
    const disabled=missing?' disabled':'';
    const title=missing?'Originalgruppe existiert nicht mehr':'Wieder öffnen';
    const deleteBtn=opts.noDelete?'':`<button class="kebab completed-delete56" data-delete-completed64="${esc(c.completedId)}" title="Erledigten Eintrag löschen">×</button>`;
    return `<div class="card task task-card-compact completed-task-card completed-table-card-rev64" data-completed-ref64="${esc(c.completedId)}" style="border-left-color:${esc(completedColor64(c))}!important"><div class="task-row"><input type="checkbox" checked${disabled} data-toggle-completed64="${esc(c.completedId)}" title="${esc(title)}"><div><span class="completed-title" title="${esc(c.title)}">${esc(shortText(c.title,34))}</span><span class="completed-meta">${esc(completedType64(c))} · Erledigt am ${esc(c.completedDate||'')} · Gruppe damals: ${esc(c.originalGroupName||'—')}${originalDate}${missing?' · Gruppe gelöscht':''}</span></div>${deleteBtn}</div></div>`;
  }
  function listForDay64(iso){return getCompletedList64().filter(c=>normalizeCompleted64(c).completedDate===iso);}
  function bindCompleted64(scope=document){
    scope.querySelectorAll('[data-toggle-completed64]').forEach(chk=>{
      chk.onclick=ev=>ev.stopPropagation();
      chk.onchange=async ev=>{ev.stopPropagation();if(!chk.checked)await reopen64(chk.dataset.toggleCompleted64,chk);};
    });
    scope.querySelectorAll('[data-delete-completed64]').forEach(btn=>{btn.onclick=ev=>{ev.stopPropagation();delete64(btn.dataset.deleteCompleted64);};});
    scope.querySelectorAll('[data-completed-ref64]').forEach(card=>{card.onclick=ev=>{if(ev.target.closest('input,button'))return;openDetail64(card.dataset.completedRef64);};});
  }
  async function updateDate64(id,date){
    const c=getCompletedList64().find(x=>String(normalizeCompleted64(x).completedId)===String(id));
    if(!c||!date)return;
    if(currentUser){
      const {error}=await supabaseClient.from(COMPLETED_TABLE_REV64).update({completed_date:date}).eq('user_id',currentUser.id).eq('id',id);
      if(error){toast('Erledigt-Datum konnte nicht gespeichert werden: '+error.message);return;}
    }
    c.completedDate=date; render(); toast('Erledigt-Datum geändert.');
  }
  async function delete64(id){
    if(!requireLogin())return;
    if(!confirm('Erledigten Eintrag endgültig löschen?'))return;
    const {error}=await supabaseClient.from(COMPLETED_TABLE_REV64).delete().eq('user_id',currentUser.id).eq('id',id);
    if(error){toast('Löschen fehlgeschlagen: '+error.message);return;}
    state.completedTasksTable=getCompletedList64().filter(x=>String(normalizeCompleted64(x).completedId)!==String(id));
    render();toast('Erledigter Eintrag gelöscht.');
  }
  async function reopen64(id,checkbox){
    if(!requireLogin()){if(checkbox)checkbox.checked=true;return;}
    const c=getCompletedList64().find(x=>String(normalizeCompleted64(x).completedId)===String(id));
    if(!c){if(checkbox)checkbox.checked=true;return;}
    normalizeCompleted64(c);
    const g=currentGroup64(c);
    if(!g){if(checkbox)checkbox.checked=true;toast('Diese Gruppe existiert nicht mehr. Der Task kann nicht wieder geöffnet werden.');return;}
    try{
      const restoredId=isUuid(c.originalTaskId)?c.originalTaskId:crypto.randomUUID();
      if(c.type==='project'){
        const row={id:restoredId,user_id:currentUser.id,project_id:g.id,title:c.title||'Ohne Titel',note:c.note||null,due_date:c.originalDate||null,done:false,completed_date:null,sort_order:(state.projectTasks||[]).length};
        const {data,error}=await supabaseClient.from('project_tasks').upsert(row,{onConflict:'id'}).select('*').single();if(error)throw error;
        state.projectTasks=state.projectTasks||[];state.projectTasks.push({id:data.id,projectId:data.project_id,title:data.title,note:data.note||'',dueDate:data.due_date||'',done:false,completedDate:null,sortOrder:data.sort_order||0,createdAt:data.created_at,updatedAt:data.updated_at});
      }else if(c.type==='long'){
        const row={id:restoredId,user_id:currentUser.id,long_task_group_id:g.id,title:c.title||'Ohne Titel',note:c.note||null,done:false,completed_date:null,position:(state.longterm||[]).length};
        const {data,error}=await supabaseClient.from('long_tasks').upsert(row,{onConflict:'id'}).select('*').single();if(error)throw error;
        state.longterm=state.longterm||[];state.longterm.push({id:data.id,title:data.title,note:data.note||'',done:false,completedDate:null,columnId:data.long_task_group_id,createdDate:fmtDate(new Date()),position:data.position||0});
      }else{
        const row={id:restoredId,user_id:currentUser.id,task_group_id:g.id,title:c.title||'Ohne Titel',note:c.note||null,task_date:c.originalDate||todayIso64(),done:false,completed_date:null,position:(state.tasks||[]).length};
        const {data,error}=await supabaseClient.from('tasks').upsert(row,{onConflict:'id'}).select('*').single();if(error)throw error;
        state.tasks=state.tasks||[];state.tasks.push({id:data.id,title:data.title,note:data.note||'',date:data.task_date,done:false,completedDate:null,columnId:data.task_group_id,position:data.position||0});
      }
      const {error:delError}=await supabaseClient.from(COMPLETED_TABLE_REV64).delete().eq('user_id',currentUser.id).eq('id',id);if(delError)throw delError;
      state.completedTasksTable=getCompletedList64().filter(x=>String(normalizeCompleted64(x).completedId)!==String(id));
      render();toast('Task wieder geöffnet.');
    }catch(error){if(checkbox)checkbox.checked=true;toast('Wieder öffnen fehlgeschlagen: '+(error.message||String(error)));}
  }
  function openDetail64(id){
    const c=getCompletedList64().find(x=>String(normalizeCompleted64(x).completedId)===String(id));if(!c)return;normalizeCompleted64(c);
    const exists=groupExists64(c);
    $('#modalTitle').textContent='Erledigter Task · Details';
    $('#modalContent').innerHTML=`<div class="event-detail-grid"><b>Titel</b><div>${esc(c.title||'—')}</div><b>Typ</b><div>${esc(completedType64(c))}</div><b>Erledigt am</b><div><input id="rev64CompletedDate" type="date" value="${esc(c.completedDate||todayIso64())}"></div><b>Ursprüngliches Datum</b><div>${esc(c.originalDate||'—')}</div><b>Damals in Gruppe/Projekt</b><div>${esc(c.originalGroupName||'—')}</div><b>Status</b><div>${exists?'Originalgruppe existiert noch. Wiederöffnen ist möglich.':'Originalgruppe existiert nicht mehr. Wiederöffnen ist gesperrt.'}</div><b>Notiz</b><div>${c.note?`<div class="detail-long expanded">${esc(c.note)}</div>`:'—'}</div></div>`;
    $('#modalBackdrop').style.display='flex';
    const save=$('#saveModal');save.style.display='';
    save.onclick=async()=>{await updateDate64(id,$('#rev64CompletedDate').value||c.completedDate);closeModal();};
  }
  function rebuildCompletedPartition64(node,date){
    ensureRev64State();
    const iso=fmtDate(date);
    node.querySelectorAll('.partition').forEach(p=>{const title=p.querySelector('.part-title,summary');if(title&&title.textContent.includes('An diesem Tag erledigte Tasks'))p.remove();});
    node.querySelectorAll('.completed-table-grid-rev54,.completed-table-grid-rev64').forEach(el=>el.remove());
    const list=listForDay64(iso);
    if(!list.length)return;
    const body=node.querySelector('.day-body'); if(!body)return;
    body.insertAdjacentHTML('beforeend',`<div class="partition rev64-completed-partition"><details class="completed-collapse rev64-completed-collapse"><summary>An diesem Tag erledigte Tasks <span class="rev64-completed-count">${list.length}</span></summary><div class="completed-collapse-body"><div class="completed-grid completed-table-grid-rev64">${list.map(c=>card64(c)).join('')}</div></div></details></div>`);
    bindCompleted64(body.lastElementChild);
  }
  function decorateWeekendAndVacation64(node,date){
    const weekend=isWeekend64(date);
    node.classList.toggle('rev64-weekend-day',weekend && state.weekendHighlight?.enabled);
    if(weekend){node.classList.remove('vacation-day-rev52');}
  }
  const oldEnsure64=ensureSettings;
  ensureSettings=function(){oldEnsure64();ensureRev64State();};
  const oldUi64=typeof uiStateOnly==='function'?uiStateOnly:null;
  if(oldUi64){uiStateOnly=function(){ensureRev64State();return Object.assign({},oldUi64(),{weekendHighlight:JSON.parse(JSON.stringify(state.weekendHighlight))});};}
  const oldApplyUi64=typeof applyUiState==='function'?applyUiState:null;
  if(oldApplyUi64){applyUiState=function(ui){oldApplyUi64(ui);if(ui&&ui.weekendHighlight!==undefined)state.weekendHighlight=Object.assign({},REV64_WEEKEND_DEFAULT,ui.weekendHighlight||{});ensureRev64State();};}
  const oldApplyAppearance64=applyAppearance;
  applyAppearance=function(){oldApplyAppearance64();ensureRev64State();document.documentElement.style.setProperty('--rev64WeekendColor',state.weekendHighlight.color);document.documentElement.style.setProperty('--rev64WeekendOpacityPercent',Math.round(state.weekendHighlight.opacity*100)+'%');};

  const oldDayCard64=dayCard;
  dayCard=function(date){
    const node=oldDayCard64(date);
    decorateWeekendAndVacation64(node,date);
    rebuildCompletedPartition64(node,date);
    bindCompleted64(node);
    return node;
  };

  function cleanupModalActions64(){
    const title=document.querySelector('#modalTitle')?.textContent||'';
    if(title.includes('Monatsübersicht')||title.includes('Einstellungen')||title.includes('Legende')||title.includes('Cloud')){
      document.querySelectorAll('.modal-actions .rev62-delete-left,.modal-actions .own-delete-square56,.modal-actions .rev57-trash-left,.modal-actions .rev58-own-trash,.modal-actions #rev58DeleteOwnEvent,.modal-actions #deleteOwnFromEditRev51,.modal-actions #deleteModeBtnAction').forEach(x=>x.remove());
    }
  }
  const oldOpenMonth64=openMonthModal;
  openMonthModal=function(){const r=oldOpenMonth64.apply(this,arguments);setTimeout(()=>{cleanupModalActions64();decorateMonth64();},0);setTimeout(cleanupModalActions64,80);return r;};
  window.openMonthModal=openMonthModal;

  function decorateMonth64(){
    ensureRev64State();
    document.querySelectorAll('[data-month-date]').forEach(cell=>{
      const d=new Date(cell.dataset.monthDate+'T00:00:00');
      const weekend=isWeekend64(d);
      cell.classList.toggle('rev64-weekend-cell',weekend && state.weekendHighlight.enabled);
      if(weekend){cell.classList.remove('vacation-day-rev52');}
    });
  }
  const oldRenderMonth64=window.renderMonthView||renderMonthView;
  window.renderMonthView=renderMonthView=function(){const r=oldRenderMonth64.apply(this,arguments);decorateMonth64();cleanupModalActions64();return r;};

  function injectWeekendSettings64(){
    const root=document.querySelector('#modalContent');if(!root||document.querySelector('#rev64WeekendCard'))return;
    const card=document.createElement('div');
    card.id='rev64WeekendCard';card.className='rev64-settings-card';
    card.innerHTML=`<div class="rev64-settings-title">Wochenenden</div><label class="settings-check-rev53"><span><b>Wochenenden anders anzeigen</b><small>Samstag/Sonntag erhalten eine eigene Farbe. Urlaub wird an Wochenenden nicht zusätzlich hervorgehoben.</small></span><input id="rev64WeekendEnabled" type="checkbox" ${state.weekendHighlight.enabled?'checked':''}></label><div class="rev64-color-line"><label>Wochenendfarbe</label><input id="rev64WeekendColor" type="color" value="${esc(state.weekendHighlight.color)}"><label>Deckkraft</label><input id="rev64WeekendOpacity" type="range" min="5" max="70" value="${Math.round(state.weekendHighlight.opacity*100)}"></div>`;
    root.appendChild(card);
  }
  function readWeekendSettings64(){
    const en=document.querySelector('#rev64WeekendEnabled');if(!en)return;
    state.weekendHighlight.enabled=!!en.checked;
    const col=document.querySelector('#rev64WeekendColor')?.value;if(isHex(col))state.weekendHighlight.color=col;
    state.weekendHighlight.opacity=clamp((Number(document.querySelector('#rev64WeekendOpacity')?.value||28)/100),0.05,0.70,0.28);
  }
  const oldSettings64=window.openSyncSettingsModal||openSyncSettingsModal;
  window.openSyncSettingsModal=openSyncSettingsModal=function(){
    const r=oldSettings64.apply(this,arguments);
    setTimeout(()=>{
      ensureRev64State();injectWeekendSettings64();cleanupModalActions64();
      const save=document.querySelector('#saveModal');
      if(save&&!save.dataset.rev64WeekendBound){const old=save.onclick;save.dataset.rev64WeekendBound='1';save.onclick=async function(ev){readWeekendSettings64();if(old)await old.call(this,ev);else{closeModal();render();}};}
    },20);
    setTimeout(injectWeekendSettings64,160);
    return r;
  };

  const oldProjectOverview64=window.openProjectOverviewModalRev49;
  if(oldProjectOverview64){
    window.openProjectOverviewModalRev49=function(projectId){
      const r=oldProjectOverview64.apply(this,arguments);
      setTimeout(()=>{
        const p=(state.projects||[]).find(x=>String(x.id)===String(projectId));if(!p)return;
        const list=getCompletedList64().map(normalizeCompleted64).filter(c=>c.type==='project'&&(String(c.originalGroupId)===String(p.id)||String(c.originalGroupName||'').trim().toLowerCase()===String(p.name||'').trim().toLowerCase()));
        if(!list.length)return;
        const sections=Array.from(document.querySelectorAll('#modalContent .project-overview-section'));
        let doneSec=sections.find(s=>(s.querySelector('h3')?.textContent||'').toLowerCase().includes('erledigt'));
        if(!doneSec){const grid=document.querySelector('#modalContent .project-overview-grid');if(grid){grid.insertAdjacentHTML('beforeend','<section class="project-overview-section"><h3>Erledigt</h3></section>');doneSec=grid.lastElementChild;}}
        if(doneSec){
          doneSec.querySelectorAll('.completed-table-card-rev64').forEach(x=>x.remove());
          const empty=doneSec.querySelector('.empty');if(empty&&list.length)empty.remove();
          doneSec.insertAdjacentHTML('beforeend',`<div class="completed-grid completed-table-grid-rev64">${list.map(c=>card64(c,{noDelete:true})).join('')}</div>`);
          bindCompleted64(doneSec);
        }
      },0);
      return r;
    };
  }

  const style=document.createElement('style');
  style.textContent=`
    .rev64-completed-partition{border-top:1px solid rgba(49,64,94,.55)!important;padding-top:4px!important;}
    .rev64-completed-collapse summary{cursor:pointer;list-style:none;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:var(--text);font-weight:1000;display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 0;}
    .rev64-completed-collapse summary::-webkit-details-marker{display:none;}
    .rev64-completed-collapse summary::after{content:'▸';font-size:15px;font-weight:1000;}
    .rev64-completed-collapse[open] summary::after{content:'▾';}
    .rev64-completed-count{font-size:12px;letter-spacing:0;text-transform:none;color:var(--muted);margin-left:auto;}
    .completed-table-card-rev64 input[disabled]{opacity:.35;cursor:not-allowed;}
    .rev64-weekend-day{background:linear-gradient(0deg,color-mix(in srgb,var(--rev64WeekendColor) var(--rev64WeekendOpacityPercent),transparent),color-mix(in srgb,var(--rev64WeekendColor) var(--rev64WeekendOpacityPercent),transparent)),#0b1221!important;}
    body.light .rev64-weekend-day{background:linear-gradient(0deg,color-mix(in srgb,var(--rev64WeekendColor) var(--rev64WeekendOpacityPercent),transparent),color-mix(in srgb,var(--rev64WeekendColor) var(--rev64WeekendOpacityPercent),transparent)),#f8fbff!important;}
    .month-cell.rev64-weekend-cell{background:linear-gradient(0deg,color-mix(in srgb,var(--rev64WeekendColor) var(--rev64WeekendOpacityPercent),transparent),color-mix(in srgb,var(--rev64WeekendColor) var(--rev64WeekendOpacityPercent),transparent)),#070d1a!important;}
    body.light .month-cell.rev64-weekend-cell{background:linear-gradient(0deg,color-mix(in srgb,var(--rev64WeekendColor) var(--rev64WeekendOpacityPercent),transparent),color-mix(in srgb,var(--rev64WeekendColor) var(--rev64WeekendOpacityPercent),transparent)),#f8fbff!important;}
    .rev64-settings-card{border:1px solid #cbd5e1;border-radius:14px;padding:12px;background:#f8fafc;display:grid;gap:10px;color:#111827;margin-top:10px;}
    .rev64-settings-title{font-weight:1000;color:#111827;}
    .rev64-color-line{display:grid;grid-template-columns:minmax(130px,180px) minmax(0,1fr);gap:8px;align-items:center;}
    .rev64-color-line label{font-size:13px;font-weight:800;color:#111827;}
    .rev64-color-line input[type="color"]{height:38px;min-width:0;}
    @media(max-width:700px){.rev64-color-line{grid-template-columns:1fr;}}
  `;
  document.head.appendChild(style);

  const oldRender64=window.render||render;
  window.render=render=function(){const r=oldRender64();ensureRev64State();applyAppearance();setTimeout(()=>{document.querySelectorAll('.day').forEach(day=>{});cleanupModalActions64();},0);return r;};
  setTimeout(()=>{ensureRev64State();applyAppearance();cleanupModalActions64();},300);
})();

/* Rev 065: finaler Monolith-Fix: Task ohne Titel, Wochenendeinstellung, Urlaub nur Mo-Fr, Hinweise sichtbar */
(function(){
  const REV65_WEEKEND_DEFAULT={enabled:false,color:'#e2e8f0',opacity:0.28};
  const REV65_VAC_DEFAULT={enabled:false,color:'#f97316',opacity:0.18};
  const esc=v=>escapeHtml(String(v??''));
  const isHex=v=>/^#[0-9a-f]{6}$/i.test(String(v||''));
  const clamp=(v,min,max,fb)=>{v=Number(v);return Number.isFinite(v)?Math.max(min,Math.min(max,v)):fb;};
  const isWeekend65=d=>{const x=new Date(d).getDay();return x===0||x===6;};
  const todayIso65=()=>fmtDate(new Date());
  const settingsColors65=['#64748b','#000000','#ffffff','#0284c7','#7c5cff','#22c55e','#ffb020','#f97316','#ff5050','#ec4899','#14b8a6','#a855f7','#e2e8f0','#f8fafc'];

  function ensure65(){
    state.vacationHighlight=Object.assign({},REV65_VAC_DEFAULT,state.vacationHighlight||{});
    state.weekendHighlight=Object.assign({},REV65_WEEKEND_DEFAULT,state.weekendHighlight||{});
    state.vacationHighlight.enabled=!!state.vacationHighlight.enabled;
    state.weekendHighlight.enabled=!!state.weekendHighlight.enabled;
    state.vacationHighlight.color=isHex(state.vacationHighlight.color)?state.vacationHighlight.color:REV65_VAC_DEFAULT.color;
    state.weekendHighlight.color=isHex(state.weekendHighlight.color)?state.weekendHighlight.color:REV65_WEEKEND_DEFAULT.color;
    state.vacationHighlight.opacity=clamp(state.vacationHighlight.opacity,0.05,0.55,REV65_VAC_DEFAULT.opacity);
    state.weekendHighlight.opacity=clamp(state.weekendHighlight.opacity,0.05,0.70,REV65_WEEKEND_DEFAULT.opacity);
  }

  async function saveAppState65(){
    ensure65();
    try{localStorage.setItem(storeKey,JSON.stringify(stripRuntimeICSCache(state)));}catch(e){}
    try{persist();}catch(e){}
    if(currentUser){
      clearTimeout(cloudSaveTimer);
      const payload={user_id:currentUser.id,state:stripRuntimeICSCache(state),updated_at:new Date().toISOString()};
      const {error}=await supabaseClient.from('app_state').upsert(payload,{onConflict:'user_id'});
      if(error){toast('App-State konnte nicht gespeichert werden: '+error.message);return false;}
      if(typeof setCloudStatus==='function')setCloudStatus('App-State gespeichert: '+new Date().toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'}),'ok');
    }
    return true;
  }

  const prevEnsure65=ensureSettings;
  ensureSettings=function(){prevEnsure65();ensure65();};
  const prevApply65=applyAppearance;
  applyAppearance=function(){
    prevApply65();ensure65();
    document.documentElement.style.setProperty('--rev65WeekendColor',state.weekendHighlight.color);
    document.documentElement.style.setProperty('--rev65WeekendOpacityPercent',Math.round(state.weekendHighlight.opacity*100)+'%');
  };

  /* 1) Tagestask darf ohne Titel gespeichert werden. Wenn nur Notiz vorhanden ist, wird Titel = Aufgabe. Enter in der Notiz speichert. */
  window.openTaskModal=openTaskModal=function(date=fmtDate(new Date())){
    if(!requireLogin())return;
    ensureSettings();
    openModal('Tagestask hinzufügen',`<input id="mTitle" placeholder="Aufgabe"><select id="mTaskColumn">${state.taskColumns.map(c=>`<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`).join('')}</select><input id="mDate" type="date" value="${date}"><textarea id="mNote" rows="3" placeholder="Notiz / Kontext"></textarea><div class="hint">Ohne Titel wird der Task automatisch als „Aufgabe“ gespeichert. Enter speichert, Shift+Enter erzeugt in der Notiz einen Zeilenumbruch.</div>`,()=>{
      const note=($('#mNote')?.value||'').trim();
      const rawTitle=($('#mTitle')?.value||'').trim();
      const title=rawTitle||'Aufgabe';
      state.tasks.push({id:crypto.randomUUID(),title,date:$('#mDate').value||date,done:false,note,columnId:$('#mTaskColumn').value});
    });
    setTimeout(()=>{
      const note=$('#mNote');
      if(note&&!note.dataset.rev65EnterBound){
        note.dataset.rev65EnterBound='1';
        note.addEventListener('keydown',ev=>{if(ev.key==='Enter'&&!ev.shiftKey){ev.preventDefault();$('#saveModal')?.click();}});
      }
    },0);
  };

  function dayHasVacation65(day){
    try{
      if(!state.vacationHighlight?.enabled || isWeekend65(day))return false;
      return visibleCalendars().some(({cal})=>{
        const links=cal.links||[];
        return [...(cal.events||[]),...(cal.ownEvents||[])].some(e=>{
          const link=links.find(l=>l.id===e.icsId||l.id===e.sourceId); if(link&&link.visible===false)return false;
          const occ=eventOccurrenceForDate(e,day);
          return !!(occ&&occ.allDay&&String(occ.summary||'').trim().toLowerCase()==='urlaub');
        });
      });
    }catch(e){return false;}
  }
  function applyDayDecoration65(node,date){
    ensure65();
    const weekend=isWeekend65(date);
    node.classList.toggle('rev65-weekend-day',weekend&&state.weekendHighlight.enabled);
    if(weekend){node.classList.remove('vacation-day-rev52');}
    if(!weekend&&dayHasVacation65(date))node.classList.add('vacation-day-rev52');
  }
  const prevDayCard65=dayCard;
  dayCard=function(date){const node=prevDayCard65(date);applyDayDecoration65(node,date);return node;};

  function decorateMonth65(){
    ensure65();
    document.querySelectorAll('[data-month-date]').forEach(cell=>{
      const d=new Date(cell.dataset.monthDate+'T00:00:00');
      const weekend=isWeekend65(d);
      cell.classList.toggle('rev65-weekend-cell',weekend&&state.weekendHighlight.enabled);
      if(weekend){cell.classList.remove('vacation-day-rev52');}
      if(!weekend&&dayHasVacation65(d))cell.classList.add('vacation-day-rev52');
    });
  }
  const prevRenderMonth65=window.renderMonthView||renderMonthView;
  window.renderMonthView=renderMonthView=function(){const r=prevRenderMonth65.apply(this,arguments);decorateMonth65();return r;};
  const prevOpenMonth65=openMonthModal;
  window.openMonthModal=openMonthModal=function(){const r=prevOpenMonth65.apply(this,arguments);setTimeout(decorateMonth65,0);setTimeout(decorateMonth65,80);return r;};

  /* Zeitstrahl: Urlaub an Samstag/Sonntag nicht markieren; Wochenende kann eigene Farbe bekommen. */
  if(typeof renderSidebarTimelineRev050==='function'){
    const prevSidebarTimeline65=renderSidebarTimelineRev050;
    window.renderSidebarTimelineRev050=renderSidebarTimelineRev050=function(){
      const r=prevSidebarTimeline65.apply(this,arguments);
      setTimeout(()=>{
        const shown=addDays(new Date(new Date().setHours(0,0,0,0)),Number(state.timelineDayOffset||0));
        const wrap=document.querySelector('#sidebarDayTimelineRev049 .timeline-canvas-wrap');
        if(!wrap)return;
        if(isWeekend65(shown)){
          wrap.classList.remove('vacation-active');
          if(state.weekendHighlight?.enabled){
            wrap.classList.add('rev65-weekend-timeline');
          }
        }
      },0);
      return r;
    };
  }

  function colorButton65(id,color,label){return `<button type="button" class="btn small rev65-color-button" id="${id}" title="${esc(label)}"><span class="rev65-color-dot" style="background:${esc(color)}"></span>${iconColorBucket()}</button>`;}
  function palette65(id,current){return `<div class="rev65-palette" id="${id}">${settingsColors65.map(c=>`<button type="button" class="color-choice" data-rev65-color="${c}" style="background:${c}" title="${c}"></button>`).join('')}<input type="color" value="${esc(isHex(current)?current:'#64748b')}" data-rev65-input="1"></div>`;}
  function bindPalette65(id,cb){const p=document.querySelector('#'+id);if(!p)return;p.querySelectorAll('[data-rev65-color]').forEach(b=>b.onclick=()=>cb(b.dataset.rev65Color));const i=p.querySelector('[data-rev65-input]');if(i)i.oninput=()=>cb(i.value);}
  function togglePalette65(btn,pal){const b=document.querySelector('#'+btn),p=document.querySelector('#'+pal);if(b&&p)b.onclick=()=>p.classList.toggle('open');}
  function draft65(){ensure65();return JSON.parse(JSON.stringify({theme:state.theme,cornerStyle:state.cornerStyle,outlineStyle:state.outlineStyle||'current',outlineCustomColor:state.outlineCustomColor||'#64748b',vacationHighlight:state.vacationHighlight,weekendHighlight:state.weekendHighlight,todayHighlight:state.todayHighlight||{borderWidth:4,borderColor:'#0284c7',opacity:0.18},syncInterval:state.syncInterval??15}));}

  function openSettings65(){
    ensure65();
    const d=draft65();
    let active='general';
    $('#modalTitle').textContent='Allgemeine Einstellungen';
    $('#modalContent').innerHTML=`<div class="settings-layout-rev56 rev65-settings"><div class="settings-tabs-rev56"><button class="settings-tab-rev56 active" data-rev65-tab="general" type="button">Allgemein</button><button class="settings-tab-rev56" data-rev65-tab="sync" type="button">Synchronisierung</button><button class="settings-tab-rev56" data-rev65-tab="info" type="button">Hinweise</button></div><div id="settingsTabContentRev65" class="settings-tab-content-rev53"></div></div>`;
    $('#modalBackdrop').style.display='flex';$('#saveModal').style.display='';
    function readVisible(){
      const q=s=>document.querySelector(s);
      if(q('#mTheme65'))d.theme=q('#mTheme65').value;
      if(q('#mCornerStyle65'))d.cornerStyle=q('#mCornerStyle65').value;
      if(q('#mOutlineStyle65'))d.outlineStyle=q('#mOutlineStyle65').value;
      if(q('#mVacationEnabled65'))d.vacationHighlight.enabled=q('#mVacationEnabled65').checked;
      if(q('#mVacationOpacity65'))d.vacationHighlight.opacity=clamp(q('#mVacationOpacity65').value,0.05,0.55,0.18);
      if(q('#mWeekendEnabled65'))d.weekendHighlight.enabled=q('#mWeekendEnabled65').checked;
      if(q('#mWeekendOpacity65'))d.weekendHighlight.opacity=clamp(q('#mWeekendOpacity65').value,0.05,0.70,0.28);
      if(q('#mTodayBorderWidth65'))d.todayHighlight.borderWidth=clamp(q('#mTodayBorderWidth65').value,1,10,4);
      if(q('#mTodayOpacity65'))d.todayHighlight.opacity=clamp(q('#mTodayOpacity65').value,0,0.65,0.18);
      if(q('#mSyncInterval65'))d.syncInterval=Number(q('#mSyncInterval65').value);
    }
    function renderGeneral(){
      const root=$('#settingsTabContentRev65');if(!root)return;
      root.innerHTML=`<div class="settings-grid">
        <div class="rev65-card"><div class="rev65-card-title">Darstellung</div>
          <div class="rev65-row"><label>Erscheinung</label><select id="mTheme65"><option value="light">Hell</option><option value="dark">Dunkel</option></select></div>
          <div class="rev65-row"><label>Kanten</label><select id="mCornerStyle65"><option value="rounded">Abgerundet</option><option value="sharp">Eckig / 90°</option></select></div>
          <div class="rev65-row"><label>Konturfarbe</label><div class="rev65-inline"><select id="mOutlineStyle65"><option value="current">Wie aktuell</option><option value="none">Keine</option><option value="gray">Grau</option><option value="black">Schwarz</option><option value="custom">Farbpalette</option></select>${colorButton65('mOutlineColorBtn65',d.outlineCustomColor,'Konturfarbe wählen')}</div></div>
          ${palette65('mOutlinePalette65',d.outlineCustomColor)}
        </div>
        <div class="rev65-card"><label class="rev65-check"><span><b>Wochenenden anders anzeigen</b><small>Samstag und Sonntag erhalten eine eigene Hintergrundfarbe. Diese Markierung hat Vorrang vor Urlaub.</small></span><input id="mWeekendEnabled65" type="checkbox"></label>
          <div class="rev65-row"><label>Wochenendfarbe</label><div>${colorButton65('mWeekendColorBtn65',d.weekendHighlight.color,'Wochenendfarbe wählen')}</div></div>
          ${palette65('mWeekendPalette65',d.weekendHighlight.color)}
          <div class="rev65-row"><label>Deckkraft</label><input id="mWeekendOpacity65" type="range" min="0.05" max="0.70" step="0.01" value="${esc(d.weekendHighlight.opacity)}"></div>
        </div>
        <div class="rev65-card"><label class="rev65-check"><span><b>Urlaubstage anders anzeigen</b><small>Ganztägige Termine mit exakt dem Titel „Urlaub“ markieren den Tag nur von Montag bis Freitag. Samstag und Sonntag zählen als Wochenende und werden nicht als Urlaubstag eingefärbt.</small></span><input id="mVacationEnabled65" type="checkbox"></label>
          <div class="rev65-row"><label>Urlaubsfarbe</label><div>${colorButton65('mVacationColorBtn65',d.vacationHighlight.color,'Urlaubsfarbe wählen')}</div></div>
          ${palette65('mVacationPalette65',d.vacationHighlight.color)}
          <div class="rev65-row"><label>Deckkraft</label><input id="mVacationOpacity65" type="range" min="0.05" max="0.55" step="0.01" value="${esc(d.vacationHighlight.opacity)}"></div>
        </div>
        <div class="rev65-card"><div class="rev65-card-title">Aktueller Tag<small>Kontur und Füllung des heutigen Tages.</small></div>
          <div class="rev65-row"><label>Linienstärke</label><input id="mTodayBorderWidth65" type="range" min="1" max="10" step="1" value="${esc(d.todayHighlight.borderWidth)}"></div>
          <div class="rev65-row"><label>Linienfarbe</label><div>${colorButton65('mTodayBorderColorBtn65',d.todayHighlight.borderColor,'Linienfarbe wählen')}</div></div>
          ${palette65('mTodayBorderPalette65',d.todayHighlight.borderColor)}
          <div class="rev65-row"><label>Flächen-Deckkraft</label><input id="mTodayOpacity65" type="range" min="0" max="0.65" step="0.01" value="${esc(d.todayHighlight.opacity)}"></div>
        </div>
        <div class="hint">Speichern schreibt diese UI-Werte in den App-State. Fachliche Daten bleiben in ihren eigenen Tabellen.</div>
      </div>`;
      $('#mTheme65').value=d.theme||'light';$('#mCornerStyle65').value=d.cornerStyle||'rounded';$('#mOutlineStyle65').value=d.outlineStyle||'current';
      $('#mVacationEnabled65').checked=!!d.vacationHighlight.enabled;$('#mWeekendEnabled65').checked=!!d.weekendHighlight.enabled;
      togglePalette65('mOutlineColorBtn65','mOutlinePalette65');togglePalette65('mVacationColorBtn65','mVacationPalette65');togglePalette65('mWeekendColorBtn65','mWeekendPalette65');togglePalette65('mTodayBorderColorBtn65','mTodayBorderPalette65');
      bindPalette65('mOutlinePalette65',c=>{readVisible();d.outlineStyle='custom';d.outlineCustomColor=c;renderGeneral();});
      bindPalette65('mVacationPalette65',c=>{readVisible();d.vacationHighlight.color=c;renderGeneral();});
      bindPalette65('mWeekendPalette65',c=>{readVisible();d.weekendHighlight.color=c;renderGeneral();});
      bindPalette65('mTodayBorderPalette65',c=>{readVisible();d.todayHighlight.borderColor=c;renderGeneral();});
    }
    function renderSync(){
      const root=$('#settingsTabContentRev65');if(!root)return;
      root.innerHTML=`<div class="settings-grid"><div class="rev65-card"><div class="rev65-card-title">Synchronisierung</div><div class="rev65-row"><label>Intervall</label><select id="mSyncInterval65"><option value="0">Aus / manuell</option><option value="5">Alle 5 Min.</option><option value="15">Alle 15 Min.</option><option value="30">Alle 30 Min.</option><option value="60">Alle 60 Min.</option></select></div><div class="hint">Der obere grüne Reload-Button lädt Daten manuell neu.</div></div></div>`;
      $('#mSyncInterval65').value=String(d.syncInterval??15);
    }
    function renderInfo(){
      const root=$('#settingsTabContentRev65');if(!root)return;
      root.innerHTML=`<div class="settings-grid">
        <div class="security-note"><b>Urlaubslogik</b><br>Urlaub wird nur erkannt, wenn ein sichtbarer ganztägiger Termin exakt „Urlaub“ heißt. Samstag und Sonntag werden ausdrücklich ausgeschlossen und gelten immer als Wochenende.</div>
        <div class="security-note"><b>Wochenendlogik</b><br>Die Wochenendfarbe gilt für Samstag und Sonntag. Ist gleichzeitig ein Urlaubstermin eingetragen, bleibt die Wochenenddarstellung maßgeblich.</div>
        <div class="security-note"><b>Task ohne Titel</b><br>Wird beim Erstellen eines Tagestasks kein Titel eingetragen, speichert die App ihn automatisch unter „Aufgabe“. Notizen bleiben erhalten.</div>
        <div class="security-note"><b>Speicherprotokoll</b><br>Anzeigeparameter werden im <code>app_state</code> gespeichert. Tasks, Termine, Kalenderquellen und Projekte bleiben in ihren eigenen Tabellen.</div>
      </div>`;
    }
    function renderActive(){if(active==='general')renderGeneral();else if(active==='sync')renderSync();else renderInfo();}
    renderActive();
    document.querySelectorAll('[data-rev65-tab]').forEach(btn=>btn.onclick=()=>{readVisible();active=btn.dataset.rev65Tab;document.querySelectorAll('[data-rev65-tab]').forEach(b=>b.classList.toggle('active',b===btn));renderActive();});
    $('#saveModal').onclick=async()=>{
      readVisible();
      state.theme=d.theme||'light';state.cornerStyle=d.cornerStyle||'rounded';state.outlineStyle=d.outlineStyle||'current';state.outlineCustomColor=d.outlineCustomColor;
      state.vacationHighlight=Object.assign({},d.vacationHighlight);state.weekendHighlight=Object.assign({},d.weekendHighlight);state.todayHighlight=Object.assign({},d.todayHighlight);state.syncInterval=Number(d.syncInterval??15);
      ensure65();if(typeof setupAutoSync==='function')setupAutoSync();if(typeof applyAppearance==='function')applyAppearance();
      const ok=await saveAppState65();closeModal();render();toast(ok?'Einstellungen gespeichert.':'Einstellungen lokal übernommen, Cloud-Speicherung fehlgeschlagen.');
    };
    const cancel=$('#cancelModal'); if(cancel)cancel.style.display='';
  }

  window.openSyncSettingsModal=openSettings65;
  window.openSettingsRev56=openSettings65;
  setTimeout(()=>{const s=$('#settingsBtn');if(s)s.onclick=openSettings65;ensure65();applyAppearance();},100);

  const style=document.createElement('style');
  style.textContent=`
    .rev65-card{border:1px solid #cbd5e1;border-radius:14px;padding:12px;background:#f8fafc;display:grid;gap:10px;color:#111827;}
    .rev65-card-title{font-weight:1000;color:#111827;display:block;}.rev65-card-title small,.rev65-check small{display:block;color:#475569;font-weight:600;line-height:1.35;margin-top:3px;}
    .rev65-row{display:grid;grid-template-columns:minmax(145px,210px) minmax(0,1fr);gap:10px;align-items:center;}.rev65-row label{font-weight:800;color:#111827;font-size:13px;}.rev65-row input,.rev65-row select{min-width:0;}
    .rev65-inline{display:flex;gap:8px;align-items:center;}.rev65-check{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;align-items:center;}.rev65-check b{color:#111827;font-weight:1000;}
    .rev65-color-button{height:40px!important;min-width:46px!important;border-radius:12px!important;display:inline-flex!important;align-items:center!important;justify-content:center!important;gap:6px!important;}.rev65-color-dot{width:18px;height:18px;border-radius:6px;border:1px solid rgba(0,0,0,.25);display:inline-block;}
    .rev65-palette{display:none;grid-template-columns:repeat(auto-fill,minmax(34px,1fr));gap:8px;margin-top:8px;}.rev65-palette.open{display:grid;}.rev65-palette input[type="color"]{height:34px;padding:2px;border-radius:9px;}
    .rev65-weekend-day{background:linear-gradient(0deg,color-mix(in srgb,var(--rev65WeekendColor) var(--rev65WeekendOpacityPercent),transparent),color-mix(in srgb,var(--rev65WeekendColor) var(--rev65WeekendOpacityPercent),transparent)),#0b1221!important;}
    body.light .rev65-weekend-day{background:linear-gradient(0deg,color-mix(in srgb,var(--rev65WeekendColor) var(--rev65WeekendOpacityPercent),transparent),color-mix(in srgb,var(--rev65WeekendColor) var(--rev65WeekendOpacityPercent),transparent)),#f8fbff!important;}
    .month-cell.rev65-weekend-cell{background:linear-gradient(0deg,color-mix(in srgb,var(--rev65WeekendColor) var(--rev65WeekendOpacityPercent),transparent),color-mix(in srgb,var(--rev65WeekendColor) var(--rev65WeekendOpacityPercent),transparent)),#070d1a!important;}
    body.light .month-cell.rev65-weekend-cell{background:linear-gradient(0deg,color-mix(in srgb,var(--rev65WeekendColor) var(--rev65WeekendOpacityPercent),transparent),color-mix(in srgb,var(--rev65WeekendColor) var(--rev65WeekendOpacityPercent),transparent)),#f8fbff!important;}
    #sidebarDayTimelineRev049 .timeline-canvas-wrap.rev65-weekend-timeline{background:linear-gradient(0deg,color-mix(in srgb,var(--rev65WeekendColor) var(--rev65WeekendOpacityPercent),transparent),color-mix(in srgb,var(--rev65WeekendColor) var(--rev65WeekendOpacityPercent),transparent)),#050a16!important;}
    body.light #sidebarDayTimelineRev049 .timeline-canvas-wrap.rev65-weekend-timeline{background:linear-gradient(0deg,color-mix(in srgb,var(--rev65WeekendColor) var(--rev65WeekendOpacityPercent),transparent),color-mix(in srgb,var(--rev65WeekendColor) var(--rev65WeekendOpacityPercent),transparent)),#fff!important;}
    @media(max-width:700px){.rev65-row{grid-template-columns:1fr;gap:5px;}}
  `;
  document.head.appendChild(style);
})();

/* Rev 066: stabile Nachbesserung Monolith
   - Wochenendeinstellung vollständig in Settings
   - Urlaub nur Mo-Fr, Hinweistext ergänzt
   - Hinweise-Reiter mit Inhalt
   - Task-Erstellung ohne Titel für Tages-, Langzeit- und Projekt-Tasks
   - Enter speichert, Shift+Enter erzeugt Zeilenumbruch
   - alte Löschbuttons werden beim Modalwechsel konsequent entfernt
*/
(function(){
  const REV66_WEEKEND_DEFAULT={enabled:false,color:'#e2e8f0',opacity:0.28};
  const REV66_VAC_DEFAULT={enabled:false,color:'#f97316',opacity:0.18};
  const COLORS66=['#e2e8f0','#f8fafc','#cbd5e1','#64748b','#111827','#000000','#ffffff','#0284c7','#38bdf8','#7c5cff','#a855f7','#22c55e','#14b8a6','#ffb020','#f97316','#ff5050','#ec4899'];
  const esc66=v=>escapeHtml(String(v??''));
  const isHex66=v=>/^#[0-9a-f]{6}$/i.test(String(v||''));
  const clamp66=(v,min,max,fb)=>{v=Number(v);return Number.isFinite(v)?Math.max(min,Math.min(max,v)):fb;};
  const isWeekend66=d=>{const x=new Date(d).getDay();return x===0||x===6;}; // 0 = Sonntag, 6 = Samstag
  const defaultTitle66='Aufgabe';

  function ensure66(){
    state.vacationHighlight=Object.assign({},REV66_VAC_DEFAULT,state.vacationHighlight||{});
    state.weekendHighlight=Object.assign({},REV66_WEEKEND_DEFAULT,state.weekendHighlight||{});
    state.vacationHighlight.enabled=!!state.vacationHighlight.enabled;
    state.weekendHighlight.enabled=!!state.weekendHighlight.enabled;
    state.vacationHighlight.color=isHex66(state.vacationHighlight.color)?state.vacationHighlight.color:REV66_VAC_DEFAULT.color;
    state.weekendHighlight.color=isHex66(state.weekendHighlight.color)?state.weekendHighlight.color:REV66_WEEKEND_DEFAULT.color;
    state.vacationHighlight.opacity=clamp66(state.vacationHighlight.opacity,0.05,0.55,REV66_VAC_DEFAULT.opacity);
    state.weekendHighlight.opacity=clamp66(state.weekendHighlight.opacity,0.05,0.70,REV66_WEEKEND_DEFAULT.opacity);
  }

  const prevEnsure66=ensureSettings;
  ensureSettings=function(){prevEnsure66();ensure66();};

  const prevApply66=applyAppearance;
  applyAppearance=function(){
    prevApply66();ensure66();
    document.documentElement.style.setProperty('--rev66WeekendColor',state.weekendHighlight.color);
    document.documentElement.style.setProperty('--rev66WeekendOpacityPercent',Math.round(state.weekendHighlight.opacity*100)+'%');
    document.documentElement.style.setProperty('--rev66VacationColor',state.vacationHighlight.color);
    document.documentElement.style.setProperty('--rev66VacationOpacityPercent',Math.round(state.vacationHighlight.opacity*100)+'%');
  };

  function cleanModalDeleteButtons66(allowOwnDelete=false){
    const selectors=[
      '.modal-actions .rev62-delete-left','.modal-actions .rev61-trash-left','.modal-actions .rev58-own-trash',
      '.modal-actions .rev57-trash-left','.modal-actions .own-delete-square56','.modal-actions #rev58DeleteOwnEvent',
      '.modal-actions #deleteOwnFromEditRev51','.modal-actions #deleteOwnEvent','.modal-actions #deleteModeBtnAction',
      '.modal-actions .mode-delete-action','.modal-actions .rev66-stale-delete'
    ];
    document.querySelectorAll(selectors.join(',')).forEach(btn=>{
      if(allowOwnDelete && (btn.id==='deleteOwnFromEditRev51'||btn.id==='deleteOwnEvent'||btn.classList.contains('own-delete-square56')))return;
      btn.remove();
    });
    if(!allowOwnDelete){
      document.querySelectorAll('#modalContent #deleteOwnFromEditRev51,#modalContent #deleteOwnEvent').forEach(btn=>btn.remove());
    }
  }

  const prevOpenModal66=openModal;
  openModal=function(title,html,onSave){
    cleanModalDeleteButtons66(false);
    const wrapped=()=>{ cleanModalDeleteButtons66(false); return onSave&&onSave(); };
    const result=prevOpenModal66(title,html,wrapped);
    cleanModalDeleteButtons66(false);
    return result;
  };

  const prevCloseModal66=closeModal;
  closeModal=function(){cleanModalDeleteButtons66(false);return prevCloseModal66.apply(this,arguments);};

  function bindEnterSave66(rootSelector){
    setTimeout(()=>{
      const root=document.querySelector(rootSelector)||document.querySelector('#modalContent');
      if(!root)return;
      root.querySelectorAll('textarea,input,select').forEach(el=>{
        if(el.dataset.rev66EnterBound)return;
        el.dataset.rev66EnterBound='1';
        el.addEventListener('keydown',ev=>{
          if(ev.key!=='Enter')return;
          if(ev.shiftKey)return; // Shift+Enter bleibt Zeilenumbruch im Textfeld
          ev.preventDefault();
          document.querySelector('#saveModal')?.click();
        });
      });
    },0);
  }

  function titleOrFallback66(value){return String(value||'').trim()||defaultTitle66;}

  window.openTaskModal=openTaskModal=function(date=fmtDate(new Date())){
    if(!requireLogin())return;ensureSettings();
    openModal('Tagestask hinzufügen',`<input id="mTitle" placeholder="Aufgabe"><select id="mTaskColumn">${state.taskColumns.map(c=>`<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`).join('')}</select><input id="mDate" type="date" value="${date}"><textarea id="mNote" rows="3" placeholder="Notiz / Kontext"></textarea><div class="hint">Kein Titel nötig: Wenn nur eine Notiz eingetragen wird, speichert die App den Task als „Aufgabe“. Enter speichert. Shift+Enter erzeugt einen Zeilenumbruch.</div>`,()=>{
      const title=titleOrFallback66($('#mTitle')?.value);
      const note=($('#mNote')?.value||'').trim();
      state.tasks.push({id:crypto.randomUUID(),title,date:$('#mDate')?.value||date,done:false,note,columnId:$('#mTaskColumn')?.value});
    });
    bindEnterSave66('#modalContent');
  };

  window.openLongModal=openLongModal=function(){
    if(!requireLogin())return;
    if(typeof ensureRev033State==='function')ensureRev033State();
    const groups=state.longColumns&&state.longColumns.length?state.longColumns:[{id:'long_default',name:'Allgemein'}];
    openModal('Langfristigen Task hinzufügen',`<input id="mTitle" placeholder="Langfristiger Task"><select id="mLongColumn">${groups.map(c=>`<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`).join('')}</select><textarea id="mNote" rows="3" placeholder="Notiz"></textarea><div class="hint">Kein Titel nötig: Wenn nur eine Notiz eingetragen wird, speichert die App den Task als „Aufgabe“. Enter speichert. Shift+Enter erzeugt einen Zeilenumbruch.</div>`,async()=>{
      const title=titleOrFallback66($('#mTitle')?.value);
      const note=($('#mNote')?.value||'').trim();
      const selectedGroup=$('#mLongColumn')?.value||groups[0]?.id||'long_default';
      try{
        if(typeof insertLongTaskRev043==='function'){
          const saved=await insertLongTaskRev043({title,done:false,note,columnId:selectedGroup});
          state.longterm.push(saved);
        }else{
          state.longterm.push({id:crypto.randomUUID(),title,done:false,note,createdDate:fmtDate(new Date()),completedDate:null,columnId:selectedGroup});
        }
        render();toast('Langfristiger Task gespeichert.');
      }catch(error){toast('Langfristiger Task konnte nicht gespeichert werden: '+(error.message||error));}
    });
    bindEnterSave66('#modalContent');
  };

  window.openProjectTaskModalRev047=openProjectTaskModalRev047=function(projectId){
    if(!requireLogin())return;
    const p=typeof projectByIdRev047==='function'?projectByIdRev047(projectId):null;
    if(!p)return toast('Projekt nicht gefunden.');
    openModal(`Projekt-Task hinzufügen · ${escapeHtml(p.name)}`,`<input id="mProjectTaskTitle" placeholder="Aufgabe"><input id="mProjectTaskDue" type="date"><textarea id="mProjectTaskNote" rows="4" placeholder="Notiz / Kontext"></textarea><div class="hint">Kein Titel nötig: Wenn nur eine Notiz eingetragen wird, speichert die App den Projekt-Task als „Aufgabe“. Enter speichert. Shift+Enter erzeugt einen Zeilenumbruch.</div>`,async()=>{
      const title=titleOrFallback66($('#mProjectTaskTitle')?.value);
      const note=($('#mProjectTaskNote')?.value||'').trim();
      try{
        const saved=await insertProjectTaskRev047({projectId,title,dueDate:$('#mProjectTaskDue')?.value||null,note,done:false});
        state.projectTasks.push(saved);render();toast('Projekt-Task gespeichert.');
      }catch(error){toast('Projekt-Task konnte nicht gespeichert werden: '+(error.message||error));}
    });
    bindEnterSave66('#modalContent');
  };

  // Detail-Editor: leerer Titel wird ebenfalls auf „Aufgabe“ gesetzt, nicht auf alten Titel zurückgeworfen.
  if(typeof openProjectTaskDetailModalRev047==='function'){
    const prevProjectTaskDetail66=openProjectTaskDetailModalRev047;
    window.openProjectTaskDetailModalRev047=openProjectTaskDetailModalRev047=function(id){
      const r=prevProjectTaskDetail66.apply(this,arguments);
      setTimeout(()=>{
        bindEnterSave66('#modalContent');
        const save=document.querySelector('#saveModal');
        if(save && !save.dataset.rev66ProjectDetailPatch){
          save.dataset.rev66ProjectDetailPatch='1';
          const oldClick=save.onclick;
          save.onclick=async function(ev){
            const titleInput=document.querySelector('#editProjectTaskTitle');
            if(titleInput && !titleInput.value.trim())titleInput.value=defaultTitle66;
            return oldClick&&oldClick.call(this,ev);
          };
        }
      },0);
      return r;
    };
  }

  function allVisibleEventsForDay66(day){
    try{
      return visibleCalendars().flatMap(({cal})=>{
        const links=cal.links||[];
        const ics=(cal.events||[]).map(e=>eventOccurrenceForDate(e,day)).filter(e=>{
          if(!e)return false;const l=links.find(x=>x.id===e.icsId);return !l||l.visible!==false;
        });
        const own=(cal.ownEvents||[]).map(e=>eventOccurrenceForDate(e,day)).filter(e=>{
          if(!e)return false;const l=links.find(x=>x.id===e.sourceId);return !l||l.visible!==false;
        });
        return [...ics,...own];
      });
    }catch(e){return [];}
  }

  function dayHasVacation66(day){
    ensure66();
    if(!state.vacationHighlight.enabled)return false;
    if(isWeekend66(day))return false; // zentrale Bedingung: Samstag/Sonntag sind nie Urlaubshighlight
    return allVisibleEventsForDay66(day).some(e=>!!(e&&e.allDay&&String(e.summary||'').trim().toLowerCase()==='urlaub'));
  }

  function decorateDayNode66(node,date){
    ensure66();
    const weekend=isWeekend66(date);
    node.classList.toggle('rev66-weekend-day',!!(weekend&&state.weekendHighlight.enabled));
    node.classList.toggle('vacation-day-rev52',!!(!weekend&&dayHasVacation66(date)));
    node.classList.toggle('rev66-vacation-day',!!(!weekend&&dayHasVacation66(date)));
  }

  const prevDayCard66=dayCard;
  dayCard=function(date){
    const node=prevDayCard66(date);
    decorateDayNode66(node,date);
    cleanModalDeleteButtons66(false);
    return node;
  };

  function decorateMonth66(){
    ensure66();
    document.querySelectorAll('[data-month-date]').forEach(cell=>{
      const d=new Date(cell.dataset.monthDate+'T00:00:00');
      const weekend=isWeekend66(d);
      cell.classList.toggle('rev66-weekend-cell',!!(weekend&&state.weekendHighlight.enabled));
      cell.classList.toggle('vacation-day-rev52',!!(!weekend&&dayHasVacation66(d)));
      cell.classList.toggle('rev66-vacation-cell',!!(!weekend&&dayHasVacation66(d)));
    });
  }

  const prevRenderMonth66=window.renderMonthView||renderMonthView;
  window.renderMonthView=renderMonthView=function(){const r=prevRenderMonth66.apply(this,arguments);setTimeout(decorateMonth66,0);return r;};
  const prevOpenMonth66=window.openMonthModal||openMonthModal;
  window.openMonthModal=openMonthModal=function(){cleanModalDeleteButtons66(false);const r=prevOpenMonth66.apply(this,arguments);setTimeout(()=>{cleanModalDeleteButtons66(false);decorateMonth66();},0);return r;};

  // Kalendereinträge dürfen keine alten Task-Löschbuttons übernehmen.
  if(typeof openEventDetailModal==='function'){
    const prevEventDetail66=openEventDetailModal;
    window.openEventDetailModal=openEventDetailModal=function(ref){
      cleanModalDeleteButtons66(false);
      const r=prevEventDetail66.apply(this,arguments);
      const type=String(ref||'').split(':')[0];
      setTimeout(()=>{
        // Bei normalem ICS-Termin immer löschen; bei eigenem Termin nur die vom Event-Editor sauber erzeugten Controls zulassen.
        cleanModalDeleteButtons66(type==='own');
        const title=document.querySelector('#modalTitle')?.textContent||'';
        if(!/Eigenen Termin bearbeiten/i.test(title) && !/Eigener Termin/i.test(title))cleanModalDeleteButtons66(false);
      },0);
      return r;
    };
  }

  function colorButton66(id,color,label){return `<button type="button" class="btn small rev66-color-button" id="${id}" title="${esc66(label)}"><span class="rev66-color-dot" style="background:${esc66(color)}"></span>${iconPalette()}</button>`;}
  function palette66(id,current){return `<div class="rev66-palette" id="${id}">${COLORS66.map(c=>`<button type="button" class="color-choice" data-rev66-color="${c}" style="background:${c}" title="${c}"></button>`).join('')}<input type="color" value="${esc66(isHex66(current)?current:'#64748b')}" data-rev66-input="1"></div>`;}
  function bindPalette66(id,cb){const p=document.querySelector('#'+id);if(!p)return;p.querySelectorAll('[data-rev66-color]').forEach(b=>b.onclick=()=>cb(b.dataset.rev66Color));const i=p.querySelector('[data-rev66-input]');if(i)i.oninput=()=>cb(i.value);}
  function togglePalette66(btn,pal){const b=document.querySelector('#'+btn),p=document.querySelector('#'+pal);if(b&&p)b.onclick=()=>p.classList.toggle('open');}
  function draft66(){ensure66();return JSON.parse(JSON.stringify({theme:state.theme||'light',cornerStyle:state.cornerStyle||'rounded',outlineStyle:state.outlineStyle||'current',outlineCustomColor:state.outlineCustomColor||'#64748b',vacationHighlight:state.vacationHighlight,weekendHighlight:state.weekendHighlight,todayHighlight:state.todayHighlight||{borderWidth:4,borderColor:'#0284c7',opacity:0.18},syncInterval:state.syncInterval??15}));}

  async function saveAppState66(){
    ensure66();
    try{localStorage.setItem(storeKey,JSON.stringify(stripRuntimeICSCache(state)));}catch(e){}
    try{persist();}catch(e){}
    if(currentUser){
      try{
        clearTimeout(cloudSaveTimer);
        const payload={user_id:currentUser.id,state:stripRuntimeICSCache(state),updated_at:new Date().toISOString()};
        const {error}=await supabaseClient.from('app_state').upsert(payload,{onConflict:'user_id'});
        if(error){toast('App-State konnte nicht gespeichert werden: '+error.message);return false;}
        if(typeof setCloudStatus==='function')setCloudStatus('App-State gespeichert: '+new Date().toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'}),'ok');
      }catch(e){toast('App-State konnte nicht gespeichert werden: '+(e.message||e));return false;}
    }
    return true;
  }

  function openSettings66(){
    ensure66();cleanModalDeleteButtons66(false);
    const d=draft66();
    let active='general';
    document.querySelector('#modalTitle').textContent='Allgemeine Einstellungen';
    document.querySelector('#modalContent').innerHTML=`<div class="settings-layout-rev56 rev66-settings"><div class="settings-tabs-rev56"><button class="settings-tab-rev56 active" data-rev66-tab="general" type="button">Allgemein</button><button class="settings-tab-rev56" data-rev66-tab="sync" type="button">Synchronisierung</button><button class="settings-tab-rev56" data-rev66-tab="info" type="button">Hinweise</button></div><div id="settingsTabContentRev66" class="settings-tab-content-rev53"></div></div>`;
    document.querySelector('#modalBackdrop').style.display='flex';
    document.querySelector('#saveModal').style.display='';
    cleanModalDeleteButtons66(false);

    function readVisible(){
      const q=s=>document.querySelector(s);
      if(q('#mTheme66'))d.theme=q('#mTheme66').value;
      if(q('#mCornerStyle66'))d.cornerStyle=q('#mCornerStyle66').value;
      if(q('#mOutlineStyle66'))d.outlineStyle=q('#mOutlineStyle66').value;
      if(q('#mVacationEnabled66'))d.vacationHighlight.enabled=q('#mVacationEnabled66').checked;
      if(q('#mVacationOpacity66'))d.vacationHighlight.opacity=clamp66(q('#mVacationOpacity66').value,0.05,0.55,0.18);
      if(q('#mWeekendEnabled66'))d.weekendHighlight.enabled=q('#mWeekendEnabled66').checked;
      if(q('#mWeekendOpacity66'))d.weekendHighlight.opacity=clamp66(q('#mWeekendOpacity66').value,0.05,0.70,0.28);
      if(q('#mTodayBorderWidth66'))d.todayHighlight.borderWidth=clamp66(q('#mTodayBorderWidth66').value,1,10,4);
      if(q('#mTodayOpacity66'))d.todayHighlight.opacity=clamp66(q('#mTodayOpacity66').value,0,0.65,0.18);
      if(q('#mSyncInterval66'))d.syncInterval=Number(q('#mSyncInterval66').value);
    }
    function renderGeneral(){
      const root=document.querySelector('#settingsTabContentRev66');if(!root)return;
      root.innerHTML=`<div class="settings-grid">
        <div class="rev66-card"><div class="rev66-card-title">Darstellung</div>
          <div class="rev66-row"><label>Erscheinung</label><select id="mTheme66"><option value="light">Hell</option><option value="dark">Dunkel</option></select></div>
          <div class="rev66-row"><label>Kanten</label><select id="mCornerStyle66"><option value="rounded">Abgerundet</option><option value="sharp">Eckig / 90°</option></select></div>
          <div class="rev66-row"><label>Konturfarbe</label><div class="rev66-inline"><select id="mOutlineStyle66"><option value="current">Wie aktuell</option><option value="none">Keine</option><option value="gray">Grau</option><option value="black">Schwarz</option><option value="custom">Farbpalette</option></select>${colorButton66('mOutlineColorBtn66',d.outlineCustomColor,'Konturfarbe wählen')}</div></div>
          ${palette66('mOutlinePalette66',d.outlineCustomColor)}
        </div>
        <div class="rev66-card"><label class="rev66-check"><span><b>Wochenenden anders anzeigen</b><small>Samstag und Sonntag zählen als Wochenende. Bei aktivierter Option erhalten beide Tage eine eigene Hintergrundfarbe.</small></span><input id="mWeekendEnabled66" type="checkbox"></label>
          <div class="rev66-row"><label>Wochenendfarbe</label><div>${colorButton66('mWeekendColorBtn66',d.weekendHighlight.color,'Wochenendfarbe wählen')}</div></div>
          ${palette66('mWeekendPalette66',d.weekendHighlight.color)}
          <div class="rev66-row"><label>Deckkraft</label><input id="mWeekendOpacity66" type="range" min="0.05" max="0.70" step="0.01" value="${esc66(d.weekendHighlight.opacity)}"></div>
        </div>
        <div class="rev66-card"><label class="rev66-check"><span><b>Urlaubstage anders anzeigen</b><small>Wenn ein sichtbarer ICS- oder eigener Kalender einen ganztägigen Termin exakt mit dem Titel „Urlaub“ enthält, wird der gesamte Tag farblich hinterlegt. Bedingung: Der Tag darf kein Wochenendtag sein; Samstag und Sonntag sind ausgeschlossen.</small></span><input id="mVacationEnabled66" type="checkbox"></label>
          <div class="rev66-row"><label>Urlaubsfarbe</label><div>${colorButton66('mVacationColorBtn66',d.vacationHighlight.color,'Urlaubsfarbe wählen')}</div></div>
          ${palette66('mVacationPalette66',d.vacationHighlight.color)}
          <div class="rev66-row"><label>Deckkraft</label><input id="mVacationOpacity66" type="range" min="0.05" max="0.55" step="0.01" value="${esc66(d.vacationHighlight.opacity)}"></div>
        </div>
        <div class="rev66-card"><div class="rev66-card-title">Aktueller Tag<small>Kontur und Füllung des heutigen Tages.</small></div>
          <div class="rev66-row"><label>Linienstärke</label><input id="mTodayBorderWidth66" type="range" min="1" max="10" step="1" value="${esc66(d.todayHighlight.borderWidth)}"></div>
          <div class="rev66-row"><label>Linienfarbe</label><div>${colorButton66('mTodayBorderColorBtn66',d.todayHighlight.borderColor,'Linienfarbe wählen')}</div></div>
          ${palette66('mTodayBorderPalette66',d.todayHighlight.borderColor)}
          <div class="rev66-row"><label>Flächen-Deckkraft</label><input id="mTodayOpacity66" type="range" min="0" max="0.65" step="0.01" value="${esc66(d.todayHighlight.opacity)}"></div>
        </div>
      </div>`;
      document.querySelector('#mTheme66').value=d.theme||'light';
      document.querySelector('#mCornerStyle66').value=d.cornerStyle||'rounded';
      document.querySelector('#mOutlineStyle66').value=d.outlineStyle||'current';
      document.querySelector('#mVacationEnabled66').checked=!!d.vacationHighlight.enabled;
      document.querySelector('#mWeekendEnabled66').checked=!!d.weekendHighlight.enabled;
      togglePalette66('mOutlineColorBtn66','mOutlinePalette66');togglePalette66('mVacationColorBtn66','mVacationPalette66');togglePalette66('mWeekendColorBtn66','mWeekendPalette66');togglePalette66('mTodayBorderColorBtn66','mTodayBorderPalette66');
      bindPalette66('mOutlinePalette66',c=>{readVisible();d.outlineStyle='custom';d.outlineCustomColor=c;renderGeneral();});
      bindPalette66('mVacationPalette66',c=>{readVisible();d.vacationHighlight.color=c;renderGeneral();});
      bindPalette66('mWeekendPalette66',c=>{readVisible();d.weekendHighlight.color=c;renderGeneral();});
      bindPalette66('mTodayBorderPalette66',c=>{readVisible();d.todayHighlight.borderColor=c;renderGeneral();});
    }
    function renderSync(){
      const root=document.querySelector('#settingsTabContentRev66');if(!root)return;
      root.innerHTML=`<div class="settings-grid"><div class="rev66-card"><div class="rev66-card-title">Synchronisierung</div><div class="rev66-row"><label>Intervall</label><select id="mSyncInterval66"><option value="0">Aus / manuell</option><option value="5">Alle 5 Min.</option><option value="15">Alle 15 Min.</option><option value="30">Alle 30 Min.</option><option value="60">Alle 60 Min.</option></select></div><div class="hint">Der obere grüne Reload-Button lädt Daten manuell neu.</div></div></div>`;
      document.querySelector('#mSyncInterval66').value=String(d.syncInterval??15);
    }
    function renderInfo(){
      const root=document.querySelector('#settingsTabContentRev66');if(!root)return;
      root.innerHTML=`<div class="settings-grid">
        <div class="security-note"><b>Hinweise zur Urlaubslogik</b><br>Urlaub wird nur erkannt, wenn ein sichtbarer ICS- oder eigener Kalender einen ganztägigen Termin mit exakt dem Titel „Urlaub“ enthält. Samstag und Sonntag sind ausgeschlossen und werden nicht als Urlaubstag eingefärbt.</div>
        <div class="security-note"><b>Hinweise zur Wochenendlogik</b><br>Samstag und Sonntag zählen immer als Wochenende. Die Wochenendfarbe kann separat aktiviert, farblich gewählt und über die Deckkraft geregelt werden.</div>
        <div class="security-note"><b>Hinweise zur Task-Erstellung</b><br>Tagestasks, langfristige Tasks und Projekt-Tasks können ohne Titel gespeichert werden. Wenn nur eine Notiz vorhanden ist, wird automatisch „Aufgabe“ als Titel gesetzt. Enter speichert, Shift+Enter erzeugt einen Zeilenumbruch.</div>
        <div class="security-note"><b>Hinweise zum Modalwechsel</b><br>Beim Öffnen eines Kalendertermins werden alte Task-Löschaktionen entfernt, damit nicht versehentlich ein vorher angeklickter Task gelöscht wird.</div>
        <div class="security-note"><b>Speicherlogik</b><br>Darstellungsoptionen werden im App-State gespeichert. Fachliche Daten wie Kalenderquellen, Termine, Tasks und Projekte bleiben in ihren eigenen Tabellen.</div>
      </div>`;
    }
    function renderActive(){if(active==='general')renderGeneral();else if(active==='sync')renderSync();else renderInfo();}
    renderActive();
    document.querySelectorAll('[data-rev66-tab]').forEach(btn=>btn.onclick=()=>{readVisible();active=btn.dataset.rev66Tab;document.querySelectorAll('[data-rev66-tab]').forEach(b=>b.classList.toggle('active',b===btn));renderActive();});
    document.querySelector('#saveModal').onclick=async()=>{
      readVisible();
      state.theme=d.theme||'light';state.cornerStyle=d.cornerStyle||'rounded';state.outlineStyle=d.outlineStyle||'current';state.outlineCustomColor=d.outlineCustomColor;
      state.vacationHighlight=Object.assign({},REV66_VAC_DEFAULT,d.vacationHighlight||{});
      state.weekendHighlight=Object.assign({},REV66_WEEKEND_DEFAULT,d.weekendHighlight||{});
      state.todayHighlight=Object.assign({},d.todayHighlight||{});
      state.syncInterval=Number(d.syncInterval??15);
      ensure66();if(typeof setupAutoSync==='function')setupAutoSync();if(typeof applyAppearance==='function')applyAppearance();
      const ok=await saveAppState66();closeModal();render();toast(ok?'Einstellungen gespeichert.':'Einstellungen lokal übernommen, Cloud-Speicherung fehlgeschlagen.');
    };
    document.querySelector('#cancelModal').style.display='';
  }

  window.openSyncSettingsModal=openSyncSettingsModal=openSettings66;
  setTimeout(()=>{const b=document.querySelector('#settingsBtn');if(b)b.onclick=openSettings66;ensure66();applyAppearance();cleanModalDeleteButtons66(false);},50);
  setTimeout(()=>{const b=document.querySelector('#settingsBtn');if(b)b.onclick=openSettings66;},600);

  const css=document.createElement('style');
  css.textContent=`
    .rev66-card{border:1px solid #cbd5e1;border-radius:14px;padding:12px;background:#f8fafc;display:grid;gap:10px;color:#111827;}
    .rev66-card-title{font-weight:1000;color:#111827;display:block;}.rev66-card-title small,.rev66-check small{display:block;color:#475569;font-weight:600;line-height:1.35;margin-top:3px;}
    .rev66-row{display:grid;grid-template-columns:minmax(145px,220px) minmax(0,1fr);gap:10px;align-items:center;}.rev66-row label{font-weight:800;color:#111827;font-size:13px;}.rev66-row input,.rev66-row select{min-width:0;}
    .rev66-inline{display:flex;gap:8px;align-items:center;}.rev66-check{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;align-items:center;}.rev66-check b{color:#111827;font-weight:1000;}
    .rev66-color-button{height:40px!important;min-width:46px!important;border-radius:12px!important;display:inline-flex!important;align-items:center!important;justify-content:center!important;gap:6px!important;}.rev66-color-dot{width:18px;height:18px;border-radius:6px;border:1px solid rgba(0,0,0,.25);display:inline-block;}
    .rev66-palette{display:none;grid-template-columns:repeat(auto-fill,minmax(34px,1fr));gap:8px;margin-top:8px;}.rev66-palette.open{display:grid;}.rev66-palette input[type="color"]{height:34px;padding:2px;border-radius:9px;}
    .rev66-weekend-day{background:linear-gradient(0deg,color-mix(in srgb,var(--rev66WeekendColor) var(--rev66WeekendOpacityPercent),transparent),color-mix(in srgb,var(--rev66WeekendColor) var(--rev66WeekendOpacityPercent),transparent)),#0b1221!important;}
    body.light .rev66-weekend-day{background:linear-gradient(0deg,color-mix(in srgb,var(--rev66WeekendColor) var(--rev66WeekendOpacityPercent),transparent),color-mix(in srgb,var(--rev66WeekendColor) var(--rev66WeekendOpacityPercent),transparent)),#f8fbff!important;}
    .month-cell.rev66-weekend-cell{background:linear-gradient(0deg,color-mix(in srgb,var(--rev66WeekendColor) var(--rev66WeekendOpacityPercent),transparent),color-mix(in srgb,var(--rev66WeekendColor) var(--rev66WeekendOpacityPercent),transparent)),#070d1a!important;}
    body.light .month-cell.rev66-weekend-cell{background:linear-gradient(0deg,color-mix(in srgb,var(--rev66WeekendColor) var(--rev66WeekendOpacityPercent),transparent),color-mix(in srgb,var(--rev66WeekendColor) var(--rev66WeekendOpacityPercent),transparent)),#f8fbff!important;}
    .rev66-vacation-day{background:linear-gradient(0deg,color-mix(in srgb,var(--rev66VacationColor) var(--rev66VacationOpacityPercent),transparent),color-mix(in srgb,var(--rev66VacationColor) var(--rev66VacationOpacityPercent),transparent)),#0b1221!important;}
    body.light .rev66-vacation-day{background:linear-gradient(0deg,color-mix(in srgb,var(--rev66VacationColor) var(--rev66VacationOpacityPercent),transparent),color-mix(in srgb,var(--rev66VacationColor) var(--rev66VacationOpacityPercent),transparent)),#f8fbff!important;}
    .month-cell.rev66-vacation-cell{background:linear-gradient(0deg,color-mix(in srgb,var(--rev66VacationColor) var(--rev66VacationOpacityPercent),transparent),color-mix(in srgb,var(--rev66VacationColor) var(--rev66VacationOpacityPercent),transparent)),#070d1a!important;}
    body.light .month-cell.rev66-vacation-cell{background:linear-gradient(0deg,color-mix(in srgb,var(--rev66VacationColor) var(--rev66VacationOpacityPercent),transparent),color-mix(in srgb,var(--rev66VacationColor) var(--rev66VacationOpacityPercent),transparent)),#f8fbff!important;}
    .modal-actions .rev66-hidden-stale-delete{display:none!important;}
    @media(max-width:700px){.rev66-row{grid-template-columns:1fr;gap:5px;}}
  `;
  document.head.appendChild(css);
})();

/* Rev 068: finaler Override - Wochenendeinstellungen sichtbar, Hinweise sichtbar, Task-Enter-Logik, sichere Modal-Löschbuttons */
(function(){
  const REV68_WEEKEND={enabled:false,color:'#e2e8f0',opacity:0.28};
  const REV68_VAC={enabled:false,color:'#f97316',opacity:0.18};
  const REV68_TODAY={borderWidth:4,borderColor:'#0284c7',opacity:0.18};
  const colors68=['#64748b','#000000','#ffffff','#0284c7','#7c5cff','#22c55e','#ffb020','#f97316','#ff5050','#ec4899','#14b8a6','#a855f7','#e2e8f0','#f8fafc','#fde68a','#fed7aa'];
  const isHex68=v=>/^#[0-9a-f]{6}$/i.test(String(v||''));
  const clamp68=(v,min,max,fb)=>{v=Number(v);return Number.isFinite(v)?Math.max(min,Math.min(max,v)):fb;};
  const esc68=v=>escapeHtml(String(v??''));
  const isWeekend68=d=>{const x=new Date(d).getDay();return x===0||x===6;};
  function ensure68(){
    state.vacationHighlight=Object.assign({},REV68_VAC,state.vacationHighlight||{});
    state.weekendHighlight=Object.assign({},REV68_WEEKEND,state.weekendHighlight||{});
    state.todayHighlight=Object.assign({},REV68_TODAY,state.todayHighlight||{});
    state.vacationHighlight.enabled=!!state.vacationHighlight.enabled;
    state.weekendHighlight.enabled=!!state.weekendHighlight.enabled;
    state.vacationHighlight.color=isHex68(state.vacationHighlight.color)?state.vacationHighlight.color:REV68_VAC.color;
    state.weekendHighlight.color=isHex68(state.weekendHighlight.color)?state.weekendHighlight.color:REV68_WEEKEND.color;
    state.todayHighlight.borderColor=isHex68(state.todayHighlight.borderColor)?state.todayHighlight.borderColor:REV68_TODAY.borderColor;
    state.vacationHighlight.opacity=clamp68(state.vacationHighlight.opacity,0.05,0.55,REV68_VAC.opacity);
    state.weekendHighlight.opacity=clamp68(state.weekendHighlight.opacity,0.05,0.70,REV68_WEEKEND.opacity);
    state.todayHighlight.borderWidth=clamp68(state.todayHighlight.borderWidth,1,10,REV68_TODAY.borderWidth);
    state.todayHighlight.opacity=clamp68(state.todayHighlight.opacity,0,0.65,REV68_TODAY.opacity);
  }
  function setVars68(){
    ensure68();
    document.documentElement.style.setProperty('--rev68WeekendColor',state.weekendHighlight.color);
    document.documentElement.style.setProperty('--rev68WeekendOpacityPercent',Math.round(state.weekendHighlight.opacity*100)+'%');
    document.documentElement.style.setProperty('--rev68VacationColor',state.vacationHighlight.color);
    document.documentElement.style.setProperty('--rev68VacationOpacityPercent',Math.round(state.vacationHighlight.opacity*100)+'%');
  }
  const prevEnsure68=ensureSettings;
  ensureSettings=function(){prevEnsure68();ensure68();};
  const prevApply68=applyAppearance;
  applyAppearance=function(){prevApply68();setVars68();};

  // app_state enthält ab dieser Revision auch die Wochenend-Einstellungen.
  const oldUiStateOnly68=typeof uiStateOnly==='function'?uiStateOnly:null;
  if(oldUiStateOnly68){
    uiStateOnly=function(){
      ensure68();
      const ui=oldUiStateOnly68();
      return Object.assign({},ui,{
        weekendHighlight:JSON.parse(JSON.stringify(state.weekendHighlight)),
        vacationHighlight:JSON.parse(JSON.stringify(state.vacationHighlight)),
        todayHighlight:JSON.parse(JSON.stringify(state.todayHighlight)),
        outlineStyle:state.outlineStyle,
        outlineCustomColor:state.outlineCustomColor,
        theme:state.theme,
        cornerStyle:state.cornerStyle,
        syncInterval:state.syncInterval
      });
    };
  }
  const oldApplyUiState68=typeof applyUiState==='function'?applyUiState:null;
  if(oldApplyUiState68){
    applyUiState=function(ui){
      oldApplyUiState68(ui);
      if(ui&&ui.weekendHighlight!==undefined)state.weekendHighlight=Object.assign({},REV68_WEEKEND,ui.weekendHighlight||{});
      ensure68();
    };
  }
  async function saveSettings68(){
    ensure68();
    try{localStorage.setItem(storeKey,JSON.stringify(typeof uiStateOnly==='function'?uiStateOnly():stripRuntimeICSCache(state)));}catch(e){}
    if(currentUser){
      clearTimeout(cloudSaveTimer);
      const payload={user_id:currentUser.id,state:(typeof uiStateOnly==='function'?uiStateOnly():stripRuntimeICSCache(state)),updated_at:new Date().toISOString()};
      const {error}=await supabaseClient.from('app_state').upsert(payload,{onConflict:'user_id'});
      if(error){toast('App-State konnte nicht gespeichert werden: '+error.message);return false;}
      if(typeof scheduleRelationalSave==='function')scheduleRelationalSave();
      if(typeof setCloudStatus==='function')setCloudStatus('App-State gespeichert: '+new Date().toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'}),'ok');
    }else{try{persist();}catch(e){}}
    return true;
  }

  function visibleEventsForVacation68(day){
    try{
      return visibleCalendars().flatMap(({cal})=>{
        const links=cal.links||[];
        return [...(cal.events||[]),...(cal.ownEvents||[])].filter(e=>{
          const link=links.find(l=>l.id===e.icsId||l.id===e.sourceId);
          if(link&&link.visible===false)return false;
          const occ=eventOccurrenceForDate(e,day);
          return occ&&occ.allDay&&String(occ.summary||'').trim().toLowerCase()==='urlaub';
        });
      });
    }catch(e){return [];}
  }
  function isVacationWeekday68(day){
    ensure68();
    if(!state.vacationHighlight.enabled)return false;
    if(isWeekend68(day))return false;
    return visibleEventsForVacation68(day).length>0;
  }
  function cleanInlineDecoration68(node){
    if(!node)return;
    node.classList.remove('vacation-day-rev52','rev64-weekend-day','rev65-weekend-day','rev66-weekend-day','rev66-vacation-day');
    node.classList.remove('rev64-weekend-cell','rev65-weekend-cell','rev66-weekend-cell','rev66-vacation-cell');
    const s=node.getAttribute('style')||'';
    if(/color-mix|linear-gradient|f97316|e2e8f0|rev6[456]/i.test(s))node.removeAttribute('style');
  }
  function decorateNode68(node,day,isMonth=false){
    if(!node)return;
    ensure68();setVars68();
    cleanInlineDecoration68(node);
    const weekend=isWeekend68(day);
    if(weekend&&state.weekendHighlight.enabled)node.classList.add(isMonth?'rev68-weekend-cell':'rev68-weekend-day');
    else if(!weekend&&isVacationWeekday68(day))node.classList.add(isMonth?'rev68-vacation-cell':'rev68-vacation-day');
  }
  function decorateAll68(){
    setVars68();
    document.querySelectorAll('[data-month-date]').forEach(cell=>decorateNode68(cell,new Date(cell.dataset.monthDate+'T00:00:00'),true));
    document.querySelectorAll('.day').forEach(day=>{
      const txt=day.querySelector('.day-title-date')?.textContent||'';
      const m=txt.match(/(\d{2})\.(\d{2})\.(\d{4})/);
      if(m){decorateNode68(day,new Date(`${m[3]}-${m[2]}-${m[1]}T00:00:00`),false);}
    });
    const shown=addDays(new Date(new Date().setHours(0,0,0,0)),Number(state.timelineDayOffset||0));
    const wrap=document.querySelector('#sidebarDayTimelineRev049 .timeline-canvas-wrap');
    if(wrap){cleanInlineDecoration68(wrap);if(isWeekend68(shown)&&state.weekendHighlight.enabled)wrap.classList.add('rev68-weekend-timeline');else if(isVacationWeekday68(shown))wrap.classList.add('rev68-vacation-timeline');}
  }
  const oldRender68=window.render||render;
  window.render=render=function(){const r=oldRender68.apply(this,arguments);setTimeout(decorateAll68,0);setTimeout(decorateAll68,120);return r;};
  const oldRenderMonth68=window.renderMonthView||renderMonthView;
  window.renderMonthView=renderMonthView=function(){const r=oldRenderMonth68.apply(this,arguments);setTimeout(decorateAll68,0);return r;};
  const oldDayCard68=window.dayCard||dayCard;
  window.dayCard=dayCard=function(date){const node=oldDayCard68.apply(this,arguments);decorateNode68(node,date,false);return node;};
  if(typeof renderSidebarTimelineRev050==='function'){
    const oldTimeline68=renderSidebarTimelineRev050;
    window.renderSidebarTimelineRev050=renderSidebarTimelineRev050=function(){const r=oldTimeline68.apply(this,arguments);setTimeout(decorateAll68,0);return r;};
  }

  function colorInput68(id,val){return `<input id="${id}" type="color" value="${esc68(val)}" style="height:38px;width:72px;padding:2px">`;}
  function openSettings68(){
    ensure68();
    const d=JSON.parse(JSON.stringify({theme:state.theme||'light',cornerStyle:state.cornerStyle||'rounded',outlineStyle:state.outlineStyle||'current',outlineCustomColor:state.outlineCustomColor||'#64748b',vacationHighlight:state.vacationHighlight,weekendHighlight:state.weekendHighlight,todayHighlight:state.todayHighlight,syncInterval:state.syncInterval??15}));
    let active='general';
    $('#modalTitle').textContent='Allgemeine Einstellungen';
    $('#modalContent').innerHTML=`<div class="rev68-settings"><div class="rev68-tabs"><button class="rev68-tab active" data-tab68="general" type="button">Allgemein</button><button class="rev68-tab" data-tab68="sync" type="button">Synchronisierung</button><button class="rev68-tab" data-tab68="info" type="button">Hinweise</button></div><div id="settingsTabContentRev68" class="rev68-content"></div></div>`;
    $('#modalBackdrop').style.display='flex';$('#saveModal').style.display='';$('#cancelModal').style.display='';
    function readVisible(){
      if($('#mTheme68'))d.theme=$('#mTheme68').value;
      if($('#mCornerStyle68'))d.cornerStyle=$('#mCornerStyle68').value;
      if($('#mOutlineStyle68'))d.outlineStyle=$('#mOutlineStyle68').value;
      if($('#mOutlineColor68'))d.outlineCustomColor=$('#mOutlineColor68').value;
      if($('#mWeekendEnabled68'))d.weekendHighlight.enabled=$('#mWeekendEnabled68').checked;
      if($('#mWeekendColor68'))d.weekendHighlight.color=$('#mWeekendColor68').value;
      if($('#mWeekendOpacity68'))d.weekendHighlight.opacity=clamp68($('#mWeekendOpacity68').value,0.05,0.70,REV68_WEEKEND.opacity);
      if($('#mVacationEnabled68'))d.vacationHighlight.enabled=$('#mVacationEnabled68').checked;
      if($('#mVacationColor68'))d.vacationHighlight.color=$('#mVacationColor68').value;
      if($('#mVacationOpacity68'))d.vacationHighlight.opacity=clamp68($('#mVacationOpacity68').value,0.05,0.55,REV68_VAC.opacity);
      if($('#mTodayWidth68'))d.todayHighlight.borderWidth=clamp68($('#mTodayWidth68').value,1,10,REV68_TODAY.borderWidth);
      if($('#mTodayColor68'))d.todayHighlight.borderColor=$('#mTodayColor68').value;
      if($('#mTodayOpacity68'))d.todayHighlight.opacity=clamp68($('#mTodayOpacity68').value,0,0.65,REV68_TODAY.opacity);
      if($('#mSyncInterval68'))d.syncInterval=Number($('#mSyncInterval68').value);
    }
    function renderGeneral(){
      const root=$('#settingsTabContentRev68');if(!root)return;
      root.innerHTML=`<div class="rev68-grid">
        <section class="rev68-card"><h3>Darstellung</h3>
          <div class="rev68-row"><label>Erscheinung</label><select id="mTheme68"><option value="light">Hell</option><option value="dark">Dunkel</option></select></div>
          <div class="rev68-row"><label>Kanten</label><select id="mCornerStyle68"><option value="rounded">Abgerundet</option><option value="sharp">Eckig / 90°</option></select></div>
          <div class="rev68-row"><label>Konturfarbe</label><div class="rev68-inline"><select id="mOutlineStyle68"><option value="current">Wie aktuell</option><option value="none">Keine</option><option value="gray">Grau</option><option value="black">Schwarz</option><option value="custom">Eigene Farbe</option></select>${colorInput68('mOutlineColor68',d.outlineCustomColor)}</div></div>
          <p class="rev68-help">Die Konturfarbe gilt für größere Rahmen und Gruppenlinien.</p>
        </section>
        <section class="rev68-card"><label class="rev68-check"><span><b>Wochenendtage anders anzeigen</b><small>Samstag und Sonntag erhalten optional eine eigene Hintergrundfarbe.</small></span><input id="mWeekendEnabled68" type="checkbox"></label>
          <div class="rev68-row"><label>Wochenendfarbe</label>${colorInput68('mWeekendColor68',d.weekendHighlight.color)}</div>
          <div class="rev68-row"><label>Wochenend-Deckkraft</label><input id="mWeekendOpacity68" type="range" min="0.05" max="0.70" step="0.01" value="${esc68(d.weekendHighlight.opacity)}"></div>
        </section>
        <section class="rev68-card"><label class="rev68-check"><span><b>Urlaubstage anders anzeigen</b><small>Wenn ein sichtbarer ICS- oder eigener Kalender einen ganztägigen Termin exakt mit dem Titel „Urlaub“ enthält und der Tag kein Wochenendtag ist, wird der gesamte Tag farblich hinterlegt. Samstag und Sonntag zählen als Wochenende und werden nicht als Urlaubstag eingefärbt.</small></span><input id="mVacationEnabled68" type="checkbox"></label>
          <div class="rev68-row"><label>Urlaubsfarbe</label>${colorInput68('mVacationColor68',d.vacationHighlight.color)}</div>
          <div class="rev68-row"><label>Urlaubs-Deckkraft</label><input id="mVacationOpacity68" type="range" min="0.05" max="0.55" step="0.01" value="${esc68(d.vacationHighlight.opacity)}"></div>
        </section>
        <section class="rev68-card"><h3>Aktueller Tag <small>Kontur und Flächenfüllung des heutigen Tages.</small></h3>
          <div class="rev68-row"><label>Linienstärke</label><input id="mTodayWidth68" type="range" min="1" max="10" step="1" value="${esc68(d.todayHighlight.borderWidth)}"></div>
          <div class="rev68-row"><label>Linienfarbe</label>${colorInput68('mTodayColor68',d.todayHighlight.borderColor)}</div>
          <div class="rev68-row"><label>Flächen-Deckkraft</label><input id="mTodayOpacity68" type="range" min="0" max="0.65" step="0.01" value="${esc68(d.todayHighlight.opacity)}"></div>
        </section>
      </div>`;
      $('#mTheme68').value=d.theme;$('#mCornerStyle68').value=d.cornerStyle;$('#mOutlineStyle68').value=d.outlineStyle;
      $('#mWeekendEnabled68').checked=!!d.weekendHighlight.enabled;$('#mVacationEnabled68').checked=!!d.vacationHighlight.enabled;
    }
    function renderSync(){
      const root=$('#settingsTabContentRev68');if(!root)return;
      root.innerHTML=`<div class="rev68-grid"><section class="rev68-card"><h3>Synchronisierung</h3><div class="rev68-row"><label>Intervall</label><select id="mSyncInterval68"><option value="0">Aus / manuell</option><option value="5">Alle 5 Min.</option><option value="15">Alle 15 Min.</option><option value="30">Alle 30 Min.</option><option value="60">Alle 60 Min.</option></select></div><p class="rev68-help">Der grüne Reload-Button lädt Kalender- und Datenbankdaten manuell neu.</p></section></div>`;
      $('#mSyncInterval68').value=String(d.syncInterval??15);
    }
    function renderInfo(){
      const root=$('#settingsTabContentRev68');if(!root)return;
      root.innerHTML=`<div class="rev68-grid">
        <section class="rev68-card"><h3>Hinweise zur Wochenendlogik</h3><p>Samstag und Sonntag zählen immer als Wochenende. Die Wochenendmarkierung ist separat aktivierbar und besitzt eigene Farbe sowie eigene Deckkraft.</p></section>
        <section class="rev68-card"><h3>Hinweise zur Urlaubslogik</h3><p>Urlaub wird nur erkannt, wenn ein sichtbarer ICS- oder eigener Kalender einen ganztägigen Termin exakt mit dem Titel „Urlaub“ enthält. Samstag und Sonntag sind ausgeschlossen.</p></section>
        <section class="rev68-card"><h3>Hinweise zur Task-Erstellung</h3><p>Tagestasks, langfristige Tasks und Projekt-Tasks können ohne Titel gespeichert werden. Wenn kein Titel vorhanden ist, wird automatisch „Aufgabe“ gesetzt. Enter speichert, Shift+Enter erzeugt in Notizfeldern einen Zeilenumbruch.</p></section>
        <section class="rev68-card"><h3>Hinweise zur Löschlogik</h3><p>Beim Öffnen von Kalenderterminen und der Monatsübersicht werden alte Task-Löschaktionen entfernt. Dadurch kann kein zuvor geöffneter Task versehentlich gelöscht werden.</p></section>
      </div>`;
    }
    function renderActive(){if(active==='general')renderGeneral();else if(active==='sync')renderSync();else renderInfo();}
    renderActive();
    document.querySelectorAll('[data-tab68]').forEach(btn=>btn.onclick=()=>{readVisible();active=btn.dataset.tab68;document.querySelectorAll('[data-tab68]').forEach(b=>b.classList.toggle('active',b===btn));renderActive();});
    $('#saveModal').onclick=async()=>{
      readVisible();
      state.theme=d.theme;state.cornerStyle=d.cornerStyle;state.outlineStyle=d.outlineStyle;state.outlineCustomColor=d.outlineCustomColor;
      state.weekendHighlight=Object.assign({},REV68_WEEKEND,d.weekendHighlight||{});
      state.vacationHighlight=Object.assign({},REV68_VAC,d.vacationHighlight||{});
      state.todayHighlight=Object.assign({},REV68_TODAY,d.todayHighlight||{});
      state.syncInterval=Number(d.syncInterval??15);
      ensure68();applyAppearance();if(typeof setupAutoSync==='function')setupAutoSync();
      const ok=await saveSettings68();closeModal();render();toast(ok?'Einstellungen gespeichert.':'Einstellungen lokal übernommen, Cloud-Speicherung fehlgeschlagen.');
    };
    removeStaleDeletes68();
  }

  function bindEnterSave68(){
    const content=$('#modalContent');if(!content||content.dataset.rev68EnterBound)return;
    content.dataset.rev68EnterBound='1';
    content.addEventListener('keydown',ev=>{
      const title=($('#modalTitle')?.textContent||'').toLowerCase();
      const isTask=/tagestask|langfristigen task|langfristiger task|projekt-task/.test(title);
      if(!isTask)return;
      if(ev.key==='Enter'&&!ev.shiftKey){ev.preventDefault();ev.stopPropagation();$('#saveModal')?.click();}
    },true);
  }
  function normalizeTitle68(raw,note){raw=String(raw||'').trim();note=String(note||'').trim();return raw||'Aufgabe';}
  window.openTaskModal=openTaskModal=function(date=fmtDate(new Date())){
    if(!requireLogin())return;ensureSettings();
    openModal('Tagestask hinzufügen',`<input id="mTitle" placeholder="Aufgabe"><select id="mTaskColumn">${state.taskColumns.map(c=>`<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`).join('')}</select><input id="mDate" type="date" value="${date}"><textarea id="mNote" rows="3" placeholder="Notiz / Kontext"></textarea><div class="hint">Kein Titel nötig: Ohne Titel wird „Aufgabe“ gespeichert. Enter speichert, Shift+Enter erzeugt einen Zeilenumbruch.</div>`,()=>{
      const note=($('#mNote')?.value||'').trim();const title=normalizeTitle68($('#mTitle')?.value,note);
      state.tasks.push({id:crypto.randomUUID(),title,date:$('#mDate').value||date,done:false,note,columnId:$('#mTaskColumn').value});
    });
    setTimeout(bindEnterSave68,0);
  };
  window.openLongModal=openLongModal=function(){
    if(!requireLogin())return;
    openModal('Langfristigen Task hinzufügen',`<input id="mTitle" placeholder="Langfristiger Task"><textarea id="mNote" rows="3" placeholder="Notiz"></textarea><div class="hint">Kein Titel nötig: Ohne Titel wird „Aufgabe“ gespeichert. Enter speichert, Shift+Enter erzeugt einen Zeilenumbruch.</div>`,()=>{
      const note=($('#mNote')?.value||'').trim();const title=normalizeTitle68($('#mTitle')?.value,note);
      const col=(state.longColumns&&state.longColumns[0])?state.longColumns[0].id:undefined;
      state.longterm.push({id:crypto.randomUUID(),title,done:false,note,createdDate:fmtDate(new Date()),completedDate:null,columnId:col});
    });
    setTimeout(bindEnterSave68,0);
  };
  if(typeof openProjectTaskModalRev047==='function'){
    window.openProjectTaskModalRev047=openProjectTaskModalRev047=function(projectId){
      if(!requireLogin())return;ensureProjectsRev047();const p=state.projects.find(x=>x.id===projectId);if(!p)return;
      openModal(`Projekt-Task hinzufügen · ${escapeHtml(p.name)}`,`<input id="mProjectTaskTitle" placeholder="Aufgabe"><input id="mProjectTaskDue" type="date"><textarea id="mProjectTaskNote" rows="4" placeholder="Notiz / Kontext"></textarea><div class="hint">Kein Titel nötig: Ohne Titel wird „Aufgabe“ gespeichert. Enter speichert, Shift+Enter erzeugt einen Zeilenumbruch.</div>`,async()=>{
        const note=($('#mProjectTaskNote')?.value||'').trim();const title=normalizeTitle68($('#mProjectTaskTitle')?.value,note);
        try{const saved=await insertProjectTaskRev047({projectId,title,dueDate:$('#mProjectTaskDue').value,note,done:false});state.projectTasks.push(saved);render();toast('Projekt-Task gespeichert.');}catch(error){toast('Projekt-Task konnte nicht gespeichert werden: '+(error.message||error));}
      });
      setTimeout(bindEnterSave68,0);
    };
  }
  const oldTaskDetail68=window.openTaskDetailModal||openTaskDetailModal;
  window.openTaskDetailModal=openTaskDetailModal=function(ref){const r=oldTaskDetail68.apply(this,arguments);setTimeout(()=>{bindEnterSave68();const old=$('#saveModal')?.onclick;if(old){$('#saveModal').onclick=()=>{const tInput=$('#editTaskTitle');const nInput=$('#editTaskNote');if(tInput&&!tInput.value.trim())tInput.value='Aufgabe';old();};}},0);return r;};
  if(typeof openProjectTaskDetailModalRev047==='function'){
    const oldPTDetail68=openProjectTaskDetailModalRev047;
    window.openProjectTaskDetailModalRev047=openProjectTaskDetailModalRev047=function(id){const r=oldPTDetail68.apply(this,arguments);setTimeout(()=>{bindEnterSave68();const old=$('#saveModal')?.onclick;if(old){$('#saveModal').onclick=()=>{const tInput=$('#editProjectTaskTitle');if(tInput&&!tInput.value.trim())tInput.value='Aufgabe';old();};}},0);return r;};
  }

  function removeStaleDeletes68(){
    const title=($('#modalTitle')?.textContent||'').toLowerCase();
    const isOwnEvent=/eigenen termin bearbeiten/.test(title);
    const isTaskDetail=/tagestask bearbeiten|langfristigen task bearbeiten|projekt-task bearbeiten/.test(title);
    if(isOwnEvent||isTaskDetail)return;
    document.querySelectorAll('.modal-actions .rev62-delete-left,.modal-actions .rev61-trash-left,.modal-actions .rev58-own-trash,.modal-actions .rev57-trash-left,.modal-actions .own-delete-square56,.modal-actions #rev58DeleteOwnEvent,.modal-actions #deleteOwnFromEditRev51,.modal-actions #deleteOwnEvent,#modalContent #deleteOwnFromEditRev51,#modalContent #deleteOwnEvent,.modal-actions .rev68-delete-left').forEach(b=>b.remove());
  }
  const oldEventDetail68=window.openEventDetailModal||openEventDetailModal;
  window.openEventDetailModal=openEventDetailModal=function(ref){const r=oldEventDetail68.apply(this,arguments);setTimeout(()=>{const type=String(ref||'').split(':')[0];if(type!=='own')removeStaleDeletes68();},0);return r;};
  const oldMonthOpen68=window.openMonthModal||openMonthModal;
  window.openMonthModal=openMonthModal=function(){removeStaleDeletes68();const r=oldMonthOpen68.apply(this,arguments);setTimeout(()=>{removeStaleDeletes68();decorateAll68();},0);return r;};
  const observer68=new MutationObserver(()=>removeStaleDeletes68());
  setTimeout(()=>{const modal=$('#modalBackdrop');if(modal)observer68.observe(modal,{childList:true,subtree:true,attributes:true,attributeFilter:['style','class']});},200);

  const css=document.createElement('style');
  css.textContent=`
    .rev68-settings{display:grid;grid-template-columns:190px minmax(0,1fr);gap:14px;align-items:start;color:#111827!important;}
    .rev68-tabs{display:flex;flex-direction:column;gap:8px;}.rev68-tab{width:100%;text-align:left;background:#f3f4f6!important;border:1px solid #cbd6e7!important;color:#111827!important;border-radius:12px;padding:10px 12px;font-weight:900}.rev68-tab.active{background:#d1d5db!important;border-color:#9ca3af!important;color:#111827!important;}
    .rev68-grid{display:grid;gap:12px}.rev68-card{border:1px solid #cbd5e1;border-radius:14px;padding:12px;background:#f8fafc;display:grid;gap:10px;color:#111827!important}.rev68-card h3{margin:0;font-size:15px;color:#111827!important}.rev68-card p{margin:0;color:#334155;line-height:1.4}.rev68-card small,.rev68-help{display:block;color:#475569!important;font-size:12px;line-height:1.35;margin-top:3px}.rev68-row{display:grid;grid-template-columns:minmax(155px,230px) minmax(0,1fr);gap:10px;align-items:center}.rev68-row label{font-weight:800;color:#111827;font-size:13px}.rev68-row input,.rev68-row select{min-width:0}.rev68-inline{display:flex;gap:8px;align-items:center}.rev68-check{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;align-items:center}.rev68-check b{font-weight:1000;color:#111827!important}.rev68-check input[type="checkbox"]{width:20px;height:20px;accent-color:#0284c7}
    .rev68-weekend-day{background:linear-gradient(0deg,color-mix(in srgb,var(--rev68WeekendColor) var(--rev68WeekendOpacityPercent),transparent),color-mix(in srgb,var(--rev68WeekendColor) var(--rev68WeekendOpacityPercent),transparent)),#0b1221!important}.month-cell.rev68-weekend-cell{background:linear-gradient(0deg,color-mix(in srgb,var(--rev68WeekendColor) var(--rev68WeekendOpacityPercent),transparent),color-mix(in srgb,var(--rev68WeekendColor) var(--rev68WeekendOpacityPercent),transparent)),#070d1a!important}.rev68-vacation-day{background:linear-gradient(0deg,color-mix(in srgb,var(--rev68VacationColor) var(--rev68VacationOpacityPercent),transparent),color-mix(in srgb,var(--rev68VacationColor) var(--rev68VacationOpacityPercent),transparent)),#0b1221!important}.month-cell.rev68-vacation-cell{background:linear-gradient(0deg,color-mix(in srgb,var(--rev68VacationColor) var(--rev68VacationOpacityPercent),transparent),color-mix(in srgb,var(--rev68VacationColor) var(--rev68VacationOpacityPercent),transparent)),#070d1a!important}body.light .rev68-weekend-day,body.light .rev68-vacation-day{background-color:#f8fbff!important}body.light .month-cell.rev68-weekend-cell,body.light .month-cell.rev68-vacation-cell{background-color:#f8fbff!important}.rev68-weekend-timeline{background:linear-gradient(0deg,color-mix(in srgb,var(--rev68WeekendColor) var(--rev68WeekendOpacityPercent),transparent),color-mix(in srgb,var(--rev68WeekendColor) var(--rev68WeekendOpacityPercent),transparent)),#050a16!important}.rev68-vacation-timeline{background:linear-gradient(0deg,color-mix(in srgb,var(--rev68VacationColor) var(--rev68VacationOpacityPercent),transparent),color-mix(in srgb,var(--rev68VacationColor) var(--rev68VacationOpacityPercent),transparent)),#050a16!important}
    @media(max-width:760px){.rev68-settings{grid-template-columns:1fr}.rev68-tabs{flex-direction:row;flex-wrap:wrap}.rev68-tab{width:auto}.rev68-row{grid-template-columns:1fr;gap:5px}}
  `;
  document.head.appendChild(css);

  window.openSyncSettingsModal=openSyncSettingsModal=openSettings68;
  function bindSettings68(){const b=$('#settingsBtn');if(b)b.onclick=openSettings68;}
  bindSettings68();
  setTimeout(bindSettings68,100);setTimeout(bindSettings68,600);setTimeout(()=>{ensure68();setVars68();decorateAll68();},300);
})();


/* Rev 070: modulare Online-Revision
   - Urlaubstage: nur sichtbare ganztägige Termine mit exakt „Urlaub“, niemals Samstag/Sonntag
   - Wochenenden separat farblich/mit Deckkraft einstellbar
   - Hinweise-Reiter mit konkretem Inhalt
   - harter Datenbank-Speicherbutton für App-State + relationale Tabellen
   - Änderungen an bestehenden ICS-/eigenen Kalenderquellen werden sofort in calendar_sources gespeichert
   - eigene Termine, Tages-/Langzeit-/Projekt-Tasks können ohne Titel gespeichert werden
   - Enter speichert global im Modal, Shift+Enter erzeugt Zeilenumbruch in Textfeldern
*/
(function(){
  const REV70_DEFAULTS={
    vacationHighlight:{enabled:false,color:'#f97316',opacity:0.18},
    weekendHighlight:{enabled:false,color:'#e2e8f0',opacity:0.28},
    todayHighlight:{borderWidth:4,borderColor:'#0284c7',opacity:0.18},
    outlineStyle:'current',
    outlineCustomColor:'#64748b'
  };
  const esc=v=>escapeHtml(String(v??''));
  const isHex=v=>/^#[0-9a-f]{6}$/i.test(String(v||''));
  const clamp=(v,min,max,fb)=>{v=Number(v);return Number.isFinite(v)?Math.max(min,Math.min(max,v)):fb;};
  const isWeekend=d=>{const x=new Date(d).getDay();return x===0||x===6;};
  const fallbackTaskTitle='Aufgabe';
  const fallbackEventTitle='Termin';

  function ensure70(){
    state.vacationHighlight=Object.assign({},REV70_DEFAULTS.vacationHighlight,state.vacationHighlight||{});
    state.weekendHighlight=Object.assign({},REV70_DEFAULTS.weekendHighlight,state.weekendHighlight||{});
    state.todayHighlight=Object.assign({},REV70_DEFAULTS.todayHighlight,state.todayHighlight||{});
    state.vacationHighlight.enabled=!!state.vacationHighlight.enabled;
    state.weekendHighlight.enabled=!!state.weekendHighlight.enabled;
    state.vacationHighlight.color=isHex(state.vacationHighlight.color)?state.vacationHighlight.color:REV70_DEFAULTS.vacationHighlight.color;
    state.weekendHighlight.color=isHex(state.weekendHighlight.color)?state.weekendHighlight.color:REV70_DEFAULTS.weekendHighlight.color;
    state.todayHighlight.borderColor=isHex(state.todayHighlight.borderColor)?state.todayHighlight.borderColor:REV70_DEFAULTS.todayHighlight.borderColor;
    state.outlineCustomColor=isHex(state.outlineCustomColor)?state.outlineCustomColor:REV70_DEFAULTS.outlineCustomColor;
    state.vacationHighlight.opacity=clamp(state.vacationHighlight.opacity,0.05,0.55,REV70_DEFAULTS.vacationHighlight.opacity);
    state.weekendHighlight.opacity=clamp(state.weekendHighlight.opacity,0.05,0.70,REV70_DEFAULTS.weekendHighlight.opacity);
    state.todayHighlight.borderWidth=clamp(state.todayHighlight.borderWidth,1,10,REV70_DEFAULTS.todayHighlight.borderWidth);
    state.todayHighlight.opacity=clamp(state.todayHighlight.opacity,0,0.65,REV70_DEFAULTS.todayHighlight.opacity);
    state.outlineStyle=['current','none','gray','black','custom'].includes(state.outlineStyle)?state.outlineStyle:REV70_DEFAULTS.outlineStyle;
  }

  const prevEnsure=ensureSettings;
  ensureSettings=function(){prevEnsure();ensure70();};

  const prevApply=applyAppearance;
  applyAppearance=function(){
    prevApply();ensure70();
    document.documentElement.style.setProperty('--rev70WeekendColor',state.weekendHighlight.color);
    document.documentElement.style.setProperty('--rev70WeekendOpacityPercent',Math.round(state.weekendHighlight.opacity*100)+'%');
    document.documentElement.style.setProperty('--rev70VacationColor',state.vacationHighlight.color);
    document.documentElement.style.setProperty('--rev70VacationOpacityPercent',Math.round(state.vacationHighlight.opacity*100)+'%');
  };

  function visibleVacationEventOn(day){
    try{
      return visibleCalendars().some(({cal})=>{
        const links=cal.links||[];
        const all=[...(cal.events||[]),...(cal.ownEvents||[])];
        return all.some(e=>{
          const link=links.find(l=>l.id===e.icsId||l.id===e.sourceId);
          if(link&&link.visible===false)return false;
          const occ=eventOccurrenceForDate(e,day);
          return !!(occ&&occ.allDay&&String(occ.summary||occ.title||'').trim().toLowerCase()==='urlaub');
        });
      });
    }catch(e){return false;}
  }
  function isVacationDay70(day){ensure70();return !!(state.vacationHighlight.enabled&&!isWeekend(day)&&visibleVacationEventOn(day));}
  function clearOldDayClasses(node){
    if(!node)return;
    node.classList.remove('vacation-day-rev52','rev64-weekend-day','rev65-weekend-day','rev66-weekend-day','rev68-weekend-day','rev66-vacation-day','rev68-vacation-day','rev70-weekend-day','rev70-vacation-day');
    node.classList.remove('rev64-weekend-cell','rev65-weekend-cell','rev66-weekend-cell','rev68-weekend-cell','rev66-vacation-cell','rev68-vacation-cell','rev70-weekend-cell','rev70-vacation-cell');
    node.classList.remove('rev65-weekend-timeline','rev68-weekend-timeline','rev68-vacation-timeline','rev70-weekend-timeline','rev70-vacation-timeline','vacation-active');
  }
  function decorateNode70(node,day,isMonth=false){
    if(!node)return;ensure70();clearOldDayClasses(node);
    const weekend=isWeekend(day);
    if(weekend&&state.weekendHighlight.enabled)node.classList.add(isMonth?'rev70-weekend-cell':'rev70-weekend-day');
    if(!weekend&&isVacationDay70(day))node.classList.add(isMonth?'rev70-vacation-cell':'rev70-vacation-day');
  }
  function decorateAll70(){
    ensure70();
    document.querySelectorAll('[data-month-date]').forEach(cell=>decorateNode70(cell,new Date(cell.dataset.monthDate+'T00:00:00'),true));
    document.querySelectorAll('.day').forEach(day=>{
      const txt=day.querySelector('.day-title-date')?.textContent||'';
      const m=txt.match(/(\d{2})\.(\d{2})\.(\d{4})/);
      if(m)decorateNode70(day,new Date(`${m[3]}-${m[2]}-${m[1]}T00:00:00`),false);
    });
    const shown=addDays(new Date(new Date().setHours(0,0,0,0)),Number(state.timelineDayOffset||0));
    const wrap=document.querySelector('#sidebarDayTimelineRev049 .timeline-canvas-wrap');
    if(wrap){clearOldDayClasses(wrap);if(isWeekend(shown)&&state.weekendHighlight.enabled)wrap.classList.add('rev70-weekend-timeline');else if(isVacationDay70(shown))wrap.classList.add('rev70-vacation-timeline');}
  }

  const oldRender=window.render||render;
  window.render=render=function(){const r=oldRender.apply(this,arguments);setTimeout(decorateAll70,0);setTimeout(decorateAll70,160);return r;};
  const oldMonth=window.renderMonthView||renderMonthView;
  window.renderMonthView=renderMonthView=function(){const r=oldMonth.apply(this,arguments);setTimeout(decorateAll70,0);return r;};
  const oldDay=window.dayCard||dayCard;
  window.dayCard=dayCard=function(date){const node=oldDay.apply(this,arguments);decorateNode70(node,date,false);return node;};
  if(typeof renderSidebarTimelineRev050==='function'){
    const oldTl=renderSidebarTimelineRev050;
    window.renderSidebarTimelineRev050=renderSidebarTimelineRev050=function(){const r=oldTl.apply(this,arguments);setTimeout(decorateAll70,0);return r;};
  }

  function normalizeTitle(raw,fallback){return String(raw||'').trim()||fallback;}
  function bindModalEnter70(){
    const content=document.querySelector('#modalContent');if(!content||content.dataset.rev70EnterBound)return;
    content.dataset.rev70EnterBound='1';
    content.addEventListener('keydown',ev=>{
      if(ev.key!=='Enter')return;
      if(ev.shiftKey)return;
      ev.preventDefault();ev.stopPropagation();
      document.querySelector('#saveModal')?.click();
    },true);
  }
  const prevOpenModal70=openModal;
  openModal=function(title,html,onSave){
    const wrapped=()=>{return onSave&&onSave();};
    const result=prevOpenModal70(title,html,wrapped);
    setTimeout(bindModalEnter70,0);
    return result;
  };

  window.openTaskModal=openTaskModal=function(date=fmtDate(new Date())){
    if(!requireLogin())return;ensureSettings();
    openModal('Tagestask hinzufügen',`<input id="mTitle" placeholder="Aufgabe"><select id="mTaskColumn">${state.taskColumns.map(c=>`<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`).join('')}</select><input id="mDate" type="date" value="${date}"><textarea id="mNote" rows="3" placeholder="Notiz / Kontext"></textarea><div class="hint">Kein Titel nötig: Ohne Titel wird „Aufgabe“ gespeichert. Enter speichert. Shift+Enter erzeugt einen Zeilenumbruch.</div>`,()=>{
      const note=($('#mNote')?.value||'').trim();
      state.tasks.push({id:crypto.randomUUID(),title:normalizeTitle($('#mTitle')?.value,fallbackTaskTitle),date:$('#mDate')?.value||date,done:false,note,columnId:$('#mTaskColumn')?.value});
    });
  };
  window.openLongModal=openLongModal=function(){
    if(!requireLogin())return;ensureSettings();
    const groups=state.longColumns&&state.longColumns.length?state.longColumns:[{id:'long_default',name:'Allgemein'}];
    openModal('Langfristigen Task hinzufügen',`<input id="mTitle" placeholder="Langfristiger Task"><select id="mLongColumn">${groups.map(c=>`<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`).join('')}</select><textarea id="mNote" rows="3" placeholder="Notiz"></textarea><div class="hint">Kein Titel nötig: Ohne Titel wird „Aufgabe“ gespeichert. Enter speichert. Shift+Enter erzeugt einen Zeilenumbruch.</div>`,async()=>{
      const note=($('#mNote')?.value||'').trim();
      const selected=$('#mLongColumn')?.value||groups[0]?.id||'long_default';
      try{
        if(typeof insertLongTaskRev043==='function')state.longterm.push(await insertLongTaskRev043({title:normalizeTitle($('#mTitle')?.value,fallbackTaskTitle),done:false,note,columnId:selected}));
        else state.longterm.push({id:crypto.randomUUID(),title:normalizeTitle($('#mTitle')?.value,fallbackTaskTitle),done:false,note,createdDate:fmtDate(new Date()),completedDate:null,columnId:selected});
        render();toast('Langfristiger Task gespeichert.');
      }catch(error){toast('Langfristiger Task konnte nicht gespeichert werden: '+(error.message||error));}
    });
  };
  if(typeof openProjectTaskModalRev047==='function'){
    window.openProjectTaskModalRev047=openProjectTaskModalRev047=function(projectId){
      if(!requireLogin())return;if(typeof ensureProjectsRev047==='function')ensureProjectsRev047();
      const p=(state.projects||[]).find(x=>String(x.id)===String(projectId));if(!p)return toast('Projekt nicht gefunden.');
      openModal(`Projekt-Task hinzufügen · ${escapeHtml(p.name)}`,`<input id="mProjectTaskTitle" placeholder="Aufgabe"><input id="mProjectTaskDue" type="date"><textarea id="mProjectTaskNote" rows="4" placeholder="Notiz / Kontext"></textarea><div class="hint">Kein Titel nötig: Ohne Titel wird „Aufgabe“ gespeichert. Enter speichert. Shift+Enter erzeugt einen Zeilenumbruch.</div>`,async()=>{
        const note=($('#mProjectTaskNote')?.value||'').trim();
        try{const saved=await insertProjectTaskRev047({projectId,title:normalizeTitle($('#mProjectTaskTitle')?.value,fallbackTaskTitle),dueDate:$('#mProjectTaskDue')?.value||null,note,done:false});state.projectTasks.push(saved);render();toast('Projekt-Task gespeichert.');}
        catch(error){toast('Projekt-Task konnte nicht gespeichert werden: '+(error.message||error));}
      });
    };
  }
  window.openOwnEventModal=openOwnEventModal=function(pane,date=fmtDate(new Date())){
    if(!requireLogin())return;ensureSettings();
    const cal=state.calendars[pane];const ownSources=(cal?.links||[]).filter(l=>l.type==='own'&&l.visible!==false);
    if(!cal||!ownSources.length)return toast('Kein eigener Kalender sichtbar. Füge zuerst einen eigenen Kalender hinzu.');
    openModal(`Termin hinzufügen · ${escapeHtml(cal.name)}`,`<input id="mEventTitle" placeholder="Titel des Termins"><select id="mEventSource">${ownSources.map(l=>`<option value="${escapeHtml(l.id)}">${escapeHtml(l.name)}</option>`).join('')}</select><input id="mEventLocation" placeholder="Ort"><div class="field"><label>Datum</label><input id="mEventDate" type="date" value="${date}"></div><div class="field"><label>Wiederholung</label><select id="mEventRecurrence"><option value="none">Keine Wiederholung</option><option value="weekly">Wöchentlich</option><option value="monthly">Monatlich</option><option value="yearly">Jährlich</option></select></div><div class="field"><label>Ganztägig</label><select id="mEventAllDay"><option value="false">Nein</option><option value="true">Ja</option></select></div><div class="field"><label>Startzeit</label><input id="mEventStart" type="time" value="09:00"></div><div class="field"><label>Endzeit</label><input id="mEventEnd" type="time" value="10:00"></div><input id="mEventTravel" placeholder="Wegzeit, z. B. 20 Min."><textarea id="mEventDescription" rows="4" placeholder="Details / Notizen"></textarea><div class="hint">Kein Titel nötig: Ohne Titel wird „Termin“ gespeichert. Enter speichert. Shift+Enter erzeugt einen Zeilenumbruch.</div>`,async()=>{
      const sourceId=$('#mEventSource')?.value;const src=ownSources.find(l=>l.id===sourceId)||ownSources[0];
      const d=$('#mEventDate')?.value||date;const allDay=$('#mEventAllDay')?.value==='true';
      const st=$('#mEventStart')?.value||'00:00';const en=$('#mEventEnd')?.value||st;
      const start=allDay?new Date(d+'T00:00:00'):new Date(d+'T'+st+':00');
      const end=allDay?new Date(d+'T23:59:00'):new Date(d+'T'+en+':00');
      const event={id:crypto.randomUUID(),sourceId,summary:normalizeTitle($('#mEventTitle')?.value,fallbackEventTitle),location:$('#mEventLocation')?.value.trim()||'',start:start.toISOString(),end:end.toISOString(),allDay,recurrence:$('#mEventRecurrence')?.value||'none',source:src?.name||cal.name,icsName:src?.name||cal.name,icsColor:src?.color||state.colors.event,travelTime:$('#mEventTravel')?.value.trim()||'',description:$('#mEventDescription')?.value.trim()||'',manual:true,status:'active'};
      cal.ownEvents=cal.ownEvents||[];cal.ownEvents.push(event);
      if(currentUser&&isUuid(event.id)&&isUuid(sourceId)){
        const {error}=await supabaseClient.from('own_events').upsert({id:event.id,user_id:currentUser.id,calendar_source_id:sourceId,title:event.summary,location:event.location||null,description:event.description||null,start_time:event.start,end_time:event.end,all_day:event.allDay,recurrence:event.recurrence,travel_time:event.travelTime||null,status:event.status},{onConflict:'id'});
        if(error)toast('Termin lokal gespeichert, Datenbank-Speicherung fehlgeschlagen: '+error.message);
      }
      await hardSave70(false);render();toast('Termin gespeichert.');
    });
  };

  function patchExistingEditorTitle70(){
    const save=$('#saveModal');if(!save||save.dataset.rev70TitlePatch)return;
    save.dataset.rev70TitlePatch='1';const old=save.onclick;
    save.onclick=function(ev){
      ['#editOwnTitleRev51','#editTaskTitle','#editProjectTaskTitle','#mEventTitle','#mTitle','#mProjectTaskTitle'].forEach(sel=>{const el=$(sel);if(el&&!el.value.trim())el.value=sel.includes('Own')||sel.includes('Event')?fallbackEventTitle:fallbackTaskTitle;});
      return old&&old.call(this,ev);
    };
  }
  const oldEventDetail70=window.openEventDetailModal||openEventDetailModal;
  window.openEventDetailModal=openEventDetailModal=function(ref){const r=oldEventDetail70.apply(this,arguments);setTimeout(()=>{patchExistingEditorTitle70();bindModalEnter70();},0);return r;};
  const oldTaskDetail70=window.openTaskDetailModal||openTaskDetailModal;
  window.openTaskDetailModal=openTaskDetailModal=function(ref){const r=oldTaskDetail70.apply(this,arguments);setTimeout(()=>{patchExistingEditorTitle70();bindModalEnter70();},0);return r;};
  if(typeof openProjectTaskDetailModalRev047==='function'){
    const oldPTD70=openProjectTaskDetailModalRev047;
    window.openProjectTaskDetailModalRev047=openProjectTaskDetailModalRev047=function(id){const r=oldPTD70.apply(this,arguments);setTimeout(()=>{patchExistingEditorTitle70();bindModalEnter70();},0);return r;};
  }

  async function hardSave70(showToast=true){
    if(!currentUser){if(showToast)toast('Nicht angemeldet. Harte Speicherung nicht möglich.');return false;}
    ensureSettings();
    try{
      clearTimeout(cloudSaveTimer);
      if(typeof saveStateToCloud==='function')await saveStateToCloud();
      if(typeof saveRelationalSnapshot==='function')await saveRelationalSnapshot();
      if(typeof setCloudStatus==='function')setCloudStatus('Hart gespeichert: '+new Date().toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'}),'ok');
      if(showToast)toast('App-State und Tabellen hart gespeichert.');
      return true;
    }catch(error){if(showToast)toast('Harte Speicherung fehlgeschlagen: '+(error.message||error));return false;}
  }
  window.hardSaveRev70=hardSave70;

  function sourceRow70(cal,link,idx){return {id:link.id,user_id:currentUser.id,calendar_group_id:cal.id||cal.dbId,type:link.type||'ics',name:link.name||'Kalenderquelle',url:link.type==='own'?null:(link.url||null),color:link.color||state.colors?.event||defaultColors.event,visible:link.visible!==false,position:idx||0};}
  async function saveCalendarSource70(cal,link,idx){
    if(!currentUser||!cal||!link||!isUuid(link.id))return;
    normalizeRelationalIds();
    const {error}=await supabaseClient.from('calendar_sources').upsert(sourceRow70(cal,link,idx),{onConflict:'id'});
    if(error)throw error;
  }
  window.openICSSettingsModal=openICSSettingsModal=function(pane,idx){
    if(!requireLogin())return;const cal=state.calendars[pane];const link=cal?.links?.[idx];if(!link)return;
    openModal(`ICS-Einstellungen · ${escapeHtml(link.name)}`,`<input id="mIcsName" value="${escapeHtml(link.name)}" placeholder="Name des ICS-Kalenders"><input id="mIcsUrl" value="${escapeHtml(link.url||'')}" placeholder="ICS-Link"><div class="field"><label>Farbe</label><input id="mIcsColor70" type="color" value="${escapeHtml(link.color||state.colors.event)}"></div><div class="hint">Änderungen an Name, Link oder Farbe werden beim Speichern sofort in calendar_sources geschrieben und anschließend hart gespeichert.</div>`,async()=>{
      const oldUrl=link.url||'';link.name=$('#mIcsName')?.value.trim()||'ICS Kalender';link.url=normalizeICSUrl($('#mIcsUrl')?.value.trim()||oldUrl);link.color=$('#mIcsColor70')?.value||link.color||state.colors.event;
      (cal.events||[]).forEach(e=>{if(e.icsId===link.id){e.icsName=link.name;e.source=link.name;e.icsColor=link.color;}});
      try{await saveCalendarSource70(cal,link,idx);await hardSave70(false);if(oldUrl!==link.url)await loadICS(pane);toast('ICS-Kalenderquelle gespeichert.');}
      catch(error){toast('ICS-Quelle konnte nicht gespeichert werden: '+(error.message||error));}
    });
  };
  window.openOwnSourceModal=openOwnSourceModal=function(pane,idx){
    if(!requireLogin())return;const cal=state.calendars[pane];const link=cal?.links?.[idx];if(!link)return;
    openModal(`Eigener Kalender · ${escapeHtml(link.name)}`,`<input id="mOwnSourceName" value="${escapeHtml(link.name)}" placeholder="Name des eigenen Kalenders"><div class="field"><label>Farbe</label><input id="mOwnSourceColor70" type="color" value="${escapeHtml(link.color||state.colors.event)}"></div><div class="hint">Änderungen werden sofort in calendar_sources geschrieben und hart gespeichert.</div>`,async()=>{
      link.name=$('#mOwnSourceName')?.value.trim()||'Eigener Kalender';link.color=$('#mOwnSourceColor70')?.value||link.color||state.colors.event;
      (cal.ownEvents||[]).forEach(e=>{if(e.sourceId===link.id){e.source=link.name;e.icsName=link.name;e.icsColor=link.color;}});
      try{await saveCalendarSource70(cal,link,idx);await hardSave70(false);toast('Eigener Kalender gespeichert.');}
      catch(error){toast('Eigener Kalender konnte nicht gespeichert werden: '+(error.message||error));}
    });
  };

  function renderSettings70(){
    ensure70();
    const d=JSON.parse(JSON.stringify({theme:state.theme||'light',cornerStyle:state.cornerStyle||'rounded',outlineStyle:state.outlineStyle||'current',outlineCustomColor:state.outlineCustomColor||'#64748b',vacationHighlight:state.vacationHighlight,weekendHighlight:state.weekendHighlight,todayHighlight:state.todayHighlight,syncInterval:state.syncInterval??15}));
    let active='general';
    $('#modalTitle').textContent='Allgemeine Einstellungen';
    $('#modalContent').innerHTML=`<div class="rev70-settings"><div class="rev70-tabs"><button class="rev70-tab active" data-tab70="general" type="button">Allgemein</button><button class="rev70-tab" data-tab70="sync" type="button">Synchronisierung</button><button class="rev70-tab" data-tab70="info" type="button">Hinweise</button></div><div id="settingsTabContentRev70" class="rev70-content"></div></div>`;
    $('#modalBackdrop').style.display='flex';$('#saveModal').style.display='';$('#cancelModal').style.display='';
    function read(){
      if($('#mTheme70'))d.theme=$('#mTheme70').value;if($('#mCornerStyle70'))d.cornerStyle=$('#mCornerStyle70').value;if($('#mOutlineStyle70'))d.outlineStyle=$('#mOutlineStyle70').value;if($('#mOutlineColor70'))d.outlineCustomColor=$('#mOutlineColor70').value;
      if($('#mWeekendEnabled70'))d.weekendHighlight.enabled=$('#mWeekendEnabled70').checked;if($('#mWeekendColor70'))d.weekendHighlight.color=$('#mWeekendColor70').value;if($('#mWeekendOpacity70'))d.weekendHighlight.opacity=clamp($('#mWeekendOpacity70').value,0.05,0.70,0.28);
      if($('#mVacationEnabled70'))d.vacationHighlight.enabled=$('#mVacationEnabled70').checked;if($('#mVacationColor70'))d.vacationHighlight.color=$('#mVacationColor70').value;if($('#mVacationOpacity70'))d.vacationHighlight.opacity=clamp($('#mVacationOpacity70').value,0.05,0.55,0.18);
      if($('#mTodayWidth70'))d.todayHighlight.borderWidth=clamp($('#mTodayWidth70').value,1,10,4);if($('#mTodayColor70'))d.todayHighlight.borderColor=$('#mTodayColor70').value;if($('#mTodayOpacity70'))d.todayHighlight.opacity=clamp($('#mTodayOpacity70').value,0,0.65,0.18);
      if($('#mSyncInterval70'))d.syncInterval=Number($('#mSyncInterval70').value);
    }
    function inputColor(id,val){return `<input id="${id}" type="color" value="${esc(val)}" class="rev70-color-input">`;}
    function general(){const root=$('#settingsTabContentRev70');root.innerHTML=`<div class="rev70-grid">
      <section class="rev70-card"><h3>Darstellung</h3><div class="rev70-row"><label>Erscheinung</label><select id="mTheme70"><option value="light">Hell</option><option value="dark">Dunkel</option></select></div><div class="rev70-row"><label>Kanten</label><select id="mCornerStyle70"><option value="rounded">Abgerundet</option><option value="sharp">Eckig / 90°</option></select></div><div class="rev70-row"><label>Konturfarbe</label><div class="rev70-inline"><select id="mOutlineStyle70"><option value="current">Wie aktuell</option><option value="none">Keine</option><option value="gray">Grau</option><option value="black">Schwarz</option><option value="custom">Eigene Farbe</option></select>${inputColor('mOutlineColor70',d.outlineCustomColor)}</div></div></section>
      <section class="rev70-card"><label class="rev70-check"><span><b>Wochenenden anders anzeigen</b><small>Samstag und Sonntag erhalten optional eine eigene Hintergrundfarbe mit eigener Deckkraft.</small></span><input id="mWeekendEnabled70" type="checkbox"></label><div class="rev70-row"><label>Wochenendfarbe</label>${inputColor('mWeekendColor70',d.weekendHighlight.color)}</div><div class="rev70-row"><label>Wochenend-Deckkraft</label><input id="mWeekendOpacity70" type="range" min="0.05" max="0.70" step="0.01" value="${esc(d.weekendHighlight.opacity)}"></div></section>
      <section class="rev70-card"><label class="rev70-check"><span><b>Urlaubstage anders anzeigen</b><small>Bedingungen: sichtbarer Kalendertermin, ganztägig, Titel exakt „Urlaub“, kein Samstag, kein Sonntag. Ein ganztägiger Urlaub am Samstag wird daher nicht in Urlaubsfarbe markiert.</small></span><input id="mVacationEnabled70" type="checkbox"></label><div class="rev70-row"><label>Urlaubsfarbe</label>${inputColor('mVacationColor70',d.vacationHighlight.color)}</div><div class="rev70-row"><label>Urlaubs-Deckkraft</label><input id="mVacationOpacity70" type="range" min="0.05" max="0.55" step="0.01" value="${esc(d.vacationHighlight.opacity)}"></div></section>
      <section class="rev70-card"><h3>Aktueller Tag</h3><div class="rev70-row"><label>Linienstärke</label><input id="mTodayWidth70" type="range" min="1" max="10" step="1" value="${esc(d.todayHighlight.borderWidth)}"></div><div class="rev70-row"><label>Linienfarbe</label>${inputColor('mTodayColor70',d.todayHighlight.borderColor)}</div><div class="rev70-row"><label>Flächen-Deckkraft</label><input id="mTodayOpacity70" type="range" min="0" max="0.65" step="0.01" value="${esc(d.todayHighlight.opacity)}"></div></section>
      </div>`;$('#mTheme70').value=d.theme;$('#mCornerStyle70').value=d.cornerStyle;$('#mOutlineStyle70').value=d.outlineStyle;$('#mWeekendEnabled70').checked=!!d.weekendHighlight.enabled;$('#mVacationEnabled70').checked=!!d.vacationHighlight.enabled;}
    function sync(){const root=$('#settingsTabContentRev70');root.innerHTML=`<div class="rev70-grid"><section class="rev70-card"><h3>Synchronisierung</h3><div class="rev70-row"><label>Intervall</label><select id="mSyncInterval70"><option value="0">Aus / manuell</option><option value="5">Alle 5 Min.</option><option value="15">Alle 15 Min.</option><option value="30">Alle 30 Min.</option><option value="60">Alle 60 Min.</option></select></div><button class="btn primary" id="rev70HardSaveBtn" type="button">Alle Änderungen hart in Datenbank speichern</button><p class="rev70-help">Speichert App-State und alle relationalen Tabellen sofort. Das betrifft auch neu geänderte ICS-Links, Farben, Kalenderquellen, Tasks, Projekte und eigene Termine.</p><button class="btn" id="rev70ReloadBtn" type="button">Daten aus Datenbank neu laden</button></section></div>`;$('#mSyncInterval70').value=String(d.syncInterval??15);$('#rev70HardSaveBtn').onclick=async()=>{read();applyDraft();await hardSave70(true);};$('#rev70ReloadBtn').onclick=async()=>{if(typeof loadStateFromCloud==='function')await loadStateFromCloud();render();toast('Datenbankdaten neu geladen.');};}
    function info(){const root=$('#settingsTabContentRev70');root.innerHTML=`<div class="rev70-grid"><section class="rev70-card"><h3>Urlaubslogik</h3><p>Ein Tag wird nur als Urlaubstag eingefärbt, wenn ein sichtbarer Kalender einen ganztägigen Termin exakt mit dem Titel „Urlaub“ enthält. Samstag und Sonntag sind ausgeschlossen.</p></section><section class="rev70-card"><h3>Wochenendlogik</h3><p>Wochenenden haben eine eigene optionale Farbe und Deckkraft. Diese Markierung ist unabhängig von Urlaubstagen.</p></section><section class="rev70-card"><h3>Speicherung</h3><p>Der harte Speicherbutton schreibt den UI-App-State und die fachlichen Tabellen aktiv nach Supabase. Änderungen an bestehenden ICS-Links werden zusätzlich direkt beim Speichern der Quelle in calendar_sources aktualisiert.</p></section><section class="rev70-card"><h3>Enter-Verhalten</h3><p>Enter speichert geöffnete Dialoge. Shift+Enter erzeugt in Notizfeldern einen Absatz.</p></section></div>`;}
    function applyDraft(){state.theme=d.theme;state.cornerStyle=d.cornerStyle;state.outlineStyle=d.outlineStyle;state.outlineCustomColor=d.outlineCustomColor;state.weekendHighlight=Object.assign({},REV70_DEFAULTS.weekendHighlight,d.weekendHighlight);state.vacationHighlight=Object.assign({},REV70_DEFAULTS.vacationHighlight,d.vacationHighlight);state.todayHighlight=Object.assign({},REV70_DEFAULTS.todayHighlight,d.todayHighlight);state.syncInterval=Number(d.syncInterval??15);ensure70();applyAppearance();if(typeof setupAutoSync==='function')setupAutoSync();}
    function activeRender(){if(active==='general')general();else if(active==='sync')sync();else info();bindModalEnter70();}
    activeRender();
    document.querySelectorAll('[data-tab70]').forEach(btn=>btn.onclick=()=>{read();active=btn.dataset.tab70;document.querySelectorAll('[data-tab70]').forEach(b=>b.classList.toggle('active',b===btn));activeRender();});
    $('#saveModal').onclick=async()=>{read();applyDraft();const ok=await hardSave70(false);closeModal();render();toast(ok?'Einstellungen gespeichert.':'Einstellungen lokal übernommen, Cloud-Speicherung fehlgeschlagen.');};
    bindModalEnter70();
  }
  window.openSyncSettingsModal=openSyncSettingsModal=renderSettings70;
  function bindSettingsButton(){const b=$('#settingsBtn');if(b)b.onclick=renderSettings70;}
  bindSettingsButton();setTimeout(bindSettingsButton,200);setTimeout(bindSettingsButton,800);

  const style=document.createElement('style');
  style.textContent=`
    .rev70-settings{display:grid;grid-template-columns:190px minmax(0,1fr);gap:14px;align-items:start;color:#111827!important;}
    .rev70-tabs{display:flex;flex-direction:column;gap:8px}.rev70-tab{width:100%;text-align:left;background:#f3f4f6!important;border:1px solid #cbd6e7!important;color:#111827!important;border-radius:12px;padding:10px 12px;font-weight:900}.rev70-tab.active{background:#d1d5db!important;border-color:#9ca3af!important;color:#111827!important;}
    .rev70-grid{display:grid;gap:12px}.rev70-card{border:1px solid #cbd5e1;border-radius:14px;padding:12px;background:#f8fafc;display:grid;gap:10px;color:#111827!important}.rev70-card h3{margin:0;font-size:15px;color:#111827!important}.rev70-card p{margin:0;color:#334155;line-height:1.4}.rev70-card small,.rev70-help{display:block;color:#475569!important;font-size:12px;line-height:1.35;margin-top:3px}.rev70-row{display:grid;grid-template-columns:minmax(155px,230px) minmax(0,1fr);gap:10px;align-items:center}.rev70-row label{font-weight:800;color:#111827;font-size:13px}.rev70-row input,.rev70-row select{min-width:0}.rev70-inline{display:flex;gap:8px;align-items:center}.rev70-check{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;align-items:center}.rev70-check b{font-weight:1000;color:#111827!important}.rev70-check input[type="checkbox"]{width:20px;height:20px;accent-color:#0284c7}.rev70-color-input{height:38px;width:74px;padding:2px}
    .rev70-weekend-day{background:linear-gradient(0deg,color-mix(in srgb,var(--rev70WeekendColor) var(--rev70WeekendOpacityPercent),transparent),color-mix(in srgb,var(--rev70WeekendColor) var(--rev70WeekendOpacityPercent),transparent)),#0b1221!important}.month-cell.rev70-weekend-cell{background:linear-gradient(0deg,color-mix(in srgb,var(--rev70WeekendColor) var(--rev70WeekendOpacityPercent),transparent),color-mix(in srgb,var(--rev70WeekendColor) var(--rev70WeekendOpacityPercent),transparent)),#070d1a!important}.rev70-vacation-day{background:linear-gradient(0deg,color-mix(in srgb,var(--rev70VacationColor) var(--rev70VacationOpacityPercent),transparent),color-mix(in srgb,var(--rev70VacationColor) var(--rev70VacationOpacityPercent),transparent)),#0b1221!important}.month-cell.rev70-vacation-cell{background:linear-gradient(0deg,color-mix(in srgb,var(--rev70VacationColor) var(--rev70VacationOpacityPercent),transparent),color-mix(in srgb,var(--rev70VacationColor) var(--rev70VacationOpacityPercent),transparent)),#070d1a!important}body.light .rev70-weekend-day,body.light .rev70-vacation-day{background-color:#f8fbff!important}body.light .month-cell.rev70-weekend-cell,body.light .month-cell.rev70-vacation-cell{background-color:#f8fbff!important}.rev70-weekend-timeline{background:linear-gradient(0deg,color-mix(in srgb,var(--rev70WeekendColor) var(--rev70WeekendOpacityPercent),transparent),color-mix(in srgb,var(--rev70WeekendColor) var(--rev70WeekendOpacityPercent),transparent)),#050a16!important}.rev70-vacation-timeline{background:linear-gradient(0deg,color-mix(in srgb,var(--rev70VacationColor) var(--rev70VacationOpacityPercent),transparent),color-mix(in srgb,var(--rev70VacationColor) var(--rev70VacationOpacityPercent),transparent)),#050a16!important}
    @media(max-width:760px){.rev70-settings{grid-template-columns:1fr}.rev70-tabs{flex-direction:row;flex-wrap:wrap}.rev70-tab{width:auto}.rev70-row{grid-template-columns:1fr;gap:5px}}
  `;
  document.head.appendChild(style);
  setTimeout(()=>{ensure70();decorateAll70();},350);
})();


/* Rev 071: Wochenend-/Urlaubslogik stabilisiert, Einstellungen repariert, Hinweise befüllt, ICS-Quellen speichern sofort */
(function(){
  const REV71_DEFAULTS={
    weekendHighlight:{enabled:false,color:'#ffd29a',opacity:0.24},
    vacationHighlight:{enabled:true,color:'#f97316',opacity:0.18},
    todayHighlight:{borderWidth:4,borderColor:'#0284c7',opacity:0.16}
  };
  function q(sel){return document.querySelector(sel);} 
  function qq(sel){return Array.from(document.querySelectorAll(sel));}
  function esc(v){return typeof escapeHtml==='function'?escapeHtml(v):String(v??'').replace(/[&<>\"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));}
  function isHex(v){return /^#[0-9a-f]{6}$/i.test(String(v||''));}
  function clamp(v,min,max,fb){v=Number(v);return Number.isFinite(v)?Math.max(min,Math.min(max,v)):fb;}
  function isWeekendRev71(d){const x=new Date(d);const day=x.getDay();return day===0||day===6;}
  function toRgba(hex,opacity){
    const h=isHex(hex)?hex:'#ffd29a';
    const n=parseInt(h.slice(1),16);
    return `rgba(${(n>>16)&255},${(n>>8)&255},${n&255},${clamp(opacity,0,1,0.2)})`;
  }
  function ensureRev71(){
    if(typeof ensureSettings==='function')ensureSettings();
    state.weekendHighlight=Object.assign({},REV71_DEFAULTS.weekendHighlight,state.weekendHighlight||{});
    state.vacationHighlight=Object.assign({},REV71_DEFAULTS.vacationHighlight,state.vacationHighlight||{});
    state.todayHighlight=Object.assign({},REV71_DEFAULTS.todayHighlight,state.todayHighlight||{});
    state.weekendHighlight.enabled=!!state.weekendHighlight.enabled;
    state.vacationHighlight.enabled=!!state.vacationHighlight.enabled;
    state.weekendHighlight.color=isHex(state.weekendHighlight.color)?state.weekendHighlight.color:REV71_DEFAULTS.weekendHighlight.color;
    state.vacationHighlight.color=isHex(state.vacationHighlight.color)?state.vacationHighlight.color:REV71_DEFAULTS.vacationHighlight.color;
    state.todayHighlight.borderColor=isHex(state.todayHighlight.borderColor)?state.todayHighlight.borderColor:REV71_DEFAULTS.todayHighlight.borderColor;
    state.weekendHighlight.opacity=clamp(state.weekendHighlight.opacity,0.05,0.70,REV71_DEFAULTS.weekendHighlight.opacity);
    state.vacationHighlight.opacity=clamp(state.vacationHighlight.opacity,0.05,0.55,REV71_DEFAULTS.vacationHighlight.opacity);
    state.todayHighlight.opacity=clamp(state.todayHighlight.opacity,0,0.65,REV71_DEFAULTS.todayHighlight.opacity);
    state.todayHighlight.borderWidth=clamp(state.todayHighlight.borderWidth,1,10,REV71_DEFAULTS.todayHighlight.borderWidth);
  }
  function setVarsRev71(){
    ensureRev71();
    document.documentElement.style.setProperty('--rev71WeekendBg',toRgba(state.weekendHighlight.color,state.weekendHighlight.opacity));
    document.documentElement.style.setProperty('--rev71VacationBg',toRgba(state.vacationHighlight.color,state.vacationHighlight.opacity));
    document.documentElement.style.setProperty('--rev71TodayBg',toRgba(state.todayHighlight.borderColor,state.todayHighlight.opacity));
    document.documentElement.style.setProperty('--rev71TodayBorderColor',state.todayHighlight.borderColor);
    document.documentElement.style.setProperty('--rev71TodayBorderWidth',String(Math.round(state.todayHighlight.borderWidth))+'px');
  }
  function eventVisibleForVacation(e,cal){
    const links=cal?.links||[];
    const link=links.find(l=>l.id===e.icsId||l.id===e.sourceId);
    return !(link&&link.visible===false);
  }
  function hasVacationRev71(day){
    ensureRev71();
    if(!state.vacationHighlight.enabled||isWeekendRev71(day))return false;
    try{
      return visibleCalendars().some(({cal})=>{
        const entries=[...(cal.events||[]),...(cal.ownEvents||[])];
        return entries.some(e=>{
          if(!eventVisibleForVacation(e,cal))return false;
          const occ=eventOccurrenceForDate(e,day);
          return !!(occ&&occ.allDay&&String(occ.summary||occ.title||'').trim().toLowerCase()==='urlaub');
        });
      });
    }catch(_){return false;}
  }
  function clearDecorRev71(el){
    if(!el)return;
    el.classList.remove('vacation-day-rev52','vacation-active','rev64-weekend-day','rev65-weekend-day','rev66-weekend-day','rev68-weekend-day','rev70-weekend-day','rev71-weekend-day','rev66-vacation-day','rev68-vacation-day','rev70-vacation-day','rev71-vacation-day');
    el.classList.remove('rev64-weekend-cell','rev65-weekend-cell','rev66-weekend-cell','rev68-weekend-cell','rev70-weekend-cell','rev71-weekend-cell','rev66-vacation-cell','rev68-vacation-cell','rev70-vacation-cell','rev71-vacation-cell');
    el.classList.remove('rev65-weekend-timeline','rev68-weekend-timeline','rev70-weekend-timeline','rev71-weekend-timeline','rev68-vacation-timeline','rev70-vacation-timeline','rev71-vacation-timeline');
  }
  function applyDecorRev71(el,day,isMonth){
    if(!el)return;
    ensureRev71();setVarsRev71();clearDecorRev71(el);
    const weekend=isWeekendRev71(day);
    if(weekend&&state.weekendHighlight.enabled)el.classList.add(isMonth?'rev71-weekend-cell':'rev71-weekend-day');
    else if(!weekend&&hasVacationRev71(day))el.classList.add(isMonth?'rev71-vacation-cell':'rev71-vacation-day');
    if(!isMonth&&typeof sameDay==='function'){
      const today=new Date();today.setHours(0,0,0,0);
      if(sameDay(day,today))el.classList.add('rev71-today-day');
    }
  }
  function allMonthEventsRev71(d){
    try{
      return visibleCalendars().flatMap(({cal:c})=>{
        const ics=(c.events||[]).map(e=>eventOccurrenceForDate(e,d)).filter(e=>{if(!e)return false;const l=(c.links||[]).find(x=>x.id===e.icsId);return !l||l.visible!==false;});
        const own=(c.ownEvents||[]).map(e=>eventOccurrenceForDate(e,d)).filter(e=>{if(!e)return false;const l=(c.links||[]).find(x=>x.id===e.sourceId);return l&&l.visible!==false;});
        return [...ics,...own];
      }).map(e=>({summary:e.summary,color:e.icsColor||state.colors?.event||'#7c5cff',status:e.status,allDay:!!e.allDay,start:e.start||''}))
        .sort((a,b)=>Number(!b.allDay)-Number(!a.allDay)||new Date(a.start)-new Date(b.start));
    }catch(_){return [];}
  }
  function renderMonthViewRev71(){
    const root=q('#monthView');if(!root)return;
    ensureRev71();setVarsRev71();
    const monthName=monthCursor.toLocaleDateString('de-DE',{month:'long',year:'numeric'});
    const first=new Date(monthCursor);const start=new Date(first);start.setDate(first.getDate()-((first.getDay()+6)%7));
    const heads=['Mo','Di','Mi','Do','Fr','Sa','So'];
    let html=`<div class="month-nav"><button class="btn small" id="mPrev">← Monat</button><div class="month-title">${esc(monthName)}</div><button class="btn small" id="mNext">Monat →</button></div><div class="month-grid">${heads.map(d=>`<div class="month-head">${d}</div>`).join('')}`;
    const today=new Date();today.setHours(0,0,0,0);const todayIso=fmtDate(today);
    const openOverdueToday=(state.tasks||[]).some(t=>t.date<todayIso&&!t.done)||((state.projectTasks||[]).some(t=>t.dueDate&&t.dueDate<todayIso&&!t.done));
    for(let i=0;i<42;i++){
      const d=addDays(start,i);const iso=fmtDate(d);const inMonth=d.getMonth()===monthCursor.getMonth();
      const weekend=isWeekendRev71(d);const vacation=!weekend&&hasVacationRev71(d);
      const cls=['month-cell'];if(!inMonth)cls.push('out');if(sameDay(d,today))cls.push('today','rev71-today-cell');if(weekend&&state.weekendHighlight.enabled)cls.push('rev71-weekend-cell');else if(vacation)cls.push('rev71-vacation-cell');
      const events=allMonthEventsRev71(d);
      const hasOpenDayTasks=(state.tasks||[]).some(t=>t.date===iso&&!t.done)||((state.projectTasks||[]).some(t=>t.dueDate===iso&&!t.done));
      const showOverdueBar=sameDay(d,today)&&openOverdueToday;
      const kw=(d.getDay()===1)?` <span class="kw-label">(KW${getISOWeek(d)})</span>`:'';
      const compactAll=events.length>2;
      const evHtml=events.slice(0,4).map((e,idx)=>{const compact=compactAll||String(e.summary||'').length>24||idx>1;return `<div class="month-event ${compact?'month-event-compact':''} ${e.allDay?'month-event-all-day':''}" style="background:${esc(e.color)}!important;text-decoration:${String(e.status||'').toUpperCase()==='CANCELLED'?'line-through':'none'}" title="${esc(e.summary)}">${compact?'':esc(shortText(e.summary,24))}</div>`;}).join('');
      html+=`<div class="${cls.join(' ')}" data-month-date="${iso}" title="Tagesansicht ab ${iso} öffnen"><div class="month-day"><span>${d.getDate()}</span>${kw}</div>${evHtml}${hasOpenDayTasks?'<div class="month-statusbar task" title="Tagesaufgaben offen"></div>':''}${showOverdueBar?'<div class="month-statusbar overdue" title="Überfällige Aufgaben offen"></div>':''}</div>`;
    }
    html+='</div>';root.innerHTML=html;
    const prev=q('#mPrev');if(prev)prev.onclick=()=>{monthCursor.setMonth(monthCursor.getMonth()-1);renderMonthViewRev71();};
    const next=q('#mNext');if(next)next.onclick=()=>{monthCursor.setMonth(monthCursor.getMonth()+1);renderMonthViewRev71();};
    qq('[data-month-date]').forEach(cell=>cell.onclick=()=>{const target=new Date(cell.dataset.monthDate+'T00:00:00');const base=new Date();base.setHours(0,0,0,0);state.offset=Math.round((target-base)/86400000);closeModal();render();});
  }
  window.renderMonthView=renderMonthView=renderMonthViewRev71;
  window.openMonthModal=openMonthModal=function(){
    if(typeof removeStaleDeletes68==='function')try{removeStaleDeletes68();}catch(_){}
    monthCursor=new Date();monthCursor.setDate(1);monthCursor.setHours(0,0,0,0);
    q('#modalTitle').textContent='Monatsübersicht';
    q('#modalContent').innerHTML='<div id="monthView" class="rev71-month-ready"></div>';
    q('#modalBackdrop').style.display='flex';
    q('#saveModal').style.display='none';
    renderMonthViewRev71();
  };
  const monthBtn=q('#monthBtn');if(monthBtn)monthBtn.onclick=openMonthModal;

  const oldRenderRev71=window.render||render;
  window.render=render=function(){const r=oldRenderRev71.apply(this,arguments);setTimeout(()=>{decorateVisibleRev71();},220);return r;};
  const oldDayCardRev71=window.dayCard||dayCard;
  window.dayCard=dayCard=function(date){const node=oldDayCardRev71.apply(this,arguments);applyDecorRev71(node,date,false);return node;};
  function decorateVisibleRev71(){
    ensureRev71();setVarsRev71();
    qq('.day').forEach(day=>{const txt=day.querySelector('.day-title-date')?.textContent||'';const m=txt.match(/(\d{2})\.(\d{2})\.(\d{4})/);if(m)applyDecorRev71(day,new Date(`${m[3]}-${m[2]}-${m[1]}T00:00:00`),false);});
    qq('[data-month-date]').forEach(cell=>applyDecorRev71(cell,new Date(cell.dataset.monthDate+'T00:00:00'),true));
    const wrap=q('#sidebarDayTimelineRev049 .timeline-canvas-wrap');if(wrap){clearDecorRev71(wrap);wrap.classList.add('rev71-timeline-clean');}
  }

  function readSettingDraft(d){
    if(q('#mTheme71'))d.theme=q('#mTheme71').value;
    if(q('#mCornerStyle71'))d.cornerStyle=q('#mCornerStyle71').value;
    if(q('#mOutlineStyle71'))d.outlineStyle=q('#mOutlineStyle71').value;
    if(q('#mOutlineColor71'))d.outlineCustomColor=q('#mOutlineColor71').value;
    if(q('#mWeekendEnabled71'))d.weekendHighlight.enabled=q('#mWeekendEnabled71').checked;
    if(q('#mWeekendColor71'))d.weekendHighlight.color=q('#mWeekendColor71').value;
    if(q('#mWeekendOpacity71'))d.weekendHighlight.opacity=clamp(q('#mWeekendOpacity71').value,0.05,0.70,REV71_DEFAULTS.weekendHighlight.opacity);
    if(q('#mVacationEnabled71'))d.vacationHighlight.enabled=q('#mVacationEnabled71').checked;
    if(q('#mVacationColor71'))d.vacationHighlight.color=q('#mVacationColor71').value;
    if(q('#mVacationOpacity71'))d.vacationHighlight.opacity=clamp(q('#mVacationOpacity71').value,0.05,0.55,REV71_DEFAULTS.vacationHighlight.opacity);
    if(q('#mTodayWidth71'))d.todayHighlight.borderWidth=clamp(q('#mTodayWidth71').value,1,10,REV71_DEFAULTS.todayHighlight.borderWidth);
    if(q('#mTodayColor71'))d.todayHighlight.borderColor=q('#mTodayColor71').value;
    if(q('#mTodayOpacity71'))d.todayHighlight.opacity=clamp(q('#mTodayOpacity71').value,0,0.65,REV71_DEFAULTS.todayHighlight.opacity);
    if(q('#mSyncInterval71'))d.syncInterval=Number(q('#mSyncInterval71').value);
  }
  function applySettingDraft(d){
    state.theme=d.theme;state.cornerStyle=d.cornerStyle;state.outlineStyle=d.outlineStyle;state.outlineCustomColor=d.outlineCustomColor;
    state.weekendHighlight=Object.assign({},REV71_DEFAULTS.weekendHighlight,d.weekendHighlight);
    state.vacationHighlight=Object.assign({},REV71_DEFAULTS.vacationHighlight,d.vacationHighlight);
    state.todayHighlight=Object.assign({},REV71_DEFAULTS.todayHighlight,d.todayHighlight);
    state.syncInterval=Number(d.syncInterval??15);
    ensureRev71();setVarsRev71();if(typeof applyAppearance==='function')applyAppearance();if(typeof setupAutoSync==='function')setupAutoSync();
  }
  function colorInput(id,value){return `<input id="${id}" class="rev71-color-input" type="color" value="${esc(value)}">`;}
  function settingsRev71(){
    ensureRev71();
    let active='general';
    const d=JSON.parse(JSON.stringify({theme:state.theme||'light',cornerStyle:state.cornerStyle||'rounded',outlineStyle:state.outlineStyle||'current',outlineCustomColor:state.outlineCustomColor||'#64748b',weekendHighlight:state.weekendHighlight,vacationHighlight:state.vacationHighlight,todayHighlight:state.todayHighlight,syncInterval:state.syncInterval??15}));
    q('#modalTitle').textContent='Allgemeine Einstellungen';
    q('#modalContent').innerHTML=`<div class="rev71-settings"><div class="rev71-tabs"><button class="rev71-tab active" data-tab71="general">Allgemein</button><button class="rev71-tab" data-tab71="sync">Synchronisierung</button><button class="rev71-tab" data-tab71="info">Hinweise</button></div><div id="settingsTabContentRev71"></div></div>`;
    q('#modalBackdrop').style.display='flex';q('#saveModal').style.display='';
    function general(){const root=q('#settingsTabContentRev71');root.innerHTML=`<div class="rev71-grid">
      <section class="rev71-card"><h3>Darstellung</h3><div class="rev71-row"><label>Erscheinung</label><select id="mTheme71"><option value="light">Hell</option><option value="dark">Dunkel</option></select></div><div class="rev71-row"><label>Kanten</label><select id="mCornerStyle71"><option value="rounded">Abgerundet</option><option value="sharp">Eckig / 90°</option></select></div><div class="rev71-row"><label>Konturfarbe</label><div class="rev71-inline"><select id="mOutlineStyle71"><option value="current">Wie aktuell</option><option value="none">Keine</option><option value="gray">Grau</option><option value="black">Schwarz</option><option value="custom">Eigene Farbe</option></select>${colorInput('mOutlineColor71',d.outlineCustomColor)}</div></div></section>
      <section class="rev71-card"><label class="rev71-check"><span><b>Wochenendtage anders anzeigen</b><small>Samstag und Sonntag erhalten optional eine eigene Hintergrundfarbe. Diese Markierung ist unabhängig von Urlaub.</small></span><input id="mWeekendEnabled71" type="checkbox"></label><div class="rev71-row"><label>Wochenendfarbe</label>${colorInput('mWeekendColor71',d.weekendHighlight.color)}</div><div class="rev71-row"><label>Wochenend-Deckkraft</label><input id="mWeekendOpacity71" type="range" min="0.05" max="0.70" step="0.01" value="${esc(d.weekendHighlight.opacity)}"></div></section>
      <section class="rev71-card"><label class="rev71-check"><span><b>Urlaubstage anders anzeigen</b><small>Wenn ein sichtbarer ICS- oder eigener Kalender einen ganztägigen Termin exakt mit dem Titel „Urlaub“ enthält, wird der gesamte Tag farblich hinterlegt. Bedingung: Der Tag darf kein Samstag und kein Sonntag sein.</small></span><input id="mVacationEnabled71" type="checkbox"></label><div class="rev71-row"><label>Urlaubsfarbe</label>${colorInput('mVacationColor71',d.vacationHighlight.color)}</div><div class="rev71-row"><label>Urlaubs-Deckkraft</label><input id="mVacationOpacity71" type="range" min="0.05" max="0.55" step="0.01" value="${esc(d.vacationHighlight.opacity)}"></div></section>
      <section class="rev71-card"><h3>Aktueller Tag</h3><div class="rev71-row"><label>Linienstärke</label><input id="mTodayWidth71" type="range" min="1" max="10" step="1" value="${esc(d.todayHighlight.borderWidth)}"></div><div class="rev71-row"><label>Linienfarbe</label>${colorInput('mTodayColor71',d.todayHighlight.borderColor)}</div><div class="rev71-row"><label>Flächen-Deckkraft</label><input id="mTodayOpacity71" type="range" min="0" max="0.65" step="0.01" value="${esc(d.todayHighlight.opacity)}"></div></section>
    </div>`;q('#mTheme71').value=d.theme;q('#mCornerStyle71').value=d.cornerStyle;q('#mOutlineStyle71').value=d.outlineStyle;q('#mWeekendEnabled71').checked=!!d.weekendHighlight.enabled;q('#mVacationEnabled71').checked=!!d.vacationHighlight.enabled;}
    function sync(){const root=q('#settingsTabContentRev71');root.innerHTML=`<div class="rev71-grid"><section class="rev71-card"><h3>Synchronisierung</h3><div class="rev71-row"><label>Intervall</label><select id="mSyncInterval71"><option value="0">Aus / manuell</option><option value="5">Alle 5 Min.</option><option value="15">Alle 15 Min.</option><option value="30">Alle 30 Min.</option><option value="60">Alle 60 Min.</option></select></div><button class="btn primary" id="rev71HardSaveBtn" type="button">Alle Änderungen hart in Datenbank speichern</button><p class="rev71-help">Speichert App-State und relationale Tabellen sofort. Bestehende ICS-Link-Änderungen werden zusätzlich direkt in calendar_sources überschrieben.</p><button class="btn" id="rev71ReloadBtn" type="button">Daten aus Datenbank neu laden</button></section></div>`;q('#mSyncInterval71').value=String(d.syncInterval??15);q('#rev71HardSaveBtn').onclick=async()=>{readSettingDraft(d);applySettingDraft(d);if(typeof hardSaveRev70==='function')await hardSaveRev70(true);else if(typeof saveStateToCloud==='function')await saveStateToCloud();};q('#rev71ReloadBtn').onclick=async()=>{if(typeof loadStateFromCloud==='function')await loadStateFromCloud();render();toast('Datenbankdaten neu geladen.');};}
    function info(){const root=q('#settingsTabContentRev71');root.innerHTML=`<div class="rev71-grid"><section class="rev71-card"><h3>Urlaubslogik</h3><p>Ein Tag wird nur in Urlaubsfarbe markiert, wenn ein sichtbarer Kalender einen ganztägigen Termin exakt mit dem Titel „Urlaub“ enthält und der Tag kein Samstag und kein Sonntag ist.</p></section><section class="rev71-card"><h3>Wochenendlogik</h3><p>Samstag und Sonntag können separat aktiviert, farblich gewählt und über eigene Deckkraft dargestellt werden. Dadurch flackern Urlaubstage am Wochenende nicht mehr in der Monatsansicht.</p></section><section class="rev71-card"><h3>Speicherlogik</h3><p>UI-Einstellungen liegen im App-State. Fachliche Daten wie Kalendergruppen, Kalenderquellen, eigene Termine, Tasks und Projekte bleiben in eigenen Supabase-Tabellen.</p></section><section class="rev71-card"><h3>ICS-Link-Änderungen</h3><p>Beim Speichern einer bestehenden ICS-Quelle werden Name, Link, Farbe und Sichtbarkeit direkt in der Tabelle calendar_sources aktualisiert. Wenn sich der Link ändert, wird der lokale ICS-Cache dieser Quelle geleert und neu geladen.</p></section></div>`;}
    function renderActive(){if(active==='general')general();else if(active==='sync')sync();else info();}
    renderActive();
    qq('[data-tab71]').forEach(btn=>btn.onclick=()=>{readSettingDraft(d);active=btn.dataset.tab71;qq('[data-tab71]').forEach(b=>b.classList.toggle('active',b===btn));renderActive();});
    q('#saveModal').onclick=async()=>{readSettingDraft(d);applySettingDraft(d);let ok=true;try{if(typeof hardSaveRev70==='function')ok=await hardSaveRev70(false);else if(typeof saveStateToCloud==='function')await saveStateToCloud();}catch(_){ok=false;}closeModal();render();toast(ok?'Einstellungen gespeichert.':'Einstellungen lokal übernommen, Cloud-Speicherung fehlgeschlagen.');};
  }
  window.openSyncSettingsModal=openSyncSettingsModal=settingsRev71;
  function bindSettingsRev71(){const b=q('#settingsBtn');if(b)b.onclick=settingsRev71;}
  bindSettingsRev71();setTimeout(bindSettingsRev71,250);setTimeout(bindSettingsRev71,1000);

  function uuidRev71(v){return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(v||''));}
  async function saveSourceRev71(cal,link,idx){
    if(!currentUser||!cal||!link||!uuidRev71(link.id))return false;
    const groupId=cal.id||cal.dbId||link.calendarGroupId||link.calendar_group_id;
    if(!uuidRev71(groupId))return false;
    const row={id:link.id,user_id:currentUser.id,calendar_group_id:groupId,type:link.type||'ics',name:link.name||'Kalenderquelle',url:(link.type==='own'?null:(link.url||null)),color:link.color||state.colors?.event||'#7c5cff',visible:link.visible!==false,position:Number(idx||0)};
    const {error}=await supabaseClient.from('calendar_sources').upsert(row,{onConflict:'id'});
    if(error)throw error;
    return true;
  }
  window.openICSSettingsModal=openICSSettingsModal=function(pane,idx){
    if(!requireLogin())return;
    const cal=state.calendars[pane];const link=cal?.links?.[idx];if(!link)return;
    openModal(`ICS-Einstellungen · ${esc(link.name)}`,`<input id="mIcsName71" value="${esc(link.name)}" placeholder="Name des ICS-Kalenders"><input id="mIcsUrl71" value="${esc(link.url||'')}" placeholder="ICS-Link"><div class="field"><label>Farbe</label><input id="mIcsColor71" type="color" value="${esc(link.color||state.colors?.event||'#7c5cff')}"></div><div class="hint">Speichern überschreibt die bestehende Quelle sofort in calendar_sources. Wird der Link geändert, werden alte ICS-Termine dieser Quelle lokal entfernt und der Kalender neu geladen.</div>`,async()=>{
      const oldUrl=String(link.url||'');
      link.name=(q('#mIcsName71')?.value||'').trim()||link.name||'ICS Kalender';
      link.url=normalizeICSUrl((q('#mIcsUrl71')?.value||'').trim());
      link.color=q('#mIcsColor71')?.value||link.color||state.colors?.event||'#7c5cff';
      (cal.events||[]).forEach(e=>{if(e.icsId===link.id){e.icsName=link.name;e.source=link.name;e.icsColor=link.color;}});
      try{
        await saveSourceRev71(cal,link,idx);
        if(oldUrl!==String(link.url||''))cal.events=(cal.events||[]).filter(e=>e.icsId!==link.id);
        if(typeof hardSaveRev70==='function')await hardSaveRev70(false);else if(typeof saveStateToCloud==='function')await saveStateToCloud();
        if(oldUrl!==String(link.url||'')&&link.url)await loadICS(pane);
        toast('ICS-Quelle gespeichert.');
      }catch(error){toast('ICS-Quelle konnte nicht gespeichert werden: '+(error.message||error));}
    });
  };
  const style=document.createElement('style');
  style.textContent=`
    .rev71-settings{display:grid;grid-template-columns:190px minmax(0,1fr);gap:14px;align-items:start;color:#111827!important}.rev71-tabs{display:flex;flex-direction:column;gap:8px}.rev71-tab{width:100%;text-align:left;background:#f3f4f6!important;border:1px solid #cbd6e7!important;color:#111827!important;border-radius:12px;padding:10px 12px;font-weight:900}.rev71-tab.active{background:#d1d5db!important;border-color:#9ca3af!important}.rev71-grid{display:grid;gap:12px}.rev71-card{border:1px solid #cbd5e1;border-radius:14px;padding:12px;background:#f8fafc;display:grid;gap:10px;color:#111827!important}.rev71-card h3{margin:0;font-size:15px;color:#111827!important}.rev71-card p{margin:0;color:#334155;line-height:1.4}.rev71-card small,.rev71-help{display:block;color:#475569!important;font-size:12px;line-height:1.35;margin-top:3px}.rev71-row{display:grid;grid-template-columns:minmax(155px,230px) minmax(0,1fr);gap:10px;align-items:center}.rev71-row label{font-weight:800;color:#111827;font-size:13px}.rev71-inline{display:flex;gap:8px;align-items:center}.rev71-check{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;align-items:center}.rev71-check b{font-weight:1000;color:#111827!important}.rev71-check input[type="checkbox"]{width:20px;height:20px;accent-color:#0284c7}.rev71-color-input{height:38px;width:74px;padding:2px}.rev71-weekend-day{background:linear-gradient(0deg,var(--rev71WeekendBg),var(--rev71WeekendBg)),#0b1221!important}.rev71-vacation-day{background:linear-gradient(0deg,var(--rev71VacationBg),var(--rev71VacationBg)),#0b1221!important}.month-cell.rev71-weekend-cell{background:linear-gradient(0deg,var(--rev71WeekendBg),var(--rev71WeekendBg)),#070d1a!important}.month-cell.rev71-vacation-cell{background:linear-gradient(0deg,var(--rev71VacationBg),var(--rev71VacationBg)),#070d1a!important}body.light .rev71-weekend-day,body.light .rev71-vacation-day{background-color:#f8fbff!important}body.light .month-cell.rev71-weekend-cell,body.light .month-cell.rev71-vacation-cell{background-color:#f8fbff!important}.rev71-today-day{border-color:var(--rev71TodayBorderColor)!important;border-width:var(--rev71TodayBorderWidth)!important;box-shadow:0 0 0 1px var(--rev71TodayBg)!important}.month-cell.rev71-today-cell{border-color:var(--rev71TodayBorderColor)!important;border-width:var(--rev71TodayBorderWidth)!important}.rev71-timeline-clean{background:#050a16!important}body.light .rev71-timeline-clean{background:#fff!important}@media(max-width:760px){.rev71-settings{grid-template-columns:1fr}.rev71-tabs{flex-direction:row;flex-wrap:wrap}.rev71-tab{width:auto}.rev71-row{grid-template-columns:1fr;gap:5px}}
  `;
  document.head.appendChild(style);
  ensureRev71();setVarsRev71();setTimeout(decorateVisibleRev71,450);
})();

/* Rev 072: Zeitstrahl-Dekoration nach Navigation fixiert, Settings-Reiter robust neu gebunden */
(function(){
  function q(sel){return document.querySelector(sel);} 
  function qq(sel){return Array.from(document.querySelectorAll(sel));}
  function isWeekend72(d){const x=new Date(d);const day=x.getDay();return day===0||day===6;}
  function cleanTimeline72(){
    const wrap=q('#sidebarDayTimelineRev049 .timeline-canvas-wrap');
    if(!wrap)return;
    wrap.classList.remove('vacation-active','rev65-weekend-timeline','rev68-weekend-timeline','rev70-weekend-timeline','rev71-weekend-timeline','rev68-vacation-timeline','rev70-vacation-timeline','rev71-vacation-timeline');
    wrap.style.background='';wrap.style.backgroundColor='';wrap.style.backgroundImage='';wrap.style.borderColor='';wrap.removeAttribute('style');
    wrap.classList.add('rev72-timeline-clean');
    try{
      if(typeof state!=='undefined'&&state.weekendHighlight&&state.weekendHighlight.enabled){
        const shown=typeof addDays==='function'?addDays(new Date(new Date().setHours(0,0,0,0)),Number(state.timelineDayOffset||0)):new Date();
        if(isWeekend72(shown))wrap.classList.add('rev72-weekend-timeline');
      }
    }catch(_){}
  }
  function cleanVisible72(){
    cleanTimeline72();
    qq('.day').forEach(el=>{
      el.classList.remove('vacation-day-rev52','vacation-active','rev64-weekend-day','rev65-weekend-day','rev66-weekend-day','rev68-weekend-day','rev70-weekend-day','rev71-weekend-day','rev66-vacation-day','rev68-vacation-day','rev70-vacation-day','rev71-vacation-day');
      el.style.backgroundImage='';
    });
  }
  const oldTimeline72=typeof renderSidebarTimelineRev050==='function'?renderSidebarTimelineRev050:null;
  if(oldTimeline72){
    window.renderSidebarTimelineRev050=renderSidebarTimelineRev050=function(){
      const r=oldTimeline72.apply(this,arguments);
      setTimeout(cleanTimeline72,0);
      setTimeout(cleanTimeline72,80);
      return r;
    };
  }
  const oldRender72=typeof render==='function'?render:null;
  if(oldRender72){
    window.render=render=function(){
      const r=oldRender72.apply(this,arguments);
      setTimeout(()=>{cleanVisible72();bindSettings72();},0);
      setTimeout(cleanTimeline72,120);
      return r;
    };
  }
  function bindSettings72(){
    const btn=q('#settingsBtn');
    if(btn&&typeof openSyncSettingsModal==='function')btn.onclick=()=>openSyncSettingsModal();
  }
  document.addEventListener('click',ev=>{
    const id=ev.target&&ev.target.id;
    if(id==='timelinePrevDay52'||id==='timelineToday52'||id==='timelineNextDay52')setTimeout(cleanTimeline72,120);
    if(id==='prevBtn'||id==='todayBtn'||id==='nextBtn')setTimeout(cleanTimeline72,220);
  },true);
  const style=document.createElement('style');
  style.textContent=`
    #sidebarDayTimelineRev049 .timeline-canvas-wrap.rev72-timeline-clean{background:#050a16!important;background-image:none!important;}
    body.light #sidebarDayTimelineRev049 .timeline-canvas-wrap.rev72-timeline-clean{background:#fff!important;background-image:none!important;}
    #sidebarDayTimelineRev049 .timeline-canvas-wrap.rev72-weekend-timeline{background:linear-gradient(0deg,var(--rev71WeekendBg,rgba(255,210,154,.24)),var(--rev71WeekendBg,rgba(255,210,154,.24))),#050a16!important;}
    body.light #sidebarDayTimelineRev049 .timeline-canvas-wrap.rev72-weekend-timeline{background:linear-gradient(0deg,var(--rev71WeekendBg,rgba(255,210,154,.24)),var(--rev71WeekendBg,rgba(255,210,154,.24))),#fff!important;}
    .rev71-card:has(#mWeekendEnabled71){display:grid!important;}
    .rev71-card:has(#mWeekendEnabled71),.rev71-card:has(#mVacationEnabled71){visibility:visible!important;opacity:1!important;}
  `;
  document.head.appendChild(style);
  bindSettings72();setTimeout(()=>{bindSettings72();cleanTimeline72();},250);setTimeout(()=>{bindSettings72();cleanTimeline72();},1000);
})();

/* Rev 073: sofortige Tabellen-Speicherung für neue/edited Kalendergruppen, Taskgruppen und Quellen */
(function(){
  const rev73Now=()=>new Date().toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'});
  const rev73Toast=msg=>{try{toast(msg);}catch(e){console.log(msg);}};
  function rev73SetStatus(msg,type='ok'){
    try{ if(typeof setCloudStatus==='function')setCloudStatus(msg,type); }catch(e){}
    const diag=document.querySelector('#diagBox'); if(diag)diag.textContent=msg;
  }
  function rev73EnsureUuid(obj){ if(!obj.id||!isUuid(obj.id))obj.id=crypto.randomUUID(); return obj.id; }
  async function rev73Upsert(table,row){
    const {error}=await supabaseClient.from(table).upsert(row,{onConflict:'id'});
    if(error)throw error;
  }
  function rev73CalendarGroupRow(cal,position){
    rev73EnsureUuid(cal); cal.dbId=cal.id;
    return {id:cal.id,user_id:currentUser.id,name:cal.name||'Kalender',visible:cal.visible!==false,collapsed:cal.collapsed!==false,position:Number(position||0)};
  }
  function rev73CalendarSourceRow(cal,src,position){
    rev73EnsureUuid(cal); rev73EnsureUuid(src); src.calendarGroupId=cal.id;
    return {id:src.id,user_id:currentUser.id,calendar_group_id:cal.id,type:src.type||'ics',name:src.name||'Kalenderquelle',url:(src.type==='own'?null:(src.url||null)),color:src.color||state.colors?.event||defaultColors.event,visible:src.visible!==false,position:Number(position||0)};
  }
  function rev73TaskGroupRow(group,position){
    rev73EnsureUuid(group);
    return {id:group.id,user_id:currentUser.id,name:group.name||'Neue Gruppe',color:group.color||state.colors?.task||defaultColors.task,visible:group.visible!==false,position:Number(position||0)};
  }
  function rev73LongGroupRow(group,position){
    rev73EnsureUuid(group);
    return {id:group.id,user_id:currentUser.id,name:group.name||'Neue Gruppe',color:group.color||state.colors?.long||defaultColors.long,visible:group.visible!==false,position:Number(position||0)};
  }
  async function rev73SaveAppStateOnly(){
    if(!currentUser)return;
    const payload={user_id:currentUser.id,state:uiStateOnly(),updated_at:new Date().toISOString()};
    const {error}=await supabaseClient.from('app_state').upsert(payload,{onConflict:'user_id'});
    if(error)throw error;
    try{localStorage.setItem(storeKey,JSON.stringify(uiStateOnly()));}catch(e){}
  }

  // Fachdatensnapshot wieder aktivieren: sicherer UPSERT ohne automatische Löschungen.
  window.saveRelationalSnapshot=saveRelationalSnapshot=async function(){
    if(!currentUser||suppressCloudSave)return false;
    if(relationalSaveRunning){relationalSaveQueued=true;return false;}
    relationalSaveRunning=true;
    try{
      ensureSettings();
      (state.calendars||[]).forEach((cal,i)=>{rev73EnsureUuid(cal);cal.dbId=cal.id;(cal.links||[]).forEach(src=>{rev73EnsureUuid(src);src.calendarGroupId=cal.id;});});
      (state.taskColumns||[]).forEach(rev73EnsureUuid);
      (state.longColumns||[]).forEach(rev73EnsureUuid);
      const uid=currentUser.id;
      const calRows=(state.calendars||[]).map((c,i)=>rev73CalendarGroupRow(c,i));
      const srcRows=[];(state.calendars||[]).forEach((c)=>{(c.links||[]).forEach((s,j)=>srcRows.push(rev73CalendarSourceRow(c,s,j)));});
      const taskGroupRows=(state.taskColumns||[]).map((g,i)=>rev73TaskGroupRow(g,i));
      const taskRows=(state.tasks||[]).map((t,i)=>{if(!isUuid(t.id))t.id=crypto.randomUUID();return {id:t.id,user_id:uid,task_group_id:isUuid(t.columnId)?t.columnId:null,title:t.title||'Ohne Titel',note:t.note||null,task_date:t.date||fmtDate(new Date()),done:!!t.done,completed_date:t.completedDate||null,position:i};});
      const longGroupRows=(state.longColumns||[]).map((g,i)=>rev73LongGroupRow(g,i));
      const longRows=(state.longterm||[]).map((t,i)=>{if(!isUuid(t.id))t.id=crypto.randomUUID();return {id:t.id,user_id:uid,long_task_group_id:isUuid(t.columnId)?t.columnId:null,title:t.title||'Ohne Titel',note:t.note||null,done:!!t.done,completed_date:t.completedDate||null,position:i};});
      const ownRows=[];(state.calendars||[]).forEach(c=>(c.ownEvents||[]).forEach((e,i)=>{if(!isUuid(e.id))e.id=crypto.randomUUID();ownRows.push({id:e.id,user_id:uid,calendar_source_id:e.sourceId,title:e.summary||e.title||'Ohne Titel',location:e.location||null,description:e.description||null,start_time:e.start,end_time:e.end||null,all_day:!!e.allDay,recurrence:e.recurrence||'none',travel_time:e.travelTime||null,status:e.status||'active'});}));
      await upsertRows('calendar_groups',calRows); await upsertRows('calendar_sources',srcRows);
      await upsertRows('task_groups',taskGroupRows); await upsertRows('tasks',taskRows);
      await upsertRows('long_task_groups',longGroupRows); await upsertRows('long_tasks',longRows); await upsertRows('own_events',ownRows);
      await rev73SaveAppStateOnly();
      rev73SetStatus('Sofort gespeichert: '+rev73Now(),'ok');
      return true;
    }catch(error){
      console.error('Rev073 Sofortspeicherung fehlgeschlagen',error);
      rev73SetStatus('Sofort-Speichern fehlgeschlagen: '+(error.message||error),'bad');
      throw error;
    }finally{
      relationalSaveRunning=false;
      if(relationalSaveQueued){relationalSaveQueued=false;setTimeout(()=>saveRelationalSnapshot().catch(console.error),120);}
    }
  };
  window.scheduleRelationalSave=scheduleRelationalSave=function(){
    if(!currentUser||suppressCloudSave)return;
    clearTimeout(relationalSaveTimer);
    relationalSaveTimer=setTimeout(()=>saveRelationalSnapshot().catch(console.error),120);
  };
  window.hardSaveRev70=async function(showToast=true){
    if(!currentUser){if(showToast)rev73Toast('Nicht angemeldet. Speicherung nicht möglich.');return false;}
    try{await saveRelationalSnapshot(); if(showToast)rev73Toast('App-State und Tabellen sofort gespeichert.'); return true;}
    catch(error){if(showToast)rev73Toast('Speichern fehlgeschlagen: '+(error.message||error)); return false;}
  };
  persist=function(){
    if(currentUser){try{localStorage.setItem(storeKey,JSON.stringify(uiStateOnly()));}catch(e){}}
    else{try{localStorage.removeItem(storeKey);}catch(e){}}
    if(cloudReady&&currentUser&&!suppressCloudSave){clearTimeout(cloudSaveTimer);cloudSaveTimer=setTimeout(()=>rev73SaveAppStateOnly().catch(console.error),400);scheduleRelationalSave();}
  };

  // Kalendergruppe: erst DB speichern, dann Modal schließen und rendern.
  window.openAddCalendarModal=openAddCalendarModal=function(){
    if(!requireLogin())return;
    $('#saveModal').style.display='';$('#modalTitle').textContent='Kalender hinzufügen';
    $('#modalContent').innerHTML='<input id="mNewCalName" placeholder="Kalendername, z. B. Geschäftskalender"><div class="hint">Die Kalendergruppe wird sofort in calendar_groups gespeichert.</div>';
    $('#modalBackdrop').style.display='flex';
    setTimeout(()=>$('#mNewCalName')?.focus(),0);
    $('#saveModal').onclick=async()=>{
      const name=$('#mNewCalName')?.value.trim()||`Kalender ${(state.calendars||[]).length+1}`;
      const cal={id:crypto.randomUUID(),dbId:null,name,links:[],events:[],ownEvents:[],status:'Gespeichert.',visible:true,collapsed:true};
      try{await rev73Upsert('calendar_groups',rev73CalendarGroupRow(cal,(state.calendars||[]).length));state.calendars.push(cal);closeModal();render();rev73Toast('Kalendergruppe gespeichert.');}
      catch(error){rev73Toast('Kalendergruppe konnte nicht gespeichert werden: '+(error.message||error));}
    };
    $('#modalContent').onkeydown=e=>{if(e.key==='Enter'&&e.target.tagName!=='TEXTAREA'){e.preventDefault();$('#saveModal').click();}};
  };

  // Tagestask-Gruppe: neue Gruppen und Umbenennungen sofort in task_groups speichern.
  window.openTaskColumnModal=openTaskColumnModal=function(idx){
    if(!requireLogin())return;ensureSettings();
    const isNew=idx===null||idx===undefined; const group=isNew?{id:crypto.randomUUID(),name:'',color:state.colors.task||defaultColors.task,visible:true}:state.taskColumns[idx];
    $('#saveModal').style.display='';$('#modalTitle').textContent=isNew?'Tagestask-Gruppe hinzufügen':'Tagestask-Gruppe bearbeiten';
    $('#modalContent').innerHTML=`<input id="mTaskColName" value="${escapeHtml(group.name||'')}" placeholder="Name, z. B. Geschäftlich"><div class="field"><label>Farbe</label><input id="mTaskColColor73" type="color" value="${escapeHtml(group.color||state.colors.task||defaultColors.task)}"></div><div class="hint">Speichern schreibt sofort in task_groups.</div>`;
    $('#modalBackdrop').style.display='flex'; setTimeout(()=>$('#mTaskColName')?.focus(),0);
    $('#saveModal').onclick=async()=>{
      group.name=$('#mTaskColName')?.value.trim()||'Neue Gruppe'; group.color=$('#mTaskColColor73')?.value||group.color||state.colors.task||defaultColors.task;
      try{await rev73Upsert('task_groups',rev73TaskGroupRow(group,isNew?(state.taskColumns||[]).length:idx)); if(isNew)state.taskColumns.push(group); closeModal();render();rev73Toast('Tagestask-Gruppe gespeichert.');}
      catch(error){rev73Toast('Tagestask-Gruppe konnte nicht gespeichert werden: '+(error.message||error));}
    };
    $('#modalContent').onkeydown=e=>{if(e.key==='Enter'&&e.target.tagName!=='TEXTAREA'){e.preventDefault();$('#saveModal').click();}};
  };

  // Langfristige Gruppe: analog sofort speichern.
  window.openLongColumnModal=openLongColumnModal=function(idx){
    if(!requireLogin())return;ensureRev033State();
    const isNew=idx===null||idx===undefined; const group=isNew?{id:crypto.randomUUID(),name:'',color:state.colors.long||defaultColors.long,visible:true}:state.longColumns[idx];
    $('#saveModal').style.display='';$('#modalTitle').textContent=isNew?'Langfristige Gruppe hinzufügen':'Langfristige Gruppe bearbeiten';
    $('#modalContent').innerHTML=`<input id="mLongColName" value="${escapeHtml(group.name||'')}" placeholder="Name, z. B. Geschäftlich"><div class="field"><label>Farbe</label><input id="mLongColColor73" type="color" value="${escapeHtml(group.color||state.colors.long||defaultColors.long)}"></div><div class="hint">Speichern schreibt sofort in long_task_groups.</div>`;
    $('#modalBackdrop').style.display='flex'; setTimeout(()=>$('#mLongColName')?.focus(),0);
    $('#saveModal').onclick=async()=>{
      group.name=$('#mLongColName')?.value.trim()||'Neue Gruppe'; group.color=$('#mLongColColor73')?.value||group.color||state.colors.long||defaultColors.long;
      try{await rev73Upsert('long_task_groups',rev73LongGroupRow(group,isNew?(state.longColumns||[]).length:idx)); if(isNew)state.longColumns.push(group); closeModal();render();rev73Toast('Langfristige Gruppe gespeichert.');}
      catch(error){rev73Toast('Langfristige Gruppe konnte nicht gespeichert werden: '+(error.message||error));}
    };
    $('#modalContent').onkeydown=e=>{if(e.key==='Enter'&&e.target.tagName!=='TEXTAREA'){e.preventDefault();$('#saveModal').click();}};
  };

  // Neue ICS-/eigene Quellen: vorhandene Gruppe vorher absichern, Quelle direkt speichern.
  window.openICSModal=openICSModal=function(pane){
    if(!requireLogin())return; const cal=state.calendars[pane]; if(!cal)return;
    $('#saveModal').style.display='';$('#modalTitle').textContent=`ICS-Link hinzufügen · ${escapeHtml(cal.name)}`;
    $('#modalContent').innerHTML='<input id="mName" placeholder="Name, z. B. Privat Kalender"><input id="mUrl" placeholder="webcal://... oder https://.../calendar.ics"><div class="hint">Die Quelle wird sofort in calendar_sources gespeichert.</div>';
    $('#modalBackdrop').style.display='flex'; setTimeout(()=>$('#mName')?.focus(),0);
    $('#saveModal').onclick=async()=>{
      const name=$('#mName')?.value.trim()||'ICS Kalender'; const url=normalizeICSUrl($('#mUrl')?.value.trim()||''); if(!url)return rev73Toast('Kein ICS-Link gespeichert.');
      const src={id:crypto.randomUUID(),type:'ics',name,url,color:state.colors?.event||defaultColors.event,visible:true};
      try{await rev73Upsert('calendar_groups',rev73CalendarGroupRow(cal,pane));await rev73Upsert('calendar_sources',rev73CalendarSourceRow(cal,src,(cal.links||[]).length));cal.links=cal.links||[];cal.links.push(src);closeModal();render();await loadICS(pane);rev73Toast('ICS-Kalenderquelle gespeichert.');}
      catch(error){rev73Toast('ICS-Quelle konnte nicht gespeichert werden: '+(error.message||error));}
    };
  };
  window.openCreateOwnSourceModal=openCreateOwnSourceModal=function(pane){
    if(!requireLogin())return; const cal=state.calendars[pane]; if(!cal)return;
    $('#saveModal').style.display='';$('#modalTitle').textContent=`Eigenen Kalender hinzufügen · ${escapeHtml(cal.name)}`;
    $('#modalContent').innerHTML='<input id="mOwnName" placeholder="Name, z. B. Eigene Termine"><div class="hint">Der eigene Kalender wird sofort in calendar_sources gespeichert.</div>';
    $('#modalBackdrop').style.display='flex'; setTimeout(()=>$('#mOwnName')?.focus(),0);
    $('#saveModal').onclick=async()=>{
      const src={id:crypto.randomUUID(),type:'own',name:$('#mOwnName')?.value.trim()||'Eigener Kalender',url:null,color:state.colors?.event||defaultColors.event,visible:true};
      try{await rev73Upsert('calendar_groups',rev73CalendarGroupRow(cal,pane));await rev73Upsert('calendar_sources',rev73CalendarSourceRow(cal,src,(cal.links||[]).length));cal.links=cal.links||[];cal.links.push(src);closeModal();render();rev73Toast('Eigener Kalender gespeichert.');}
      catch(error){rev73Toast('Eigener Kalender konnte nicht gespeichert werden: '+(error.message||error));}
    };
  };

  // Reload-Button: vor dem Laden noch ausstehende lokale Änderungen in Tabellen sichern.
  const oldReload73=window.reloadDatabaseDataRev044||reloadDatabaseDataRev044;
  window.reloadDatabaseDataRev044=reloadDatabaseDataRev044=async function(){
    if(!requireLogin())return;
    try{await saveRelationalSnapshot();}catch(e){rev73Toast('Vor dem Neuladen konnte nicht gespeichert werden: '+(e.message||e));return;}
    return oldReload73.apply(this,arguments);
  };
  setTimeout(()=>{const btn=document.querySelector('#reloadDbBtn'); if(btn)btn.onclick=reloadDatabaseDataRev044;},300);
})();

/* Rev 074: globale Sofort-Speicherung für Fachobjekte + Zeitstrahl farbneutral */
(function(){
  const r74LogPrefix='Rev074';
  function r74Toast(msg){try{toast(msg);}catch(e){console.log(msg);}}
  function r74Status(msg,type='ok'){
    try{if(typeof setCloudStatus==='function')setCloudStatus(msg,type);}catch(e){}
    const diag=document.querySelector('#diagBox'); if(diag)diag.textContent=msg;
  }
  function r74Uuid(obj){if(obj && (!obj.id || !isUuid(obj.id)))obj.id=crypto.randomUUID();return obj?.id;}
  function r74Title(v,fallback='Aufgabe'){return String(v||'').trim()||fallback;}
  async function r74Upsert(table,rows){
    const arr=Array.isArray(rows)?rows:[rows];
    if(!arr.length)return;
    const {error}=await supabaseClient.from(table).upsert(arr,{onConflict:'id'});
    if(error)throw error;
  }
  function r74AppState(){
    try{return typeof uiStateOnly==='function'?uiStateOnly():{days:state.days,dayRows:state.dayRows,startMode:state.startMode,offset:state.offset,theme:state.theme,cornerStyle:state.cornerStyle,colors:state.colors,viewModes:state.viewModes,activeViewMode:state.activeViewMode,configCollapsed:state.configCollapsed,sidebarCollapsed:state.sidebarCollapsed,weekendHighlight:state.weekendHighlight,vacationHighlight:state.vacationHighlight,todayHighlight:state.todayHighlight,timelineDayOffset:state.timelineDayOffset};}
    catch(_){return {};}
  }
  async function r74SaveAppStateOnly(){
    if(!currentUser)return false;
    const {error}=await supabaseClient.from('app_state').upsert({user_id:currentUser.id,state:r74AppState(),updated_at:new Date().toISOString()},{onConflict:'user_id'});
    if(error)throw error;
    try{localStorage.setItem(storeKey,JSON.stringify(r74AppState()));}catch(_){ }
    return true;
  }
  function r74CalendarGroupRow(cal,position){r74Uuid(cal);cal.dbId=cal.id;return {id:cal.id,user_id:currentUser.id,name:cal.name||'Kalender',visible:cal.visible!==false,collapsed:cal.collapsed!==false,position:Number(position||0)};}
  function r74SourceRow(cal,src,position){r74Uuid(cal);r74Uuid(src);src.calendarGroupId=cal.id;return {id:src.id,user_id:currentUser.id,calendar_group_id:cal.id,type:src.type||'ics',name:src.name||'Kalenderquelle',url:src.type==='own'?null:(src.url||null),color:src.color||state.colors?.event||defaultColors.event,visible:src.visible!==false,position:Number(position||0)};}
  function r74TaskGroupRow(g,position){r74Uuid(g);return {id:g.id,user_id:currentUser.id,name:g.name||'Neue Gruppe',color:g.color||state.colors?.task||defaultColors.task,visible:g.visible!==false,position:Number(position||0)};}
  function r74TaskRow(t,position){r74Uuid(t);return {id:t.id,user_id:currentUser.id,task_group_id:isUuid(t.columnId)?t.columnId:null,title:r74Title(t.title),note:t.note||null,task_date:t.date||fmtDate(new Date()),done:!!t.done,completed_date:t.completedDate||null,position:Number(position||0)};}
  function r74LongGroupRow(g,position){r74Uuid(g);return {id:g.id,user_id:currentUser.id,name:g.name||'Neue Gruppe',color:g.color||state.colors?.long||defaultColors.long,visible:g.visible!==false,position:Number(position||0)};}
  function r74LongTaskRow(t,position){r74Uuid(t);return {id:t.id,user_id:currentUser.id,long_task_group_id:isUuid(t.columnId)?t.columnId:null,title:r74Title(t.title),note:t.note||null,done:!!t.done,completed_date:t.completedDate||null,position:Number(position||0)};}
  function r74OwnEventRow(e){r74Uuid(e);return {id:e.id,user_id:currentUser.id,calendar_source_id:e.sourceId,title:r74Title(e.summary||e.title,'Termin'),location:e.location||null,description:e.description||null,start_time:e.start,end_time:e.end||null,all_day:!!e.allDay,recurrence:e.recurrence||'none',travel_time:e.travelTime||null,status:e.status||'active'};}
  function r74ProjectRow(p,position){r74Uuid(p);return {id:p.id,user_id:currentUser.id,name:p.name||'Neues Projekt',description:p.description||null,color:p.color||'#7c5cff',sort_order:Number(p.sortOrder ?? p.sort_order ?? position ?? 0),is_archived:!!(p.isArchived||p.is_archived)};}
  function r74ProjectTaskRow(t,position){r74Uuid(t);return {id:t.id,user_id:currentUser.id,project_id:t.projectId||t.project_id,title:r74Title(t.title),note:t.note||null,due_date:t.dueDate||t.due_date||null,done:!!t.done,completed_date:t.completedDate||t.completed_date||null,sort_order:Number(t.sortOrder ?? t.sort_order ?? position ?? 0)};}

  // Vollständiger Snapshot: UI-State + alle aktiven Fachobjekte. Keine automatische Löschung, damit nichts versehentlich entfernt wird.
  window.saveRelationalSnapshot=saveRelationalSnapshot=async function(){
    if(!currentUser||suppressCloudSave)return false;
    if(relationalSaveRunning){relationalSaveQueued=true;return false;}
    relationalSaveRunning=true;
    try{
      ensureSettings();
      if(typeof ensureProjectsRev047==='function')ensureProjectsRev047();
      const calRows=(state.calendars||[]).map((c,i)=>r74CalendarGroupRow(c,i));
      const sourceRows=[];(state.calendars||[]).forEach(c=>(c.links||[]).forEach((s,i)=>sourceRows.push(r74SourceRow(c,s,i))));
      const taskGroupRows=(state.taskColumns||[]).map((g,i)=>r74TaskGroupRow(g,i));
      const taskRows=(state.tasks||[]).map((t,i)=>r74TaskRow(t,i));
      const longGroupRows=(state.longColumns||[]).map((g,i)=>r74LongGroupRow(g,i));
      const longRows=(state.longterm||[]).map((t,i)=>r74LongTaskRow(t,i));
      const ownRows=[];(state.calendars||[]).forEach(c=>(c.ownEvents||[]).forEach(e=>ownRows.push(r74OwnEventRow(e))));
      const projectRows=(state.projects||[]).map((p,i)=>r74ProjectRow(p,i));
      const projectTaskRows=(state.projectTasks||[]).filter(t=>t.projectId||t.project_id).map((t,i)=>r74ProjectTaskRow(t,i));
      await r74Upsert('calendar_groups',calRows); await r74Upsert('calendar_sources',sourceRows);
      await r74Upsert('task_groups',taskGroupRows); await r74Upsert('tasks',taskRows);
      await r74Upsert('long_task_groups',longGroupRows); await r74Upsert('long_tasks',longRows);
      await r74Upsert('own_events',ownRows); await r74Upsert('projects',projectRows); await r74Upsert('project_tasks',projectTaskRows);
      await r74SaveAppStateOnly();
      r74Status('Sofort gespeichert: '+new Date().toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'}),'ok');
      return true;
    }catch(error){
      console.error(r74LogPrefix+' Sofortspeicherung fehlgeschlagen',error);
      r74Status('Sofort-Speichern fehlgeschlagen: '+(error.message||error),'bad');
      throw error;
    }finally{
      relationalSaveRunning=false;
      if(relationalSaveQueued){relationalSaveQueued=false;setTimeout(()=>saveRelationalSnapshot().catch(console.error),80);}
    }
  };
  window.hardSaveRev70=async function(showToast=true){
    if(!currentUser){if(showToast)r74Toast('Nicht angemeldet. Speicherung nicht möglich.');return false;}
    try{await saveRelationalSnapshot();if(showToast)r74Toast('Alles sofort gespeichert.');return true;}
    catch(error){if(showToast)r74Toast('Speichern fehlgeschlagen: '+(error.message||error));return false;}
  };
  window.scheduleRelationalSave=scheduleRelationalSave=function(){
    if(!currentUser||suppressCloudSave)return;
    clearTimeout(relationalSaveTimer);
    relationalSaveTimer=setTimeout(()=>saveRelationalSnapshot().catch(console.error),60);
  };
  persist=function(){
    if(currentUser){try{localStorage.setItem(storeKey,JSON.stringify(r74AppState()));}catch(_){ }}
    else{try{localStorage.removeItem(storeKey);}catch(_){ }}
    if(cloudReady&&currentUser&&!suppressCloudSave){clearTimeout(cloudSaveTimer);cloudSaveTimer=setTimeout(()=>r74SaveAppStateOnly().catch(console.error),180);scheduleRelationalSave();}
  };
  function r74AfterMutation(){setTimeout(()=>saveRelationalSnapshot().catch(console.error),20);}

  // Direkte Speicherpfade für neu erstellte Hauptobjekte.
  window.openTaskModal=openTaskModal=function(date=fmtDate(new Date())){
    if(!requireLogin())return;ensureSettings();
    openModal('Tagestask hinzufügen',`<input id="mTitle" placeholder="Aufgabe"><select id="mTaskColumn">${state.taskColumns.map(c=>`<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`).join('')}</select><input id="mDate" type="date" value="${date}"><textarea id="mNote" rows="3" placeholder="Notiz / Kontext"></textarea><div class="hint">Wird sofort in tasks gespeichert. Ohne Titel wird „Aufgabe“ verwendet. Enter speichert, Shift+Enter erzeugt einen Zeilenumbruch.</div>`,async()=>{
      const t={id:crypto.randomUUID(),title:r74Title($('#mTitle')?.value),date:$('#mDate')?.value||date,done:false,note:($('#mNote')?.value||'').trim(),columnId:$('#mTaskColumn')?.value};
      try{await r74Upsert('tasks',r74TaskRow(t,(state.tasks||[]).length));state.tasks.push(t);render();r74Toast('Tagestask gespeichert.');}
      catch(error){r74Toast('Tagestask konnte nicht gespeichert werden: '+(error.message||error));}
    });
  };
  window.openLongModal=openLongModal=function(){
    if(!requireLogin())return;ensureSettings();
    const groups=state.longColumns&&state.longColumns.length?state.longColumns:[{id:'long_default',name:'Allgemein'}];
    openModal('Langfristigen Task hinzufügen',`<input id="mTitle" placeholder="Langfristiger Task"><select id="mLongColumn">${groups.map(c=>`<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`).join('')}</select><textarea id="mNote" rows="3" placeholder="Notiz"></textarea><div class="hint">Wird sofort in long_tasks gespeichert. Ohne Titel wird „Aufgabe“ verwendet. Enter speichert, Shift+Enter erzeugt einen Zeilenumbruch.</div>`,async()=>{
      const t={id:crypto.randomUUID(),title:r74Title($('#mTitle')?.value),done:false,note:($('#mNote')?.value||'').trim(),createdDate:fmtDate(new Date()),completedDate:null,columnId:$('#mLongColumn')?.value||groups[0]?.id};
      try{await r74Upsert('long_tasks',r74LongTaskRow(t,(state.longterm||[]).length));state.longterm.push(t);render();r74Toast('Langfristiger Task gespeichert.');}
      catch(error){r74Toast('Langfristiger Task konnte nicht gespeichert werden: '+(error.message||error));}
    });
  };
  if(typeof openProjectModalRev047==='function'){
    window.openProjectModalRev047=openProjectModalRev047=function(id){
      if(!requireLogin())return;if(typeof ensureProjectsRev047==='function')ensureProjectsRev047();
      const isNew=!id; const p=isNew?{id:crypto.randomUUID(),name:'',description:'',color:'#7c5cff',sortOrder:(state.projects||[]).length,isArchived:false}:((state.projects||[]).find(x=>String(x.id)===String(id))||null);
      if(!p)return r74Toast('Projekt nicht gefunden.');
      openModal(isNew?'Projekt hinzufügen':'Projekt bearbeiten',`<input id="mProjectName" value="${escapeHtml(p.name||'')}" placeholder="Projektname"><textarea id="mProjectDesc" rows="4" placeholder="Beschreibung / Kontext">${escapeHtml(p.description||'')}</textarea><div class="field"><label>Projektfarbe</label><input id="mProjectColor74" type="color" value="${escapeHtml(p.color||'#7c5cff')}"></div><div class="hint">Projekt wird sofort in projects gespeichert.</div>`,async()=>{
        p.name=r74Title($('#mProjectName')?.value,'Neues Projekt');p.description=($('#mProjectDesc')?.value||'').trim();p.color=$('#mProjectColor74')?.value||p.color||'#7c5cff';
        try{await r74Upsert('projects',r74ProjectRow(p,isNew?(state.projects||[]).length:(state.projects||[]).findIndex(x=>String(x.id)===String(p.id))));if(isNew)state.projects.push(p);closeModal();render();r74Toast('Projekt gespeichert.');}
        catch(error){r74Toast('Projekt konnte nicht gespeichert werden: '+(error.message||error));}
      });
    };
  }
  if(typeof openProjectTaskModalRev047==='function'){
    window.openProjectTaskModalRev047=openProjectTaskModalRev047=function(projectId){
      if(!requireLogin())return;if(typeof ensureProjectsRev047==='function')ensureProjectsRev047();
      const p=(state.projects||[]).find(x=>String(x.id)===String(projectId));if(!p)return r74Toast('Projekt nicht gefunden.');
      openModal(`Projekt-Task hinzufügen · ${escapeHtml(p.name)}`,`<input id="mProjectTaskTitle" placeholder="Aufgabe"><input id="mProjectTaskDue" type="date"><textarea id="mProjectTaskNote" rows="4" placeholder="Notiz / Kontext"></textarea><div class="hint">Wird sofort in project_tasks gespeichert. Ohne Titel wird „Aufgabe“ verwendet.</div>`,async()=>{
        const t={id:crypto.randomUUID(),projectId:p.id,title:r74Title($('#mProjectTaskTitle')?.value),dueDate:$('#mProjectTaskDue')?.value||null,note:($('#mProjectTaskNote')?.value||'').trim(),done:false,completedDate:null,sortOrder:(state.projectTasks||[]).length};
        try{await r74Upsert('project_tasks',r74ProjectTaskRow(t,t.sortOrder));state.projectTasks.push(t);render();r74Toast('Projekt-Task gespeichert.');}
        catch(error){r74Toast('Projekt-Task konnte nicht gespeichert werden: '+(error.message||error));}
      });
    };
  }
  if(typeof openOwnEventModal==='function'){
    window.openOwnEventModal=openOwnEventModal=function(pane,date=fmtDate(new Date())){
      if(!requireLogin())return;ensureSettings();
      const cal=state.calendars[pane];const ownSources=(cal?.links||[]).filter(l=>l.type==='own'&&l.visible!==false);
      if(!cal||!ownSources.length)return r74Toast('Kein eigener Kalender sichtbar. Füge zuerst einen eigenen Kalender hinzu.');
      openModal(`Termin hinzufügen · ${escapeHtml(cal.name)}`,`<input id="mEventTitle" placeholder="Titel des Termins"><select id="mEventSource">${ownSources.map(l=>`<option value="${escapeHtml(l.id)}">${escapeHtml(l.name)}</option>`).join('')}</select><input id="mEventLocation" placeholder="Ort"><div class="field"><label>Datum</label><input id="mEventDate" type="date" value="${date}"></div><div class="field"><label>Wiederholung</label><select id="mEventRecurrence"><option value="none">Keine Wiederholung</option><option value="weekly">Wöchentlich</option><option value="monthly">Monatlich</option><option value="yearly">Jährlich</option></select></div><div class="field"><label>Ganztägig</label><select id="mEventAllDay"><option value="false">Nein</option><option value="true">Ja</option></select></div><div class="field"><label>Startzeit</label><input id="mEventStart" type="time" value="09:00"></div><div class="field"><label>Endzeit</label><input id="mEventEnd" type="time" value="10:00"></div><input id="mEventTravel" placeholder="Wegzeit, z. B. 20 Min."><textarea id="mEventDescription" rows="4" placeholder="Details / Notizen"></textarea><div class="hint">Wird sofort in own_events gespeichert. Ohne Titel wird „Termin“ verwendet.</div>`,async()=>{
        const sourceId=$('#mEventSource')?.value;const src=ownSources.find(l=>l.id===sourceId)||ownSources[0];const d=$('#mEventDate')?.value||date;const allDay=$('#mEventAllDay')?.value==='true';const st=$('#mEventStart')?.value||'00:00';const en=$('#mEventEnd')?.value||st;
        const event={id:crypto.randomUUID(),sourceId,summary:r74Title($('#mEventTitle')?.value,'Termin'),location:($('#mEventLocation')?.value||'').trim(),start:(allDay?new Date(d+'T00:00:00'):new Date(d+'T'+st+':00')).toISOString(),end:(allDay?new Date(d+'T23:59:00'):new Date(d+'T'+en+':00')).toISOString(),allDay,recurrence:$('#mEventRecurrence')?.value||'none',source:src?.name||cal.name,icsName:src?.name||cal.name,icsColor:src?.color||state.colors.event,travelTime:($('#mEventTravel')?.value||'').trim(),description:($('#mEventDescription')?.value||'').trim(),manual:true,status:'active'};
        try{await r74Upsert('own_events',r74OwnEventRow(event));cal.ownEvents=cal.ownEvents||[];cal.ownEvents.push(event);render();r74Toast('Eigener Termin gespeichert.');}
        catch(error){r74Toast('Eigener Termin konnte nicht gespeichert werden: '+(error.message||error));}
      });
    };
  }

  // Auch Änderungen/Checkboxen/Deletes werden nach dem Rendern kurzfristig in alle Tabellen gespiegelt.
  const oldRender74=window.render||render;
  window.render=render=function(){const result=oldRender74.apply(this,arguments);if(currentUser&&!suppressCloudSave)setTimeout(()=>saveRelationalSnapshot().catch(console.error),40);setTimeout(r74CleanTimeline,0);setTimeout(r74CleanTimeline,80);return result;};
  document.addEventListener('change',ev=>{if(ev.target&&ev.target.closest('.app,.modal'))r74AfterMutation();},true);
  document.addEventListener('click',ev=>{if(ev.target&&ev.target.closest('[data-delete-task],[data-delete-long],[data-delete-project],[data-delete-project-task],[data-toggle-task],[data-toggle-long],[data-toggle-project-task],#prevBtn,#todayBtn,#nextBtn,#timelinePrevDay52,#timelineToday52,#timelineNextDay52')){setTimeout(r74CleanTimeline,0);setTimeout(r74CleanTimeline,80);r74AfterMutation();}},true);

  // Zeitstrahl vollständig aus Urlaub-/Wochenend-/Heute-Färbung herausnehmen.
  function r74CleanTimeline(){
    const host=document.querySelector('#sidebarDayTimelineRev049');
    const wrap=host?.querySelector('.timeline-canvas-wrap');
    const canvas=host?.querySelector('.timeline-canvas');
    [host,wrap,canvas].filter(Boolean).forEach(el=>{
      el.classList.remove('vacation-active','vacation-day-rev52','rev64-weekend-timeline','rev65-weekend-timeline','rev66-weekend-timeline','rev68-weekend-timeline','rev70-weekend-timeline','rev71-weekend-timeline','rev72-weekend-timeline','rev68-vacation-timeline','rev70-vacation-timeline','rev71-vacation-timeline');
      el.style.background='';el.style.backgroundColor='';el.style.backgroundImage='';el.style.backgroundBlendMode='';
      el.classList.add('rev74-timeline-neutral');
    });
  }
  const oldTl74=typeof renderSidebarTimelineRev050==='function'?renderSidebarTimelineRev050:null;
  if(oldTl74){window.renderSidebarTimelineRev050=renderSidebarTimelineRev050=function(){const r=oldTl74.apply(this,arguments);setTimeout(r74CleanTimeline,0);setTimeout(r74CleanTimeline,80);setTimeout(r74CleanTimeline,200);return r;};}
  const style=document.createElement('style');
  style.textContent=`
    #sidebarDayTimelineRev049.rev74-timeline-neutral,
    #sidebarDayTimelineRev049 .timeline-canvas-wrap.rev74-timeline-neutral,
    #sidebarDayTimelineRev049 .timeline-canvas.rev74-timeline-neutral{background:#fff!important;background-color:#fff!important;background-image:none!important;background-blend-mode:normal!important;}
    #sidebarDayTimelineRev049 .timeline-canvas-wrap.rev72-weekend-timeline,
    #sidebarDayTimelineRev049 .timeline-canvas-wrap.rev71-weekend-timeline,
    #sidebarDayTimelineRev049 .timeline-canvas-wrap.rev70-weekend-timeline,
    #sidebarDayTimelineRev049 .timeline-canvas-wrap.rev68-weekend-timeline,
    #sidebarDayTimelineRev049 .timeline-canvas-wrap.rev68-vacation-timeline,
    #sidebarDayTimelineRev049 .timeline-canvas-wrap.rev70-vacation-timeline,
    #sidebarDayTimelineRev049 .timeline-canvas-wrap.vacation-active{background:#fff!important;background-color:#fff!important;background-image:none!important;}
  `;
  document.head.appendChild(style);
  setTimeout(r74CleanTimeline,100);setTimeout(r74CleanTimeline,600);
})();

/* Rev075 stability patch: immediate persistence, unified deletion, modal cleanup, neutral timeline, settings color buckets */
(function(){
  const $r75=(s,root=document)=>root.querySelector(s);
  const $$r75=(s,root=document)=>Array.from(root.querySelectorAll(s));
  const R75_DELETE_SELECTORS='[data-delete-task],[data-delete-long],[data-delete-project-task],[data-delete-project]';
  let r75SaveTimer=null;
  let r75SaveRunning=false;
  let r75SaveQueued=false;

  function r75Toast(msg){try{typeof toast==='function'?toast(msg):console.warn(msg);}catch(_){console.warn(msg);}}
  function r75CurrentUser(){try{return typeof currentUser!=='undefined'&&currentUser?currentUser:null;}catch(_){return null;}}
  async function r75FlushPersistence(reason='change'){
    const user=r75CurrentUser();
    if(!user)return;
    if(r75SaveRunning){r75SaveQueued=true;return;}
    r75SaveRunning=true;
    try{
      if(typeof saveRelationalSnapshot==='function')await saveRelationalSnapshot();
      if(typeof saveStateToCloud==='function')await saveStateToCloud();
      if(typeof persist==='function')persist();
      const diag=$r75('#diagBox');
      if(diag)diag.textContent='Gespeichert: '+new Date().toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'})+' · '+reason;
    }catch(error){
      console.error('Rev075 Sofort-Speicherung fehlgeschlagen:',error);
      r75Toast('Speichern fehlgeschlagen: '+(error?.message||error));
    }finally{
      r75SaveRunning=false;
      if(r75SaveQueued){r75SaveQueued=false;r75SchedulePersistence('Nachlauf');}
    }
  }
  function r75SchedulePersistence(reason='Änderung'){
    clearTimeout(r75SaveTimer);
    r75SaveTimer=setTimeout(()=>r75FlushPersistence(reason),120);
  }
  window.r75FlushPersistence=r75FlushPersistence;

  async function r75DeleteFromTable(table,id){
    const user=r75CurrentUser();
    if(!user||!id||typeof supabaseClient==='undefined')return;
    try{await supabaseClient.from(table).delete().eq('user_id',user.id).eq('id',id);}catch(error){console.warn('Delete fehlgeschlagen',table,id,error);}
  }
  function r75LabelForDelete(btn){
    if(btn.matches('[data-delete-long]'))return 'Langfristigen Task wirklich löschen?';
    if(btn.matches('[data-delete-project-task]'))return 'Projekt-Task wirklich löschen?';
    if(btn.matches('[data-delete-project]'))return 'Projekt wirklich löschen? Zugehörige Projekt-Tasks können davon betroffen sein.';
    return 'Task wirklich löschen?';
  }
  function r75BindUnifiedDeletes(scope=document){
    $$r75(R75_DELETE_SELECTORS,scope).forEach(btn=>{
      if(btn.dataset.r75UnifiedDelete==='1')return;
      btn.dataset.r75UnifiedDelete='1';
      const oldTitle=btn.title||'';
      btn.title=oldTitle||'Löschen';
      btn.onclick=async function(ev){
        ev.preventDefault();ev.stopPropagation();if(ev.stopImmediatePropagation)ev.stopImmediatePropagation();
        if(typeof requireLogin==='function'&&!requireLogin())return false;
        if(!confirm(r75LabelForDelete(btn)))return false;
        try{
          if(btn.dataset.deleteTask){
            const id=btn.dataset.deleteTask;
            if(Array.isArray(state.tasks))state.tasks=state.tasks.filter(x=>String(x.id)!==String(id));
            await r75DeleteFromTable('tasks',id);
          }else if(btn.dataset.deleteLong){
            const id=btn.dataset.deleteLong;
            if(Array.isArray(state.longterm))state.longterm=state.longterm.filter(x=>String(x.id)!==String(id));
            await r75DeleteFromTable('long_tasks',id);
          }else if(btn.dataset.deleteProjectTask){
            const id=btn.dataset.deleteProjectTask;
            if(Array.isArray(state.projectTasks))state.projectTasks=state.projectTasks.filter(x=>String(x.id)!==String(id));
            if(typeof deleteProjectTaskRev047==='function')await deleteProjectTaskRev047(id);else await r75DeleteFromTable('project_tasks',id);
          }else if(btn.dataset.deleteProject){
            const id=btn.dataset.deleteProject;
            if(Array.isArray(state.projects))state.projects=state.projects.filter(x=>String(x.id)!==String(id));
            if(Array.isArray(state.projectTasks))state.projectTasks=state.projectTasks.filter(x=>String(x.projectId)!==String(id)&&String(x.project_id)!==String(id));
            await r75DeleteFromTable('project_tasks',id);
            await r75DeleteFromTable('projects',id);
          }
          if(typeof render==='function')render();
          await r75FlushPersistence('Löschung');
          r75Toast('Gelöscht und gespeichert.');
        }catch(error){
          console.error(error);
          r75Toast('Löschen fehlgeschlagen: '+(error?.message||error));
        }
        return false;
      };
    });
  }

  function r75ResetModalBeforeOpen(){
    const save=$r75('#saveModal');
    const content=$r75('#modalContent');
    if(save){save.style.display='';save.onclick=null;delete save.dataset.r75Wrapped;}
    if(content){content.onkeydown=null;}
    $$r75('.r75-transient-delete,.mode-delete-action,#deleteModeBtnAction').forEach(x=>x.remove());
  }
  if(typeof openModal==='function'){
    const oldOpenModal75=openModal;
    window.openModal=openModal=function(){
      r75ResetModalBeforeOpen();
      const result=oldOpenModal75.apply(this,arguments);
      setTimeout(r75AfterUiUpdate,0);
      setTimeout(r75WrapSaveButton,0);
      return result;
    };
  }
  if(typeof closeModal==='function'){
    const oldCloseModal75=closeModal;
    window.closeModal=closeModal=function(){
      const result=oldCloseModal75.apply(this,arguments);
      const save=$r75('#saveModal');
      const content=$r75('#modalContent');
      if(save){save.onclick=null;delete save.dataset.r75Wrapped;save.style.display='';}
      if(content){content.onkeydown=null;}
      return result;
    };
  }

  function r75WrapSaveButton(){
    const save=$r75('#saveModal');
    if(!save||save.dataset.r75Wrapped==='1')return;
    const original=save.onclick;
    if(typeof original!=='function')return;
    save.dataset.r75Wrapped='1';
    save.onclick=function(ev){
      const r=original.call(this,ev);
      Promise.resolve(r).finally(()=>{setTimeout(()=>r75FlushPersistence('Speichern'),80);setTimeout(r75AfterUiUpdate,40);});
      return r;
    };
  }

  function r75NeutralizeTimeline(){
    const selectors=['#sidebarDayTimelineRev049','#sidebarDayTimelineRev049 .timeline-canvas-wrap','#sidebarDayTimelineRev049 .timeline-canvas','.sidebar-day-timeline','.timeline-canvas-wrap','.timeline-canvas'];
    selectors.forEach(sel=>$$r75(sel).forEach(el=>{
      el.classList.remove('vacation-active','vacation-day-rev52','rev64-weekend-timeline','rev65-weekend-timeline','rev66-weekend-timeline','rev68-weekend-timeline','rev70-weekend-timeline','rev71-weekend-timeline','rev72-weekend-timeline','rev68-vacation-timeline','rev70-vacation-timeline','rev71-vacation-timeline','rev72-vacation-timeline');
      el.classList.add('r75-timeline-neutral');
      el.style.background='#fff';
      el.style.backgroundColor='#fff';
      el.style.backgroundImage='none';
      el.style.backgroundBlendMode='normal';
    }));
  }
  function r75DecorateColorInputs(){
    const ids=['mOutlineColor71','mWeekendColor71','mVacationColor71','mTodayBorderColor71','mProjectColor74','mTaskColColor73','mLongColColor73','mIcsColor71'];
    ids.forEach(id=>{
      const input=$r75('#'+id);
      if(!input||input.dataset.r75Bucket==='1')return;
      input.dataset.r75Bucket='1';
      input.classList.add('r75-color-bucket-input');
      const wrap=document.createElement('span');
      wrap.className='r75-color-bucket-wrap';
      wrap.title='Farbe auswählen';
      const icon=document.createElement('span');
      icon.className='r75-color-bucket-icon';
      icon.innerHTML=iconPalette();
      input.parentNode.insertBefore(wrap,input);
      wrap.appendChild(icon);
      wrap.appendChild(input);
    });
  }
  function r75AfterUiUpdate(){
    r75NeutralizeTimeline();
    r75BindUnifiedDeletes(document);
    r75DecorateColorInputs();
    r75WrapSaveButton();
  }

  // Make refresh safe: save first, then let existing refresh/load logic run.
  function r75PatchRefresh(){
    ['#reloadDbBtn','#prevBtn','#todayBtn','#nextBtn','#timelinePrevDay52','#timelineToday52','#timelineNextDay52'].forEach(sel=>{
      const btn=$r75(sel);
      if(!btn||btn.dataset.r75Patched==='1')return;
      btn.dataset.r75Patched='1';
      btn.addEventListener('click',()=>{r75NeutralizeTimeline();r75SchedulePersistence(sel==='\#reloadDbBtn'?'Refresh':'Navigation');setTimeout(r75NeutralizeTimeline,30);setTimeout(r75NeutralizeTimeline,160);},true);
    });
  }

  if(typeof render==='function'){
    const oldRender75=render;
    window.render=render=function(){
      const result=oldRender75.apply(this,arguments);
      setTimeout(r75AfterUiUpdate,0);
      setTimeout(r75AfterUiUpdate,80);
      setTimeout(()=>r75SchedulePersistence('Render-Änderung'),180);
      return result;
    };
  }
  if(typeof renderSidebarTimelineRev050==='function'){
    const oldTl75=renderSidebarTimelineRev050;
    window.renderSidebarTimelineRev050=renderSidebarTimelineRev050=function(){
      const result=oldTl75.apply(this,arguments);
      setTimeout(r75NeutralizeTimeline,0);setTimeout(r75NeutralizeTimeline,80);setTimeout(r75NeutralizeTimeline,240);
      return result;
    };
  }

  document.addEventListener('input',ev=>{if(ev.target&&ev.target.closest('.modal,.app')){r75SchedulePersistence('Eingabe');r75DecorateColorInputs();}},true);
  document.addEventListener('change',ev=>{if(ev.target&&ev.target.closest('.modal,.app')){r75SchedulePersistence('Änderung');setTimeout(r75AfterUiUpdate,0);}},true);
  document.addEventListener('click',ev=>{if(ev.target&&ev.target.closest('.modal,.app')){setTimeout(r75AfterUiUpdate,0);}},true);

  const observer=new MutationObserver(()=>{r75AfterUiUpdate();});
  observer.observe(document.documentElement,{childList:true,subtree:true});

  const style=document.createElement('style');
  style.textContent=`
    .r75-timeline-neutral,
    #sidebarDayTimelineRev049,
    #sidebarDayTimelineRev049 .timeline-canvas-wrap,
    #sidebarDayTimelineRev049 .timeline-canvas,
    .sidebar-day-timeline .timeline-canvas-wrap,
    .sidebar-day-timeline .timeline-canvas{
      background:#fff!important;background-color:#fff!important;background-image:none!important;background-blend-mode:normal!important;
    }
    .r75-color-bucket-wrap{display:inline-flex!important;align-items:center!important;justify-content:center!important;width:44px!important;height:42px!important;border:1px solid #cbd5e1!important;border-radius:12px!important;background:#f8fafc!important;box-shadow:0 2px 8px rgba(15,23,42,.08)!important;position:relative!important;overflow:hidden!important;vertical-align:middle!important;}
    .r75-color-bucket-icon{position:absolute!important;left:50%!important;top:50%!important;transform:translate(-50%,-50%)!important;font-size:18px!important;pointer-events:none!important;z-index:2!important;text-shadow:0 1px 2px rgba(255,255,255,.85)!important;}
    .r75-color-bucket-input{position:absolute!important;inset:0!important;width:100%!important;height:100%!important;opacity:.78!important;border:0!important;padding:0!important;cursor:pointer!important;background:transparent!important;}
    .rev71-row:has(.r75-color-bucket-wrap){grid-template-columns:minmax(155px,230px) auto!important;justify-content:start!important;}
    body.sharp-corners .r75-color-bucket-wrap{border-radius:0!important;}
  `;
  document.head.appendChild(style);

  setTimeout(()=>{r75PatchRefresh();r75AfterUiUpdate();},0);
  setTimeout(()=>{r75PatchRefresh();r75AfterUiUpdate();},600);
})();

/* Rev 076: stabile Einstellungen, Farbeimer mit separater Vorschau, flackerarme Tagesfärbung */
(function(){
  const PATCH='r76';
  const $=(s,r=document)=>r.querySelector(s);
  const $$=(s,r=document)=>Array.from(r.querySelectorAll(s));
  const esc=(v)=>String(v??'').replace(/[&<>"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));
  function isHex(v){return /^#[0-9a-f]{6}$/i.test(String(v||''));}
  function clamp(v,min,max,fb){v=Number(v);return Number.isFinite(v)?Math.max(min,Math.min(max,v)):fb;}
  function rgba(hex,opacity){
    const h=isHex(hex)?hex:'#ffd29a';
    const n=parseInt(h.slice(1),16);
    return `rgba(${(n>>16)&255},${(n>>8)&255},${n&255},${clamp(opacity,0,1,0.2)})`;
  }
  function isWeekend(d){const x=new Date(d);const day=x.getDay();return day===0||day===6;}
  function ensureR76(){
    if(typeof state==='undefined')return;
    state.weekendHighlight=Object.assign({enabled:false,color:'#ffd29a',opacity:0.24},state.weekendHighlight||{});
    state.vacationHighlight=Object.assign({enabled:false,color:'#f97316',opacity:0.18},state.vacationHighlight||{});
    state.todayHighlight=Object.assign({borderColor:'#0284c7',borderWidth:2,opacity:0.14},state.todayHighlight||{});
    state.weekendHighlight.enabled=!!state.weekendHighlight.enabled;
    state.vacationHighlight.enabled=!!state.vacationHighlight.enabled;
    state.weekendHighlight.color=isHex(state.weekendHighlight.color)?state.weekendHighlight.color:'#ffd29a';
    state.vacationHighlight.color=isHex(state.vacationHighlight.color)?state.vacationHighlight.color:'#f97316';
    state.todayHighlight.borderColor=isHex(state.todayHighlight.borderColor)?state.todayHighlight.borderColor:'#0284c7';
    state.weekendHighlight.opacity=clamp(state.weekendHighlight.opacity,0.05,0.70,0.24);
    state.vacationHighlight.opacity=clamp(state.vacationHighlight.opacity,0.05,0.55,0.18);
    state.todayHighlight.opacity=clamp(state.todayHighlight.opacity,0,0.65,0.14);
    state.todayHighlight.borderWidth=clamp(state.todayHighlight.borderWidth,1,10,2);
  }
  function setVars(){
    ensureR76();
    if(typeof state==='undefined')return;
    document.documentElement.style.setProperty('--r76WeekendBg',rgba(state.weekendHighlight.color,state.weekendHighlight.opacity));
    document.documentElement.style.setProperty('--r76VacationBg',rgba(state.vacationHighlight.color,state.vacationHighlight.opacity));
    document.documentElement.style.setProperty('--r76TodayBg',rgba(state.todayHighlight.borderColor,state.todayHighlight.opacity));
    document.documentElement.style.setProperty('--r76TodayBorder',state.todayHighlight.borderColor);
    document.documentElement.style.setProperty('--r76TodayBorderWidth',Math.round(state.todayHighlight.borderWidth)+'px');
  }
  function vacation(day){
    ensureR76();
    if(typeof state==='undefined'||!state.vacationHighlight.enabled||isWeekend(day))return false;
    try{
      if(typeof visibleCalendars!=='function'||typeof eventOccurrenceForDate!=='function')return false;
      return visibleCalendars().some(({cal})=>{
        const entries=[...(cal.events||[]),...(cal.ownEvents||[])];
        return entries.some(e=>{
          const link=(cal.links||[]).find(l=>l.id===e.icsId||l.id===e.sourceId);
          if(link&&link.visible===false)return false;
          const occ=eventOccurrenceForDate(e,day);
          return !!(occ&&occ.allDay&&String(occ.summary||occ.title||'').trim().toLowerCase()==='urlaub');
        });
      });
    }catch(_){return false;}
  }
  function clearDayClasses(el){
    if(!el)return;
    el.classList.remove('vacation-day-rev52','vacation-active','rev64-weekend-day','rev65-weekend-day','rev66-weekend-day','rev68-weekend-day','rev70-weekend-day','rev71-weekend-day','rev76-weekend-day','rev66-vacation-day','rev68-vacation-day','rev70-vacation-day','rev71-vacation-day','rev76-vacation-day','rev71-today-day','rev76-today-day');
    el.classList.remove('rev64-weekend-cell','rev65-weekend-cell','rev66-weekend-cell','rev68-weekend-cell','rev70-weekend-cell','rev71-weekend-cell','rev76-weekend-cell','rev66-vacation-cell','rev68-vacation-cell','rev70-vacation-cell','rev71-vacation-cell','rev76-vacation-cell','rev71-today-cell','rev76-today-cell');
  }
  function applyDayClass(el,day,isMonth=false){
    if(!el)return;
    ensureR76();setVars();clearDayClasses(el);
    const weekend=isWeekend(day);
    if(weekend&&state.weekendHighlight.enabled)el.classList.add(isMonth?'rev76-weekend-cell':'rev76-weekend-day');
    else if(!weekend&&vacation(day))el.classList.add(isMonth?'rev76-vacation-cell':'rev76-vacation-day');
    const today=new Date();today.setHours(0,0,0,0);
    if(typeof sameDay==='function'&&sameDay(day,today))el.classList.add(isMonth?'rev76-today-cell':'rev76-today-day');
  }
  function decorateVisibleDays(){
    setVars();
    $$('.day').forEach(day=>{
      const txt=day.querySelector('.day-title-date')?.textContent||'';
      const m=txt.match(/(\d{2})\.(\d{2})\.(\d{4})/);
      if(m)applyDayClass(day,new Date(`${m[3]}-${m[2]}-${m[1]}T00:00:00`),false);
    });
    $$('[data-month-date]').forEach(cell=>applyDayClass(cell,new Date(cell.dataset.monthDate+'T00:00:00'),true));
    neutralTimeline();
  }
  function neutralTimeline(){
    ['#sidebarDayTimelineRev049','#sidebarDayTimelineRev049 .timeline-canvas-wrap','#sidebarDayTimelineRev049 .timeline-canvas','.sidebar-day-timeline','.timeline-canvas-wrap','.timeline-canvas'].forEach(sel=>{
      $$(sel).forEach(el=>{
        el.classList.remove('vacation-active','vacation-day-rev52','rev64-weekend-timeline','rev65-weekend-timeline','rev66-weekend-timeline','rev68-weekend-timeline','rev70-weekend-timeline','rev71-weekend-timeline','rev72-weekend-timeline','rev76-weekend-timeline','rev68-vacation-timeline','rev70-vacation-timeline','rev71-vacation-timeline','rev72-vacation-timeline','rev76-vacation-timeline');
        el.classList.add('r76-timeline-neutral');
        el.style.background='#fff';el.style.backgroundColor='#fff';el.style.backgroundImage='none';el.style.backgroundBlendMode='normal';
      });
    });
  }
  function colorControl(id,value){
    return `<span class="r76-color-control"><button class="r76-color-button" type="button" data-color-button="${id}" title="Farbe auswählen">${iconPalette()}</button><span class="r76-color-preview" data-color-preview="${id}" style="background:${esc(value)}"></span><input id="${id}" class="r76-color-input" type="color" value="${esc(value)}"></span>`;
  }
  function syncColorControls(scope=document){
    $$('input[type="color"]',scope).forEach(input=>{
      let preview=$(`[data-color-preview="${input.id}"]`,scope)||input.closest('.r76-color-control')?.querySelector('.r76-color-preview');
      let button=$(`[data-color-button="${input.id}"]`,scope)||input.closest('.r76-color-control')?.querySelector('.r76-color-button');
      if(!input.closest('.r76-color-control')&&!input.dataset.r76Converted){
        input.dataset.r76Converted='1';
        const wrap=document.createElement('span');wrap.className='r76-color-control';
        const btn=document.createElement('button');btn.type='button';btn.className='r76-color-button';btn.innerHTML=iconPalette();btn.title='Farbe auswählen';btn.dataset.colorButton=input.id;
        const sw=document.createElement('span');sw.className='r76-color-preview';sw.dataset.colorPreview=input.id;sw.style.background=input.value;
        input.parentNode.insertBefore(wrap,input);wrap.appendChild(btn);wrap.appendChild(sw);wrap.appendChild(input);preview=sw;button=btn;
      }
      input.classList.add('r76-color-input');
      const update=()=>{if(preview)preview.style.background=input.value;};
      if(button&&!button.dataset.r76Bound){button.dataset.r76Bound='1';button.onclick=(ev)=>{ev.preventDefault();input.click();};}
      if(!input.dataset.r76Bound){input.dataset.r76Bound='1';input.addEventListener('input',update);input.addEventListener('change',update);}
      update();
    });
  }
  function readDraft(d){
    const gv=id=>$('#'+id)?.value;
    const ck=id=>!!$('#'+id)?.checked;
    if(gv('mTheme76'))d.theme=gv('mTheme76');
    if(gv('mCornerStyle76'))d.cornerStyle=gv('mCornerStyle76');
    if(gv('mOutlineStyle76'))d.outlineStyle=gv('mOutlineStyle76');
    if(gv('mOutlineColor76'))d.outlineCustomColor=gv('mOutlineColor76');
    if($('#mWeekendEnabled76'))d.weekendHighlight.enabled=ck('mWeekendEnabled76');
    if(gv('mWeekendColor76'))d.weekendHighlight.color=gv('mWeekendColor76');
    if(gv('mWeekendOpacity76'))d.weekendHighlight.opacity=clamp(gv('mWeekendOpacity76'),0.05,0.70,0.24);
    if($('#mVacationEnabled76'))d.vacationHighlight.enabled=ck('mVacationEnabled76');
    if(gv('mVacationColor76'))d.vacationHighlight.color=gv('mVacationColor76');
    if(gv('mVacationOpacity76'))d.vacationHighlight.opacity=clamp(gv('mVacationOpacity76'),0.05,0.55,0.18);
    if(gv('mTodayWidth76'))d.todayHighlight.borderWidth=clamp(gv('mTodayWidth76'),1,10,2);
    if(gv('mTodayColor76'))d.todayHighlight.borderColor=gv('mTodayColor76');
    if(gv('mTodayOpacity76'))d.todayHighlight.opacity=clamp(gv('mTodayOpacity76'),0,0.65,0.14);
    if(gv('mSyncInterval76')!==undefined)d.syncInterval=Number(gv('mSyncInterval76'));
  }
  function applyDraft(d){
    state.theme=d.theme;state.cornerStyle=d.cornerStyle;state.outlineStyle=d.outlineStyle;state.outlineCustomColor=d.outlineCustomColor;
    state.weekendHighlight=Object.assign({enabled:false,color:'#ffd29a',opacity:0.24},d.weekendHighlight||{});
    state.vacationHighlight=Object.assign({enabled:false,color:'#f97316',opacity:0.18},d.vacationHighlight||{});
    state.todayHighlight=Object.assign({borderColor:'#0284c7',borderWidth:2,opacity:0.14},d.todayHighlight||{});
    state.syncInterval=Number(d.syncInterval??state.syncInterval??15);
    ensureR76();setVars();
    if(typeof applyAppearance==='function')applyAppearance();
    if(typeof setupAutoSync==='function')setupAutoSync();
  }
  function openSettings76(){
    if(typeof state==='undefined')return;
    ensureR76();
    let active='general';
    const d=JSON.parse(JSON.stringify({theme:state.theme||'light',cornerStyle:state.cornerStyle||'rounded',outlineStyle:state.outlineStyle||'current',outlineCustomColor:state.outlineCustomColor||'#64748b',weekendHighlight:state.weekendHighlight,vacationHighlight:state.vacationHighlight,todayHighlight:state.todayHighlight,syncInterval:state.syncInterval??15}));
    $('#modalTitle').textContent='Allgemeine Einstellungen';
    $('#modalContent').innerHTML=`<div class="r76-settings"><div class="r76-tabs"><button class="r76-tab active" data-r76-tab="general">Allgemein</button><button class="r76-tab" data-r76-tab="sync">Synchronisierung</button><button class="r76-tab" data-r76-tab="info">Hinweise</button></div><div id="settingsTabContentR76"></div></div>`;
    $('#modalBackdrop').style.display='flex';$('#saveModal').style.display='';
    const root=()=>$('#settingsTabContentR76');
    function general(){
      root().innerHTML=`<div class="r76-grid">
        <section class="r76-card"><h3>Darstellung</h3><div class="r76-row"><label>Erscheinung</label><select id="mTheme76"><option value="light">Hell</option><option value="dark">Dunkel</option></select></div><div class="r76-row"><label>Kanten</label><select id="mCornerStyle76"><option value="rounded">Abgerundet</option><option value="sharp">Eckig / 90°</option></select></div><div class="r76-row"><label>Konturfarbe</label><div class="r76-inline"><select id="mOutlineStyle76"><option value="current">Wie aktuell</option><option value="none">Keine</option><option value="gray">Grau</option><option value="black">Schwarz</option><option value="custom">Eigene Farbe</option></select>${colorControl('mOutlineColor76',d.outlineCustomColor)}</div></div></section>
        <section class="r76-card"><label class="r76-check"><span><b>Wochenendtage anders anzeigen</b><small>Samstag und Sonntag erhalten eine eigene Hintergrundfarbe. Diese Markierung ist unabhängig von Urlaub.</small></span><input id="mWeekendEnabled76" type="checkbox"></label><div class="r76-row"><label>Wochenendfarbe</label>${colorControl('mWeekendColor76',d.weekendHighlight.color)}</div><div class="r76-row"><label>Wochenend-Deckkraft</label><input id="mWeekendOpacity76" type="range" min="0.05" max="0.70" step="0.01" value="${esc(d.weekendHighlight.opacity)}"></div></section>
        <section class="r76-card"><label class="r76-check"><span><b>Urlaubstage anders anzeigen</b><small>Ein ganztägiger Termin mit exakt dem Titel „Urlaub“ markiert den Tag nur dann, wenn der Tag kein Samstag und kein Sonntag ist.</small></span><input id="mVacationEnabled76" type="checkbox"></label><div class="r76-row"><label>Urlaubsfarbe</label>${colorControl('mVacationColor76',d.vacationHighlight.color)}</div><div class="r76-row"><label>Urlaubs-Deckkraft</label><input id="mVacationOpacity76" type="range" min="0.05" max="0.55" step="0.01" value="${esc(d.vacationHighlight.opacity)}"></div></section>
        <section class="r76-card"><h3>Aktueller Tag</h3><div class="r76-row"><label>Linienstärke</label><input id="mTodayWidth76" type="range" min="1" max="10" step="1" value="${esc(d.todayHighlight.borderWidth)}"></div><div class="r76-row"><label>Linienfarbe</label>${colorControl('mTodayColor76',d.todayHighlight.borderColor)}</div><div class="r76-row"><label>Flächen-Deckkraft</label><input id="mTodayOpacity76" type="range" min="0" max="0.65" step="0.01" value="${esc(d.todayHighlight.opacity)}"></div></section>
      </div>`;
      $('#mTheme76').value=d.theme;$('#mCornerStyle76').value=d.cornerStyle;$('#mOutlineStyle76').value=d.outlineStyle;$('#mWeekendEnabled76').checked=!!d.weekendHighlight.enabled;$('#mVacationEnabled76').checked=!!d.vacationHighlight.enabled;syncColorControls(root());
    }
    function sync(){
      root().innerHTML=`<div class="r76-grid"><section class="r76-card"><h3>Synchronisierung</h3><div class="r76-row"><label>Intervall</label><select id="mSyncInterval76"><option value="0">Aus / manuell</option><option value="5">Alle 5 Min.</option><option value="15">Alle 15 Min.</option><option value="30">Alle 30 Min.</option><option value="60">Alle 60 Min.</option></select></div><button class="btn primary" id="r76HardSaveBtn" type="button">Alle Änderungen hart in Datenbank speichern</button><p>Speichert UI-Einstellungen und relationale Tabellen sofort.</p></section></div>`;
      $('#mSyncInterval76').value=String(d.syncInterval??15);$('#r76HardSaveBtn').onclick=async()=>{readDraft(d);applyDraft(d);if(typeof hardSaveRev70==='function')await hardSaveRev70(true);else if(typeof saveStateToCloud==='function')await saveStateToCloud();if(typeof toast==='function')toast('Hart gespeichert.');};
    }
    function info(){
      root().innerHTML=`<div class="r76-grid"><section class="r76-card"><h3>Urlaub und Wochenende</h3><p>Wochenende bedeutet immer Samstag und Sonntag. Urlaubstage werden nur an Montag bis Freitag farblich markiert.</p></section><section class="r76-card"><h3>Zeitstrahl</h3><p>Der seitliche Zeitstrahl bleibt bewusst neutral und übernimmt keine Urlaubs-, Wochenend- oder Heute-Hintergrundfarbe.</p></section><section class="r76-card"><h3>Speicherlogik</h3><p>UI-Einstellungen werden im App-State gespeichert. Fachliche Daten wie Kalendergruppen, Quellen, Tasks, Projekte und eigene Termine liegen in eigenen Supabase-Tabellen.</p></section></div>`;
    }
    function renderTab(){if(active==='general')general();else if(active==='sync')sync();else info();}
    renderTab();
    $$('[data-r76-tab]').forEach(btn=>btn.onclick=()=>{readDraft(d);active=btn.dataset.r76Tab;$$('[data-r76-tab]').forEach(b=>b.classList.toggle('active',b===btn));renderTab();});
    $('#saveModal').onclick=async()=>{readDraft(d);applyDraft(d);let ok=true;try{if(typeof hardSaveRev70==='function')ok=await hardSaveRev70(false);else if(typeof saveStateToCloud==='function')await saveStateToCloud();}catch(_){ok=false;}if(typeof closeModal==='function')closeModal();if(typeof render==='function')render();if(typeof toast==='function')toast(ok?'Einstellungen gespeichert.':'Einstellungen lokal übernommen, Cloud-Speicherung fehlgeschlagen.');};
  }
  window.openSyncSettingsModal=openSettings76;
  function bindSettings(){const b=$('#settingsBtn');if(b)b.onclick=openSettings76;}
  if(typeof uiStateOnly==='function'){
    const oldUi=uiStateOnly;
    window.uiStateOnly=uiStateOnly=function(){ensureR76();const ui=oldUi.apply(this,arguments)||{};ui.weekendHighlight=JSON.parse(JSON.stringify(state.weekendHighlight));ui.vacationHighlight=JSON.parse(JSON.stringify(state.vacationHighlight));ui.todayHighlight=JSON.parse(JSON.stringify(state.todayHighlight));ui.outlineStyle=state.outlineStyle;ui.outlineCustomColor=state.outlineCustomColor;return ui;};
  }
  if(typeof applyUiState==='function'){
    const oldApply=applyUiState;
    window.applyUiState=applyUiState=function(ui){const r=oldApply.apply(this,arguments);if(ui){if(ui.weekendHighlight)state.weekendHighlight=ui.weekendHighlight;if(ui.vacationHighlight)state.vacationHighlight=ui.vacationHighlight;if(ui.todayHighlight)state.todayHighlight=ui.todayHighlight;if(ui.outlineStyle!==undefined)state.outlineStyle=ui.outlineStyle;if(ui.outlineCustomColor!==undefined)state.outlineCustomColor=ui.outlineCustomColor;}ensureR76();setVars();return r;};
  }
  if(typeof render==='function'){
    const oldRender=render;
    window.render=render=function(){const r=oldRender.apply(this,arguments);decorateVisibleDays();setTimeout(decorateVisibleDays,0);setTimeout(decorateVisibleDays,40);setTimeout(decorateVisibleDays,120);setTimeout(bindSettings,0);return r;};
  }
  if(typeof renderSidebarTimelineRev050==='function'){
    const oldTl=renderSidebarTimelineRev050;
    window.renderSidebarTimelineRev050=renderSidebarTimelineRev050=function(){const r=oldTl.apply(this,arguments);neutralTimeline();setTimeout(neutralTimeline,0);setTimeout(neutralTimeline,80);return r;};
  }
  document.addEventListener('input',ev=>{if(ev.target&&ev.target.matches('input[type="color"]'))syncColorControls(document);},true);
  const obs=new MutationObserver(()=>{bindSettings();syncColorControls(document);decorateVisibleDays();});
  obs.observe(document.documentElement,{childList:true,subtree:true});
  const style=document.createElement('style');
  style.textContent=`
    .rev76-weekend-day{background:linear-gradient(0deg,var(--r76WeekendBg),var(--r76WeekendBg)),#f8fbff!important}.rev76-vacation-day{background:linear-gradient(0deg,var(--r76VacationBg),var(--r76VacationBg)),#f8fbff!important}.month-cell.rev76-weekend-cell{background:linear-gradient(0deg,var(--r76WeekendBg),var(--r76WeekendBg)),#f8fbff!important}.month-cell.rev76-vacation-cell{background:linear-gradient(0deg,var(--r76VacationBg),var(--r76VacationBg)),#f8fbff!important}.rev76-today-day{border-color:var(--r76TodayBorder)!important;border-width:var(--r76TodayBorderWidth)!important;box-shadow:0 0 0 1px var(--r76TodayBg)!important}.month-cell.rev76-today-cell{border-color:var(--r76TodayBorder)!important;border-width:var(--r76TodayBorderWidth)!important}
    .r76-timeline-neutral,#sidebarDayTimelineRev049,#sidebarDayTimelineRev049 .timeline-canvas-wrap,#sidebarDayTimelineRev049 .timeline-canvas,.sidebar-day-timeline .timeline-canvas-wrap,.sidebar-day-timeline .timeline-canvas{background:#fff!important;background-color:#fff!important;background-image:none!important;background-blend-mode:normal!important}
    .r76-settings{display:grid;grid-template-columns:190px minmax(0,1fr);gap:14px;align-items:start;color:#111827!important}.r76-tabs{display:flex;flex-direction:column;gap:8px}.r76-tab{width:100%;text-align:left;background:#f3f4f6!important;border:1px solid #cbd6e7!important;color:#111827!important;border-radius:0;padding:10px 12px;font-weight:900}.r76-tab.active{background:#d1d5db!important;border-color:#9ca3af!important}.r76-grid{display:grid;gap:12px}.r76-card{border:1px solid #cbd5e1;border-radius:0;padding:12px;background:#f8fafc;display:grid;gap:10px;color:#111827!important}.r76-card h3{margin:0;font-size:15px}.r76-card p,.r76-card small{color:#475569!important;line-height:1.35}.r76-row{display:grid;grid-template-columns:minmax(155px,230px) minmax(0,1fr);gap:10px;align-items:center}.r76-row label{font-weight:800;color:#111827;font-size:13px}.r76-inline{display:flex;gap:8px;align-items:center}.r76-check{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;align-items:center}.r76-check input[type="checkbox"]{width:20px;height:20px;accent-color:#0284c7}.r76-color-control{display:inline-flex!important;align-items:center!important;gap:8px!important}.r76-color-button{width:34px!important;height:34px!important;border:1px solid #cbd5e1!important;background:#f8fafc!important;color:#111827!important;display:inline-flex!important;align-items:center!important;justify-content:center!important;font-size:18px!important;padding:0!important;box-shadow:0 2px 8px rgba(15,23,42,.08)!important}.r76-color-preview{width:24px!important;height:24px!important;border:1px solid #94a3b8!important;display:inline-block!important}.r76-color-input{position:absolute!important;width:1px!important;height:1px!important;opacity:0!important;pointer-events:none!important}.r75-color-bucket-wrap{background:#f8fafc!important}.r75-color-bucket-input{opacity:0!important}.r75-color-bucket-wrap+.r76-color-preview{margin-left:8px!important}@media(max-width:760px){.r76-settings{grid-template-columns:1fr}.r76-tabs{flex-direction:row;flex-wrap:wrap}.r76-tab{width:auto}.r76-row{grid-template-columns:1fr;gap:5px}}
  `;
  document.head.appendChild(style);
  setVars();bindSettings();setTimeout(()=>{bindSettings();syncColorControls(document);decorateVisibleDays();},0);setTimeout(()=>{bindSettings();decorateVisibleDays();},600);
})();


/* Revision 077: Monatsübersicht Desktop-Layout und klare Monatslogik */
(function(){
  const q=s=>document.querySelector(s);
  const qa=s=>Array.from(document.querySelectorAll(s));
  function esc(v){
    try{ return typeof escapeHtml==='function'?escapeHtml(v):String(v??'').replace(/[&<>\"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[m])); }
    catch(_){ return String(v??''); }
  }
  function isoDate(d){ return typeof fmtDate==='function'?fmtDate(d):new Date(d).toISOString().slice(0,10); }
  function short(v,n){ return typeof shortText==='function'?shortText(v,n):String(v??'').slice(0,n); }
  function same(a,b){ return typeof sameDay==='function'?sameDay(a,b):isoDate(a)===isoDate(b); }
  function add(d,n){ return typeof addDays==='function'?addDays(d,n):new Date(new Date(d).getTime()+n*86400000); }
  function sourceVisible(cal,event){
    const links=cal?.links||[];
    const id=event?.icsId||event?.sourceId;
    if(!id)return true;
    const src=links.find(x=>x.id===id);
    return !src || src.visible!==false;
  }
  function eventsForMonthDay(date){
    const out=[];
    const calendars=(typeof visibleCalendars==='function'?visibleCalendars():(state.calendars||[]).map((cal,idx)=>({cal,idx}))).filter(x=>x.cal?.visible!==false);
    calendars.forEach(({cal,idx})=>{
      const ics=(cal.events||[]).forEach((event,eventIdx)=>{
        const occ=typeof eventOccurrenceForDate==='function'?eventOccurrenceForDate(event,date):null;
        if(!occ||!sourceVisible(cal,occ))return;
        out.push({
          type:'ics',calIdx:idx,eventIdx,summary:occ.summary||'Ohne Titel',
          color:occ.icsColor||state.colors?.event||'#7c5cff',status:occ.status||'',
          allDay:!!occ.allDay,start:occ.start||'',end:occ.end||'',source:occ.icsName||occ.source||cal.name||''
        });
      });
      (cal.ownEvents||[]).forEach((event,eventIdx)=>{
        const occ=typeof eventOccurrenceForDate==='function'?eventOccurrenceForDate(event,date):null;
        if(!occ||!sourceVisible(cal,occ))return;
        out.push({
          type:'own',calIdx:idx,eventIdx,summary:occ.summary||'Ohne Titel',
          color:occ.icsColor||state.colors?.event||'#7c5cff',status:occ.status||'',
          allDay:!!occ.allDay,start:occ.start||'',end:occ.end||'',source:occ.icsName||occ.source||cal.name||''
        });
      });
    });
    return out.sort((a,b)=>Number(!a.allDay)-Number(!b.allDay)||new Date(a.start||0)-new Date(b.start||0)||String(a.summary).localeCompare(String(b.summary),'de'));
  }
  function timeText(event){
    if(event.allDay)return 'Ganztägig';
    const s=new Date(event.start), e=event.end?new Date(event.end):null;
    const f=d=>isNaN(d)?'':d.toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'});
    const start=f(s), end=e?f(e):'';
    return start+(end?'–'+end:'');
  }
  function taskMarkersForDay(iso){
    const groups=state.taskColumns||[];
    const tasks=(state.tasks||[]).filter(t=>t.date===iso&&!t.done);
    return groups.map(g=>({group:g,count:tasks.filter(t=>(t.columnId||groups[0]?.id)===g.id).length})).filter(x=>x.count>0&&x.group?.visible!==false);
  }
  function inCurrentCalendarWeek(d,today){
    const a=new Date(d);a.setHours(0,0,0,0);
    const t=new Date(today);t.setHours(0,0,0,0);
    const weekStart=new Date(t);weekStart.setDate(t.getDate()-((t.getDay()+6)%7));
    const weekEnd=new Date(weekStart);weekEnd.setDate(weekStart.getDate()+6);
    return a>=weekStart&&a<=weekEnd;
  }
  function renderMonthView078(){
    const root=q('#monthView');if(!root)return;
    const modal=root.closest('.modal');if(modal)modal.classList.add('month-modal-wide','month-modal-rev078');
    const monthName=monthCursor.toLocaleDateString('de-DE',{month:'long',year:'numeric'});
    const first=new Date(monthCursor);first.setHours(0,0,0,0);
    const start=new Date(first);start.setDate(first.getDate()-((first.getDay()+6)%7));
    const days=['Mo','Di','Mi','Do','Fr','Sa','So'];
    const today=new Date();today.setHours(0,0,0,0);
    let html=`<div class="month-nav month-nav-rev078"><button class="btn small" id="mPrev">← Monat</button><div class="month-title">${esc(monthName)}</div><button class="btn small" id="mNext">Monat →</button></div><div class="month-grid month-grid-rev078">${days.map(d=>`<div class="month-head">${d}</div>`).join('')}`;
    for(let i=0;i<42;i++){
      const d=add(start,i);const iso=isoDate(d);const inMonth=d.getMonth()===monthCursor.getMonth();
      const events=eventsForMonthDay(d);const allDay=events.filter(e=>e.allDay);const timed=events.filter(e=>!e.allDay);
      const markers=taskMarkersForDay(iso);
      const kw=(d.getDay()===1&&typeof getISOWeek==='function')?`<span class="kw-label">KW${getISOWeek(d)}</span>`:'';
      const currentWeek=inCurrentCalendarWeek(d,today);
      const allDayHtml=`<div class="month-all-day-row">${allDay.slice(0,4).map(e=>`<div class="month-pill month-pill-all-day" style="--ev:${esc(e.color)}" title="${esc(e.summary)}"><span>${esc(short(e.summary,34))}</span></div>`).join('')}${allDay.length>4?`<div class="month-more month-more-all-day">+${allDay.length-4}</div>`:''}</div>`;
      const timedHtml=`<div class="month-timed-list">${timed.slice(0,currentWeek?5:4).map(e=>`<div class="month-timed-event" style="--ev:${esc(e.color)}" title="${esc(timeText(e)+' · '+e.summary)}"><span class="month-event-time">${esc(timeText(e))}</span><span class="month-event-text">${esc(short(e.summary,48))}</span></div>`).join('')}${timed.length>(currentWeek?5:4)?`<div class="month-more">+${timed.length-(currentWeek?5:4)} weitere Termine</div>`:''}</div>`;
      const markerHtml=markers.length?`<div class="month-task-markers" title="Tagestasks vorhanden">${markers.slice(0,6).map(m=>`<span class="month-task-marker" style="background:${esc(m.group.color||state.colors?.task||'#ffb020')}" title="${esc(m.group.name)}: ${m.count}"></span>`).join('')}${markers.length>6?`<span class="month-task-marker-more">+${markers.length-6}</span>`:''}</div>`:'';
      html+=`<div class="month-cell month-cell-rev078 ${inMonth?'':'out'} ${same(d,today)?'today':''} ${currentWeek?'current-week':''}" data-month-date="${iso}" title="Tagesansicht ab ${iso} öffnen"><div class="month-day month-day-rev078"><span class="month-date-num">${d.getDate()}</span>${kw}</div>${allDayHtml}${timedHtml}${markerHtml}</div>`;
    }
    html+='</div>';root.innerHTML=html;
    const prev=q('#mPrev'), next=q('#mNext');
    if(prev)prev.onclick=()=>{monthCursor.setMonth(monthCursor.getMonth()-1);renderMonthView078();};
    if(next)next.onclick=()=>{monthCursor.setMonth(monthCursor.getMonth()+1);renderMonthView078();};
    qa('[data-month-date]').forEach(cell=>cell.onclick=()=>{const target=new Date(cell.dataset.monthDate+'T00:00:00');const base=new Date();base.setHours(0,0,0,0);state.offset=Math.round((target-base)/86400000);if(typeof closeModal==='function')closeModal();if(typeof render==='function')render();});
    if(typeof decorateVisibleDays==='function')setTimeout(decorateVisibleDays,0);
  }
  window.renderMonthView=renderMonthView=renderMonthView078;
  const openMonth078=function(){
    monthCursor=new Date();monthCursor.setDate(1);monthCursor.setHours(0,0,0,0);
    q('#modalTitle').textContent='Monatsübersicht';
    q('#modalContent').innerHTML='<div id="monthView" class="month-view-rev078"></div>';
    q('#modalBackdrop').style.display='flex';
    q('#saveModal').style.display='none';
    const modal=q('#modalBackdrop .modal');if(modal)modal.classList.add('month-modal-wide','month-modal-rev078');
    renderMonthView078();
  };
  window.openMonthModal=openMonthModal=openMonth078;
  const btn=q('#monthBtn');if(btn)btn.onclick=openMonth078;
  const oldClose=window.closeModal||closeModal;
  if(typeof oldClose==='function'){
    window.closeModal=closeModal=function(){const r=oldClose.apply(this,arguments);const modal=q('#modalBackdrop .modal');if(modal)modal.classList.remove('month-modal-wide','month-modal-rev078');return r;};
  }
})();
