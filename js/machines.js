import { db, doc, addDoc, updateDoc, deleteDoc,
         collection, query, getDocs, orderBy, serverTimestamp } from './firebase.js';
import { state, isMainAdmin, hasPerm } from './state.js';
import { E, esc, msg, tod } from './utils.js';

export function canViewMachines()   { return isMainAdmin() || hasPerm('gepekMegtekintes') || hasPerm('gepekKezeles'); }
export function canManageMachines() { return isMainAdmin() || hasPerm('gepekKezeles'); }

const EVENT_META = {
  karbantartas: { label:'Karbantartás', icon:'🔧', cls:'gep-ev-karb' },
  leallas:      { label:'Leállás',       icon:'🚨', cls:'gep-ev-leall' },
  javitas:      { label:'Javítás',       icon:'🔨', cls:'gep-ev-jav' },
  uzembe:       { label:'Üzembe helyezés', icon:'✅', cls:'gep-ev-uzem' },
};
const STATUS_META = {
  uzemel:       { label:'Üzemel',      cls:'gep-aktiv' },
  all:          { label:'Leállva',     cls:'gep-inaktiv' },
  karbantartas: { label:'Karbantartás',cls:'gep-karb' },
};

let _machines = [];
let _editingMachineId = null;
let _currentMachine   = null;

/* ── Betöltés ── */
export async function loadMachines() {
  const div = E('gepGrid'); if (!div) return;
  div.innerHTML = '<div class="empty-st"><div class="spinner" style="margin:0 auto"></div></div>';
  try {
    const snap = await getDocs(query(collection(db, 'machines'), orderBy('nev')));
    _machines = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    _renderMachines();
  } catch (e) { msg('Betöltési hiba: ' + e.message, 'error'); }
}

function _renderMachines() {
  const div = E('gepGrid'); if (!div) return;
  const aktiv = _machines.filter(m => m.aktiv !== false);
  if (!aktiv.length) {
    div.innerHTML = `<div class="empty-st"><div class="empty-ic">⚙️</div><div class="empty-title">Nincsenek gépek</div><div class="empty-sub">Adj hozzá gépet a ＋ Új gép gombbal.</div></div>`;
    return;
  }
  const today = tod();
  div.innerHTML = '<div class="emp-grid">' + aktiv.map(m => {
    const st  = STATUS_META[m.statusz || 'uzemel'] || STATUS_META.uzemel;
    const borderCls = m.statusz === 'leallas' ? 'emp-border-inaktiv' : m.statusz === 'karbantartas' ? 'emp-border-szabadsag' : 'emp-border-aktiv';
    // Karbantartás esedékesség
    let maintWarn = '';
    if (m.karbantartasIdo && m.utolsoKarbantartas) {
      const nextDate = new Date(m.utolsoKarbantartas + 'T12:00:00');
      nextDate.setDate(nextDate.getDate() + m.karbantartasIdo);
      const nextStr = nextDate.toISOString().split('T')[0];
      const daysLeft = Math.round((nextDate - new Date()) / 86400000);
      if (daysLeft <= 7) {
        maintWarn = `<div class="emp-proba-warn">🔧 Karbantartás ${daysLeft <= 0 ? 'esedékes!' : daysLeft + ' nap múlva'}</div>`;
      }
    }
    return `<div class="emp-card emp-card-clickable ${borderCls}" data-gid="${esc(m.id)}">
      <div style="display:flex;gap:12px;align-items:flex-start;">
        <div class="emp-avatar-sm" style="background:var(--accent);font-size:18px;display:flex;align-items:center;justify-content:center;flex-shrink:0;">🔧</div>
        <div style="flex:1;min-width:0;">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:6px;">
            <div>
              <div class="emp-name">${esc(m.nev)}</div>
              <div class="emp-dept">${esc(m.tipus || '—')}</div>
            </div>
            <span class="emp-status ${st.cls}" style="flex-shrink:0;">${st.label}</span>
          </div>
        </div>
      </div>
      ${maintWarn}
    </div>`;
  }).join('') + '</div>';

  div.querySelectorAll('[data-gid]').forEach(card => {
    card.addEventListener('click', () => {
      const m = _machines.find(x => x.id === card.dataset.gid);
      if (m) openMachineDrawer(m);
    });
  });
}

