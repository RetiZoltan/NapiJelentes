import { db, doc, addDoc, updateDoc, collection, serverTimestamp } from './firebase.js';
import { state } from './state.js';
import { E, msg } from './utils.js';

const QUEUE_KEY = 'nj_offQ2';

function _getQ()       { try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]'); } catch { return []; } }
function _setQ(q)      { localStorage.setItem(QUEUE_KEY, JSON.stringify(q)); }

export function getOfflineOpCount() { return _getQ().length; }

export function queueOp(type, data) {
  const q = _getQ();
  q.push({ type, data, ts: Date.now() });
  _setQ(q);
  _updateBadge();
}

export async function syncOfflineOps() {
  const q = _getQ();
  if (!q.length) return 0;
  const failed = [];
  let saved = 0;
  for (const op of q) {
    try {
      const uid = state.appUser?.uid;
      if (op.type === 'task.create') {
        await addDoc(collection(db, 'tasks'), { ...op.data, createdBy: uid, createdAt: serverTimestamp() });
        saved++;
      } else if (op.type === 'task.status') {
        const upd = { statusz: op.data.statusz };
        if (op.data.statusz === 'kesz') { upd.doneBy = uid; upd.doneAt = serverTimestamp(); }
        else { upd.doneBy = null; upd.doneAt = null; }
        await updateDoc(doc(db, 'tasks', op.data.id), upd);
        saved++;
      } else if (op.type === 'absence.create') {
        await addDoc(collection(db, 'absences'), { ...op.data, createdBy: uid, createdAt: serverTimestamp() });
        saved++;
      } else if (op.type === 'machine.event') {
        await addDoc(collection(db, 'machineEvents'), { ...op.data, createdBy: uid, createdAt: serverTimestamp() });
        saved++;
      }
    } catch { failed.push(op); }
  }
  _setQ(failed);
  _updateBadge();
  if (saved > 0) msg(`${saved} offline művelet szinkronizálva!`, 'success', 4000);
  return saved;
}

function _updateBadge() {
  const cnt = _getQ().length;
  const b = E('offlineBanner2');
  if (!b) return;
  if (cnt > 0) {
    b.style.display = 'flex';
    const c = E('offlineCount2');
    if (c) c.textContent = `(${cnt} várakozó)`;
  } else {
    b.style.display = 'none';
  }
}

export function initOfflineBadge() { _updateBadge(); }
