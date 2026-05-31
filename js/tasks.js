import { db, doc, getDoc, addDoc, updateDoc, deleteDoc,
         collection, query, getDocs, orderBy, serverTimestamp } from './firebase.js';
import { state, isMainAdmin, hasPerm } from './state.js';
import { E, esc, msg, tod, addD, ag, skelHtml } from './utils.js';

let _viewMode   = 'list';  // 'list' | 'kanban'
let _users      = [];      // { uid, name } cache
let _uiInited   = false;
let _currentTask = null;   // open in drawer

const STATUS_LABEL = { nyitott: 'Nyitott', folyamatban: 'Folyamatban', kesz: 'Kész' };
const STATUS_COLOR = { nyitott: 'var(--accent)', folyamatban: 'var(--amber)', kesz: 'var(--green)' };
const STATUS_NEXT  = { nyitott: 'folyamatban', folyamatban: 'kesz' };

/* ────────────────────────────────────────
   Init & felhasználók
──────────────────────────────────────── */
export function initTasksUI() {
  if (_uiInited) return;
  _uiInited = true;
  // Feladat létrehozó form: csak ha van feladatokKezeles jog
  const canCreate = isMainAdmin() || hasPerm('feladatokKezeles');
  const formCard = E('ujFeladatCard');
  if (formCard) formCard.style.display = canCreate ? '' : 'none';

  E('taskViewList').addEventListener('click', () => {
    _viewMode = 'list';
    E('taskViewList').classList.add('active');
    E('taskViewKanban').classList.remove('active');
    loadTasks();
  });
  E('taskViewKanban').addEventListener('click', () => {
    _viewMode = 'kanban';
    E('taskViewKanban').classList.add('active');
    E('taskViewList').classList.remove('active');
    loadTasks();
  });
  _loadUsers();
}

async function _loadUsers() {
  try {
    const snap = await getDocs(collection(db, 'users'));
    _users = snap.docs
      .map(d => ({ uid: d.id, name: d.data().displayName || d.data().email || 'Ismeretlen' }))
      .filter(u => u.name)
      .sort((a, b) => a.name.localeCompare(b.name, 'hu'));
    _fillFelelosSelects();
  } catch {}
}

function _fillFelelosSelects() {
  const opts = '<option value="">— Senki —</option>' +
    _users.map(u => `<option value="${esc(u.uid)}">${esc(u.name)}</option>`).join('');
  [E('feladatFelelos')].forEach(sel => { if (sel) sel.innerHTML = opts; });
}

function _userName(uid) {
  if (!uid) return null;
  return _users.find(u => u.uid === uid)?.name || null;
}

/* ────────────────────────────────────────
   Betöltés
──────────────────────────────────────── */
export async function loadTasks() {
  const statuszF = E('feladatStatuszF')?.value || 'nyitott';
  const reszlegF = E('feladatReszlegF')?.value || '';
  E('feladatListDiv').innerHTML = skelHtml('tasks');
  try {
    const snap = await getDocs(query(collection(db, 'tasks'), orderBy('createdAt', 'desc')));
    let list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (_viewMode === 'list' && statuszF !== 'mind') list = list.filter(t => t.statusz === statuszF);
    if (reszlegF) list = list.filter(t => !t.reszleg || t.reszleg === reszlegF);
    if (_viewMode === 'kanban') _renderKanban(list);
    else _renderList(list, statuszF);
  } catch (e) { msg('Betöltési hiba: ' + e.message, 'error'); }
}

