import { db, doc, updateDoc, collection, getDocs } from './firebase.js';
import { state, canSeeAllReports, isMainAdmin, hasPerm } from './state.js';
import { E, esc, tod, monday, addD, fmtKg } from './utils.js';
import { fetchEntries } from './db.js';

const ALL_WIDGETS = [
  { id: 'maiOssz',      label: 'Mai össztermelés',         icon: '⚖️', def: true  },
  { id: 'haviOssz',     label: 'Havi összesítő',           icon: '📊', def: true  },
  { id: 'hetiGrafikon', label: 'Heti grafikon',             icon: '📉', def: true  },
  { id: 'hetiTrend',    label: 'Heti trend',                icon: '📈', def: false },
  { id: 'anyagRangsor', label: 'Anyag rangsor',             icon: '📦', def: true  },
  { id: 'sajatTelj',    label: 'Saját teljesítmény',         icon: '👤', def: false },
  { id: 'topDolg',      label: 'Havi legjobb (top 3)',       icon: '🏅', def: false },
  { id: 'nyitottF',     label: 'Nyitott feladatok',          icon: '📌', def: true  },
  { id: 'aktivDolg',    label: 'Aktív dolgozók',            icon: '👷', def: true  },
  { id: 'szulNapok',    label: 'Közelgő születésnapok',     icon: '🎂', def: false },
  { id: 'jubileum',     label: 'Belépési jubileumok',        icon: '🎖️', def: false },
  { id: 'utobbiBeir',   label: 'Utóbbi bejegyzések',        icon: '📋', def: false },
];

let _inited            = false;
let _autoRefreshTimer  = null;
let _lastCtx           = null;
let _dragQaId          = null;   // drag & drop state

/* ── Egyéni gyors műveletek (custom QA) ── */
const _CQA_KEY = 'nj_cqa';
function _getCustomQA() { try { return JSON.parse(localStorage.getItem(_CQA_KEY) || '[]'); } catch { return []; } }
function _saveCustomQA(list) { localStorage.setItem(_CQA_KEY, JSON.stringify(list)); }

/* ── Egyéni szöveges widgetek ── */
const _CW_KEY = 'nj_cw';
function _getCustomWidgets() { try { return JSON.parse(localStorage.getItem(_CW_KEY) || '[]'); } catch { return []; } }
function _saveCustomWidgets(list) { localStorage.setItem(_CW_KEY, JSON.stringify(list)); }

/* ── Widget-specifikus beállítások ── */
const _WST_KEY = 'nj_wst';
function _getWidgetSettings(wid) { try { return (JSON.parse(localStorage.getItem(_WST_KEY) || '{}'))[wid] || {}; } catch { return {}; } }
function _saveWidgetSettings(wid, s) {
  try { const all = JSON.parse(localStorage.getItem(_WST_KEY) || '{}'); all[wid] = { ...(all[wid] || {}), ...s }; localStorage.setItem(_WST_KEY, JSON.stringify(all)); } catch {}
}

const DRAWER_WIDGETS = ['maiOssz','haviOssz','nyitottF','topDolg','sajatTelj','anyagRangsor'];

/* ── Jogosultságok ── */
function _empPerm()       { return isMainAdmin() || hasPerm('dolgozokMegtekintes') || hasPerm('dolgozokKezeles'); }
function _canSeeWidget(id) {
  const canReadEntries = isMainAdmin() || hasPerm('sajatJelentes') || hasPerm('mindenJelentes');
  if (['maiOssz','haviOssz','hetiTrend','hetiGrafikon','anyagRangsor','utobbiBeir'].includes(id)) return canReadEntries;
  if (id === 'sajatTelj') return isMainAdmin() || hasPerm('adatbevitel') || hasPerm('sajatJelentes') || hasPerm('mindenJelentes');
  if (id === 'topDolg')   return canSeeAllReports();
  if (id === 'aktivDolg') return _empPerm();
  if (id === 'szulNapok') return _empPerm();
  if (id === 'jubileum')  return _empPerm();
  if (id === 'nyitottF')  return isMainAdmin() || hasPerm('feladatokKezeles');
  return true;
}
function _availableWidgets() { return ALL_WIDGETS.filter(w => _canSeeWidget(w.id)); }

/* ── Widget beállítások ── */
const WIDGET_COLORS = [
  { id: '',       dot: 'transparent', border: '' },
  { id: 'accent', dot: 'var(--accent)', border: 'var(--accent)' },
  { id: 'green',  dot: 'var(--green)',  border: 'var(--green)'  },
  { id: 'amber',  dot: 'var(--amber)',  border: 'var(--amber)'  },
  { id: 'red',    dot: 'var(--red)',    border: 'var(--red)'    },
  { id: 'purple', dot: '#8B5CF6',       border: '#8B5CF6'       },
];

function _getEnabled() {
  const customIds = _getCustomWidgets().map(w => w.id);
  const saved = state.userData?.dashboardWidgets;
  let list;
  if (Array.isArray(saved) && saved.length) {
    const valid = saved.filter(id => _canSeeWidget(id) || customIds.includes(id));
    customIds.forEach(id => { if (!valid.includes(id)) valid.push(id); });
    list = valid;
  } else {
    list = [..._availableWidgets().filter(w => w.def).map(w => w.id), ...customIds];
  }
  // Rögzített widgetek a lista elejére kerülnek
  const pinned = list.filter(id => _getWidgetSettings(id).pinned);
  const rest   = list.filter(id => !_getWidgetSettings(id).pinned);
  return [...pinned, ...rest];
}
async function _saveConfig(ids) {
  if (state.userData) state.userData.dashboardWidgets = ids;
  if (state.appUser) {
    try { await updateDoc(doc(db, 'users', state.appUser.uid), { dashboardWidgets: ids }); } catch (e) { console.warn('dashConfig save:', e.message); }
  }
}

/* ── Widget méret ── */
function _getWidgetSizes() {
  const s = state.userData?.dashboardWidgetSizes;
  if (s && typeof s === 'object' && !Array.isArray(s)) return s;
  try { return JSON.parse(localStorage.getItem('nj_wsz') || '{}'); } catch { return {}; }
}
async function _saveWidgetSizes(sizes) {
  localStorage.setItem('nj_wsz', JSON.stringify(sizes));
  if (state.userData) state.userData.dashboardWidgetSizes = sizes;
  if (state.appUser) {
    try { await updateDoc(doc(db, 'users', state.appUser.uid), { dashboardWidgetSizes: sizes }); } catch {}
  }
}

/* ── Auto-frissítés ── */
function _startAutoRefresh(minutes) {
  if (_autoRefreshTimer) { clearInterval(_autoRefreshTimer); _autoRefreshTimer = null; }
  if (minutes > 0) _autoRefreshTimer = setInterval(_loadWidgets, minutes * 60 * 1000);
}
/* ══════════════════════════════════════
   WIDGET DETAIL DRAWER
══════════════════════════════════════ */

export function closeWidgetDrawer() {
  E('widgetDrawer')?.classList.remove('open');
  E('widgetDrawerOverlay')?.classList.remove('open');
  document.body.style.overflow = '';
}


const _WD_META = {
  maiOssz:     { icon:'⚖️', title:'Mai össztermelés – részletes' },
  haviOssz:    { icon:'📊', title:'Havi összesítő – részletes' },
  nyitottF:    { icon:'📌', title:'Nyitott feladatok' },
  topDolg:     { icon:'🏅', title:'Havi legjobb – teljes rangsor' },
  sajatTelj:   { icon:'👤', title:'Saját teljesítmény – 14 napos trend' },
  anyagRangsor:{ icon:'📦', title:'Anyag rangsor – teljes lista' },
};

async function _openWidgetDrawer(wid) {
  const meta = _WD_META[wid]; if (!meta || !_lastCtx) return;
  const drawer = E('widgetDrawer'), body = E('widgetDrawerBody');
  if (!drawer || !body) return;

  if (E('widgetDrawerIcon'))  E('widgetDrawerIcon').textContent  = meta.icon;
  if (E('widgetDrawerTitle')) E('widgetDrawerTitle').textContent = meta.title;
  body.innerHTML = '<div class="empty-st"><div class="spinner" style="margin:0 auto"></div></div>';
  drawer.classList.add('open');
  E('widgetDrawerOverlay')?.classList.add('open');
  document.body.style.overflow = 'hidden';

  // Extra adat lekérése ahol szükséges
  let extra = {};
  if (wid === 'sajatTelj') {
    const from14 = addD(tod(), -13);
    extra.entries14 = await fetchEntries({ datumFrom: from14, datumTo: tod() }).catch(() => []);
  }

  try {
    body.innerHTML = _buildWidgetDrawerContent(wid, _lastCtx, extra) ||
      `<div class="empty-st"><div class="empty-ic">📭</div><div class="empty-title">Nincs adat</div></div>`;
  } catch (err) {
    console.error('Widget drawer hiba:', wid, err);
    body.innerHTML = `<div class="empty-st"><div class="empty-ic">⚠️</div><div class="empty-title">Betöltési hiba</div><div class="empty-sub">${err.message}</div></div>`;
  }
}

