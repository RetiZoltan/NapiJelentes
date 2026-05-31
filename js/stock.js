import { db, doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc, collection, query,
         where, getDocs, orderBy, serverTimestamp } from './firebase.js';
import { state, isMainAdmin, hasPerm } from './state.js';
import { E, esc, msg, tod } from './utils.js';
import { fetchEntries } from './db.js';

/* ── Konfiguráció ── */
let _stockConfig = { kamionMax: 22 };

async function _loadStockConfig() {
  try {
    const s = await getDoc(doc(db, 'config', 'stockConfig'));
    if (s.exists()) _stockConfig = { kamionMax: 22, ...s.data() };
  } catch {}
}

export async function saveStockConfig() {
  const val = parseInt(E('stockKamionMax')?.value, 10);
  if (!val || val < 1 || val > 100) { msg('Érvénytelen érték! (1–100 közé kell esnie)', 'error'); return; }
  try {
    await setDoc(doc(db, 'config', 'stockConfig'), { kamionMax: val });
    _stockConfig.kamionMax = val;
    msg(`Beállítva: ${val} zsák/kamion`);
    loadKeszlet();
  } catch (e) { msg('Hiba: ' + e.message, 'error'); }
}
const MOZGAS_META = {
  bevitel:      { label: 'Bevételezés',  icon: '⬇️',  cls: 'mozg-bevitel'     },
  kivitel:      { label: 'Kivitel',      icon: '⬆️',  cls: 'mozg-kivitel'     },
  atadas:       { label: 'Átadás',       icon: '↔️',  cls: 'mozg-atadas'      },
  kiszallitas:  { label: 'Kiszállítás',  icon: '🚛',  cls: 'mozg-kiszallitas' },
  selejt:       { label: 'Selejt',       icon: '🗑',   cls: 'mozg-selejt'      },
};

let _locations = [];   // { id, nev, aktiv }
let _importCache = []; // entries not yet imported

/* ── Jogosultság ── */
export function canViewStock()   { return isMainAdmin() || hasPerm('keszletMegtekintes') || hasPerm('keszletKezeles'); }
export function canManageStock() { return isMainAdmin() || hasPerm('keszletKezeles'); }

/* ── Kamion segéd ── */
function _kamionStr(zsakSzam) {
  const max = _stockConfig.kamionMax || 22;
  if (!zsakSzam || zsakSzam <= 0) return '';
  const k = Math.floor(zsakSzam / max);
  const m = zsakSzam % max;
  if (k === 0) return `<1 kamion (max ${max} zsák)`;
  return m > 0 ? `~${k} kamion + ${m} zsák` : `${k} kamion`;
}

/* ── Zsák chip-ek HTML ── */
function _zsakChips(sulyok) {
  if (!sulyok?.length) return '';
  return `<div class="stock-zsak-chips">${sulyok.map(s =>
    `<span class="stock-zsak-chip">${s.toFixed(0)} kg</span>`
  ).join('')}</div>`;
}

function _fmtKg(kg) {
  if (!kg) return '—';
  return kg >= 1000
    ? `<span style="font-weight:600;">${(kg/1000).toFixed(2)} t</span><span style="color:var(--text3);font-size:11px;"> (${kg.toFixed(0)} kg)</span>`
    : `${kg.toFixed(0)} kg`;
}

/* ══════════════════════════════════════
   HELYSZÍNEK
══════════════════════════════════════ */
export async function loadLocations() {
  try {
    const snap = await getDocs(query(collection(db, 'stockLocations'), orderBy('nev')));
    _locations = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(l => l.aktiv !== false);
    _fillLocSelects();
  } catch (e) { msg('Helyszín betöltési hiba: ' + e.message, 'error'); }
}

function _fillLocSelects() {
  const locOpts  = _locations.map(l => `<option value="${l.id}">${esc(l.nev)}</option>`).join('');
  const allOpts  = '<option value="">— Mind —</option>' + locOpts;
  const selOpts  = '<option value="">— Válassz —</option>' + locOpts;
  const allIds   = ['keszletHelyF','mozgasHelyF'];
  const selIds   = ['importHelyF','manForrasHely','manCelHely','atForrasHely','atCelHely'];
  [...allIds, ...selIds].forEach(id => {
    const el = E(id); if (!el) return;
    const prev = el.value;
    el.innerHTML = allIds.includes(id) ? allOpts : selOpts;
    if (prev) el.value = prev;
  });
}

