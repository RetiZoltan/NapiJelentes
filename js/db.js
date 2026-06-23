import { db, doc, getDoc, setDoc, deleteDoc, collection, query,
         where, getDocs, orderBy, serverTimestamp } from './firebase.js';
import { state, canSeeAllReports } from './state.js';
import { E, esc, msg, ag } from './utils.js';

export async function loadLists() {
  try {
    const s = await getDoc(doc(db, 'config', 'lists'));
    if (s.exists()) {
      state.nevek            = s.data().nevek            || [];
      state.anyagok          = s.data().anyagok          || [];
      state.reszlegek        = s.data().reszlegek        || [];
      state.anyagCsoportok   = s.data().csoportok        || [];
      state.anyagCsoportMap  = s.data().anyagCsoportMap  || {};
      state.reszlegAnyagMap  = s.data().reszlegAnyagMap  || {};
      state.nevMetadata      = s.data().nevMetadata      || {};
    }
    refreshListUI();
  } catch { msg('Lista betöltési hiba', 'error'); }
}

export async function saveLists() {
  const anyagSet   = new Set(state.anyagok);
  const csoportSet = new Set(state.anyagCsoportok);
  const reszlegSet = new Set(state.reszlegek);

  const cleanCsMap = {};
  Object.entries(state.anyagCsoportMap).forEach(([a, cs]) => {
    if (anyagSet.has(a) && csoportSet.has(cs)) cleanCsMap[a] = cs;
  });
  state.anyagCsoportMap = cleanCsMap;

  const cleanRaMap = {};
  Object.entries(state.reszlegAnyagMap).forEach(([r, mats]) => {
    if (!reszlegSet.has(r)) return;
    const valid = mats.filter(a => anyagSet.has(a));
    if (valid.length) cleanRaMap[r] = valid;
  });
  state.reszlegAnyagMap = cleanRaMap;

  const nevSet = new Set(state.nevek);
  const cleanNevMeta = {};
  state.nevek.forEach(n => { if (state.nevMetadata[n]) cleanNevMeta[n] = { ...state.nevMetadata[n] }; });
  state.nevMetadata = cleanNevMeta;

  try {
    await setDoc(doc(db, 'config', 'lists'), {
      nevek: state.nevek, anyagok: state.anyagok, reszlegek: state.reszlegek,
      csoportok: state.anyagCsoportok, anyagCsoportMap: cleanCsMap,
      reszlegAnyagMap: cleanRaMap, nevMetadata: cleanNevMeta,
    });
  } catch { msg('Lista mentési hiba', 'error'); }
}

export function refreshListUI() {
  const srt = l => [...l].sort((a, b) => a.localeCompare(b, 'hu'));
  E('reszlegDL').innerHTML = srt(state.reszlegek).map(r => `<option value="${esc(r)}"></option>`).join('');
  const activeNev = state.nevek.filter(n => !state.nevMetadata[n]?.archivalt);
  fillSel(E('nev'),    activeNev,        '— Válassz dolgozót —');
  fillSel(E('reszleg'), state.reszlegek, '— Válassz részleget —');
  fillSelGrouped(E('anyag'), state.anyagok, '— Válassz anyagot —');
  fillNevListaAdmin();
  fillSel(E('anyagLista'),     state.anyagok);
  fillSel(E('reszlegLista'),   state.reszlegek);
  fillSel(E('csoportLista'),   state.anyagCsoportok);
  renderCsoportMapUI();
  renderReszlegAnyagMapUI();
  renderNevMetaUI();
  updDolgSzuro();
  updReszlegSzuro();
  updIdoszakosFilters();
}

export async function getWorkerMaterials(workerName) {
  try {
    const snap = await getDocs(query(collection(db, 'entries'), where('nev', '==', workerName)));
    return [...new Set(snap.docs.map(d => d.data().anyag).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, 'hu'));
  } catch { return []; }
}

export function updIdoszakosFilters() {
  const srt = l => [...l].sort((a, b) => a.localeCompare(b, 'hu'));
  const dEl = E('idoszakosDolgozoSzuro');
  if (dEl) {
    const prev = dEl.value;
    dEl.innerHTML = '<option value="">— Mindenki —</option>' +
      srt(state.nevek).map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join('');
    if (prev) dEl.value = prev;
  }
  fillSelGrouped(E('idoszakosAnyagSzuro'), state.anyagok, '— Mind —');
}