function _buildWidgetDrawerContent(wid, ctx, extra = {}) {
  const { todayEntries, thisWeekEntries, prevWeekEntries, monthEntries,
          today, weekStart, monthStart, sumKg, kgOf, tasksSnap } = ctx;

  /* ── Segéd ── */
  const workerTable = (rank, maxKg) => rank.map(([nev,kg],i) => {
    const barW = Math.round(kg/maxKg*80);
    return `<tr><td style="color:var(--text3);width:22px;">${i+1}.</td>
      <td style="font-weight:600;">${esc(nev)}</td>
      <td style="text-align:right;font-weight:700;">${(kg/1000).toFixed(2)} t</td>
      <td style="width:90px;padding-left:8px;">
        <div style="height:5px;background:var(--surf2);border-radius:3px;">
          <div style="height:100%;width:${barW}px;background:var(--accent);border-radius:3px;opacity:.65;"></div>
        </div>
      </td></tr>`;
  }).join('');

  const section = (title, content) =>
    `<div class="emp-drawer-section"><div class="emp-drawer-section-title">${title}</div>${content}</div>`;

  /* ── ⚖️ Mai össztermelés ── */
  if (wid === 'maiOssz') {
    if (!todayEntries.length) return `<div class="empty-st"><div class="empty-ic">📭</div><div class="empty-title">Nincs mai adat</div><div class="empty-sub">Még nem lett rögzítve termelési adat a mai napra. Menj az Adatbevitel fülre és rögzítsd az adatokat.</div></div>`;
    const byW = {}, byM = {}, byS = { Délelőtt:0, Délután:0 };
    todayEntries.forEach(e => {
      const kg = kgOf(e);
      byW[e.nev] = (byW[e.nev]||0) + kg;
      const mat = (e.anyag||'').trim(); if (mat) byM[mat] = (byM[mat]||0) + kg;
      byS[(e.ido||'').trim()==='Délután'?'Délután':'Délelőtt'] += kg;
    });
    const wRank = Object.entries(byW).sort((a,b)=>b[1]-a[1]);
    const mRank = Object.entries(byM).sort((a,b)=>b[1]-a[1]);
    const maxW = wRank[0]?.[1] || 1, totM = mRank.reduce((s,[,v])=>s+v,0);
    const maxSh = Math.max(byS.Délelőtt, byS.Délután, 1);

    // 7 napos mini chart
    const last7s = addD(today, -6);
    const d7map = {};
    [...prevWeekEntries, ...thisWeekEntries].filter(e=>e.datum>=last7s).forEach(e=>{
      d7map[e.datum]=(d7map[e.datum]||0)+kgOf(e);
    });
    const perDay7 = Object.entries(d7map).sort((a,b)=>a[0].localeCompare(b[0])).map(([datum,kg])=>({datum,kg}));

    return section('Műszak bontás', `
      <div style="margin-bottom:8px;">
        <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text3);margin-bottom:4px;"><span>☀️ Délelőtt</span><span style="font-weight:600;">${(byS.Délelőtt/1000).toFixed(2)} t</span></div>
        <div style="height:9px;background:var(--surf2);border-radius:4px;overflow:hidden;"><div style="height:100%;width:${Math.round(byS.Délelőtt/maxSh*100)}%;background:var(--amber);border-radius:4px;"></div></div>
      </div>
      <div>
        <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text3);margin-bottom:4px;"><span>🌙 Délután</span><span style="font-weight:600;">${(byS.Délután/1000).toFixed(2)} t</span></div>
        <div style="height:9px;background:var(--surf2);border-radius:4px;overflow:hidden;"><div style="height:100%;width:${Math.round(byS.Délután/maxSh*100)}%;background:var(--accent);border-radius:4px;"></div></div>
      </div>`) +
    section(`Dolgozónként (${wRank.length} fő)`,
      `<table class="stbl"><tbody>${workerTable(wRank, maxW)}</tbody></table>`) +
    (mRank.length ? section('Anyagonként',
      `<table class="stbl"><tbody>${mRank.map(([mat,kg])=>`<tr>
        <td style="font-weight:600;">${esc(mat)}</td>
        <td style="text-align:right;font-weight:700;">${(kg/1000).toFixed(2)} t</td>
        <td style="text-align:right;color:var(--text3);font-size:11px;">${Math.round(kg/totM*100)}%</td>
      </tr>`).join('')}</tbody></table>`) : '') +
    (perDay7.length>=2 ? section('Utolsó 7 nap', _svgLineChart(perDay7)) : '');
  }

  /* ── 📊 Havi összesítő ── */
  if (wid === 'haviOssz') {
    if (!monthEntries.length) return '';
    const byDay = {};
    monthEntries.forEach(e => { byDay[e.datum]=(byDay[e.datum]||0)+kgOf(e); });
    const days = Object.entries(byDay).sort((a,b)=>a[0].localeCompare(b[0]));
    const vals = days.map(([,v])=>v);
    const best = days.reduce((b,d)=>d[1]>b[1]?d:b, days[0]);
    const worst = days.reduce((b,d)=>d[1]<b[1]?d:b, days[0]);
    const wkMap = {};
    monthEntries.forEach(e=>{ const ws=monday(e.datum); wkMap[ws]=(wkMap[ws]||0)+kgOf(e); });
    const weeks = Object.entries(wkMap).sort((a,b)=>a[0].localeCompare(b[0]));
    const maxW = Math.max(...weeks.map(([,v])=>v),1);
    const totKg = vals.reduce((s,v)=>s+v,0);
    const perDay = days.map(([datum,kg])=>({datum,kg}));

    return section('Összefoglaló', `
      <div class="nossz">
        <div class="nossz-item"><div class="nossz-val">${(totKg/1000).toFixed(2)} t</div><div class="nossz-lbl">Összes</div></div>
        <div class="nossz-item"><div class="nossz-val">${days.length}</div><div class="nossz-lbl">Aktív nap</div></div>
        <div class="nossz-item"><div class="nossz-val">${((totKg/1000)/days.length).toFixed(2)} t</div><div class="nossz-lbl">Napi átlag</div></div>
      </div>`) +
    section('Szélső napok', `
      <div class="emp-drawer-row"><span class="emp-drawer-row-icon">🏆</span><span>Legjobb: <strong>${best[0]}</strong> — ${(best[1]/1000).toFixed(2)} t</span></div>
      ${worst[0]!==best[0]?`<div class="emp-drawer-row"><span class="emp-drawer-row-icon">📉</span><span>Leggyengébb: <strong>${worst[0]}</strong> — ${(worst[1]/1000).toFixed(2)} t</span></div>`:''}`) +
    (weeks.length>1 ? section('Heti bontás', weeks.map(([ws,kg],i)=>`
      <div style="margin-bottom:9px;">
        <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px;">
          <span style="color:var(--text3);">${i+1}. hét</span><span style="font-weight:600;">${(kg/1000).toFixed(2)} t</span>
        </div>
        <div style="height:7px;background:var(--surf2);border-radius:3px;overflow:hidden;">
          <div style="height:100%;width:${Math.round(kg/maxW*100)}%;background:var(--accent);border-radius:3px;opacity:.7;"></div>
        </div>
      </div>`).join('')) : '') +
    (perDay.length>=2 ? section('Napi trend', _svgLineChart(perDay)) : '');
  }

  /* ── 📌 Nyitott feladatok ── */
  if (wid === 'nyitottF') {
    const all = (tasksSnap?.docs || []).map(d=>({id:d.id,...d.data()}));
    const open = all.filter(t=>t.statusz==='nyitott'||t.statusz==='folyamatban').sort((a,b)=>{
      const ap=a.prioritas==='fontos'?0:1, bp=b.prioritas==='fontos'?0:1;
      if (ap!==bp) return ap-bp;
      const al=a.datum&&a.datum<today?-1:0, bl=b.datum&&b.datum<today?-1:0;
      if (al!==bl) return al-bl;
      return (a.datum||'9').localeCompare(b.datum||'9');
    });
    if (!open.length) return '<div class="empty-st"><div class="empty-ic">✅</div><div class="empty-title">Nincs nyitott feladat</div></div>';
    const expired = open.filter(t=>t.datum&&t.datum<today).length;
    const rows = open.map(t=>{
      const lejart=t.datum&&t.datum<today, fontos=t.prioritas==='fontos';
      const folyamat=t.statusz==='folyamatban';
      return `<div style="padding:9px 0;border-bottom:1px solid var(--border);">
        <div style="display:flex;align-items:flex-start;gap:8px;">
          ${fontos?'<span style="color:var(--red);font-size:14px;flex-shrink:0;">⚡</span>':'<span style="color:var(--border2);font-size:14px;flex-shrink:0;">○</span>'}
          <div style="flex:1;min-width:0;">
            <div style="font-weight:600;font-size:13.5px;color:var(--text);">${esc(t.cim)}</div>
            <div style="font-size:11.5px;color:var(--text3);margin-top:3px;display:flex;flex-wrap:wrap;gap:6px;">
              ${t.datum?`<span style="color:${lejart?'var(--red)':'inherit'};">📅 ${esc(t.datum)}${lejart?' ⚠️':''}</span>`:''}
              ${t.reszleg?`<span>📍 ${esc(t.reszleg)}</span>`:''}
              ${folyamat?'<span style="color:var(--amber);font-weight:600;">◑ Folyamatban</span>':''}
            </div>
          </div>
        </div>
      </div>`;
    }).join('');
    return `<div style="font-size:12px;color:var(--text3);margin-bottom:12px;">${open.length} nyitott feladat${expired?` · <span style="color:var(--red);font-weight:600;">${expired} lejárt</span>`:''}</div>
      ${rows}
      <div style="margin-top:14px;"><button class="btn btn-ghost btn-sm wd-goto-tasks" style="width:100%;">📌 Feladatok megnyitása →</button></div>`;
  }

  /* ── 🏅 Havi legjobb – teljes rangsor ── */
  if (wid === 'topDolg') {
    const byWD = {};
    monthEntries.forEach(e=>{
      const key=`${e.nev}__${e.datum}`, kg=kgOf(e);
      if (!byWD[key]) byWD[key]={nev:e.nev,kg:0};
      byWD[key].kg+=kg;
    });
    const byW = {};
    Object.values(byWD).forEach(({nev,kg})=>{ if (!byW[nev]) byW[nev]=[]; byW[nev].push(kg); });
    const rank = Object.entries(byW).map(([nev,vals])=>({
      nev, avg:vals.reduce((s,v)=>s+v,0)/vals.length,
      total:vals.reduce((s,v)=>s+v,0), napok:vals.length
    })).sort((a,b)=>b.avg-a.avg);
    if (!rank.length) return '';
    const medals=['🥇','🥈','🥉'];
    const maxAvg=rank[0].avg;
    const tableRows = rank.map((w,i)=>`<tr>
      <td style="font-size:15px;text-align:center;width:30px;">${medals[i]||`${i+1}.`}</td>
      <td style="font-weight:600;color:var(--text);">${esc(w.nev)}</td>
      <td style="text-align:right;font-weight:700;color:${i===0?'var(--green)':'inherit'};">${(w.avg/1000).toFixed(2)} t</td>
      <td style="text-align:right;color:var(--text3);font-size:12px;">${w.napok} nap</td>
    </tr>`).join('');

    // Top dolgozó anyag-bontása
    const top = rank[0];
    const topMat={};
    monthEntries.filter(e=>e.nev===top.nev).forEach(e=>{
      const mat=(e.anyag||'').trim(); if(!mat) return;
      topMat[mat]=(topMat[mat]||0)+kgOf(e);
    });
    const matRows=Object.entries(topMat).sort((a,b)=>b[1]-a[1]).slice(0,4).map(([mat,kg])=>`
      <div class="emp-drawer-row"><span class="emp-drawer-row-icon">📦</span>
        <span style="flex:1;">${esc(mat)}</span>
        <span style="font-weight:600;">${(kg/1000).toFixed(2)} t</span>
      </div>`).join('');

    return section(`Teljes rangsor (${rank.length} dolgozó)`,
      `<table class="stbl"><tbody>${tableRows}</tbody></table>`) +
      section(`🏆 ${esc(top.nev)} anyag-bontása`,matRows);
  }

  /* ── 👤 Saját teljesítmény ── */
  if (wid === 'sajatTelj') {
    const selected = ctx.sajatDolgozo || '';
    if (!selected) return `<div class="empty-st"><div class="empty-ic">👤</div><div class="empty-title">Nincs kiválasztott dolgozó</div><div class="empty-sub">A widgetben lévő legördülőből válassz dolgozót, majd kattints újra a widgetre.</div></div>`;
    const e14 = (extra.entries14||[]).filter(e=>e.nev===selected);
    if (!e14.length) return `<div class="empty-st"><div class="empty-ic">📭</div><div class="empty-title">Nincs adat az elmúlt 14 napban</div><div class="empty-sub">${esc(selected)} nevű dolgozónak nincs termelési bejegyzése az elmúlt 14 napban.</div></div>`;

    // 14 napos chart
    const byDay14={};
    e14.forEach(e=>{byDay14[e.datum]=(byDay14[e.datum]||0)+kgOf(e);});
    const perDay14=Object.entries(byDay14).sort((a,b)=>a[0].localeCompare(b[0])).map(([datum,kg])=>({datum,kg}));

    // Havi anyag bontás
    const myMonth=monthEntries.filter(e=>e.nev===selected);
    const matMap={};
    myMonth.forEach(e=>{const m=(e.anyag||'').trim();if(m)matMap[m]=(matMap[m]||0)+kgOf(e);});
    const matRank=Object.entries(matMap).sort((a,b)=>b[1]-a[1]);
    const matRows=matRank.map(([mat,kg],i)=>`<tr>
      <td style="color:var(--text3);">${i+1}.</td>
      <td style="font-weight:600;">${esc(mat)}</td>
      <td style="text-align:right;font-weight:700;">${(kg/1000).toFixed(2)} t</td>
    </tr>`).join('');

    const vals14=Object.values(byDay14);
    const avg14=vals14.length?vals14.reduce((s,v)=>s+v,0)/vals14.length:0;
    const best14=vals14.length?Math.max(...vals14):0;

    return section(`${esc(selected)} – 14 napos trend`, _svgLineChart(perDay14)) +
      section('Statisztikák (14 nap)', `
        <div class="nossz">
          <div class="nossz-item"><div class="nossz-val">${(avg14/1000).toFixed(2)} t</div><div class="nossz-lbl">Napi átlag</div></div>
          <div class="nossz-item"><div class="nossz-val">${(best14/1000).toFixed(2)} t</div><div class="nossz-lbl">Legjobb nap</div></div>
          <div class="nossz-item"><div class="nossz-val">${vals14.length}</div><div class="nossz-lbl">Aktív nap</div></div>
        </div>`) +
      (matRank.length ? section('Anyagonkénti bontás (hónap)',`<table class="stbl"><tbody>${matRows}</tbody></table>`) : '');
  }

  /* ── 📦 Anyag rangsor – teljes ── */
  if (wid === 'anyagRangsor') {
    const byMD={};
    monthEntries.forEach(e=>{
      const mat=(e.anyag||'').trim(); if(!mat) return;
      const kg=kgOf(e), key=`${mat}||${e.nev}||${e.datum}`;
      if(!byMD[key]) byMD[key]={mat,nev:e.nev,kg:0};
      byMD[key].kg+=kg;
    });
    const byMat={};
    Object.values(byMD).forEach(({mat,nev,kg})=>{
      if(!byMat[mat]) byMat[mat]={total:0,workers:{}};
      byMat[mat].total+=kg;
      byMat[mat].workers[nev]=(byMat[mat].workers[nev]||0)+kg;
    });
    const matRank=Object.entries(byMat).sort((a,b)=>b[1].total-a[1].total);
    if(!matRank.length) return '';
    const grandTotal=matRank.reduce((s,[,v])=>s+v.total,0);
    const rows=matRank.map(([mat,{total,workers}],i)=>{
      const topW=Object.entries(workers).sort((a,b)=>b[1]-a[1])[0];
      const pct=Math.round(total/grandTotal*100);
      const barW=Math.round(pct*0.7);
      return `<div style="padding:9px 0;border-bottom:1px solid var(--border);">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:5px;">
          <span style="color:var(--text3);width:22px;font-size:12px;">${i+1}.</span>
          <span style="font-weight:700;font-size:13.5px;flex:1;">${esc(mat)}</span>
          <span style="font-weight:700;">${(total/1000).toFixed(2)} t</span>
          <span style="font-size:11px;color:var(--text3);">${pct}%</span>
        </div>
        <div style="display:flex;align-items:center;gap:8px;padding-left:30px;">
          <div style="height:5px;background:var(--surf2);border-radius:3px;flex:1;overflow:hidden;">
            <div style="height:100%;width:${pct}%;background:var(--accent);border-radius:3px;opacity:.6;"></div>
          </div>
        </div>
        ${topW?`<div style="font-size:11.5px;color:var(--text3);padding-left:30px;margin-top:3px;">Top: ${esc(topW[0])} · ${(topW[1]/1000).toFixed(2)} t</div>`:''}
      </div>`;
    }).join('');
    return `<div style="font-size:12px;color:var(--text3);margin-bottom:12px;">Összes: ${(grandTotal/1000).toFixed(2)} t · ${matRank.length} anyag</div>${rows}`;
  }

  return '';
}