export async function saveLocation() {
  const nev = E('helyszinNev')?.value.trim();
  if (!nev) { msg('Add meg a helyszín nevét!', 'error'); return; }
  const leiras = E('helyszinLeiras')?.value.trim() || '';
  try {
    await addDoc(collection(db, 'stockLocations'), {
      nev, leiras, aktiv: true,
      createdBy: state.appUser.uid, createdAt: serverTimestamp()
    });
    msg('Helyszín hozzáadva.');
    E('helyszinNev').value = ''; E('helyszinLeiras').value = '';
    loadLocations(); renderLocations();
  } catch (e) { msg('Hiba: ' + e.message, 'error'); }
}

export async function renderLocations() {
  const div = E('helyszinListDiv'); if (!div) return;
  try {
    const snap = await getDocs(query(collection(db, 'stockLocations'), orderBy('nev')));
    const all  = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (!all.length) {
      div.innerHTML = `<div class="empty-st"><div class="empty-ic">📍</div><div class="empty-title">Nincsenek helyszínek</div><div class="empty-sub">Adj hozzá raktárat vagy termelési területet.</div></div>`;
      return;
    }
    div.innerHTML = all.map(l => `
      <div style="display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid var(--border);">
        <span style="font-size:16px;">📍</span>
        <div style="flex:1;">
          <div style="font-weight:600;font-size:13.5px;color:var(--text)${l.aktiv === false ? ';opacity:.45' : ''};">${esc(l.nev)}</div>
          ${l.leiras ? `<div style="font-size:12px;color:var(--text3);">${esc(l.leiras)}</div>` : ''}
        </div>
        ${l.aktiv !== false ? `<span style="font-size:11px;color:var(--green);font-weight:600;">Aktív</span>` : `<span style="font-size:11px;color:var(--text3);">Archivált</span>`}
        ${canManageStock() ? `<button class="btn btn-danger btn-xs loc-del-btn" data-id="${l.id}">✕</button>` : ''}
      </div>`).join('');
    div.querySelectorAll('.loc-del-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Archivál (nem töröl, mert mozgások hivatkoznak rá)?')) return;
        try {
          await updateDoc(doc(db, 'stockLocations', btn.dataset.id), { aktiv: false });
          msg('Helyszín archiválva.'); loadLocations(); renderLocations();
        } catch (e) { msg('Hiba: ' + e.message, 'error'); }
      });
    });
  } catch (e) { msg('Hiba: ' + e.message, 'error'); }
}

