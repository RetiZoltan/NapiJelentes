import { db, doc, addDoc, updateDoc, deleteDoc, collection, query,
         where, getDocs, orderBy, serverTimestamp } from './firebase.js';
import { state, isMainAdmin, hasPerm } from './state.js';
import { E, esc, msg, tod, fmtKg, emptyHtml } from './utils.js';
import { fetchEntries } from './db.js';

/* ── Jogosultság ── */
export function canViewStock()   { return isMainAdmin() || hasPerm('keszletMegtekintes') || hasPerm('keszletKezeles'); }
export function canManageStock() { return isMainAdmin() || hasPerm('keszletKezeles'); }

/* ── Belső állapot ── */
let _locations   = [];
let _importCache = [];
let _mozgTipus   = 'atadas';

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
  const locOpts    = _locations.map(l => `<option value="${l.id}">${esc(l.nev)}</option>`).join('');
  const allOpts    = '<option value="">— Mind —</option>' + locOpts;
  const belsoOpts  = '<option value="">— Mind —</option><option value="_belso_">🏭 Belső készlet</option>' + locOpts;
  const selOpts    = '<option value="">— Válassz —</option>' + locOpts;

  const keszletEl = E('keszletHelyF');
  if (keszletEl) { const p = keszletEl.value; keszletEl.innerHTML = belsoOpts; if (p) keszletEl.value = p; }

  ['elozHelyF'].forEach(id => {
    const el = E(id); if (!el) return;
    const prev = el.value; el.innerHTML = allOpts; if (prev) el.value = prev;
  });
  ['belsoHelyF', 'mozgForrasHely', 'mozgCelHely', 'bevHelyF'].forEach(id => {
    const el = E(id); if (!el) return;
    const prev = el.value; el.innerHTML = selOpts; if (prev) el.value = prev;
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
      div.innerHTML = emptyHtml('📍', 'Nincsenek helyszínek', 'Adj hozzá raktárat vagy termelési területet.');
      return;
    }
    div.innerHTML = all.map(l => `
      <div style="display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid var(--border);">
        <span style="font-size:16px;">📍</span>
        <div style="flex:1;">
          <div style="font-weight:600;font-size:13.5px;color:var(--text)${l.aktiv === false ? ';opacity:.45' : ''};">${esc(l.nev)}</div>
          ${l.leiras ? `<div style="font-size:12px;color:var(--text3);">${esc(l.leiras)}</div>` : ''}
        </div>
        ${l.aktiv !== false
          ? `<span style="font-size:11px;color:var(--green);font-weight:600;">Aktív</span>`
          : `<span style="font-size:11px;color:var(--text3);">Archivált</span>`}
        ${canManageStock() ? `<button class="btn btn-danger btn-xs loc-del-btn" data-id="${l.id}">Töröl</button>` : ''}
      </div>`).join('');
    div.querySelectorAll('.loc-del-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Véglegesen törlöd ezt a helyszínt?')) return;
        try {
          await deleteDoc(doc(db, 'stockLocations', btn.dataset.id));
          msg('Helyszín törölve.'); loadLocations(); renderLocations();
        } catch (e) { msg('Hiba: ' + e.message, 'error'); }
      });
    });
  } catch (e) { msg('Hiba: ' + e.message, 'error'); }
}