export function fillSel(sel, list, emptyLabel = '') {
  if (!sel) return;
  const prev = Array.from(sel.selectedOptions).map(o => o.value);
  sel.innerHTML = '';
  if (emptyLabel) {
    const o = document.createElement('option');
    o.value = ''; o.textContent = emptyLabel;
    sel.appendChild(o);
  }
  [...list].sort((a, b) => a.localeCompare(b, 'hu')).forEach(item => {
    const o = document.createElement('option');
    o.value = o.textContent = item;
    if (prev.includes(item)) o.selected = true;
    sel.appendChild(o);
  });
}

export function fillSelGrouped(sel, anyagok, emptyLabel = '') {
  if (!sel) return;
  const prev = sel.value;
  sel.innerHTML = '';
  if (emptyLabel) {
    const o = document.createElement('option');
    o.value = ''; o.textContent = emptyLabel;
    sel.appendChild(o);
  }
  const srt      = l => [...l].sort((a, b) => a.localeCompare(b, 'hu'));
  const map      = state.anyagCsoportMap;
  const csoportok = srt(state.anyagCsoportok);
  if (!csoportok.length) {
    srt(anyagok).forEach(a => {
      const o = document.createElement('option');
      o.value = o.textContent = a;
      sel.appendChild(o);
    });
  } else {
    const grouped = {}, ungrouped = [];
    srt(anyagok).forEach(a => {
      const cs = map[a];
      cs && csoportok.includes(cs) ? (grouped[cs] ??= []).push(a) : ungrouped.push(a);
    });
    csoportok.forEach(cs => {
      const items = grouped[cs];
      if (!items?.length) return;
      const grp = document.createElement('optgroup');
      grp.label = cs;
      items.forEach(a => {
        const o = document.createElement('option');
        o.value = o.textContent = a;
        grp.appendChild(o);
      });
      sel.appendChild(grp);
    });
    if (ungrouped.length) {
      const grp = document.createElement('optgroup');
      grp.label = '— Egyéb —';
      ungrouped.forEach(a => {
        const o = document.createElement('option');
        o.value = o.textContent = a;
        grp.appendChild(o);
      });
      sel.appendChild(grp);
    }
  }
  if (prev) sel.value = prev;
}

function renderCsoportMapUI() {
  const section = E('csoportMapSection');
  if (!section) return;
  if (!state.anyagCsoportok.length || !state.anyagok.length) {
    section.style.display = 'none';
    return;
  }
  section.style.display = '';
  const srt      = l => [...l].sort((a, b) => a.localeCompare(b, 'hu'));
  const csOpts   = srt(state.anyagCsoportok).map(cs => `<option value="${esc(cs)}">${esc(cs)}</option>`).join('');
  const map      = state.anyagCsoportMap;
  const sorted   = srt(state.anyagok);
  const rows     = sorted.map(a => `<div style="display:flex;align-items:center;gap:8px;">
      <span style="flex:1;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${esc(a)}">${esc(a)}</span>
      <select class="pc-input cmap-sel" data-anyag="${esc(a)}" style="width:130px;padding:3px 5px;">
        <option value="">—</option>${csOpts}
      </select>
    </div>`).join('');
  E('csoportMapGrid').innerHTML = rows;
  const selEls = E('csoportMapGrid').querySelectorAll('.cmap-sel');
  sorted.forEach((a, i) => { if (selEls[i] && map[a]) selEls[i].value = map[a]; });
}

export async function saveCsoportMap() {
  const map = {};
  document.querySelectorAll('.cmap-sel').forEach(sel => {
    if (sel.value && sel.dataset.anyag) map[sel.dataset.anyag] = sel.value;
  });
  state.anyagCsoportMap = map;
  await saveLists();
  msg('Hozzárendelés mentve.');
  renderCsoportMapUI();
}

export function filterAnyagForReszleg(reszleg, forceInclude = '') {
  const assigned = reszleg && state.reszlegAnyagMap[reszleg];
  const mats = assigned?.length ? [...assigned] : [...state.anyagok];
  if (forceInclude && !mats.includes(forceInclude)) mats.push(forceInclude);
  return mats;
}