/* ────────────────────────────────────────
   Lista nézet
──────────────────────────────────────── */
function _renderList(list, statuszF) {
  const div = E('feladatListDiv'); if (!div) return;
  if (!list.length) {
    const emptyMap = { kesz: ['✅', 'Nincs befejezett feladat'], folyamatban: ['◑', 'Nincs folyamatban lévő feladat'] };
    const [ic, txt] = emptyMap[statuszF] || ['📌', 'Nincs nyitott feladat'];
    div.innerHTML = `<div class="empty-st"><div class="empty-ic">${ic}</div><div class="empty-title">${txt}</div></div>`;
    return;
  }
  const today = tod();
  div.innerHTML = list.map(t => {
    const fontos  = t.prioritas === 'fontos';
    const kesz    = t.statusz === 'kesz';
    const lejart  = !kesz && t.datum && t.datum < today;
    const soon    = !kesz && !lejart && t.datum && t.datum <= addD(today, 3);
    const canDel  = isMainAdmin() || t.createdBy === state.appUser.uid;
    const canMove = !kesz && (isMainAdmin() || t.createdBy === state.appUser.uid || t.assignedTo === state.appUser.uid);
    const nextSt  = STATUS_NEXT[t.statusz];
    const assignee = _userName(t.assignedTo);

    return `<div class="task-card${kesz ? ' task-done' : ''}${fontos && !kesz ? ' task-fontos' : ''}" data-taskid="${t.id}" style="cursor:pointer;">
      <div class="task-prio-dot ${fontos ? 'task-prio-fontos' : 'task-prio-normal'}"></div>
      <div style="flex:1;min-width:0;">
        <div class="task-cim${kesz ? ' task-cim-done' : ''}">${esc(t.cim)}</div>
        ${t.leiras ? `<div class="task-leiras">${esc(t.leiras)}</div>` : ''}
        <div class="task-meta">
          ${t.reszleg  ? `<span>📍 ${esc(t.reszleg)}</span>` : ''}
          ${t.datum    ? `<span style="${lejart ? 'color:var(--red);font-weight:600;' : soon ? 'color:var(--amber);font-weight:600;' : ''}">📅 ${esc(t.datum)}${lejart ? ' ⚠️' : ''}</span>` : ''}
          ${assignee   ? `<span>👤 ${esc(assignee)}</span>` : ''}
          <span style="color:${STATUS_COLOR[t.statusz] || 'var(--text3)'};font-weight:600;font-size:11px;">${STATUS_LABEL[t.statusz] || t.statusz}</span>
        </div>
      </div>
      <div style="display:flex;gap:5px;flex-shrink:0;align-items:center;" onclick="event.stopPropagation()">
        ${canMove && nextSt ? `<button class="btn btn-primary btn-xs task-move-btn" data-id="${t.id}" data-next="${nextSt}" title="→ ${STATUS_LABEL[nextSt]}">→</button>` : ''}
        ${kesz && isMainAdmin() ? `<button class="btn btn-ghost btn-xs task-reopen-btn" data-id="${t.id}" title="Újranyit">↩</button>` : ''}
        ${canDel ? `<button class="btn btn-danger btn-xs task-del-btn" data-id="${t.id}">✕</button>` : ''}
      </div>
    </div>`;
  }).join('');
}