/* ══════════════════════════════════════
   KÉSZLET SZÁMÍTÁS (belső helper)
══════════════════════════════════════ */
async function _calcStock(anyagF = '', helyF = '') {
  const snap = await getDocs(query(collection(db, 'stockMovements'), orderBy('createdAt', 'desc')));
  const stock        = {};
  const batches      = {};
  const importedRefs = new Set();

  snap.docs.forEach(d => {
    const m    = { id: d.id, ...d.data() };
    const zsak = m.zsakSzam    || 0;
    const kg   = m.mennyisegKg || 0;

    if (m.forrás === 'termelés') (m.termelesRef || []).forEach(id => importedRefs.add(id));

    const add = (anyag, hely, sign) => {
      const key = `${anyag}|${hely}`;
      if (!stock[key]) stock[key] = { anyag, hely, zsakSzam: 0, kg: 0, belso: false };
      stock[key].zsakSzam += sign * zsak;
      stock[key].kg       += sign * kg;
      if (m.forrás === 'termelés') stock[key].belso = true;
    };

    const t = m.tipus;
    if (t === 'bevitel') {
      add(m.anyag, m.forrasHely, 1);
      if (m.zsakSulyok?.length) {
        const key = `${m.anyag}|${m.forrasHely}`;
        if (!batches[key]) batches[key] = [];
        batches[key].push({ datum: m.datum || '', zsakSzam: m.zsakSzam || m.zsakSulyok.length, zsakSulyok: m.zsakSulyok });
      }
    }
    if (t === 'kiszallitas' || t === 'selejt' || t === 'kivitel') add(m.anyag, m.forrasHely, -1);
    if (t === 'atadas') {
      add(m.anyag, m.forrasHely, -1);
      if (m.celHely) add(m.anyag, m.celHely, 1);
    }
  });

  // Betárolatlan termelési bejegyzések → virtuális '_termelés_' helyszín
  const allEntries = await fetchEntries({});
  allEntries
    .filter(e => e.zsakSulyok?.length > 0 && !importedRefs.has(e.id))
    .forEach(e => {
      const mat = (e.anyag || '').trim() || '—';
      const key = `${mat}|_termelés_`;
      if (!stock[key]) stock[key] = { anyag: mat, hely: '_termelés_', zsakSzam: 0, kg: 0, belso: true };
      stock[key].zsakSzam += e.zsakSulyok.length;
      stock[key].kg       += e.zsakSulyok.reduce((s, v) => s + v, 0);
      if (!batches[key]) batches[key] = [];
      batches[key].push({ datum: e.datum || '', zsakSzam: e.zsakSulyok.length, zsakSulyok: e.zsakSulyok });
    });

  const belsoFilter = helyF === '_belso_';

  return Object.values(stock)
    .filter(s => s.zsakSzam > 0 || s.kg > 0)
    .filter(s => !anyagF || s.anyag.toLowerCase().includes(anyagF.toLowerCase()))
    .filter(s => belsoFilter ? s.belso : (!helyF || s.hely === helyF))
    .map(s => ({ ...s, batches: (batches[`${s.anyag}|${s.hely}`] || []).sort((a, b) => a.datum.localeCompare(b.datum)) }))
    .sort((a, b) => b.zsakSzam - a.zsakSzam || a.anyag.localeCompare(b.anyag, 'hu'));
}

function _locName(locMap, id) {
  if (id === '_termelés_') return '🏭 Termelés';
  return esc(locMap[id] || id || '—');
}