export function setAutoRefresh(minutes) {
  localStorage.setItem('nj_autorefresh', String(minutes));
  _startAutoRefresh(minutes);
}

/* ── Konfig panel ── */
const _WST_DEFS = {
  anyagRangsor: { key: 'topN',   label: 'Megjelenített anyagok',   opts: [['3','3'],['5','5'],['8','8']], def: '5' },
  topDolg:      { key: 'period', label: 'Időszak',                 opts: [['havi','Ebben a hónapban'],['heti','Ezen a héten']], def: 'havi' },
  szulNapok:    { key: 'days',   label: 'Előre nézett napok',      opts: [['14','14 nap'],['30','30 nap'],['60','60 nap']], def: '30' },
  nyitottF:     { key: 'scope',  label: 'Megjelenítés',            opts: [['nyitott','Csak nyitott'],['all','Minden aktív']], def: 'nyitott' },
};

function _renderConfig() {
  const enabled = _getEnabled();
  const sizes   = _getWidgetSizes();
  const customW = _getCustomWidgets();

  /* ── Widgetek szekció ── */
  const widgetHtml = [
    ..._availableWidgets().map(w => {
      const isEnabled = enabled.includes(w.id);
      const isLarge   = sizes[w.id] === 'large';
      const wstDef    = _WST_DEFS[w.id];
      const wst       = _getWidgetSettings(w.id);
      const curVal    = wst[wstDef?.key] ?? wstDef?.def ?? '';
      const isPinned  = !!wst.pinned;
      const curColor  = wst.color || '';
      const curTitle  = wst.customTitle || '';
      const settingsHtml = (isEnabled && wstDef) ? `
        <div class="cfg-wst-row">
          <span class="cfg-wst-lbl">${wstDef.label}:</span>
          <select class="cfg-wst-sel" data-wid="${w.id}" data-key="${wstDef.key}">
            ${wstDef.opts.map(([v,l]) => `<option value="${v}"${curVal===v?' selected':''}>${l}</option>`).join('')}
          </select>
        </div>` : '';
      const personHtml = isEnabled ? `
        <div class="cfg-person-row">
          <input type="text" class="cfg-title-inp" data-wid="${w.id}" value="${esc(curTitle)}" placeholder="Egyéni cím…">
          <div class="cfg-color-dots">
            ${WIDGET_COLORS.map(c => `<button type="button" class="cfg-color-dot${curColor===c.id?' active':''}" data-wid="${w.id}" data-color="${c.id}" style="background:${c.dot||'var(--border2)'}" title="${c.id||'Alapértelmezett'}"></button>`).join('')}
          </div>
        </div>` : '';
      return `<div class="dash-cfg-item">
        <label class="dash-cfg-lbl">
          <input type="checkbox" data-wid="${w.id}"${isEnabled ? ' checked' : ''}>
          <span>${w.icon} ${w.label}</span>
          ${isEnabled ? `
            <button class="dash-size-btn" type="button" data-wid="${w.id}">${isLarge ? '▭ Nagy' : '▢ Kis'}</button>
            <button class="cfg-pin-btn${isPinned?' active':''}" type="button" data-wid="${w.id}" title="${isPinned?'Rögzített':'Rögzítés'}">📌</button>` : ''}
        </label>
        ${settingsHtml}${personHtml}
      </div>`;
    }),
    ...customW.map(cw => `
      <div class="dash-cfg-item">
        <label class="dash-cfg-lbl">
          <input type="checkbox" data-wid="${cw.id}" checked>
          <span>${cw.icon} ${esc(cw.title)}</span>
          <button class="cw-del-btn" type="button" data-cwid="${cw.id}" title="Törlés">✕</button>
        </label>
      </div>`)
  ].join('');

  E('dashConfigWidgets').innerHTML = widgetHtml + `
    <div class="cfg-add-section" id="cfgCwSection">
      <button class="cfg-add-toggle" id="cfgCwToggle">＋ Saját szöveges widget</button>
      <div id="cfgCwForm" class="cfg-add-form" style="display:none">
        <div class="g2" style="margin-bottom:6px">
          <input type="text" id="cfgCwIcon"  placeholder="Ikon (pl. 📝)" maxlength="4" style="width:80px">
          <input type="text" id="cfgCwTitle" placeholder="Cím (pl. Fontos infó)">
        </div>
        <textarea id="cfgCwContent" placeholder="Tartalom szövege…" style="min-height:60px;margin-bottom:6px;resize:vertical"></textarea>
        <button class="btn btn-primary btn-sm" id="cfgCwAddBtn">Hozzáad</button>
      </div>
    </div>`;

  // Widget checkbox events — a meglévő sorrendet megőrzi
  E('dashConfigWidgets').querySelectorAll('input[data-wid]').forEach(cb => {
    cb.addEventListener('change', async () => {
      const allCwIds = _getCustomWidgets().map(c => c.id);
      let ids = _getEnabled(); // meglévő sorrend megőrzése
      if (cb.checked) {
        if (!ids.includes(cb.dataset.wid)) ids = [...ids, cb.dataset.wid];
      } else {
        if (allCwIds.includes(cb.dataset.wid)) {
          if (!confirm('Törlöd ezt a saját widgetet?')) { cb.checked = true; return; }
          _saveCustomWidgets(_getCustomWidgets().filter(c => c.id !== cb.dataset.wid));
        }
        ids = ids.filter(id => id !== cb.dataset.wid);
      }
      await _saveConfig(ids);
      _renderConfig();
      await _loadWidgets();
    });
  });
  E('dashConfigWidgets').querySelectorAll('.dash-size-btn').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.preventDefault(); e.stopPropagation();
      const curr = _getWidgetSizes(); const wid = btn.dataset.wid; const next = { ...curr };
      if (curr[wid] === 'large') delete next[wid]; else next[wid] = 'large';
      await _saveWidgetSizes(next); _renderConfig(); await _loadWidgets();
    });
  });
  // Egyéni cím mentése (debounced)
  let _titleT = null;
  E('dashConfigWidgets').querySelectorAll('.cfg-title-inp').forEach(inp => {
    inp.addEventListener('input', () => {
      clearTimeout(_titleT);
      _titleT = setTimeout(async () => {
        _saveWidgetSettings(inp.dataset.wid, { customTitle: inp.value.trim() });
        await _loadWidgets();
      }, 600);
    });
  });
  // Szín pontok
  E('dashConfigWidgets').querySelectorAll('.cfg-color-dot').forEach(dot => {
    dot.addEventListener('click', async () => {
      _saveWidgetSettings(dot.dataset.wid, { color: dot.dataset.color });
      _renderConfig();
      await _loadWidgets();
    });
  });
  // Pin gomb (config panelben)
  E('dashConfigWidgets').querySelectorAll('.cfg-pin-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const wst = _getWidgetSettings(btn.dataset.wid);
      _saveWidgetSettings(btn.dataset.wid, { pinned: !wst.pinned });
      _renderConfig();
      await _loadWidgets();
    });
  });
  E('dashConfigWidgets').querySelectorAll('.cfg-wst-sel').forEach(sel => {
    sel.addEventListener('change', async () => {
      _saveWidgetSettings(sel.dataset.wid, { [sel.dataset.key]: sel.value });
      await _loadWidgets();
    });
  });
  E('dashConfigWidgets').querySelectorAll('.cw-del-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Törlöd ezt a widgetet?')) return;
      const list = _getCustomWidgets().filter(c => c.id !== btn.dataset.cwid);
      _saveCustomWidgets(list);
      const ids = _getEnabled().filter(id => id !== btn.dataset.cwid);
      await _saveConfig(ids);
      _renderConfig(); await _loadWidgets();
    });
  });
  // Custom widget form toggle + add
  E('cfgCwToggle').addEventListener('click', () => {
    const f = E('cfgCwForm'); f.style.display = f.style.display === 'none' ? '' : 'none';
  });
  E('cfgCwAddBtn').addEventListener('click', async () => {
    const icon    = E('cfgCwIcon').value.trim()    || '📝';
    const title   = E('cfgCwTitle').value.trim();
    const content = E('cfgCwContent').value.trim();
    if (!title) { E('cfgCwTitle').focus(); return; }
    const id      = 'cw_' + Date.now();
    // _getEnabled() ELŐTT mentjük a custom widget-et, hogy ne duplikáljon
    const prevIds = _getEnabled();
    _saveCustomWidgets([..._getCustomWidgets(), { id, icon, title, content }]);
    await _saveConfig([...prevIds, id]);
    _renderConfig(); await _loadWidgets();
  });

  /* ── Gyors műveletek szekció ── */
  const enabledQA = _getEnabledQA();
  const allQA     = _allQA();
  const customQA  = _getCustomQA();

  // Engedélyezett elemek drag-gal, a többi alatta checkbox
  const enabledItems  = enabledQA.map(id => allQA.find(a => a.id === id)).filter(Boolean);
  const disabledItems = allQA.filter(a => !enabledQA.includes(a.id));

  const qaHtml = `
    <div id="qaEnabledList" class="qa-drag-list">
      ${enabledItems.map(a => `
        <div class="qa-drag-item" draggable="true" data-qaid="${a.id}">
          <span class="qa-drag-handle">⠿</span>
          <input type="checkbox" data-qaid="${a.id}" checked>
          <span>${a.icon} ${esc(a.label)}</span>
          ${a.isCustom ? `<button class="cqa-del-btn btn btn-ghost btn-xs" data-cqaid="${a.id}" type="button">✕</button>` : ''}
        </div>`).join('')}
    </div>
    ${disabledItems.length ? `<div class="qa-disabled-list">
      ${disabledItems.map(a => `
        <label class="dash-cfg-lbl qa-disabled-item">
          <input type="checkbox" data-qaid="${a.id}">
          <span>${a.icon} ${esc(a.label)}</span>
        </label>`).join('')}
    </div>` : ''}
    <div class="cfg-add-section">
      <button class="cfg-add-toggle" id="cfgCqaToggle">＋ Egyéni link hozzáadása</button>
      <div id="cfgCqaForm" class="cfg-add-form" style="display:none">
        <div class="g2" style="margin-bottom:6px">
          <input type="text" id="cfgCqaIcon"  placeholder="Ikon (pl. 🔗)" maxlength="4" style="width:80px">
          <input type="text" id="cfgCqaLabel" placeholder="Felirat (pl. Google Sheet)">
        </div>
        <input type="url" id="cfgCqaUrl" placeholder="URL (pl. https://…)" style="margin-bottom:6px">
        <button class="btn btn-primary btn-sm" id="cfgCqaAddBtn">Hozzáad</button>
      </div>
    </div>`;

  E('dashQaConfigWidgets').innerHTML = qaHtml;

  // QA drag & drop — event delegation a konténeren, csak handle-ről indítható
  const qaDragList = E('qaEnabledList');
  qaDragList.querySelectorAll('.qa-drag-item').forEach(item => {
    // Drag csak a ⠿ handle-ről indul
    item.addEventListener('mousedown', e => {
      item.draggable = !!e.target.closest('.qa-drag-handle');
    });
  });
  qaDragList.addEventListener('dragstart', e => {
    const item = e.target.closest('.qa-drag-item'); if (!item) return;
    _dragQaId = item.dataset.qaid;
    item.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', _dragQaId);
  });
  qaDragList.addEventListener('dragend', () => {
    qaDragList.querySelectorAll('.qa-drag-item').forEach(i => i.classList.remove('dragging', 'drag-over'));
    _dragQaId = null;
  });
  qaDragList.addEventListener('dragover', e => {
    e.preventDefault();
    const item = e.target.closest('.qa-drag-item');
    if (!item || item.dataset.qaid === _dragQaId) return;
    qaDragList.querySelectorAll('.qa-drag-item').forEach(i => i.classList.remove('drag-over'));
    item.classList.add('drag-over');
  });
  qaDragList.addEventListener('dragleave', e => {
    if (!qaDragList.contains(e.relatedTarget)) {
      qaDragList.querySelectorAll('.qa-drag-item').forEach(i => i.classList.remove('drag-over'));
    }
  });
  qaDragList.addEventListener('drop', async e => {
    e.preventDefault();
    const target = e.target.closest('.qa-drag-item');
    qaDragList.querySelectorAll('.qa-drag-item').forEach(i => i.classList.remove('drag-over'));
    if (!target || !_dragQaId || target.dataset.qaid === _dragQaId) return;
    const order = [...enabledQA];
    const fromI = order.indexOf(_dragQaId);
    const toI   = order.indexOf(target.dataset.qaid);
    if (fromI < 0 || toI < 0) return;
    order.splice(fromI, 1); order.splice(toI, 0, _dragQaId);
    _dragQaId = null;
    await _saveQAConfig(order);
    _renderConfig(); _renderQuickActions();
  });

  // QA checkbox events
  E('dashQaConfigWidgets').querySelectorAll('input[data-qaid]').forEach(cb => {
    cb.addEventListener('change', async () => {
      let ids = _getEnabledQA();
      if (cb.checked) ids = [...ids, cb.dataset.qaid];
      else ids = ids.filter(id => id !== cb.dataset.qaid);
      await _saveQAConfig(ids); _renderConfig(); _renderQuickActions();
    });
  });

  // Custom QA delete
  E('dashQaConfigWidgets').querySelectorAll('.cqa-del-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      _saveCustomQA(_getCustomQA().filter(c => c.id !== btn.dataset.cqaid));
      let ids = _getEnabledQA().filter(id => id !== btn.dataset.cqaid);
      await _saveQAConfig(ids); _renderConfig(); _renderQuickActions();
    });
  });

  // Custom QA form
  E('cfgCqaToggle').addEventListener('click', () => {
    const f = E('cfgCqaForm'); f.style.display = f.style.display === 'none' ? '' : 'none';
  });
  E('cfgCqaAddBtn').addEventListener('click', async () => {
    const icon  = E('cfgCqaIcon').value.trim()  || '🔗';
    const label = E('cfgCqaLabel').value.trim();
    const url   = E('cfgCqaUrl').value.trim();
    if (!label || !url) { msg('Töltsd ki a feliratot és az URL-t!', 'error'); return; }
    const id = 'cqa_' + Date.now();
    // _getEnabledQA() ELŐTT mentjük a custom QA-t, hogy ne duplikáljon
    const prevIds = _getEnabledQA();
    _saveCustomQA([..._getCustomQA(), { id, icon, label, url }]);
    await _saveQAConfig([...prevIds, id]);
    _renderConfig(); _renderQuickActions();
  });

  const sel = E('dashAutoRefreshSel');
  if (sel) sel.value = String(parseInt(localStorage.getItem('nj_autorefresh') || '0', 10));
}

