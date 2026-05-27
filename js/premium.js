import { db, doc, getDoc, setDoc } from './firebase.js';
import { state } from './state.js';
import { E, esc, msg } from './utils.js';
import { fetchEntries } from './db.js';

let premiumConfig = {};  // { matNev: { napiAlap, arany, arPerKg } }
let lastResults   = null;
let lastLabel     = '';

/* ═══ Config helpers ═══ */

async function loadPremiumConfig() {
  try {
    const s = await getDoc(doc(db, 'config', 'premiumConfig'));
    premiumConfig = s.exists() ? (s.data().materials || {}) : {};
  } catch { premiumConfig = {}; }
}

/* ═══ Admin konfig subtab ═══ */

export async function initPremiumAdmin() {
  await loadPremiumConfig();
  renderAdminConfig();
}

function matSafeId(mat) { return mat.replace(/[^a-zA-Z0-9]/g, '_'); }

function renderAdminConfig() {
  const allMats = [...new Set([...state.anyagok, ...Object.keys(premiumConfig)])]
    .sort((a, b) => a.localeCompare(b, 'hu'));

  const div = E('premiumAdminDiv');
  const btn = E('premiumAdminSaveBtn');

  if (!allMats.length) {
    div.innerHTML = '<p style="color:var(--text3);font-size:13px;padding:6px 0;">Nincs anyag a listán. Előbb vedd fel őket az Admin → Listák fülön.</p>';
    btn.style.display = 'none';
    return;
  }

  let html = `<div class="pc-table">
    <div class="pc-row pc-head">
      <div>Anyag</div><div>Napi alap (kg)</div><div>Arány (%)</div><div>Ár (Ft/kg)</div>
    </div>`;

  allMats.forEach(mat => {
    const cfg = premiumConfig[mat] || {};
    const sid = matSafeId(mat);
    html += `<div class="pc-row">
      <div class="pc-mat">${esc(mat)}</div>
      <div><input type="number" class="pc-input" id="pcAlap_${sid}"  value="${cfg.napiAlap ?? ''}" placeholder="—" min="0" step="1"></div>
      <div><input type="number" class="pc-input" id="pcArany_${sid}" value="${cfg.arany   ?? ''}" placeholder="—" min="0" max="100" step="0.1"></div>
      <div><input type="number" class="pc-input" id="pcAr_${sid}"    value="${cfg.arPerKg ?? ''}" placeholder="—" min="0" step="1"></div>
    </div>`;
  });

  html += '</div>';
  div.innerHTML = html;
  btn.style.display = '';
}

export async function savePremiumAdminConfig() {
  const allMats = [...new Set([...state.anyagok, ...Object.keys(premiumConfig)])];
  const newCfg  = {};

  allMats.forEach(mat => {
    const sid  = matSafeId(mat);
    const aEl  = document.getElementById(`pcAlap_${sid}`);
    const arEl = document.getElementById(`pcArany_${sid}`);
    const pEl  = document.getElementById(`pcAr_${sid}`);
    if (!aEl) return;
    const napiAlap = parseFloat(aEl.value);
    const arany    = parseFloat(arEl.value);
    const arPerKg  = parseFloat(pEl.value);
    if (!isNaN(napiAlap) && napiAlap > 0 && !isNaN(arany) && !isNaN(arPerKg)) {
      newCfg[mat] = { napiAlap, arany, arPerKg };
    }
  });

  try {
    await setDoc(doc(db, 'config', 'premiumConfig'), { materials: newCfg });
    premiumConfig = newCfg;
    msg('Prémium konfiguráció mentve!');
  } catch (e) { msg('Mentési hiba: ' + e.message, 'error'); }
}

/* ═══ Prémium számítás tab ═══ */

let _tabInited = false;

export function initPremiumTab() {
  if (_tabInited) return;
  _tabInited = true;
  const now = new Date();
  E('premiumHonapInput').value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  E('premiumSzamolBtn').addEventListener('click',   calcAndRender);
  E('premiumNyomtatBtn').addEventListener('click',  premiumNyomtat);
}

async function calcAndRender() {
  const raw = E('premiumHonapInput').value;
  if (!raw) { msg('Válassz hónapot!', 'error'); return; }
  const [year, mon] = raw.split('-').map(Number);
  const reszlegF = E('premiumReszlegSzuro')?.value || '';
  const honNev = ['Január','Február','Március','Április','Május','Június','Július','Augusztus','Szeptember','Október','November','December'];
  lastLabel = `${year}. ${honNev[mon - 1]}${reszlegF ? ' · ' + reszlegF : ''}`;

  E('premiumResultDiv').innerHTML = '<div class="empty-st"><div class="spinner" style="margin:0 auto"></div></div>';
  E('premiumNyomtatBtn').disabled = true;

  await loadPremiumConfig();
  lastResults = await computePremium(year, mon, reszlegF);
  renderPremiumResults(lastResults, lastLabel);
}

