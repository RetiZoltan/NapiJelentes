import { db, doc, getDoc, setDoc, serverTimestamp } from './firebase.js';
import { state, isMainAdmin, hasPerm } from './state.js';
import { E, esc, msg, tod } from './utils.js';
import { fetchEntries } from './db.js';

let celokConfig = { materials: {} };

function matSafeId(mat) { return mat.replace(/[^a-zA-Z0-9]/g, '_'); }

function median(arr) {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
function average(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0; }
function kgOf(e) { return (e.sulyok || []).reduce((s, x) => s + x.suly, 0); }
function fmtUnit(n, unit) {
  return unit === 't'
    ? (n / 1000).toLocaleString('hu-HU', { maximumFractionDigits: 2 }) + ' t'
    : Math.round(n).toLocaleString('hu-HU') + ' kg';
}

function daysInMonth(monthStr) {
  const [y, m] = monthStr.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}
function elapsedDays(monthStr) {
  const total = daysInMonth(monthStr);
  const today = tod();
  const todayMonth = today.slice(0, 7);
  if (monthStr < todayMonth) return total;
  if (monthStr > todayMonth) return 0;
  return Number(today.slice(8, 10));
}

/* ═══ Beállítások (Átlagok / Medián nézet) ═══ */

const _SET_KEY = 'nj_celok_settings';
const _SET_DEFAULTS = {
  viewMode: 'mindket',   // mindket | osszesitve | dolgozonkent
  sortBy:   'nev',       // nev | cel | teljesites
  unit:     'kg',        // kg | t
  showForecast: true,
  showMedian:   true,
};
function _getSettings() {
  try { return { ..._SET_DEFAULTS, ...JSON.parse(localStorage.getItem(_SET_KEY) || '{}') }; }
  catch { return { ..._SET_DEFAULTS }; }
}
function _saveSettings(patch) {
  try { localStorage.setItem(_SET_KEY, JSON.stringify({ ..._getSettings(), ...patch })); } catch {}
}

function _settingsBlockHtml() {
  const s = _getSettings();
  const opt = (val, cur, label) => `<option value="${val}"${cur === val ? ' selected' : ''}>${label}</option>`;
  return `
    <div style="display:flex;flex-wrap:wrap;gap:14px;align-items:flex-end;">
      <div class="field">
        <label class="lbl">Nézet</label>
        <select id="celSetView">
          ${opt('mindket', s.viewMode, 'Összesített + dolgozónkénti')}${opt('osszesitve', s.viewMode, 'Csak összesített')}${opt('dolgozonkent', s.viewMode, 'Csak dolgozónkénti')}
        </select>
      </div>
      <div class="field">
        <label class="lbl">Rendezés</label>
        <select id="celSetSort">
          ${opt('nev', s.sortBy, 'Anyag neve (ABC)')}${opt('cel', s.sortBy, 'Cél nagysága')}${opt('teljesites', s.sortBy, 'Teljesítés %')}
        </select>
      </div>
      <div class="field">
        <label class="lbl">Mértékegység</label>
        <select id="celSetUnit">
          ${opt('kg', s.unit, 'Kilogramm')}${opt('t', s.unit, 'Tonna')}
        </select>
      </div>
      <div class="field" style="margin-bottom:9px;">
        <label class="rs-lbl"><input type="checkbox" id="celSetForecast"${s.showForecast ? ' checked' : ''}> Előrejelzés oszlop</label>
      </div>
      <div class="field" style="margin-bottom:9px;">
        <label class="rs-lbl"><input type="checkbox" id="celSetMedian"${s.showMedian ? ' checked' : ''}> Napi medián oszlop</label>
      </div>
    </div>`;
}

export function celokSetToggle() {
  const block = E('celokSetBlock');
  if (block) block.style.display = block.style.display === 'none' ? '' : 'none';
}

export function celokSetChange(e) {
  const id = e.target.id;
  const patch =
    id === 'celSetView'     ? { viewMode: e.target.value }       :
    id === 'celSetSort'     ? { sortBy: e.target.value }         :
    id === 'celSetUnit'     ? { unit: e.target.value }           :
    id === 'celSetForecast' ? { showForecast: e.target.checked } :
    id === 'celSetMedian'   ? { showMedian: e.target.checked }   : null;
  if (!patch) return;
  _saveSettings(patch);
  renderCelokReview(E('celokAtlagHonapInput').value);
  renderCelokCapacity();
}

/* ═══ Config kártya (Beállítás al-fül) ═══ */

async function loadCelokConfig(monthStr) {
  try {
    const s = await getDoc(doc(db, 'celok', monthStr));
    celokConfig = s.exists() ? { materials: s.data().materials || {} } : { materials: {} };
  } catch { celokConfig = { materials: {} }; }
}

function canEditCelok() { return isMainAdmin() || hasPerm('celokKezeles'); }

function renderCelokConfig() {
  const div = E('celokConfigDiv');
  const wrap = E('celokMentWrap');

  if (!canEditCelok()) {
    div.innerHTML = '<p style="color:var(--text3);font-size:13px;padding:6px 0;">Nincs jogosultságod a célok szerkesztéséhez.</p>';
    wrap.style.display = 'none';
    return;
  }

  const allMats = [...new Set([...state.anyagok, ...Object.keys(celokConfig.materials)])];
  if (!allMats.length) {
    div.innerHTML = '<p style="color:var(--text3);font-size:13px;padding:6px 0;">Nincs anyag a listán. Előbb vedd fel őket az Admin → Listák fülön.</p>';
    wrap.style.display = 'none';
    return;
  }

  const srt       = l => [...l].sort((a, b) => a.localeCompare(b, 'hu'));
  const csMap     = state.anyagCsoportMap || {};
  const csoportok = srt(state.anyagCsoportok || []);

  const matRow = mat => {
    const sid = matSafeId(mat);
    const val = celokConfig.materials[mat] ?? '';
    return `<div class="pc-row cel-row">
      <div class="pc-mat">${esc(mat)}</div>
      <div><input type="number" class="pc-input" id="celCel_${sid}" data-mat="${esc(mat)}" value="${val}" placeholder="—" min="0" step="1"></div>
    </div>`;
  };

  let html = `<div class="pc-table">
    <div class="pc-row cel-row pc-head"><div>Anyag</div><div>Havi cél (kg)</div></div>`;

  if (!csoportok.length) {
    srt(allMats).forEach(mat => { html += matRow(mat); });
  } else {
    const grouped = {}, ungrouped = [];
    srt(allMats).forEach(mat => {
      const cs = csMap[mat];
      cs && csoportok.includes(cs) ? (grouped[cs] ??= []).push(mat) : ungrouped.push(mat);
    });
    csoportok.forEach(cs => {
      const items = grouped[cs]; if (!items?.length) return;
      html += `<div class="pc-group-hdr">${esc(cs)}</div>`;
      items.forEach(mat => { html += matRow(mat); });
    });
    if (ungrouped.length) {
      html += `<div class="pc-group-hdr" style="color:var(--text3);">— Egyéb —</div>`;
      ungrouped.forEach(mat => { html += matRow(mat); });
    }
  }

  html += '</div>';
  div.innerHTML = html;
  wrap.style.display = '';
}

export async function saveCelokConfig() {
  const monthStr = E('celokHonapInput').value;
  if (!monthStr) return;
  const allMats = [...new Set([...state.anyagok, ...Object.keys(celokConfig.materials)])];
  const newCfg  = {};

  allMats.forEach(mat => {
    const el = document.getElementById(`celCel_${matSafeId(mat)}`);
    if (!el) return;
    const v = parseFloat(el.value);
    if (!isNaN(v) && v > 0) newCfg[mat] = v;
  });

  try {
    await setDoc(doc(db, 'celok', monthStr), {
      materials: newCfg, updatedAt: serverTimestamp(), updatedBy: state.appUser?.uid || null
    });
    celokConfig = { materials: newCfg };
    msg('Célok mentve!');
    try { const { logAction } = await import('./auditlog.js'); logAction('celok.configSave', { month: monthStr, count: Object.keys(newCfg).length }); } catch {}
    if (E('celokAtlagHonapInput')?.value === monthStr) await renderCelokReview(monthStr);
  } catch (e) { msg('Mentési hiba: ' + e.message, 'error'); }
}

/* ═══ Áttekintő szekció (Átlagok / Medián al-fül) ═══ */

async function renderCelokReview(monthStr) {
  const div = E('celokReviewDiv');
  if (!monthStr) return;

  div.innerHTML = '<div class="empty-st"><div class="empty-ic">⏳</div>Betöltés…</div>';

  let materials = {};
  try {
    const s = await getDoc(doc(db, 'celok', monthStr));
    materials = s.exists() ? (s.data().materials || {}) : {};
  } catch { materials = {}; }

  const settings = _getSettings();
  const from = `${monthStr}-01`;
  const to   = `${monthStr}-${String(daysInMonth(monthStr)).padStart(2, '0')}`;
  const entries = await fetchEntries({ datumFrom: from, datumTo: to });

  const total_days = daysInMonth(monthStr);
  const elapsed     = elapsedDays(monthStr);

  const matData = {};
  entries.forEach(e => {
    const mat = (e.anyag || '').trim();
    if (!mat) return;
    const kg = kgOf(e);
    if (kg <= 0) return;
    matData[mat] ??= { total: 0, days: {}, workers: {} };
    matData[mat].total += kg;
    matData[mat].days[e.datum] = (matData[mat].days[e.datum] || 0) + kg;
    const nev = e.nev || 'Ismeretlen';
    matData[mat].workers[nev] ??= {};
    matData[mat].workers[nev][e.datum] = (matData[mat].workers[nev][e.datum] || 0) + kg;
  });

  // A termelésből előforduló ÉS a beállított célú anyagok uniója —
  // így egy célhoz rendelt, de még nem gyártott anyag is megjelenik.
  const mats = [...new Set([...Object.keys(matData), ...Object.keys(materials)])];
  if (!mats.length) {
    div.innerHTML = '<div class="empty-st"><div class="empty-ic">🎯</div>Nincs termelési adat ehhez a hónaphoz.</div>';
    return;
  }

  const withStats = mats.map(mat => {
    const target  = materials[mat] || 0;
    const data    = matData[mat] || { total: 0, days: {}, workers: {} };
    const dayVals = Object.values(data.days);
    return { mat, target, data, avg: average(dayVals), med: median(dayVals) };
  });

  withStats.sort((a, b) => {
    if (settings.sortBy === 'cel')        return b.target - a.target;
    if (settings.sortBy === 'teljesites') {
      const bv = b.target > 0 ? b.data.total / b.target : -1;
      const av = a.target > 0 ? a.data.total / a.target : -1;
      return bv - av;
    }
    return a.mat.localeCompare(b.mat, 'hu');
  });

  const showCombined = settings.viewMode !== 'dolgozonkent';
  const showWorkers  = settings.viewMode !== 'osszesitve';
  const alwaysOpen   = settings.viewMode === 'dolgozonkent';

  const rows = withStats.map(({ mat, target, data, avg, med }) => {
    let statusHtml   = '';
    let forecastHtml = '';
    const forecast = elapsed > 0 ? data.total / elapsed * total_days : null;
    if (settings.showForecast && forecast !== null) {
      forecastHtml = `<span>Előrejelzés: <b>${fmtUnit(forecast, settings.unit)}</b></span>`;
    }

    if (target > 0) {
      if (elapsed > 0) {
        const haladas  = data.total / target;
        const idoArany = elapsed / total_days;
        const diff     = haladas - idoArany;
        const cls      = diff >= -0.05 ? 'green' : diff >= -0.15 ? 'amber' : 'red';
        const label    = diff >= -0.05 ? 'Jó ütemben' : diff >= -0.15 ? 'Kis lemaradás' : 'Lemaradás';
        statusHtml = `<span class="cel-status ${cls}">${label}</span>`;
      } else {
        statusHtml = '<span class="cel-status amber">Jövőbeli hónap</span>';
      }
    } else {
      statusHtml = '<span class="cel-status gray">Nincs cél beállítva</span>';
    }

    const combinedHtml = showCombined ? `
          <span>Napi átlag: <b>${fmtUnit(avg, settings.unit)}</b></span>
          ${settings.showMedian ? `<span>Napi medián: <b>${fmtUnit(med, settings.unit)}</b></span>` : ''}` : '';

    let workerHtml = '';
    if (showWorkers) {
      const workerRows = Object.entries(data.workers)
        .map(([nev, days]) => {
          const vals = Object.values(days);
          return { nev, total: vals.reduce((a, b) => a + b, 0), avg: average(vals), med: median(vals) };
        })
        .sort((a, b) => b.total - a.total)
        .map(w => `<div class="cel-worker-row"><span>${esc(w.nev)}</span><span>${fmtUnit(w.total, settings.unit)} · átlag ${fmtUnit(w.avg, settings.unit)}${settings.showMedian ? ` · medián ${fmtUnit(w.med, settings.unit)}` : ''}</span></div>`)
        .join('') || '<div class="cel-worker-row"><span style="color:var(--text3);">Nincs bejegyzés ebben a hónapban.</span></div>';
      workerHtml = `<div class="cel-worker-detail">${workerRows}</div>`;
    }

    const clickable = showWorkers && !alwaysOpen;

    return `<div class="cel-mat-row${alwaysOpen ? ' open' : ''}" data-mat="${esc(mat)}">
      <div class="cel-mat-hdr"${clickable ? '' : ' style="cursor:default;"'}>
        <div class="cel-mat-left">
          ${clickable ? '<span class="cel-chev">▸</span>' : ''}
          <span class="cel-mat-name">${esc(mat)}</span>
        </div>
        <div class="cel-mat-stats">
          ${target > 0 ? `<span>Cél: <b>${fmtUnit(target, settings.unit)}</b></span>` : ''}
          <span>Eddig: <b>${fmtUnit(data.total, settings.unit)}</b></span>
          ${combinedHtml}
          ${forecastHtml}
          ${statusHtml}
        </div>
      </div>
      ${workerHtml}
    </div>`;
  }).join('');

  div.innerHTML = rows;
}

/* ═══ Műszak-kapacitás (teljes előzmény alapján, Átlagok / Medián al-fül) ═══ */

let _capEntriesCache = null;

async function _getAllEntriesCached(force = false) {
  if (_capEntriesCache && !force) return _capEntriesCache;
  _capEntriesCache = await fetchEntries({});
  return _capEntriesCache;
}

// Műszak-példány = adott nap + délelőtt/délután — a csapat összes tagjának
// adott anyagból termelt kg-ja összeadva egy műszak-összeget ad.
function _computeCapacity(entries) {
  const capData = {};
  entries.forEach(e => {
    const mat = (e.anyag || '').trim();
    if (!mat) return;
    const kg = kgOf(e);
    if (kg <= 0) return;
    const shiftKey = `${e.datum}||${e.ido || ''}`;
    capData[mat] ??= { shifts: {}, workers: {} };
    capData[mat].shifts[shiftKey] = (capData[mat].shifts[shiftKey] || 0) + kg;
    const nev = e.nev || 'Ismeretlen';
    capData[mat].workers[nev] ??= {};
    capData[mat].workers[nev][shiftKey] = (capData[mat].workers[nev][shiftKey] || 0) + kg;
  });
  return capData;
}

async function renderCelokCapacity() {
  const div = E('celokCapDiv');
  if (!div) return;
  div.innerHTML = '<div class="empty-st"><div class="empty-ic">⏳</div>Betöltés…</div>';

  const entries  = await _getAllEntriesCached();
  const settings = _getSettings();
  const capData  = _computeCapacity(entries);
  const mats     = Object.keys(capData).sort((a, b) => a.localeCompare(b, 'hu'));

  if (!mats.length) {
    div.innerHTML = '<div class="empty-st"><div class="empty-ic">🏭</div>Nincs elég termelési adat a kapacitás becsléséhez.</div>';
    return;
  }

  const showCombined = settings.viewMode !== 'dolgozonkent';
  const showWorkers  = settings.viewMode !== 'osszesitve';
  const alwaysOpen   = settings.viewMode === 'dolgozonkent';

  const rows = mats.map(mat => {
    const data      = capData[mat];
    const shiftVals = Object.values(data.shifts);

    const combinedHtml = showCombined ? `
          <span>Átlag/műszak: <b>${fmtUnit(average(shiftVals), settings.unit)}</b></span>
          <span>Medián/műszak: <b>${fmtUnit(median(shiftVals), settings.unit)}</b></span>` : '';

    let workerHtml = '';
    if (showWorkers) {
      const workerRows = Object.entries(data.workers)
        .map(([nev, shifts]) => {
          const vals = Object.values(shifts);
          return { nev, avg: average(vals), med: median(vals), count: vals.length };
        })
        .sort((a, b) => b.avg - a.avg)
        .map(w => `<div class="cel-worker-row"><span>${esc(w.nev)}</span><span>átlag ${fmtUnit(w.avg, settings.unit)}/műszak · medián ${fmtUnit(w.med, settings.unit)}/műszak (${w.count} műszak)</span></div>`)
        .join('') || '<div class="cel-worker-row"><span style="color:var(--text3);">Nincs adat.</span></div>';
      workerHtml = `<div class="cel-worker-detail">${workerRows}</div>`;
    }

    const clickable = showWorkers && !alwaysOpen;

    return `<div class="cel-mat-row${alwaysOpen ? ' open' : ''}" data-mat="${esc(mat)}">
      <div class="cel-mat-hdr"${clickable ? '' : ' style="cursor:default;"'}>
        <div class="cel-mat-left">
          ${clickable ? '<span class="cel-chev">▸</span>' : ''}
          <span class="cel-mat-name">${esc(mat)}</span>
        </div>
        <div class="cel-mat-stats">
          ${combinedHtml}
          <span style="color:var(--text3);">${shiftVals.length} aktív műszak alapján</span>
        </div>
      </div>
      ${workerHtml}
    </div>`;
  }).join('');

  div.innerHTML = rows;
}

export async function celokCapRefresh() {
  await _getAllEntriesCached(true);
  await renderCelokCapacity();
}

/* ═══ Belépési pontok ═══ */

export async function initCelokTab() {
  const cfgInput = E('celokHonapInput');
  const revInput = E('celokAtlagHonapInput');
  const curMonth = tod().slice(0, 7);
  if (!cfgInput.value) cfgInput.value = curMonth;
  if (!revInput.value) revInput.value = curMonth;
  E('celokSetBlock').innerHTML = _settingsBlockHtml();
  await celokConfigHonapChange();
  await renderCelokReview(revInput.value);
  await renderCelokCapacity();
}

export async function celokConfigHonapChange() {
  const monthStr = E('celokHonapInput').value;
  if (!monthStr) return;
  await loadCelokConfig(monthStr);
  renderCelokConfig();
}

export async function celokAtlagHonapChange() {
  await renderCelokReview(E('celokAtlagHonapInput').value);
}

export function celokReviewClick(e) {
  const hdr = e.target.closest('.cel-mat-hdr');
  if (!hdr || hdr.style.cursor === 'default') return;
  hdr.closest('.cel-mat-row').classList.toggle('open');
}

export function switchCelokSubtab(name) {
  document.querySelectorAll('#celokSubtabs .stab-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.ctab === name)
  );
  document.querySelectorAll('#tab-celok .pstab-panel').forEach(p => p.classList.remove('active'));
  E('cstab-' + name)?.classList.add('active');
  if (name === 'atlagok') {
    renderCelokReview(E('celokAtlagHonapInput').value);
    renderCelokCapacity();
  }
}