/* ── Üdvözlő szekció ── */
function _renderGreeting() {
  const el = E('dashGreeting'); if (!el) return;
  const h   = new Date().getHours();
  const greet = h < 12 ? 'Jó reggelt' : h < 18 ? 'Jó napot' : 'Jó estét';
  const icon  = h < 12 ? '☀️' : h < 18 ? '🌤️' : '🌙';
  const name  = state.userData?.displayName || '';
  const firstName = name.includes(' ') ? name.split(' ').pop() : name;
  const dateStr = new Date().toLocaleDateString('hu-HU', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });
  el.innerHTML = `
    <div class="dash-greet-text">${greet}, <strong>${esc(firstName)}</strong>! ${icon}</div>
    <div class="dash-greet-date">${dateStr}</div>
    <div id="dashGreetCtx" class="dash-greet-ctx" style="display:none;"></div>`;
}

/* ── Gyors műveletek ── */
const ALL_QUICK_ACTIONS = [
  { id: 'adatbevitel', icon: '✏️', label: 'Adatrögzítés', tab: 'adatbevitel',  perm: () => isMainAdmin() || hasPerm('adatbevitel') },
  { id: 'napi-report', icon: '📊', label: 'Mai riport',    action: 'napi-report', perm: () => isMainAdmin() || hasPerm('sajatJelentes') || hasPerm('mindenJelentes') },
  { id: 'feladatok',   icon: '📌', label: 'Feladatok',     tab: 'feladatok',    perm: () => isMainAdmin() || hasPerm('feladatokKezeles') },
  { id: 'dolgozok',    icon: '👷', label: 'Dolgozók',      tab: 'dolgozok',     perm: () => isMainAdmin() || hasPerm('dolgozokMegtekintes') || hasPerm('dolgozokKezeles') },
  { id: 'naptar',      icon: '📅', label: 'Naptár',        tab: 'naptar',       perm: () => isMainAdmin() || hasPerm('naptar') },
  { id: 'elemzes',     icon: '📈', label: 'Elemzés',       tab: 'elemzes',      perm: () => isMainAdmin() || hasPerm('elemzes') },
  { id: 'keszlet',     icon: '📦', label: 'Készlet',       tab: 'keszlet',      perm: () => isMainAdmin() || hasPerm('keszletMegtekintes') || hasPerm('keszletKezeles') },
];