/* ══════════════════════════════════════
   AKTUÁLIS KÉSZLET
══════════════════════════════════════ */
export async function loadKeszlet() {
  const div = E('keszletDiv'); if (!div) return;
  div.innerHTML = '<div class="empty-st"><div class="spinner" style="margin:0 auto"></div></div>';
  try {
    const anyagF = E('keszletAnyagF')?.value || '';
    const helyF  = E('keszletHelyF')?.value  || '';
    const stock  = await _calcStock(anyagF, helyF);

    if (!stock.length) {
      div.innerHTML = `<div class="empty-st"><div class="empty-ic">📦</div><div class="empty-title">Nincs készlet</div><div class="empty-sub">Rögzíts bevételezést a Bevételezés fülön.</div></div>`;
      return;
    }

    const locMap = Object.fromEntries(_locations.map(l => [l.id, l.nev]));

    let h = `<div style="overflow-x:auto;"><table class="stock-table">
      <thead><tr>
        <th>Anyag</th><th>Helyszín</th>
        <th style="text-align:right;">Zsák (db)</th>
        <th style="text-align:right;">Súly</th>
        <th style="text-align:right;">Átlag / zsák</th>
        <th>Szállíthatóság</th>
        <th style="width:28px;"></th>
      </tr></thead><tbody>`;

    stock.forEach((s, idx) => {
      const avgKg     = s.zsakSzam > 0 ? s.kg / s.zsakSzam : 0;
      const kamionStr = _kamionStr(s.zsakSzam);
      const hasDet    = s.bevitelek.length > 0;
      const detId     = `sdet_${idx}`;

      h += `<tr class="${hasDet ? 'stock-row-clickable' : ''}" data-det="${hasDet ? detId : ''}">
        <td style="font-weight:600;color:var(--text);">${esc(s.anyag)}</td>
        <td style="color:var(--text2);">${esc(locMap[s.hely] || s.hely)}</td>
        <td style="text-align:right;"><span class="stock-badge-zsak">${s.zsakSzam} db</span></td>
        <td style="text-align:right;">${_fmtKg(s.kg)}</td>
        <td style="text-align:right;color:var(--text3);font-size:12px;">${avgKg > 0 ? avgKg.toFixed(1) + ' kg' : '—'}</td>
        <td><span class="stock-kamion">${kamionStr ? `🚛 ${kamionStr}` : '—'}</span></td>
        <td style="text-align:center;font-size:13px;color:var(--text3);">${hasDet ? '<span class="stock-det-arrow">▶</span>' : ''}</td>
      </tr>`;

      if (hasDet) {
        const batchRows = s.bevitelek.map(b => `
          <div style="padding:5px 0;border-bottom:1px dashed var(--border2);">
            <div style="font-size:11.5px;color:var(--text3);margin-bottom:4px;">
              📅 ${esc(b.datum)} · ${b.zsakSzam} zsák
            </div>
            ${_zsakChips(b.zsakSulyok)}
          </div>`).join('');
        h += `<tr id="${detId}" class="stock-det-row" style="display:none;">
          <td colspan="7" style="padding:10px 14px;background:var(--surf2);">${batchRows}</td>
        </tr>`;
      }
    });

    const totalZsak = stock.reduce((s, x) => s + x.zsakSzam, 0);
    const totalKg   = stock.reduce((s, x) => s + x.kg, 0);
    h += `</tbody><tfoot><tr>
      <td colspan="2" style="font-weight:700;color:var(--text);">Összesen</td>
      <td style="text-align:right;font-weight:700;">${totalZsak} db</td>
      <td style="text-align:right;">${_fmtKg(totalKg)}</td>
      <td colspan="3" style="color:var(--text3);font-size:12px;">🚛 ${_kamionStr(totalZsak)}</td>
    </tr></tfoot></table></div>`;

    div.innerHTML = h;

    // Kattintható sorok — expand/collapse
    div.querySelectorAll('.stock-row-clickable').forEach(row => {
      row.addEventListener('click', () => {
        const det   = document.getElementById(row.dataset.det);
        const arrow = row.querySelector('.stock-det-arrow');
        if (!det) return;
        const open = det.style.display !== 'none';
        det.style.display   = open ? 'none' : '';
        if (arrow) arrow.textContent = open ? '▶' : '▼';
      });
    });
  } catch (e) { msg('Készlet betöltési hiba: ' + e.message, 'error'); }
}

async function _calcStock(anyagF = '', helyF = '') {
  const snap = await getDocs(query(collection(db, 'stockMovements'), orderBy('createdAt', 'desc')));
  const stock    = {}; // 'anyag|helyId' → { anyag, hely, zsakSzam, kg, bevitelek[] }
  const bevitelek = {}; // 'anyag|helyId' → [{ datum, zsakSzam, zsakSulyok }]

  snap.docs.forEach(d => {
    const m    = { id: d.id, ...d.data() };
    const kg   = m.mennyisegKg || 0;
    const zsak = m.zsakSzam    || 0;
    const add  = (anyag, hely, sign) => {
      const key = `${anyag}|${hely}`;
      if (!stock[key]) stock[key] = { anyag, hely, zsakSzam: 0, kg: 0 };
      stock[key].zsakSzam += sign * zsak;
      stock[key].kg       += sign * kg;
    };
    const t = m.tipus;
    if (t === 'bevitel') {
      add(m.anyag, m.forrasHely, 1);
      // Bevitelezési mozgások zsák súlyainak gyűjtése
      if (m.zsakSulyok?.length) {
        const key = `${m.anyag}|${m.forrasHely}`;
        if (!bevitelek[key]) bevitelek[key] = [];
        bevitelek[key].push({ datum: m.datum, zsakSzam: m.zsakSzam || m.zsakSulyok.length, zsakSulyok: m.zsakSulyok });
      }
    }
    if (t === 'kivitel' || t === 'selejt' || t === 'kiszallitas') add(m.anyag, m.forrasHely, -1);
    if (t === 'atadas') {
      add(m.anyag, m.forrasHely, -1);
      if (m.celHely) add(m.anyag, m.celHely, 1);
    }
  });

  return Object.values(stock)
    .filter(s => s.zsakSzam > 0 || s.kg > 0)
    .filter(s => (!anyagF || s.anyag === anyagF) && (!helyF || s.hely === helyF))
    .map(s => ({ ...s, bevitelek: bevitelek[`${s.anyag}|${s.hely}`] || [] }))
    .sort((a, b) => b.zsakSzam - a.zsakSzam || a.anyag.localeCompare(b.anyag, 'hu'));
}

