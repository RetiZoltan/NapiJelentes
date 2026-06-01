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
  { id: 'topDolg',      label: 'Havi legjobb',              icon: '🏅', def: false },
  { id: 'nyitottF',     label: 'Nyitott feladatok',         icon: '📌', def: true  },
  { id: 'aktivDolg',    label: 'Aktív dolgozók',            icon: '👷', def: true  },
  { id: 'szulNapok',    label: 'Közelgő születésnapok',     icon: '🎂', def: false },
  { id: 'utobbiBeir',   label: 'Utóbbi bejegyzések',        icon: '📋', def: false },
];

let _inited            = false;
let _autoRefreshTimer  = null;

/* ── Jogosultságok ── */
function _empPerm()       { return isMainAdmin() || hasPerm('dolgozokMegtekintes') || hasPerm('dolgozokKezeles'); }
function _canSeeWidget(id) {
  const canReadEntries = isMainAdmin() || hasPerm('sajatJelentes') || hasPerm('mindenJelentes');
  if (['maiOssz','haviOssz','hetiTrend','hetiGrafikon','anyagRangsor','utobbiBeir'].includes(id)) return canReadEntries;
  if (id === 'topDolg')   return canSeeAllReports();
  if (id === 'aktivDolg') return _empPerm();
  if (id === 'szulNapok') return _empPerm();
  if (id === 'nyitottF')  return isMainAdmin() || hasPerm('feladatokKezeles');
  return true;
}
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

  // ── Gyors műveletek konfig szekció ──
  const qaContainer = E('dashQaConfigWidgets');
  if (qaContainer) {
    const enabledQA = _getEnabledQA();
    qaContainer.innerHTML = _availableQA().map(a => `
      <label class="dash-cfg-lbl">
        <input type="checkbox" data-qaid="${a.id}"${enabledQA.includes(a.id) ? ' checked' : ''}>
        <span>${a.icon} ${a.label}</span>
      </label>`).join('');
    qaContainer.querySelectorAll('input').forEach(cb => {
      cb.addEventListener('change', async () => {
        const ids = [...qaContainer.querySelectorAll('input:checked')].map(c => c.dataset.qaid);
        await _saveQAConfig(ids);
        _renderQuickActions();
      });
    });
  }

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
const ALL_QUICK_ACTIONS = [
  { id: 'adatbevitel', icon: '✏️', label: 'Adatrögzítés', tab: 'adatbevitel',  perm: () => isMainAdmin() || hasPerm('adatbevitel') },
  { id: 'napi-report', icon: '📊', label: 'Mai riport',    action: 'napi-report', perm: () => isMainAdmin() || hasPerm('sajatJelentes') || hasPerm('mindenJelentes') },
  { id: 'feladatok',   icon: '📌', label: 'Feladatok',     tab: 'feladatok',    perm: () => isMainAdmin() || hasPerm('feladatokKezeles') },
  { id: 'dolgozok',    icon: '👷', label: 'Dolgozók',      tab: 'dolgozok',     perm: () => isMainAdmin() || hasPerm('dolgozokMegtekintes') || hasPerm('dolgozokKezeles') },
  { id: 'naptar',      icon: '📅', label: 'Naptár',        tab: 'naptar',       perm: () => isMainAdmin() || hasPerm('naptar') },
  { id: 'elemzes',     icon: '📈', label: 'Elemzés',       tab: 'elemzes',      perm: () => isMainAdmin() || hasPerm('elemzes') },
  { id: 'keszlet',     icon: '📦', label: 'Készlet',       tab: 'keszlet',      perm: () => isMainAdmin() || hasPerm('keszletMegtekintes') || hasPerm('keszletKezeles') },
];

function _availableQA() { return ALL_QUICK_ACTIONS.filter(a => a.perm()); }