function _allQA() {
  return [
    ...ALL_QUICK_ACTIONS.filter(a => a.perm()),
    ..._getCustomQA().map(c => ({ ...c, isCustom: true, perm: () => true }))
  ];
}
function _availableQA() { return _allQA(); }

function _getEnabledQA() {
  const all = _allQA();
  const saved = state.userData?.dashboardQuickActions;
  if (Array.isArray(saved)) {
    const valid = saved.filter(id => all.some(a => a.id === id));
    // Új custom QA-k hozzáfűzése ha még nem szerepelnek
    _getCustomQA().forEach(c => { if (!valid.includes(c.id)) valid.push(c.id); });
    return valid;
  }
  return _allQA().slice(0, 4).map(a => a.id);
}

async function _saveQAConfig(ids) {
  if (state.userData) state.userData.dashboardQuickActions = ids;
  if (state.appUser) {
    try { await updateDoc(doc(db, 'users', state.appUser.uid), { dashboardQuickActions: ids }); } catch (e) { console.warn('QA save:', e.message); }
  }
}

function _renderQuickActions() {
  const el = E('dashQuickActions'); if (!el) return;
  const enabled = _getEnabledQA();
  // map: az enabled tömb SORRENDJÉT követi, nem az allQA eredeti sorrendjét
  const actions = enabled.map(id => _allQA().find(a => a.id === id)).filter(Boolean);
  if (!actions.length) { el.innerHTML = ''; return; }
  el.innerHTML = `<div class="dash-qa">${actions.map(a =>
    `<button class="dash-qa-btn" data-tab="${a.tab || ''}" data-action="${a.action || ''}" data-url="${esc(a.url || '')}">
      <span class="dash-qa-icon">${a.icon}</span>
      <span class="dash-qa-label">${esc(a.label)}</span>
    </button>`
  ).join('')}</div>`;
}

/* ── Init ── */
export async function initDashboard() {
  if (!_inited) {
    _inited = true;
    E('dashCfgBtn').addEventListener('click', () => {
      const panel = E('dashConfigPanel');
      const open  = panel.style.display !== 'none';
      panel.style.display = open ? 'none' : '';
      E('dashCfgBtn').classList.toggle('active', !open);
      if (E('dashCfgIcon'))  E('dashCfgIcon').textContent  = open ? '⚙️' : '✕';
      if (E('dashCfgLabel')) E('dashCfgLabel').textContent = open ? 'Beállítások' : 'Bezár';
    });
    _startAutoRefresh(parseInt(localStorage.getItem('nj_autorefresh') || '0', 10));

    // QA konfig betöltése state.userData-ból (ha van)
    // (a _getEnabledQA() már olvassa, nincs külön init szükséges)

    // Dolgozó-választó a Saját teljesítmény widgetben
    E('dashWidgets').addEventListener('change', async e => {
      const sel = e.target.closest('.sajat-dolgozo-sel'); if (!sel) return;
      const nev = sel.value;
      if (state.userData) state.userData.dashboardSajatDolgozo = nev;
      if (state.appUser) {
        try { await updateDoc(doc(db, 'users', state.appUser.uid), { dashboardSajatDolgozo: nev }); }
        catch (err) { console.warn('sajatDolgozo save:', err.message); }
      }
      await _loadWidgets();
    });

    // Widget klikk → pin / collapse / refresh / detail drawer
    E('dashWidgets').addEventListener('click', async e => {
      // Rögzítés
      const pinBtn = e.target.closest('.dash-pin-btn');
      if (pinBtn) {
        const wid  = pinBtn.dataset.wid;
        const wst  = _getWidgetSettings(wid);
        _saveWidgetSettings(wid, { pinned: !wst.pinned });
        await _loadWidgets();
        return;
      }
      // Egyéni frissítés
      const refreshBtn = e.target.closest('.dash-refresh-btn');
      if (refreshBtn) {
        const icon = refreshBtn.innerHTML;
        refreshBtn.innerHTML = '<span style="display:inline-block;animation:spin .6s linear infinite">↺</span>';
        refreshBtn.disabled = true;
        await _loadWidgets();
        return;
      }

      if (e.target.closest('.dash-move-btn')) return;
      if (e.target.tagName === 'SELECT' || e.target.closest('select')) return;
      if (e.target.closest('button')) return;
      const w = e.target.closest('.dash-widget-clickable');
      if (w?.dataset.wid) { await _openWidgetDrawer(w.dataset.wid); return; }
    });

    // Widget drawer + fullscreen bezárás
    E('widgetDrawerClose')?.addEventListener('click', closeWidgetDrawer);
    E('widgetDrawerOverlay')?.addEventListener('click', closeWidgetDrawer);

    // Nyíl gombok eseménykezelője (event delegation, egyszer regisztrálva)
    E('dashWidgets').addEventListener('click', async e => {
      const btn = e.target.closest('.dash-move-btn');
      if (!btn || btn.disabled) return;
      e.stopPropagation();
      const order = [..._getEnabled()];
      const idx   = order.indexOf(btn.dataset.wid);
      if (idx < 0) return;
      const ni = btn.dataset.dir === 'left' ? idx - 1 : idx + 1;
      if (ni < 0 || ni >= order.length) return;
      [order[idx], order[ni]] = [order[ni], order[idx]];
      await _saveConfig(order);
      await _loadWidgets();
    });
  }
  _renderGreeting();
  _renderQuickActions();
  _renderConfig();
  await _loadWidgets();
}

export { _loadWidgets as reloadDashboard };

/* ── Widget betöltés ── */
async function _loadWidgets() {
  const enabled = _getEnabled();
  const sizes   = _getWidgetSizes();
  const grid    = E('dashWidgets');

  if (!enabled.length) {
    grid.innerHTML = `<div class="empty-st"><div class="empty-ic">🔧</div><div class="empty-title">Nincs bekapcsolt widget</div><div class="empty-sub">Kattints a ⚙ Testreszab gombra.</div></div>`;
    return;
  }

  grid.innerHTML = Array(Math.min(enabled.length, 6)).fill(
    `<div class="sk-card"><div class="sk sk-title"></div><div class="sk sk-h w70"></div><div class="sk sk-h w50" style="margin-top:8px;"></div></div>`
  ).join('');

  const needsEntries = enabled.some(id => ['maiOssz','haviOssz','hetiTrend','hetiGrafikon','anyagRangsor','topDolg','utobbiBeir','sajatTelj'].includes(id));
  const needsEmps    = enabled.some(id => ['aktivDolg','szulNapok','jubileum'].includes(id)) && _empPerm();
  const needsTasks   = enabled.includes('nyitottF');

  const today      = tod();
  const weekStart  = monday(today);
  const prevWeekS  = addD(weekStart, -7);
  const monthStart = today.slice(0, 7) + '-01';
  const fetchFrom  = prevWeekS < monthStart ? prevWeekS : monthStart;

  const [entries, empSnap, tasksSnap] = await Promise.all([
    needsEntries ? fetchEntries({ datumFrom: fetchFrom, datumTo: today }).catch(() => [])   : Promise.resolve([]),
    needsEmps    ? getDocs(collection(db, 'employees')).catch(() => null)                   : Promise.resolve(null),
    needsTasks   ? getDocs(collection(db, 'tasks')).catch(() => null)                       : Promise.resolve(null),
  ]);

  const kgOf  = e => (e.sulyok || []).reduce((s, x) => s + x.suly, 0);
  const sumKg = arr => arr.reduce((s, e) => s + kgOf(e), 0);

  const ctx = {
    today, weekStart, prevWeekS, monthStart,
    todayEntries:    entries.filter(e => e.datum === today),
    thisWeekEntries: entries.filter(e => e.datum >= weekStart),
    prevWeekEntries: entries.filter(e => e.datum >= prevWeekS && e.datum < weekStart),
    monthEntries:    entries.filter(e => e.datum >= monthStart),
    myUid:        state.appUser?.uid,
    sajatDolgozo: state.userData?.dashboardSajatDolgozo || '',
    empSnap, tasksSnap, sumKg, kgOf,
  };

  grid.innerHTML = enabled.map(id => _buildWidget(id, ctx, sizes[id] === 'large')).join('');

  const now = new Date();
  const nextMins = parseInt(localStorage.getItem('nj_autorefresh') || '0', 10);
  const nextHint = nextMins > 0 ? ` · következő frissítés ${nextMins} perc múlva` : '';
  grid.insertAdjacentHTML('beforeend',
    `<div class="dash-last-update">Frissítve: ${now.toLocaleTimeString('hu-HU', { hour:'2-digit', minute:'2-digit' })}${nextHint}</div>`
  );

  // Vezérlő + nyíl gombok injektálása minden widgetbe
  const wNodes = [...grid.querySelectorAll('.dash-widget')];
  wNodes.forEach((w, i) => {
    w.style.setProperty('--wi-delay', `${i * 0.07}s`);
    const hdr = w.querySelector('.dash-w-hdr'); if (!hdr) return;
    const mv  = document.createElement('div');
    mv.className = 'dash-w-move';
    const wst_i  = _getWidgetSettings(enabled[i]);
    const isPinned = !!wst_i.pinned;
    mv.innerHTML = `
      <button class="dash-ctrl-btn dash-pin-btn${isPinned ? ' active' : ''}" data-wid="${enabled[i]}" title="${isPinned ? 'Rögzítve' : 'Rögzítés'}">📌</button>
      <button class="dash-ctrl-btn dash-refresh-btn" data-wid="${enabled[i]}" title="Frissítés">↺</button>
      <button class="dash-move-btn" data-wid="${enabled[i]}" data-dir="left"  ${i === 0              ? 'disabled' : ''} title="Balra">‹</button>
      <button class="dash-move-btn" data-wid="${enabled[i]}" data-dir="right" ${i >= wNodes.length-1 ? 'disabled' : ''} title="Jobbra">›</button>`;
    hdr.appendChild(mv);
  });
  // Kattintható widgetek jelölése + ctx mentése
  _lastCtx = ctx;
  wNodes.forEach((w, i) => {
    if (DRAWER_WIDGETS.includes(enabled[i])) {
      w.classList.add('dash-widget-clickable');
      w.dataset.wid = enabled[i];
    }
  });
  _renderSummaryBar(ctx);
  _updateGreetingCtx(ctx);
  _animateCounters(grid);
}

