import { db, doc, getDoc, setDoc, deleteDoc, collection, query,
         where, getDocs, orderBy, serverTimestamp } from './firebase.js';
import { state, canSeeAllReports } from './state.js';
import { E, esc, msg, ag } from './utils.js';

export async function loadLists() {
  try {
    const s = await getDoc(doc(db, 'config', 'lists'));
    if (s.exists()) {
      state.nevek   = s.data().nevek   || [];
      state.anyagok = s.data().anyagok || [];
    }
    refreshListUI();
  } catch { msg('Lista betöltési hiba', 'error'); }
}

export async function saveLists() {
  try {
    await setDoc(doc(db, 'config', 'lists'), { nevek: state.nevek, anyagok: state.anyagok });
  } catch { msg('Lista mentési hiba', 'error'); }
}

export function refreshListUI() {
  const srt = l => [...l].sort((a, b) => a.localeCompare(b, 'hu'));
  E('nevDL').innerHTML   = srt(state.nevek).map(n => `<option value="${esc(n)}"></option>`).join('');
  E('anyagDL').innerHTML = srt(state.anyagok).map(a => `<option value="${esc(a)}"></option>`).join('');
  fillSel(E('nevLista'),   state.nevek);
  fillSel(E('anyagLista'), state.anyagok);
  updDolgSzuro();
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
  } catch {}
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

export async function loadNapiFor(date) {
  try {
    const s = await getDoc(doc(db, 'dailyNotes', date));
    E('napiMegj').value = s.exists() ? (s.data().szoveg || '') : '';
    ag(E('napiMegj'));
  } catch { E('napiMegj').value = ''; }
}

export async function saveNapiFor(date) {
  const txt = E('napiMegj').value.trim();
  try {
    if (txt) {
      await setDoc(doc(db, 'dailyNotes', date), { szoveg: txt, updatedBy: state.appUser.uid, updatedAt: serverTimestamp() });
    } else {
      await deleteDoc(doc(db, 'dailyNotes', date));
    }
  } catch { msg('Napi megjegyzés mentési hiba', 'error'); }
}

export async function fetchEntries(filters = {}) {
  try {
    const constraints = [];
    if (filters.datum)     constraints.push(where('datum', '==',  filters.datum));
    if (filters.datumFrom) constraints.push(where('datum', '>=',  filters.datumFrom));
    if (filters.datumTo)   constraints.push(where('datum', '<=',  filters.datumTo));
    if (!canSeeAllReports()) constraints.push(where('createdBy', '==', state.appUser.uid));
    if (filters.nev)       constraints.push(where('nev', '==',   filters.nev));
    constraints.push(orderBy('datum'), orderBy('createdAt'));
    const snap = await getDocs(query(collection(db, 'entries'), ...constraints));
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (e) {
    msg('Lekérdezési hiba: ' + e.message, 'error', 5000);
    return [];
  }
}
