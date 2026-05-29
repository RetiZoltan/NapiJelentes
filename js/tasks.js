import { db, doc, addDoc, updateDoc, deleteDoc,
         collection, query, getDocs, orderBy, serverTimestamp } from './firebase.js';
import { state, isMainAdmin } from './state.js';
import { E, esc, msg, tod } from './utils.js';

export async function loadTasks() {
  const statuszF = E('feladatStatuszF')?.value || 'nyitott';
  const reszlegF = E('feladatReszlegF')?.value || '';
  E('feladatListDiv').innerHTML = '<div class="empty-st"><div class="spinner" style="margin:0 auto"></div></div>';
  try {
    const snap = await getDocs(query(collection(db, 'tasks'), orderBy('createdAt', 'desc')));
    let list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (statuszF !== 'mind') list = list.filter(t => t.statusz === statuszF);
    if (reszlegF) list = list.filter(t => !t.reszleg || t.reszleg === reszlegF);
    renderTasks(list, statuszF);
  } catch (e) { msg('Betöltési hiba: ' + e.message, 'error'); }
}

function renderTasks(list, statuszF) {
  const div = E('feladatListDiv'); if (!div) return;
  if (!list.length) {
    const empty = statuszF === 'kesz' ? 'Nincs befejezett feladat' : 'Nincs nyitott feladat';
    div.innerHTML = `<div class="empty-st"><div class="empty-ic">📌</div>${empty}</div>`;
    return;
  }
  const today = tod();
  div.innerHTML = list.map(t => {
    const fontos = t.prioritas === 'fontos';
    const kesz   = t.statusz   === 'kesz';
    const lejart = !kesz && t.datum && t.datum < today;
    const canDel = isMainAdmin() || t.createdBy === state.appUser.uid;
    return `<div class="task-card${kesz ? ' task-done' : ''}${fontos && !kesz ? ' task-fontos' : ''}">
      <div class="task-prio-dot ${fontos ? 'task-prio-fontos' : 'task-prio-normal'}" title="${fontos ? 'Fontos' : 'Normal'}"></div>
      <div style="flex:1;min-width:0;">
        <div class="task-cim${kesz ? ' task-cim-done' : ''}">${esc(t.cim)}</div>
        ${t.leiras ? `<div class="task-leiras">${esc(t.leiras)}</div>` : ''}
        <div class="task-meta">
          ${t.reszleg ? `<span>📍 ${esc(t.reszleg)}</span>` : ''}
          ${t.datum ? `<span style="${lejart ? 'color:var(--red);font-weight:600;' : ''}">📅 ${esc(t.datum)}${lejart ? ' ⚠️' : ''}</span>` : ''}
          ${kesz ? '<span style="color:var(--green);">✓ Befejezve</span>' : ''}
        </div>
      </div>
      <div style="display:flex;gap:5px;flex-shrink:0;align-items:center;flex-wrap:wrap;justify-content:flex-end;">
        ${!kesz ? `<button class="btn btn-primary btn-xs task-done-btn" data-id="${t.id}">✓ Kész</button>` : ''}
        ${kesz && isMainAdmin() ? `<button class="btn btn-ghost btn-xs task-reopen-btn" data-id="${t.id}">Újra</button>` : ''}
        ${canDel ? `<button class="btn btn-danger btn-xs task-del-btn" data-id="${t.id}">✕</button>` : ''}
      </div>
    </div>`;
  }).join('');
}

export async function saveTask() {
  const cim = E('feladatCim').value.trim();
  if (!cim) { msg('Add meg a feladat címét!', 'error'); E('feladatCim').focus(); return; }
  try {
    await addDoc(collection(db, 'tasks'), {
      cim,
      leiras:    E('feladatLeiras').value.trim(),
      prioritas: E('feladatPrio').value  || 'normal',
      datum:     E('feladatDatum').value || null,
      reszleg:   E('feladatReszleg').value.trim(),
      statusz:   'nyitott',
      createdBy: state.appUser.uid,
      createdAt: serverTimestamp()
    });
    msg('Feladat hozzáadva.');
    E('feladatCim').value = E('feladatLeiras').value = E('feladatDatum').value = '';
    loadTasks();
  } catch (e) { msg('Mentési hiba: ' + e.message, 'error'); }
}

export async function handleTaskClick(e) {
  const doneBtn   = e.target.closest('.task-done-btn');
  const reopenBtn = e.target.closest('.task-reopen-btn');
  const delBtn    = e.target.closest('.task-del-btn');
  if (doneBtn) {
    try {
      await updateDoc(doc(db, 'tasks', doneBtn.dataset.id),
        { statusz: 'kesz', doneBy: state.appUser.uid, doneAt: serverTimestamp() });
      msg('Feladat befejezve!'); loadTasks();
    } catch (err) { msg('Hiba: ' + err.message, 'error'); }
    return;
  }
  if (reopenBtn) {
    try {
      await updateDoc(doc(db, 'tasks', reopenBtn.dataset.id), { statusz: 'nyitott' });
      msg('Feladat újranyitva.'); loadTasks();
    } catch (err) { msg('Hiba: ' + err.message, 'error'); }
    return;
  }
  if (delBtn) {
    if (!confirm('Törlöd ezt a feladatot?')) return;
    try {
      await deleteDoc(doc(db, 'tasks', delBtn.dataset.id));
      msg('Feladat törölve.'); loadTasks();
    } catch (err) { msg('Hiba: ' + err.message, 'error'); }
  }
}
