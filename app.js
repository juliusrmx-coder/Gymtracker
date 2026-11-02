/* GymTracker 1.0.0 — Offline-first, no external dependencies.
 * Backups contain an explicitly versioned DATA SCHEMA; application updates do not clear storage.
 */
'use strict';
const APP_VERSION = '1.0.0';
const SCHEMA_VERSION = 1;
const DB_NAME = 'gymtracker-local';
const DB_STORE = 'settings';
const DB_KEY = 'state';
const appNode = document.getElementById('app');
const modalRoot = document.getElementById('modal-root');
let data, db = null, storageMethod = 'indexeddb';
let screen = 'home', selectedPlan = 'upper', selectedExercise = '', statsPeriod = 'all';
let currentMonth = firstMonth(new Date()), selectedCalendarDay = '';
let detailSessionId = '', modal = null, saveTimer = null, ticker = null, toastTimer = null;
let lastSaved = false;
const uid = () => 'id_'+Math.random().toString(36).slice(2,9)+'_'+Date.now().toString(36);
const ic = (name,small='') => `<svg class="ic ${small}" aria-hidden="true"><use href="#i-${name}"></use></svg>`;
const esc = s => String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num = x => {if(x===null||x===undefined||String(x).trim()==='')return null;let n=Number(String(x).trim().replace(',','.'));return Number.isFinite(n)?n:null;};
const fmt = (n,d=1) => Number(n).toLocaleString('de-DE',{maximumFractionDigits:d,minimumFractionDigits:0});
const dateKey = d => {const x=new Date(d); return `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,'0')}-${String(x.getDate()).padStart(2,'0')}`};
const today = () => dateKey(Date.now());
const isoDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s)&&!Number.isNaN(new Date(s+'T12:00:00').getTime())&&dateKey(new Date(s+'T12:00:00'))===s;
const dateFmt = s => {try{return new Date(s+'T12:00:00').toLocaleDateString('de-DE',{day:'2-digit',month:'2-digit',year:'numeric'})}catch{return s}};
const shortDate = s => {try{return new Date(s+'T12:00:00').toLocaleDateString('de-DE',{day:'2-digit',month:'2-digit'})}catch{return s}};
const dateTime = ms => new Date(ms).toLocaleDateString('de-DE',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'});
function firstMonth(d){return new Date(d.getFullYear(),d.getMonth(),1);}
const timeFmt = sec => {sec=Math.max(0,Math.floor(sec));const h=Math.floor(sec/3600),m=Math.floor(sec%3600/60),s=sec%60;return h?`${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`:`${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`};
function createInitial(){
  const labels=[
    ['squat','Kniebeugen'],['legpress','Beinpresse'],['pullup','Ass. Pull-Up'],['chest','Brustpresse'],
    ['legcurl','Beinbeuger'],['row','Rudern'],['laterals','Seitheben'],['crunch','Crunch-Maschine'],
    ['shoulder','Schulterdrücken'],['butterfly','Butterfly'],['dips','Dip-Maschine'],['legext','Beinstrecker'],['calves','Wadenheben']
  ];
  const exercises=Object.fromEntries(labels.map(([id,name])=>[id,{id,name,archived:false}]));
  const item=(ids,sets=3,min=8,max=10)=>({id:uid(),exerciseIds:Array.isArray(ids)?ids:[ids],sets,min,max});
  return {schemaVersion:SCHEMA_VERSION,appVersion:APP_VERSION,createdAt:new Date().toISOString(),lastBackupAt:null,
    exercises,
    plans:{
      upper:{id:'upper',name:'Upper',items:[item('pullup'),item('chest'),item('row'),item('shoulder'),item('butterfly',2,10,15),item('dips',2),item('laterals',3,10,15)]},
      lower:{id:'lower',name:'Lower',items:[item(['squat','legpress']),item('legcurl'),item('legext'),item('calves',3,10,15),item('crunch',3,10,15)]},
      full:{id:'full',name:'Ganzkörper',items:[item(['squat','legpress']),item('pullup'),item('chest'),item('legcurl'),item('row'),item('laterals',3,10,15),item('crunch',3,10,15)]}
    },sessions:[],activeSession:null,bodyEntries:[],goal:{startWeight:'',targetWeight:'',plannedWeeklyGain:0.25}
  };
}
function migrate(raw){
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('Keine gültigen App-Daten.');
  const v=Number(raw.schemaVersion);
  if(!Number.isInteger(v)||v<1)throw new Error('Backupformat nicht erkannt.');
  if(v>SCHEMA_VERSION)throw new Error('Dieses Backup wurde mit einer neueren App-Version erstellt. Bitte aktualisiere erst die App.');
  // Future migrations: v1 -> v2, ...; do not mutate the original backup.
  const d=structuredClone(raw);
  if(!d.plans||!d.exercises||!Array.isArray(d.sessions)||!Array.isArray(d.bodyEntries)||!d.goal)throw new Error('Im Backup fehlen wichtige Daten.');
  if(typeof d.exercises!=='object'||typeof d.plans!=='object'||Object.keys(d.plans).length===0)throw new Error('Trainingsdaten ungültig.');
  for(const p of Object.values(d.plans)){
    if(!p||!Array.isArray(p.items)||typeof p.name!=='string')throw new Error('Trainingsplan im Backup beschädigt.');
    for(const it of p.items){if(!Array.isArray(it.exerciseIds)||!Number.isInteger(Number(it.sets))||Number(it.sets)<1||Number(it.sets)>10)throw new Error('Übung im Backup beschädigt.');}
  }
  for(const e of Object.values(d.exercises))if(!e||typeof e.name!=='string')throw new Error('Übungsbibliothek ungültig.');
  for(const s of d.sessions){if(!s||!Array.isArray(s.entries)||!Number.isFinite(Number(s.startTime)))throw new Error('Session im Backup beschädigt.');}
  for(const e of d.bodyEntries){if(!e||!isoDate(e.date)||num(e.weight)===null||num(e.weight)<=0)throw new Error('Gewichtseintrag im Backup ungültig.');}
  if(d.activeSession&&(!Array.isArray(d.activeSession.entries)||!Number.isFinite(Number(d.activeSession.startTime))))throw new Error('Laufende Session im Backup ungültig.');
  d.schemaVersion=SCHEMA_VERSION;
  d.appVersion=APP_VERSION;
  if(!('lastBackupAt' in d))d.lastBackupAt=null;
  if(!('plannedWeeklyGain' in d.goal))d.goal.plannedWeeklyGain=.25;
  return d;
}
function openDatabase(){return new Promise((resolve,reject)=>{const r=indexedDB.open(DB_NAME,1);r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains(DB_STORE))r.result.createObjectStore(DB_STORE)};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});}
function dbGet(){return new Promise((resolve,reject)=>{const tx=db.transaction(DB_STORE,'readonly'),r=tx.objectStore(DB_STORE).get(DB_KEY);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});}
function dbPut(value){return new Promise((resolve,reject)=>{const tx=db.transaction(DB_STORE,'readwrite');tx.objectStore(DB_STORE).put(value,DB_KEY);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)});}
async function persist(){if(!data)return false;clearTimeout(saveTimer);saveTimer=null;if(storageMethod==='memory'){lastSaved=false;updateSaveStatus();return false;}try{
  const snapshot=structuredClone(data);
  if(storageMethod==='indexeddb')await dbPut(snapshot); else localStorage.setItem('gymtracker-state',JSON.stringify(snapshot));
  lastSaved=true;updateSaveStatus();return true;
}catch(err){console.error(err);lastSaved=false;updateSaveStatus();toast('Speichern fehlgeschlagen – bitte Backup erstellen.');return false;}}
function save(){lastSaved=false;updateSaveStatus();clearTimeout(saveTimer);saveTimer=setTimeout(()=>{persist()},180);}
function updateSaveStatus(){const nodes=document.querySelectorAll('[data-save-status]');nodes.forEach(el=>el.textContent=storageMethod==='memory'?'Kein Speicher verfügbar':(lastSaved?'Lokal gespeichert':'Speichert …'));}
async function initialize(){try{db=await openDatabase();const raw=await dbGet();
  try{data=raw?migrate(raw):createInitial()}catch(formatError){appNode.innerHTML=`<div class="panel" style="margin-top:32px"><h2>Gespeicherte Daten brauchen eine neuere App-Version</h2><p class="helper" style="margin-top:12px">${esc(formatError.message)} Die Daten werden nicht überschrieben.</p></div>`;return;}
  if(!raw)await dbPut(data)}catch(err){
  console.warn('IndexedDB nicht verfügbar',err);
  try{storageMethod='localstorage';const raw=localStorage.getItem('gymtracker-state');data=raw?migrate(JSON.parse(raw)):createInitial();if(!raw)localStorage.setItem('gymtracker-state',JSON.stringify(data));}
  catch(e){storageMethod='memory';data=createInitial();console.error('Keine persistente Speicherung verfügbar',e);}
}
  lastSaved=storageMethod!=='memory';selectedExercise=Object.keys(data.exercises)[0]||'';render();ticker=setInterval(updateTimer,1000);
  if(storageMethod==='memory')toast('Achtung: Dein Browser erlaubt hier kein dauerhaftes Speichern.');
  if('serviceWorker' in navigator&&location.protocol!=='file:')navigator.serviceWorker.register('./sw.js').catch(console.warn);
}
function toast(message){const el=document.getElementById('toast');el.textContent=message;el.classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('visible'),2900);}
function pageHead(title,sub='',action=''){return `<header class="page-head"><div class="head-left"><button class="icon-btn" data-action="home" aria-label="Zurück zum Hauptmenü">${ic('arrow-left')}</button><div style="min-width:0"><div class="head-title">${esc(title)}</div>${sub?`<div class="subhead">${esc(sub)}</div>`:''}</div></div>${action}</header>`}
function panelTitle(name,right=''){return `<div class="section-title"><h2>${name}</h2>${right}</div>`}
function render(){
  appNode.innerHTML=({home:homeHTML,training:trainingHTML,plans:plansHTML,stats:statsHTML,calendar:calendarHTML,body:bodyHTML,settings:settingsHTML,detail:detailHTML}[screen]||homeHTML)();
  renderModal();updateTimer();updateSaveStatus();
}
function go(next){screen=next;modal=null;window.scrollTo(0,0);render();}
function homeHTML(){
  const current=data.activeSession;
  const allComplete=data.sessions.filter(s=>s.status==='completed');
  const body=latestBody();
  return `<header class="page-head"><div class="brand"><div class="brand-logo">${ic('dumbbell','lg')}</div><div><h1>GymTracker</h1><div class="subhead">Training. Fortschritt. Einfach.</div></div></div><button class="icon-btn" data-action="navigate" data-screen="settings" aria-label="Einstellungen">${ic('settings')}</button></header>
   ${current?`<button class="active-alert" style="width:100%;text-align:left" data-action="navigate" data-screen="training"><div><strong>Training fortsetzen</strong><div><span>${esc(data.plans[current.planId]?.name||'Training')} · <span data-live-time>00:00</span></span></div></div>${ic('chevron-right')}</button>`:''}
   <section class="panel training-launch"><div class="row between"><div><h2>Training starten</h2><p class="subhead">Wähle deinen Trainingsplan</p></div>${ic('play','lg')}</div><div class="plan-pills">${Object.values(data.plans).map(p=>`<button class="plan-pill" data-action="start" data-plan="${esc(p.id)}">${esc(p.name)}</button>`).join('')}</div></section>
   ${panelTitle('Deine Übersicht')}
   <div class="home-grid">
      ${homeTile('stats','chart','Statistiken','Gewichte & Bestleistungen')}
      ${homeTile('calendar','calendar','Kalender',`${allComplete.length} Trainings dokumentiert`)}
      ${homeTile('body','scale','Körpergewicht',body?`${fmt(body.weight)} kg · Verlauf & Ziel`:'Verlauf & Zielgewicht')}
      ${homeTile('plans','edit','Pläne bearbeiten','Übungen & Alternativen')}
   </div>
   ${allComplete.length?`<div class="section-title"><h2>Letztes Training</h2><button class="linklike" data-action="navigate" data-screen="calendar">Verlauf ansehen</button></div>${miniSession(allComplete.slice().sort((a,b)=>b.startTime-a.startTime)[0])}`:''}
   <div class="footer-note">${ic('check','sm')} <span data-save-status>Lokale Speicherung</span> · Offlinefähig<br>Backups unter Einstellungen · Version ${APP_VERSION}</div>`;
}
function homeTile(next,icon,title,sub){return `<button class="tile" data-action="navigate" data-screen="${next}">${ic(icon,'lg')}<strong>${esc(title)}</strong><span>${esc(sub)}</span></button>`}
function latestBody(){return data.bodyEntries.length?data.bodyEntries.slice().sort((a,b)=>b.date.localeCompare(a.date))[0]:null;}
function sortedSessions(){return data.sessions.filter(s=>s.status==='completed').slice().sort((a,b)=>b.startTime-a.startTime)}
function sessionDuration(s){const till=s.endTime||Date.now();return Math.max(0,Math.floor((till-s.startTime-(s.pausedMs||0)-(s.pauseStartedAt?Math.max(0,till-s.pauseStartedAt):0))/1000));}
function updateTimer(){const s=data?.activeSession;if(!s)return;const seconds=sessionDuration(s);document.querySelectorAll('[data-live-time]').forEach(x=>x.textContent=timeFmt(seconds));}
function lastExerciseEntry(exId){for(const s of sortedSessions())for(const entry of (s.entries||[])){if(entry.completed&&entry.exerciseId===exId)return {...entry,sessionStart:s.startTime}}return null;}
function latestAltChoice(item,planId){for(const s of sortedSessions()){if(s.planId!==planId)continue;const e=s.entries.find(e=>e.itemId===item.id&&item.exerciseIds.includes(e.exerciseId)&&e.completed);if(e)return e.exerciseId}return item.exerciseIds[0]}
function freshSessionEntry(item,planId){const exerciseId=latestAltChoice(item,planId),last=lastExerciseEntry(exerciseId);return {itemId:item.id,exerciseId,weight:last&&last.weight!==null&&last.weight!==''?String(last.weight):'',reps:Array(item.sets).fill(''),drop:false,completed:false,upOverride:null,drafts:{}};}
function startSession(planId){if(data.activeSession){toast('Du hast bereits ein laufendes Training.');go('training');return}const p=data.plans[planId];if(!p)return;data.activeSession={id:uid(),planId,startTime:Date.now(),pausedMs:0,pauseStartedAt:null,itemsSnapshot:structuredClone(p.items),entries:p.items.map(it=>freshSessionEntry(it,planId))};save();go('training');}
function trainingHTML(){const s=data.activeSession;if(!s)return `${pageHead('Training')}<div class="empty">Kein Training aktiv.</div><button class="btn full" data-action="home">Zum Hauptmenü</button>`;
 const p=data.plans[s.planId];return `${pageHead(p?.name||'Training','Laufende Session',`<div class="timer" data-live-time>00:00</div>`)}
  <div class="session-meta"><span class="badge green">${s.pauseStartedAt?'Pausiert':'Läuft'}</span><span class="muted small">${s.entries.filter(e=>e.completed).length}/${s.entries.length} Übungen</span><div style="margin-left:auto"><button class="btn secondary sm" data-action="pause">${ic(s.pauseStartedAt?'play':'pause','sm')} ${s.pauseStartedAt?'Weiter':'Pause'}</button></div></div>
  ${s.entries.map((entry,i)=>trainingExerciseHTML(entry,(s.itemsSnapshot||p?.items||[]).find(it=>it.id===entry.itemId),i)).join('')}
  <div class="helper" style="margin:9px 4px 4px">Graue Wiederholungen = letztes Training. Trage deine heutigen Werte ein. ${ic('arrow-up','sm')} = Steigerung empfohlen / markieren. Ein roter Punkt bei „Drop“ bedeutet: letztes Mal Dropsatz.</div>
  <div class="session-actions"><button class="btn plain sm" data-action="reset-done">${ic('refresh','sm')} Haken zurücksetzen</button><span class="muted tiny" data-save-status>Lokale Speicherung</span></div>
  <div class="sticky-actions"><button class="btn" data-action="finish">${ic('check','sm')} Session beenden</button><button class="btn secondary" data-action="cancel-session" aria-label="Session verwerfen">${ic('trash','sm')}</button></div>`;
}
function trainingExerciseHTML(entry,item,index){if(!item)return '';const ex=data.exercises[entry.exerciseId]||{name:'Unbekannte Übung'};
 const previous=lastExerciseEntry(entry.exerciseId);
 const lastReps=previous?.reps||[];
 const allAtMax=entry.reps.length===item.sets&&entry.reps.every(r=>String(r).trim()!==''&&num(r)!==null&&num(r)>=item.max);
 const up=entry.upOverride!==null?entry.upOverride:(allAtMax||!!previous?.recommendNext);
 const select=item.exerciseIds.length>1?`<div class="alternative-wrap"><select class="alternative-select" data-role="alt" data-index="${index}" aria-label="Alternative Übung wählen">${item.exerciseIds.map(id=>`<option value="${esc(id)}" ${id===entry.exerciseId?'selected':''}>${esc(data.exercises[id]?.name||id)}</option>`).join('')}</select></div>`:`<div class="exercise-name">${esc(ex.name)}</div>`;
 return `<div class="exercise-card ${entry.completed?'is-done':''}"><div class="exercise-card-top">
   <input type="checkbox" class="done-box" data-role="done" data-index="${index}" ${entry.completed?'checked':''} aria-label="${esc(ex.name)} erledigt">
   <div class="exercise-name-wrap">${select}<div class="exercise-target">${item.sets} × ${item.min}–${item.max} Wdh.</div></div>
   <input class="weight-field" type="text" inputmode="decimal" data-role="weight" data-index="${index}" value="${esc(entry.weight)}" placeholder="–" aria-label="${esc(ex.name)} Gewicht in Kilogramm"><span class="unit">kg</span>
   <button class="up-btn ${up?'active':''}" data-action="up" data-index="${index}" aria-label="Steigerung ${up?'abwählen':'markieren'}" title="Für nächstes Training mehr Gewicht vorsehen">${ic('arrow-up','sm')}</button>
 </div><div class="exercise-card-bottom"><span class="rep-label">Wdh.</span>${entry.reps.map((r,j)=>`<input class="rep-input" type="text" inputmode="numeric" data-role="rep" data-index="${index}" data-set="${j}" value="${esc(r)}" placeholder="${esc(lastReps[j]??'–')}" aria-label="Satz ${j+1} Wiederholungen">`).join('')}
   <button class="drop-btn ${entry.drop?'active':''} ${previous?.drop?'previous':''}" data-action="drop" data-index="${index}" title="${previous?.drop?'Letztes Mal mit Dropsatz. ':''}Dropsatz heute markieren">Drop</button></div></div>`;
}
function storeDraft(entry){entry.drafts??={};entry.drafts[entry.exerciseId]={weight:entry.weight,reps:entry.reps.slice(),drop:entry.drop,completed:entry.completed,upOverride:entry.upOverride}}
function switchAlternative(index,nextId){const s=data.activeSession,entry=s.entries[index],item=(s.itemsSnapshot||data.plans[s.planId].items).find(it=>it.id===entry.itemId);if(!item?.exerciseIds.includes(nextId))return;
 storeDraft(entry);const old=entry.drafts?.[nextId],last=lastExerciseEntry(nextId);entry.exerciseId=nextId;Object.assign(entry,old||{weight:last?.weight===null||last?.weight===undefined?'':String(last.weight),reps:Array(item.sets).fill(''),drop:false,completed:false,upOverride:null});save();render();}
