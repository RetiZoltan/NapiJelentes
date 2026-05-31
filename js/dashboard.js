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

let _inited = false;

function _empPerm() {
  return isMainAdmin() || hasPerm('dolgozokMegtekintes') || hasPerm('dolgozokKezeles');
}

function _canSeeWidget(id) {
  if (id === 'aktivDolg') return _empPerm();
  if (id === 'topDolg') return canSeeAllReports();
  return true;
}

function _availableWidgets() {
  return ALL_WIDGETS.filter(w => _canSeeWidget(w.id));
}

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

function _renderConfig() {
  const enabled = _getEnabled();
  E('dashConfigWidgets').innerHTML = _availableWidgets().map(w =>
    `<label class="dash-cfg-lbl">
       <input type="checkbox" data-wid="${w.id}"${enabled.includes(w.id) ? ' checked' : ''}>
       <span>${w.icon} ${w.label}</span>
     </label>`
  ).join('');
  E('dashConfigWidgets').querySelectorAll('input').forEach(cb => {
    cb.addEventListener('change', async () => {
      const ids = [...E('dashConfigWidgets').querySelectorAll('input:checked')].map(c => c.dataset.wid);
      await _saveConfig(ids);
      await _loadWidgets();
    });
  });
}

export async function initDashboard() {
  if (!_inited) {
    _inited = true;
    E('dashCfgBtn').addEventListener('click', () => {
      const panel = E('dashConfigPanel');
      const open  = panel.style.display !== 'none';
      panel.style.display = open ? 'none' : '';
      E('dashCfgBtn').textContent = open ? '⚙ Testreszab' : '✕ Bezár';
    });
  }
  _renderConfig();
  await _loadWidgets();
}

export { _loadWidgets as reloadDashboard };

async function _loadWidgets() {
  const enabled = _getEnabled();
  const grid    = E('dashWidgets');
  if (!enabled.length) {
    grid.innerHTML = `<div class="empty-st"><div class="empty-ic">🔧</div><div class="empty-title">Nincs bekapcsolt widget</div><div class="empty-sub">Kattints a ⚙ Testreszab gombra, és válaszd ki, mit szeretnél látni.</div></div>`;
    return;
  }

  // Skeleton
  grid.innerHTML = Array(Math.min(enabled.length, 6)).fill(
    `<div class="sk-card"><div class="sk sk-title"></div><div class="sk sk-h w70"></div><div class="sk sk-h w50" style="margin-top:8px;"></div></div>`
  ).join('');

  // Determine what data is needed
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

  grid.innerHTML = enabled.map(id => _buildWidget(id, ctx)).join('');

  const now = new Date();
  grid.insertAdjacentHTML('beforeend',
    `<div class="dash-last-update">Frissítve: ${now.toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit' })}</div>`
  );
}