/* ── Mentés ── */
export async function saveMachine() {
  const nev = E('gepFormNev')?.value.trim();
  if (!nev) { msg('A név kötelező!', 'error'); return; }
  const data = {
    nev,
    tipus:            E('gepFormTipus')?.value.trim()  || '',
    gyarto:           E('gepFormGyarto')?.value.trim() || '',
    gyartasiEv:       parseInt(E('gepFormEv')?.value) || null,
    karbantartasIdo:  parseInt(E('gepFormKarb')?.value) || null,
    utolsoKarbantartas: E('gepFormUtolso')?.value || null,
    statusz:          E('gepFormStatusz')?.value || 'uzemel',
    megjegyzes:       E('gepFormMegj')?.value.trim() || '',
    aktiv: true,
  };
  try {
    if (_editingMachineId) {
      await updateDoc(doc(db, 'machines', _editingMachineId), { ...data, updatedBy: state.appUser.uid, updatedAt: serverTimestamp() });
      msg('Gép frissítve.');
    } else {
      await addDoc(collection(db, 'machines'), { ...data, createdBy: state.appUser.uid, createdAt: serverTimestamp() });
      msg('Gép hozzáadva.');
    }
    closeGepForm(); loadMachines();
  } catch (e) { msg('Hiba: ' + e.message, 'error'); }
}

export function openGepForm(m = null) {
  _editingMachineId = m?.id || null;
  E('gepFormNev').value     = m?.nev            || '';
  E('gepFormTipus').value   = m?.tipus          || '';
  E('gepFormGyarto').value  = m?.gyarto         || '';
  E('gepFormEv').value      = m?.gyartasiEv     || '';
  E('gepFormKarb').value    = m?.karbantartasIdo || '';
  E('gepFormUtolso').value  = m?.utolsoKarbantartas || '';
  E('gepFormStatusz').value = m?.statusz        || 'uzemel';
  E('gepFormMegj').value    = m?.megjegyzes     || '';
  E('gepFormTitle').textContent = m ? 'Gép szerkesztése' : 'Új gép';
  E('gepForm').style.display = '';
  E('gepFormNev').focus();
}

export function closeGepForm() {
  _editingMachineId = null;
  E('gepForm').style.display = 'none';
}

/* ── Drawer ── */
export async function openMachineDrawer(m) {
  _currentMachine = m;
  const st = STATUS_META[m.statusz || 'uzemel'] || STATUS_META.uzemel;
  E('gepDrawerName').textContent   = m.nev;
  E('gepDrawerTipus').textContent  = [m.tipus, m.gyarto, m.gyartasiEv].filter(Boolean).join(' · ') || '—';
  E('gepDrawerStatus').innerHTML   = `<span class="emp-status ${st.cls}">${st.label}</span>`;

  // Betölt esemény napló
  E('gepDrawerBody').innerHTML = '<div class="empty-st"><div class="spinner" style="margin:0 auto"></div></div>';
  E('gepDrawerOverlay').classList.add('open');
  E('gepDrawer').classList.add('open');
  document.body.style.overflow = 'hidden';

  try {
    const snap = await getDocs(query(collection(db, 'machineEvents'), orderBy('datum', 'desc')));
    const events = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(ev => ev.gepId === m.id);
    _renderDrawerBody(m, events);
  } catch { _renderDrawerBody(m, []); }
}