function finishSession(){const s=data.activeSession;if(!s)return;if(!s.entries.some(e=>e.completed)){toast('Markiere zuerst mindestens eine abgeschlossene Übung.');return}
 const p=data.plans[s.planId];const finishedAt=Date.now(),pausedMs=(s.pausedMs||0)+(s.pauseStartedAt?finishedAt-s.pauseStartedAt:0);
 const result={id:s.id,planId:s.planId,planName:p?.name||'Training',startTime:s.startTime,endTime:finishedAt,pausedMs,durationSec:Math.max(0,Math.floor((finishedAt-s.startTime-pausedMs)/1000)),status:'completed',entries:s.entries.map(e=>{const item=(s.itemsSnapshot||p?.items||[]).find(it=>it.id===e.itemId);const weight=e.weight===''?null:num(e.weight);const cleanReps=e.reps.map(r=>r===''?null:num(r));const auto=!!item&&cleanReps.length===item.sets&&cleanReps.every(n=>n!==null&&n>=item.max);return {itemId:e.itemId,exerciseId:e.exerciseId,exerciseName:data.exercises[e.exerciseId]?.name||'Übung',weight,reps:cleanReps,drop:!!e.drop,completed:!!e.completed,sets:item?.sets||e.reps.length,min:item?.min||8,max:item?.max||10,recommendNext:e.upOverride===null?auto:!!e.upOverride}})};
 data.sessions.push(result);data.activeSession=null;save();detailSessionId=result.id;go('detail');toast('Stark! Training gespeichert. 💪');}
