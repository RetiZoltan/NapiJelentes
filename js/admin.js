import { db, doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc,
         collection, query, getDocs, orderBy, limit, serverTimestamp, writeBatch } from './firebase.js';
import { logAction, loadAuditLog, renderAuditLog, ACTION_LABELS } from './auditlog.js';
import { state, isMainAdmin, hasPerm, canManageUsers } from './state.js';
import { E, esc, msg, tod } from './utils.js';
import { loadLists } from './db.js';

let editingRoleId = null;

/* ── Felhasználók ── */
export async function loadAdminUsers() {
  if (!canManageUsers()) return;
  E('userLoadingMsg').style.display = 'block';
  E('userTableBody').innerHTML = '';
  try {
    const [usersSnap, rolesSnap] = await Promise.all([
      getDocs(collection(db, 'users')),
      getDocs(collection(db, 'roles'))
    ]);
    const roles = {};
    rolesSnap.docs.forEach(d => { roles[d.id] = { id: d.id, ...d.data() }; });
    E('userLoadingMsg').style.display = 'none';
    if (usersSnap.empty) {
      E('userTableBody').innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--text3);padding:16px;">Nincs felhasználó</td></tr>';
      return;
    }
    usersSnap.docs.forEach(d => {
      const u = { id: d.id, ...d.data() };
      const roleName = u.isMainAdmin
        ? '<span class="role-badge admin">Főadmin</span>'
        : u.roleId
          ? `<span class="role-badge">${esc(roles[u.roleId]?.name || u.roleId)}</span>`
          : '<span class="role-badge pending">Nincs szerepkör</span>';
      const isMe = u.id === state.appUser.uid;
      const lastLogin = u.lastLoginAt?.toDate
        ? u.lastLoginAt.toDate().toLocaleDateString('hu-HU', { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' })
        : '—';
      const disabledBadge = u.isDisabled ? ' <span style="font-size:10px;color:var(--red);font-weight:700;">⛔ letiltva</span>' : '';
      let actions = '';
      if (isMainAdmin() && !u.isMainAdmin) {
        const opts = Object.values(roles).map(r => `<option value="${esc(r.id)}" ${u.roleId === r.id ? 'selected' : ''}>${esc(r.name)}</option>`).join('');
        actions += `<select class="role-select" data-uid="${u.id}" style="font-size:12px;padding:4px 24px 4px 7px;margin-right:4px;"><option value="">— Nincs —</option>${opts}</select>`;
        actions += `<button class="btn btn-xs ${u.isDisabled ? 'btn-ghost' : 'btn-danger'} dis-toggle-btn" data-uid="${u.id}" data-is-disabled="${u.isDisabled ? '1' : '0'}" data-name="${esc(u.displayName||u.email||'')}" ${isMe ? 'disabled' : ''}>${u.isDisabled ? '▶ Aktivál' : '⏸ Letilt'}</button> `;
        actions += `<button class="btn btn-danger btn-xs" data-del-user="${u.id}" ${isMe ? 'disabled' : ''}>Töröl</button>`;
      }
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td style="font-weight:600;color:var(--text);">${esc(u.displayName || '—')}${disabledBadge}</td>
        <td style="font-size:12px;">${esc(u.email || '—')}</td>
        <td>${roleName}</td>
        <td style="font-size:12px;color:var(--text3);">${lastLogin}</td>
        <td>${actions || '—'}</td>`;
      E('userTableBody').appendChild(tr);
    });
  } catch (e) { E('userLoadingMsg').textContent = 'Hiba: ' + e.message; }
}

/* ── Szerepkörök ── */

const ALL_PERMS = [
  { htmlId:'pAdatbevitel',        key:'adatbevitel',          group:'termel'  },
  { htmlId:'pSajatJelentes',      key:'sajatJelentes',        group:'termel'  },
  { htmlId:'pMindenJelentes',     key:'mindenJelentes',       group:'termel'  },
  { htmlId:'pNaptar',             key:'naptar',               group:'termel'  },
  { htmlId:'pElemzes',            key:'elemzes',              group:'termel'  },
  { htmlId:'pAdatExport',         key:'adatExport',           group:'termel'  },
  { htmlId:'pDolgozokMegtekintes',key:'dolgozokMegtekintes',  group:'szervez' },
  { htmlId:'pDolgozokKezeles',    key:'dolgozokKezeles',      group:'szervez' },
  { htmlId:'pFeladatokKezeles',   key:'feladatokKezeles',     group:'szervez' },
  { htmlId:'pKeszletMegtekintes', key:'keszletMegtekintes',   group:'szervez' },
  { htmlId:'pKeszletKezeles',     key:'keszletKezeles',       group:'szervez' },
  { htmlId:'pGepekMegtekintes',   key:'gepekMegtekintes',     group:'szervez' },
  { htmlId:'pGepekKezeles',       key:'gepekKezeles',         group:'szervez' },
  { htmlId:'pPremiumMegtekintes', key:'premiumMegtekintes',   group:'penzugy' },
  { htmlId:'pPremiumKezeles',     key:'premiumKezeles',       group:'penzugy' },
  { htmlId:'pKozlemenyIras',      key:'kozlemenyIras',        group:'admin'   },
  { htmlId:'pFelhasznalok',       key:'felhasznalokKezelese', group:'admin'   },
];

const PERM_LABELS = {
  adatbevitel:'Adatbevitel', sajatJelentes:'Saját jelentés', mindenJelentes:'Mindenki jelentése',
  naptar:'Naptár', elemzes:'Elemzés', adatExport:'Adat export',
  dolgozokMegtekintes:'Dolgozók megtekintés', dolgozokKezeles:'Dolgozók kezelése',
  feladatokKezeles:'Feladatok kezelése', keszletMegtekintes:'Készlet megtekintés', keszletKezeles:'Készlet kezelése', gepekMegtekintes:'Gépek megtekintés', gepekKezeles:'Gépek kezelése', premiumMegtekintes:'Prémium megtekintés',
  premiumKezeles:'Prémium kezelés', kozlemenyIras:'Közlemény írás',
  felhasznalokKezelese:'Felhasználók kezelése',
};

const GROUP_META = {
  termel:  { cls:'role-perm-termel'  },
  szervez: { cls:'role-perm-szervez' },
  penzugy: { cls:'role-perm-penzugy' },
  admin:   { cls:'role-perm-admin'   },
};

const ROLE_TEMPLATES = {
  dolgozo:       { perms: ['adatbevitel','sajatJelentes'] },
  csoportvezeto: { perms: ['adatbevitel','mindenJelentes','naptar','elemzes','feladatokKezeles','adatExport'] },
  hr:            { perms: ['sajatJelentes','mindenJelentes','naptar','dolgozokKezeles','feladatokKezeles','premiumMegtekintes'] },
  konyvelő:      { perms: ['mindenJelentes','premiumMegtekintes','adatExport'] },
};

export function applyRoleTemplate(tplId) {
  const tpl = ROLE_TEMPLATES[tplId]; if (!tpl) return;
  ALL_PERMS.forEach(p => { const el = E(p.htmlId); if (el) el.checked = false; });
  tpl.perms.forEach(key => {
    const p = ALL_PERMS.find(x => x.key === key);
    if (p) { const el = E(p.htmlId); if (el) el.checked = true; }
  });
  E('newRoleForm').classList.add('open');
}

export async function loadRoles() {
  try {
    const snap = await getDocs(collection(db, 'roles'));
    if (snap.empty) {
      E('roleListDiv').innerHTML = `<div class="empty-st"><div class="empty-ic">🎭</div><div class="empty-title">Nincsenek szerepkörök</div><div class="empty-sub">Hozz létre egyet a fenti formmal, vagy indulj el egy sablonból.</div></div>`;
      return;
    }
    E('roleListDiv').innerHTML = snap.docs.map(d => {
      const r = { id: d.id, ...d.data() };
      const active = ALL_PERMS.filter(p => r.permissions?.[p.key]);
      const badges = active.length
        ? active.map(p => `<span class="role-perm-badge ${GROUP_META[p.group].cls}">${PERM_LABELS[p.key] || p.key}</span>`).join('')
        : `<span style="font-size:12px;color:var(--text3);font-style:italic;">Nincs jogosultság</span>`;
      return `<div class="role-card">
        <div class="role-card-hdr">
          <div class="role-card-name">🎭 ${esc(r.name)}</div>
          <div style="display:flex;gap:6px;">
            <button class="btn btn-ghost btn-xs" data-edit-role="${r.id}">✎ Szerkeszt</button>
            <button class="btn btn-danger btn-xs" data-del-role="${r.id}">✕ Töröl</button>
          </div>
        </div>
        <div class="role-card-perms">${badges}</div>
      </div>`;
    }).join('');
  } catch { msg('Szerepkör betöltési hiba', 'error'); }
}

export async function saveRole() {
  const name = E('newRoleNev').value.trim();
  if (!name) { msg('Adj meg nevet!', 'error'); return; }
  const permissions = {};
  ALL_PERMS.forEach(p => { permissions[p.key] = !!E(p.htmlId)?.checked; });
  try {
    if (editingRoleId) {
      await updateDoc(doc(db, 'roles', editingRoleId), { name, permissions });
      logAction('role.update', { nev: name });
      msg('Szerepkör frissítve.');
    } else {
      await addDoc(collection(db, 'roles'), { name, permissions, createdAt: serverTimestamp(), createdBy: state.appUser.uid });
      logAction('role.create', { nev: name });
      msg('Szerepkör létrehozva.');
    }
    cancelRoleForm(); loadRoles();
  } catch (e) { msg('Mentési hiba: ' + e.message, 'error'); }
}

export function cancelRoleForm() {
  E('newRoleForm').classList.remove('open');
  E('newRoleNev').value = '';
  ALL_PERMS.forEach(p => { const el = E(p.htmlId); if (el) el.checked = false; });
  editingRoleId = null;
  E('saveRoleBtn').textContent = 'Mentés';
}

export async function handleRoleListClick(e) {
  const editBtn = e.target.closest('[data-edit-role]');
  const delBtn  = e.target.closest('[data-del-role]');
  if (editBtn) {
    const id = editBtn.dataset.editRole;
    const s  = await getDoc(doc(db, 'roles', id));
    if (!s.exists()) return;
    const r = s.data();
    E('newRoleNev').value = r.name;
    ALL_PERMS.forEach(p => { const el = E(p.htmlId); if (el) el.checked = !!r.permissions?.[p.key]; });
    editingRoleId = id;
    E('newRoleForm').classList.add('open');
    E('saveRoleBtn').textContent = 'Frissítés';
  } else if (delBtn) {
    if (!confirm('Törlöd ezt a szerepkört?')) return;
    const roleSnap = await getDoc(doc(db, 'roles', delBtn.dataset.delRole));
    const roleName = roleSnap.exists() ? roleSnap.data().name : '—';
    await deleteDoc(doc(db, 'roles', delBtn.dataset.delRole));
    logAction('role.delete', { nev: roleName });
    msg('Szerepkör törölve.'); loadRoles();
  }
}

/* ── Közlemény ── */
const NOTICE_TYPES = {
  info:         { label: 'Tájékoztatás',   icon: 'ℹ️'  },
  warning:      { label: 'Figyelmeztetés', icon: '⚠️'  },
  success:      { label: 'Jó hír',         icon: '✅'  },
  urgent:       { label: 'Sürgős',         icon: '🔴'  },
  esemeny:      { label: 'Esemény',        icon: '📅'  },
  karbantartas: { label: 'Karbantartás',   icon: '🔧'  },
  hir:          { label: 'Hír',            icon: '🎉'  },
};

export async function loadNoticeAdmin() {
  const celSel = E('noticeCelSel');
  if (celSel) {
    const prev = celSel.value;
    celSel.innerHTML =
      '<option value="mindenki">👥 Mindenki</option>' +
      '<option value="admin">🔐 Csak adminok</option>' +
      (state.reszlegek || []).map(r => `<option value="reszleg:${esc(r)}">📍 ${esc(r)} részleg</option>`).join('');
    if (prev) celSel.value = prev;
  }
  const div = E('noticeListDiv'); if (!div) return;
  div.innerHTML = '<div style="text-align:center;padding:16px;color:var(--text3);font-size:13px;">Betöltés…</div>';
  try {
    const snap = await getDocs(query(collection(db, 'notices'), orderBy('createdAt', 'desc')));
    _renderAdminNotices(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  } catch (e) { msg('Betöltési hiba: ' + e.message, 'error'); }
}

function _renderAdminNotices(list) {
  const today = tod();
  if (!list.length) {
    E('noticeListDiv').innerHTML = `<div class="empty-st"><div class="empty-ic">📢</div><div class="empty-title">Nincsenek közlemények</div><div class="empty-sub">Adj hozzá egyet a fenti formmal.</div></div>`;
    return;
  }
  E('noticeListDiv').innerHTML = list.map(n => {
    const tip     = NOTICE_TYPES[n.tipus] || NOTICE_TYPES.info;
    const expired = n.lejarat && n.lejarat < today;
    const readCnt = (n.readBy || []).length;
    const celLabel = n.cel === 'admin' ? '🔐 Csak admin'
                   : n.cel?.startsWith('reszleg:') ? '📍 ' + n.cel.replace('reszleg:', '')
                   : '👥 Mindenki';
    return `<div class="notice-card notice-card-${esc(n.tipus)}${expired ? ' notice-expired' : ''}" style="position:relative;padding-right:44px;margin-bottom:8px;">
      <div class="notice-card-icon">${tip.icon}</div>
      <div class="notice-card-body">
        <div class="notice-card-text">${esc(n.szoveg)}</div>
        <div class="notice-card-meta">
          <span class="notice-meta-badge">${esc(tip.label)}</span>
          <span class="notice-meta-badge">${celLabel}</span>
          ${n.lejarat ? `<span class="notice-meta-badge${expired ? ' notice-meta-expired' : ''}">⏱ ${esc(n.lejarat)}${expired ? ' (lejárt)' : ''}</span>` : ''}
          ${readCnt > 0 ? `<span class="notice-meta-badge">👁 ${readCnt} elolvasva</span>` : ''}
          ${n.createdByName ? `<span style="color:var(--text3);">— ${esc(n.createdByName)}</span>` : ''}
        </div>
      </div>
      <button class="btn btn-danger btn-xs notice-adm-del" data-id="${n.id}" data-szoveg="${esc(n.szoveg?.slice(0,60)||'')}" style="position:absolute;top:12px;right:12px;">✕</button>
    </div>`;
  }).join('');
  E('noticeListDiv').querySelectorAll('.notice-adm-del').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Törlöd ezt a közleményt?')) return;
      try {
        await deleteDoc(doc(db, 'notices', btn.dataset.id));
        logAction('notice.delete', { szoveg: btn.dataset.szoveg || '—' });
        msg('Közlemény törölve.'); loadNoticeAdmin();
      } catch (err) { msg('Hiba: ' + err.message, 'error'); }
    });
  });
}

export async function saveNotice() {
  if (!isMainAdmin() && !hasPerm('kozlemenyIras') && !canManageUsers()) {
    msg('Nincs jogosultságod közlemény írásához!', 'error'); return;
  }
  const szoveg = E('noticeInput').value.trim();
  if (!szoveg) { msg('Írj be szöveget!', 'error'); E('noticeInput').focus(); return; }
  try {
    await addDoc(collection(db, 'notices'), {
      szoveg,
      tipus:        E('noticeTypeSelect').value  || 'info',
      cel:          E('noticeCelSel')?.value      || 'mindenki',
      lejarat:      E('noticeLejarat')?.value     || null,
      readBy:       [],
      createdBy:    state.appUser.uid,
      createdByName: state.userData?.displayName || state.appUser.email || 'Admin',
      createdAt:    serverTimestamp()
    });
    logAction('notice.create', { szoveg: szoveg.slice(0, 60) });
    msg('Közlemény közzétéve.');
    E('noticeInput').value = '';
    if (E('noticeLejarat')) E('noticeLejarat').value = '';
    loadNoticeAdmin();
  } catch (e) { msg('Hiba: ' + e.message, 'error'); }
}

export function clearNotice() {}
export function applyAuditFilter() { _renderFilteredAudit(); }

/* ── Audit log ── */
let _auditCache = [];

export async function loadAuditLogAdmin() {
  const div = E('auditLogDiv'); if (!div) return;
  div.innerHTML = '<div style="text-align:center;padding:16px;color:var(--text3);">Betöltés…</div>';
  try {
    _auditCache = await loadAuditLog(500);
    // Felhasználó szűrő feltöltése
    const userSel = E('auditUserF');
    if (userSel) {
      const users = [...new Map(_auditCache.map(e => [e.userId, e.userName])).entries()].sort((a,b)=>a[1].localeCompare(b[1],'hu'));
      userSel.innerHTML = '<option value="">— Mindenki —</option>' + users.map(([uid,name]) => `<option value="${uid}">${name}</option>`).join('');
    }
    _renderFilteredAudit();
  } catch (e) { div.innerHTML = `<div class="empty-st"><div class="empty-ic">⚠️</div><div class="empty-title">Betöltési hiba</div></div>`; }
}

function _renderFilteredAudit() {
  const div = E('auditLogDiv'); if (!div) return;
  const filters = {
    tipusF: E('auditTipusF')?.value || '',
    userF:  E('auditUserF')?.value  || '',
    tolF:   E('auditTolF')?.value   || '',
    igF:    E('auditIgF')?.value    || '',
  };
  div.innerHTML = renderAuditLog(_auditCache, filters);
  const cnt = E('auditCount');
  if (cnt) {
    const total = _auditCache.length;
    const shown = div.querySelectorAll('.audit-row').length;
    cnt.textContent = shown < total ? `${shown} / ${total} bejegyzés` : `${total} bejegyzés`;
  }
}

/* ── Fájl export / import ── */
export async function mentFajl() {
  try {
    const [eSnap, nSnap, mSnap] = await Promise.all([
      getDocs(collection(db, 'entries')),
      getDoc(doc(db, 'config', 'lists')),
      getDocs(collection(db, 'dailyNotes'))
    ]);
    const data = {
      entries:    eSnap.docs.map(d => ({ id: d.id, ...d.data(), createdAt: d.data().createdAt?.toDate?.()?.toISOString() })),
      lists:      nSnap.exists() ? nSnap.data() : {},
      dailyNotes: Object.fromEntries(mSnap.docs.map(d => [d.id, d.data().szoveg])),
      exportDate: new Date().toISOString()
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.download = `napi_jelentes_${tod()}.json`;
    a.href = URL.createObjectURL(blob);
    a.click();
    URL.revokeObjectURL(a.href);
    msg('Fájl mentve!');
  } catch (e) { msg('Export hiba: ' + e.message, 'error'); }
}

export async function betoltFajl(e) {
  const f = e.target.files[0]; if (!f) return;
  const r = new FileReader();
  r.onload = async ev => {
    try {
      const data = JSON.parse(ev.target.result);
      if (!confirm('Betöltés felülírja az összes jelenlegi adatot! Folytatod?')) return;
      msg('Betöltés folyamatban…', 'info', 10000);
      const batch = writeBatch(db);
      if (data.entries) {
        data.entries.forEach(entry => {
          const { id, ...rest } = entry;
          batch.set(doc(collection(db, 'entries')), { ...rest, createdAt: serverTimestamp() });
        });
      }
      await batch.commit();
      if (data.lists) await setDoc(doc(db, 'config', 'lists'), data.lists);
      if (data.dailyNotes) {
        const nb = writeBatch(db);
        Object.entries(data.dailyNotes).forEach(([d, s]) => nb.set(doc(db, 'dailyNotes', d), { szoveg: s, updatedBy: state.appUser.uid, updatedAt: serverTimestamp() }));
        await nb.commit();
      }
      msg('Adatok betöltve!');
      await loadLists();
    } catch { msg('Érvénytelen fájl!', 'error'); }
  };
  r.readAsText(f);
  e.target.value = '';
}

export async function mindTorol() {
  if (!confirm('FIGYELEM! Minden bejegyzés véglegesen törlődik!')) return;
  if (!confirm('Biztosan? Ez NEM visszavonható!')) return;
  try {
    msg('Törlés folyamatban…', 'info', 10000);
    const snap  = await getDocs(collection(db, 'entries'));
    const batch = writeBatch(db);
    snap.docs.forEach(d => batch.delete(d.ref));
    await batch.commit();
    msg('Minden bejegyzés törölve.');
  } catch (e) { msg('Törlési hiba: ' + e.message, 'error'); }
}

/* ── Belépési napló ── */
function _parseDevice(ua) {
  if (!ua) return '—';
  const mobile = /iPhone|iPad|Android|Mobile/i.test(ua);
  let os = 'Egyéb';
  if (/Windows NT 1[01]/i.test(ua))   os = 'Windows 10/11';
  else if (/Windows/i.test(ua))        os = 'Windows';
  else if (/Mac OS X/i.test(ua))       os = 'macOS';
  else if (/Android/i.test(ua))        os = 'Android';
  else if (/iPhone|iPad/i.test(ua))    os = 'iOS';
  else if (/Linux/i.test(ua))          os = 'Linux';
  let browser = '';
  if (/Edg\//i.test(ua))              browser = 'Edge';
  else if (/OPR\//i.test(ua))         browser = 'Opera';
  else if (/Chrome\//i.test(ua))      browser = 'Chrome';
  else if (/Firefox\//i.test(ua))     browser = 'Firefox';
  else if (/Safari\//i.test(ua))      browser = 'Safari';
  return `${mobile ? '📱' : '💻'} ${os}${browser ? ' · ' + browser : ''}`;
}

export async function loadLoginLog() {
  const div = E('loginLogDiv'); if (!div) return;
  div.innerHTML = '<div class="spinner" style="margin:24px auto"></div>';
  try {
    const snap = await getDocs(query(collection(db, 'auditLog'), orderBy('ts', 'desc'), limit(1000)));
    const logins = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(e => e.action === 'auth.login');
    const cnt = E('loginLogCount');
    if (cnt) cnt.textContent = logins.length + ' belépés';
    if (!logins.length) {
      div.innerHTML = '<div class="empty-st"><div class="empty-ic">🔐</div><div class="empty-title">Nincs belépési adat</div><div class="empty-sub">Az első bejelentkezéstől kezdve rögzül.</div></div>';
      return;
    }
    div.innerHTML = `<div style="overflow-x:auto"><table class="user-tbl">
      <thead><tr>
        <th style="text-align:left;padding:8px 12px">Felhasználó</th>
        <th style="text-align:left;padding:8px 12px">Dátum / Idő</th>
        <th style="text-align:left;padding:8px 12px">Eszköz</th>
      </tr></thead>
      <tbody>
        ${logins.map(e => {
          const time = e.ts?.toDate ? e.ts.toDate().toLocaleString('hu-HU', {
            year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit'
          }) : '—';
          return `<tr>
            <td style="padding:9px 12px">
              <div style="font-weight:600;font-size:13.5px">${esc(e.userName || '—')}</div>
              <div style="font-size:11.5px;color:var(--text3)">${esc(e.detail?.email || '')}</div>
            </td>
            <td style="padding:9px 12px;font-size:13px;white-space:nowrap;color:var(--text2)">${time}</td>
            <td style="padding:9px 12px;font-size:13px;color:var(--text2)">${_parseDevice(e.detail?.ua)}</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table></div>`;
  } catch (e) { div.innerHTML = `<p style="color:var(--red);padding:12px">Hiba: ${esc(e.message)}</p>`; }
}

/* ── Teljes adatexport (Excel) ── */
function _flattenDoc(obj, prefix = '') {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v === null || v === undefined)    out[key] = '';
    else if (v?.toDate)                   out[key] = v.toDate().toLocaleString('hu-HU');
    else if (Array.isArray(v))            out[key] = JSON.stringify(v);
    else if (typeof v === 'object')       Object.assign(out, _flattenDoc(v, key));
    else                                  out[key] = v;
  }
  return out;
}

export async function exportAllDataExcel() {
  const XLSX = window.XLSX;
  if (!XLSX) { msg('XLSX könyvtár nem elérhető!', 'error'); return; }
  try {
    msg('Export folyamatban…', 'info', 20000);
    const wb = XLSX.utils.book_new();
    const SHEETS = [
      { col: 'entries',        name: 'Bejegyzések' },
      { col: 'employees',      name: 'Dolgozók' },
      { col: 'absences',       name: 'Hiányzások' },
      { col: 'tasks',          name: 'Feladatok' },
      { col: 'machines',       name: 'Gépek' },
      { col: 'machineEvents',  name: 'Gép események' },
      { col: 'stockLocations', name: 'Raktárhelyek' },
      { col: 'stockMovements', name: 'Készlet mozgások' },
      { col: 'premiumHistory', name: 'Prémium előzmények' },
      { col: 'overtimes',      name: 'Túlórák' },
      { col: 'megkezdettZsakok', name: 'WIP zsákok' },
    ];
    for (const { col, name } of SHEETS) {
      try {
        const snap = await getDocs(collection(db, col));
        const rows = snap.docs.map(d => _flattenDoc({ id: d.id, ...d.data() }));
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.length ? rows : [{ info: 'Nincs adat' }]), name);
      } catch { /* gyűjtemény kihagyva hiba esetén */ }
    }
    const fn = `plexiq_export_${tod()}.xlsx`;
    XLSX.writeFile(wb, fn);
    msg(`Export kész: ${fn}`, 'success', 6000);
  } catch (e) { msg('Export hiba: ' + e.message, 'error'); }
}