/* ── Összefoglaló sáv ── */
function _renderSummaryBar(ctx) {
  const bar = E('dashSummaryBar'); if (!bar) return;
  const canRead = isMainAdmin() || hasPerm('sajatJelentes') || hasPerm('mindenJelentes');
  if (!canRead) { bar.innerHTML = ''; return; }
  const { todayEntries, thisWeekEntries, monthEntries, sumKg } = ctx;
  const todayKg = sumKg(todayEntries);
  const weekKg  = sumKg(thisWeekEntries);
  const monthKg = sumKg(monthEntries);
  const pill = (lbl, kg) => `<div class="dash-sum-pill">
    <span class="dash-sum-lbl">${lbl}</span>
    <span class="dash-sum-val${kg <= 0 ? ' dash-sum-empty' : ''}">${kg > 0 ? (kg/1000).toFixed(2) + ' t' : '—'}</span>
  </div>`;
  bar.innerHTML = `<div class="dash-summary-bar">
    ${pill('Ma', todayKg)}<span class="dash-sum-sep">·</span>
    ${pill('Ezen a héten', weekKg)}<span class="dash-sum-sep">·</span>
    ${pill('Ebben a hónapban', monthKg)}
  </div>`;
}

/* ── Munkanapos üdvözlő kontextus ── */
function _updateGreetingCtx(ctx) {
  const el = E('dashGreetCtx'); if (!el) return;
  const canRead = isMainAdmin() || hasPerm('sajatJelentes') || hasPerm('mindenJelentes');
  if (!canRead) return;
  const { todayEntries, thisWeekEntries, prevWeekEntries, monthEntries, sumKg } = ctx;
  const dow = new Date().getDay(); // 0=V, 1=H, 2=K, 3=Sze, 4=Cs, 5=P, 6=Szo
  let txt = '';
  if (dow === 1) {
    const prevKg = sumKg(prevWeekEntries);
    txt = prevKg > 0 ? `Múlt héten összesen: ${(prevKg/1000).toFixed(2)} t` : 'Kellemes munkahetet! 💪';
  } else if (dow === 5) {
    const weekKg = sumKg(thisWeekEntries);
    txt = weekKg > 0 ? `Ez a hét eddig: ${(weekKg/1000).toFixed(2)} t` : 'Szép hétvégét!';
  } else if (dow === 6 || dow === 0) {
    const monthKg = sumKg(monthEntries);
    txt = monthKg > 0 ? `Havi termelés eddig: ${(monthKg/1000).toFixed(2)} t` : 'Jó pihenést!';
  } else {
    const todayKg = sumKg(todayEntries);
    txt = todayKg > 0 ? `Ma eddig: ${(todayKg/1000).toFixed(2)} t` : '';
  }
  el.textContent = txt;
  el.style.display = txt ? '' : 'none';
}

/* ── SVG vonaldiagram ── */
function _svgLineChart(perDay) {
  // Belső rendezés: legrégebbi bal, legújabb jobb
  const days = [...perDay].sort((a,b) => a.datum.localeCompare(b.datum));
  if (days.length < 2) return '';
  const vals = days.map(d => d.kg);
  const maxV = Math.max(...vals, 1);
  const W = 600, H = 130, PL = 42, PR = 10, PT = 12, PB = 22;
  const cW = W-PL-PR, cH = H-PT-PB, n = days.length;
  const xP = i => PL + (i / Math.max(n-1,1)) * cW;
  const yP = v => PT + cH - (v / maxV) * cH;

  const grid = [0, 0.25, 0.5, 0.75, 1].map(p => {
    const y = PT + cH - p*cH;
    return `<line x1="${PL}" y1="${y}" x2="${W-PR}" y2="${y}" stroke="var(--border)" stroke-width="0.5"/>
    <text x="${PL-4}" y="${y+3.5}" font-size="9" text-anchor="end" fill="var(--text3)">${((p*maxV)/1000).toFixed(1)}t</text>`;
  }).join('');

  const linePts = days.map((d,i) => `${xP(i)} ${yP(d.kg)}`).join(' L ');
  const areaPath = `M ${xP(0)} ${PT+cH} L ${linePts} L ${xP(n-1)} ${PT+cH} Z`;
  const dots = n <= 90 ? days.map((d,i) =>
    `<circle cx="${xP(i)}" cy="${yP(d.kg)}" r="2.5" fill="var(--accent)" opacity=".8"/>`
  ).join('') : '';
  const step = Math.max(1, Math.floor(n/5));
  const xLabels = days.filter((_,i) => i%step===0||i===n-1).map((d,_,arr) => {
    const i = days.indexOf(d);
    return `<text x="${xP(i)}" y="${H-4}" font-size="9" text-anchor="middle" fill="var(--text3)">${d.datum.slice(5)}</text>`;
  }).join('');

  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;margin:10px 0 4px;overflow:visible;">
    <defs><linearGradient id="lcg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="var(--accent)" stop-opacity=".18"/>
      <stop offset="100%" stop-color="var(--accent)" stop-opacity=".01"/>
    </linearGradient></defs>
    ${grid}
    <path d="${areaPath}" fill="url(#lcg)"/>
    <path d="M ${linePts}" fill="none" stroke="var(--accent)" stroke-width="1.8" stroke-linejoin="round"/>
    ${dots}${xLabels}
  </svg>`;
}

/* ── Számláló animáció ── */
function _countUp(el, to, decimals, duration = 650) {
  const start = performance.now();
  const step  = ts => {
    const p    = Math.min((ts - start) / duration, 1);
    const ease = 1 - Math.pow(1 - p, 3);
    el.textContent = (to * ease).toFixed(decimals);
    if (p < 1) requestAnimationFrame(step);
    else el.textContent = to.toFixed(decimals);
  };
  requestAnimationFrame(step);
}

function _animateCounters(grid) {
  grid.querySelectorAll('[data-count]').forEach(el => {
    const val = parseFloat(el.dataset.count);
    if (isNaN(val)) return;
    const dec = (String(val).split('.')[1] || '').length;
    _countUp(el, val, dec);
  });
}

/* ── Widget sorrend (nyíl gombok) ── */

/* ── Widget builder ── */
function _card(icon, title, value, sub = '', extra = '', large = false, anomaly = null, wColor = '') {
  const anomCls   = anomaly ? ` dash-widget-${anomaly}` : '';
  const colorStyle = wColor ? `border-left:3px solid ${wColor};` : '';
  const anomBadge = anomaly === 'warn'
    ? `<div class="dash-anomaly-badge dash-anomaly-warn">⚠️ Átlag alatt</div>`
    : anomaly === 'good'
    ? `<div class="dash-anomaly-badge dash-anomaly-good">🏆 Rekord nap</div>` : '';
  return `<div class="dash-widget${large ? ' dash-widget-large' : ''}${anomCls}" style="${colorStyle}">
    ${anomBadge}
    <div class="dash-w-hdr">
      <span class="dash-w-icon">${icon}</span>
      <span class="dash-w-title">${title}</span>
    </div>
    <div class="dash-w-body">
      <div class="dash-w-value">${value}</div>
      ${sub   ? `<div class="dash-w-sub">${sub}</div>` : ''}
      ${extra}
    </div>
  </div>`;
}

/* ── Mini sparkline (grafikonos widgetekhez) ── */
function _sparkline(perDay, h = 48) {
  if (!perDay || perDay.length < 2) return '';
  const vals = perDay.map(d => d.kg);
  const maxV = Math.max(...vals, 1);
  const W = 300, H = h, pad = 2;
  const n = perDay.length;
  const xP = i => (i / Math.max(n - 1, 1)) * W;
  const yP = v => H - pad - ((v / maxV) * (H - pad * 2));
  const linePts  = perDay.map((d, i) => `${xP(i).toFixed(1)} ${yP(d.kg).toFixed(1)}`).join(' L ');
  const areaPath = `M ${xP(0).toFixed(1)} ${H} L ${linePts} L ${xP(n-1).toFixed(1)} ${H} Z`;
  const uid = Math.random().toString(36).slice(2, 6);
  // Ahol 0 az érték: szaggatott jelzővonal
  const zeroLine = maxV > 0 ? `<line x1="0" y1="${H - pad}" x2="${W}" y2="${H - pad}"
    stroke="var(--border)" stroke-width="0.5" stroke-dasharray="3 2"/>` : '';
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"
    style="width:100%;height:${h}px;display:block;margin-top:10px;overflow:visible;">
    <defs><linearGradient id="spk_${uid}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="var(--accent)" stop-opacity=".28"/>
      <stop offset="100%" stop-color="var(--accent)" stop-opacity=".01"/>
    </linearGradient></defs>
    ${zeroLine}
    <path d="${areaPath}" fill="url(#spk_${uid})"/>
    <path d="M ${linePts}" fill="none" stroke="var(--accent)" stroke-width="1.8"
      stroke-linejoin="round" stroke-linecap="round"/>
  </svg>`;
}

function _trendBadge(diff) {
  if (diff === null || isNaN(diff)) return '';
  const sign = diff >= 0 ? '+' : '';
  const col  = diff > 2 ? 'var(--green)' : diff < -2 ? 'var(--red)' : 'var(--text3)';
  return `<span style="color:${col};font-size:13px;font-weight:600;">${sign}${diff.toFixed(1)}%</span>`;
}