function miniSession(s){const done=s.entries.filter(e=>e.completed).length;return `<button class="panel history-link" data-action="view-session" data-id="${esc(s.id)}"><div class="row between"><div><strong>${esc(s.planName||data.plans[s.planId]?.name||'Training')}</strong><div class="subhead">${dateTime(s.startTime)} · ${done} Übungen · ${timeFmt(s.durationSec||0)}</div></div>${ic('chevron-right')}</div></button>`}
function plansHTML(){const p=data.plans[selectedPlan]||Object.values(data.plans)[0];if(!p)return pageHead('Pläne bearbeiten');
 return `${pageHead('Pläne bearbeiten','Übungen individuell zusammenstellen')}
 <div class="segmented">${Object.values(data.plans).map(x=>`<button class="${x.id===p.id?'active':''}" data-action="select-plan" data-plan="${esc(x.id)}">${esc(x.name==='Ganzkörper'?'GK':x.name)}</button>`).join('')}</div>
 ${panelTitle(esc(p.name),`<button class="linklike" data-action="open-add">+ Übung hinzufügen</button>`)}
 <section class="panel" style="padding:7px 12px">${p.items.length?p.items.map((it,i)=>{const names=it.exerciseIds.map(id=>data.exercises[id]?.name||'Unbekannt');return `<div class="list-row" style="min-height:58px"><span class="muted">${ic('grip','sm')}</span><div class="list-main"><strong>${esc(names[0])}</strong>${names.length>1?`<div class="sub">oder ${esc(names.slice(1).join(' / '))}</div>`:`<div class="sub">${it.sets} × ${it.min}–${it.max} Wdh.</div>`}</div><button class="icon-btn tiny" data-action="move-item" data-dir="-1" data-index="${i}" aria-label="Nach oben" ${i===0?'disabled':''}>${ic('arrow-up','sm')}</button><button class="icon-btn tiny" data-action="edit-item" data-id="${esc(it.id)}" aria-label="Bearbeiten">${ic('edit','sm')}</button><button class="icon-btn tiny red" data-action="remove-item" data-id="${esc(it.id)}" aria-label="Aus Plan entfernen">${ic('trash','sm')}</button></div>`}).join(''):`<div class="empty">Dieser Plan hat noch keine Übungen.</div>`}</section>
 <button class="btn secondary full" style="margin-top:12px" data-action="open-add">${ic('plus','sm')} Übung hinzufügen</button>
 ${panelTitle('Übungsbibliothek',`<span class="muted tiny">${Object.values(data.exercises).filter(e=>!e.archived).length} Übungen</span>`)}
 <section class="panel" style="padding:6px 12px">${Object.values(data.exercises).filter(e=>!e.archived).sort((a,b)=>a.name.localeCompare(b.name,'de')).map(e=>`<div class="list-row"><div class="list-main"><strong>${esc(e.name)}</strong></div><button class="icon-btn tiny" data-action="rename-exercise" data-exercise="${esc(e.id)}" aria-label="Umbenennen">${ic('edit','sm')}</button><button class="icon-btn tiny red" data-action="archive-exercise" data-exercise="${esc(e.id)}" aria-label="Archivieren">${ic('trash','sm')}</button></div>`).join('')}</section>
 ${Object.values(data.exercises).some(e=>e.archived)?`<details class="panel" style="margin-top:12px"><summary class="small" style="cursor:pointer">Archivierte Übungen anzeigen</summary>${Object.values(data.exercises).filter(e=>e.archived).map(e=>`<div class="list-row"><span class="grow small">${esc(e.name)}</span><button class="btn secondary sm" data-action="restore-exercise" data-exercise="${esc(e.id)}">Wiederherstellen</button></div>`).join('')}</details>`:''}
 <div class="callout" style="margin-top:12px">${ic('info','sm')} <span>Umbenennungen gelten in allen Plänen. Beim Entfernen aus einem Plan bleiben frühere Trainingswerte und Diagramme erhalten. Mit den Pfeilen änderst du die Reihenfolge.</span></div>`;
}
function renderModal(){if(!modal){modalRoot.innerHTML='';return}
 let content='',title='';
 if(modal.type==='add'){
   title='Übung hinzufügen';const all=Object.values(data.exercises).filter(e=>!e.archived).sort((a,b)=>a.name.localeCompare(b.name,'de'));
   content=`<div class="field-group"><label class="label">Vorhandene Übung auswählen</label><select class="field" id="modal-existing"><option value="">Übung wählen …</option>${all.map(e=>`<option value="${esc(e.id)}">${esc(e.name)}</option>`).join('')}</select></div>
    <button class="btn full" style="margin-top:12px" data-action="add-existing">${ic('plus','sm')} Zum Plan hinzufügen</button><div class="line"></div>
    <div class="field-group"><label class="label">Oder neue Übung anlegen</label><input class="field" id="modal-new-ex" placeholder="z. B. Latzug" maxlength="70"></div>
    <button class="btn secondary full" style="margin-top:12px" data-action="add-new">Neue Übung erstellen und hinzufügen</button>`;
 }else if(modal.type==='edit-item'){
   const p=data.plans[selectedPlan],it=p.items.find(i=>i.id===modal.id);if(!it){modal=null;return renderModal()}
   title='Übung im Plan';const alternatives=it.exerciseIds.map(id=>`<div class="row between" style="margin-top:7px"><span class="small">${esc(data.exercises[id]?.name||id)}</span>${it.exerciseIds.length>1?`<button class="icon-btn tiny red" data-action="remove-alt" data-exercise="${esc(id)}">${ic('trash','sm')}</button>`:''}</div>`).join('');
   const available=Object.values(data.exercises).filter(e=>!e.archived&&!it.exerciseIds.includes(e.id));
   content=`<div class="field-grid three"><div><label class="label">Sätze</label><input id="modal-sets" class="field" type="number" min="1" max="10" value="${it.sets}"></div><div><label class="label">Wdh. min.</label><input id="modal-min" class="field" type="number" min="1" max="99" value="${it.min}"></div><div><label class="label">Wdh. max.</label><input id="modal-max" class="field" type="number" min="1" max="99" value="${it.max}"></div></div><button class="btn full" style="margin-top:12px" data-action="save-item">Einstellungen speichern</button><div class="line"></div>
     <strong class="small">Alternative Übungen</strong><div class="helper" style="margin-top:5px">Im Training wählst du genau eine dieser Übungen aus.</div>${alternatives}
     <div class="row" style="margin-top:13px"><select class="field compact grow" id="modal-alt"><option value="">Alternative auswählen …</option>${available.map(e=>`<option value="${esc(e.id)}">${esc(e.name)}</option>`).join('')}</select><button class="btn secondary sm" data-action="add-alt">${ic('plus','sm')}</button></div>`;
 }else if(modal.type==='rename'){
   title='Übung umbenennen';const e=data.exercises[modal.id];content=`<label class="label">Neuer Name</label><input class="field" maxlength="70" id="modal-name" value="${esc(e?.name||'')}"><button class="btn full" style="margin-top:13px" data-action="save-rename">Speichern</button>`;
 }
 modalRoot.innerHTML=`<div class="dialog-cover" data-action="close-modal-background"><section class="dialog-panel" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="dialog-head"><h2>${esc(title)}</h2><button class="icon-btn tiny" data-action="close-modal" aria-label="Schließen">${ic('close','sm')}</button></div>${content}</section></div>`;
}
function addPlanExercise(exid){const p=data.plans[selectedPlan];if(!data.exercises[exid]||!p)return;if(p.items.some(it=>it.exerciseIds.includes(exid))){toast('Diese Übung ist in diesem Plan bereits enthalten.');return}p.items.push({id:uid(),exerciseIds:[exid],sets:3,min:8,max:10});modal=null;save();render();toast('Übung hinzugefügt.');}
function renameExercise(exid,name){name=String(name||'').trim();if(!name){toast('Bitte einen Namen eingeben.');return}if(name.length>70){toast('Der Name ist zu lang.');return}data.exercises[exid].name=name;modal=null;save();render();}
function archiveExercise(exid){const e=data.exercises[exid];if(!e)return;if(!confirm(`„${e.name}“ aus der Bibliothek und allen Plänen entfernen? Frühere Trainings bleiben gespeichert.`))return;
 e.archived=true;for(const p of Object.values(data.plans))p.items=p.items.map(it=>({...it,exerciseIds:it.exerciseIds.filter(id=>id!==exid)})).filter(it=>it.exerciseIds.length);
 save();render();toast('Übung archiviert; Trainingshistorie bleibt erhalten.');}
