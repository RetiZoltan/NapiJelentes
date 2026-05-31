import { db, collection, addDoc, getDocs, query, orderBy, limit, serverTimestamp } from './firebase.js';
import { state } from './state.js';

const ACTION_LABELS = {
  'entry.delete':       'Bejegyzés törölve',
  'entry.delete_day':   'Nap törölve',
  'entry.edit':         'Bejegyzés szerkesztve',
  'employee.create':    'Dolgozó hozzáadva',
  'employee.update':    'Dolgozó módosítva',
  'employee.delete':    'Dolgozó törölve',
  'employee.archive':   'Dolgozó archiválva',
  'task.create':        'Feladat létrehozva',
  'task.delete':        'Feladat törölve',
  'task.status':        'Feladat állapot változott',
  'notice.create':      'Közlemény közzétéve',
  'notice.delete':      'Közlemény törölve',
  'overtime.create':    'Túlóra rögzítve',
  'overtime.delete':    'Túlóra törölve',
  'absence.create':     'Hiányzás rögzítve',
  'absence.delete':     'Hiányzás törölve',
};

const ACTION_ICONS = {
  'entry':    '📋',
  'employee': '👷',
  'task':     '📌',
  'notice':   '📢',
  'overtime': '⏰',
  'absence':  '📅',
};

export async function logAction(action, detail = {}) {
  if (!state.appUser) return;
  try {
    await addDoc(collection(db, 'auditLog'), {
      action,
      userId:    state.appUser.uid,
      userName:  state.userData?.displayName || state.appUser.email || 'Ismeretlen',
      detail,
      ts: serverTimestamp()
    });
  } catch {}
}

export async function loadAuditLog(limitN = 100) {
  const snap = await getDocs(query(collection(db, 'auditLog'), orderBy('ts', 'desc'), limit(limitN)));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export function renderAuditLog(list) {
  if (!list.length) {
    return `<div class="empty-st"><div class="empty-ic">📋</div><div class="empty-title">Nincsenek audit bejegyzések</div></div>`;
  }
  return list.map(e => {
    const label    = ACTION_LABELS[e.action] || e.action;
    const category = e.action?.split('.')[0] || 'entry';
    const icon     = ACTION_ICONS[category] || '📋';
    const detail   = _formatDetail(e.action, e.detail || {});
    const timeStr  = e.ts?.toDate ? e.ts.toDate().toLocaleString('hu-HU', {
      month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit'
    }) : '—';
    return `<div class="audit-row">
      <div class="audit-icon">${icon}</div>
      <div class="audit-body">
        <div class="audit-action">${label}${detail ? ` <span class="audit-detail">${detail}</span>` : ''}</div>
        <div class="audit-meta">${escHtml(e.userName || '—')} · ${timeStr}</div>
      </div>
    </div>`;
  }).join('');
}

function _formatDetail(action, d) {
  if (d.nev)          return `— <strong>${escHtml(d.nev)}</strong>`;
  if (d.cim)          return `— <strong>${escHtml(d.cim)}</strong>`;
  if (d.datum)        return `— ${escHtml(d.datum)}`;
  if (d.dolgozoNev)   return `— ${escHtml(d.dolgozoNev)}`;
  return '';
}

function escHtml(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