/* ══════════════════════════════════════
   MOZGÁS NAPLÓ
══════════════════════════════════════ */
export async function loadMozgasok() {
  const div = E('mozgasListDiv'); if (!div) return;
  div.innerHTML = '<div class="empty-st"><div class="spinner" style="margin:0 auto"></div></div>';
  try {
    const tipusF = E('mozgasTipusF')?.value  || '';
    const honapF = E('mozgasHonapF')?.value  || '';
    const helyF  = E('mozgasHelyF')?.value   || '';

    // Egyetlen orderBy hogy ne kelljen composite index
    const constraints = honapF
      ? [where('datum', '>=', honapF + '-01'), where('datum', '<=', honapF + '-31'), orderBy('datum', 'desc')]
      : [orderBy('createdAt', 'desc')];

    const snap = await getDocs(query(collection(db, 'stockMovements'), ...constraints));
    let list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (tipusF) list = list.filter(m => m.tipus === tipusF);
    if (helyF)  list = list.filter(m => m.forrasHely === helyF || m.celHely === helyF);

    if (!list.length) {
      div.innerHTML = `<div class="empty-st"><div class="empty-ic">➡️</div><div class="empty-title">Nincs mozgás</div></div>`;
      return;
    }

    const locMap = Object.fromEntries(_locations.map(l => [l.id, l.nev]));
    const locName = id => esc(locMap[id] || id || '—');

    div.innerHTML = list.map(m => {
      const meta    = MOZGAS_META[m.tipus] || { label: m.tipus, icon: '?', cls: '' };
      const irany   = m.tipus === 'atadas'
        ? `${locName(m.forrasHely)} → ${locName(m.celHely)}`
        : locName(m.forrasHely);
      const canDel  = canManageStock();
      return `<div style="border-bottom:1px solid var(--border);padding:8px 0 6px;">
        <div style="display:flex;align-items:flex-start;gap:10px;">
          <span style="font-size:20px;flex-shrink:0;">${meta.icon}</span>
          <div style="flex:1;min-width:0;">
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
              <span style="font-weight:600;font-size:13.5px;color:var(--text);">${esc(m.anyag)}</span>
              <span class="notice-meta-badge ${meta.cls}">${meta.label}</span>
            </div>
            <div style="font-size:12px;color:var(--text3);margin-top:3px;">
              ${esc(m.datum)} · 📍 ${irany}
              ${m.forrás === 'termelés' ? ' · <em style="color:var(--green)">termelésből</em>' : ''}
            </div>
            ${m.megjegyzes ? `<div style="font-size:12px;color:var(--text2);margin-top:2px;">${esc(m.megjegyzes)}</div>` : ''}
          </div>
          <div style="text-align:right;flex-shrink:0;display:flex;flex-direction:column;align-items:flex-end;gap:3px;">
            <span class="stock-badge-zsak">${m.zsakSzam || 0} db</span>
            <span style="font-size:11px;color:var(--text3);">${m.mennyisegKg ? (m.mennyisegKg/1000).toFixed(2) + ' t' : ''}</span>
          </div>
          ${canDel ? `<button class="btn btn-danger btn-xs mozg-del-btn" data-id="${m.id}" style="flex-shrink:0;">✕</button>` : ''}
        </div>
        ${m.zsakSulyok?.length ? `<div style="padding:5px 0 0 30px;">${_zsakChips(m.zsakSulyok)}</div>` : ''}
      </div>`;
    }).join('');

    div.querySelectorAll('.mozg-del-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Törlöd ezt a mozgást? A készlet frissülni fog.')) return;
        try {
          await deleteDoc(doc(db, 'stockMovements', btn.dataset.id));
          msg('Mozgás törölve.'); loadMozgasok(); loadKeszlet();
        } catch (e) { msg('Hiba: ' + e.message, 'error'); }
      });
    });
  } catch (e) { msg('Mozgás betöltési hiba: ' + e.message, 'error'); }
}

