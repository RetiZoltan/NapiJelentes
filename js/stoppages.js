import { db, collection, addDoc, query, where, getDocs,
         deleteDoc, doc, serverTimestamp } from './firebase.js';
import { state, isMainAdmin } from './state.js';
import { E, esc, msg } from './utils.js';

export async function saveStoppage() {
  const datum  = E('datum').value;
  const ido    = E('ido').value;
  const gep    = E('allasGep').value.trim();
  const ok     = E('allasOk').value.trim();
  const kezdet = E('allasKezdet').value;
  const veg    = E('allasVeg').value;

  if (!datum) { msg('Dátum kötelező!', 'error'); return; }
  if (!gep)   { msg('Add meg a gép nevét!', 'error'); E('allasGep').focus(); return; }
  if (!ok)    { msg('Add meg a leállás okát!', 'error'); E('allasOk').focus(); return; }

  try {
    await addDoc(collection(db, 'stoppages'), {
      datum, ido, gep, ok,
      kezdet: kezdet || '',
      veg:    veg    || '',
      createdBy: state.appUser.uid,
      createdAt: serverTimestamp()
    });
    msg('Gépállás rögzítve!');
    clearStoppageForm();
  } catch (e) { msg('Mentési hiba: ' + e.message, 'error'); }
}

export function clearStoppageForm() {
  E('allasGep').value    = '';
  E('allasOk').value     = '';
  E('allasKezdet').value = '';
  E('allasVeg').value    = '';
}

export async function fetchStoppages(datum) {
  try {
    const snap = await getDocs(query(
      collection(db, 'stoppages'),
      where('datum', '==', datum)
    ));
    const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    return items.sort((a, b) => (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0));
  } catch { return []; }
}

export async function deleteStoppage(id) {
  try {
    await deleteDoc(doc(db, 'stoppages', id));
    msg('Gépállás törölve.');
    return true;
  } catch (e) { msg('Törlési hiba: ' + e.message, 'error'); return false; }
}

export function stoppageHtml(list) {
  if (!list.length) return '';
  let h = `<div class="stoppage-block">
    <div class="stoppage-hd"><span>⚠️</span><span>Gépállások / leállások</span></div>
    <table class="rt"><thead><tr><th>Gép</th><th>Műszak</th><th>Időszak</th><th>Ok</th><th></th></tr></thead><tbody>`;
  list.forEach(s => {
    const idospan = [s.kezdet, s.veg].filter(Boolean).join(' – ') || '—';
    h += `<tr>
      <td style="font-weight:600;color:var(--text);">${esc(s.gep)}</td>
      <td style="color:var(--text3);">${esc(s.ido || '—')}</td>
      <td style="color:var(--text3);font-size:12.5px;">${esc(idospan)}</td>
      <td>${esc(s.ok)}</td>
      <td>${isMainAdmin() ? `<button class="del-btn" data-type="stoppage" data-sid="${esc(s.id)}">✕</button>` : ''}</td>
    </tr>`;
  });
  h += `</tbody></table></div>`;
  return h;
}
