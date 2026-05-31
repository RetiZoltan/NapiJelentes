import { db, doc, addDoc, updateDoc, collection, serverTimestamp } from './firebase.js';
import { state } from './state.js';
import { E, msg, ag } from './utils.js';
import { saveNapiFor, loadNapiFor, autoAddToList } from './db.js';

const OFFLINE_KEY = 'nj_offlineQueue';
const DRAFT_TTL   = 24 * 60 * 60 * 1000; // 24 óra

function _draftKey() { return `nj_draft_${state.appUser?.uid || 'anon'}`; }

export function saveDraft() {
  if (!state.appUser || state.editingEntryId) return;
  const sulyok = [...E('sulyC').querySelectorAll('.wrow')].map(r => ({
    suly:    parseFloat(r.querySelector('.wsuly')?.value) || 0,
    statusz: r.querySelector('.wstat')?.value || 'teli'
  })).filter(s => s.suly > 0);
  const zsakSulyok = [...E('zsakC').querySelectorAll('.wrow')].map(r =>
    parseFloat(r.querySelector('.wzsak')?.value) || 0
  ).filter(v => v > 0);
  const draft = {
    datum: E('datum')?.value, ido: E('ido')?.value,
    reszleg: E('reszleg')?.value, nev: E('nev')?.value,
    anyag: E('anyag')?.value, megj: E('megj')?.value,
    sulyok, zsakSulyok, ts: Date.now()
  };
  // Csak ha van érdemi tartalom
  if (!draft.nev && !draft.anyag && !sulyok.length && !zsakSulyok.length) return;
  localStorage.setItem(_draftKey(), JSON.stringify(draft));
}

export function loadDraft() {
  if (!state.appUser) return null;
  try {
    const raw = localStorage.getItem(_draftKey());
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (Date.now() - d.ts > DRAFT_TTL) { clearDraft(); return null; }
    return d;
  } catch { return null; }
}

export function restoreDraft(d) {
  if (!d) return;
  if (d.datum)   E('datum').value   = d.datum;
  if (d.ido)     E('ido').value     = d.ido;
  if (d.reszleg) E('reszleg').value = d.reszleg;
  if (d.nev)     E('nev').value     = d.nev;
  if (d.anyag)   E('anyag').value   = d.anyag;
  if (d.megj)    E('megj').value    = d.megj;
  if (d.sulyok?.length) {
    E('sulyC').innerHTML = '';
    d.sulyok.forEach(s => addSuly(s.suly, s.statusz));
  }
  if (d.zsakSulyok?.length) {
    E('zsakC').innerHTML = '';
    d.zsakSulyok.forEach(v => addZsak(v));
  }
  msg('Vázlat visszaállítva.', 'info', 3000);
}

export function clearDraft() {
  localStorage.removeItem(_draftKey());
  const b = E('draftBanner'); if (b) b.style.display = 'none';
}

export function getOfflineCount() {
  try { return JSON.parse(localStorage.getItem(OFFLINE_KEY) || '[]').length; } catch { return 0; }
}

export async function syncOfflineQueue() {
  let queue;
  try { queue = JSON.parse(localStorage.getItem(OFFLINE_KEY) || '[]'); } catch { return; }
  if (!queue.length) return;
  let saved = 0;
  const failed = [];
  for (const { _ts, ...data } of queue) {
    try {
      await addDoc(collection(db, 'entries'), { ...data, createdAt: serverTimestamp() });
      saved++;
    } catch { failed.push({ _ts, ...data }); }
  }
  localStorage.setItem(OFFLINE_KEY, JSON.stringify(failed));
  if (saved > 0) msg(`${saved} offline bejegyzés szinkronizálva!`, 'success', 5000);
}

