import { db, doc, updateDoc, collection, getDocs } from './firebase.js';
import { state, canSeeAllReports, isMainAdmin, hasPerm } from './state.js';
import { E, esc, tod, monday, addD, fmtKg } from './utils.js';
import { fetchEntries } from './db.js';

const ALL_WIDGETS = [
  { id: 'maiOssz',    label: 'Mai össztermelés',   icon: '⚖️', def: true  },
  { id: 'haviOssz',   label: 'Havi összesítő',     icon: '📊', def: true  },
  { id: 'hetiTrend',  label: 'Heti trend',         icon: '📈', def: true  },
  { id: 'topDolg',    label: 'Havi legjobb',       icon: '🏅', def: false },
  { id: 'nyitottF',   label: 'Nyitott feladatok',  icon: '📌', def: true  },
  { id: 'aktivDolg',  label: 'Aktív dolgozók',     icon: '👷', def: true  },
  { id: 'utobbiBeir', label: 'Utóbbi bejegyzések', icon: '📋', def: false },
];

let _inited            = false;
let _autoRefreshTimer  = null;

/* ── Jogosultságok ── */
function _empPerm()       { return isMainAdmin() || hasPerm('dolgozokMegtekintes') || hasPerm('dolgozokKezeles'); }
function _canSeeWidget(id){ if (id === 'aktivDolg') return _empPerm(); if (id === 'topDolg') return canSeeAllReports(); return true; }
function _availableWidgets() { return ALL_WIDGETS.filter(w => _canSeeWidget(w.id)); }

