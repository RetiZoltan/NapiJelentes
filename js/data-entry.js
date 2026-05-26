import { db, doc, addDoc, updateDoc, collection, serverTimestamp } from './firebase.js';
import { state } from './state.js';
import { E, msg, ag } from './utils.js';
import { saveNapiFor, loadNapiFor } from './db.js';

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

  const sm = E('sulyC').querySelectorAll('.wrow');
  const zm = E('zsakC').querySelectorAll('.wrow');
  const vA = anyagB !== '';
  const vS = Array.from(sm).some(m => m.querySelector('.wsuly').value.trim() !== '');
  const vZ = Array.from(zm).some(m => m.querySelector('.wzsak').value.trim() !== '');

  await saveNapiFor(datum);

  // Ha csak napi megjegyzés van (nincs nev/anyag/súly/megj), csak azt mentjük
  if (!nev && !vA && !vS && !vZ && !dolgMegj) {
    if (napiSzoveg) {
      msg('Napi megjegyzés mentve.');
      E('napiMegj').value = ''; ag(E('napiMegj'));
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
      entry = { datum, ido, nev, anyag: anyagB, sulyok, zsakSulyok, megjegyzes: dolgMegj, createdBy: state.appUser.uid, createdAt: serverTimestamp() };
    }
  } else if (dolgMegj) {
    entry = { datum, ido, nev, anyag: '', sulyok: [], zsakSulyok: [], megjegyzes: dolgMegj, createdBy: state.appUser.uid, createdAt: serverTimestamp() };
  } else {
    msg('Adj meg súlyt vagy megjegyzést!', 'error'); return;
  }

  if (entry) {
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
  E('rogzitBtn').textContent = '✓ Adatok rögzítése';
  const banner = E('editBanner');
  if (banner) banner.style.display = 'none';
  if (!state.isNamePinned) E('nev').value = '';
  E('anyag').value = '';
  E('megj').value  = '';
  E('sulyC').innerHTML = ''; addSuly();
  E('zsakC').innerHTML = ''; addZsak();
  if (state.isNamePinned) E('anyag').focus(); else E('nev').focus();
  if (sh) msg('Űrlap törölve.', 'info', 2000);
}

export async function startEditEntry(entry) {
  state.editingEntryId = entry.id;
  E('datum').value = entry.datum || '';
  E('ido').value   = entry.ido   || 'Délelőtt';
  E('nev').value   = entry.nev   || '';
  E('anyag').value = entry.anyag || '';
  E('megj').value  = entry.megjegyzes || '';

  await loadNapiFor(entry.datum);
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
