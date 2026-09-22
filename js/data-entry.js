import { db, doc, addDoc, updateDoc, collection, serverTimestamp, writeBatch } from './firebase.js';
import { state } from './state.js';
import { E, msg, ag } from './utils.js';
import { saveNapiFor, loadNapiFor,
         filterAnyagForReszleg, filterNevForReszleg, fillSelGrouped, fillSel } from './db.js';
import { logAction } from './auditlog.js';

const OFFLINE_KEY = 'nj_offlineQueue';
const DRAFT_TTL   = 24 * 60 * 60 * 1000; // 24 óra

function _draftKey() { return `nj_draft_${state.appUser?.uid || 'anon'}`; }

export function updateAnyagSel(reszleg = '', currentVal = '') {
  const mats = filterAnyagForReszleg(reszleg, currentVal);
  fillSelGrouped(E('anyag'), mats, '— Válassz anyagot —');
  // fillSelGrouped magától visszaállítja a select korábbi értékét — ezt itt
  // felülírjuk, hogy currentVal hiányában (pl. clearF-nél) tényleg üresre álljon.
  E('anyag').value = currentVal || '';
}

export function updateNevSel(reszleg = '', currentVal = '') {
  const names = filterNevForReszleg(reszleg, currentVal);
  fillSel(E('nev'), names, '— Válassz dolgozót —');
  E('nev').value = currentVal || '';
}