/* ══════════════════════════════════════
   TAB 1 — AKTUÁLIS KÉSZLET
══════════════════════════════════════ */
export async function loadKeszlet() {
  const div = E('keszletDiv'); if (!div) return;
  div.innerHTML = '<div class="empty-st"><div class="spinner" style="margin:0 auto"></div></div>';
  try {
    const anyagF = E('keszletAnyagF')?.value || '';
    const helyF  = E('keszletHelyF')?.value  || '';
    const stock  = await _calcStock(anyagF, helyF);

    if (!stock.length) {
      div.innerHTML = emptyHtml('📦', 'Nincs készlet', 'Rögzíts bevételezést a Bevételezés fülön.');
      return;
    }

    const locMap    = Object.fromEntries(_locations.map(l => [l.id, l.nev]));
    const totalZsak = stock.reduce((s, x) => s + x.zsakSzam, 0);
    const totalKg   = stock.reduce((s, x) => s + x.kg, 0);

    let h = `<div class="stock-summary-row">
      <div class="ssc"><div class="ssc-val">${totalZsak} db</div><div class="ssc-lbl">Összes zsák</div></div>
      <div class="ssc"><div class="ssc-val">${totalKg >= 1000 ? (totalKg/1000).toFixed(1)+' t' : totalKg.toFixed(0)+' kg'}</div><div class="ssc-lbl">Összsúly</div></div>
      <div class="ssc"><div class="ssc-val">${stock.length}</div><div class="ssc-lbl">Tétel</div></div>
    </div>`;

    h += `<div style="overflow-x:auto;"><table class="stock-table">
      <thead><tr>
        <th>Anyag</th>
        <th>Helyszín</th>
        <th style="text-align:right;">Zsák (db)</th>
        <th style="text-align:right;">Súly</th>
        <th>Forrás</th>
        <th style="width:22px;"></th>
      </tr></thead><tbody>`;

    stock.forEach((s, idx) => {
      const detId  = `kdet_${idx}`;
      const hasDet = s.batches.length > 0;
      h += `<tr class="${hasDet ? 'stock-row-clickable' : ''}" data-det="${hasDet ? detId : ''}">
        <td style="font-weight:600;color:var(--text);">${esc(s.anyag)}</td>
        <td style="color:var(--text2);">${_locName(locMap, s.hely)}</td>
        <td style="text-align:right;"><span class="stock-badge-zsak">${s.zsakSzam} db</span></td>
        <td style="text-align:right;">${s.kg > 0 ? fmtKg(s.kg) : '—'}</td>
        <td><span style="font-size:11px;font-weight:600;color:${s.belso ? 'var(--green)' : 'var(--text3)'};">${s.belso ? '🏭 belső' : '📥 külső'}</span></td>
        <td style="width:22px;text-align:center;color:var(--text3);font-size:12px;">${hasDet ? '<span class="stock-det-arrow">▶</span>' : ''}</td>
      </tr>`;
      if (hasDet) {
        const allWeights = s.batches.flatMap(b => b.zsakSulyok);
        h += `<tr id="${detId}" class="stock-det-row" style="display:none;">
          <td colspan="6" style="padding:10px 14px;background:var(--surf2);">
            <div class="stock-zsak-chips">${allWeights.map(w => `<span class="stock-zsak-chip">${w.toFixed(0)} kg</span>`).join('')}</div>
          </td>
        </tr>`;
      }
    });

    h += `</tbody></table></div>`;
    div.innerHTML = h;

    div.querySelectorAll('.stock-row-clickable').forEach(row => {
      row.addEventListener('click', () => {
        const det   = document.getElementById(row.dataset.det);
        const arrow = row.querySelector('.stock-det-arrow');
        if (!det) return;
        const open = det.style.display !== 'none';
        det.style.display = open ? 'none' : '';
        if (arrow) arrow.textContent = open ? '▶' : '▼';
      });
    });
  } catch (e) { msg('Készlet betöltési hiba: ' + e.message, 'error'); }
}

/* ══════════════════════════════════════
   TAB 2 — ANYAGMOZGÁS
══════════════════════════════════════ */
export function onMozgTipusChange(tipus) {
  _mozgTipus = tipus;
  document.querySelectorAll('.mozg-tipus-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.tipus === tipus)
  );
  const celRow = E('mozgCelHelyRow');
  if (celRow) celRow.style.display = tipus === 'atadas' ? '' : 'none';
}

async function _refreshMozgasKeszlet() {
  const div = E('mozgasKeszletDiv'); if (!div) return;
  div.innerHTML = '<div style="color:var(--text3);font-size:12px;padding:4px 0;">Betöltés…</div>';
  try {
    const stock = await _calcStock('', '');
    if (!stock.length) {
      div.innerHTML = '<div style="color:var(--text3);font-size:12px;padding:4px 0;">Nincs aktuális készlet.</div>';
      return;
    }
    const locMap = Object.fromEntries(_locations.map(l => [l.id, l.nev]));
    div.innerHTML =
      `<div style="font-size:10.5px;color:var(--text3);font-weight:700;letter-spacing:.05em;text-transform:uppercase;margin-bottom:6px;">Aktuális készlet</div>` +
      stock.map(s => {
        const allChips = s.batches.flatMap(b => b.zsakSulyok);
        return `<div style="padding:6px 0;border-bottom:1px solid var(--border);">
          <div style="display:flex;justify-content:space-between;align-items:center;font-size:13px;">
            <span style="color:var(--text2);">${esc(s.anyag)} · <span style="color:var(--text3);">${_locName(locMap, s.hely)}</span></span>
            <span class="stock-badge-zsak">${s.zsakSzam} db</span>
          </div>
          ${allChips.length ? `<div class="stock-zsak-chips" style="margin-top:5px;">${allChips.map(w => `<span class="stock-zsak-chip">${w.toFixed(0)} kg</span>`).join('')}</div>` : ''}
        </div>`;
      }).join('');
  } catch {}
}

