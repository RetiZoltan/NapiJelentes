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
function fmtKg(n) { return Math.round(n).toLocaleString('hu-HU') + ' kg'; }

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

/* ═══ Config kártya ═══ */

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
    div.innerHTML = '';
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
    await renderCelokReview(monthStr);
  } catch (e) { msg('Mentési hiba: ' + e.message, 'error'); }
}

/* ═══ Áttekintő szekció ═══ */

async function renderCelokReview(monthStr) {
  const div = E('celokReviewDiv');
  const mats = Object.keys(celokConfig.materials || {});

  if (!mats.length) {
    div.innerHTML = '<div class="empty-st"><div class="empty-ic">🎯</div>Ehhez a hónaphoz még nincs beállítva anyagcél.</div>';
    return;
  }

  div.innerHTML = '<div class="empty-st"><div class="empty-ic">⏳</div>Betöltés…</div>';

  const from = `${monthStr}-01`;
  const to   = `${monthStr}-${String(daysInMonth(monthStr)).padStart(2, '0')}`;
  const entries = await fetchEntries({ datumFrom: from, datumTo: to });

  const total_days = daysInMonth(monthStr);
  const elapsed     = elapsedDays(monthStr);

  const matData = {};
  entries.forEach(e => {
    const mat = (e.anyag || '').trim();
    if (!(mat in celokConfig.materials)) return;
    const kg = kgOf(e);
    if (kg <= 0) return;
    matData[mat] ??= { total: 0, days: {}, workers: {} };
    matData[mat].total += kg;
    matData[mat].days[e.datum] = (matData[mat].days[e.datum] || 0) + kg;
    const nev = e.nev || 'Ismeretlen';
    matData[mat].workers[nev] ??= {};
    matData[mat].workers[nev][e.datum] = (matData[mat].workers[nev][e.datum] || 0) + kg;
  });

  const rows = mats.sort((a, b) => a.localeCompare(b, 'hu')).map(mat => {
    const target = celokConfig.materials[mat];
    const data    = matData[mat] || { total: 0, days: {}, workers: {} };
    const dayVals = Object.values(data.days);
    const avg     = average(dayVals);
    const med     = median(dayVals);

    let statusHtml = '';
    let forecastHtml = '';
    if (elapsed > 0) {
      const forecast   = data.total / elapsed * total_days;
      const haladas    = target > 0 ? data.total / target : 0;
      const idoArany   = elapsed / total_days;
      const diff       = haladas - idoArany;
      const cls        = diff >= -0.05 ? 'green' : diff >= -0.15 ? 'amber' : 'red';
      const label      = diff >= -0.05 ? 'Jó ütemben' : diff >= -0.15 ? 'Kis lemaradás' : 'Lemaradás';
      statusHtml   = `<span class="cel-status ${cls}">${label}</span>`;
      forecastHtml = `<span>Előrejelzés: <b>${fmtKg(forecast)}</b></span>`;
    } else {
      statusHtml = '<span class="cel-status amber">Jövőbeli hónap</span>';
    }

    const workerRows = Object.entries(data.workers)
      .map(([nev, days]) => {
        const vals = Object.values(days);
        return { nev, total: vals.reduce((a, b) => a + b, 0), avg: average(vals), med: median(vals) };
      })
      .sort((a, b) => b.total - a.total)
      .map(w => `<div class="cel-worker-row"><span>${esc(w.nev)}</span><span>${fmtKg(w.total)} · átlag ${fmtKg(w.avg)} · medián ${fmtKg(w.med)}</span></div>`)
      .join('') || '<div class="cel-worker-row"><span style="color:var(--text3);">Nincs bejegyzés ebben a hónapban.</span></div>';

    return `<div class="cel-mat-row" data-mat="${esc(mat)}">
      <div class="cel-mat-hdr">
        <span class="cel-mat-name">${esc(mat)}</span>
        <div class="cel-mat-stats">
          <span>Cél: <b>${fmtKg(target)}</b></span>
          <span>Eddig: <b>${fmtKg(data.total)}</b></span>
          <span>Napi átlag: <b>${fmtKg(avg)}</b></span>
          <span>Napi medián: <b>${fmtKg(med)}</b></span>
          ${forecastHtml}
          ${statusHtml}
        </div>
      </div>
      <div class="cel-worker-detail">${workerRows}</div>
    </div>`;
  }).join('');

  div.innerHTML = rows;
}

/* ═══ Belépési pontok ═══ */

export async function initCelokTab() {
  const input = E('celokHonapInput');
  if (!input.value) input.value = tod().slice(0, 7);
  await celokHonapChange();
}

export async function celokHonapChange() {
  const monthStr = E('celokHonapInput').value;
  if (!monthStr) return;
  await loadCelokConfig(monthStr);
  renderCelokConfig();
  await renderCelokReview(monthStr);
}

export function celokReviewClick(e) {
  const hdr = e.target.closest('.cel-mat-hdr');
  if (!hdr) return;
  hdr.closest('.cel-mat-row').classList.toggle('open');
}