function renderReszlegAnyagMapUI() {
  const section = E('reszlegAnyagMapSection');
  if (!section) return;
  if (!state.reszlegek.length || !state.anyagok.length) {
    section.style.display = 'none';
    return;
  }
  section.style.display = '';
  const srt     = l => [...l].sort((a, b) => a.localeCompare(b, 'hu'));
  const anyagok = srt(state.anyagok);
  const map     = state.reszlegAnyagMap;
  let html = '';
  srt(state.reszlegek).forEach(r => {
    const assigned = map[r] || [];
    const boxes = anyagok.map(a => {
      const chk = assigned.includes(a) ? ' checked' : '';
      return `<label class="ram-chk">
        <input type="checkbox" class="ram-cb" data-reszleg="${esc(r)}" data-anyag="${esc(a)}"${chk}>
        <span>${esc(a)}</span>
      </label>`;
    }).join('');
    html += `<div class="ram-section"><div class="ram-rname">${esc(r)}</div><div class="ram-cblist">${boxes}</div></div>`;
  });
  E('reszlegAnyagGrid').innerHTML = html;
}

export async function saveReszlegAnyagMap() {
  const map = {};
  document.querySelectorAll('.ram-cb:checked').forEach(cb => {
    const r = cb.dataset.reszleg, a = cb.dataset.anyag;
    if (r && a) (map[r] ??= []).push(a);
  });
  state.reszlegAnyagMap = map;
  await saveLists();
  msg('Hozzárendelés mentve.');
}

function fillNevListaAdmin() {
  const sel = E('nevLista'); if (!sel) return;
  const prev = Array.from(sel.selectedOptions).map(o => o.value);
  sel.innerHTML = '';
  [...state.nevek].sort((a, b) => a.localeCompare(b, 'hu')).forEach(n => {
    const o = document.createElement('option');
    o.value = n;
    const arch = state.nevMetadata[n]?.archivalt;
    o.textContent = arch ? `${n} (archivált)` : n;
    if (arch) { o.style.color = 'var(--text3)'; o.style.fontStyle = 'italic'; }
    if (prev.includes(n)) o.selected = true;
    sel.appendChild(o);
  });
}

function renderNevMetaUI() {
  const section = E('nevMetaSection'); if (!section) return;
  const activeNev = state.nevek.filter(n => !state.nevMetadata[n]?.archivalt);
  if (!activeNev.length || !state.reszlegek.length) { section.style.display = 'none'; return; }
  section.style.display = '';
  const srt    = l => [...l].sort((a, b) => a.localeCompare(b, 'hu'));
  const rOpts  = srt(state.reszlegek).map(r => `<option value="${esc(r)}">${esc(r)}</option>`).join('');
  const sorted = srt(activeNev);
  E('nevMetaGrid').innerHTML = sorted.map(n => `<div style="display:flex;align-items:center;gap:8px;">
    <span style="flex:1;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${esc(n)}">${esc(n)}</span>
    <select class="pc-input nmeta-sel" data-nev="${esc(n)}" style="width:140px;padding:3px 5px;">
      <option value="">—</option>${rOpts}
    </select>
  </div>`).join('');
  const selEls = E('nevMetaGrid').querySelectorAll('.nmeta-sel');
  sorted.forEach((n, i) => { if (selEls[i] && state.nevMetadata[n]?.reszleg) selEls[i].value = state.nevMetadata[n].reszleg; });
}

export async function saveNevMeta() {
  document.querySelectorAll('.nmeta-sel').forEach(sel => {
    const n = sel.dataset.nev; if (!n) return;
    if (!state.nevMetadata[n]) state.nevMetadata[n] = {};
    if (sel.value) state.nevMetadata[n].reszleg = sel.value;
    else delete state.nevMetadata[n].reszleg;
  });
  await saveLists();
  msg('Hozzárendelés mentve.');
}

export async function archivNev() {
  const sel = E('nevLista');
  const names = Array.from(sel.selectedOptions).map(o => o.value).filter(n => !state.nevMetadata[n]?.archivalt);
  if (!names.length) { msg('Válassz ki aktív dolgozót!', 'error'); return; }
  if (!confirm(`Archiválod: ${names.join(', ')}?`)) return;
  names.forEach(n => { (state.nevMetadata[n] ??= {}).archivalt = true; });
  refreshListUI(); await saveLists(); msg(`${names.length} dolgozó archiválva.`);
}

export async function visszaNev() {
  const sel = E('nevLista');
  const names = Array.from(sel.selectedOptions).map(o => o.value).filter(n => state.nevMetadata[n]?.archivalt);
  if (!names.length) { msg('Válassz ki archivált dolgozót!', 'error'); return; }
  names.forEach(n => { state.nevMetadata[n].archivalt = false; });
  refreshListUI(); await saveLists(); msg(`${names.length} dolgozó visszaállítva.`);
}