export function addSuly(v = '', st = 'teli') {
  const d = document.createElement('div');
  d.className = 'wrow';
  d.innerHTML = `<input type="number" class="wsuly" placeholder="kg" value="${v}" min="0.01" step="0.01">
    <select class="wstat"><option value="teli" ${st==='teli'?'selected':''}>Teli</option><option value="kezdett" ${st==='kezdett'?'selected':''}>Megkezdve</option></select>
    <div class="wbtns"><button type="button" class="wb a aSuly">＋</button><button type="button" class="wb d dSuly">✕</button></div>`;
  E('sulyC').appendChild(d);
  const inp = d.querySelector('.wsuly');
  inp.addEventListener('focus', e => e.target.select());
  inp.addEventListener('keydown', e => wEnter(e, 'suly'));
}

export function addZsak(v = '') {
  const d = document.createElement('div');
  d.className = 'wrow';
  d.innerHTML = `<input type="number" class="wzsak" placeholder="kg" value="${v}" min="0.01" step="0.01">
    <div class="wbtns"><button type="button" class="wb a aZsak">＋</button><button type="button" class="wb d dZsak">✕</button></div>`;
  E('zsakC').appendChild(d);
  const inp = d.querySelector('.wzsak');
  inp.addEventListener('focus', e => e.target.select());
  inp.addEventListener('keydown', e => wEnter(e, 'zsak'));
}

function wEnter(e, type) {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  const cont = type === 'suly' ? E('sulyC') : E('zsakC');
  const rows  = Array.from(cont.querySelectorAll('.wrow'));
  const cur   = e.target.closest('.wrow');
  const idx   = rows.indexOf(cur);
  if (idx === rows.length - 1) {
    if (type === 'suly') { const f = E('zsakC').querySelector('input[type="number"]'); if (f) f.focus(); }
    else E('rogzitBtn').click();
  } else rows[idx + 1].querySelector('input[type="number"]').focus();
}

export async function rogzit() {
  const datum      = E('datum').value;
  const ido        = E('ido').value;
  const nev        = E('nev').value.trim();
  const anyagB     = E('anyag').value.trim();
  const dolgMegj   = E('megj').value.trim();
  const napiSzoveg = E('napiMegj').value.trim();

  if (!datum) { msg('Dátum kötelező!', 'error'); E('datum').focus(); return; }
  await autoAddToList(nev, state.nevek);
  await autoAddToList(anyagB, state.anyagok);

  const sm = E('sulyC').querySelectorAll('.wrow');
  const zm = E('zsakC').querySelectorAll('.wrow');
  const vA = anyagB !== '';
  const vS = Array.from(sm).some(m => m.querySelector('.wsuly').value.trim() !== '');
  const vZ = Array.from(zm).some(m => m.querySelector('.wzsak').value.trim() !== '');

  await saveNapiFor(datum, E('reszleg').value.trim(), E('ido').value);

  // Ha csak napi megjegyzés van (nincs nev/anyag/súly/megj), csak azt mentjük
  if (!nev && !vA && !vS && !vZ && !dolgMegj) {
    if (napiSzoveg) {
      msg('Napi megjegyzés mentve.');
    } else {
      msg('Adj meg adatot vagy megjegyzést!', 'error');
    }
    return;
  }

  if (!nev) { msg('Add meg a dolgozó nevét!', 'error'); return; }

  let entry = null;

  if (vA || vS || vZ) {
    if (!vA) { msg('Anyagtípus kötelező ha súlyt rögzítesz!', 'error'); E('anyag').focus(); return; }
    const sulyok = [], zsakSulyok = [];
    let hiba = false;
    sm.forEach(m => {
      const i = m.querySelector('.wsuly'), s = m.querySelector('.wstat'), v = parseFloat(i.value);
      if (i.value.trim() !== '') {
        if (!isNaN(v) && v > 0) { sulyok.push({ suly: v, statusz: s.value }); i.style.borderColor = ''; }
        else { i.style.borderColor = 'var(--red)'; hiba = true; }
      } else i.style.borderColor = '';
    });
    zm.forEach(m => {
      const i = m.querySelector('.wzsak'), v = parseFloat(i.value);
      if (i.value.trim() !== '') {
        if (!isNaN(v) && v > 0) { zsakSulyok.push(v); i.style.borderColor = ''; }
        else { i.style.borderColor = 'var(--red)'; hiba = true; }
      } else i.style.borderColor = '';
    });
    if (hiba) { msg('Érvénytelen súlyérték!', 'error'); return; }
    if (sulyok.length > 0 || zsakSulyok.length > 0) {
      entry = { datum, ido, nev, reszleg: E('reszleg').value.trim(), anyag: anyagB, sulyok, zsakSulyok, megjegyzes: dolgMegj, createdBy: state.appUser.uid, createdAt: serverTimestamp() };
    }
  } else if (dolgMegj) {
    entry = { datum, ido, nev, reszleg: E('reszleg').value.trim(), anyag: '', sulyok: [], zsakSulyok: [], megjegyzes: dolgMegj, createdBy: state.appUser.uid, createdAt: serverTimestamp() };
  } else {
    msg('Adj meg súlyt vagy megjegyzést!', 'error'); return;
  }

  if (entry) {
    if (!state.editingEntryId && !navigator.onLine) {
      const queue = JSON.parse(localStorage.getItem(OFFLINE_KEY) || '[]');
      queue.push({ ...entry, createdAt: null, _ts: Date.now() });
      localStorage.setItem(OFFLINE_KEY, JSON.stringify(queue));
      msg(`Offline — ${queue.length} bejegyzés várakozik szinkronra`, 'info', 4000);
      clearF(false);
      return;
    }
    try {
      if (state.editingEntryId) {
        const { createdBy: _cb, createdAt: _ca, ...fields } = entry;
        await updateDoc(doc(db, 'entries', state.editingEntryId), { ...fields, updatedBy: state.appUser.uid, updatedAt: serverTimestamp() });
        msg('Bejegyzés szerkesztve!');
      } else {
        await addDoc(collection(db, 'entries'), entry);
        msg('Adat rögzítve!');
      }
      clearF(false);
    } catch (e) { msg('Rögzítési hiba: ' + e.message, 'error'); }
  } else {
    msg('Napi megjegyzés mentve.');
  }
}

