import { db, doc, getDoc, setDoc, deleteDoc, collection, query,
         where, getDocs, orderBy, serverTimestamp } from './firebase.js';
import { state, canSeeAllReports } from './state.js';
import { E, esc, msg, ag } from './utils.js';

export async function loadLists() {
  try {
    const s = await getDoc(doc(db, 'config', 'lists'));
    if (s.exists()) {
      state.nevek     = s.data().nevek     || [];
      state.anyagok   = s.data().anyagok   || [];
      state.reszlegek = s.data().reszlegek || [];
    }
    refreshListUI();
  } catch { msg('Lista betöltési hiba', 'error'); }
}

export async function saveLists() {
  try {
    await setDoc(doc(db, 'config', 'lists'), {
      nevek: state.nevek, anyagok: state.anyagok, reszlegek: state.reszlegek
    });
  } catch { msg('Lista mentési hiba', 'error'); }
}

export function refreshListUI() {
  const srt = l => [...l].sort((a, b) => a.localeCompare(b, 'hu'));
  E('nevDL').innerHTML     = srt(state.nevek).map(n => `<option value="${esc(n)}"></option>`).join('');
  E('anyagDL').innerHTML   = srt(state.anyagok).map(a => `<option value="${esc(a)}"></option>`).join('');
  E('reszlegDL').innerHTML = srt(state.reszlegek).map(r => `<option value="${esc(r)}"></option>`).join('');
  fillSel(E('nevLista'),     state.nevek);
  fillSel(E('anyagLista'),   state.anyagok);
  fillSel(E('reszlegLista'), state.reszlegek);
  updDolgSzuro();
  updReszlegSzuro();
  updIdoszakosFilters();
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
  const aEl = E('idoszakosAnyagSzuro');
  if (aEl) {
    const prev = aEl.value;
    aEl.innerHTML = '<option value="">— Mind —</option>' +
      srt(state.anyagok).map(a => `<option value="${esc(a)}">${esc(a)}</option>`).join('');
    if (prev) aEl.value = prev;
  }
}

export function fillSel(sel, list) {
  if (!sel) return;
  const prev = Array.from(sel.selectedOptions).map(o => o.value);
  sel.innerHTML = '';
  [...list].sort((a, b) => a.localeCompare(b, 'hu')).forEach(item => {
    const o = document.createElement('option');
    o.value = o.textContent = item;
    if (prev.includes(item)) o.selected = true;
    sel.appendChild(o);
  });
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