/* ══════════════════════════════════════
   IMPORT TERMELÉSBŐL
══════════════════════════════════════ */
export async function loadImportFromProduction() {
  const div = E('importListDiv'); if (!div) return;
  const honap = E('importHonapF')?.value;
  if (!honap) { msg('Válassz hónapot!', 'error'); return; }

  div.innerHTML = '<div class="empty-st"><div class="spinner" style="margin:0 auto"></div></div>';
  if (E('importActionDiv')) E('importActionDiv').style.display = 'none';

  try {
    // Importált entry ID-k lekérése
    const importedSnap = await getDocs(
      query(collection(db, 'stockMovements'), where('forrás', '==', 'termelés'))
    );
    const importedRefs = new Set();
    importedSnap.docs.forEach(d => (d.data().termelesRef || []).forEach(id => importedRefs.add(id)));

    // Termelési bejegyzések lekérése
    const [year, month] = honap.split('-').map(Number);
    const prefix  = honap;
    const lastDay = new Date(year, month, 0).getDate();
    const allEntries = await fetchEntries({
      datumFrom: `${prefix}-01`,
      datumTo:   `${prefix}-${String(lastDay).padStart(2,'0')}`
    });

    const withZsak = allEntries.filter(e => e.zsakSulyok?.length > 0 && !importedRefs.has(e.id));
    _importCache   = withZsak;

    if (!withZsak.length) {
      div.innerHTML = `<div class="empty-st"><div class="empty-ic">✅</div><div class="empty-title">Nincs importálandó adat</div><div class="empty-sub">Erre a hónapra minden teli zsák adat már importálva van, vagy nincs ilyen bejegyzés.</div></div>`;
      return;
    }

    // Csoportosítás anyag szerint
    const byAnyag = {};
    withZsak.forEach(e => {
      const mat = (e.anyag || '').trim() || '—';
      if (!byAnyag[mat]) byAnyag[mat] = [];
      byAnyag[mat].push(e);
    });

    let h = '';
    Object.entries(byAnyag).sort(([a],[b]) => a.localeCompare(b,'hu')).forEach(([mat, entries]) => {
      const totZsak = entries.reduce((s, e) => s + e.zsakSulyok.length, 0);
      const totKg   = entries.reduce((s, e) => s + e.zsakSulyok.reduce((x,v)=>x+v,0), 0);
      h += `<div style="margin-bottom:14px;">
        <div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:2px solid var(--accent);">
          <input type="checkbox" class="import-grp-chk" data-mat="${esc(mat)}" checked style="accent-color:var(--accent);">
          <strong style="font-size:14px;color:var(--text);">📦 ${esc(mat)}</strong>
          <span class="stock-badge-zsak" style="margin-left:auto;">${totZsak} db</span>
          <span style="font-size:12px;color:var(--text3);">${(totKg/1000).toFixed(2)} t</span>
        </div>
        ${entries.sort((a,b)=>a.datum.localeCompare(b.datum)).map(e => {
          const zsak = e.zsakSulyok.length;
          const kg   = e.zsakSulyok.reduce((s,v)=>s+v,0);
          return `<div style="padding:6px 0 8px 20px;border-bottom:1px solid var(--border);">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:5px;">
              <input type="checkbox" class="import-entry-chk" data-id="${e.id}" data-mat="${esc(mat)}" checked style="accent-color:var(--accent);flex-shrink:0;">
              <span style="font-size:13px;color:var(--text);font-weight:600;">${esc(e.datum)}</span>
              <span style="font-size:12px;color:var(--text3);">${esc(e.nev)}</span>
              <span style="margin-left:auto;font-size:12px;color:var(--text2);">${zsak} zsák · ${(kg/1000).toFixed(2)} t</span>
            </div>
            ${_zsakChips(e.zsakSulyok)}
          </div>`;
        }).join('')}
      </div>`;
    });

    div.innerHTML = h;
    if (E('importActionDiv')) E('importActionDiv').style.display = '';

    // Csoportos checkbox kezelés
    div.querySelectorAll('.import-grp-chk').forEach(grp => {
      grp.addEventListener('change', () => {
        div.querySelectorAll(`.import-entry-chk[data-mat="${grp.dataset.mat}"]`)
           .forEach(cb => { cb.checked = grp.checked; });
        _updateImportCount();
      });
    });
    div.querySelectorAll('.import-entry-chk').forEach(cb => {
      cb.addEventListener('change', _updateImportCount);
    });
    _updateImportCount();
  } catch (e) { msg('Betöltési hiba: ' + e.message, 'error'); }
}