/* ────────────────────────────────────────
   Kanban nézet
──────────────────────────────────────── */
function _renderKanban(list) {
  const today = tod();

  function kanbanCard(t) {
    const fontos  = t.prioritas === 'fontos';
    const lejart  = t.statusz !== 'kesz' && t.datum && t.datum < today;
    const assignee = _userName(t.assignedTo);
    const canMove = t.statusz !== 'kesz' &&
      (isMainAdmin() || t.createdBy === state.appUser.uid || t.assignedTo === state.appUser.uid);
    const nextSt = STATUS_NEXT[t.statusz];

    return `<div class="kanban-task${fontos ? ' kanban-task-fontos' : ''}" data-taskid="${t.id}">
      <div class="kanban-task-cim">${esc(t.cim)}</div>
      ${t.leiras ? `<div class="task-leiras" style="font-size:11.5px;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;">${esc(t.leiras)}</div>` : ''}
      <div class="kanban-task-meta">
        ${t.reszleg ? `<span>📍 ${esc(t.reszleg)}</span>` : ''}
        ${t.datum   ? `<span style="${lejart ? 'color:var(--red);font-weight:600;' : ''}">📅 ${esc(t.datum)}${lejart ? ' ⚠️' : ''}</span>` : ''}
        ${assignee  ? `<span>👤 ${esc(assignee)}</span>` : ''}
      </div>
      ${canMove && nextSt ? `<div style="text-align:right;margin-top:7px;" onclick="event.stopPropagation()">
        <button class="btn btn-ghost btn-xs task-move-btn" data-id="${t.id}" data-next="${nextSt}">→ ${STATUS_LABEL[nextSt]}</button>
      </div>` : ''}
    </div>`;
  }

  const html = `<div class="kanban-board">${['nyitott','folyamatban','kesz'].map(st => {
    const tasks = list.filter(t => (t.statusz || 'nyitott') === st);
    return `<div class="kanban-col">
      <div class="kanban-col-hdr" style="color:${STATUS_COLOR[st]};">
        <div style="width:8px;height:8px;border-radius:50%;background:${STATUS_COLOR[st]};flex-shrink:0;"></div>
        ${STATUS_LABEL[st]}
        <span class="kanban-badge">${tasks.length}</span>
      </div>
      ${tasks.length
        ? tasks.map(kanbanCard).join('')
        : `<div style="text-align:center;padding:24px 0;font-size:12px;color:var(--text3);">Üres</div>`}
    </div>`;
  }).join('')}</div>`;

  E('feladatListDiv').innerHTML = html;
}

/* ────────────────────────────────────────
   Feladat létrehozása
──────────────────────────────────────── */
export async function saveTask() {
  if (!isMainAdmin() && !hasPerm('feladatokKezeles')) {
    msg('Nincs jogosultságod feladat létrehozásához!', 'error'); return;
  }
  const cim = E('feladatCim').value.trim();
  if (!cim) { msg('Add meg a feladat címét!', 'error'); E('feladatCim').focus(); return; }
  try {
    await addDoc(collection(db, 'tasks'), {
      cim,
      leiras:     E('feladatLeiras').value.trim() || '',
      prioritas:  E('feladatPrio').value || 'normal',
      datum:      E('feladatDatum').value || null,
      reszleg:    E('feladatReszleg').value.trim() || '',
      assignedTo: E('feladatFelelos')?.value || null,
      statusz:    'nyitott',
      createdBy:  state.appUser.uid,
      createdAt:  serverTimestamp()
    });
    msg('Feladat hozzáadva.');
    E('feladatCim').value = E('feladatLeiras').value = E('feladatDatum').value = '';
    if (E('feladatFelelos')) E('feladatFelelos').value = '';
    loadTasks();
  } catch (e) { msg('Mentési hiba: ' + e.message, 'error'); }
}

