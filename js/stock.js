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
  const locOpts = _locations.map(l => `<option value="${l.id}">${esc(l.nev)}</option>`).join('');
  const allOpts = '<option value="">— Mind —</option>' + locOpts;
  const selOpts = '<option value="">— Válassz —</option>' + locOpts;
  ['keszletHelyF', 'elozHelyF'].forEach(id => {
    const el = E(id); if (!el) return;
    const prev = el.value; el.innerHTML = allOpts; if (prev) el.value = prev;
  });
  ['importHelyF', 'mozgForrasHely', 'mozgCelHely', 'bevHelyF'].forEach(id => {
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
   KÉSZLET SZÁMÍTÁS (belső helper)
══════════════════════════════════════ */
async function _calcStock(anyagF = '', helyF = '') {
  const snap = await getDocs(query(collection(db, 'stockMovements'), orderBy('createdAt', 'desc')));
  const stock = {};

  snap.docs.forEach(d => {
    const m    = { id: d.id, ...d.data() };
    const zsak = m.zsakSzam    || 0;
    const kg   = m.mennyisegKg || 0;

    const add = (anyag, hely, sign) => {
      const key = `${anyag}|${hely}`;
      if (!stock[key]) stock[key] = { anyag, hely, zsakSzam: 0, kg: 0, belso: false };
      stock[key].zsakSzam += sign * zsak;
      stock[key].kg       += sign * kg;
      if (m.forrás === 'termelés') stock[key].belso = true;
    };

    const t = m.tipus;
    if (t === 'bevitel')                                     add(m.anyag, m.forrasHely,  1);
    if (t === 'kiszallitas' || t === 'selejt' || t === 'kivitel') add(m.anyag, m.forrasHely, -1);
    if (t === 'atadas') {
      add(m.anyag, m.forrasHely, -1);
      if (m.celHely) add(m.anyag, m.celHely, 1);
    }
  });

  return Object.values(stock)
    .filter(s => s.zsakSzam > 0 || s.kg > 0)
    .filter(s => (!anyagF || s.anyag === anyagF) && (!helyF || s.hely === helyF))
    .sort((a, b) => b.zsakSzam - a.zsakSzam || a.anyag.localeCompare(b.anyag, 'hu'));
}

function _locName(locMap, id) {
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
      </tr></thead><tbody>`;

    stock.forEach(s => {
      h += `<tr>
        <td style="font-weight:600;color:var(--text);">${esc(s.anyag)}</td>
        <td style="color:var(--text2);">${_locName(locMap, s.hely)}</td>
        <td style="text-align:right;"><span class="stock-badge-zsak">${s.zsakSzam} db</span></td>
        <td style="text-align:right;">${s.kg > 0 ? fmtKg(s.kg) : '—'}</td>
        <td><span style="font-size:11px;font-weight:600;color:${s.belso ? 'var(--green)' : 'var(--text3)'};">${s.belso ? '🏭 belső' : '📥 külső'}</span></td>
      </tr>`;
    });

    h += `</tbody></table></div>`;
    div.innerHTML = h;
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
      stock.map(s => `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:1px solid var(--border);font-size:13px;">
          <span style="color:var(--text2);">${esc(s.anyag)} · <span style="color:var(--text3);">${_locName(locMap, s.hely)}</span></span>
          <span class="stock-badge-zsak">${s.zsakSzam} db</span>
        </div>`).join('');
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
   TAB 3 — BEVÉTELEZÉS
══════════════════════════════════════ */
export async function loadImportFromProduction() {
  const div   = E('importListDiv'); if (!div) return;
  const honap = E('importHonapF')?.value;
  if (!honap) { msg('Válassz hónapot!', 'error'); return; }

  div.innerHTML = '<div class="empty-st"><div class="spinner" style="margin:0 auto"></div></div>';
  if (E('importActionDiv')) E('importActionDiv').style.display = 'none';

  try {
    const importedSnap = await getDocs(
      query(collection(db, 'stockMovements'), where('forrás', '==', 'termelés'))
    );
    const importedRefs = new Set();
    importedSnap.docs.forEach(d => (d.data().termelesRef || []).forEach(id => importedRefs.add(id)));

    const [year, month] = honap.split('-').map(Number);
    const lastDay = new Date(year, month, 0).getDate();
    const allEntries = await fetchEntries({
      datumFrom: `${honap}-01`,
      datumTo:   `${honap}-${String(lastDay).padStart(2, '0')}`
    });

    const withZsak = allEntries.filter(e => e.zsakSulyok?.length > 0 && !importedRefs.has(e.id));
    _importCache   = withZsak;

    if (!withZsak.length) {
      div.innerHTML = emptyHtml('✅', 'Nincs importálandó adat', 'Minden adat importálva van, vagy nincs ilyen bejegyzés.');
      return;
    }

    const byAnyag = {};
    withZsak.forEach(e => {
      const mat = (e.anyag || '').trim() || '—';
      if (!byAnyag[mat]) byAnyag[mat] = [];
      byAnyag[mat].push(e);
    });

    let h = '';
    Object.entries(byAnyag).sort(([a],[b]) => a.localeCompare(b,'hu')).forEach(([mat, entries]) => {
      const totZsak = entries.reduce((s, e) => s + e.zsakSulyok.length, 0);
      const totKg   = entries.reduce((s, e) => s + e.zsakSulyok.reduce((x,v) => x+v, 0), 0);
      h += `<div style="margin-bottom:14px;">
        <div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:2px solid var(--accent);">
          <input type="checkbox" class="import-grp-chk" data-mat="${esc(mat)}" checked style="accent-color:var(--accent);">
          <strong style="font-size:14px;color:var(--text);">📦 ${esc(mat)}</strong>
          <span class="stock-badge-zsak" style="margin-left:auto;">${totZsak} db</span>
          <span style="font-size:12px;color:var(--text3);">${(totKg/1000).toFixed(2)} t</span>
        </div>
        ${entries.sort((a,b) => a.datum.localeCompare(b.datum)).map(e => {
          const zsak = e.zsakSulyok.length;
          const kg   = e.zsakSulyok.reduce((s,v) => s+v, 0);
          return `<div style="padding:6px 0 8px 20px;border-bottom:1px solid var(--border);">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:5px;">
              <input type="checkbox" class="import-entry-chk" data-id="${e.id}" data-mat="${esc(mat)}" checked style="accent-color:var(--accent);flex-shrink:0;">
              <span style="font-size:13px;color:var(--text);font-weight:600;">${esc(e.datum)}</span>
              <span style="font-size:12px;color:var(--text3);">${esc(e.nev)}</span>
              <span style="margin-left:auto;font-size:12px;color:var(--text2);">${zsak} zsák · ${(kg/1000).toFixed(2)} t</span>
            </div>
            <div class="stock-zsak-chips">${e.zsakSulyok.map(s => `<span class="stock-zsak-chip">${s.toFixed(0)} kg</span>`).join('')}</div>
          </div>`;
        }).join('')}
      </div>`;
    });

    div.innerHTML = h;
    if (E('importActionDiv')) E('importActionDiv').style.display = '';

    div.querySelectorAll('.import-grp-chk').forEach(grp => {
      grp.addEventListener('change', () => {
        div.querySelectorAll(`.import-entry-chk[data-mat="${grp.dataset.mat}"]`)
           .forEach(cb => { cb.checked = grp.checked; });
        _updateImportCount();
      });
    });
    div.querySelectorAll('.import-entry-chk').forEach(cb => cb.addEventListener('change', _updateImportCount));
    _updateImportCount();
  } catch (e) { msg('Betöltési hiba: ' + e.message, 'error'); }
}

function _updateImportCount() {
  const checked = document.querySelectorAll('.import-entry-chk:checked');
  const cnt = E('importCount');
  const btn = E('importMentBtn');
  if (cnt) cnt.textContent = checked.length > 0 ? `${checked.length} sor kijelölve` : '';
  if (btn) btn.disabled = checked.length === 0;
}

export async function executeImport() {
  const celHely = E('importHelyF')?.value;
  if (!celHely) { msg('Válassz cél helyszínt!', 'error'); return; }
  const checked = [...document.querySelectorAll('.import-entry-chk:checked')];
  if (!checked.length) { msg('Nincs kijelölt sor!', 'error'); return; }

  const byMat = {};
  checked.forEach(cb => {
    const e = _importCache.find(x => x.id === cb.dataset.id); if (!e) return;
    const mat = cb.dataset.mat;
    if (!byMat[mat]) byMat[mat] = { zsakSzam: 0, mennyisegKg: 0, refs: [], zsakSulyok: [] };
    byMat[mat].zsakSzam    += e.zsakSulyok.length;
    byMat[mat].mennyisegKg += e.zsakSulyok.reduce((s,v) => s+v, 0);
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

export async function saveBevetelez() {
  const anyag  = E('bevAnyag')?.value?.trim();
  const zsakSz = parseInt(E('bevZsakSzam')?.value, 10);
  const kg     = parseFloat(E('bevKg')?.value) || null;
  const hely   = E('bevHelyF')?.value;
  const datum  = E('bevDatum')?.value || tod();
  const megj   = E('bevMegjegyzes')?.value?.trim() || '';

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
      datum, megjegyzes: megj,
      forrás: 'manuális', termelesRef: [],
      createdBy: state.appUser.uid, createdAt: serverTimestamp()
    });
    msg('Bevételezés rögzítve!');
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
  if (name === 'sztmozgas')     _refreshMozgasKeszlet();
  if (name === 'sztelozmenyek') loadElozmenyek();
  if (name === 'sztbeallitas')  renderLocations();
}

export async function initKeszletTab() {
  await loadLocations();
  loadKeszlet();
}