export async function saveMozgas() {
  const anyag  = E('mozgAnyag')?.value?.trim();
  const zsakSz = parseInt(E('mozgZsakSzam')?.value, 10);
  const forras = E('mozgForrasHely')?.value;
  const cel    = E('mozgCelHely')?.value || null;
  const datum  = E('mozgDatum')?.value || tod();
  const megj   = E('mozgMegjegyzes')?.value?.trim() || '';

  if (!anyag)                                          { msg('Add meg az anyag nevét!', 'error');  return; }
  if (!forras)                                         { msg('Válassz forrás helyszínt!', 'error'); return; }
  if (!zsakSz || zsakSz <= 0)                          { msg('Add meg a zsák darabszámot!', 'error'); return; }
  if (_mozgTipus === 'atadas' && !cel)                 { msg('Válassz cél helyszínt!', 'error'); return; }
  if (_mozgTipus === 'atadas' && forras === cel)       { msg('Forrás és cél nem lehet ugyanaz!', 'error'); return; }

  try {
    await addDoc(collection(db, 'stockMovements'), {
      tipus:      _mozgTipus,
      anyag,
      forrasHely: forras,
      celHely:    _mozgTipus === 'atadas' ? cel : null,
      zsakSzam:   zsakSz,
      mennyisegKg: null,
      datum, megjegyzes: megj,
      forrás: 'manuális', termelesRef: [],
      createdBy: state.appUser.uid, createdAt: serverTimestamp()
    });
    const labels = { atadas: 'Áttárolás rögzítve', kiszallitas: 'Kiszállítás rögzítve', selejt: 'Selejt rögzítve' };
    msg(labels[_mozgTipus] || 'Rögzítve');
    E('mozgZsakSzam').value = E('mozgMegjegyzes').value = '';
    _refreshMozgasKeszlet();
    loadKeszlet();
  } catch (e) { msg('Mentési hiba: ' + e.message, 'error'); }
}

/* ══════════════════════════════════════
   TAB 3 — BEVÉTELEZÉS / BELSŐ KÉSZLET
══════════════════════════════════════ */
export async function loadBelsoKeszlet() {
  const div = E('belsoKeszletDiv'); if (!div) return;
  div.innerHTML = '<div class="empty-st"><div class="spinner" style="margin:0 auto"></div></div>';
  _updateBelsoSelection();

  try {
    // Már betárolt entry ID-k
    const importedSnap = await getDocs(
      query(collection(db, 'stockMovements'), where('forrás', '==', 'termelés'))
    );
    const importedRefs = new Set();
    importedSnap.docs.forEach(d => (d.data().termelesRef || []).forEach(id => importedRefs.add(id)));

    // Összes termelési bejegyzés zsák adattal
    const allEntries = await fetchEntries({});
    const withZsak = allEntries.filter(e => e.zsakSulyok?.length > 0 && !importedRefs.has(e.id));

    if (!withZsak.length) {
      div.innerHTML = emptyHtml('✅', 'Nincs betárolatlan belső készlet', 'Minden termelési zsák már be van tárolva.');
      return;
    }

    // Csoportosítás anyag szerint
    const byAnyag = {};
    withZsak.forEach(e => {
      const mat = (e.anyag || '').trim() || '—';
      if (!byAnyag[mat]) byAnyag[mat] = [];
      byAnyag[mat].push(e);
    });

    div.innerHTML = Object.entries(byAnyag)
      .sort(([a],[b]) => a.localeCompare(b,'hu'))
      .map(([mat, entries]) => {
        const allWeights = entries.flatMap(e => e.zsakSulyok);
        return `<div style="margin-bottom:14px;">
          <div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:2px solid var(--accent);margin-bottom:8px;">
            <span style="font-weight:700;font-size:14px;color:var(--text);">📦 ${esc(mat)}</span>
            <span class="stock-badge-zsak" style="margin-left:auto;">${allWeights.length} db</span>
          </div>
          <div class="stock-zsak-chips">
            ${allWeights.map((w, globalIdx) => {
              // melyik entry-hez tartozik ez a zsák
              let eid = '', cumul = 0;
              for (const e of entries) {
                if (globalIdx < cumul + e.zsakSulyok.length) { eid = e.id; break; }
                cumul += e.zsakSulyok.length;
              }
              return `<span class="stock-zsak-chip belso-chip" style="cursor:pointer;"
                data-anyag="${esc(mat)}" data-suly="${w}" data-eid="${eid}">${w.toFixed(0)} kg</span>`;
            }).join('')}
          </div>
        </div>`;
      }).join('');

    div.querySelectorAll('.belso-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        chip.classList.toggle('selected');
        _updateBelsoSelection();
      });
    });
  } catch (e) { msg('Betöltési hiba: ' + e.message, 'error'); }
}