async function computePremium(year, month, reszlegFilter = '') {
  const prefix  = `${year}-${String(month).padStart(2, '0')}`;
  const lastDay = new Date(year, month, 0).getDate();
  let entries = await fetchEntries({
    datumFrom: `${prefix}-01`,
    datumTo:   `${prefix}-${String(lastDay).padStart(2, '0')}`
  });
  if (reszlegFilter) entries = entries.filter(a => (a.reszleg || '') === reszlegFilter);

  // Group: worker → material → { days: Set, totalKg }
  const byWM = {};
  entries.forEach(a => {
    const nev = a.nev;
    const mat = (a.anyag || '').trim();
    if (!mat) return;
    const kg = (a.sulyok || []).reduce((s, x) => s + x.suly, 0);
    if (kg <= 0) return;
    if (!byWM[nev]) byWM[nev] = {};
    if (!byWM[nev][mat]) byWM[nev][mat] = { days: new Set(), totalKg: 0 };
    byWM[nev][mat].days.add(a.datum);
    byWM[nev][mat].totalKg += kg;
  });

  const results = [];
  Object.entries(byWM).forEach(([nev, mats]) => {
    let totalPremium = 0;
    const details = [];

    Object.entries(mats).forEach(([mat, data]) => {
      const cfg        = premiumConfig[mat];
      const activeDays = data.days.size;
      const totalKg    = data.totalKg;

      if (!cfg?.napiAlap || !cfg?.arPerKg) {
        details.push({ mat, activeDays, totalKg, threshold: 0, excess: 0, premium: 0, noConfig: true });
        return;
      }

      const threshold   = cfg.napiAlap * activeDays;
      const excess      = Math.max(0, totalKg - threshold);
      const premiumBase = excess * (cfg.arany / 100);
      const premium     = Math.round(premiumBase * cfg.arPerKg);

      details.push({ mat, activeDays, totalKg, threshold, excess, premiumBase, premium, cfg });
      totalPremium += premium;
    });

    details.sort((a, b) => b.premium - a.premium);
    results.push({ nev, totalPremium: Math.round(totalPremium), details });
  });

  return results.sort((a, b) => b.totalPremium - a.totalPremium);
}

function fmtFt(n) {
  return new Intl.NumberFormat('hu-HU', { style: 'currency', currency: 'HUF', maximumFractionDigits: 0 }).format(n);
}

function renderPremiumResults(results, label) {
  if (!results.length) {
    E('premiumResultDiv').innerHTML = '<div class="empty-st"><div class="empty-ic">📭</div>Nincs adat erre a hónapra</div>';
    E('premiumNyomtatBtn').disabled = true;
    return;
  }

  const grandTotal = results.reduce((s, r) => s + r.totalPremium, 0);

  let html = `<div class="r-head">${esc(label)} <span class="r-shift">· Prémium</span></div>
    <div class="prem-list">`;

  results.forEach((r, idx) => {
    html += `<div class="prem-item">
      <div class="prem-row" data-pidx="${idx}">
        <div class="prem-name">${esc(r.nev)}</div>
        <div class="prem-amt ${r.totalPremium > 0 ? 'prem-pos' : 'prem-zero'}">${fmtFt(r.totalPremium)}</div>
        <div class="prem-chev">▼</div>
      </div>
      <div class="prem-detail" id="pd_${idx}" style="display:none;">
        <table class="stbl">
          <thead><tr><th>Anyag</th><th>Aktív napok × alap</th><th>Termelt</th><th>Küszöb</th><th>Felett</th><th>Prémium</th></tr></thead>
          <tbody>`;

    r.details.forEach(d => {
      if (d.noConfig) {
        html += `<tr>
          <td style="font-weight:600;">${esc(d.mat)}</td>
          <td style="color:var(--text3);">${d.activeDays} nap</td>
          <td class="v-bold">${d.totalKg.toFixed(0)} kg</td>
          <td colspan="2" style="color:var(--text3);font-style:italic;">Nincs konfig</td>
          <td class="prem-zero">—</td></tr>`;
      } else {
        html += `<tr>
          <td style="font-weight:600;">${esc(d.mat)}</td>
          <td style="color:var(--text3);">${d.activeDays} × ${d.cfg.napiAlap} kg</td>
          <td class="v-bold">${d.totalKg.toFixed(0)} kg</td>
          <td style="color:var(--text3);">${d.threshold.toFixed(0)} kg</td>
          <td style="color:${d.excess > 0 ? 'var(--green)' : 'var(--text3)'};">${d.excess.toFixed(0)} kg</td>
          <td class="${d.premium > 0 ? 'prem-pos' : 'prem-zero'}" style="font-weight:700;">${fmtFt(d.premium)}</td></tr>`;
      }
    });

    html += `</tbody></table></div></div>`;
  });

  html += `</div>
    <div class="prem-grand">
      <span>Havi prémium összesen</span>
      <span class="prem-pos" style="font-size:15px;font-weight:700;">${fmtFt(grandTotal)}</span>
    </div>`;

  E('premiumResultDiv').innerHTML = html;
  E('premiumNyomtatBtn').disabled = false;

  E('premiumResultDiv').querySelectorAll('.prem-row').forEach(row => {
    row.addEventListener('click', () => {
      const detail = document.getElementById(`pd_${row.dataset.pidx}`);
      const open   = detail.style.display === '';
      detail.style.display = open ? 'none' : '';
      row.querySelector('.prem-chev').textContent = open ? '▼' : '▲';
    });
  });
}