function _renderDrawerBody(m, events) {
  const canEdit = canManageMachines();
  let body = '';

  // Alapadatok
  body += `<div class="emp-drawer-section">
    <div class="emp-drawer-section-title">Alapadatok</div>
    ${m.gyarto ? `<div class="emp-drawer-row"><span class="emp-drawer-row-icon">🏭</span><span>Gyártó: <strong>${esc(m.gyarto)}</strong></span></div>` : ''}
    ${m.gyartasiEv ? `<div class="emp-drawer-row"><span class="emp-drawer-row-icon">📅</span><span>Gyártási év: <strong>${m.gyartasiEv}</strong></span></div>` : ''}
    ${m.karbantartasIdo ? `<div class="emp-drawer-row"><span class="emp-drawer-row-icon">🔧</span><span>Karbantartási ciklus: <strong>${m.karbantartasIdo} nap</strong></span></div>` : ''}
    ${m.utolsoKarbantartas ? `<div class="emp-drawer-row"><span class="emp-drawer-row-icon">✓</span><span>Utolsó karbantartás: <strong>${esc(m.utolsoKarbantartas)}</strong></span></div>` : ''}
    ${m.megjegyzes ? `<div class="emp-drawer-row"><span class="emp-drawer-row-icon">📝</span><span style="font-style:italic;">${esc(m.megjegyzes)}</span></div>` : ''}
  </div>`;

  // Következő karbantartás
  if (m.karbantartasIdo && m.utolsoKarbantartas) {
    const next = new Date(m.utolsoKarbantartas + 'T12:00:00');
    next.setDate(next.getDate() + m.karbantartasIdo);
    const nextStr = next.toISOString().split('T')[0];
    const daysLeft = Math.round((next - new Date()) / 86400000);
    const col = daysLeft <= 0 ? 'var(--red)' : daysLeft <= 7 ? 'var(--amber)' : 'var(--green)';
    const pct = Math.max(0, Math.min(100, Math.round((1 - daysLeft / m.karbantartasIdo) * 100)));
    body += `<div class="emp-drawer-section">
      <div class="emp-drawer-section-title">Következő karbantartás</div>
      <div style="font-size:13px;color:${col};font-weight:600;margin-bottom:8px;">${daysLeft <= 0 ? '⚠️ Esedékes volt: ' : '📅 '}${nextStr} ${daysLeft > 0 ? `(${daysLeft} nap)` : '(lejárt!)'}</div>
      <div style="height:8px;background:var(--surf2);border-radius:4px;overflow:hidden;">
        <div style="height:100%;width:${pct}%;background:${col};border-radius:4px;transition:width .5s;"></div>
      </div>
    </div>`;
  }

  // Esemény napló
  body += `<div class="emp-drawer-section">
    <div class="emp-drawer-section-title">Esemény napló (${events.length})</div>
    ${events.length ? events.slice(0, 10).map(ev => {
      const meta = EVENT_META[ev.tipus] || { label: ev.tipus, icon:'📋', cls:'' };
      const canDel = canEdit;
      return `<div style="display:flex;align-items:flex-start;gap:8px;padding:6px 0;border-bottom:1px solid var(--border);">
        <span style="font-size:16px;flex-shrink:0;">${meta.icon}</span>
        <div style="flex:1;min-width:0;">
          <div style="font-size:13px;font-weight:600;">${meta.label}${ev.idotartam ? ` · ${ev.idotartam} h` : ''}</div>
          <div style="font-size:11.5px;color:var(--text3);">${esc(ev.datum)}${ev.megjegyzes ? ' · ' + esc(ev.megjegyzes) : ''}</div>
        </div>
        ${canDel ? `<button class="btn btn-danger btn-xs gep-ev-del" data-evid="${ev.id}" style="flex-shrink:0;">✕</button>` : ''}
      </div>`;
    }).join('') : `<div style="font-size:12.5px;color:var(--text3);">Nincs esemény rögzítve.</div>`}
  </div>`;

  // Esemény hozzáadás form
  if (canEdit) {
    body += `<div class="emp-drawer-section">
      <div class="emp-drawer-section-title">Esemény rögzítése</div>
      <div class="g2">
        <div class="field"><label class="lbl">Típus</label>
          <select id="gepEvTipus">
            <option value="karbantartas">🔧 Karbantartás</option>
            <option value="leallas">🚨 Leállás</option>
            <option value="javitas">🔨 Javítás</option>
            <option value="uzembe">✅ Üzembe helyezés</option>
          </select>
        </div>
        <div class="field"><label class="lbl">Dátum</label><input type="date" id="gepEvDatum" value="${tod()}"></div>
      </div>
      <div class="g2">
        <div class="field"><label class="lbl">Időtartam (h, op.)</label><input type="number" id="gepEvIdotartam" min="0" step="0.5" placeholder="pl. 2"></div>
        <div class="field"><label class="lbl">Megjegyzés</label><input type="text" id="gepEvMegj" placeholder="Opcionális…"></div>
      </div>
      <div class="btn-row"><button class="btn btn-primary btn-sm" id="gepEvSaveBtn">✓ Rögzít</button></div>
    </div>`;
  }

  // Műveletek
  if (canEdit) {
    body += `<div class="emp-drawer-actions">
      <button class="btn btn-primary btn-sm" id="gepDrawerEditBtn">✎ Szerkeszt</button>
      <button class="btn btn-danger btn-sm" id="gepDrawerDelBtn" style="margin-left:auto;">🗑 Töröl</button>
    </div>`;
  }

  E('gepDrawerBody').innerHTML = body;

  // Event listeners
  E('gepEvSaveBtn')?.addEventListener('click', () => _saveEvent(m.id));
  E('gepDrawerEditBtn')?.addEventListener('click', () => { closeMachineDrawer(); openGepForm(m); });
  E('gepDrawerDelBtn')?.addEventListener('click', async () => {
    if (!confirm(`Véglegesen törlöd „${m.nev}" gépet? Ez visszafordíthatatlan.`)) return;
    try {
      await deleteDoc(doc(db, 'machines', m.id));
      msg('Gép törölve.');
      closeMachineDrawer();
      loadMachines();
    } catch (e) { msg('Hiba: ' + e.message, 'error'); }
  });
  E('gepDrawerBody').querySelectorAll('.gep-ev-del').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Törlöd ezt az eseményt?')) return;
      try { await deleteDoc(doc(db, 'machineEvents', btn.dataset.evid)); msg('Esemény törölve.'); openMachineDrawer(m); }
      catch (e) { msg('Hiba: ' + e.message, 'error'); }
    });
  });
}