function _updateBelsoSelection() {
  const selected   = [...document.querySelectorAll('.belso-chip.selected')];
  const infoEl     = E('belsoSzamDiv');
  const actionDiv  = E('belsoActionDiv');
  if (infoEl) {
    if (selected.length) {
      const kg = selected.reduce((s, c) => s + parseFloat(c.dataset.suly || 0), 0);
      infoEl.textContent = `${selected.length} zsák kijelölve · ${kg.toFixed(0)} kg`;
    } else {
      infoEl.textContent = '';
    }
  }
  if (actionDiv) actionDiv.style.display = selected.length > 0 ? '' : 'none';
}

export async function saveBelsoAttalolas() {
  const celHely = E('belsoHelyF')?.value;
  if (!celHely) { msg('Válassz helyszínt!', 'error'); return; }

  const selected = [...document.querySelectorAll('.belso-chip.selected')];
  if (!selected.length) { msg('Jelölj ki zsákokat!', 'error'); return; }

  // Csoportosítás anyag szerint (+ entry-referenciák gyűjtése)
  const byAnyag = {};
  selected.forEach(chip => {
    const mat = chip.dataset.anyag;
    if (!byAnyag[mat]) byAnyag[mat] = { sulyok: [], refs: new Set() };
    byAnyag[mat].sulyok.push(parseFloat(chip.dataset.suly || 0));
    if (chip.dataset.eid) byAnyag[mat].refs.add(chip.dataset.eid);
  });

  try {
    const datum = tod();
    for (const [mat, data] of Object.entries(byAnyag)) {
      await addDoc(collection(db, 'stockMovements'), {
        tipus:       'bevitel',
        anyag:       mat,
        forrasHely:  celHely,
        celHely:     null,
        zsakSzam:    data.sulyok.length,
        mennyisegKg: parseFloat(data.sulyok.reduce((s,v) => s+v, 0).toFixed(2)),
        zsakSulyok:  data.sulyok,
        datum,
        megjegyzes:  'Termelésből betárolva',
        forrás:      'termelés',
        termelesRef: [...data.refs],
        createdBy:   state.appUser.uid,
        createdAt:   serverTimestamp()
      });
    }
    msg(`✅ ${selected.length} zsák betárolva.`);
    loadBelsoKeszlet();
    loadKeszlet();
  } catch (e) { msg('Mentési hiba: ' + e.message, 'error'); }
}

/* ── Bevételezés chip-builder ── */
let _bevChips = [];