/* ═══ Nyomtatás ═══ */

function premiumNyomtat() {
  if (!lastResults?.length) { msg('Nincs nyomtatható tartalom.', 'error'); return; }

  const now       = new Date();
  const nyomtatva = now.toLocaleDateString('hu-HU', { year: 'numeric', month: 'long', day: 'numeric' })
                  + ', ' + now.toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit' });
  const grandTotal = lastResults.reduce((s, r) => s + r.totalPremium, 0);

  // Summary table
  let body = `<div class="r-head">${esc(lastLabel)} · Prémium összesítő</div>
    <table class="stbl"><thead><tr><th>#</th><th>Dolgozó</th><th>Prémium</th></tr></thead><tbody>`;
  lastResults.forEach((r, i) => {
    body += `<tr>
      <td style="color:#64748B;width:28px;">${i + 1}.</td>
      <td style="font-weight:600;">${esc(r.nev)}</td>
      <td style="font-weight:700;color:${r.totalPremium > 0 ? '#15803D' : '#64748B'};">${fmtFt(r.totalPremium)}</td></tr>`;
  });
  body += `</tbody><tfoot><tr class="tot"><td colspan="2">Összesen</td><td style="font-weight:700;">${fmtFt(grandTotal)}</td></tr></tfoot></table>`;

  // Per-worker detail tables (only workers with premium)
  const withPrem = lastResults.filter(r => r.totalPremium > 0);
  if (withPrem.length) {
    body += '<div style="margin-top:22px;">';
    withPrem.forEach(r => {
      body += `<div style="break-inside:avoid;margin-bottom:16px;">
        <div style="font-size:13px;font-weight:700;padding:5px 0 4px;border-bottom:1px solid #CBD5E1;margin-bottom:6px;">${esc(r.nev)}</div>
        <table class="stbl"><thead><tr><th>Anyag</th><th>Aktív nap × alap</th><th>Termelt</th><th>Küszöb</th><th>Felett</th><th>Prémium</th></tr></thead><tbody>`;
      r.details.forEach(d => {
        if (d.noConfig) {
          body += `<tr><td>${esc(d.mat)}</td><td>${d.activeDays} nap</td><td>${d.totalKg.toFixed(0)} kg</td><td colspan="2" style="color:#64748B;font-style:italic;">Nincs konfig</td><td>—</td></tr>`;
        } else {
          body += `<tr><td>${esc(d.mat)}</td><td>${d.activeDays} × ${d.cfg.napiAlap} kg</td><td>${d.totalKg.toFixed(0)} kg</td><td>${d.threshold.toFixed(0)} kg</td><td>${d.excess.toFixed(0)} kg</td><td style="font-weight:700;">${fmtFt(d.premium)}</td></tr>`;
        }
      });
      body += `</tbody></table></div>`;
    });
    body += '</div>';
  }

  const pf = document.getElementById('print-frame');
  pf.innerHTML = '';
  const hdr = document.createElement('div');
  hdr.className = 'pf-hdr';
  hdr.innerHTML = `<span class="pf-brand">Napi Jelentés – Prémium összesítő</span><span class="pf-meta">Nyomtatva: ${nyomtatva}</span>`;
  pf.appendChild(hdr);
  const bodyEl = document.createElement('div');
  bodyEl.innerHTML = body;
  pf.appendChild(bodyEl);
  const ftr = document.createElement('div');
  ftr.className = 'pf-ftr';
  ftr.textContent = 'Plasticnapi termelési nyilvántartó';
  pf.appendChild(ftr);
  document.body.classList.add('is-printing');
  window.print();
}