export function saveDraft() {
  if (!state.appUser || state.editingEntryId) return;
  const sulyok = [...E('sulyC').querySelectorAll('.wrow')].map(r => ({
    suly:    parseFloat(r.querySelector('.wsuly')?.value) || 0,
    statusz: r.querySelector('.wstat')?.value || 'teli'
  })).filter(s => s.suly > 0);
  const draft = {
    datum: E('datum')?.value, ido: E('ido')?.value,
    reszleg: E('reszleg')?.value, nev: E('nev')?.value,
    anyag: E('anyag')?.value, megj: E('megj')?.value,
    sulyok, ts: Date.now()
  };
  // Csak ha van érdemi tartalom
  if (!draft.nev && !draft.anyag && !sulyok.length) return;
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
  updateAnyagSel(d.reszleg || '', d.anyag || '');
  if (d.nev)     updateNevSel(d.reszleg || '', d.nev);
  if (d.megj)    E('megj').value    = d.megj;
  if (d.sulyok?.length || d.zsakSulyok?.length) {
    E('sulyC').innerHTML = '';
    (d.sulyok || []).forEach(s => addSuly(s.suly, s.statusz));
    // Régebbi (két külön listás) vázlatból megmaradt teli zsák súlyok —
    // Teli sorként jelennek meg, hogy semmi ne vesszen el.
    (d.zsakSulyok || []).forEach(v => addSuly(v, 'teli'));
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

// zsakOverride: csak a WIP-zsák befejezésekor kap értéket (wip-bags.js) — ilyenkor
// a fizikai, lezárt zsák teljes súlya eltérhet a soron megjelenő (nettó, aznapi
// teljesítményként elszámolt) súlytól. Normál kézi rögzítésnél nincs override:
// egy Teli sor súlya egyben a zsák súlya is, mentéskor abból származik a Készlet-tétel.
export function addSuly(v = '', st = 'teli', zsakOverride = null) {
  const d = document.createElement('div');
  d.className = 'wrow';
  if (zsakOverride != null) d.dataset.zsakOverride = zsakOverride;
  d.innerHTML = `<input type="number" class="wsuly" placeholder="kg" value="${v}" min="0.01" step="0.01">
    <select class="wstat"><option value="teli" ${st==='teli'?'selected':''}>Teli</option><option value="kezdett" ${st==='kezdett'?'selected':''}>Megkezdve</option></select>
    <div class="wbtns"><button type="button" class="wb a aSuly">＋</button><button type="button" class="wb d dSuly">✕</button></div>`;
  E('sulyC').appendChild(d);
  const inp = d.querySelector('.wsuly');
  inp.addEventListener('focus', e => e.target.select());
  inp.addEventListener('keydown', e => wEnter(e));
}

function wEnter(e) {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  const rows = Array.from(E('sulyC').querySelectorAll('.wrow'));
  const cur  = e.target.closest('.wrow');
  const idx  = rows.indexOf(cur);
  if (idx === rows.length - 1) E('rogzitBtn').click();
  else rows[idx + 1].querySelector('input[type="number"]').focus();
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
  const vA = anyagB !== '';
  const vS = Array.from(sm).some(m => m.querySelector('.wsuly').value.trim() !== '');

  await saveNapiFor(datum, E('reszleg').value.trim(), E('ido').value);

  // Ha csak napi megjegyzés van (nincs nev/anyag/súly/megj), csak azt mentjük
  if (!nev && !vA && !vS && !dolgMegj) {
    if (napiSzoveg) {
      msg('Napi megjegyzés mentve.');
    } else {
      msg('Adj meg adatot vagy megjegyzést!', 'error');
    }
    return;
  }

  if (!nev) { msg('Add meg a dolgozó nevét!', 'error'); return; }

  let entry = null;

  if (vA || vS) {
    if (!vA) { msg('Anyagtípus kötelező ha súlyt rögzítesz!', 'error'); E('anyag').focus(); return; }
    const sulyok = [], zsakSulyok = [];
    let hiba = false;
    sm.forEach(m => {
      const i = m.querySelector('.wsuly'), s = m.querySelector('.wstat'), v = parseFloat(i.value);
      // Egy Teli sor egyben zsák is: a Készletbe alapból a sor saját súlya kerül,
      // kivéve ha a sor rejtett zsakOverride-ot hordoz (lásd wip-bags.js
      // completeWipBag) — ott a fizikai zsák teljes súlya eltérhet az itt
      // elszámolt (nettó, aznapi) teljesítménytől.
      const override = m.dataset.zsakOverride ? parseFloat(m.dataset.zsakOverride) : null;
      if (i.value.trim() !== '') {
        if (!isNaN(v) && v > 0) {
          sulyok.push({ suly: v, statusz: s.value });
          if (s.value === 'teli') zsakSulyok.push(override != null && !isNaN(override) && override > 0 ? override : v);
          i.style.borderColor = '';
        } else { i.style.borderColor = 'var(--red)'; hiba = true; }
      } else {
        i.style.borderColor = '';
        if (s.value === 'teli' && override != null && !isNaN(override) && override > 0) zsakSulyok.push(override);
      }
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
    if (state.editingEntryId && !navigator.onLine) {
      msg('Szerkesztés offline nem lehetséges — csatlakozz az internethez.', 'error', 5000);
      return;
    }
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
        // Ha több, korábban külön rögzített bejegyzés lett egybeszerkesztve,
        // a szerkesztett bejegyzés most már mindet tartalmazza — a többi eredeti
        // (immár felesleges) dokumentum törlődik, hogy ne duplázódjon az adat.
        if (state.editingMergeDeleteIds?.length) {
          const batch = writeBatch(db);
          state.editingMergeDeleteIds.forEach(id => batch.delete(doc(db, 'entries', id)));
          await batch.commit();
        }
        logAction('entry.edit', { nev: entry.nev, datum: entry.datum, merged: state.editingMergeDeleteIds?.length || 0 });
        msg('Bejegyzés szerkesztve!');
      } else {
        await addDoc(collection(db, 'entries'), entry);
        msg('Adat rögzítve!');
      }
      // Szerkesztésnél is felajánljuk a műszakátadást, nemcsak új rögzítésnél —
      // pl. ha egy zsákot Teliről Megkezdettre állítasz át szerkesztés közben.
      const megkezdettSuly = entry.sulyok
        .filter(s => s.statusz === 'kezdett')
        .reduce((acc, s) => acc + s.suly, 0);
      if (megkezdettSuly > 0) {
        document.dispatchEvent(new CustomEvent('entry-megkezdett', {
          detail: { anyag: entry.anyag, reszleg: entry.reszleg, nev: entry.nev, datum: entry.datum, muszak: entry.ido, suly: megkezdettSuly }
        }));
      }
      clearF(false);
    } catch (e) { msg('Rögzítési hiba: ' + e.message, 'error'); }
  } else {
    msg('Napi megjegyzés mentve.');
  }
}

export function clearF(sh = true) {
  state.editingEntryId = null;
  state.editingMergeDeleteIds = [];
  clearDraft();
  E('rogzitBtn').textContent = '✓ Adatok rögzítése';
  const banner = E('editBanner');
  if (banner) banner.style.display = 'none';
  if (!state.isReszlegPinned) E('reszleg').value = '';
  updateAnyagSel(E('reszleg').value.trim());
  updateNevSel(E('reszleg').value.trim(), state.isNamePinned ? E('nev').value : '');
  E('megj').value  = '';
  E('sulyC').innerHTML = ''; addSuly();
  loadNapiFor(E('datum').value, E('reszleg').value.trim(), E('ido').value);
  if (sh) msg('Űrlap törölve.', 'info', 2000);
}

export async function startEditEntry(entry) {
  state.editingEntryId = entry.id;
  state.editingMergeDeleteIds = entry.mergeDeleteIds || [];
  E('datum').value   = entry.datum       || '';
  E('ido').value     = entry.ido         || 'Délelőtt';
  E('reszleg').value = entry.reszleg     || '';
  updateAnyagSel(entry.reszleg || '', entry.anyag || '');
  updateNevSel(entry.reszleg || '', entry.nev || '');
  E('megj').value    = entry.megjegyzes  || '';

  await loadNapiFor(entry.datum, entry.reszleg || '', entry.ido || '');
  state.prevDatum = entry.datum;

  E('sulyC').innerHTML = '';
  const sulyokArr = Array.isArray(entry.sulyok) ? entry.sulyok : [];
  const zsakArr   = Array.isArray(entry.zsakSulyok) ? entry.zsakSulyok : [];
  if (sulyokArr.length > 0) {
    sulyokArr.forEach(s => addSuly(s.suly, s.statusz));
  }
  // Ha a mentett teli zsák-súlyok összege eltér a Teli sorok összegétől — pl. a
  // bejegyzés egy WIP-zsák befejezéséből származik, ahol a fizikai zsáksúly
  // eltér az itt elszámolt nettó súlytól —, a különbséget egy rejtett
  // zsakOverride-dal az utolsó Teli sorra tesszük, hogy újramentés után is a
  // helyes zsáksúly kerüljön a Készletbe, ne a látszó nettó érték.
  const teliSum = sulyokArr.filter(s => s.statusz === 'teli').reduce((a, s) => a + s.suly, 0);
  const zsakSum = zsakArr.reduce((a, v) => a + v, 0);
  if (Math.abs(zsakSum - teliSum) > 0.001) {
    const teliRows = Array.from(E('sulyC').querySelectorAll('.wrow'))
      .filter(r => r.querySelector('.wstat')?.value === 'teli');
    if (teliRows.length > 0) {
      const last = teliRows[teliRows.length - 1];
      const ownVal = parseFloat(last.querySelector('.wsuly').value) || 0;
      last.dataset.zsakOverride = (ownVal + (zsakSum - teliSum)).toFixed(2);
    } else if (zsakArr.length) {
      // Nincs egyetlen Teli sor sem — régi, kizárólag zsákként mentett adat:
      // jelenjen meg Teli sorként, hogy semmi ne vesszen el.
      zsakArr.forEach(v => addSuly(v, 'teli'));
    }
  }
  if (E('sulyC').children.length === 0) addSuly();

  E('rogzitBtn').textContent = '✓ Szerkesztés mentése';
  const banner = E('editBanner');
  if (banner) {
    banner.style.display = 'flex';
    const txt = banner.querySelector('.edit-banner-txt');
    if (txt) {
      txt.textContent = state.editingMergeDeleteIds.length
        ? `✎ Bejegyzés szerkesztése — ${state.editingMergeDeleteIds.length + 1} korábbi bejegyzés egyben (mentéskor eggyé olvad)`
        : '✎ Bejegyzés szerkesztése folyamatban';
    }
  }
}