function _updateImportCount() {
  const checked = document.querySelectorAll('.import-entry-chk:checked');
  const cnt     = E('importCount');
  const btn     = E('importMentBtn');
  if (cnt) cnt.textContent = checked.length > 0 ? `${checked.length} sor kijelölve` : '';
  if (btn) btn.disabled = checked.length === 0;
}

export async function executeImport() {
  const celHely = E('importHelyF')?.value;
  if (!celHely) { msg('Válassz cél helyszínt!', 'error'); return; }

  const checked = [...document.querySelectorAll('.import-entry-chk:checked')];
  if (!checked.length) { msg('Nincs kijelölt sor!', 'error'); return; }

  // Csoportosítás anyag szerint (egy mozgás / anyag)
  const byMat = {};
  checked.forEach(cb => {
    const id  = cb.dataset.id;
    const mat = cb.dataset.mat;
    const e   = _importCache.find(x => x.id === id);
    if (!e) return;
    if (!byMat[mat]) byMat[mat] = { zsakSzam: 0, mennyisegKg: 0, refs: [], zsakSulyok: [] };
    byMat[mat].zsakSzam    += e.zsakSulyok.length;
    byMat[mat].mennyisegKg += e.zsakSulyok.reduce((s,v)=>s+v,0);
    byMat[mat].refs.push(e.id);
    byMat[mat].zsakSulyok.push(...e.zsakSulyok);
  });

  try {
    const datum = tod();
    for (const [mat, data] of Object.entries(byMat)) {
      await addDoc(collection(db, 'stockMovements'), {
        tipus:       'bevitel',
        anyag:       mat,
        forrasHely:  celHely,
        celHely:     null,
        zsakSzam:    data.zsakSzam,
        mennyisegKg: parseFloat(data.mennyisegKg.toFixed(2)),
        zsakSulyok:  data.zsakSulyok,
        datum,
        megjegyzes:  `Import: ${E('importHonapF').value}`,
        forrás:      'termelés',
        termelesRef: data.refs,
        createdBy:   state.appUser.uid,
        createdAt:   serverTimestamp()
      });
    }
    msg(`${Object.keys(byMat).length} anyag importálva, ${checked.length} bejegyzés.`);
    loadImportFromProduction();
    loadKeszlet();
  } catch (e) { msg('Import hiba: ' + e.message, 'error'); }
}