async function _saveEvent(gepId) {
  const tipus  = E('gepEvTipus')?.value;
  const datum  = E('gepEvDatum')?.value;
  const ido    = parseFloat(E('gepEvIdotartam')?.value) || null;
  const megj   = E('gepEvMegj')?.value.trim() || '';
  if (!datum) { msg('Dátum kötelező!', 'error'); return; }
  const evData = { gepId, tipus, datum, idotartam: ido, megjegyzes: megj };
  try {
    await addDoc(collection(db, 'machineEvents'), { ...evData, createdBy: state.appUser.uid, createdAt: serverTimestamp() });
    // Ha karbantartás: frissíti utolsoKarbantartas-t
    if (tipus === 'karbantartas') await updateDoc(doc(db, 'machines', gepId), { utolsoKarbantartas: datum });
    // Ha leállás/üzembe: frissíti státuszt
    if (tipus === 'leallas')  await updateDoc(doc(db, 'machines', gepId), { statusz: 'leallas' });
    if (tipus === 'uzembe')   await updateDoc(doc(db, 'machines', gepId), { statusz: 'uzemel' });
    if (tipus === 'javitas')  await updateDoc(doc(db, 'machines', gepId), { statusz: 'karbantartas' });
    msg('Esemény rögzítve.');
    const updated = { ..._currentMachine };
    if (tipus === 'karbantartas') updated.utolsoKarbantartas = datum;
    if (tipus === 'leallas')  updated.statusz = 'leallas';
    if (tipus === 'uzembe')   updated.statusz = 'uzemel';
    if (tipus === 'javitas')  updated.statusz = 'karbantartas';
    _currentMachine = updated;
    openMachineDrawer(updated);
    loadMachines();
  } catch (e) { msg('Hiba: ' + e.message, 'error'); }
}

export function closeMachineDrawer() {
  E('gepDrawerOverlay')?.classList.remove('open');
  E('gepDrawer')?.classList.remove('open');
  document.body.style.overflow = '';
  _currentMachine = null;
}

/* ── Karbantartás szükséges gépek (dashboard-hoz) ── */
export function getMachinesNeedingMaintenance(machines = _machines) {
  return machines.filter(m => {
    if (!m.karbantartasIdo || !m.utolsoKarbantartas) return false;
    const next = new Date(m.utolsoKarbantartas + 'T12:00:00');
    next.setDate(next.getDate() + m.karbantartasIdo);
    return Math.round((next - new Date()) / 86400000) <= 14;
  }).sort((a, b) => {
    const da = new Date(a.utolsoKarbantartas + 'T12:00:00'); da.setDate(da.getDate() + a.karbantartasIdo);
    const db2 = new Date(b.utolsoKarbantartas + 'T12:00:00'); db2.setDate(db2.getDate() + b.karbantartasIdo);
    return da - db2;
  });
}
export { _machines as allMachines };
