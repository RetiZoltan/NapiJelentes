import { db, doc, getDoc, addDoc, updateDoc, deleteDoc, collection, query,
         where, getDocs, orderBy, onSnapshot, serverTimestamp } from './firebase.js';
import { state, isMainAdmin, hasPerm } from './state.js';
import { E, esc, msg, tod, fmtKg, emptyHtml } from './utils.js';
import { fetchEntries } from './db.js';

/* ── Jogosultság ── */
export function canViewStock()   { return isMainAdmin() || hasPerm('keszletMegtekintes') || hasPerm('keszletKezeles'); }
export function canManageStock() { return isMainAdmin() || hasPerm('keszletKezeles'); }

/* ── Belső állapot ── */
let _locations        = [];
let _importCache      = [];
let _mozgTipus        = 'atadas';
let _stockUnsubscribe = null;

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
      const bkey = `${m.anyag}|${m.forrasHely}`;
      if (!batches[bkey]) batches[bkey] = [];
      batches[bkey].push({ datum: m.datum || '', zsakSzam: m.zsakSulyok?.length || m.zsakSzam || 0, zsakSulyok: m.zsakSulyok || [], movId: d.id, entryId: null });
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
  if (celRow) celRow.style.display = (tipus === 'atadas' || tipus === 'betarolas') ? '' : 'none';
  const filters = E('mozgKeszletFilters');
  if (filters) filters.style.display = tipus === 'betarolas' ? 'none' : '';
  clearMozgSel();
  loadMozgasTab();
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

  const cel   = E('mozgCelHely')?.value || null;
  const datum = E('mozgDatum')?.value   || tod();
  const megj  = E('mozgMegjegyzes')?.value?.trim() || '';

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

    const labels = { atadas: 'Áttárolás rögzítve', kiszallitas: 'Kiszállítás rögzítve', selejt: 'Selejt rögzítve' };
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
        if (active === 'sztkeszlet')    loadKeszlet();
        if (active === 'sztmozgas')     loadMozgasTab();
        if (active === 'sztelozmenyek') loadElozmenyek();
      },
      err => console.warn('stock listener:', err.message)
    );
  } catch (e) { console.warn('stock subscription failed:', e.message); }
}

/* ══════════════════════════════════════
   TAB 3 — BEVÉTELEZÉS
══════════════════════════════════════ */
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
  if (name === 'sztmozgas')     loadMozgasTab();
  if (name === 'sztbevetelez')  { /* belső készlet csak kézzel nyílik */ }
  if (name === 'sztelozmenyek') loadElozmenyek();
  if (name === 'sztbeallitas')  renderLocations();
}

export async function initKeszletTab() {
  await loadLocations();
  loadKeszlet();
  _subscribeToStock();
}