/* ══════════════════════════════════════
   MANUÁLIS MOZGÁS
══════════════════════════════════════ */
export async function saveManualisMozgas() {
  const tipus     = E('manTipus')?.value;
  const anyag     = E('manAnyag')?.value?.trim();
  const zsakSzam  = parseInt(E('manZsakSzam')?.value, 10);
  const kg        = parseFloat(E('manKg')?.value);
  const forrasHely= E('manForrasHely')?.value;
  const celHely   = E('manCelHely')?.value || null;
  const datum     = E('manDatum')?.value || tod();
  const megjegyzes= E('manMegjegyzes')?.value?.trim() || '';

  if (!anyag)      { msg('Add meg az anyag nevét!', 'error'); return; }
  if (!forrasHely) { msg('Válassz helyszínt!', 'error'); return; }
  if (!zsakSzam || zsakSzam <= 0) { msg('Add meg a zsák darabszámot!', 'error'); return; }
  if (tipus === 'atadas' && !celHely) { msg('Átadásnál cél helyszín is szükséges!', 'error'); return; }
  if (tipus === 'kiszallitas' && zsakSzam > 24) {
    if (!confirm(`${zsakSzam} zsák meghaladja a kamion kapacitást (24). Folytatod?`)) return;
  }

  try {
    await addDoc(collection(db, 'stockMovements'), {
      tipus, anyag,
      forrasHely,
      celHely: tipus === 'atadas' ? celHely : null,
      zsakSzam,
      mennyisegKg: kg > 0 ? kg : null,
      datum, megjegyzes,
      forrás:    'manuális',
      termelesRef: [],
      createdBy: state.appUser.uid,
      createdAt: serverTimestamp()
    });
    msg('Mozgás rögzítve!');
    E('manZsakSzam').value = E('manKg').value = E('manMegjegyzes').value = '';
    loadKeszlet();
    // Kiszállítás esetén kamion-számítás visszajelzés
    if (tipus === 'kiszallitas') {
      const k = Math.ceil(zsakSzam / KAMION_MAX);
      msg(`✅ ${zsakSzam} zsák kiszállítva · ${k} kamion`, 'success', 4000);
    }
  } catch (e) { msg('Mentési hiba: ' + e.message, 'error'); }
}

/* ══════════════════════════════════════
   GYORS ÁTMOZGATÁS
══════════════════════════════════════ */
export async function saveAtmozgatas() {
  const anyag      = E('atAnyag')?.value?.trim();
  const zsakSzam   = parseInt(E('atZsakSzam')?.value, 10);
  const forrasHely = E('atForrasHely')?.value;
  const celHely    = E('atCelHely')?.value;
  const datum      = E('atDatum')?.value || tod();
  const megjegyzes = E('atMegjegyzes')?.value?.trim() || '';

  if (!anyag)        { msg('Add meg az anyag nevét!', 'error'); return; }
  if (!zsakSzam || zsakSzam <= 0) { msg('Add meg a zsák darabszámot!', 'error'); return; }
  if (!forrasHely)   { msg('Válassz forrás helyszínt!', 'error'); return; }
  if (!celHely)      { msg('Válassz cél helyszínt!', 'error'); return; }
  if (forrasHely === celHely) { msg('A forrás és cél helyszín nem lehet ugyanaz!', 'error'); return; }

  try {
    await addDoc(collection(db, 'stockMovements'), {
      tipus: 'atadas', anyag, forrasHely, celHely,
      zsakSzam, mennyisegKg: null, zsakSulyok: [],
      datum, megjegyzes, forrás: 'manuális', termelesRef: [],
      createdBy: state.appUser.uid, createdAt: serverTimestamp()
    });
    msg(`✅ ${zsakSzam} zsák átmozgatva`);
    E('atZsakSzam').value = E('atMegjegyzes').value = '';
    loadKeszlet();
  } catch (e) { msg('Hiba: ' + e.message, 'error'); }
}

/* ── Dinamikus cél helyszín megjelenítés ── */
export function onManTipusChange() {
  const tipus = E('manTipus')?.value;
  const celRow = E('manCelHelyRow');
  if (celRow) celRow.style.display = tipus === 'atadas' ? '' : 'none';
  // Kiszállítás límit jelzés
  const hint = E('kiszallitasHint');
  if (hint) hint.style.display = tipus === 'kiszallitas' ? '' : 'none';
}

/* ══════════════════════════════════════
   TAB VÁLTÁS
══════════════════════════════════════ */
export function switchKeszletTab(name) {
  document.querySelectorAll('#keszletSubtabs .stab-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.ksTab === name)
  );
  document.querySelectorAll('#tab-keszlet .kstab-panel').forEach(p => p.classList.remove('active'));
  E('ksTab-' + name)?.classList.add('active');
  if (name === 'sztkeszlet')   loadKeszlet();
  if (name === 'sztmozgas')    loadMozgasok();
  if (name === 'szthelyszin')  renderLocations();
}

export async function initKeszletTab() {
  await Promise.all([loadLocations(), _loadStockConfig()]);
  // Kamion max megjelenítése a beállítás mezőben
  const inp = E('stockKamionMax');
  if (inp) inp.value = _stockConfig.kamionMax || 22;
  loadKeszlet();
}
