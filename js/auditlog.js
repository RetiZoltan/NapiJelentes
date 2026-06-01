import { db, collection, addDoc, getDocs, query, orderBy, limit, serverTimestamp } from './firebase.js';
import { state } from './state.js';

export const ACTION_LABELS = {
  'entry.delete':        'Bejegyzés törölve',
  'entry.delete_day':    'Nap összes adata törölve',
  'entry.edit':          'Bejegyzés szerkesztve',
  'employee.create':     'Dolgozó hozzáadva',
  'employee.update':     'Dolgozó módosítva',
  'employee.delete':     'Dolgozó törölve',
  'employee.archive':    'Dolgozó archiválva',
  'task.create':         'Feladat létrehozva',
  'task.delete':         'Feladat törölve',
  'task.status':         'Feladat állapot változott',
  'notice.create':       'Közlemény közzétéve',
  'notice.delete':       'Közlemény törölve',
  'overtime.create':     'Túlóra rögzítve',
  'overtime.delete':     'Túlóra törölve',
  'absence.create':      'Hiányzás rögzítve',
  'absence.delete':      'Hiányzás törölve',
  'auth.login':          'Bejelentkezés',
  'role.create':         'Szerepkör létrehozva',
  'role.update':         'Szerepkör módosítva',
  'role.delete':         'Szerepkör törölve',
  'premium.configSave':  'Prémium konfig mentve',
  'user.disable':        'Felhasználó letiltva',
  'user.enable':         'Felhasználó aktiválva',
  'dailyNote.delete':    'Napi megjegyzés törölve',
};

const ACTION_ICONS = {
  entry:    '📋',
  employee: '👷',
  task:     '📌',
  notice:   '📢',
  overtime: '⏰',
  absence:  '📅',
  auth:     '🔐',
  role:     '🎭',
  premium:  '💰',
  user:     '👤',
  dailyNote:'📝',
};

export async function logAction(action, detail = {}) {
  if (!state.appUser) return;
  try {
    await addDoc(collection(db, 'auditLog'), {
      action,
      userId:   state.appUser.uid,
      userName: state.userData?.displayName || state.appUser.email || 'Ismeretlen',
      detail,
      ts: serverTimestamp()
    });
  } catch (e) { console.warn('logAction failed:', e.message); }
}

export async function loadAuditLog(limitN = 200) {
  const snap = await getDocs(query(collection(db, 'auditLog'), orderBy('ts', 'desc'), limit(limitN)));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/* Szűrhető renderelés */
export function renderAuditLog(list, filters = {}) {
  const { tipusF = '', userF = '', tolF = '', igF = '' } = filters;

  let filtered = list;
  if (tipusF) filtered = filtered.filter(e => (e.action || '').startsWith(tipusF + '.'));
  if (userF)  filtered = filtered.filter(e => e.userId === userF || e.userName === userF);
  if (tolF)   filtered = filtered.filter(e => {
    const d = e.ts?.toDate ? e.ts.toDate().toISOString().slice(0,10) : '';
    return d >= tolF;
  });
  if (igF)    filtered = filtered.filter(e => {
    const d = e.ts?.toDate ? e.ts.toDate().toISOString().slice(0,10) : '';
    return d <= igF;
  });

  if (!filtered.length) {
    return `<div class="empty-st"><div class="empty-ic">📋</div><div class="empty-title">Nincs találat</div></div>`;
  }

  return filtered.map(e => {
    const label    = ACTION_LABELS[e.action] || e.action;
    const category = (e.action || '').split('.')[0] || 'entry';
    const icon     = ACTION_ICONS[category] || '📋';
    const detail   = _formatDetail(e.action, e.detail || {});
    const timeStr  = e.ts?.toDate ? e.ts.toDate().toLocaleString('hu-HU', {
      year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit'
    }) : '—';
    return `<div class="audit-row">
      <div class="audit-icon">${icon}</div>
      <div class="audit-body">
        <div class="audit-action">${_esc(label)}${detail ? ` <span class="audit-detail">${detail}</span>` : ''}</div>
        <div class="audit-meta">${_esc(e.userName || '—')} · ${timeStr}</div>
      </div>
    </div>`;
  }).join('');
}

function _formatDetail(action, d) {
  const parts = [];
  if (d.nev)         parts.push(`<strong>${_esc(d.nev)}</strong>`);
  if (d.cim)         parts.push(`<strong>${_esc(d.cim)}</strong>`);
  if (d.datum)       parts.push(_esc(d.datum));
  if (d.dolgozoNev)  parts.push(_esc(d.dolgozoNev));
  if (d.email)       parts.push(_esc(d.email));
  if (d.count > 1)   parts.push(`${d.count} db`);
  return parts.length ? '— ' + parts.join(', ') : '';
}

function _esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