/* ────────────────────────────────────────
   Drawer
──────────────────────────────────────── */
export function openTaskDrawer(task) {
  _currentTask = task;
  const canEdit = isMainAdmin() || task.createdBy === state.appUser.uid || task.assignedTo === state.appUser.uid;
  const canDel  = isMainAdmin() || task.createdBy === state.appUser.uid;

  // Header
  E('taskDrawerPrioIcon').textContent       = task.prioritas === 'fontos' ? '⚡' : '📌';
  E('taskDrawerPrioIcon').style.background  = task.prioritas === 'fontos' ? 'var(--redl)' : 'var(--agl)';
  E('taskDrawerPrioIcon').style.color       = task.prioritas === 'fontos' ? 'var(--red)'  : 'var(--accent)';
  E('taskDrawerTitle').textContent          = task.cim;
  E('taskDrawerStatus').innerHTML = `<span style="color:${STATUS_COLOR[task.statusz] || 'var(--text3)'};font-weight:600;font-size:13px;">
    ${STATUS_LABEL[task.statusz] || task.statusz}</span>`;

  let body = '';

  if (canEdit) {
    const userOpts = '<option value="">— Senki —</option>' +
      _users.map(u => `<option value="${esc(u.uid)}"${u.uid === task.assignedTo ? ' selected' : ''}>${esc(u.name)}</option>`).join('');
    body += `
    <div class="emp-drawer-section">
      <div class="field"><label class="lbl">Cím</label><input type="text" id="dtCim" value="${esc(task.cim)}"></div>
      <div class="field"><label class="lbl">Leírás</label><textarea id="dtLeiras" style="min-height:70px;resize:vertical;">${esc(task.leiras || '')}</textarea></div>
      <div class="g2">
        <div class="field"><label class="lbl">Prioritás</label>
          <select id="dtPrio">
            <option value="normal"${task.prioritas !== 'fontos' ? ' selected' : ''}>Normal</option>
            <option value="fontos"${task.prioritas === 'fontos' ? ' selected' : ''}>⚡ Fontos</option>
          </select>
        </div>
        <div class="field"><label class="lbl">Határidő</label><input type="date" id="dtDatum" value="${esc(task.datum || '')}"></div>
      </div>
      <div class="g2">
        <div class="field"><label class="lbl">Részleg</label>
          <input list="reszlegDL" id="dtReszleg" value="${esc(task.reszleg || '')}" autocomplete="off" placeholder="Opcionális…">
        </div>
        <div class="field"><label class="lbl">Felelős</label><select id="dtFelelos">${userOpts}</select></div>
      </div>
    </div>
    <div class="emp-drawer-section">
      <div class="emp-drawer-section-title">Állapot módosítása</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        ${['nyitott','folyamatban','kesz'].map(st =>
          `<button class="btn btn-sm${task.statusz === st ? ' btn-primary' : ' btn-ghost'} dt-st-btn" data-st="${st}">
            ${st === 'nyitott' ? '○' : st === 'folyamatban' ? '◑' : '●'} ${STATUS_LABEL[st]}
          </button>`
        ).join('')}
      </div>
    </div>`;
  } else {
    body += `
    <div class="emp-drawer-section">
      ${task.leiras ? `<p style="font-size:13.5px;color:var(--text2);white-space:pre-wrap;margin:0 0 12px;">${esc(task.leiras)}</p>` : ''}
      <div class="emp-drawer-row"><span class="emp-drawer-row-icon">⚡</span>${task.prioritas === 'fontos' ? 'Fontos' : 'Normal'}</div>
      ${task.datum   ? `<div class="emp-drawer-row"><span class="emp-drawer-row-icon">📅</span>${esc(task.datum)}</div>` : ''}
      ${task.reszleg ? `<div class="emp-drawer-row"><span class="emp-drawer-row-icon">📍</span>${esc(task.reszleg)}</div>` : ''}
      ${task.assignedTo ? `<div class="emp-drawer-row"><span class="emp-drawer-row-icon">👤</span>${esc(_userName(task.assignedTo) || '—')}</div>` : ''}
    </div>`;
  }

  // Metadata
  const createdBy = _userName(task.createdBy) || '—';
  const doneBy    = task.doneBy ? (_userName(task.doneBy) || '—') : null;
  body += `
  <div class="emp-drawer-section">
    <div class="emp-drawer-section-title">Előzmény</div>
    <div class="emp-drawer-row"><span class="emp-drawer-row-icon">🕐</span>Létrehozta: <strong style="margin-left:3px;">${esc(createdBy)}</strong></div>
    ${doneBy ? `<div class="emp-drawer-row"><span class="emp-drawer-row-icon">✓</span>Lezárta: <strong style="margin-left:3px;">${esc(doneBy)}</strong></div>` : ''}
  </div>`;

  body += `<div class="emp-drawer-actions">
    ${canEdit ? `<button class="btn btn-primary" id="dtSaveBtn" style="flex:1;">✓ Mentés</button>` : ''}
    ${canDel  ? `<button class="btn btn-danger"  id="dtDelBtn">🗑</button>`  : ''}
  </div>`;

  E('taskDrawerBody').innerHTML = body;

  // Textarea auto-resize
  const ta = E('dtLeiras');
  if (ta) { ag(ta); ta.addEventListener('input', () => ag(ta)); }

  // Button wiring
  if (canEdit) {
    E('dtSaveBtn').addEventListener('click', _saveFromDrawer);
    E('taskDrawerBody').querySelectorAll('.dt-st-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const upd = { statusz: btn.dataset.st };
        if (btn.dataset.st === 'kesz') { upd.doneBy = state.appUser.uid; upd.doneAt = serverTimestamp(); }
        else { upd.doneBy = null; upd.doneAt = null; }
        try { await updateDoc(doc(db, 'tasks', _currentTask.id), upd); closeTaskDrawer(); loadTasks(); }
        catch (err) { msg('Hiba: ' + err.message, 'error'); }
      });
    });
  }
  if (canDel) {
    E('dtDelBtn').addEventListener('click', async () => {
      if (!confirm('Törlöd ezt a feladatot?')) return;
      try { await deleteDoc(doc(db, 'tasks', _currentTask.id)); msg('Feladat törölve.'); closeTaskDrawer(); loadTasks(); }
      catch (err) { msg('Hiba: ' + err.message, 'error'); }
    });
  }

  E('taskDrawer').classList.add('open');
  E('taskDrawerOverlay').classList.add('open');
}