function exerciseStats(exid){return sortedSessions().reverse().flatMap(s=>s.entries.filter(e=>e.completed&&e.exerciseId===exid&&num(e.weight)!==null&&num(e.weight)>=0).map(e=>({...e,date:dateKey(s.startTime),timestamp:s.startTime,weight:Number(e.weight),sessionId:s.id})));}
function statsHTML(){const all=Object.values(data.exercises).filter(e=>!e.archived||exerciseStats(e.id).length).sort((a,b)=>a.name.localeCompare(b.name,'de'));
 if(!all.some(e=>e.id===selectedExercise))selectedExercise=all[0]?.id||'';
 let records=exerciseStats(selectedExercise);const now=Date.now(),days=statsPeriod==='1m'?31:statsPeriod==='3m'?93:statsPeriod==='6m'?186:Infinity;records=records.filter(r=>now-r.timestamp<=days*86400000);
 const latest=records.at(-1),earliest=records[0];const best=records.length?Math.max(...records.map(e=>e.weight)):null;
 const delta=latest&&earliest?latest.weight-earliest.weight:null;
 const completed=data.sessions.filter(s=>s.status==='completed');
 return `${pageHead('Statistiken','Deine Entwicklung in Kilogramm')}
  <div class="stat-hero"><div class="stat-card"><div class="caption">Trainings gesamt</div><div class="value">${completed.length}</div></div><div class="stat-card"><div class="caption">Trainingszeit</div><div class="value">${fmt(completed.reduce((s,x)=>s+(x.durationSec||0),0)/3600,1)} <span class="small">Std.</span></div></div></div>
  ${panelTitle('Übungsfortschritt')}
  <section class="panel"><label class="label" for="stat-exercise">Übung</label><select class="field" id="stat-exercise" data-role="stat-exercise">${all.map(e=>`<option value="${esc(e.id)}" ${e.id===selectedExercise?'selected':''}>${esc(e.name)}</option>`).join('')}</select>
    <div class="segmented" style="margin-top:12px">${[['1m','1 Monat'],['3m','3 Monate'],['6m','6 Monate'],['all','Gesamt']].map(([id,name])=>`<button class="${statsPeriod===id?'active':''}" data-action="stats-period" data-period="${id}">${name}</button>`).join('')}</div>
    ${records.length?`<div class="stat-hero" style="margin-top:12px"><div class="stat-card"><div class="caption">Letztes Gewicht</div><div class="value">${fmt(latest.weight)} <span class="small">kg</span></div></div><div class="stat-card"><div class="caption">Entwicklung</div><div class="value" style="color:${delta>0?'#65e1a4':'inherit'}">${delta>0?'+':''}${fmt(delta)} <span class="small">kg</span></div></div></div>
      ${lineChart(records.map(r=>({date:r.date,value:r.weight,label:`${fmt(r.weight)} kg · ${dateFmt(r.date)}`})),{unit:'kg'})}
      <div class="row between"><span class="muted tiny">${records.length} absolvierte Einträge</span><span class="muted tiny">Bestwert ${fmt(best)} kg</span></div>`:
      `<div class="empty" style="margin-top:12px">Noch keine abgeschlossenen Sätze mit Gewicht für diese Übung. Nach dem Training erscheint hier deine Kurve.</div>`}
  </section><div class="callout" style="margin-top:12px">${ic('info','sm')} <span>Upper, Lower und Ganzkörper verwenden dieselbe Übungshistorie. Alternative Übungen werden getrennt ausgewertet. Dropsätze zählen nicht in den Gewichtsverlauf.</span></div>`;
}
function lineChart(points,{unit='kg',pred=null,goal=null}={}){
  if(!points.length)return '<div class="empty">Noch keine Messwerte.</div>';
  // Numeric SVG coordinates, dates represented as real timestamps (not equidistant exercise indices).
  const real=points.map(p=>({...p,t:new Date(p.date+'T12:00:00').getTime()})).filter(p=>Number.isFinite(p.t)&&Number.isFinite(p.value)).sort((a,b)=>a.t-b.t);
  if(!real.length)return '<div class="empty">Noch keine gültigen Messwerte.</div>';
  const values=real.map(p=>p.value),allDates=real.map(p=>p.t);
  if(pred&&pred.value!==null&&Number.isFinite(pred.value)){values.push(pred.value);allDates.push(new Date(pred.date+'T12:00:00').getTime());}
  if(Number.isFinite(goal))values.push(goal);
  let low=Math.min(...values),high=Math.max(...values),range=high-low;
  const padY=Math.max(1,range*.16);low=Math.max(0,low-padY);high=high+padY;
  let minT=Math.min(...allDates),maxT=Math.max(...allDates);if(minT===maxT){minT-=86400000;maxT+=86400000;}
  const W=355,H=193,L=39,R=9,T=15,B=31;
  const x=t=>L+(t-minT)/(maxT-minT)*(W-L-R),y=v=>T+(high-v)/(high-low)*(H-T-B);
  const pt=p=>`${x(p.t).toFixed(2)},${y(p.value).toFixed(2)}`;
  const yTicks=Array.from({length:4},(_,i)=>low+(high-low)*(i/3));
  const line=real.map((p,i)=>`${i===0?'M':'L'}${pt(p)}`).join(' ');
  const plotDots=real.map(p=>`<circle class="plot-dot" cx="${x(p.t)}" cy="${y(p.value)}" r="3.8"><title>${esc(p.label||`${fmt(p.value)} ${unit} am ${dateFmt(p.date)}`)}</title></circle>`).join('');
  const first=real[0],last=real.at(-1),predPath=pred&&pred.value!==null&&Number.isFinite(pred.value)?`<path class="pred-line" d="M${pt(last)} L${x(new Date(pred.date+'T12:00:00').getTime()).toFixed(2)},${y(pred.value).toFixed(2)}"/>`:'';
  const goalPath=Number.isFinite(goal)?`<line class="goal-line" x1="${L}" y1="${y(goal)}" x2="${W-R}" y2="${y(goal)}"/>`:'';
  return `<div class="chart-shell"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Gewichtsdiagramm mit ${real.length} Messpunkten in ${unit}">
  ${yTicks.map(v=>`<line class="gridline" x1="${L}" x2="${W-R}" y1="${y(v)}" y2="${y(v)}"/><text class="axis" x="${L-6}" y="${y(v)+3}" text-anchor="end">${fmt(v)}</text>`).join('')}
  ${goalPath}<path class="plot-line" d="${line}"/>${predPath}${plotDots}
  <text class="axis" x="${L}" y="${H-7}">${shortDate(first.date)}</text><text class="axis" x="${W-R}" y="${H-7}" text-anchor="end">${pred?shortDate(pred.date):shortDate(last.date)}</text></svg>
  <div class="legend"><span><i class="legend-dot"></i>Gemessen</span>${predPath?`<span><i class="legend-dot green"></i>Prognose</span>`:''}${goalPath?`<span><i class="legend-dot yellow"></i>Ziel</span>`:''}</div></div>`;
}
function calendarHTML(){const year=currentMonth.getFullYear(),month=currentMonth.getMonth();const title=currentMonth.toLocaleDateString('de-DE',{month:'long',year:'numeric'});
 const offset=(currentMonth.getDay()+6)%7,days=new Date(year,month+1,0).getDate();const calDates=Array.from({length:Math.ceil((offset+days)/7)*7},(_,i)=>i-offset+1);
 const grouped=new Map();for(const s of sortedSessions()){const d=dateKey(s.startTime);if(!grouped.has(d))grouped.set(d,[]);grouped.get(d).push(s)}
 const selected=selectedCalendarDay&&grouped.get(selectedCalendarDay)||[];
 return `${pageHead('Trainingskalender','Deine abgeschlossenen Sessions')}
 <section class="panel"><div class="cal-head"><button class="icon-btn tiny" data-action="month-change" data-delta="-1">${ic('arrow-left','sm')}</button><strong>${esc(title)}</strong><button class="icon-btn tiny" data-action="month-change" data-delta="1">${ic('chevron-right','sm')}</button></div>
 <div class="calendar-grid">${['Mo','Di','Mi','Do','Fr','Sa','So'].map(w=>`<div class="week-day">${w}</div>`).join('')}
 ${calDates.map(n=>{const d=n>=1&&n<=days?dateKey(new Date(year,month,n)):null;return `<button class="cal-day ${d&&grouped.has(d)?'has-session':''} ${d===selectedCalendarDay?'active':''}" ${d?`data-action="calendar-day" data-date="${d}"`:'disabled'}>${d?n:''}</button>`}).join('')}</div><div class="helper" style="margin-top:12px">Grün markierte Tage enthalten ein Training. Tippe auf ein Datum für Details.</div></section>
 ${selectedCalendarDay?`${panelTitle(dateFmt(selectedCalendarDay),`<span class="muted tiny">${selected.length} Trainings</span>`)}${selected.length?selected.map(miniSession).join(''):'<div class="empty">An diesem Tag wurde kein Training gespeichert.</div>'}`:''}
 ${panelTitle('Alle Trainings',`<span class="muted tiny">${sortedSessions().length} insgesamt</span>`)}
 ${sortedSessions().length?`<div class="table-list">${sortedSessions().map(s=>`<div class="list-row">${ic('history','sm')}<div class="list-main"><button class="history-link" data-action="view-session" data-id="${esc(s.id)}"><strong>${esc(s.planName||data.plans[s.planId]?.name||'Training')}</strong><div class="sub">${dateTime(s.startTime)} · ${timeFmt(s.durationSec||0)}</div></button></div>${ic('chevron-right','sm')}</div>`).join('')}</div>`:'<div class="empty">Noch keine abgeschlossenen Trainingseinheiten.</div>'}`;
}
function detailHTML(){const s=data.sessions.find(s=>s.id===detailSessionId);if(!s)return `${pageHead('Training')}<div class="empty">Session nicht gefunden.</div>`;
 const completed=s.entries.filter(e=>e.completed);
 return `${pageHead('Trainingsübersicht','Gut gemacht! 💪')}
 <div class="panel"><div class="row between"><div><div class="kicker">ABGESCHLOSSEN</div><h2 style="margin-top:6px">${esc(s.planName||data.plans[s.planId]?.name||'Training')}</h2><div class="subhead">${dateTime(s.startTime)}</div></div><span style="color:#f6c06b">${ic('trophy','lg')}</span></div>
 <div class="stat-hero" style="margin-top:14px"><div class="stat-card"><div class="caption">Dauer</div><div class="value">${timeFmt(s.durationSec||0)}</div></div><div class="stat-card"><div class="caption">Übungen</div><div class="value">${completed.length}</div></div></div></div>
 ${panelTitle('Deine Übungen')}
 <div class="panel">${completed.map(e=>`<div class="list-row"><div class="list-main"><strong>${esc(data.exercises[e.exerciseId]?.name||e.exerciseName||'Übung')}</strong><div class="sub">${e.reps.map(r=>r===null?'–':r).join(' / ')} Wdh. ${e.drop?'· Dropsatz':''}</div></div><strong class="small nowrap">${e.weight===null?'–':fmt(e.weight)} kg</strong></div>`).join('')||'<div class="empty">Keine Übungen eingetragen.</div>'}</div>
 <div class="row" style="margin-top:14px"><button class="btn secondary" data-action="navigate" data-screen="calendar">${ic('calendar','sm')} Verlauf</button><button class="btn grow" data-action="home">Zum Hauptmenü</button></div>`;
}
let weightDraft={date:today(),weight:'',editId:null};
function bodyTrend(entries){
  const buckets=new Map();for(const e of entries){const d=new Date(e.date+'T12:00:00'),dow=(d.getDay()+6)%7;d.setDate(d.getDate()-dow);const key=dateKey(d),a=buckets.get(key)||[];a.push(Number(e.weight));buckets.set(key,a)}
  const weekly=[...buckets].sort((a,b)=>a[0].localeCompare(b[0])).map(([date,arr])=>({t:new Date(date+'T12:00:00').getTime()/86400000/7,v:arr.reduce((s,v)=>s+v,0)/arr.length}));
  if(weekly.length<3||weekly.at(-1).t-weekly[0].t<3)return null;
  const xMean=weekly.reduce((s,p)=>s+p.t,0)/weekly.length,yMean=weekly.reduce((s,p)=>s+p.v,0)/weekly.length;
  const den=weekly.reduce((s,p)=>s+(p.t-xMean)**2,0),slope=weekly.reduce((s,p)=>s+(p.t-xMean)*(p.v-yMean),0)/den;
  return slope>0.02&&slope<=1.5?slope:null;
}
function bodyHTML(){const entries=data.bodyEntries.slice().sort((a,b)=>a.date.localeCompare(b.date));const latest=entries.at(-1)||null;
 const start=num(data.goal.startWeight)??(entries[0]?.weight??null),target=num(data.goal.targetWeight),current=latest?.weight??null;
 const planned=num(data.goal.plannedWeeklyGain)||.25;
 const trend=bodyTrend(entries),rate=trend||planned;
 const valid=current!==null&&target!==null&&target>0&&rate>0;
 const remaining=valid?target-current:null;
 const weeks=valid?Math.max(0,remaining/rate):null;
 const expectedDate=weeks!==null&&weeks<520?dateKey(new Date(new Date(latest.date+'T12:00:00').getTime()+Math.ceil(weeks*7)*86400000)):null;
 const progress=start!==null&&current!==null&&target!==null&&target!==start?Math.max(0,Math.min(100,100*(current-start)/(target-start))):0;
 const projected=expectedDate&&weeks>0&&target>current?{date:expectedDate,value:target}:null;
 return `${pageHead('Körpergewicht','Verlauf & Zielprognose')}
 <section class="panel"><div class="row between"><div><div class="muted small">Zuletzt gemessen</div><div style="font-size:31px;font-weight:850;letter-spacing:-1px;margin-top:4px">${current===null?'–':fmt(current)} <span style="font-size:15px;color:#aebed2">kg</span></div><div class="subhead">${latest?dateFmt(latest.date):'Noch kein Gewicht gespeichert'}</div></div><div style="color:#a4cafa">${ic('scale','lg')}</div></div>
 <div class="line"></div><div class="field-grid three"><div class="field-group"><label class="label">Start (kg)</label><input class="field compact" data-role="goal" data-key="startWeight" inputmode="decimal" placeholder="${entries[0]?fmt(entries[0].weight):'–'}" value="${esc(data.goal.startWeight)}"></div><div class="field-group"><label class="label">Ziel (kg)</label><input class="field compact" data-role="goal" data-key="targetWeight" inputmode="decimal" placeholder="z. B. 75" value="${esc(data.goal.targetWeight)}"></div><div class="field-group"><label class="label">kg/Woche</label><input class="field compact" data-role="goal" data-key="plannedWeeklyGain" inputmode="decimal" value="${esc(data.goal.plannedWeeklyGain)}"></div></div>
 ${start!==null&&current!==null&&target!==null?`<div style="margin-top:15px"><div class="row between"><span class="muted tiny">Fortschritt zum Ziel</span><strong class="small">${fmt(progress,0)} %</strong></div><div class="goals-track"><div class="goals-fill" style="width:${progress}%"></div></div><div class="row between" style="margin-top:7px"><span class="muted tiny">${fmt(current-start)} kg seit Start</span><span class="muted tiny">${fmt(Math.max(0,target-current))} kg übrig</span></div></div>`:''}</section>
 <div class="section-title"><h2>Gewichtsverlauf</h2><span class="muted tiny">Messwerte + Prognose</span></div>
 ${entries.length?lineChart(entries.map(e=>({date:e.date,value:Number(e.weight)})),{unit:'kg',pred:projected,goal:target}):'<div class="empty">Trage deine bisherigen Gewichte mit Datum ein. Danach erscheint hier dein Verlauf.</div>'}
 <div class="panel" style="margin-top:12px">${valid?`<div class="row between"><div><div class="muted tiny">Voraussichtlich am Ziel</div><div style="font-size:20px;font-weight:800;margin-top:5px">${remaining<=0?'Ziel erreicht':weeks>=520?'Mehr als 10 Jahre':dateFmt(expectedDate)}</div></div>${ic('target','lg')}</div><p class="helper" style="margin-top:8px">${remaining<=0?'Dein zuletzt gemessenes Gewicht liegt auf oder über dem Ziel.':`Ca. ${fmt(weeks,0)} Wochen ab letzter Messung. ${trend?'Basierend auf dem geglätteten Trend deiner bisherigen Wochenwerte.':'Basierend auf deiner eingestellten Zunahme pro Woche.'} Schätzung, keine Garantie.`}</p>`:`<div class="muted small">Lege ein Ziel fest und füge mindestens einen Messwert hinzu, um die Prognose zu sehen.</div>`}
 ${trend?`<div class="line"></div><div class="row between"><span class="muted small">Bisheriger Trend</span><strong style="color:#79dfae">+${fmt(trend,2)} kg/Woche</strong></div><p class="helper" style="margin-top:5px">Berechnet aus den Wochenmittelwerten; tägliche Schwankungen werden reduziert.</p>`:''}</div>
 ${panelTitle(weightDraft.editId?'Messwert bearbeiten':'Gewicht eintragen',`<span class="muted tiny">Auch rückwirkend</span>`)}
 <section class="panel"><div class="field-grid"><div class="field-group"><label class="label" for="body-date">Datum</label><input class="field" type="date" id="body-date" max="${today()}" data-role="body-date" value="${esc(weightDraft.date)}"></div><div class="field-group"><label class="label" for="body-weight">Gewicht (kg)</label><input class="field" type="text" inputmode="decimal" id="body-weight" placeholder="z. B. 66,5" data-role="body-weight" value="${esc(weightDraft.weight)}"></div></div>
 <div class="row" style="margin-top:12px"><button class="btn grow" data-action="save-body">${ic(weightDraft.editId?'check':'plus','sm')} ${weightDraft.editId?'Änderung speichern':'Gewicht speichern'}</button>${weightDraft.editId?`<button class="btn secondary" data-action="cancel-body-edit">Abbrechen</button>`:''}</div><p class="helper" style="margin-top:9px">Keine Pflicht zur regelmäßigen Eingabe. Die Messungen sind unabhängig von deinen Trainings.</p></section>
 ${panelTitle('Bisherige Einträge',`<span class="muted tiny">${entries.length} Messungen</span>`)}
 <section class="panel" style="padding:6px 12px">${entries.length?entries.slice().reverse().map(e=>`<div class="list-row"><div class="list-main"><strong>${dateFmt(e.date)}</strong></div><strong style="font-size:13px">${fmt(e.weight)} kg</strong><button class="icon-btn tiny" data-action="edit-body" data-id="${esc(e.id)}" aria-label="Eintrag bearbeiten">${ic('edit','sm')}</button><button class="icon-btn tiny red" data-action="delete-body" data-id="${esc(e.id)}" aria-label="Eintrag löschen">${ic('trash','sm')}</button></div>`).join(''):'<div class="empty">Noch keine Gewichtseinträge.</div>'}</section>`;
}
function settingsHTML(){return `${pageHead('Einstellungen','Datensicherung & Updates')}
 <section class="panel"><div class="row" style="margin-bottom:9px">${ic('download')}<h2>Backup erstellen</h2></div><p class="helper">Sichert alle Übungen, Trainingspläne, abgeschlossenen und laufenden Sessions, Gewichtseinträge und Einstellungen in einer JSON-Datei.</p>
 <button class="btn full" data-action="export" style="margin-top:14px">${ic('download','sm')} Backup herunterladen</button>
 <div class="muted tiny" style="margin-top:9px">Letztes Backup: ${data.lastBackupAt?dateTime(new Date(data.lastBackupAt).getTime()):'Noch keines'}</div></section>
 <section class="panel"><div class="row" style="margin-bottom:9px">${ic('upload')}<h2>Backup wiederherstellen</h2></div><p class="helper">Beim Import werden deine derzeitigen Daten durch die Daten aus der Backup-Datei ersetzt. Die App prüft zuerst das Dateiformat und fragt vor dem Überschreiben nach.</p>
 <button class="btn secondary full" style="margin-top:14px" data-action="import">${ic('upload','sm')} Backup-Datei auswählen</button>
 <input type="file" accept="application/json,.json" id="backup-file" style="display:none"></section>
 <section class="panel"><div class="row" style="margin-bottom:9px">${ic('refresh')}<h2>Spätere Updates</h2></div>
 <p class="helper">Deine Daten liegen getrennt von der App in der lokalen Browserdatenbank. Bei Updates unter derselben Website-Adresse bleiben sie normalerweise erhalten. Wechselt die Adresse oder verwendest du eine neu heruntergeladene Einzeldatei, exportiere vorher ein Backup und importiere es in der neuen Version.</p>
 <div class="notice success" style="margin-top:12px">Empfohlener Ablauf: <strong>Backup exportieren → neue Version öffnen → gegebenenfalls Backup importieren.</strong> Die Backups sind versioniert und auf spätere Datenbank-Migrationen vorbereitet.</div></section>
 <section class="panel"><div class="row between"><span class="muted small">Speicherort</span><strong class="small">${storageMethod==='indexeddb'?'IndexedDB (Gerät)':storageMethod==='localstorage'?'Lokaler Browserspeicher':'Nur temporär!'}</strong></div><div class="line"></div><div class="row between"><span class="muted small">Speicherstatus</span><strong class="small" data-save-status>${lastSaved?'Lokal gespeichert':'Speichert …'}</strong></div><div class="line"></div><div class="row between"><span class="muted small">App-Version</span><strong class="small">${APP_VERSION}</strong></div><div class="line"></div><div class="row between"><span class="muted small">Datenformat</span><strong class="small">v${SCHEMA_VERSION}</strong></div></section>
 <div class="footer-note">Alle Daten bleiben auf deinem Gerät.<br>Kein Benutzerkonto, kein Cloud-Zugriff.</div>`;
}
function exportBackup(){data.lastBackupAt=new Date().toISOString();save();const backup={backupFormat:'GymTrackerBackup',backupVersion:1,exportedAt:data.lastBackupAt,appVersion:APP_VERSION,data:structuredClone(data)};
 const blob=new Blob([JSON.stringify(backup,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`GymTracker_Backup_${today()}.json`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),5000);render();toast('Backup-Datei erstellt.');}
async function importBackup(file){if(!file)return;
 if(file.size>50*1024*1024){toast('Backup-Datei zu groß (max. 50 MB).');return}
 try{
   const text=await file.text(),parsed=JSON.parse(text);
   if(parsed.backupFormat!=='GymTrackerBackup'||parsed.backupVersion!==1)throw new Error('Keine unterstützte GymTracker-Backup-Datei.');
   const imported=migrate(parsed.data);
   if(!confirm(`Backup vom ${dateTime(new Date(parsed.exportedAt).getTime()||Date.now())} importieren?\n\nAlle bisherigen Daten auf diesem Gerät werden ersetzt. Erstelle bei Bedarf vorher ein Backup.`))return;
   clearTimeout(saveTimer);const before=data;data=imported;data.activeSession?.pauseStartedAt&&(data.activeSession.pauseStartedAt=Date.now());
   const ok=await persist();if(!ok){data=before;await persist();throw new Error('Der lokale Speicher konnte nicht beschrieben werden.')}
   selectedExercise=Object.keys(data.exercises)[0]||'';weightDraft={date:today(),weight:'',editId:null};go('home');toast('Backup erfolgreich importiert.');
 }catch(e){console.error(e);toast('Import fehlgeschlagen: '+e.message);}
}
function fieldValue(id){return document.getElementById(id)?.value??''}
function findItem(id){return data.plans[selectedPlan]?.items.find(it=>it.id===id)}
async function handleClick(e){const t=e.target.closest('[data-action]');if(!t)return;
 const a=t.dataset.action;
 if(a==='close-modal-background'){if(e.target===t){modal=null;renderModal()}return;}
 if(a==='home'){go('home');return}
 if(a==='navigate'){go(t.dataset.screen);return}
 if(a==='start'){startSession(t.dataset.plan);return}
 if(a==='pause'){
   const s=data.activeSession;if(!s)return;
   if(s.pauseStartedAt){s.pausedMs+=Date.now()-s.pauseStartedAt;s.pauseStartedAt=null}
   else{s.pauseStartedAt=Date.now()}
   save();render();return;
 }
 if(a==='finish'){finishSession();return}
 if(a==='cancel-session'){if(confirm('Laufende Session wirklich verwerfen? Die bisherigen Eingaben gehen verloren.')){data.activeSession=null;save();go('home');}return}
 if(a==='reset-done'){if(!confirm('Alle Erledigt-Haken für diese Session zurücksetzen? Gewichte und Wiederholungen bleiben stehen.'))return;
   data.activeSession?.entries.forEach(ent=>ent.completed=false);save();render();return}
 if(a==='drop'||a==='up'){
   const s=data.activeSession,index=Number(t.dataset.index),entry=s?.entries[index];if(!entry)return;
   if(a==='drop')entry.drop=!entry.drop;
   else{const p=(s.itemsSnapshot||data.plans[s.planId]?.items||[]).find(it=>it.id===entry.itemId);const prev=lastExerciseEntry(entry.exerciseId);
     const auto=p&&entry.reps.length===p.sets&&entry.reps.every(r=>String(r).trim()!==''&&num(r)!==null&&num(r)>=p.max);
     const current=entry.upOverride===null?!!(auto||prev?.recommendNext):entry.upOverride;entry.upOverride=!current;}
   save();render();return;
 }
 if(a==='select-plan'){selectedPlan=t.dataset.plan;render();return}
 if(a==='open-add'){modal={type:'add'};renderModal();return}
 if(a==='close-modal'){modal=null;renderModal();return}
 if(a==='add-existing'){const id=fieldValue('modal-existing');if(!id)return toast('Bitte eine Übung auswählen.');addPlanExercise(id);return}
 if(a==='add-new'){
   const name=fieldValue('modal-new-ex').trim();if(!name)return toast('Bitte Übungsnamen eingeben.');
   const dupe=Object.values(data.exercises).find(ex=>!ex.archived&&ex.name.toLowerCase()===name.toLowerCase());if(dupe){toast('Übung existiert bereits – bitte oben auswählen.');return}
   const id=uid();data.exercises[id]={id,name,archived:false};addPlanExercise(id);return;
 }
 if(a==='move-item'){const p=data.plans[selectedPlan],index=Number(t.dataset.index),other=index+Number(t.dataset.dir);if(other<0||other>=p.items.length)return;[p.items[index],p.items[other]]=[p.items[other],p.items[index]];save();render();return}
 if(a==='remove-item'){const it=findItem(t.dataset.id);if(!it)return;
   if(!confirm('Übung aus diesem Trainingsplan entfernen? Die Trainingshistorie bleibt gespeichert.'))return;
   data.plans[selectedPlan].items=data.plans[selectedPlan].items.filter(i=>i.id!==t.dataset.id);save();render();return}
 if(a==='edit-item'){modal={type:'edit-item',id:t.dataset.id};renderModal();return}
 if(a==='save-item'){const it=findItem(modal?.id);if(!it)return;
   const sets=num(fieldValue('modal-sets')),min=num(fieldValue('modal-min')),max=num(fieldValue('modal-max'));
   if(!Number.isInteger(sets)||sets<1||sets>10||!Number.isInteger(min)||min<1||min>99||!Number.isInteger(max)||max<min||max>99)return toast('Bitte gültige Sätze und Wiederholungsbereiche eingeben.');
   it.sets=sets;it.min=min;it.max=max;modal=null;save();render();toast('Vorgaben gespeichert.');return;
 }
 if(a==='add-alt'){
   const it=findItem(modal?.id),id=fieldValue('modal-alt');if(!it||!id||!data.exercises[id])return toast('Wähle eine Alternative.');
   if(it.exerciseIds.includes(id))return;if(data.plans[selectedPlan].items.some(x=>x.id!==it.id&&x.exerciseIds.includes(id)))return toast('Diese Übung ist bereits separat im Plan enthalten.');
   it.exerciseIds.push(id);save();renderModal();toast('Alternative hinzugefügt.');return;
 }
 if(a==='remove-alt'){
   const it=findItem(modal?.id);if(!it||it.exerciseIds.length===1)return;
   it.exerciseIds=it.exerciseIds.filter(id=>id!==t.dataset.exercise);save();renderModal();return;
 }
 if(a==='rename-exercise'){modal={type:'rename',id:t.dataset.exercise};renderModal();return}
 if(a==='save-rename'){renameExercise(modal?.id,fieldValue('modal-name'));return}
 if(a==='archive-exercise'){archiveExercise(t.dataset.exercise);return}
 if(a==='restore-exercise'){const ex=data.exercises[t.dataset.exercise];if(ex){ex.archived=false;save();render();toast('Übung wiederhergestellt. Du kannst sie erneut zu Plänen hinzufügen.');}return}
 if(a==='stats-period'){statsPeriod=t.dataset.period;render();return}
 if(a==='month-change'){currentMonth=new Date(currentMonth.getFullYear(),currentMonth.getMonth()+Number(t.dataset.delta),1);selectedCalendarDay='';render();return}
 if(a==='calendar-day'){selectedCalendarDay=t.dataset.date;render();return}
 if(a==='view-session'){detailSessionId=t.dataset.id;go('detail');return}
 if(a==='save-body'){
   const date=fieldValue('body-date'),weight=num(fieldValue('body-weight'));
   if(!isoDate(date)||date>today())return toast('Bitte ein gültiges Datum bis heute auswählen.');
   if(weight===null||weight<=0||weight>500)return toast('Bitte ein gültiges Körpergewicht in kg eingeben.');
   const duplicate=data.bodyEntries.find(x=>x.date===date&&x.id!==weightDraft.editId);
   if(duplicate){if(!confirm('Für dieses Datum gibt es bereits einen Eintrag. Möchtest du ihn ersetzen?'))return;
     data.bodyEntries=data.bodyEntries.filter(x=>x.id!==duplicate.id);}
   if(weightDraft.editId){const found=data.bodyEntries.find(x=>x.id===weightDraft.editId);if(found){found.date=date;found.weight=weight;}else data.bodyEntries.push({id:uid(),date,weight});}
   else data.bodyEntries.push({id:uid(),date,weight});
   weightDraft={date:today(),weight:'',editId:null};save();render();toast('Gewicht gespeichert.');return;
 }
 if(a==='edit-body'){const x=data.bodyEntries.find(x=>x.id===t.dataset.id);if(!x)return;weightDraft={date:x.date,weight:String(x.weight).replace('.',','),editId:x.id};render();document.getElementById('body-date')?.scrollIntoView({behavior:'smooth',block:'center'});return}
 if(a==='delete-body'){
   if(!confirm('Diesen Gewichtseintrag löschen?'))return;
   data.bodyEntries=data.bodyEntries.filter(x=>x.id!==t.dataset.id);if(weightDraft.editId===t.dataset.id)weightDraft={date:today(),weight:'',editId:null};save();render();return;
 }
 if(a==='cancel-body-edit'){weightDraft={date:today(),weight:'',editId:null};render();return}
 if(a==='export'){exportBackup();return}
 if(a==='import'){document.getElementById('backup-file')?.click();return}
}
function handleInput(e){const el=e.target,role=el.dataset?.role;
 if(role==='weight'||role==='rep'){
  const entry=data.activeSession?.entries[Number(el.dataset.index)];if(!entry)return;
  if(role==='weight')entry.weight=el.value;
  else entry.reps[Number(el.dataset.set)]=el.value;
  save();
  // Update the arrow when all regular sets have reached the upper rep target, without rebuilding inputs.
  const box=el.closest('.exercise-card'),upButton=box?.querySelector('.up-btn');if(upButton){const item=(data.activeSession.itemsSnapshot||data.plans[data.activeSession.planId]?.items||[]).find(it=>it.id===entry.itemId);const all=item&&entry.reps.length===item.sets&&entry.reps.every(r=>String(r).trim()!==''&&num(r)!==null&&num(r)>=item.max);
   const suggested=entry.upOverride===null?!!(all||lastExerciseEntry(entry.exerciseId)?.recommendNext):!!entry.upOverride;upButton.classList.toggle('active',suggested);}
 } else if(role==='body-date')weightDraft.date=el.value;
 else if(role==='body-weight')weightDraft.weight=el.value;
 else if(role==='goal'){data.goal[el.dataset.key]=el.value;save()}
}
function handleChange(e){const el=e.target,role=el.dataset?.role;
 if(role==='done'){
   const entry=data.activeSession?.entries[Number(el.dataset.index)];if(!entry)return;
   if(el.checked&&!entry.reps.some(r=>num(r)!==null&&num(r)>0)){el.checked=false;toast('Bitte zuerst deine heutigen Wiederholungen eintragen.');return}
   entry.completed=el.checked;save();render();return;
 }
 if(role==='alt'){switchAlternative(Number(el.dataset.index),el.value);return}
 if(role==='stat-exercise'){selectedExercise=el.value;render();return}
 if(role==='goal'){
   const key=el.dataset.key,v=num(el.value);
   if(el.value.trim()!==''&&(v===null||v<=0||(key==='plannedWeeklyGain'&&v>3)||(key!=='plannedWeeklyGain'&&v>500))){toast('Bitte einen gültigen Wert in kg eingeben.');data.goal[key]='';}
   else data.goal[key]=el.value.trim()===''?'':v;
   save();render();return;
 }
 if(el.id==='backup-file'){importBackup(el.files?.[0]);el.value='';return}
}
appNode.addEventListener('click',handleClick);
appNode.addEventListener('input',handleInput);
appNode.addEventListener('change',handleChange);
modalRoot.addEventListener('click',handleClick);
window.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')persist();else updateTimer()});
window.addEventListener('pagehide',()=>{if(data&&saveTimer)persist()});
// Exposes a read-only snapshot for integration diagnostics; no network requests are made.
window.GymTracker={version:APP_VERSION,getSnapshot:()=>structuredClone(data),storage:()=>storageMethod};
initialize();