export function bevChipAdd() {
  const inp = E('bevChipSuly');
  const val = parseFloat(inp?.value);
  if (!val || val <= 0) { msg('Add meg a zsák súlyát!', 'error'); return; }
  _bevChips.push(val);
  inp.value = '';
  inp.focus();
  _bevRenderChips();
}

export function bevChipClear() {
  _bevChips = [];
  _bevRenderChips();
}

function _bevRenderChips() {
  const container = E('bevZsakChips'); if (!container) return;
  container.innerHTML = _bevChips.map((w, i) =>
    `<span class="stock-zsak-chip" style="display:inline-flex;align-items:center;gap:3px;">
      ${w.toFixed(1)} kg
      <button class="bev-chip-del" data-idx="${i}" style="background:none;border:none;cursor:pointer;color:var(--text3);font-size:13px;padding:0 2px;line-height:1;">×</button>
    </span>`
  ).join('');
  container.querySelectorAll('.bev-chip-del').forEach(btn => {
    btn.addEventListener('click', () => {
      _bevChips.splice(parseInt(btn.dataset.idx), 1);
      _bevRenderChips();
    });
  });
  if (_bevChips.length > 0) {
    const zsakEl = E('bevZsakSzam'); const kgEl = E('bevKg');
    if (zsakEl) zsakEl.value = _bevChips.length;
    if (kgEl)   kgEl.value   = _bevChips.reduce((s, v) => s + v, 0).toFixed(1);
  }
}

export async function saveBevetelez() {
  const anyag  = E('bevAnyag')?.value?.trim();
  const hely   = E('bevHelyF')?.value;
  const datum  = E('bevDatum')?.value || tod();
  const megj   = E('bevMegjegyzes')?.value?.trim() || '';

  const hasChips = _bevChips.length > 0;
  const zsakSz   = hasChips ? _bevChips.length : parseInt(E('bevZsakSzam')?.value, 10);
  const kg       = hasChips ? parseFloat(_bevChips.reduce((s, v) => s + v, 0).toFixed(2)) : (parseFloat(E('bevKg')?.value) || null);

  if (!anyag)                     { msg('Add meg az anyag nevét!', 'error'); return; }
  if (!hely)                      { msg('Válassz helyszínt!', 'error'); return; }
  if (!zsakSz || zsakSz <= 0)     { msg('Add meg a zsák darabszámot!', 'error'); return; }

  try {
    await addDoc(collection(db, 'stockMovements'), {
      tipus:       'bevitel',
      anyag,
      forrasHely:  hely,
      celHely:     null,
      zsakSzam:    zsakSz,
      mennyisegKg: kg,
      zsakSulyok:  hasChips ? [..._bevChips] : [],
      datum, megjegyzes: megj,
      forrás: 'manuális', termelesRef: [],
      createdBy: state.appUser.uid, createdAt: serverTimestamp()
    });
    msg('Bevételezés rögzítve!');
    _bevChips = []; _bevRenderChips();
    E('bevAnyag').value = E('bevZsakSzam').value = E('bevKg').value = E('bevMegjegyzes').value = '';
    loadKeszlet();
  } catch (e) { msg('Mentési hiba: ' + e.message, 'error'); }
}

/* ══════════════════════════════════════
   TAB 4 — ELŐZMÉNYEK
══════════════════════════════════════ */
const MOZGAS_META = {
  bevitel:     { label: 'Bevételezés', icon: '⬇️', cls: 'mozg-bevitel'     },
  atadas:      { label: 'Áttárolás',   icon: '↔️', cls: 'mozg-atadas'      },
  kiszallitas: { label: 'Kiszállítás', icon: '⬆️', cls: 'mozg-kiszallitas' },
  selejt:      { label: 'Selejt',      icon: '🗑',  cls: 'mozg-selejt'      },
  kivitel:     { label: 'Kivitel',     icon: '⬆️', cls: 'mozg-kivitel'     },
};