function _buildWidget(id, ctx, large = false) {
  // Egyéni widgetbeállítások (cím, szín)
  const wst   = _getWidgetSettings(id);
  const wCol  = WIDGET_COLORS.find(c => c.id === (wst.color || ''))?.border || '';
  const _wcrd = (icon, defTitle, val, sub, extra, lg, anomaly) =>
    _card(icon, wst.customTitle || defTitle, val, sub, extra, lg, anomaly, wCol);

  // Egyéni szöveges widget
  const customW = _getCustomWidgets().find(w => w.id === id);
  if (customW) {
    return _card(customW.icon, wst.customTitle || esc(customW.title),
      `<span style="font-size:14px;font-weight:500;color:var(--text2);white-space:pre-wrap;">${esc(customW.content || '')}</span>`,
      '', '', large, null, wCol);
  }
  const { today, weekStart, prevWeekS, monthStart, todayEntries, thisWeekEntries, prevWeekEntries, monthEntries, empSnap, tasksSnap, sumKg, kgOf } = ctx;

  if (id === 'maiOssz') {
    const kg = sumKg(todayEntries);
    const activeDays = [...new Set(monthEntries.map(e => e.datum))];
    const monthAvg   = activeDays.length > 1 ? sumKg(monthEntries) / activeDays.length : null;
    const diff = monthAvg && monthAvg > 0 ? (kg - monthAvg) / monthAvg * 100 : null;
    const t = kg / 1000;
    // Kontextus-alapú értékszín
    const vcls = (diff !== null && kg > 0) ? (diff > 5 ? 'val-good' : diff < -5 ? 'val-warn' : 'val-ok') : 'val-ok';
    const val  = kg > 0
      ? `<span class="${vcls}" data-count="${t.toFixed(2)}">${t.toFixed(2)}</span> t ${_trendBadge(diff)}`
      : `<span style="color:var(--text3);font-size:20px;">—</span>`;
    // Anomália: legalább 3 aktív nap kell az átlaghoz, ±25% küszöb
    const anomaly = (diff !== null && kg > 0 && activeDays.length >= 3)
      ? (diff < -25 ? 'warn' : diff > 25 ? 'good' : null) : null;
    // Sparkline: utolsó 14 nap
    const spkMap14 = {};
    [...prevWeekEntries, ...thisWeekEntries].forEach(e => { spkMap14[e.datum] = (spkMap14[e.datum] || 0) + kgOf(e); });
    const spk14 = Array.from({length: 14}, (_, i) => ({ datum: addD(today, -(13 - i)), kg: spkMap14[addD(today, -(13 - i))] || 0 }));
    const spkExtra = _sparkline(spk14) + `<div style="display:flex;justify-content:space-between;font-size:9.5px;color:var(--text3);margin-top:2px;"><span>−14 nap</span><span>Ma</span></div>`;
    return _wcrd('⚖️', 'Mai össztermelés', val, kg > 0 ? `${kg.toFixed(0)} kg · ${todayEntries.length} bejegyzés` : 'Még nincs mai adat', spkExtra, large, anomaly);
  }

  if (id === 'haviOssz') {
    const kg   = sumKg(monthEntries);
    const days = [...new Set(monthEntries.map(e => e.datum))].length;
    const t    = kg / 1000;
    const val  = kg > 0 ? `<span data-count="${t.toFixed(2)}">${t.toFixed(2)}</span> t` : `<span style="color:var(--text3);font-size:20px;">—</span>`;
    // Sparkline: a hónap minden napja (jövőbeli = 0)
    const [yr, mo] = today.split('-').map(Number);
    const daysInMonth = new Date(yr, mo, 0).getDate();
    const spkMapM = {};
    monthEntries.forEach(e => { spkMapM[e.datum] = (spkMapM[e.datum] || 0) + kgOf(e); });
    const spkMonth = Array.from({length: daysInMonth}, (_, i) => {
      const d = `${today.slice(0, 7)}-${String(i + 1).padStart(2, '0')}`;
      return { datum: d, kg: spkMapM[d] || 0 };
    });
    const spkExtra = _sparkline(spkMonth) + `<div style="display:flex;justify-content:space-between;font-size:9.5px;color:var(--text3);margin-top:2px;"><span>1.</span><span>${daysInMonth}.</span></div>`;
    return _wcrd('📊', 'Havi összesítő', val, kg > 0 ? `${days} aktív nap · átlag ${((kg/1000)/days).toFixed(2)} t/nap` : 'Még nincs adat', spkExtra, large);
  }

  if (id === 'hetiTrend') {
    const thisKg = sumKg(thisWeekEntries);
    const prevKg = sumKg(prevWeekEntries);
    const diff   = prevKg > 0 ? (thisKg - prevKg) / prevKg * 100 : null;
    const vcls   = (diff !== null && thisKg > 0) ? (diff > 3 ? 'val-good' : diff < -3 ? 'val-warn' : 'val-ok') : 'val-ok';
    const val    = thisKg > 0
      ? `<span class="${vcls}">${(thisKg/1000).toFixed(2)}</span> t ${_trendBadge(diff)}`
      : `<span style="color:var(--text3);font-size:20px;">—</span>`;
    return _wcrd('📈', 'Heti trend', val, prevKg > 0 ? `Előző hét: ${(prevKg/1000).toFixed(2)} t` : 'Hét összesítő', '', large);
  }

  if (id === 'topDolg') {
    const wst  = _getWidgetSettings('topDolg');
    const pool = wst.period === 'heti' ? thisWeekEntries : monthEntries;
    const periodLabel = wst.period === 'heti' ? 'Ezen a héten' : 'Ebben a hónapban';
    const byW = {};
    pool.forEach(e => { byW[e.nev] = (byW[e.nev] || 0) + kgOf(e); });
    const rank = Object.entries(byW).sort((a, b) => b[1] - a[1]).slice(0, large ? 5 : 3);
    if (!rank.length) return _wcrd('🏅', 'Havi legjobb', `<span style="color:var(--text3);font-size:20px;">—</span>`, 'Még nincs adat', '', large);
    const topLabel = `Top ${rank.length} · ${periodLabel}`;
    // Stilizált medál badge-ek
    const medalGrad = [
      'linear-gradient(135deg,#FFD700,#E6A000)',
      'linear-gradient(135deg,#C8C8C8,#909090)',
      'linear-gradient(135deg,#CD853F,#8B4513)',
    ];
    const medalBadge = (i) => i < 3
      ? `<span style="background:${medalGrad[i]};color:#fff;border-radius:50%;width:22px;height:22px;display:inline-flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;flex-shrink:0;box-shadow:0 2px 6px rgba(0,0,0,.25);">${i+1}</span>`
      : `<span style="color:var(--text3);width:22px;text-align:center;display:inline-block;flex-shrink:0;font-size:12px;">${i+1}.</span>`;
    const rows = rank.map(([nev, kg], i) => `
      <div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid var(--border);">
        ${medalBadge(i)}
        <span style="font-size:${i===0?'13.5':'12.5'}px;font-weight:${i===0?700:600};color:var(--text);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(nev)}</span>
        <span style="font-size:12px;color:var(--text2);white-space:nowrap;font-weight:${i===0?600:400};">${(kg/1000).toFixed(2)} t</span>
      </div>`).join('');
    return _wcrd('🏅', 'Havi legjobb', '', topLabel, `<div style="margin-top:6px;">${rows}</div>`, large);
  }

  if (id === 'sajatTelj') {
    // Dolgozó-választó: nev alapú szűrés (nem createdBy)
    const selected = ctx.sajatDolgozo || '';
    const workers  = [...new Set([
      ...(state.nevek || []),
      ...monthEntries.map(e => e.nev)
    ])].filter(Boolean).sort((a, b) => a.localeCompare(b, 'hu'));

    const workerSel = `<div style="margin-bottom:10px;">
      <select class="sajat-dolgozo-sel" style="font-size:12.5px;padding:5px 8px;border-radius:var(--rsm);border:1px solid var(--border2);background:var(--surf2);color:var(--text);width:100%;font-family:inherit;cursor:pointer;">
        <option value="">— Válassz dolgozót —</option>
        ${workers.map(w => `<option value="${esc(w)}"${w === selected ? ' selected' : ''}>${esc(w)}</option>`).join('')}
      </select>
    </div>`;

    if (!selected) {
      return _wcrd('👤', 'Saját teljesítmény',
        `<span style="color:var(--text3);font-size:14px;">Válassz dolgozót a megjelenítéshez</span>`,
        '', workerSel, large);
    }

    const myToday   = todayEntries.filter(e => e.nev === selected);
    const myWeek    = thisWeekEntries.filter(e => e.nev === selected);
    const myMonth   = monthEntries.filter(e => e.nev === selected);
    const todayKg   = sumKg(myToday);
    const weekKg    = sumKg(myWeek);
    const monthKg   = sumKg(myMonth);
    const monthDays = [...new Set(myMonth.map(e => e.datum))].length;
    const monthAvg  = monthDays > 0 ? monthKg / monthDays : 0;
    const diff      = monthAvg > 0 && todayKg > 0 ? (todayKg - monthAvg) / monthAvg * 100 : null;
    const val  = todayKg > 0
      ? `<span data-count="${(todayKg/1000).toFixed(2)}">${(todayKg/1000).toFixed(2)}</span> t ${_trendBadge(diff)}`
      : `<span style="color:var(--text3);font-size:20px;">—</span>`;
    const sub  = todayKg > 0 ? `${todayKg.toFixed(0)} kg ma` : 'Még nincs mai adat';
    const extra = workerSel + `<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:4px;">
      <div style="background:var(--surf2);border-radius:var(--rsm);padding:7px 10px;">
        <div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:.4px;margin-bottom:2px;">Ezen a héten</div>
        <div style="font-size:15px;font-weight:700;color:var(--text);">${weekKg > 0 ? (weekKg/1000).toFixed(2) + ' t' : '—'}</div>
      </div>
      <div style="background:var(--surf2);border-radius:var(--rsm);padding:7px 10px;">
        <div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:.4px;margin-bottom:2px;">Havi átlag/nap</div>
        <div style="font-size:15px;font-weight:700;color:var(--text);">${monthAvg > 0 ? (monthAvg/1000).toFixed(2) + ' t' : '—'}</div>
      </div>
    </div>`;
    // Sparkline: dolgozó utolsó 14 napja
    const spkMapS = {};
    [...prevWeekEntries, ...thisWeekEntries].filter(e => e.nev === selected)
      .forEach(e => { spkMapS[e.datum] = (spkMapS[e.datum] || 0) + kgOf(e); });
    const spk14S = Array.from({length: 14}, (_, i) => ({ datum: addD(today, -(13 - i)), kg: spkMapS[addD(today, -(13 - i))] || 0 }));
    const spkS = _sparkline(spk14S) + `<div style="display:flex;justify-content:space-between;font-size:9.5px;color:var(--text3);margin-top:2px;"><span>−14 nap</span><span>Ma</span></div>`;
    return _wcrd('👤', 'Saját teljesítmény', val, sub, extra + spkS, large);
  }

  if (id === 'nyitottF') {
    const allTasks = tasksSnap?.docs || [];
    const open     = allTasks.filter(d => d.data().statusz === 'nyitott').length;
    const expired  = allTasks.filter(d => { const t = d.data(); return t.statusz === 'nyitott' && t.datum && t.datum < today; }).length;
    const col = open === 0 ? 'var(--green)' : expired > 0 ? 'var(--red)' : 'var(--text)';
    return _wcrd('📌', 'Nyitott feladatok', `<span style="color:${col};" data-count="${open}">${open}</span>`, expired > 0 ? `⚠️ ${expired} lejárt határidő` : open === 0 ? '✓ Minden kész' : 'Nincs lejárt feladat', '', large);
  }

  if (id === 'aktivDolg') {
    if (!empSnap) return _wcrd('👷', 'Aktív dolgozók', '—', 'Nincs jogosultság', '', large);
    const aktiv = empSnap.docs.filter(d => d.data().statusz === 'aktiv').length;
    const ossz  = empSnap.docs.length;
    return _wcrd('👷', 'Aktív dolgozók', `<span data-count="${aktiv}">${aktiv}</span>`, `${ossz} dolgozó összesen`, '', large);
  }

  if (id === 'utobbiBeir') {
    const last = [...monthEntries]
      .sort((a, b) => b.datum.localeCompare(a.datum) || ((b.createdAt?.seconds||0)-(a.createdAt?.seconds||0)))
      .slice(0, 5);
    if (!last.length) return _wcrd('📋', 'Utóbbi bejegyzések', `<span style="color:var(--text3);font-size:20px;">—</span>`, 'Még nincs adat', '', large);
    const rows = last.map(e => {
      const kg = kgOf(e);
      return `<div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text2);padding:4px 0;border-bottom:1px solid var(--border);">
        <span style="font-weight:600;">${esc(e.nev)}</span>
        <span style="color:var(--text3);">${esc(e.datum)} · <span style="color:var(--text);font-weight:600;">${(kg/1000).toFixed(2)} t</span></span>
      </div>`;
    }).join('');
    return _wcrd('📋', 'Utóbbi bejegyzések', '', '', `<div style="margin-top:4px;">${rows}</div>`, large);
  }

  /* ── Közelgő születésnapok ── */
  if (id === 'szulNapok') {
    if (!empSnap) return _wcrd('🎂', 'Közelgő születésnapok', '—', 'Nincs jogosultság', '', large);
    const todayD = new Date(today + 'T12:00:00');
    const [ty]   = today.split('-').map(Number);

    const upcoming = empSnap.docs
      .map(d => d.data())
      .filter(e => e.szulDatum && (e.statusz || 'aktiv') !== 'inaktiv')
      .map(e => {
        const [, bm, bd] = e.szulDatum.split('-').map(Number);
        let next = new Date(`${ty}-${String(bm).padStart(2,'0')}-${String(bd).padStart(2,'0')}T12:00:00`);
        if (next < todayD) next = new Date(`${ty+1}-${String(bm).padStart(2,'0')}-${String(bd).padStart(2,'0')}T12:00:00`);
        const days = Math.round((next - todayD) / 86400000);
        return { nev: e.nev, bm, bd, days };
      })
      .filter(e => e.days <= 30)
      .sort((a, b) => a.days - b.days);

    if (!upcoming.length)
      return _wcrd('🎂', 'Közelgő születésnapok', `<span style="color:var(--green);">✓</span>`, 'Nincs közelgő (30 napon belül)', '', large);

    const rows = upcoming.slice(0, large ? 5 : 3).map(e => {
      const isToday = e.days === 0;
      const col = isToday ? 'var(--green)' : e.days <= 7 ? 'var(--amber)' : 'var(--text3)';
      const lbl = isToday ? '🎉 Ma!' : `${e.days} nap`;
      return `<div style="display:flex;align-items:center;gap:8px;padding:4px 0;border-bottom:1px solid var(--border);">
        <span style="font-size:13px;font-weight:600;color:var(--text);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(e.nev)}</span>
        <span style="font-size:11px;color:var(--text3);">${e.bm}. ${e.bd}.</span>
        <span style="font-size:11px;color:${col};font-weight:600;white-space:nowrap;">${lbl}</span>
      </div>`;
    }).join('');
    return _wcrd('🎂', 'Közelgő születésnapok', `<span data-count="${upcoming.length}">${upcoming.length}</span>`, `${upcoming.length} fő (30 napon belül)`, `<div style="margin-top:8px;">${rows}</div>`, large);
  }

  /* ── Belépési jubileumok ── */
  if (id === 'jubileum') {
    if (!empSnap) return _wcrd('🎖️', 'Belépési jubileumok', '—', 'Nincs jogosultság', '', large);
    const todayD = new Date(today + 'T12:00:00');
    const [ty]   = today.split('-').map(Number);
    const jubileumok = empSnap.docs
      .map(d => d.data())
      .filter(e => e.belepet && (e.statusz || 'aktiv') !== 'inaktiv')
      .map(e => {
        const [by, bm, bd] = e.belepet.split('-').map(Number);
        let next = new Date(`${ty}-${String(bm).padStart(2,'0')}-${String(bd).padStart(2,'0')}T12:00:00`);
        let years = ty - by;
        if (next < todayD) { years++; next = new Date(`${ty+1}-${String(bm).padStart(2,'0')}-${String(bd).padStart(2,'0')}T12:00:00`); }
        const days = Math.round((next - todayD) / 86400000);
        return { nev: e.nev, years, bm, bd, days };
      })
      .filter(e => e.days <= 30 && e.years >= 1)
      .sort((a, b) => a.days - b.days);

    if (!jubileumok.length)
      return _wcrd('🎖️', 'Belépési jubileumok', `<span style="color:var(--green);">✓</span>`, 'Nincs közelgő (30 napon belül)', '', large);

    const rows = jubileumok.slice(0, large ? 5 : 3).map(e => {
      const isToday = e.days === 0;
      const col = isToday ? 'var(--green)' : e.days <= 7 ? 'var(--amber)' : 'var(--text3)';
      const lbl = isToday ? '🎉 Ma!' : `${e.days} nap`;
      return `<div style="display:flex;align-items:center;gap:8px;padding:4px 0;border-bottom:1px solid var(--border);">
        <span style="font-size:13px;font-weight:600;color:var(--text);flex:1;">${esc(e.nev)}</span>
        <span style="font-size:11px;color:var(--text3);">${e.years} év · ${e.bm}. ${e.bd}.</span>
        <span style="font-size:11px;color:${col};font-weight:600;white-space:nowrap;">${lbl}</span>
      </div>`;
    }).join('');
    return _wcrd('🎖️', 'Belépési jubileumok', `<span data-count="${jubileumok.length}">${jubileumok.length}</span>`, `${jubileumok.length} fő (30 napon belül)`, `<div style="margin-top:8px;">${rows}</div>`, large);
  }

  /* ── Anyag rangsor ── */
  if (id === 'anyagRangsor') {
    const wst  = _getWidgetSettings('anyagRangsor');
    const topN = parseInt(wst.topN || '5', 10);
    const byMat = {};
    monthEntries.forEach(e => {
      const mat = (e.anyag || '').trim();
      if (mat) byMat[mat] = (byMat[mat] || 0) + kgOf(e);
    });
    const rank = Object.entries(byMat).sort((a, b) => b[1] - a[1]).slice(0, large ? topN + 2 : topN);
    if (!rank.length) return _wcrd('📦', 'Anyag rangsor', `<span style="color:var(--text3);font-size:20px;">—</span>`, 'Még nincs adat', '', large);
    const maxKg = rank[0][1];
    const rows  = rank.map(([mat, kg], i) => {
      const barW = Math.round(kg / maxKg * 70);
      return `<div style="display:flex;align-items:center;gap:7px;padding:4px 0;border-bottom:1px solid var(--border);">
        <span style="font-size:11px;color:var(--text3);width:14px;flex-shrink:0;">${i+1}.</span>
        <span style="font-size:12px;font-weight:600;color:var(--text);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${esc(mat)}">${esc(mat)}</span>
        <div style="display:flex;align-items:center;gap:5px;flex-shrink:0;">
          <div style="height:5px;width:${barW}px;background:var(--accent);border-radius:3px;opacity:.6;"></div>
          <span style="font-size:11px;color:var(--text2);white-space:nowrap;">${(kg/1000).toFixed(2)} t</span>
        </div>
      </div>`;
    }).join('');
    return _wcrd('📦', 'Anyag rangsor', '', `Havi top ${rank.length} anyag`, `<div style="margin-top:6px;">${rows}</div>`, large);
  }

  /* ── Heti mini-grafikon ── */
  if (id === 'hetiGrafikon') {
    const HU_DAYS = ['H','K','Sze','Cs','P','Szo','V'];
    const days    = Array.from({length:7}, (_, i) => addD(weekStart, i));
    const byDay   = {};
    thisWeekEntries.forEach(e => { byDay[e.datum] = (byDay[e.datum] || 0) + kgOf(e); });
    const vals    = days.map(d => byDay[d] || 0);
    const maxV    = Math.max(...vals, 1);
    const totalKg = vals.reduce((s, v) => s + v, 0);

    const BAR_H = 52, BAR_W = 28, GAP = 5;
    const svgW  = 7 * (BAR_W + GAP) - GAP;

    const bars = days.map((d, i) => {
      const v       = vals[i];
      const h       = v > 0 ? Math.max(4, Math.round(v / maxV * BAR_H)) : 0;
      const x       = i * (BAR_W + GAP);
      const isToday  = d === today;
      const isFuture = d > today;
      const barFill  = `style="fill:var(--accent);opacity:${isFuture ? '0.18' : isToday ? '1' : '0.52'}"`;
      const lblFill  = `style="fill:${isToday ? 'var(--accent)' : 'var(--text3)'};font-weight:${isToday ? '700' : '400'}"`;
      const valFill  = `style="fill:${isToday ? 'var(--accent)' : 'var(--text3)'}"`;
      return [
        h > 0 ? `<rect x="${x}" y="${BAR_H - h}" width="${BAR_W}" height="${h}" rx="3" ${barFill}/>` : '',
        `<text x="${x + BAR_W/2}" y="${BAR_H + 12}" text-anchor="middle" font-size="9.5" font-family="Source Sans 3,sans-serif" ${lblFill}>${HU_DAYS[i]}</text>`,
        v > 0 && !isFuture ? `<text x="${x + BAR_W/2}" y="${BAR_H - h - 3}" text-anchor="middle" font-size="8.5" font-family="Source Sans 3,sans-serif" ${valFill}>${(v/1000).toFixed(1)}t</text>` : ''
      ].join('');
    }).join('');

    const svg = `<svg viewBox="0 0 ${svgW} ${BAR_H + 16}" style="width:100%;margin-top:10px;overflow:visible;">${bars}</svg>`;
    const sub = totalKg > 0 ? `${(totalKg/1000).toFixed(2)} t ezen a héten` : 'Még nincs adat ezen a héten';
    return _wcrd('📉', 'Heti bontás', '', sub, svg, large);
  }

  return '';
}