export function clearF(sh = true) {
  state.editingEntryId = null;
  clearDraft();
  E('rogzitBtn').textContent = '✓ Adatok rögzítése';
  const banner = E('editBanner');
  if (banner) banner.style.display = 'none';
  if (!state.isNamePinned)    E('nev').value    = '';
  if (!state.isReszlegPinned) E('reszleg').value = '';
  E('anyag').value = '';
  E('megj').value  = '';
  E('sulyC').innerHTML = ''; addSuly();
  E('zsakC').innerHTML = ''; addZsak();
  loadNapiFor(E('datum').value, E('reszleg').value.trim(), E('ido').value);
  if (sh) msg('Űrlap törölve.', 'info', 2000);
}

export async function startEditEntry(entry) {
  state.editingEntryId = entry.id;
  E('datum').value   = entry.datum       || '';
  E('ido').value     = entry.ido         || 'Délelőtt';
  E('nev').value     = entry.nev         || '';
  E('reszleg').value = entry.reszleg     || '';
  E('anyag').value   = entry.anyag       || '';
  E('megj').value    = entry.megjegyzes  || '';

  await loadNapiFor(entry.datum, entry.reszleg || '', entry.ido || '');
  state.prevDatum = entry.datum;

  E('sulyC').innerHTML = '';
  if (Array.isArray(entry.sulyok) && entry.sulyok.length > 0) {
    entry.sulyok.forEach(s => addSuly(s.suly, s.statusz));
  } else {
    addSuly();
  }

  E('zsakC').innerHTML = '';
  if (Array.isArray(entry.zsakSulyok) && entry.zsakSulyok.length > 0) {
    entry.zsakSulyok.forEach(z => addZsak(z));
  } else {
    addZsak();
  }

  E('rogzitBtn').textContent = '✓ Szerkesztés mentése';
  const banner = E('editBanner');
  if (banner) banner.style.display = 'flex';
}