function _getEnabledQA() {
  const saved = state.userData?.dashboardQuickActions;
  if (Array.isArray(saved)) return saved.filter(id => _availableQA().some(a => a.id === id));
  // Alapértelmezett: első 4 elérhető akció
  return _availableQA().slice(0, 4).map(a => a.id);
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
  const actions = _availableQA().filter(a => enabled.includes(a.id));

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

    // QA konfig betöltése state.userData-ból (ha van)
    // (a _getEnabledQA() már olvassa, nincs külön init szükséges)

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

  const needsEntries = enabled.some(id => ['maiOssz','haviOssz','hetiTrend','hetiGrafikon','anyagRangsor','topDolg','utobbiBeir'].includes(id));
  const needsEmps    = enabled.some(id => ['aktivDolg','szulNapok'].includes(id)) && _empPerm();
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
    empSnap, tasksSnap, sumKg, kgOf,
  };

  grid.innerHTML = enabled.map(id => _buildWidget(id, ctx, sizes[id] === 'large')).join('');

  const now = new Date();
  const nextMins = parseInt(localStorage.getItem('nj_autorefresh') || '0', 10);
  const nextHint = nextMins > 0 ? ` · következő frissítés ${nextMins} perc múlva` : '';
  grid.insertAdjacentHTML('beforeend',
    `<div class="dash-last-update">Frissítve: ${now.toLocaleTimeString('hu-HU', { hour:'2-digit', minute:'2-digit' })}${nextHint}</div>`
  );

  // Nyíl gombok injektálása minden widgetbe
  const wNodes = [...grid.querySelectorAll('.dash-widget')];
  wNodes.forEach((w, i) => {
    const hdr = w.querySelector('.dash-w-hdr'); if (!hdr) return;
    const mv  = document.createElement('div');
    mv.className = 'dash-w-move';
    mv.innerHTML = `
      <button class="dash-move-btn" data-wid="${enabled[i]}" data-dir="left"  ${i === 0              ? 'disabled' : ''} title="Balra">‹</button>
      <button class="dash-move-btn" data-wid="${enabled[i]}" data-dir="right" ${i >= wNodes.length-1 ? 'disabled' : ''} title="Jobbra">›</button>`;
    hdr.appendChild(mv);
  });
  _animateCounters(grid);
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
function _card(icon, title, value, sub = '', extra = '', large = false) {
  return `<div class="dash-widget${large ? ' dash-widget-large' : ''}">
    <div class="dash-w-hdr">
      <span class="dash-w-icon">${icon}</span>
      <span class="dash-w-title">${title}</span>
    </div>
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
    const t = kg / 1000;
    const val  = kg > 0 ? `<span data-count="${t.toFixed(2)}">${t.toFixed(2)}</span> t ${_trendBadge(diff)}` : `<span style="color:var(--text3);font-size:20px;">—</span>`;
    return _card('⚖️', 'Mai össztermelés', val, kg > 0 ? `${kg.toFixed(0)} kg · ${todayEntries.length} bejegyzés` : 'Még nincs mai adat', '', large);
  }

  if (id === 'haviOssz') {
    const kg   = sumKg(monthEntries);
    const days = [...new Set(monthEntries.map(e => e.datum))].length;
    const t    = kg / 1000;
    const val  = kg > 0 ? `<span data-count="${t.toFixed(2)}">${t.toFixed(2)}</span> t` : `<span style="color:var(--text3);font-size:20px;">—</span>`;
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
    return _card('📌', 'Nyitott feladatok', `<span style="color:${col};" data-count="${open}">${open}</span>`, expired > 0 ? `⚠️ ${expired} lejárt határidő` : open === 0 ? '✓ Minden kész' : 'Nincs lejárt feladat', '', large);
  }

  if (id === 'aktivDolg') {
    if (!empSnap) return _card('👷', 'Aktív dolgozók', '—', 'Nincs jogosultság', '', large);
    const aktiv = empSnap.docs.filter(d => d.data().statusz === 'aktiv').length;
    const ossz  = empSnap.docs.length;
    return _card('👷', 'Aktív dolgozók', `<span data-count="${aktiv}">${aktiv}</span>`, `${ossz} dolgozó összesen`, '', large);
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

  /* ── Közelgő születésnapok ── */
  if (id === 'szulNapok') {
    if (!empSnap) return _card('🎂', 'Közelgő születésnapok', '—', 'Nincs jogosultság', '', large);
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
      return _card('🎂', 'Közelgő születésnapok', `<span style="color:var(--green);">✓</span>`, 'Nincs közelgő (30 napon belül)', '', large);

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
    return _card('🎂', 'Közelgő születésnapok', `<span data-count="${upcoming.length}">${upcoming.length}</span>`, `${upcoming.length} fő (30 napon belül)`, `<div style="margin-top:8px;">${rows}</div>`, large);
  }

  /* ── Anyag rangsor ── */
  if (id === 'anyagRangsor') {
    const byMat = {};
    monthEntries.forEach(e => {
      const mat = (e.anyag || '').trim();
      if (mat) byMat[mat] = (byMat[mat] || 0) + kgOf(e);
    });
    const rank = Object.entries(byMat).sort((a, b) => b[1] - a[1]).slice(0, large ? 6 : 4);
    if (!rank.length) return _card('📦', 'Anyag rangsor', `<span style="color:var(--text3);font-size:20px;">—</span>`, 'Még nincs adat', '', large);
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
    return _card('📦', 'Anyag rangsor', '', `Havi top ${rank.length} anyag`, `<div style="margin-top:6px;">${rows}</div>`, large);
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
    return _card('📉', 'Heti bontás', '', sub, svg, large);
  }

  return '';
}