export async function loadElozmenyek() {
  const div = E('elozményekDiv'); if (!div) return;
  div.innerHTML = '<div class="empty-st"><div class="spinner" style="margin:0 auto"></div></div>';
  try {
    const tipusF = E('elozTipusF')?.value || '';
    const honapF = E('elozHonapF')?.value || '';
    const helyF  = E('elozHelyF')?.value  || '';

    const constraints = honapF
      ? [where('datum', '>=', honapF + '-01'), where('datum', '<=', honapF + '-31'), orderBy('datum', 'desc')]
      : [orderBy('createdAt', 'desc')];

    const snap = await getDocs(query(collection(db, 'stockMovements'), ...constraints));
    let list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (tipusF) list = list.filter(m => m.tipus === tipusF);
    if (helyF)  list = list.filter(m => m.forrasHely === helyF || m.celHely === helyF);

    if (!list.length) {
      div.innerHTML = emptyHtml('📋', 'Nincs mozgás', 'Próbálj más szűrőt.');
      return;
    }

    const locMap = Object.fromEntries(_locations.map(l => [l.id, l.nev]));
    const locN   = id => esc(locMap[id] || id || '—');

    div.innerHTML = list.map(m => {
      const meta  = MOZGAS_META[m.tipus] || { label: m.tipus, icon: '?', cls: '' };
      const irany = m.tipus === 'atadas'
        ? `${locN(m.forrasHely)} → ${locN(m.celHely)}`
        : locN(m.forrasHely);
      return `<div style="border-bottom:1px solid var(--border);padding:8px 0 6px;">
        <div style="display:flex;align-items:flex-start;gap:10px;">
          <span style="font-size:20px;flex-shrink:0;">${meta.icon}</span>
          <div style="flex:1;min-width:0;">
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
              <span style="font-weight:600;font-size:13.5px;color:var(--text);">${esc(m.anyag)}</span>
              <span class="notice-meta-badge ${meta.cls}">${meta.label}</span>
              ${m.forrás === 'termelés' ? '<span style="font-size:11px;color:var(--green);font-weight:600;">🏭 belső</span>' : ''}
            </div>
            <div style="font-size:12px;color:var(--text3);margin-top:3px;">
              ${esc(m.datum)} · 📍 ${irany}
            </div>
            ${m.megjegyzes ? `<div style="font-size:12px;color:var(--text2);margin-top:2px;">${esc(m.megjegyzes)}</div>` : ''}
          </div>
          <div style="text-align:right;flex-shrink:0;">
            <span class="stock-badge-zsak">${m.zsakSzam || 0} db</span>
            ${m.mennyisegKg ? `<div style="font-size:11px;color:var(--text3);margin-top:3px;">${(m.mennyisegKg/1000).toFixed(2)} t</div>` : ''}
          </div>
          ${canManageStock() ? `<button class="btn btn-danger btn-xs mozg-del-btn" data-id="${m.id}" style="flex-shrink:0;">✕</button>` : ''}
        </div>
      </div>`;
    }).join('');

    div.querySelectorAll('.mozg-del-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Törlöd ezt a mozgást? A készlet frissülni fog.')) return;
        try {
          await deleteDoc(doc(db, 'stockMovements', btn.dataset.id));
          msg('Mozgás törölve.'); loadElozmenyek(); loadKeszlet();
        } catch (e) { msg('Hiba: ' + e.message, 'error'); }
      });
    });
  } catch (e) { msg('Betöltési hiba: ' + e.message, 'error'); }
}

/* ══════════════════════════════════════
   TAB VÁLTÁS + INIT
══════════════════════════════════════ */
export function switchKeszletTab(name) {
  document.querySelectorAll('#keszletSubtabs .stab-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.ksTab === name)
  );
  document.querySelectorAll('#tab-keszlet .kstab-panel').forEach(p => p.classList.remove('active'));
  E('ksTab-' + name)?.classList.add('active');

  if (name === 'sztkeszlet')    loadKeszlet();
  if (name === 'sztbevetelez')  { /* belső készlet csak kézzel nyílik */ }
  if (name === 'sztelozmenyek') loadElozmenyek();
  if (name === 'sztbeallitas')  renderLocations();
}

export async function initKeszletTab() {
  await loadLocations();
  loadKeszlet();
}