/* ── Widget beállítások ── */
function _getEnabled() {
  const saved = state.userData?.dashboardWidgets;
  if (Array.isArray(saved) && saved.length) return saved.filter(id => _canSeeWidget(id));
  return _availableWidgets().filter(w => w.def).map(w => w.id);
}
async function _saveConfig(ids) {
  if (state.userData) state.userData.dashboardWidgets = ids;
  if (state.appUser) {
    try { await updateDoc(doc(db, 'users', state.appUser.uid), { dashboardWidgets: ids }); } catch {}
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
export function setAutoRefresh(minutes) {
  localStorage.setItem('nj_autorefresh', String(minutes));
  _startAutoRefresh(minutes);
}

/* ── Konfig panel ── */
function _renderConfig() {
  const enabled = _getEnabled();
  const sizes   = _getWidgetSizes();
  E('dashConfigWidgets').innerHTML = _availableWidgets().map(w => {
    const isEnabled = enabled.includes(w.id);
    const isLarge   = sizes[w.id] === 'large';
    return `<label class="dash-cfg-lbl">
      <input type="checkbox" data-wid="${w.id}"${isEnabled ? ' checked' : ''}>
      <span>${w.icon} ${w.label}</span>
      ${isEnabled ? `<button class="dash-size-btn" type="button" data-wid="${w.id}" title="${isLarge ? 'Váltás kis méretre' : 'Váltás nagy méretre'}">${isLarge ? '▭ Nagy' : '▢ Kis'}</button>` : ''}
    </label>`;
  }).join('');

  E('dashConfigWidgets').querySelectorAll('input').forEach(cb => {
    cb.addEventListener('change', async () => {
      const ids = [...E('dashConfigWidgets').querySelectorAll('input:checked')].map(c => c.dataset.wid);
      await _saveConfig(ids);
      _renderConfig();
      await _loadWidgets();
    });
  });
  E('dashConfigWidgets').querySelectorAll('.dash-size-btn').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.preventDefault(); e.stopPropagation();
      const curr = _getWidgetSizes();
      const wid  = btn.dataset.wid;
      const next = { ...curr };
      if (curr[wid] === 'large') delete next[wid]; else next[wid] = 'large';
      await _saveWidgetSizes(next);
      _renderConfig();
      await _loadWidgets();
    });
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
    <div class="dash-greet-date">${dateStr}</div>`;
}

/* ── Gyors műveletek ── */
function _renderQuickActions() {
  const el = E('dashQuickActions'); if (!el) return;
  const actions = [];
  if (isMainAdmin() || hasPerm('adatbevitel'))
    actions.push({ icon: '✏️', label: 'Adatrögzítés', tab: 'adatbevitel' });
  if (isMainAdmin() || hasPerm('sajatJelentes') || hasPerm('mindenJelentes'))
    actions.push({ icon: '📊', label: 'Mai riport', action: 'napi-report' });
  if (isMainAdmin() || hasPerm('feladatokKezeles'))
    actions.push({ icon: '📌', label: 'Feladatok', tab: 'feladatok' });
  if (isMainAdmin() || hasPerm('dolgozokMegtekintes') || hasPerm('dolgozokKezeles'))
    actions.push({ icon: '👷', label: 'Dolgozók', tab: 'dolgozok' });

  if (!actions.length) { el.innerHTML = ''; return; }
  el.innerHTML = `<div class="dash-qa">${actions.map(a =>
    `<button class="dash-qa-btn" data-tab="${a.tab || ''}" data-action="${a.action || ''}">
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
      E('dashCfgBtn').textContent = open ? '⚙ Testreszab' : '✕ Bezár';
    });
    _startAutoRefresh(parseInt(localStorage.getItem('nj_autorefresh') || '0', 10));
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

  const needsEntries = enabled.some(id => ['maiOssz','haviOssz','hetiTrend','topDolg','utobbiBeir'].includes(id));
  const needsEmps    = enabled.includes('aktivDolg') && _empPerm();
  const needsTasks   = enabled.includes('nyitottF');

  const today      = tod();
  const weekStart  = monday(today);
  const prevWeekS  = addD(weekStart, -7);
  const monthStart = today.slice(0, 7) + '-01';
  const fetchFrom  = prevWeekS < monthStart ? prevWeekS : monthStart;

  const [entries, empSnap, tasksSnap] = await Promise.all([
    needsEntries ? fetchEntries({ datumFrom: fetchFrom, datumTo: today }) : Promise.resolve([]),
    needsEmps    ? getDocs(collection(db, 'employees'))                   : Promise.resolve(null),
    needsTasks   ? getDocs(collection(db, 'tasks'))                       : Promise.resolve(null),
  ]);

  const kgOf  = e => (e.sulyok || []).reduce((s, x) => s + x.suly, 0);
  const sumKg = arr => arr.reduce((s, e) => s + kgOf(e), 0);

  const ctx = {
    today, weekStart, prevWeekS, monthStart,
    todayEntries:    entries.filter(e => e.datum === today),
    thisWeekEntries: entries.filter(e => e.datum >= weekStart),
    prevWeekEntries: entries.filter(e => e.datum >= prevWeekS && e.datum < weekStart),
    monthEntries:    entries.filter(e => e.datum >= monthStart),
    empSnap, tasksSnap, sumKg, kgOf,
  };

  grid.innerHTML = enabled.map(id => _buildWidget(id, ctx, sizes[id] === 'large')).join('');

  const now = new Date();
  const nextMins = parseInt(localStorage.getItem('nj_autorefresh') || '0', 10);
  const nextHint = nextMins > 0 ? ` · következő frissítés ${nextMins} perc múlva` : '';
  grid.insertAdjacentHTML('beforeend',
    `<div class="dash-last-update">Frissítve: ${now.toLocaleTimeString('hu-HU', { hour:'2-digit', minute:'2-digit' })}${nextHint}</div>`
  );
}

/* ── Widget builder ── */
function _card(icon, title, value, sub = '', extra = '', large = false) {
  return `<div class="dash-widget${large ? ' dash-widget-large' : ''}">
    <div class="dash-w-hdr"><span class="dash-w-icon">${icon}</span><span class="dash-w-title">${title}</span></div>
    <div class="dash-w-value">${value}</div>
    ${sub   ? `<div class="dash-w-sub">${sub}</div>` : ''}
    ${extra}
  </div>`;
}

function _trendBadge(diff) {
  if (diff === null || isNaN(diff)) return '';
  const sign = diff >= 0 ? '+' : '';
  const col  = diff > 2 ? 'var(--green)' : diff < -2 ? 'var(--red)' : 'var(--text3)';
  return `<span style="color:${col};font-size:13px;font-weight:600;">${sign}${diff.toFixed(1)}%</span>`;
}

function _buildWidget(id, ctx, large = false) {
  const { today, weekStart, prevWeekS, monthStart, todayEntries, thisWeekEntries, prevWeekEntries, monthEntries, empSnap, tasksSnap, sumKg, kgOf } = ctx;

  if (id === 'maiOssz') {
    const kg = sumKg(todayEntries);
    const activeDays = [...new Set(monthEntries.map(e => e.datum))];
    const monthAvg   = activeDays.length > 1 ? sumKg(monthEntries) / activeDays.length : null;
    const diff = monthAvg && monthAvg > 0 ? (kg - monthAvg) / monthAvg * 100 : null;
    const val  = kg > 0 ? `${(kg/1000).toFixed(2)} t ${_trendBadge(diff)}` : `<span style="color:var(--text3);font-size:20px;">—</span>`;
    return _card('⚖️', 'Mai össztermelés', val, kg > 0 ? `${kg.toFixed(0)} kg · ${todayEntries.length} bejegyzés` : 'Még nincs mai adat', '', large);
  }

  if (id === 'haviOssz') {
    const kg   = sumKg(monthEntries);
    const days = [...new Set(monthEntries.map(e => e.datum))].length;
    const val  = kg > 0 ? `${(kg/1000).toFixed(2)} t` : `<span style="color:var(--text3);font-size:20px;">—</span>`;
    return _card('📊', 'Havi összesítő', val, kg > 0 ? `${days} aktív nap · átlag ${((kg/1000)/days).toFixed(2)} t/nap` : 'Még nincs adat', '', large);
  }

  if (id === 'hetiTrend') {
    const thisKg = sumKg(thisWeekEntries);
    const prevKg = sumKg(prevWeekEntries);
    const diff   = prevKg > 0 ? (thisKg - prevKg) / prevKg * 100 : null;
    const val    = thisKg > 0 ? `${(thisKg/1000).toFixed(2)} t ${_trendBadge(diff)}` : `<span style="color:var(--text3);font-size:20px;">—</span>`;
    return _card('📈', 'Heti trend', val, prevKg > 0 ? `Előző hét: ${(prevKg/1000).toFixed(2)} t` : 'Hét összesítő', '', large);
  }

  if (id === 'topDolg') {
    const byW = {};
    monthEntries.forEach(e => { byW[e.nev] = (byW[e.nev] || 0) + kgOf(e); });
    const top = Object.entries(byW).sort((a, b) => b[1] - a[1])[0];
    const val = top ? `<span style="font-size:18px;font-family:'Source Sans 3',sans-serif;">${esc(top[0])}</span>` : `<span style="color:var(--text3);font-size:20px;">—</span>`;
    return _card('🏅', 'Havi legjobb', val, top ? `${(top[1]/1000).toFixed(2)} t ebben a hónapban` : 'Még nincs adat', '', large);
  }

  if (id === 'nyitottF') {
    const allTasks = tasksSnap?.docs || [];
    const open     = allTasks.filter(d => d.data().statusz === 'nyitott').length;
    const expired  = allTasks.filter(d => { const t = d.data(); return t.statusz === 'nyitott' && t.datum && t.datum < today; }).length;
    const col = open === 0 ? 'var(--green)' : expired > 0 ? 'var(--red)' : 'var(--text)';
    return _card('📌', 'Nyitott feladatok', `<span style="color:${col};">${open}</span>`, expired > 0 ? `⚠️ ${expired} lejárt határidő` : open === 0 ? '✓ Minden kész' : 'Nincs lejárt feladat', '', large);
  }

  if (id === 'aktivDolg') {
    if (!empSnap) return _card('👷', 'Aktív dolgozók', '—', 'Nincs jogosultság', '', large);
    const aktiv = empSnap.docs.filter(d => d.data().statusz === 'aktiv').length;
    const ossz  = empSnap.docs.length;
    return _card('👷', 'Aktív dolgozók', String(aktiv), `${ossz} dolgozó összesen`, '', large);
  }

  if (id === 'utobbiBeir') {
    const last = [...monthEntries]
      .sort((a, b) => b.datum.localeCompare(a.datum) || ((b.createdAt?.seconds||0)-(a.createdAt?.seconds||0)))
      .slice(0, 5);
    if (!last.length) return _card('📋', 'Utóbbi bejegyzések', `<span style="color:var(--text3);font-size:20px;">—</span>`, 'Még nincs adat', '', large);
    const rows = last.map(e => {
      const kg = kgOf(e);
      return `<div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text2);padding:4px 0;border-bottom:1px solid var(--border);">
        <span style="font-weight:600;">${esc(e.nev)}</span>
        <span style="color:var(--text3);">${esc(e.datum)} · <span style="color:var(--text);font-weight:600;">${(kg/1000).toFixed(2)} t</span></span>
      </div>`;
    }).join('');
    return _card('📋', 'Utóbbi bejegyzések', '', '', `<div style="margin-top:4px;">${rows}</div>`, large);
  }

  return '';
}