async function _saveFromDrawer() {
  if (!_currentTask) return;
  const cim = E('dtCim')?.value.trim();
  if (!cim) { msg('A cím nem lehet üres!', 'error'); return; }
  try {
    await updateDoc(doc(db, 'tasks', _currentTask.id), {
      cim,
      leiras:     E('dtLeiras')?.value.trim()  || '',
      prioritas:  E('dtPrio')?.value           || 'normal',
      datum:      E('dtDatum')?.value           || null,
      reszleg:    E('dtReszleg')?.value.trim()  || '',
      assignedTo: E('dtFelelos')?.value         || null,
    });
    msg('Feladat frissítve.');
    closeTaskDrawer();
    loadTasks();
  } catch (err) { msg('Mentési hiba: ' + err.message, 'error'); }
}

export function closeTaskDrawer() {
  E('taskDrawer').classList.remove('open');
  E('taskDrawerOverlay').classList.remove('open');
  _currentTask = null;
}

/* ────────────────────────────────────────
   Klikk handler
──────────────────────────────────────── */
export async function handleTaskClick(e) {
  // Gyors státusz-léptetés (→ gomb)
  const moveBtn = e.target.closest('.task-move-btn');
  if (moveBtn) {
    const { id, next } = moveBtn.dataset;
    const upd = { statusz: next };
    if (next === 'kesz') { upd.doneBy = state.appUser.uid; upd.doneAt = serverTimestamp(); }
    else { upd.doneBy = null; upd.doneAt = null; }
    try { await updateDoc(doc(db, 'tasks', id), upd); loadTasks(); }
    catch (err) { msg('Hiba: ' + err.message, 'error'); }
    return;
  }

  // Újranyitás
  const reopenBtn = e.target.closest('.task-reopen-btn');
  if (reopenBtn) {
    try { await updateDoc(doc(db, 'tasks', reopenBtn.dataset.id), { statusz: 'nyitott', doneBy: null, doneAt: null }); loadTasks(); }
    catch (err) { msg('Hiba: ' + err.message, 'error'); }
    return;
  }

  // Törlés (lista nézet gombból)
  const delBtn = e.target.closest('.task-del-btn');
  if (delBtn) {
    if (!confirm('Törlöd ezt a feladatot?')) return;
    try { await deleteDoc(doc(db, 'tasks', delBtn.dataset.id)); msg('Feladat törölve.'); loadTasks(); }
    catch (err) { msg('Hiba: ' + err.message, 'error'); }
    return;
  }

  // Kártyára kattintva drawer nyílik
  const card = e.target.closest('[data-taskid]');
  if (card) {
    try {
      const snap = await getDoc(doc(db, 'tasks', card.dataset.taskid));
      if (snap.exists()) openTaskDrawer({ id: snap.id, ...snap.data() });
    } catch (err) { msg('Hiba: ' + err.message, 'error'); }
  }
}