export async function editNevItem(e) {
  const sel = e.target.closest('select'); if (!sel || sel.selectedOptions.length !== 1) return;
  const old = sel.selectedOptions[0].value;
  const nv  = prompt(`"${old}" módosítása:`, old); if (nv === null) return;
  const t   = nv.trim(); if (!t) { msg('Nem lehet üres!', 'error'); return; }
  if (t.toLowerCase() === old.toLowerCase()) return;
  if (state.nevek.some(x => x.toLowerCase() === t.toLowerCase())) { msg('Már létezik!', 'error'); return; }
  const i = state.nevek.findIndex(x => x.toLowerCase() === old.toLowerCase());
  if (i > -1) {
    state.nevek[i] = t;
    if (state.nevMetadata[old]) { state.nevMetadata[t] = state.nevMetadata[old]; delete state.nevMetadata[old]; }
    refreshListUI(); await saveLists(); msg(`"${esc(old)}" → "${esc(t)}"`, 'success', 5000);
  }
}

export async function updDolgSzuro() {
  if (!canSeeAllReports()) return;
  try {
    const q = query(collection(db, 'entries'), orderBy('datum', 'desc'));
    const s = await getDocs(q);
    const nn = [...new Set(s.docs.map(d => d.data().nev))].sort((a, b) => a.localeCompare(b, 'hu'));
    const prev = E('dolgSzuro').value;
    E('dolgSzuro').innerHTML = '<option value="">— Mindenki —</option>' +
      nn.map(n => `<option value="${esc(n)}"${n === prev ? ' selected' : ''}>${esc(n)}</option>`).join('');
  } catch (e) { console.warn('updDolgSzuro:', e.message); }
}

export function updReszlegSzuro() {
  const opts = [...state.reszlegek].sort((a, b) => a.localeCompare(b, 'hu'))
    .map(r => `<option value="${esc(r)}">${esc(r)}</option>`).join('');
  ['napiReszlegSzuro', 'idoszakosReszlegSzuro', 'premiumReszlegSzuro'].forEach(id => {
    const el = E(id); if (!el) return;
    const prev = el.value;
    el.innerHTML = '<option value="">— Mind —</option>' + opts;
    if (prev) el.value = prev;
  });
}

export async function autoAddToList(value, list) {
  const v = (value || '').trim();
  if (!v || list.some(x => x.toLowerCase() === v.toLowerCase())) return;
  list.push(v);
  refreshListUI();
  await saveLists();
}

export async function addToList(inp, list) {
  const v = inp.value.trim();
  if (!v) { msg('Adj meg értéket!', 'error'); return; }
  if (list.some(x => x.toLowerCase() === v.toLowerCase())) { msg(`"${esc(v)}" már szerepel.`, 'error'); return; }
  list.push(v);
  // Új anyagnál: automatikusan bekerül minden meglévő részleg→anyag mappingba,
  // hogy ne tűnjön el az adatbevitelnél ha szűkített lista van beállítva
  if (list === state.anyagok) {
    Object.keys(state.reszlegAnyagMap).forEach(r => {
      if (state.reszlegAnyagMap[r]?.length) state.reszlegAnyagMap[r].push(v);
    });
  }
  inp.value = '';
  refreshListUI();
  await saveLists();
  msg(`"${esc(v)}" hozzáadva.`);
}

export async function delFromList(sel, list) {
  const ch = Array.from(sel.selectedOptions).map(o => o.value);
  if (!ch.length) { msg('Jelölj ki törlendő elemet!', 'error'); return; }
  if (!confirm(`Törlöd: ${ch.join(', ')}?`)) return;
  ch.forEach(v => { const i = list.findIndex(x => x.toLowerCase() === v.toLowerCase()); if (i > -1) list.splice(i, 1); });
  refreshListUI();
  await saveLists();
  msg(`${ch.length} elem törölve.`);
}

export async function editItem(e, list) {
  const sel = e.target.closest('select'); if (!sel) return;
  if (sel.selectedOptions.length !== 1) return;
  const old = sel.selectedOptions[0].value;
  const nv  = prompt(`"${old}" módosítása:`, old); if (nv === null) return;
  const t   = nv.trim(); if (!t) { msg('Nem lehet üres!', 'error'); return; }
  if (t.toLowerCase() === old.toLowerCase()) return;
  if (list.some(x => x.toLowerCase() === t.toLowerCase())) { msg('Már létezik!', 'error'); return; }
  const i = list.findIndex(x => x.toLowerCase() === old.toLowerCase());
  if (i > -1) { list[i] = t; refreshListUI(); await saveLists(); msg(`"${esc(old)}" → "${esc(t)}"`, 'success', 5000); }
}