function _card(icon, title, value, sub = '', extra = '') {
  return `<div class="dash-widget">
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

function _buildWidget(id, ctx) {
  const { today, weekStart, prevWeekS, monthStart, todayEntries, thisWeekEntries, prevWeekEntries, monthEntries, empSnap, tasksSnap, sumKg, kgOf } = ctx;

  if (id === 'maiOssz') {
    const kg = sumKg(todayEntries);
    const activeDays = [...new Set(monthEntries.map(e => e.datum))];
    const monthAvg   = activeDays.length > 1 ? sumKg(monthEntries) / activeDays.length : null;
    const diff = monthAvg && monthAvg > 0 ? (kg - monthAvg) / monthAvg * 100 : null;
    const val  = kg > 0
      ? `${(kg / 1000).toFixed(2)} t ${_trendBadge(diff)}`
      : `<span style="color:var(--text3);font-size:20px;">—</span>`;
    const sub = kg > 0
      ? `${kg.toFixed(0)} kg · ${todayEntries.length} bejegyzés`
      : 'Még nincs mai adat';
    return _card('⚖️', 'Mai össztermelés', val, sub);
  }

  if (id === 'haviOssz') {
    const kg   = sumKg(monthEntries);
    const days = [...new Set(monthEntries.map(e => e.datum))].length;
    const val  = kg > 0 ? `${(kg / 1000).toFixed(2)} t` : `<span style="color:var(--text3);font-size:20px;">—</span>`;
    const sub  = kg > 0 ? `${days} aktív nap · átlag ${((kg / 1000) / days).toFixed(2)} t/nap` : 'Még nincs adat';
    return _card('📊', 'Havi összesítő', val, sub);
  }

  if (id === 'hetiTrend') {
    const thisKg = sumKg(thisWeekEntries);
    const prevKg = sumKg(prevWeekEntries);
    const diff   = prevKg > 0 ? (thisKg - prevKg) / prevKg * 100 : null;
    const val    = thisKg > 0
      ? `${(thisKg / 1000).toFixed(2)} t ${_trendBadge(diff)}`
      : `<span style="color:var(--text3);font-size:20px;">—</span>`;
    const sub = prevKg > 0
      ? `Előző hét: ${(prevKg / 1000).toFixed(2)} t`
      : 'Hét összesítő';
    return _card('📈', 'Heti trend', val, sub);
  }

  if (id === 'topDolg') {
    const byW = {};
    monthEntries.forEach(e => { byW[e.nev] = (byW[e.nev] || 0) + kgOf(e); });
    const top = Object.entries(byW).sort((a, b) => b[1] - a[1])[0];
    const val = top
      ? `<span style="font-size:18px;font-family:'Source Sans 3',sans-serif;">${esc(top[0])}</span>`
      : `<span style="color:var(--text3);font-size:20px;">—</span>`;
    const sub = top ? `${(top[1] / 1000).toFixed(2)} t ebben a hónapban` : 'Még nincs adat';
    return _card('🏅', 'Havi legjobb', val, sub);
  }

  if (id === 'nyitottF') {
    const allTasks   = tasksSnap?.docs || [];
    const open       = allTasks.filter(d => d.data().statusz === 'nyitott').length;
    const expired    = allTasks.filter(d => {
      const t = d.data();
      return t.statusz === 'nyitott' && t.datum && t.datum < today;
    }).length;
    const col = open === 0 ? 'var(--green)' : expired > 0 ? 'var(--red)' : 'var(--text)';
    const sub = expired > 0
      ? `⚠️ ${expired} lejárt határidő`
      : open === 0 ? '✓ Minden feladat kész' : 'Nincs lejárt feladat';
    return _card('📌', 'Nyitott feladatok', `<span style="color:${col};">${open}</span>`, sub);
  }

  if (id === 'aktivDolg') {
    if (!empSnap) return _card('👷', 'Aktív dolgozók', '—', 'Nincs jogosultság');
    const aktiv = empSnap.docs.filter(d => d.data().statusz === 'aktiv').length;
    const ossz  = empSnap.docs.length;
    return _card('👷', 'Aktív dolgozók', String(aktiv), `${ossz} dolgozó összesen`);
  }

  if (id === 'utobbiBeir') {
    const last = [...monthEntries]
      .sort((a, b) => b.datum.localeCompare(a.datum) || ((b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)))
      .slice(0, 5);
    if (!last.length) return _card('📋', 'Utóbbi bejegyzések', `<span style="color:var(--text3);font-size:20px;">—</span>`, 'Még nincs adat');
    const rows = last.map(e => {
      const kg = kgOf(e);
      return `<div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text2);padding:4px 0;border-bottom:1px solid var(--border);">
        <span style="font-weight:600;">${esc(e.nev)}</span>
        <span style="color:var(--text3);">${esc(e.datum)} · <span style="color:var(--text);font-weight:600;">${(kg/1000).toFixed(2)} t</span></span>
      </div>`;
    }).join('');
    return _card('📋', 'Utóbbi bejegyzések', '', '', `<div style="margin-top:4px;">${rows}</div>`);
  }

  return '';
}
