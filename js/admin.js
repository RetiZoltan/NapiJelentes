import { db, doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc,
         collection, query, getDocs, orderBy, serverTimestamp, writeBatch } from './firebase.js';
import { state, isMainAdmin, canManageUsers } from './state.js';
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
      let actions = '';
      if (isMainAdmin() && !u.isMainAdmin) {
        const opts = Object.values(roles).map(r => `<option value="${esc(r.id)}" ${u.roleId === r.id ? 'selected' : ''}>${esc(r.name)}</option>`).join('');
        actions += `<select class="role-select" data-uid="${u.id}" style="font-size:12px;padding:4px 24px 4px 7px;margin-right:6px;"><option value="">— Nincs —</option>${opts}</select>`;
        actions += `<button class="btn btn-danger btn-xs" data-del-user="${u.id}" ${isMe ? 'disabled' : ''}>Töröl</button>`;
      }
      const tr = document.createElement('tr');
      tr.innerHTML = `<td style="font-weight:600;color:var(--text);">${esc(u.displayName || '—')}</td><td style="font-size:12px;">${esc(u.email || '—')}</td><td>${roleName}</td><td>${actions || '—'}</td>`;
      E('userTableBody').appendChild(tr);
    });
  } catch (e) { E('userLoadingMsg').textContent = 'Hiba: ' + e.message; }
}

/* ── Szerepkörök ── */
export async function loadRoles() {
  try {
    const snap = await getDocs(collection(db, 'roles'));
    if (snap.empty) { E('roleListDiv').innerHTML = '<div style="color:var(--text3);font-size:13px;text-align:center;padding:16px;">Még nincs szerepkör</div>'; return; }
    const permLabel = { adatbevitel: 'Adatbevitel', sajatJelentes: 'Saját jelent.', mindenJelentes: 'Mindenki jelent.', naptar: 'Naptár', elemzes: 'Elemzés', felhasznalokKezelese: 'Felh. kezelése', premiumMegtekintes: 'Prémium megtekintés', premiumKezeles: 'Prémium kezelés', dolgozokMegtekintes: 'Dolgozók megtekintés', dolgozokKezeles: 'Dolgozók kezelése' };
    E('roleListDiv').innerHTML = snap.docs.map(d => {
      const r = { id: d.id, ...d.data() };
      const perms = Object.entries(r.permissions || {}).filter(([, v]) => v).map(([k]) => permLabel[k] || k).join(', ') || 'Nincs jogosultság';
      return `<div class="role-item"><div class="role-item-info"><div class="role-item-name">${esc(r.name)}</div><div class="role-item-perms">${esc(perms)}</div></div><div style="display:flex;gap:6px;flex-shrink:0;"><button class="btn btn-ghost btn-xs" data-edit-role="${r.id}">Szerkeszt</button><button class="btn btn-danger btn-xs" data-del-role="${r.id}">Töröl</button></div></div>`;
    }).join('');
  } catch { msg('Szerepkör betöltési hiba', 'error'); }
}

export async function saveRole() {
  const name = E('newRoleNev').value.trim();
  if (!name) { msg('Adj meg nevet!', 'error'); return; }
  const permissions = {
    adatbevitel:          E('pAdatbevitel').checked,
    sajatJelentes:        E('pSajatJelentes').checked,
    mindenJelentes:       E('pMindenJelentes').checked,
    naptar:               E('pNaptar').checked,
    elemzes:              E('pElemzes').checked,
    felhasznalokKezelese: E('pFelhasznalok').checked,
    premiumMegtekintes:   E('pPremiumMegtekintes').checked,
    premiumKezeles:       E('pPremiumKezeles').checked,
    dolgozokMegtekintes:  E('pDolgozokMegtekintes').checked,
    dolgozokKezeles:      E('pDolgozokKezeles').checked
  };
  try {
    if (editingRoleId) {
      await updateDoc(doc(db, 'roles', editingRoleId), { name, permissions });
      msg('Szerepkör frissítve.');
    } else {
      await addDoc(collection(db, 'roles'), { name, permissions, createdAt: serverTimestamp(), createdBy: state.appUser.uid });
      msg('Szerepkör létrehozva.');
    }
    cancelRoleForm(); loadRoles();
  } catch (e) { msg('Mentési hiba: ' + e.message, 'error'); }
}

export function cancelRoleForm() {
  E('newRoleForm').classList.remove('open');
  E('newRoleNev').value = '';
  ['pAdatbevitel','pSajatJelentes','pMindenJelentes','pNaptar','pElemzes','pFelhasznalok','pPremiumMegtekintes','pPremiumKezeles','pDolgozokMegtekintes','pDolgozokKezeles'].forEach(id => E(id).checked = false);
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
    E('newRoleNev').value              = r.name;
    E('pAdatbevitel').checked          = !!r.permissions?.adatbevitel;
    E('pSajatJelentes').checked        = !!r.permissions?.sajatJelentes;
    E('pMindenJelentes').checked       = !!r.permissions?.mindenJelentes;
    E('pNaptar').checked               = !!r.permissions?.naptar;
    E('pElemzes').checked              = !!r.permissions?.elemzes;
    E('pFelhasznalok').checked         = !!r.permissions?.felhasznalokKezelese;
    E('pPremiumMegtekintes').checked   = !!r.permissions?.premiumMegtekintes;
    E('pPremiumKezeles').checked       = !!r.permissions?.premiumKezeles;
    E('pDolgozokMegtekintes').checked  = !!r.permissions?.dolgozokMegtekintes;
    E('pDolgozokKezeles').checked      = !!r.permissions?.dolgozokKezeles;
    editingRoleId = id;
    E('newRoleForm').classList.add('open');
    E('saveRoleBtn').textContent = 'Frissítés';
  } else if (delBtn) {
    if (!confirm('Törlöd ezt a szerepkört?')) return;
    await deleteDoc(doc(db, 'roles', delBtn.dataset.delRole));
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
      <button class="btn btn-danger btn-xs notice-adm-del" data-id="${n.id}" style="position:absolute;top:12px;right:12px;">✕</button>
    </div>`;
  }).join('');
  E('noticeListDiv').querySelectorAll('.notice-adm-del').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Törlöd ezt a közleményt?')) return;
      try { await deleteDoc(doc(db, 'notices', btn.dataset.id)); msg('Közlemény törölve.'); loadNoticeAdmin(); }
      catch (err) { msg('Hiba: ' + err.message, 'error'); }
    });
  });
}

export async function saveNotice() {
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
    msg('Közlemény közzétéve.');
    E('noticeInput').value = '';
    if (E('noticeLejarat')) E('noticeLejarat').value = '';
    loadNoticeAdmin();
  } catch (e) { msg('Hiba: ' + e.message, 'error'); }
}

export function clearNotice() {}

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
