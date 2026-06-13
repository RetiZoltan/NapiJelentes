import { db, doc, getDoc, setDoc, addDoc, deleteDoc,
         collection, query, getDocs, orderBy, limit, serverTimestamp } from './firebase.js';
import { state } from './state.js';
import { E, esc, msg } from './utils.js';
import { fetchEntries } from './db.js';

let premiumConfig  = {};
let lastResults    = null;
let lastLabel      = '';
let _historyCache  = [];

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
      <div>Anyag</div><div>Mód</div><div>Napi alap (kg)</div><div>Arány (%)</div><div>Ár (Ft/kg)</div>
    </div>`;

  allMats.forEach(mat => {
    const cfg  = premiumConfig[mat] || {};
    const sid  = matSafeId(mat);
    const auto = cfg.mode === 'auto';
    html += `<div class="pc-row">
      <div class="pc-mat">${esc(mat)}</div>
      <div>
        <select class="pc-input pc-mode" id="pcMode_${sid}" data-sid="${sid}">
          <option value="manual" ${auto ? '' : 'selected'}>Kézi</option>
          <option value="auto" ${auto ? 'selected' : ''}>Félautomata</option>
        </select>
      </div>
      <div><input type="number" class="pc-input" id="pcAlap_${sid}"  value="${cfg.napiAlap ?? ''}" placeholder="—" min="0" step="1" ${auto ? 'disabled' : ''}></div>
      <div><input type="number" class="pc-input" id="pcArany_${sid}" value="${cfg.arany   ?? ''}" placeholder="—" min="0" max="100" step="0.1"></div>
      <div><input type="number" class="pc-input" id="pcAr_${sid}"    value="${cfg.arPerKg ?? ''}" placeholder="—" min="0" step="1"></div>
    </div>`;
  });

  html += '</div>';
  div.innerHTML = html;
  btn.style.display = '';

  div.querySelectorAll('.pc-mode').forEach(sel => {
    sel.addEventListener('change', () => {
      const sid  = sel.dataset.sid;
      const aEl  = document.getElementById(`pcAlap_${sid}`);
      if (aEl) aEl.disabled = sel.value === 'auto';
    });
  });
}

export async function savePremiumAdminConfig() {
  const allMats = [...new Set([...state.anyagok, ...Object.keys(premiumConfig)])];
  const newCfg  = {};

  allMats.forEach(mat => {
    const sid     = matSafeId(mat);
    const modeEl  = document.getElementById(`pcMode_${sid}`);
    const aEl     = document.getElementById(`pcAlap_${sid}`);
    const arEl    = document.getElementById(`pcArany_${sid}`);
    const pEl     = document.getElementById(`pcAr_${sid}`);
    if (!aEl) return;
    const arPerKg = parseFloat(pEl.value);

    if (modeEl?.value === 'auto') {
      const aranyVal = parseFloat(arEl.value);
      const arany    = !isNaN(aranyVal) ? aranyVal : 100;
      if (!isNaN(arPerKg) && arPerKg > 0) {
        newCfg[mat] = { mode: 'auto', arany, arPerKg };
      }
      return;
    }

    const napiAlap = parseFloat(aEl.value);
    const arany    = parseFloat(arEl.value);
    if (!isNaN(napiAlap) && napiAlap > 0 && !isNaN(arany) && !isNaN(arPerKg)) {
      newCfg[mat] = { mode: 'manual', napiAlap, arany, arPerKg };
    }
  });

  try {
    await setDoc(doc(db, 'config', 'premiumConfig'), { materials: newCfg });
    premiumConfig = newCfg;
    msg('Prémium konfiguráció mentve!');
    try { const { logAction } = await import('./auditlog.js'); logAction('premium.configSave', { count: Object.keys(newCfg).length }); } catch {}
  } catch (e) { msg('Mentési hiba: ' + e.message, 'error'); }
}

/* ═══ Prémium számítás tab ═══ */

let _tabInited = false;

export function initPremiumTab() {
  if (_tabInited) return;
  _tabInited = true;
  const now = new Date();
  E('premiumHonapInput').value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  E('premiumSzamolBtn').addEventListener('click',  calcAndRender);
  E('premiumNyomtatBtn').addEventListener('click', premiumNyomtat);
}

export function switchPremiumTab(name) {
  document.querySelectorAll('#premiumSubtabs .stab-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.ptab === name)
  );
  document.querySelectorAll('#tab-premium .pstab-panel').forEach(p => p.classList.remove('active'));
  E('pstab-' + name)?.classList.add('active');
  if (name === 'elozmeny') _loadAndRenderHistory();
}

export async function savePremiumHistory() {
  if (!lastResults?.length) { msg('Nincs menthető eredmény!', 'error'); return; }
  const raw = E('premiumHonapInput').value;
  const [ev, honap] = raw.split('-').map(Number);
  const reszleg     = E('premiumReszlegSzuro')?.value || '';
  const grandTotal  = lastResults.reduce((s, r) => s + r.totalPremium, 0);

  // Csak a szükséges adatokat tároljuk (cfg nélkül)
  const cleanResults = lastResults.map(r => ({
    nev: r.nev, totalPremium: r.totalPremium,
    details: r.details.map(d => ({
      mat: d.mat, activeDays: d.activeDays,
      premiumDays: d.premiumDays || 0,
      totalKg: d.totalKg, totalExcess: d.totalExcess || 0,
      premium: d.premium, noConfig: d.noConfig || false,
      napiAlap: d.cfg?.napiAlap || null, auto: d.auto || false
    }))
  }));

  try {
    await addDoc(collection(db, 'premiumHistory'), {
      ev, honap, reszleg, honapNev: lastLabel,
      results: cleanResults, grandTotal,
      savedBy:     state.appUser.uid,
      savedByName: state.userData?.displayName || state.appUser.email || 'Ismeretlen',
      savedAt:     serverTimestamp()
    });
    msg('Prémium előzmény elmentve!');
    if (E('pstab-elozmeny')?.classList.contains('active')) _loadAndRenderHistory();
  } catch (e) { msg('Mentési hiba: ' + e.message, 'error'); }
}

async function _loadAndRenderHistory() {
  const div = E('premiumHistoryDiv'); if (!div) return;
  div.innerHTML = '<div style="text-align:center;padding:16px;color:var(--text3);">Betöltés…</div>';
  try {
    const snap = await getDocs(query(
      collection(db, 'premiumHistory'), orderBy('savedAt', 'desc'), limit(36)
    ));
    if (snap.empty) {
      div.innerHTML = `<div class="empty-st"><div class="empty-ic">📋</div><div class="empty-title">Nincs mentett prémium</div><div class="empty-sub">Számíts prémiumot és kattints a 💾 Mentés gombra.</div></div>`;
      return;
    }
    _historyCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    div.innerHTML = _historyCache.map(h => {
      const saved    = h.savedAt?.toDate ? h.savedAt.toDate().toLocaleDateString('hu-HU', { year:'numeric', month:'long', day:'numeric' }) : '—';
      const reszlegB = h.reszleg ? `<span class="notice-meta-badge">📍 ${esc(h.reszleg)}</span>` : '';
      return `<div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--border);">
        <div style="flex:1;min-width:0;">
          <div style="font-weight:600;font-size:13.5px;color:var(--text);">${esc(h.honapNev || `${h.ev}/${h.honap}`)} ${reszlegB}</div>
          <div style="font-size:12px;color:var(--text3);margin-top:2px;">${esc(h.savedByName)} · ${saved} · ${h.results?.length || 0} dolgozó</div>
        </div>
        <div style="font-weight:700;font-size:13px;color:var(--green);white-space:nowrap;">${fmtFt(h.grandTotal || 0)}</div>
        <button class="btn btn-ghost btn-xs prem-hist-load" data-id="${h.id}">Betölt</button>
        <button class="btn btn-danger btn-xs prem-hist-del" data-id="${h.id}">✕</button>
      </div>`;
    }).join('');

    div.querySelectorAll('.prem-hist-load').forEach(btn => {
      btn.addEventListener('click', () => {
        const h = _historyCache.find(x => x.id === btn.dataset.id); if (!h) return;
        const results = (h.results || []).map(r => ({
          ...r,
          details: r.details.map(d => ({ ...d, cfg: d.napiAlap ? { napiAlap: d.napiAlap } : null }))
        }));
        lastResults = results;
        lastLabel   = h.honapNev || `${h.ev}/${h.honap}`;
        switchPremiumTab('szamitas');
        renderPremiumResults(results, lastLabel);
        E('premiumHonapInput').value = `${h.ev}-${String(h.honap).padStart(2,'0')}`;
        if (h.reszleg && E('premiumReszlegSzuro')) E('premiumReszlegSzuro').value = h.reszleg;
      });
    });

    div.querySelectorAll('.prem-hist-del').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Törlöd ezt a mentett prémiumot?')) return;
        try { await deleteDoc(doc(db, 'premiumHistory', btn.dataset.id)); msg('Törölve.'); _loadAndRenderHistory(); }
        catch (e) { msg('Hiba: ' + e.message, 'error'); }
      });
    });
  } catch (e) { msg('Betöltési hiba: ' + e.message, 'error'); }
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
  if (E('premiumMentBtn')) E('premiumMentBtn').disabled = true;

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

  // Group: worker → material → day → totalKg (napon belül összesítve)
  const byWMD = {};
  entries.forEach(a => {
    const nev = a.nev;
    const mat = (a.anyag || '').trim();
    if (!mat) return;
    const kg = (a.sulyok || []).reduce((s, x) => s + x.suly, 0);
    if (kg <= 0) return;
    if (!byWMD[nev]) byWMD[nev] = {};
    if (!byWMD[nev][mat]) byWMD[nev][mat] = {};
    byWMD[nev][mat][a.datum] = (byWMD[nev][mat][a.datum] || 0) + kg;
  });

  // Félautomata anyagokhoz: medián napi termelés az összes dolgozó adott napjai alapján
  const matDayValues = {};
  Object.values(byWMD).forEach(mats => {
    Object.entries(mats).forEach(([mat, dayMap]) => {
      (matDayValues[mat] ??= []).push(...Object.values(dayMap));
    });
  });
  const matMedian = {};
  Object.entries(matDayValues).forEach(([mat, vals]) => { matMedian[mat] = median(vals); });

  const results = [];
  Object.entries(byWMD).forEach(([nev, mats]) => {
    let totalPremium = 0;
    const details = [];

    Object.entries(mats).forEach(([mat, dayMap]) => {
      const cfg        = premiumConfig[mat];
      const activeDays = Object.keys(dayMap).length;
      const totalKg    = Object.values(dayMap).reduce((s, v) => s + v, 0);

      if (!cfg?.arPerKg) {
        details.push({ mat, activeDays, totalKg, premium: 0, noConfig: true });
        return;
      }

      const auto    = cfg.mode === 'auto';
      const napiAlap = auto ? matMedian[mat] : cfg.napiAlap;

      if (!auto && !napiAlap) {
        details.push({ mat, activeDays, totalKg, premium: 0, noConfig: true });
        return;
      }

      // Minden napot külön értékelünk: csak a napi alap (kézi) vagy medián (félautomata) feletti rész ad prémiumbázist
      let totalExcess = 0;
      let premiumDays = 0;
      Object.values(dayMap).forEach(dayKg => {
        const dayExcess = Math.max(0, dayKg - napiAlap);
        if (dayExcess > 0) { totalExcess += dayExcess; premiumDays++; }
      });

      const arany   = auto ? (cfg.arany ?? 100) : cfg.arany;
      const premium = Math.round(totalExcess * (arany / 100) * cfg.arPerKg);

      details.push({
        mat, activeDays, premiumDays, totalKg, totalExcess, premium, auto,
        cfg: { ...cfg, napiAlap }
      });
      totalPremium += premium;
    });

    details.sort((a, b) => b.premium - a.premium);
    results.push({ nev, totalPremium: Math.round(totalPremium), details });
  });

  return results.sort((a, b) => b.totalPremium - a.totalPremium);
}

function median(arr) {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
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
          <thead><tr><th>Anyag</th><th>Aktív nap</th><th>Napi alap</th><th>Termelt össz.</th><th>Prémium nap</th><th>Túltelj. össz.</th><th>Prémium</th></tr></thead>
          <tbody>`;

    r.details.forEach(d => {
      if (d.noConfig) {
        html += `<tr>
          <td style="font-weight:600;">${esc(d.mat)}</td>
          <td>${d.activeDays}</td>
          <td class="v-bold">${d.totalKg.toFixed(0)} kg</td>
          <td colspan="3" style="color:var(--text3);font-style:italic;">Nincs konfig</td>
          <td class="prem-zero">—</td></tr>`;
      } else {
        html += `<tr>
          <td style="font-weight:600;">${esc(d.mat)}</td>
          <td style="color:var(--text3);">${d.activeDays}</td>
          <td style="color:var(--text3);" title="${d.auto ? 'Medián (félautomata)' : ''}">${d.auto ? '≈' : ''}${d.cfg.napiAlap.toFixed(d.auto ? 1 : 0)} kg</td>
          <td class="v-bold">${d.totalKg.toFixed(0)} kg</td>
          <td style="color:${d.premiumDays > 0 ? 'var(--green)' : 'var(--text3)'};">${d.premiumDays}</td>
          <td style="color:${d.totalExcess > 0 ? 'var(--green)' : 'var(--text3)'};">${d.totalExcess.toFixed(0)} kg</td>
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
  if (E('premiumMentBtn')) E('premiumMentBtn').disabled = false;

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
        <table class="stbl"><thead><tr><th>Anyag</th><th>Aktív nap</th><th>Napi alap</th><th>Termelt össz.</th><th>Prémium nap</th><th>Túltelj.</th><th>Prémium</th></tr></thead><tbody>`;
      r.details.forEach(d => {
        if (d.noConfig) {
          body += `<tr><td>${esc(d.mat)}</td><td>${d.activeDays}</td><td>${d.totalKg.toFixed(0)} kg</td><td colspan="3" style="color:#64748B;font-style:italic;">Nincs konfig</td><td>—</td></tr>`;
        } else {
          body += `<tr><td>${esc(d.mat)}</td><td>${d.activeDays}</td><td>${d.auto ? '≈' : ''}${d.cfg.napiAlap.toFixed(d.auto ? 1 : 0)} kg</td><td>${d.totalKg.toFixed(0)} kg</td><td>${d.premiumDays}</td><td>${d.totalExcess.toFixed(0)} kg</td><td style="font-weight:700;">${fmtFt(d.premium)}</td></tr>`;
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
  hdr.innerHTML = `<span class="pf-brand">Plexiq – Prémium összesítő</span><span class="pf-meta">Nyomtatva: ${nyomtatva}</span>`;
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
