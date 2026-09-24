import { db, doc, getDoc, addDoc, updateDoc, deleteDoc, collection, query,
         where, getDocs, orderBy, limit, onSnapshot, serverTimestamp } from './firebase.js';
import { state, isMainAdmin, hasPerm } from './state.js';
import { E, esc, msg, tod, fmtKg, emptyHtml } from './utils.js';
import { fetchEntries, fillSel } from './db.js';
import { logAction } from './auditlog.js';

/* ── Jogosultság ── */
export function canViewStock()   { return isMainAdmin() || hasPerm('keszletMegtekintes') || hasPerm('keszletKezeles'); }
export function canManageStock() { return isMainAdmin() || hasPerm('keszletKezeles'); }

/* ── Belső állapot ── */
let _locations        = [];
let _importCache      = [];
let _mozgTipus        = 'atadas';
let _stockUnsubscribe = null;
let _users             = [];  // { uid, name } cache az előzmény-naplóhoz

const _TIPUS_LABEL = {
  bevitel:     '⬇️ Bevitel',
  atadas:      '↔️ Áttárolás',
  kiszallitas: '📤 Kiszállítás',
  selejt:      '🗑 Selejt',
  kivitel:     '📦 Kivitel',
  korrekcio:   '🧮 Leltári korrekció'
};
const _FORRAS_SUB = {
  'termelés':    '🏭 termelésből',
  'áttárolás':   '↔️ áttárolásból',
  'bevételezés': '📥 külső bevételezés',
  'leltár':      '🧮 leltárból'
};

