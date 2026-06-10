import { db, doc, getDoc, setDoc, deleteDoc, updateDoc, collection, getDocs, serverTimestamp } from './firebase.js';
import { state } from './state.js';
import { E, esc, msg } from './utils.js';
import { addSuly, addZsak } from './data-entry.js';

function _wipId(reszleg, anyag) {
  try {
    return btoa(unescape(encodeURIComponent(`${reszleg.trim()}||${anyag.trim()}`))).replace(/[/+=]/g, '_');
  } catch {
    return encodeURIComponent(`${reszleg.trim()}||${anyag.trim()}`).replace(/%/g, '_').slice(0, 100);
  }
}

export async function loadAllWipBags() {
  try {
    const snap = await getDocs(collection(db, 'megkezdettZsakok'));
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch { return []; }
}

export async function saveWipTransfer({ reszleg, anyag, nev, datum, muszak, suly }) {
  if (!reszleg || !anyag || !nev || !suly || suly <= 0) {
    msg('Töltsd ki az összes mezőt!', 'error'); return;
  }
  try {
    const id  = _wipId(reszleg, anyag);
    const ref = doc(db, 'megkezdettZsakok', id);
    const snap = await getDoc(ref);
    const entry = { datum, muszak, nev, hozzaadott: suly };
    if (snap.exists()) {
      const d = snap.data();
      const prev = d.jelenlegiSuly || 0;
      await updateDoc(ref, {
        jelenlegiSuly: suly,
        tortenelem: [...(d.tortenelem || []), { ...entry, hozzaadott: Math.max(0, suly - prev) }]
      });
    } else {
      await setDoc(ref, {
        anyag, reszleg,
        jelenlegiSuly: suly,
        tortenelem: [entry],
        letrehozva: serverTimestamp(),
        letrehozta: state.appUser?.uid || ''
      });
    }
    msg('Zsák átadva a következő műszaknak!', 'success');
    await renderWipSection();
  } catch (e) { msg('Hiba: ' + e.message, 'error'); }
}

export async function rollbackWipBag(id) {
  try {
    const ref  = doc(db, 'megkezdettZsakok', id);
    const snap = await getDoc(ref);
    if (!snap.exists()) { await renderWipSection(); return; }
    const d    = snap.data();
    const hist = d.tortenelem || [];
    if (hist.length <= 1) {
      if (!confirm('Ez törli a teljes zsák-nyilvántartást. Biztosan visszavonod?')) return;
      await deleteDoc(ref);
      msg('Zsák nyilvántartás törölve.', 'info');
    } else {
      const last   = hist[hist.length - 1];
      const newSuly = Math.max(0, (d.jelenlegiSuly || 0) - (last.hozzaadott || 0));
      await updateDoc(ref, {
        jelenlegiSuly: newSuly,
        tortenelem: hist.slice(0, -1)
      });
      msg(`Visszavonva: ${last.nev} — ${last.hozzaadott} kg.`, 'info');
    }
    await renderWipSection();
  } catch (e) { msg('Hiba: ' + e.message, 'error'); }
}

export async function completeWipBag(id, finalSuly) {
  try {
    const ref  = doc(db, 'megkezdettZsakok', id);
    const snap = await getDoc(ref);
    if (!snap.exists()) { msg('Zsák nem található!', 'error'); return; }
    const wip = snap.data();
    const net = Math.max(0, Math.round((finalSuly - (wip.jelenlegiSuly || 0)) * 100) / 100);

    if (E('anyag') && !E('anyag').value.trim()) E('anyag').value = wip.anyag;
    if (E('reszleg') && !E('reszleg').value.trim()) E('reszleg').value = wip.reszleg;

    E('sulyC').innerHTML = '';
    addSuly(net > 0 ? net : '', 'teli');
    E('zsakC').innerHTML = '';
    addZsak(finalSuly);

    await deleteDoc(ref);
    msg(`Előkészítve: ${net} kg nettó + ${finalSuly} kg fizikai zsák. Ellenőrizd és rögzítsd!`, 'success', 7000);
    await renderWipSection();
    E('rogzitBtn')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (e) { msg('Hiba: ' + e.message, 'error'); }
}

export async function renderWipSection() {
  const sec = E('wipSection');
  if (!sec) return;
  const bags = await loadAllWipBags();
  if (!bags.length) { sec.style.display = 'none'; return; }
  sec.style.display = '';
  const cnt = E('wipCount');
  if (cnt) cnt.textContent = bags.length;

  E('wipList').innerHTML = bags.map(b => {
    const hist      = b.tortenelem || [];
    const lastEntry = hist.length ? hist[hist.length - 1] : null;
    const histHtml  = hist.map(h =>
      `<span class="wip-hist-item">📅 ${esc(h.datum)} ${esc(h.muszak)} — <b>${esc(h.nev)}</b>: +${h.hozzaadott} kg</span>`
    ).join('');
    return `
      <div class="wip-item">
        <div class="wip-header">
          <div class="wip-meta">
            <span class="wip-anyag">${esc(b.anyag)}</span>
            <span class="wip-reszleg">${esc(b.reszleg)}</span>
            ${lastEntry ? `<span class="wip-last">Utolsó: ${esc(lastEntry.nev)}, ${esc(lastEntry.datum)} ${esc(lastEntry.muszak)}</span>` : ''}
          </div>
          <span class="wip-suly">${b.jelenlegiSuly} kg</span>
        </div>
        <details class="wip-details">
          <summary>Előzmények (${hist.length} bejegyzés)</summary>
          <div class="wip-history">${histHtml}</div>
        </details>
        <div class="wip-actions">
          <button class="btn btn-ghost btn-sm wipRollbackBtn" data-wid="${b.id}">↩ Visszavon</button>
          <div class="wip-complete-row">
            <input type="number" class="wip-final-input" placeholder="Végső zsák súlya (kg)" min="0.01" step="0.01">
            <button class="btn btn-primary btn-sm wipCompleteBtn" data-wid="${b.id}">✓ Befejezem</button>
          </div>
        </div>
      </div>`;
  }).join('');
}