// Key format: "reszleg|ido"  (e.g. "R A|Délelőtt", "|Délután", "|" for migrated old global)
function napiKey(reszleg, ido) { return reszleg + '|' + ido; }

export async function loadNapiFor(date, reszleg = '', ido = '') {
  try {
    const s = await getDoc(doc(db, 'dailyNotes', date));
    if (!s.exists()) { E('napiMegj').value = ''; ag(E('napiMegj')); return; }
    const d = s.data();
    let txt = '';
    if (d.reszlegek) {
      const key = napiKey(reszleg, ido);
      // fall back to old key format (reszleg without ido) for backward compat
      txt = d.reszlegek[key] || d.reszlegek[reszleg] || '';
    } else if (!reszleg && !ido) {
      txt = d.szoveg || '';
    }
    E('napiMegj').value = txt;
    ag(E('napiMegj'));
  } catch { E('napiMegj').value = ''; }
}

export async function saveNapiFor(date, reszleg = '', ido = '') {
  const txt = E('napiMegj').value.trim();
  try {
    const ref = doc(db, 'dailyNotes', date);
    const s   = await getDoc(ref);
    let reszlegek = {};
    if (s.exists()) {
      const d = s.data();
      if (d.reszlegek) reszlegek = { ...d.reszlegek };
      else if (d.szoveg) reszlegek['|'] = d.szoveg;
    }
    const key = napiKey(reszleg, ido);
    if (txt) reszlegek[key] = txt;
    else     delete reszlegek[key];
    if (!Object.values(reszlegek).some(v => v)) {
      if (s.exists()) await deleteDoc(ref);
    } else {
      await setDoc(ref, { reszlegek, updatedBy: state.appUser.uid, updatedAt: serverTimestamp() });
    }
  } catch { msg('Napi megjegyzés mentési hiba', 'error'); }
}

export async function deleteDailyNoteForReszleg(datum, key) {
  try {
    const ref = doc(db, 'dailyNotes', datum);
    const s   = await getDoc(ref);
    if (!s.exists()) return;
    const reszlegek = s.data().reszlegek ? { ...s.data().reszlegek } : {};
    delete reszlegek[key];
    if (!Object.values(reszlegek).some(v => v)) {
      await deleteDoc(ref);
    } else {
      await setDoc(ref, { reszlegek, updatedBy: state.appUser.uid, updatedAt: serverTimestamp() });
    }
    msg('Megjegyzés törölve.');
  } catch { msg('Törlési hiba', 'error'); }
}

export async function fetchEntries(filters = {}) {
  try {
    const ownOnly = !canSeeAllReports();
    const constraints = [];

    if (ownOnly) {
      // sajatJelentes: csak createdBy egyenlőségi szűrő a Firestore-ban
      // (where + orderBy kombinációhoz kompozit index kellene — ezt kerüljük)
      // A dátum szűrés és rendezés kliens oldalon történik
      constraints.push(where('createdBy', '==', state.appUser.uid));
      if (filters.datum) constraints.push(where('datum', '==', filters.datum));
      if (filters.nev)   constraints.push(where('nev',   '==', filters.nev));
    } else {
      if (filters.datum)     constraints.push(where('datum', '==',  filters.datum));
      if (filters.datumFrom) constraints.push(where('datum', '>=',  filters.datumFrom));
      if (filters.datumTo)   constraints.push(where('datum', '<=',  filters.datumTo));
      if (filters.nev)       constraints.push(where('nev',   '==',  filters.nev));
      constraints.push(orderBy('datum'), orderBy('createdAt'));
    }

    const snap = await getDocs(query(collection(db, 'entries'), ...constraints));
    let result = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    if (ownOnly) {
      // Kliens oldali dátum szűrés és rendezés
      if (filters.datumFrom) result = result.filter(e => e.datum >= filters.datumFrom);
      if (filters.datumTo)   result = result.filter(e => e.datum <= filters.datumTo);
      result.sort((a, b) => {
        const dc = (a.datum || '').localeCompare(b.datum || '');
        return dc !== 0 ? dc : ((a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0));
      });
    }

    return result;
  } catch (e) {
    msg('Lekérdezési hiba: ' + e.message, 'error', 5000);
    return [];
  }
}