async function _loadUsers() {
  if (_users.length) return;
  try {
    const snap = await getDocs(collection(db, 'users'));
    _users = snap.docs.map(d => ({ uid: d.id, name: d.data().displayName || d.data().email || 'Ismeretlen' }));
  } catch (e) { console.warn('stock _loadUsers failed:', e.message); }
}
function _userName(uid) { return _users.find(u => u.uid === uid)?.name || '—'; }

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
  const mozgHelyEl = E('mozgKeszletHelyF');
  if (mozgHelyEl) { const p = mozgHelyEl.value; mozgHelyEl.innerHTML = allOpts; if (p) mozgHelyEl.value = p; }

  ['mozgCelHely', 'leltarHely', 'bevetHely'].forEach(id => {
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
    const canEdit = canManageStock();
    // A helyszín végleges törlése csak főadminnak engedett a Firestore-szabályban
    // (a rá hivatkozó korábbi mozgások árván maradnának) — ezért a törlés gomb
    // csak neki jelenik meg, a szerkesztés viszont marad keszletKezeles jogúaknak is.
    div.innerHTML = all.map(l => `
      <div data-loc-id="${l.id}" style="padding:9px 0;border-bottom:1px solid var(--border);">
        <div class="loc-view" style="display:flex;align-items:center;gap:10px;">
          <label style="cursor:pointer;flex-shrink:0;" title="Szín beállítása">
            <input type="color" class="loc-color-inp" data-id="${l.id}" value="${l.szin || '#999999'}"
                   style="width:0;height:0;border:0;padding:0;position:absolute;opacity:0;">
            <span style="display:flex;width:26px;height:26px;border-radius:50%;background:${l.szin || 'var(--border)'};border:2px solid var(--border);"></span>
          </label>
          <div style="flex:1;">
            <div style="font-weight:600;font-size:13.5px;color:var(--text)${l.aktiv === false ? ';opacity:.45' : ''};">${esc(l.nev)}</div>
            ${l.leiras ? `<div style="font-size:12px;color:var(--text3);">${esc(l.leiras)}</div>` : ''}
          </div>
          ${canEdit ? `<button class="btn btn-ghost btn-xs loc-edit-btn" data-id="${l.id}">Szerkeszt</button>` : ''}
          ${isMainAdmin() ? `<button class="btn btn-danger btn-xs loc-del-btn" data-id="${l.id}" data-nev="${esc(l.nev)}">Töröl</button>` : ''}
        </div>
        <div class="loc-edit-form" style="display:none;gap:8px;flex-wrap:wrap;align-items:flex-end;padding-top:6px;">
          <input class="loc-edit-nev" type="text" value="${esc(l.nev)}" placeholder="Név" style="flex:1;min-width:120px;">
          <input class="loc-edit-leiras" type="text" value="${esc(l.leiras || '')}" placeholder="Leírás (opcionális)" style="flex:2;min-width:160px;">
          <button class="btn btn-primary btn-xs loc-save-btn" data-id="${l.id}">Ment</button>
          <button class="btn btn-ghost btn-xs loc-cancel-btn">Mégse</button>
        </div>
      </div>`).join('');

    div.querySelectorAll('.loc-edit-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const row = btn.closest('[data-loc-id]');
        row.querySelector('.loc-view').style.display = 'none';
        const form = row.querySelector('.loc-edit-form');
        form.style.display = 'flex';
        form.querySelector('.loc-edit-nev').focus();
      });
    });
    div.querySelectorAll('.loc-cancel-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const row = btn.closest('[data-loc-id]');
        row.querySelector('.loc-view').style.display = 'flex';
        row.querySelector('.loc-edit-form').style.display = 'none';
      });
    });
    div.querySelectorAll('.loc-save-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const row  = btn.closest('[data-loc-id]');
        const nev  = row.querySelector('.loc-edit-nev').value.trim();
        if (!nev) { msg('A név nem lehet üres!', 'error'); return; }
        const leiras = row.querySelector('.loc-edit-leiras').value.trim();
        try {
          await updateDoc(doc(db, 'stockLocations', btn.dataset.id), { nev, leiras });
          msg('Helyszín frissítve.');
          await loadLocations();
          renderLocations();
        } catch (e) { msg('Mentési hiba: ' + e.message, 'error'); }
      });
    });
    div.querySelectorAll('.loc-del-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Véglegesen törlöd ezt a helyszínt?')) return;
        try {
          await deleteDoc(doc(db, 'stockLocations', btn.dataset.id));
          logAction('stockLocation.delete', { nev: btn.dataset.nev || '—' });
          msg('Helyszín törölve.'); loadLocations(); renderLocations();
        } catch (e) { msg('Hiba: ' + e.message, 'error'); }
      });
    });
    div.querySelectorAll('.loc-color-inp').forEach(inp => {
      inp.addEventListener('change', async () => {
        try {
          await updateDoc(doc(db, 'stockLocations', inp.dataset.id), { szin: inp.value });
          inp.closest('label').querySelector('span').style.background = inp.value;
          await loadLocations();
        } catch (e) { msg('Szín mentési hiba: ' + e.message, 'error'); }
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
    if (t === 'bevitel' || t === 'korrekcio') {
      // A 'korrekcio' mennyisége már előjeles (leltári eltérés) — sign=1 elég.
      add(m.anyag, m.forrasHely, 1);
      if (zsak > 0) {
        const bkey = `${m.anyag}|${m.forrasHely}`;
        if (!batches[bkey]) batches[bkey] = [];
        batches[bkey].push({ datum: m.datum || '', zsakSzam: m.zsakSulyok?.length || zsak || 0, zsakSulyok: m.zsakSulyok || [], movId: d.id, entryId: null });
      }
    }
    if (!m.sourceUpdated) {
      if (t === 'kiszallitas' || t === 'selejt' || t === 'kivitel') add(m.anyag, m.forrasHely, -1);
      if (t === 'atadas') {
        add(m.anyag, m.forrasHely, -1);
        if (m.celHely) add(m.anyag, m.celHely, 1);
      }
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
      batches[key].push({ datum: e.datum || '', zsakSzam: e.zsakSulyok.length, zsakSulyok: e.zsakSulyok, movId: null, entryId: e.id });
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
  const loc = _locations.find(l => l.id === id);
  if (loc) {
    const dot = loc.szin
      ? `<span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${loc.szin};margin-right:5px;vertical-align:middle;flex-shrink:0;"></span>`
      : '';
    return dot + esc(loc.nev);
  }
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
      div.innerHTML = emptyHtml('📦', 'Nincs készlet', 'Tárolj be anyagot a termelésből a Mozgás fülön.');
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

    const mainAdm = isMainAdmin();

    h += `<div style="overflow-x:auto;"><table class="stock-table">
      <thead><tr>
        <th>Anyag</th>
        <th>Helyszín</th>
        <th style="text-align:right;">Zsák (db)</th>
        <th style="text-align:right;">Súly</th>
        <th>Forrás</th>
        ${mainAdm ? '<th style="width:26px;"></th>' : ''}
        <th style="width:22px;"></th>
      </tr></thead><tbody>`;

    const colCount = 6 + (mainAdm ? 1 : 0);
    stock.forEach((s, idx) => {
      const detId  = `kdet_${idx}`;
      const hasDet = s.batches.length > 0;
      const canDel = mainAdm && s.hely !== '_termelés_';
      h += `<tr class="${hasDet ? 'stock-row-clickable' : ''}" data-det="${hasDet ? detId : ''}">
        <td style="font-weight:600;color:var(--text);">${esc(s.anyag)}</td>
        <td style="color:var(--text2);">${_locName(locMap, s.hely)}</td>
        <td style="text-align:right;"><span class="stock-badge-zsak">${s.zsakSzam} db</span></td>
        <td style="text-align:right;">${s.kg > 0 ? fmtKg(s.kg) : '—'}</td>
        <td><span style="font-size:11px;font-weight:600;color:${s.belso ? 'var(--green)' : 'var(--text3)'};">${s.belso ? '🏭 belső' : '📥 külső'}</span></td>
        ${mainAdm ? `<td style="width:26px;text-align:center;">${canDel ? `<button class="btn btn-ghost btn-xs stock-tetel-del-btn" data-anyag="${esc(s.anyag)}" data-hely="${esc(s.hely)}" title="Készletsor törlése" style="color:var(--red);padding:2px 6px;">🗑</button>` : ''}</td>` : ''}
        <td style="width:22px;text-align:center;color:var(--text3);font-size:12px;">${hasDet ? '<span class="stock-det-arrow">▶</span>' : ''}</td>
      </tr>`;
      if (hasDet) {
        const allWeights = s.batches.flatMap(b => b.zsakSulyok);
        h += `<tr id="${detId}" class="stock-det-row" style="display:none;">
          <td colspan="${colCount}" style="padding:10px 14px;background:var(--surf2);">
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
    div.querySelectorAll('.stock-tetel-del-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        deleteKeszletTetel(btn.dataset.anyag, btn.dataset.hely);
      });
    });
  } catch (e) { msg('Készlet betöltési hiba: ' + e.message, 'error'); }
}

export async function deleteKeszletTetel(anyag, hely) {
  if (!isMainAdmin()) return;
  if (hely === '_termelés_') { msg('A termelésből még be nem tárolt zsákok a Bejegyzéseknél törölhetők.', 'error'); return; }
  if (!confirm(`Véglegesen törlöd a(z) "${anyag}" készletsort ezen a helyszínen? Az összes hozzá tartozó bevitel/korrekció rekord törlődik, nem vonható vissza.`)) return;

  try {
    const stock = await _calcStock(anyag, hely);
    const exact = stock.find(s => s.anyag === anyag && s.hely === hely);
    if (!exact || !exact.batches.length) { msg('Nincs törölhető rekord ehhez a tételhez.', 'error'); return; }

    for (const b of exact.batches) {
      if (b.movId) await deleteDoc(doc(db, 'stockMovements', b.movId));
    }

    logAction('stock.tetel_delete', {
      anyag, hely: _locations.find(l => l.id === hely)?.nev || hely,
      zsakSzam: exact.zsakSzam, kg: exact.kg
    });

    msg('Készletsor törölve.');
    loadKeszlet();
  } catch (e) { msg('Törlési hiba: ' + e.message, 'error'); }
}

/* ══════════════════════════════════════
   TAB 2 — ANYAGMOZGÁS
══════════════════════════════════════ */
export function onMozgTipusChange(tipus) {
  _mozgTipus = tipus;
  document.querySelectorAll('.mozg-tipus-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.tipus === tipus)
  );

  const isBevet      = tipus === 'bevetelezes';
  const browserCard  = E('mozgBrowserCard');
  const bevetCard    = E('bevetelezesCard');
  if (browserCard) browserCard.style.display = isBevet ? 'none' : '';
  if (bevetCard)   bevetCard.style.display   = isBevet ? '' : 'none';

  if (isBevet) {
    const actionCard = E('mozgActionCard');
    if (actionCard) actionCard.style.display = 'none';
    fillSel(E('bevetAnyag'), state.anyagok, '— Válassz —');
    if (E('bevetDatum') && !E('bevetDatum').value) E('bevetDatum').value = tod();
    return;
  }

  const celRow = E('mozgCelHelyRow');
  if (celRow) celRow.style.display = (tipus === 'atadas' || tipus === 'betarolas') ? '' : 'none';
  const filters = E('mozgKeszletFilters');
  if (filters) filters.style.display = tipus === 'betarolas' ? 'none' : '';
  clearMozgSel();
  loadMozgasTab();
}

export async function saveBevetelezes() {
  const anyag = E('bevetAnyag')?.value;
  const hely  = E('bevetHely')?.value;
  if (!anyag || !hely) { msg('Válassz anyagot és célhelyszínt!', 'error'); return; }

  const dbRaw = E('bevetDb')?.value;
  const db_   = parseInt(dbRaw);
  if (dbRaw === '' || !Number.isFinite(db_) || db_ <= 0) { msg('Add meg a zsákszámot!', 'error'); return; }
  const kgRaw = E('bevetKg')?.value;
  const kg    = kgRaw !== '' ? parseFloat(kgRaw) : null;
  const datum = E('bevetDatum')?.value || tod();
  const szallito = E('bevetSzallito')?.value?.trim() || '';
  const megjIn   = E('bevetMegjegyzes')?.value?.trim() || '';
  const megj = szallito ? `Beszállító: ${szallito}${megjIn ? ' — ' + megjIn : ''}` : megjIn;

  try {
    await addDoc(collection(db, 'stockMovements'), {
      tipus: 'bevitel', anyag, forrasHely: hely, celHely: null,
      zsakSzam:    db_,
      mennyisegKg: kg !== null ? parseFloat(kg.toFixed(2)) : null,
      zsakSulyok:  [], datum, megjegyzes: megj,
      forrás: 'bevételezés', termelesRef: [],
      createdBy: state.appUser.uid, createdAt: serverTimestamp()
    });

    logAction('stock.bevetelezes', {
      anyag, hely: _locations.find(l => l.id === hely)?.nev || hely,
      zsakSzam: db_, kg, szallito
    });

    msg(`Bevételezve: ${db_} db ${anyag}.`);
    ['bevetDb', 'bevetKg', 'bevetSzallito', 'bevetMegjegyzes'].forEach(id => { if (E(id)) E(id).value = ''; });
    loadKeszlet();
  } catch (e) { msg('Mentési hiba: ' + e.message, 'error'); }
}

export async function loadMozgasTab() {
  const div = E('mozgKeszletDiv'); if (!div) return;
  div.innerHTML = '<div class="empty-st"><div class="spinner" style="margin:0 auto"></div></div>';
  _mozgUpdatePanel();
  try {
    if (_mozgTipus === 'betarolas') { await _renderBetarolasChips(div); return; }

    const anyagF = E('mozgKeszletAnyagF')?.value || '';
    const helyF  = E('mozgKeszletHelyF')?.value  || '';
    const stock  = await _calcStock(anyagF, helyF);
    const locMap = Object.fromEntries(_locations.map(l => [l.id, l.nev]));
    const filtered = stock.filter(s => s.hely !== '_termelés_');

    if (!filtered.length) {
      div.innerHTML = emptyHtml('📦', 'Nincs készlet', 'Nincs megjeleníthető tétel.');
      return;
    }

    let h = '';
    filtered.forEach((s, gi) => {
      const grp        = `g${gi}`;
      const locLabel   = _locName(locMap, s.hely);
      const totalKgTxt = s.kg > 0 ? ` · ${fmtKg(s.kg)}` : '';

      const chips = s.batches.flatMap(b => {
        const mid = b.movId || '', eid = b.entryId || '';
        if (b.zsakSulyok?.length) {
          return b.zsakSulyok.map(w =>
            `<span class="stock-zsak-chip mozg-stock-chip" style="cursor:pointer;"
              data-movid="${mid}" data-entryid="${eid}" data-suly="${w}"
              data-anyag="${esc(s.anyag)}" data-hely="${esc(s.hely)}"
              data-count="1" data-hasweight="1" data-grp="${grp}">${w.toFixed(0)} kg</span>`
          );
        } else if (b.zsakSzam > 0) {
          return [`<span class="stock-zsak-chip mozg-stock-chip mozg-chip-noweight" style="cursor:pointer;opacity:.8;"
            data-movid="${mid}" data-entryid="${eid}" data-suly="0"
            data-anyag="${esc(s.anyag)}" data-hely="${esc(s.hely)}"
            data-count="${b.zsakSzam}" data-hasweight="0" data-grp="${grp}">${b.zsakSzam} db</span>`];
        }
        return [];
      });

      if (!chips.length) return;
      h += `<div style="margin-bottom:14px;padding-bottom:12px;border-bottom:1px solid var(--border);">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap;">
          <span style="font-weight:700;font-size:13.5px;color:var(--text);">${esc(s.anyag)}</span>
          <span style="font-size:12px;color:var(--text3);">📍 ${locLabel}</span>
          <span class="stock-badge-zsak" style="margin-left:auto;">${s.zsakSzam} db${totalKgTxt}</span>
          <button class="btn btn-ghost btn-xs mozg-selall-btn" data-grp="${grp}" type="button">Mindet</button>
        </div>
        <div class="stock-zsak-chips">${chips.join('')}</div>
      </div>`;
    });

    div.innerHTML = h || emptyHtml('📦', 'Nincs megjelenítendő tétel', '');
    _attachMozgListeners(div);
    _mozgUpdatePanel();
  } catch (e) { msg('Betöltési hiba: ' + e.message, 'error'); }
}

async function _renderBetarolasChips(div) {
  try {
    const impSnap = await getDocs(query(collection(db, 'stockMovements'), where('forrás', '==', 'termelés')));
    const importedRefs = new Set();
    impSnap.docs.forEach(d => (d.data().termelesRef || []).forEach(id => importedRefs.add(id)));

    const allEntries = await fetchEntries({});
    const withZsak   = allEntries.filter(e => e.zsakSulyok?.length > 0 && !importedRefs.has(e.id));

    if (!withZsak.length) {
      div.innerHTML = emptyHtml('✅', 'Nincs betárolatlan belső készlet', 'Minden termelési zsák már be van tárolva.');
      return;
    }

    const byAnyag = {};
    withZsak.forEach(e => { const mat = (e.anyag || '').trim() || '—'; if (!byAnyag[mat]) byAnyag[mat] = []; byAnyag[mat].push(e); });

    let h = '';
    Object.entries(byAnyag).sort(([a],[b]) => a.localeCompare(b,'hu')).forEach(([mat, entries], gi) => {
      const grp        = `prod${gi}`;
      const allWeights = entries.flatMap(e => e.zsakSulyok);
      h += `<div style="margin-bottom:14px;padding-bottom:12px;border-bottom:1px solid var(--border);">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap;">
          <span style="font-weight:700;font-size:13.5px;color:var(--text);">🏭 ${esc(mat)}</span>
          <span class="stock-badge-zsak" style="margin-left:auto;">${allWeights.length} db</span>
          <button class="btn btn-ghost btn-xs mozg-selall-btn" data-grp="${grp}" type="button">Mindet</button>
        </div>
        <div class="stock-zsak-chips">
          ${allWeights.map((w, idx) => {
            let eid = '', cumul = 0;
            for (const e of entries) { if (idx < cumul + e.zsakSulyok.length) { eid = e.id; break; } cumul += e.zsakSulyok.length; }
            return `<span class="stock-zsak-chip mozg-stock-chip" style="cursor:pointer;"
              data-movid="" data-entryid="${eid}" data-suly="${w}"
              data-anyag="${esc(mat)}" data-hely="_termelés_"
              data-count="1" data-hasweight="1" data-grp="${grp}">${w.toFixed(0)} kg</span>`;
          }).join('')}
        </div>
      </div>`;
    });

    div.innerHTML = h;
    _attachMozgListeners(div);
    _mozgUpdatePanel();
  } catch (e) { msg('Betöltési hiba: ' + e.message, 'error'); }
}

function _attachMozgListeners(div) {
  div.querySelectorAll('.mozg-stock-chip').forEach(chip => {
    chip.addEventListener('click', () => { chip.classList.toggle('selected'); _mozgUpdatePanel(); });
  });
  div.querySelectorAll('.mozg-selall-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const grpChips = [...div.querySelectorAll(`.mozg-stock-chip[data-grp="${btn.dataset.grp}"]`)];
      const allSel   = grpChips.every(c => c.classList.contains('selected'));
      grpChips.forEach(c => c.classList.toggle('selected', !allSel));
      _mozgUpdatePanel();
    });
  });
}

function _mozgUpdatePanel() {
  const selected = [...document.querySelectorAll('.mozg-stock-chip.selected')];
  const card     = E('mozgActionCard');
  if (!card) return;
  if (!selected.length) { card.style.display = 'none'; return; }
  card.style.display = '';

  let totalCount = 0, totalKg = 0;
  selected.forEach(c => {
    totalCount += parseInt(c.dataset.count || 1);
    const suly = parseFloat(c.dataset.suly || 0);
    if (suly > 0) totalKg += suly;
  });

  const infoEl  = E('mozgSelInfo');
  const delBtn  = E('mozgDelBtn');
  const saveBtn = E('mozgSaveBtn');
  if (infoEl)  infoEl.innerHTML     = `${totalCount} zsák kijelölve${totalKg > 0 ? ` · ${fmtKg(totalKg)}` : ''}`;
  if (delBtn)  delBtn.style.display = _mozgTipus === 'betarolas' ? 'none' : '';
  if (saveBtn) saveBtn.textContent  = _mozgTipus === 'betarolas' ? '⬇️ Betárol' : '✓ Rögzít';
}

export function clearMozgSel() {
  document.querySelectorAll('.mozg-stock-chip.selected').forEach(c => c.classList.remove('selected'));
  _mozgUpdatePanel();
}

export async function saveMozgas() {
  if (_mozgTipus === 'betarolas') { await _saveBetarolas(); return; }

  const selected = [...document.querySelectorAll('.mozg-stock-chip.selected')];
  if (!selected.length) { msg('Jelölj ki zsákokat!', 'error'); return; }

  const cel   = E('mozgCelHely')?.value             || null;
  const datum = E('mozgDatum')?.value               || tod();
  const megj  = E('mozgMegjegyzes')?.value?.trim()  || '';

  if (_mozgTipus === 'atadas' && !cel) { msg('Válassz cél helyszínt!', 'error'); return; }

  // Csoportosítás anyag|forrásHely szerint (mozgás rekordhoz)
  const byAnyagHely = {};
  // Csoportosítás movId szerint (forrás dok frissítéséhez)
  const byMovId = {};

  selected.forEach(chip => {
    const movId = chip.dataset.movid;
    const anyag = chip.dataset.anyag;
    const hely  = chip.dataset.hely;
    const suly  = parseFloat(chip.dataset.suly || 0);
    const cnt   = parseInt(chip.dataset.count || 1);
    const hasW  = chip.dataset.hasweight === '1';

    const aKey = `${anyag}|${hely}`;
    if (!byAnyagHely[aKey]) byAnyagHely[aKey] = { anyag, hely, sulyok: [], count: 0 };
    if (suly > 0) byAnyagHely[aKey].sulyok.push(suly);
    byAnyagHely[aKey].count += cnt;

    if (movId) {
      if (!byMovId[movId]) byMovId[movId] = { sulyok: [], countNoWeight: 0 };
      if (hasW) byMovId[movId].sulyok.push(suly);
      else byMovId[movId].countNoWeight += cnt;
    }
  });

  for (const { hely } of Object.values(byAnyagHely)) {
    if (_mozgTipus === 'atadas' && hely === cel) { msg('Forrás és cél nem lehet ugyanaz!', 'error'); return; }
  }

  try {
    // 1. Forrás bevitel dokumentumok frissítése/törlése
    for (const [movId, data] of Object.entries(byMovId)) {
      const ref  = doc(db, 'stockMovements', movId);
      const snap = await getDoc(ref);
      if (!snap.exists()) continue;
      const d = snap.data();
      if (d.zsakSulyok?.length && data.sulyok.length) {
        let remaining = [...d.zsakSulyok];
        for (const suly of data.sulyok) {
          const idx = remaining.indexOf(suly);
          if (idx > -1) remaining.splice(idx, 1);
        }
        if (remaining.length === 0) {
          await deleteDoc(ref);
        } else {
          await updateDoc(ref, {
            zsakSulyok:  remaining,
            zsakSzam:    remaining.length,
            mennyisegKg: parseFloat(remaining.reduce((s, v) => s + v, 0).toFixed(2))
          });
        }
      } else if (data.countNoWeight > 0) {
        const newCount = (d.zsakSzam || 0) - data.countNoWeight;
        if (newCount <= 0) await deleteDoc(ref);
        else await updateDoc(ref, { zsakSzam: newCount });
      }
    }

    // 2. Mozgás rekord(ok) létrehozása (sourceUpdated: true → _calcStock nem vonja le újra)
    for (const { anyag, hely, sulyok, count } of Object.values(byAnyagHely)) {
      await addDoc(collection(db, 'stockMovements'), {
        tipus:       _mozgTipus,
        anyag,
        forrasHely:  hely,
        celHely:     _mozgTipus === 'atadas' ? cel : null,
        zsakSzam:    count,
        mennyisegKg: sulyok.length ? parseFloat(sulyok.reduce((s, v) => s + v, 0).toFixed(2)) : null,
        zsakSulyok:  sulyok,
        datum, megjegyzes: megj,
        forrás: 'manuális', termelesRef: [],
        sourceUpdated: true,
        createdBy: state.appUser.uid, createdAt: serverTimestamp()
      });
    }

    // 3. Áttárolás: új bevitel a cél helyszínen
    if (_mozgTipus === 'atadas' && cel) {
      for (const { anyag, sulyok, count } of Object.values(byAnyagHely)) {
        await addDoc(collection(db, 'stockMovements'), {
          tipus:       'bevitel',
          anyag,
          forrasHely:  cel,
          celHely:     null,
          zsakSzam:    count,
          mennyisegKg: sulyok.length ? parseFloat(sulyok.reduce((s, v) => s + v, 0).toFixed(2)) : null,
          zsakSulyok:  sulyok,
          datum, megjegyzes: megj,
          forrás: 'áttárolás', termelesRef: [],
          createdBy: state.appUser.uid, createdAt: serverTimestamp()
        });
      }
    }

    const labels = { atadas: 'Áttárolás rögzítve' };
    msg(labels[_mozgTipus] || 'Rögzítve');
    if (E('mozgMegjegyzes')) E('mozgMegjegyzes').value = '';
    await loadMozgasTab();
    loadKeszlet();
  } catch (e) { msg('Mentési hiba: ' + e.message, 'error'); }
}

export async function deleteSelectedBags() {
  const selected   = [...document.querySelectorAll('.mozg-stock-chip.selected')];
  const stockChips = selected.filter(c => c.dataset.movid);
  if (!stockChips.length) { msg('Nincs törölhető tétel kijelölve.', 'error'); return; }

  const totalCount = stockChips.reduce((s, c) => s + parseInt(c.dataset.count || 1), 0);
  if (!confirm(`Véglegesen törlöd a kijelölt ${totalCount} zsákot? Ez nem vonható vissza.`)) return;

  // Csoportosítás movId szerint
  const byMovId = {};
  stockChips.forEach(chip => {
    const movId   = chip.dataset.movid;
    const suly    = parseFloat(chip.dataset.suly || 0);
    const noWt    = chip.dataset.hasweight === '0';
    if (!byMovId[movId]) byMovId[movId] = { sulyok: [], deleteAll: false };
    if (noWt) byMovId[movId].deleteAll = true;
    else byMovId[movId].sulyok.push(suly);
  });

  try {
    for (const [movId, data] of Object.entries(byMovId)) {
      const ref  = doc(db, 'stockMovements', movId);
      const snap = await getDoc(ref);
      if (!snap.exists()) continue;
      const d = snap.data();

      if (data.deleteAll) {
        await deleteDoc(ref);
      } else if (d.zsakSulyok?.length) {
        let remaining = [...d.zsakSulyok];
        for (const suly of data.sulyok) {
          const idx = remaining.indexOf(suly);
          if (idx > -1) remaining.splice(idx, 1);
        }
        if (remaining.length === 0) {
          await deleteDoc(ref);
        } else {
          await updateDoc(ref, {
            zsakSulyok:  remaining,
            zsakSzam:    remaining.length,
            mennyisegKg: parseFloat(remaining.reduce((s, v) => s + v, 0).toFixed(2))
          });
        }
      } else {
        await deleteDoc(ref);
      }
    }
    msg(`${totalCount} zsák törölve.`);
    await loadMozgasTab();
    loadKeszlet();
  } catch (e) { msg('Törlési hiba: ' + e.message, 'error'); }
}

async function _saveBetarolas() {
  const celHely  = E('mozgCelHely')?.value;
  if (!celHely) { msg('Válassz cél helyszínt!', 'error'); return; }
  const selected = [...document.querySelectorAll('.mozg-stock-chip.selected')];
  if (!selected.length) { msg('Jelölj ki zsákokat!', 'error'); return; }

  const byAnyag = {};
  selected.forEach(chip => {
    const mat = chip.dataset.anyag;
    if (!byAnyag[mat]) byAnyag[mat] = { sulyok: [], refs: new Set() };
    byAnyag[mat].sulyok.push(parseFloat(chip.dataset.suly));
    if (chip.dataset.entryid) byAnyag[mat].refs.add(chip.dataset.entryid);
  });

  try {
    for (const [mat, data] of Object.entries(byAnyag)) {
      await addDoc(collection(db, 'stockMovements'), {
        tipus:       'bevitel',
        anyag:       mat,
        forrasHely:  celHely,
        celHely:     null,
        zsakSzam:    data.sulyok.length,
        mennyisegKg: parseFloat(data.sulyok.reduce((s, v) => s + v, 0).toFixed(2)),
        zsakSulyok:  data.sulyok,
        datum:       tod(),
        megjegyzes:  'Termelésből betárolva',
        forrás:      'termelés',
        termelesRef: [...data.refs],
        createdBy:   state.appUser.uid, createdAt: serverTimestamp()
      });
    }
    msg(`✅ ${selected.length} zsák betárolva.`);
    await loadMozgasTab();
    loadKeszlet();
  } catch (e) { msg('Mentési hiba: ' + e.message, 'error'); }
}

function _subscribeToStock() {
  if (_stockUnsubscribe) _stockUnsubscribe();
  try {
    _stockUnsubscribe = onSnapshot(
      collection(db, 'stockMovements'),
      () => {
        const active = document.querySelector('#keszletSubtabs .stab-btn.active')?.dataset.ksTab;
        if (active === 'sztkeszlet') loadKeszlet();
        if (active === 'sztmozgas')  loadMozgasTab();
      },
      err => console.warn('stock listener:', err.message)
    );
  } catch (e) { console.warn('stock subscription failed:', e.message); }
}

/* ══════════════════════════════════════
   TAB — MOZGÁS-ELŐZMÉNYEK (napló)
══════════════════════════════════════ */
export async function loadElozmenyek() {
  const div = E('elozmenyDiv'); if (!div) return;
  div.innerHTML = '<div class="empty-st"><div class="spinner" style="margin:0 auto"></div></div>';
  try {
    await _loadUsers();
    const snap = await getDocs(query(collection(db, 'stockMovements'), orderBy('createdAt', 'desc'), limit(500)));
    let rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    const anyagF  = (E('elozmenyAnyagF')?.value || '').toLowerCase();
    const helyF   = E('elozmenyHelyF')?.value  || '';
    const tipusF  = E('elozmenyTipusF')?.value || '';
    const datumTol = E('elozmenyDatumTol')?.value || '';
    const datumIg  = E('elozmenyDatumIg')?.value  || '';

    rows = rows.filter(m =>
      (!anyagF   || (m.anyag || '').toLowerCase().includes(anyagF)) &&
      (!helyF    || m.forrasHely === helyF || m.celHely === helyF) &&
      (!tipusF   || m.tipus === tipusF) &&
      (!datumTol || (m.datum || '') >= datumTol) &&
      (!datumIg  || (m.datum || '') <= datumIg)
    );

    if (!rows.length) {
      div.innerHTML = emptyHtml('🕘', 'Nincs a szűrésnek megfelelő mozgás', '');
      return;
    }

    const locMap  = Object.fromEntries(_locations.map(l => [l.id, l.nev]));
    const helyTxt = id => id ? _locName(locMap, id) : '—';
    const mainAdm = isMainAdmin();

    let h = `<div style="overflow-x:auto;"><table class="stock-table">
      <thead><tr>
        <th>Dátum</th><th>Típus</th><th>Anyag</th><th>Helyszín</th>
        <th style="text-align:right;">Zsák</th><th style="text-align:right;">Súly</th>
        <th>Rögzítette</th><th>Megjegyzés</th>
        ${mainAdm ? '<th style="width:26px;"></th>' : ''}
      </tr></thead><tbody>`;

    rows.forEach(m => {
      const isKorr  = m.tipus === 'korrekcio';
      const zsak    = m.zsakSzam || 0;
      const zsakTxt = isKorr ? `${zsak > 0 ? '+' : ''}${zsak} db` : `${zsak} db`;
      const kgTxt   = m.mennyisegKg != null
        ? (isKorr ? `${m.mennyisegKg > 0 ? '+' : ''}${m.mennyisegKg} kg` : fmtKg(m.mennyisegKg))
        : '—';
      const helySor = m.tipus === 'atadas' && m.celHely
        ? `${helyTxt(m.forrasHely)} → ${helyTxt(m.celHely)}`
        : helyTxt(m.forrasHely);
      const forrasSub = m.tipus === 'bevitel' && _FORRAS_SUB[m.forrás]
        ? `<br><span style="font-size:10.5px;font-weight:500;color:var(--text3);">${esc(_FORRAS_SUB[m.forrás])}</span>` : '';
      h += `<tr>
        <td style="white-space:nowrap;color:var(--text2);">${esc(m.datum || '—')}</td>
        <td style="white-space:nowrap;font-weight:600;color:var(--text);">${_TIPUS_LABEL[m.tipus] || esc(m.tipus || '—')}${forrasSub}</td>
        <td style="font-weight:600;color:var(--text);">${esc(m.anyag || '—')}</td>
        <td style="color:var(--text2);">${helySor}</td>
        <td style="text-align:right;"><span class="stock-badge-zsak">${zsakTxt}</span></td>
        <td style="text-align:right;color:var(--text2);">${kgTxt}</td>
        <td style="color:var(--text3);font-size:12px;">${esc(_userName(m.createdBy))}</td>
        <td style="color:var(--text3);font-size:12px;">${esc(m.megjegyzes || '—')}</td>
        ${mainAdm ? `<td style="width:26px;text-align:center;"><button class="btn btn-ghost btn-xs elozmeny-del-btn" data-id="${m.id}" title="Mozgás törlése" style="color:var(--red);padding:2px 6px;">🗑</button></td>` : ''}
      </tr>`;
    });

    h += `</tbody></table></div>`;
    div.innerHTML = h;

    div.querySelectorAll('.elozmeny-del-btn').forEach(btn => {
      btn.addEventListener('click', () => deleteElozmenyTetel(btn.dataset.id));
    });
  } catch (e) { msg('Előzmények betöltési hiba: ' + e.message, 'error'); }
}

export async function deleteElozmenyTetel(movId) {
  if (!isMainAdmin() || !movId) return;
  if (!confirm('Véglegesen törlöd ezt a mozgásrekordot? Ez csak a naplóbejegyzést törli, a készletszámítást nem korrigálja vissza automatikusan — ha a mennyiséget is helyre kell állítani, használd a Leltár fület.')) return;
  try {
    const ref  = doc(db, 'stockMovements', movId);
    const snap = await getDoc(ref);
    const d    = snap.exists() ? snap.data() : {};
    await deleteDoc(ref);
    logAction('stock.movement_delete', { anyag: d.anyag || '—', tipus: d.tipus || '—', datum: d.datum || '—' });
    msg('Mozgás törölve.');
    await loadElozmenyek();
    loadKeszlet();
  } catch (e) { msg('Törlési hiba: ' + e.message, 'error'); }
}

/* ══════════════════════════════════════
   TAB — LELTÁR / KÉSZLETEGYEZTETÉS
══════════════════════════════════════ */
export async function onLeltarSelChange() {
  const anyag = E('leltarAnyag')?.value;
  const hely  = E('leltarHely')?.value;
  const box   = E('leltarJelenlegi');
  if (!box) return;
  if (!anyag || !hely) { box.style.display = 'none'; return; }

  const stock = await _calcStock(anyag, hely);
  const exact = stock.find(s => s.anyag === anyag && s.hely === hely);
  const db_   = exact?.zsakSzam || 0;
  const kg_   = exact?.kg || 0;

  box.style.display = '';
  box.innerHTML = `Jelenleg nyilvántartva: <strong>${db_} db</strong>${kg_ > 0 ? ` · <strong>${fmtKg(kg_)}</strong>` : ''}`;
  if (E('leltarDb')) E('leltarDb').value = db_;
  if (E('leltarKg')) E('leltarKg').value = kg_ > 0 ? kg_.toFixed(1) : '';
}

export async function saveLeltarKorrekcio() {
  const anyag = E('leltarAnyag')?.value;
  const hely  = E('leltarHely')?.value;
  if (!anyag || !hely) { msg('Válassz anyagot és helyszínt!', 'error'); return; }

  const ujDbRaw = E('leltarDb')?.value;
  const ujDb    = parseInt(ujDbRaw);
  if (ujDbRaw === '' || !Number.isFinite(ujDb) || ujDb < 0) { msg('Add meg a valós zsákszámot!', 'error'); return; }
  const ujKgRaw = E('leltarKg')?.value;
  const ujKg    = ujKgRaw !== '' ? parseFloat(ujKgRaw) : null;
  const megj    = E('leltarMegj')?.value?.trim() || '';

  try {
    const stock = await _calcStock(anyag, hely);
    const exact = stock.find(s => s.anyag === anyag && s.hely === hely);
    const regiDb = exact?.zsakSzam || 0;
    const regiKg = exact?.kg || 0;

    const deltaDb = ujDb - regiDb;
    if (deltaDb === 0) { msg('Nincs eltérés a zsákszámban, nincs mit korrigálni.', 'error'); return; }
    const deltaKg = ujKg !== null ? ujKg - regiKg : null;

    await addDoc(collection(db, 'stockMovements'), {
      tipus: 'korrekcio', anyag, forrasHely: hely, celHely: null,
      zsakSzam:    deltaDb,
      mennyisegKg: deltaKg !== null ? parseFloat(deltaKg.toFixed(2)) : null,
      zsakSulyok:  [], datum: tod(), megjegyzes: megj,
      forrás: 'leltár', termelesRef: [],
      createdBy: state.appUser.uid, createdAt: serverTimestamp()
    });

    logAction('stock.korrekcio', {
      anyag, hely: _locations.find(l => l.id === hely)?.nev || hely,
      regiDb, ujDb, elteres: deltaDb
    });

    msg(`Korrekció rögzítve (${deltaDb > 0 ? '+' : ''}${deltaDb} db).`);
    if (E('leltarMegj')) E('leltarMegj').value = '';
    await onLeltarSelChange();
    loadKeszlet();
  } catch (e) { msg('Mentési hiba: ' + e.message, 'error'); }
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

  if (name === 'sztkeszlet')   loadKeszlet();
  if (name === 'sztmozgas')    loadMozgasTab();
  if (name === 'sztbeallitas') renderLocations();
  if (name === 'sztelozmeny')  loadElozmenyek();
  if (name === 'sztleltar')    { fillSel(E('leltarAnyag'), state.anyagok, '— Válassz —'); onLeltarSelChange(); }
}

export async function initKeszletTab() {
  await loadLocations();
  loadKeszlet();
  _subscribeToStock();
}

