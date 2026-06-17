import { db, doc, getDoc, addDoc, updateDoc, deleteDoc,
         collection, query, where, getDocs, orderBy, serverTimestamp } from './firebase.js';
import { state, hasPerm, isMainAdmin } from './state.js';
import { logAction } from './auditlog.js';
import { queueOp } from './offlineQueue.js';
import { E, esc, msg, tod } from './utils.js';

const HIANYZAS = {
  szabadsag:      { label: 'Szabadság',       icon: '🌴', cls: 'abs-szabadsag' },
  betegseg:       { label: 'Betegszabadság',  icon: '🤒', cls: 'abs-betegseg' },
  fizetesnelkuli: { label: 'Fizetés nélküli', icon: '📋', cls: 'abs-fizetesnelkuli' },
  egyeb:          { label: 'Egyéb',            icon: '❓', cls: 'abs-egyeb' }
};
const SZERZODES = { hatarozatlan:'Határozatlan', hatarozott:'Határozott', megbizasi:'Megbízási' };

let _employees    = [];
let _empLoaded    = false;
let _editingId    = null;
let _szabadsagMap = {};   // { nev: { szabadsag, betegseg, fizetesnelkuli, egyeb } }
let _lastStatData = null;
let _kompList     = [];
let _listView     = localStorage.getItem('nj_emp_listview') === '1';

/* ── Helpers ── */
export function canEditEmp() { return isMainAdmin() || hasPerm('dolgozokKezeles'); }
export function setEmpListView(v) { _listView = v; }

function initials(nev) {
  return nev.split(' ').slice(0, 2).map(w => w[0]?.toUpperCase() || '').join('');
}
function avatarColor(nev) {
  const p = ['#1565C0','#2E7D32','#C62828','#E65100','#6A1B9A','#00695C','#AD1457','#0277BD'];
  let h = 0;
  for (let i = 0; i < nev.length; i++) h = nev.charCodeAt(i) + ((h << 5) - h);
  return p[Math.abs(h) % p.length];
}
function countDays(tol, ig) {
  return Math.max(1, Math.round((new Date(ig || tol) - new Date(tol)) / 86400000) + 1);
}
function daysInMonth(y, m) { return new Date(y, m, 0).getDate(); }
function isAbsentOnDay(abs, ds) { return abs.tol <= ds && ds <= (abs.ig || abs.tol); }

async function _loadSzabadsagMap() {
  const ev = new Date().getFullYear();
  try {
    const snap = await getDocs(query(collection(db, 'absences'),
      where('tol', '>=', `${ev}-01-01`), where('tol', '<=', `${ev}-12-31`), orderBy('tol')));
    _szabadsagMap = {};
    snap.docs.forEach(d => {
      const a = d.data();
      const n = a.dolgozoNev;
      const days = countDays(a.tol, a.ig);
      if (!_szabadsagMap[n]) _szabadsagMap[n] = { szabadsag:0, betegseg:0, fizetesnelkuli:0, egyeb:0 };
      const t = a.tipus || 'egyeb';
      if (t in _szabadsagMap[n]) _szabadsagMap[n][t] += days;
      else _szabadsagMap[n].egyeb += days;
    });
  } catch { _szabadsagMap = {}; }
}

function _getAbsStats(nev) {
  return _szabadsagMap[nev] || { szabadsag:0, betegseg:0, fizetesnelkuli:0, egyeb:0 };
}

function _updateReszlegSelect(id) {
  const sel = E(id); if (!sel) return;
  const prev = sel.value;
  const reszlegek = [...new Set(_employees.map(e => e.reszleg).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'hu'));
  sel.innerHTML = '<option value="">— Mind —</option>' +
    reszlegek.map(r => `<option value="${esc(r)}">${esc(r)}</option>`).join('');
  if (prev) sel.value = prev;
}

function _updateAbsDropdowns() {
  const aktiv = _employees.filter(e => e.statusz !== 'inaktiv').sort((a,b)=>a.nev.localeCompare(b.nev,'hu'));
  const all   = [..._employees].sort((a,b)=>a.nev.localeCompare(b.nev,'hu'));
  const af = E('absFormNev');
  if (af) af.innerHTML = '<option value="">— Válassz —</option>' +
    aktiv.map(e => `<option value="${esc(e.nev)}">${esc(e.nev)}</option>`).join('');
  const hf = E('hianyNevF');
  if (hf) hf.innerHTML = '<option value="">— Mindenki —</option>' +
    all.map(e => `<option value="${esc(e.nev)}">${esc(e.nev)}</option>`).join('');
  // quick-add dropdown
  const qf = E('calQaNev');
  if (qf) qf.innerHTML = '<option value="">— Válassz —</option>' +
    aktiv.map(e => `<option value="${esc(e.nev)}">${esc(e.nev)}</option>`).join('');
}

/* ── Kompetencia chip UI ── */
function _renderKompChips() {
  const wrap = E('kompChips'); if (!wrap) return;
  wrap.innerHTML = _kompList.map(k =>
    `<span class="komp-chip">${esc(k)}<span class="komp-chip-del" data-k="${esc(k)}">×</span></span>`
  ).join('');
  wrap.querySelectorAll('.komp-chip-del').forEach(x =>
    x.addEventListener('click', () => { _kompList = _kompList.filter(k => k !== x.dataset.k); _renderKompChips(); })
  );
}

/* ══════════════════════════════════════
   ADATLAPOK
══════════════════════════════════════ */
export async function loadEmployees() {
  try {
    const [snap] = await Promise.all([
      getDocs(query(collection(db, 'employees'), orderBy('nev'))),
      _loadSzabadsagMap()
    ]);
    _employees = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    _empLoaded = true;
    _updateReszlegSelect('dolgReszlegF');
    _updateReszlegSelect('naptarReszlegF');
    _updateAbsDropdowns();
    renderEmployeeGrid();
  } catch (e) { msg('Betöltési hiba: ' + e.message, 'error'); }
}

export function renderEmployeeGrid() {
  const reszlegF = E('dolgReszlegF')?.value || '';
  const statuszF = E('dolgStatuszF')?.value || '';
  const keresF   = (E('dolgNevKeres')?.value || '').trim().toLowerCase();
  const rendezes = E('dolgRendezes')?.value  || 'nev';

  let list = _employees;
  if (reszlegF) list = list.filter(e => e.reszleg === reszlegF);
  if (statuszF) list = list.filter(e => (e.statusz || 'aktiv') === statuszF);
  if (keresF)   list = list.filter(e =>
    e.nev.toLowerCase().includes(keresF) ||
    (e.reszleg || '').toLowerCase().includes(keresF) ||
    (e.pozicio || '').toLowerCase().includes(keresF) ||
    (e.kompetenciak || []).some(k => k.toLowerCase().includes(keresF))
  );

  list = [...list].sort((a, b) => {
    if (rendezes === 'belepet') return (a.belepet || '').localeCompare(b.belepet || '');
    if (rendezes === 'reszleg') return (a.reszleg || '').localeCompare(b.reszleg || '', 'hu');
    return a.nev.localeCompare(b.nev, 'hu');
  });

  // Lista/kártya nézet toggle szinkronizálása
  if (E('empViewCard')) E('empViewCard').classList.toggle('active', !_listView);
  if (E('empViewList')) E('empViewList').classList.toggle('active', _listView);

  const grid = E('dolgozoGrid'); if (!grid) return;
  if (!list.length) {
    grid.innerHTML = `<div class="empty-st"><div class="empty-ic">👷</div><div class="empty-title">Nincs megjeleníthető dolgozó</div></div>`;
    return;
  }

  const STATUSZ = {
    aktiv:     { label: 'Aktív',       cls: 'emp-aktiv' },
    inaktiv:   { label: 'Inaktív',     cls: 'emp-inaktiv' },
    szabadsag: { label: 'Szabadságon', cls: 'emp-szab' }
  };
  const today = tod();

  if (_listView) {
    // ── Lista nézet ──
    grid.innerHTML = '<div class="emp-list">' + list.map(emp => {
      const st    = STATUSZ[emp.statusz || 'aktiv'] || STATUSZ.aktiv;
      const abs   = _getAbsStats(emp.nev);
      const keret = emp.szabadsagKeret ?? 20;
      const marad = Math.max(0, keret - abs.szabadsag);
      return `<div class="emp-list-row emp-card-clickable" data-id="${esc(emp.id)}">
        <div class="emp-avatar-sm" style="background:${avatarColor(emp.nev)};flex-shrink:0;">${initials(emp.nev)}</div>
        <div style="flex:1;min-width:0;">
          <div style="font-weight:600;font-size:13.5px;color:var(--text);">${esc(emp.nev)}</div>
          <div style="font-size:12px;color:var(--text3);">${esc(emp.reszleg || '—')}${emp.pozicio ? ` · ${esc(emp.pozicio)}` : ''}</div>
        </div>
        <span class="emp-status ${st.cls}" style="flex-shrink:0;">${st.label}</span>
        <span style="font-size:12px;color:var(--text3);white-space:nowrap;flex-shrink:0;">🌴 ${abs.szabadsag}/${keret} nap</span>
      </div>`;
    }).join('') + '</div>';
    return;
  }

  grid.innerHTML = '<div class="emp-grid">' + list.map(emp => {
    const st    = STATUSZ[emp.statusz || 'aktiv'] || STATUSZ.aktiv;
    const abs   = _getAbsStats(emp.nev);
    const keret = emp.szabadsagKeret ?? 20;
    const felh  = abs.szabadsag;
    const marad = Math.max(0, keret - felh);
    const komps = (emp.kompetenciak || []).slice(0, 3);
    const moreK = (emp.kompetenciak || []).length > 3
      ? `<span class="komp-chip komp-chip-sm" style="opacity:.5;">+${emp.kompetenciak.length - 3}</span>` : '';

    const borderC = { aktiv:'emp-border-aktiv', inaktiv:'emp-border-inaktiv', szabadsag:'emp-border-szabadsag' }[emp.statusz||'aktiv'] || 'emp-border-aktiv';
    return `<div class="emp-card emp-card-clickable ${borderC}" data-id="${esc(emp.id)}">
      <div style="display:flex;gap:12px;align-items:flex-start;">
        <div class="emp-avatar-sm" style="background:${avatarColor(emp.nev)};flex-shrink:0;">${initials(emp.nev)}</div>
        <div style="flex:1;min-width:0;">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:6px;">
            <div style="min-width:0;">
              <div class="emp-name">${esc(emp.nev)}</div>
              <div class="emp-dept">${esc(emp.reszleg || '—')}${emp.pozicio ? ` · <em>${esc(emp.pozicio)}</em>` : ''}</div>
            </div>
            <span class="emp-status ${st.cls}" style="flex-shrink:0;margin-top:2px;">${st.label}</span>
          </div>
          ${komps.length ? `<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:7px;">${komps.map(k=>`<span class="komp-chip komp-chip-sm">${esc(k)}</span>`).join('')}${moreK}</div>` : ''}
        </div>
      </div>
      <div class="emp-szab-badge${marad < 5 ? ' emp-szab-low' : ''}">🌴 ${felh}/${keret} nap · <strong>${marad} maradt</strong></div>
    </div>`;
  }).join('') + '</div>';
}

export function openEmpForm(emp = null) {
  _editingId = emp?.id || null;
  E('empFormNev').value            = emp?.nev            || '';
  E('empFormReszleg').value        = emp?.reszleg        || '';
  E('empFormPozicio').value        = emp?.pozicio        || '';
  E('empFormBelepet').value        = emp?.belepet        || '';
  E('empFormStatusz').value        = emp?.statusz        || 'aktiv';
  E('empFormMegj').value           = emp?.megjegyzes     || '';
  E('empFormTelefon').value        = emp?.telefon        || '';
  E('empFormEmail').value          = emp?.email          || '';
  E('empFormSzulDatum').value      = emp?.szulDatum      || '';
  E('empFormSzerzodesT').value     = emp?.szerzodesTipus || 'hatarozatlan';
  E('empFormSzabadsagKeret').value = emp?.szabadsagKeret ?? 20;
  E('empFormTitle').textContent    = emp ? 'Dolgozó szerkesztése' : 'Új dolgozó';

  _kompList = [...(emp?.kompetenciak || [])];
  _renderKompChips();
  const ti = E('kompTyping');
  if (ti) {
    ti.onkeydown = ev => {
      if (ev.key !== 'Enter') return;
      ev.preventDefault();
      const v = ti.value.trim();
      if (v && !_kompList.includes(v)) { _kompList.push(v); _renderKompChips(); }
      ti.value = '';
    };
  }

  const dl = E('empFormReszlegDL');
  if (dl) dl.innerHTML = (state.reszlegek || []).map(r => `<option value="${esc(r)}"></option>`).join('');
  E('dolgozoForm').style.display = '';
  E('empFormNev').focus();
}

export function closeEmpForm() {
  _editingId = null;
  E('dolgozoForm').style.display = 'none';
}

export async function saveEmployee() {
  if (!canEditEmp()) { msg('Nincs jogosultságod dolgozó módosításához!', 'error'); return; }
  const nev = E('empFormNev').value.trim();
  if (!nev) { msg('A név kötelező!', 'error'); return; }
  const data = {
    nev,
    reszleg:        E('empFormReszleg').value.trim(),
    pozicio:        E('empFormPozicio').value.trim()  || '',
    belepet:        E('empFormBelepet').value          || null,
    statusz:        E('empFormStatusz').value          || 'aktiv',
    megjegyzes:     E('empFormMegj').value.trim(),
    telefon:        E('empFormTelefon').value.trim(),
    email:          E('empFormEmail').value.trim(),
    szulDatum:      E('empFormSzulDatum').value        || null,
    szerzodesTipus: E('empFormSzerzodesT').value       || 'hatarozatlan',
    szabadsagKeret: Number(E('empFormSzabadsagKeret').value) || 20,
    kompetenciak:   [..._kompList]
  };
  try {
    if (_editingId) {
      await updateDoc(doc(db, 'employees', _editingId),
        { ...data, updatedBy: state.appUser.uid, updatedAt: serverTimestamp() });
      msg('Dolgozó frissítve.');
      logAction('employee.update', { nev: data.nev });
    } else {
      await addDoc(collection(db, 'employees'),
        { ...data, createdBy: state.appUser.uid, createdAt: serverTimestamp() });
      msg('Dolgozó hozzáadva.');
      logAction('employee.create', { nev: data.nev });
    }
    closeEmpForm();
    await loadEmployees();
  } catch (e) { msg('Mentési hiba: ' + e.message, 'error'); }
}

export function handleEmpGridClick(e) {
  const card = e.target.closest('.emp-card-clickable'); if (!card) return;
  const emp = _employees.find(x => x.id === card.dataset.id);
  if (emp) openEmpDrawer(emp);
}

export function openEmpDrawer(emp) {
  const STATUSZ = {
    aktiv:     { label:'Aktív',       cls:'emp-aktiv' },
    inaktiv:   { label:'Inaktív',     cls:'emp-inaktiv' },
    szabadsag: { label:'Szabadságon', cls:'emp-szab' }
  };
  const st    = STATUSZ[emp.statusz || 'aktiv'] || STATUSZ.aktiv;
  const keret = emp.szabadsagKeret ?? 20;
  const felh  = _getAbsStats(emp.nev).szabadsag;
  const marad = Math.max(0, keret - felh);
  const today = tod();
  E('empDrawerAvatar').textContent      = initials(emp.nev);
  E('empDrawerAvatar').style.background = avatarColor(emp.nev);
  E('empDrawerName').textContent        = emp.nev;
  E('empDrawerDept').textContent        = [emp.reszleg, emp.pozicio].filter(Boolean).join(' · ') || '—';
  E('empDrawerStatus').innerHTML        = `<span class="emp-status ${st.cls}">${st.label}</span>`;

  let body = '';

  const rows = [
    emp.telefon        ? `<div class="emp-drawer-row"><span class="emp-drawer-row-icon">📞</span><span>${esc(emp.telefon)}</span></div>` : '',
    emp.email          ? `<div class="emp-drawer-row"><span class="emp-drawer-row-icon">✉️</span><span>${esc(emp.email)}</span></div>` : '',
    emp.belepet        ? `<div class="emp-drawer-row"><span class="emp-drawer-row-icon">📅</span><span>Belépett: <strong>${esc(emp.belepet)}</strong></span></div>` : '',
    emp.szulDatum      ? `<div class="emp-drawer-row"><span class="emp-drawer-row-icon">🎂</span><span>Születési dátum: <strong>${esc(emp.szulDatum)}</strong></span></div>` : '',
    emp.szerzodesTipus ? `<div class="emp-drawer-row"><span class="emp-drawer-row-icon">📋</span><span>${esc(SZERZODES[emp.szerzodesTipus] || emp.szerzodesTipus)}</span></div>` : '',
  ].filter(Boolean);
  if (rows.length) body += `<div class="emp-drawer-section"><div class="emp-drawer-section-title">Alapadatok</div>${rows.join('')}</div>`;

  // ── Teljes hiányzás összefoglaló ──
  const absAll  = _getAbsStats(emp.nev);
  const evTot   = absAll.szabadsag + absAll.betegseg + absAll.fizetesnelkuli + absAll.egyeb;
  body += `<div class="emp-drawer-section"><div class="emp-drawer-section-title">Hiányzások — ${new Date().getFullYear()}</div>
    <div class="nossz" style="margin-bottom:10px;">
      <div class="nossz-item"><div class="nossz-val">${felh}</div><div class="nossz-lbl">🌴 Szab. (${keret}-ból)</div></div>
      <div class="nossz-item${marad < 5 ? ' emp-szab-low' : ''}"><div class="nossz-val">${marad}</div><div class="nossz-lbl">Maradt</div></div>
    </div>
    ${absAll.betegseg > 0 ? `<div class="emp-drawer-row"><span class="emp-drawer-row-icon">🤒</span><span>Betegszabadság: <strong>${absAll.betegseg} nap</strong></span></div>` : ''}
    ${absAll.fizetesnelkuli > 0 ? `<div class="emp-drawer-row"><span class="emp-drawer-row-icon">📋</span><span>Fizetés nélküli: <strong>${absAll.fizetesnelkuli} nap</strong></span></div>` : ''}
    ${absAll.egyeb > 0 ? `<div class="emp-drawer-row"><span class="emp-drawer-row-icon">❓</span><span>Egyéb: <strong>${absAll.egyeb} nap</strong></span></div>` : ''}
    ${evTot > 0 ? `<div style="font-size:11.5px;color:var(--text3);margin-top:6px;">Összes hiányzás idén: <strong style="color:var(--text2);">${evTot} nap</strong></div>` : ''}
  </div>`;

  if ((emp.kompetenciak || []).length) {
    body += `<div class="emp-drawer-section"><div class="emp-drawer-section-title">Kompetenciák</div>
      <div style="display:flex;flex-wrap:wrap;gap:5px;margin-top:4px;">${emp.kompetenciak.map(k=>`<span class="komp-chip">${esc(k)}</span>`).join('')}</div></div>`;
  }

  if (emp.megjegyzes) {
    body += `<div class="emp-drawer-section"><div class="emp-drawer-section-title">Megjegyzés</div>
      <div style="font-size:13.5px;color:var(--text2);font-style:italic;line-height:1.6;">${esc(emp.megjegyzes)}</div></div>`;
  }

  // ── Képzési napló ──
  const kepzesek = emp.kepzesek || [];
  let kepBody = kepzesek.length
    ? [...kepzesek].sort((a,b)=>b.datum.localeCompare(a.datum)).map(k => `
        <div style="display:flex;align-items:flex-start;gap:8px;padding:5px 0;border-bottom:1px solid var(--border);">
          <span style="flex-shrink:0;font-size:11.5px;color:var(--text3);white-space:nowrap;">${esc(k.datum)}</span>
          <div style="flex:1;min-width:0;">
            <div style="font-size:13px;font-weight:600;color:var(--text);">${esc(k.nev)}</div>
            ${k.megjegyzes ? `<div style="font-size:12px;color:var(--text3);">${esc(k.megjegyzes)}</div>` : ''}
          </div>
          ${canEditEmp() ? `<button class="btn btn-danger btn-xs kepzes-del-btn" data-kid="${esc(k.id)}" style="flex-shrink:0;">✕</button>` : ''}
        </div>`).join('')
    : `<div style="font-size:12.5px;color:var(--text3);padding:4px 0;">Nincs rögzített képzés.</div>`;
  if (canEditEmp()) {
    kepBody += `<div style="margin-top:10px;border-top:1px solid var(--border);padding-top:10px;">
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px;">
        <input type="text" id="kepzesNev" placeholder="Képzés neve…" style="flex:2;min-width:100px;font-size:12.5px;padding:5px 8px;border:1px solid var(--border2);border-radius:var(--rsm);background:var(--surf2);color:var(--text);font-family:inherit;">
        <input type="date" id="kepzesDatum" style="flex:1;min-width:90px;font-size:12.5px;padding:5px 8px;border:1px solid var(--border2);border-radius:var(--rsm);background:var(--surf2);color:var(--text);font-family:inherit;">
      </div>
      <div style="display:flex;gap:6px;">
        <input type="text" id="kepzesMegj" placeholder="Megjegyzés (opcionális)…" style="flex:1;font-size:12.5px;padding:5px 8px;border:1px solid var(--border2);border-radius:var(--rsm);background:var(--surf2);color:var(--text);font-family:inherit;">
        <button class="btn btn-primary btn-xs kepzes-add-btn" data-empid="${emp.id}">＋</button>
      </div>
    </div>`;
  }
  body += `<div class="emp-drawer-section"><div class="emp-drawer-section-title">Képzési napló</div>${kepBody}</div>`;

  // Termelési teljesítmény szekció (async-töltve)
  body += `<div class="emp-drawer-section">
    <div class="emp-drawer-section-title">📈 Termelési teljesítmény</div>
    <div id="empPerfDiv"></div>
  </div>`;

  const isInaktiv = (emp.statusz || 'aktiv') === 'inaktiv';
  body += `<div class="emp-drawer-actions">
    ${canEditEmp() ? `<button class="btn btn-primary btn-sm" id="drawerEditBtn">✎ Szerkeszt</button>` : ''}
    <button class="btn btn-ghost btn-sm" id="drawerPdfBtn">📄 PDF</button>
    ${canEditEmp() ? `
      <button class="btn btn-${isInaktiv ? 'ghost' : 'danger'} btn-sm" id="drawerArchBtn">${isInaktiv ? '▶ Aktivál' : '⏸ Archivál'}</button>
      <button class="btn btn-danger btn-sm" id="drawerDelBtn" style="margin-left:auto;">🗑 Töröl</button>` : ''}
  </div>`;

  E('empDrawerBody').innerHTML = body;
  loadEmpPerf(emp.nev);
  E('drawerEditBtn')?.addEventListener('click', () => { closeEmpDrawer(); openEmpForm(emp); });
  E('drawerPdfBtn')?.addEventListener('click',  () => exportEmpPdf(emp));
  E('drawerArchBtn')?.addEventListener('click', async () => {
    const newSt = isInaktiv ? 'aktiv' : 'inaktiv';
    if (!confirm(`Biztosan ${newSt === 'inaktiv' ? 'archiválod' : 'aktiválod'}?`)) return;
    try { await updateDoc(doc(db,'employees',emp.id),{statusz:newSt,updatedBy:state.appUser.uid,updatedAt:serverTimestamp()}); msg('Státusz frissítve.'); closeEmpDrawer(); loadEmployees(); }
    catch (err) { msg('Hiba: '+err.message,'error'); }
  });
  E('drawerDelBtn')?.addEventListener('click', async () => {
    if (!confirm(`Véglegesen törlöd „${emp.nev}" dolgozót?`)) return;
    try { await deleteDoc(doc(db,'employees',emp.id)); logAction('employee.delete',{nev:emp.nev}); msg('Dolgozó törölve.'); closeEmpDrawer(); loadEmployees(); }
    catch (err) { msg('Hiba: '+err.message,'error'); }
  });

  E('empDrawerOverlay').classList.add('open');
  E('empDrawer').classList.add('open');
  document.body.style.overflow = 'hidden';

  // Képzési napló gombok
  E('empDrawerBody').querySelectorAll('.kepzes-add-btn').forEach(btn => {
    btn.addEventListener('click', () => saveKepzes(btn.dataset.empid, emp));
  });
  E('empDrawerBody').querySelectorAll('.kepzes-del-btn').forEach(btn => {
    btn.addEventListener('click', () => deleteKepzes(btn.dataset.kid, emp));
  });
}

async function saveKepzes(empId, emp) {
  const nev  = E('kepzesNev')?.value.trim();
  const datum= E('kepzesDatum')?.value;
  const megj = E('kepzesMegj')?.value.trim() || '';
  if (!nev)  { msg('Add meg a képzés nevét!', 'error'); return; }
  if (!datum){ msg('Add meg a dátumot!', 'error'); return; }
  const id = `${Date.now()}`;
  const newK = { id, nev, datum, megjegyzes: megj };
  const updated = [...(emp.kepzesek||[]), newK];
  try {
    await updateDoc(doc(db, 'employees', empId), { kepzesek: updated });
    emp.kepzesek = updated;
    msg('Képzés hozzáadva.');
    closeEmpDrawer();
    openEmpDrawer(emp);
  } catch (e) { msg('Hiba: ' + e.message, 'error'); }
}

async function deleteKepzes(kid, emp) {
  if (!confirm('Törlöd ezt a képzést?')) return;
  const updated = (emp.kepzesek||[]).filter(k => k.id !== kid);
  try {
    await updateDoc(doc(db, 'employees', emp.id), { kepzesek: updated });
    emp.kepzesek = updated;
    msg('Képzés törölve.');
    closeEmpDrawer();
    openEmpDrawer(emp);
  } catch (e) { msg('Hiba: ' + e.message, 'error'); }
}

export function closeEmpDrawer() {
  E('empDrawerOverlay').classList.remove('open');
  E('empDrawer').classList.remove('open');
  document.body.style.overflow = '';
}

/* ══════════════════════════════════════
   TERMELÉSI TELJESÍTMÉNY KÁRTYA
══════════════════════════════════════ */
async function loadEmpPerf(nev) {
  const div = document.getElementById('empPerfDiv'); if (!div) return;
  div.innerHTML = '<div style="text-align:center;padding:14px 0;"><div class="spinner" style="margin:0 auto;"></div></div>';
  try {
    const snap = await getDocs(query(collection(db, 'entries'), where('nev', '==', nev)));
    const entries = snap.docs.map(d => d.data());

    if (!entries.length) {
      div.innerHTML = '<div style="font-size:12.5px;color:var(--text3);padding:4px 0;">Nincs rögzített termelési adat.</div>';
      return;
    }

    let totalKg = 0;
    const byDay = {}, byAnyag = {}, byMonth = {};
    entries.forEach(e => {
      const kg = (e.sulyok || []).reduce((s, w) => s + (Number(w.suly) || 0), 0);
      totalKg += kg;
      const d = e.datum || '';
      if (d && kg > 0) byDay[d] = (byDay[d] || 0) + kg;
      if (e.anyag && kg > 0) byAnyag[e.anyag] = (byAnyag[e.anyag] || 0) + kg;
      const mo = d.slice(0, 7);
      if (mo && kg > 0) byMonth[mo] = (byMonth[mo] || 0) + kg;
    });

    const activeDays = Object.keys(byDay).length;
    const [bestDay,  bestDayKg]  = Object.entries(byDay).sort((a, b) => b[1] - a[1])[0]  || ['—', 0];
    const [topAnyag, topAnyagKg] = Object.entries(byAnyag).sort((a, b) => b[1] - a[1])[0] || ['—', 0];

    // Utolsó 12 hónap sparkline adatai
    const now = new Date();
    const months = [];
    for (let i = 11; i >= 0; i--) {
      const dt = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push(`${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`);
    }
    const monthVals = months.map(m => byMonth[m] || 0);
    const maxVal    = Math.max(...monthVals, 1);
    const HONAP     = ['jan','feb','már','ápr','máj','jún','júl','aug','szep','okt','nov','dec'];

    let h = '<div class="nossz" style="margin-bottom:12px;">';
    h += `<div class="nossz-item"><div class="nossz-val" style="font-size:14px;">${totalKg.toLocaleString('hu-HU')}</div><div class="nossz-lbl">Összes kg</div></div>`;
    h += `<div class="nossz-item"><div class="nossz-val" style="font-size:14px;">${activeDays}</div><div class="nossz-lbl">Aktív nap</div></div>`;
    h += `<div class="nossz-item"><div class="nossz-val" style="font-size:14px;">${bestDayKg.toLocaleString('hu-HU')}</div><div class="nossz-lbl">Rekord/nap</div></div>`;
    h += '</div>';

    if (topAnyag !== '—') {
      h += `<div style="font-size:12.5px;color:var(--text2);margin-bottom:5px;">📦 Fő anyag: <strong>${esc(topAnyag)}</strong> · ${topAnyagKg.toLocaleString('hu-HU')} kg</div>`;
    }
    if (bestDay !== '—') {
      h += `<div style="font-size:12.5px;color:var(--text2);margin-bottom:12px;">🏆 Rekord nap: <strong>${esc(bestDay)}</strong> · ${bestDayKg.toLocaleString('hu-HU')} kg</div>`;
    }

    // Mini sávdiagram — utolsó 12 hónap
    h += '<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--text3);margin-bottom:6px;">Havi termelés (elmúlt 12 hó)</div>';
    h += '<div style="display:flex;align-items:flex-end;gap:2px;height:54px;">';
    monthVals.forEach((val, i) => {
      const barH     = val > 0 ? Math.max(5, Math.round(val / maxVal * 44)) : 0;
      const mo       = months[i];
      const m        = Number(mo.split('-')[1]);
      const isCur    = i === 11;
      const bgColor  = isCur ? 'var(--accent)' : 'var(--agl)';
      h += `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:2px;" title="${esc(mo)}: ${val.toLocaleString('hu-HU')} kg">
        <div style="width:100%;background:${bgColor};border-radius:2px 2px 0 0;height:${barH}px;${val===0?'opacity:0;':''}"></div>
        <div style="font-size:8px;color:var(--text3);white-space:nowrap;">${HONAP[m - 1]}</div>
      </div>`;
    });
    h += '</div>';

    div.innerHTML = h;
  } catch (err) {
    const d2 = document.getElementById('empPerfDiv');
    if (d2) d2.innerHTML = '<div style="font-size:12px;color:var(--red);">Betöltési hiba.</div>';
  }
}

/* ══════════════════════════════════════
   DOLGOZÓI PDF ADATLAP
══════════════════════════════════════ */
export async function exportEmpPdf(emp) {
  if (!window.jspdf) { msg('jsPDF nem töltődött be!', 'error'); return; }
  msg('PDF generálás…', 'info', 5000);

  const LM = {
    bg:'#EFF2F7', surf:'#FFFFFF', surf2:'#F8FAFC', b:'#E2E8F0', b2:'#CBD5E1',
    t1:'#1E293B', t2:'#475569', t3:'#94A3B8',
    acc:'#1565C0', green:'#2E7D32', amber:'#E65100', red:'#C62828',
    agl:'rgba(21,101,192,0.10)'
  };

  const keret  = emp.szabadsagKeret ?? 20;
  const felh   = _getAbsStats(emp.nev).szabadsag;
  const marad  = Math.max(0, keret - felh);
  const ST     = { aktiv:{l:'Aktív',c:LM.green}, inaktiv:{l:'Inaktív',c:LM.t3}, szabadsag:{l:'Szabadságon',c:LM.amber} };
  const st     = ST[emp.statusz || 'aktiv'] || ST.aktiv;

  function row(icon, label, val) {
    if (!val) return '';
    return `<tr>
      <td style="padding:5px 10px;color:${LM.t3};font-size:12px;white-space:nowrap;">${icon} ${label}</td>
      <td style="padding:5px 10px;color:${LM.t1};font-size:13px;">${esc(String(val))}</td></tr>`;
  }

  const wrap = document.createElement('div');
  wrap.style.cssText = `position:absolute;left:-9999px;top:${window.scrollY}px;width:600px;font-family:'Source Sans 3','Segoe UI',sans-serif;font-size:14px;line-height:1.6;color:${LM.t1};background:${LM.bg};padding:24px;box-sizing:border-box;`;

  wrap.innerHTML = `
    <div style="background:${LM.surf};border:1px solid ${LM.b};border-radius:12px;padding:20px 22px;margin-bottom:14px;display:flex;align-items:center;gap:16px;">
      <div style="width:54px;height:54px;border-radius:50%;background:${avatarColor(emp.nev)};color:#fff;display:flex;align-items:center;justify-content:center;font-size:21px;font-weight:700;flex-shrink:0;">${initials(emp.nev)}</div>
      <div style="flex:1;">
        <div style="font-size:20px;font-weight:700;">${esc(emp.nev)}</div>
        <div style="font-size:13px;color:${LM.t2};">${esc([emp.reszleg, emp.pozicio].filter(Boolean).join(' · ')) || '—'}</div>
      </div>
      <div style="background:${st.c};color:#fff;border-radius:20px;padding:4px 14px;font-size:12px;font-weight:700;">${st.l}</div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px;">
      <div style="background:${LM.surf};border:1px solid ${LM.b};border-radius:10px;padding:16px 18px;">
        <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:${LM.t3};border-bottom:1px solid ${LM.b};padding-bottom:7px;margin-bottom:10px;">Adatok</div>
        <table style="width:100%;border-collapse:collapse;">
          ${row('📞','Telefon',emp.telefon)}
          ${row('✉️','E-mail',emp.email)}
          ${row('📅','Belépett',emp.belepet)}
          ${row('🎂','Születési dátum',emp.szulDatum)}
          ${row('📋','Szerződés',SZERZODES[emp.szerzodesTipus])}
        </table>
      </div>
      <div style="background:${LM.surf};border:1px solid ${LM.b};border-radius:10px;padding:16px 18px;">
        <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:${LM.t3};border-bottom:1px solid ${LM.b};padding-bottom:7px;margin-bottom:12px;">Szabadság — ${new Date().getFullYear()}</div>
        <div style="display:flex;gap:8px;">
          ${[[felh,'Felhasznált',LM.t1],[keret,'Keret',LM.t1],[marad,'Maradt',marad<5?LM.red:LM.green]].map(([v,l,c])=>
            `<div style="flex:1;text-align:center;background:${LM.surf2};border-radius:7px;padding:10px 6px;">
              <div style="font-size:22px;font-weight:700;color:${c};">${v}</div>
              <div style="font-size:10px;color:${LM.t3};text-transform:uppercase;margin-top:2px;">${l}</div></div>`
          ).join('')}
        </div>
      </div>
    </div>
    ${(emp.kompetenciak||[]).length ? `
    <div style="background:${LM.surf};border:1px solid ${LM.b};border-radius:10px;padding:16px 18px;margin-bottom:14px;">
      <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:${LM.t3};border-bottom:1px solid ${LM.b};padding-bottom:7px;margin-bottom:10px;">Kompetenciák</div>
      <div>${emp.kompetenciak.map(k=>`<span style="display:inline-block;background:${LM.agl};color:${LM.acc};border:1px solid rgba(21,101,192,.2);border-radius:20px;padding:2px 10px;font-size:11px;font-weight:600;margin:2px;">${esc(k)}</span>`).join('')}</div>
    </div>` : ''}
    ${emp.megjegyzes ? `
    <div style="background:${LM.surf};border:1px solid ${LM.b};border-radius:10px;padding:16px 18px;margin-bottom:14px;">
      <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:${LM.t3};border-bottom:1px solid ${LM.b};padding-bottom:7px;margin-bottom:8px;">Megjegyzés</div>
      <div style="font-size:13px;color:${LM.t2};font-style:italic;white-space:pre-wrap;">${esc(emp.megjegyzes)}</div>
    </div>` : ''}
    <div style="text-align:right;font-size:10px;color:${LM.t3};margin-top:4px;">
      Generálva: ${new Date().toLocaleDateString('hu-HU',{year:'numeric',month:'long',day:'numeric'})} — Plexiq
    </div>`;

  document.body.appendChild(wrap);
  try {
    const { jsPDF } = window.jspdf;
    const pdf    = new jsPDF({ orientation:'portrait', unit:'mm', format:'a4' });
    const pdfW   = pdf.internal.pageSize.getWidth();
    const pdfH   = pdf.internal.pageSize.getHeight();
    const MARGIN = 10;
    const canvas = await html2canvas(wrap, { scale:2, useCORS:true, allowTaint:true, backgroundColor:LM.bg });
    document.body.removeChild(wrap);
    const iw=canvas.width, ih=canvas.height, usableW=pdfW-MARGIN*2, usableH=pdfH-MARGIN*2;
    const imgH = ih * (usableW / iw);
    if (imgH <= usableH) {
      pdf.addImage(canvas.toDataURL('image/jpeg',.94),'JPEG',MARGIN,MARGIN,usableW,imgH);
    } else {
      const pageHpx = Math.floor(iw * usableH / usableW);
      let sy = 0;
      while (sy < ih) {
        const sh = Math.min(pageHpx, ih - sy);
        const tmp = document.createElement('canvas');
        tmp.width = iw; tmp.height = sh;
        tmp.getContext('2d').drawImage(canvas, 0, sy, iw, sh, 0, 0, iw, sh);
        if (sy > 0) pdf.addPage();
        pdf.addImage(tmp.toDataURL('image/jpeg',.94),'JPEG',MARGIN,MARGIN,usableW,sh*(usableW/iw));
        sy += pageHpx;
      }
    }
    pdf.save(`${emp.nev.replace(/\s+/g,'_')}_adatlap.pdf`);
    msg('PDF mentve!');
  } catch (err) {
    if (document.body.contains(wrap)) document.body.removeChild(wrap);
    msg('PDF hiba: ' + err.message, 'error');
  }
}

/* ══════════════════════════════════════
   HIÁNYZÁSOK
══════════════════════════════════════ */
export async function loadAbsences() {
  if (!_empLoaded) await loadEmployees();
  const honapF = E('hianyHonapF')?.value || tod().slice(0, 7);
  const nevF   = E('hianyNevF')?.value   || '';
  try {
    const snap = await getDocs(query(collection(db,'absences'),
      where('tol','>=',honapF+'-01'), where('tol','<=',honapF+'-31'), orderBy('tol')));
    let list = snap.docs.map(d => ({ id:d.id, ...d.data() }));
    if (nevF) list = list.filter(a => a.dolgozoNev === nevF);
    renderAbsenceList(list);
  } catch (e) { msg('Betöltési hiba: '+e.message,'error'); }
}

function renderAbsenceList(list) {
  const summary = {};
  list.forEach(a => {
    if (!summary[a.dolgozoNev]) summary[a.dolgozoNev] = { total:0, reszlet:{} };
    const n = countDays(a.tol, a.ig);
    summary[a.dolgozoNev].total += n;
    summary[a.dolgozoNev].reszlet[a.tipus] = (summary[a.dolgozoNev].reszlet[a.tipus] || 0) + n;
  });

  let h = '';
  if (Object.keys(summary).length) {
    h += '<div class="nossz" style="margin-bottom:16px;">';
    Object.entries(summary).sort(([a],[b])=>a.localeCompare(b,'hu')).forEach(([nev,s]) => {
      const r = Object.entries(s.reszlet).map(([t,n])=>`${HIANYZAS[t]?.icon||''}${n}n`).join(' ');
      h += `<div class="nossz-item"><div class="nossz-val">${s.total}</div><div class="nossz-lbl">${esc(nev)}</div><div style="font-size:10px;color:var(--text3);margin-top:2px;">${r}</div></div>`;
    });
    h += '</div>';
  }

  if (!list.length) {
    h += `<div class="empty-st"><div class="empty-ic">📅</div><div class="empty-title">Nincs rögzített hiányzás</div></div>`;
  } else {
    h += '<div style="display:flex;flex-direction:column;gap:8px;">';
    list.forEach(a => {
      const tip = HIANYZAS[a.tipus] || HIANYZAS.egyeb;
      const n   = countDays(a.tol, a.ig);
      const del = canEditEmp() ? `<button class="btn btn-danger btn-xs abs-del-btn" data-id="${a.id}" style="flex-shrink:0;">✕</button>` : '';
      h += `<div style="display:flex;align-items:center;gap:12px;padding:10px 14px;background:var(--surf);border:1px solid var(--border);border-radius:var(--r);">
        <span style="font-size:20px;flex-shrink:0;">${tip.icon}</span>
        <div style="flex:1;min-width:0;">
          <div style="font-weight:600;font-size:13.5px;color:var(--text);">${esc(a.dolgozoNev)}</div>
          <div style="font-size:12px;color:var(--text3);">${esc(tip.label)} · ${esc(a.tol)}${a.ig && a.ig !== a.tol?' → '+esc(a.ig):''} · <strong>${n} nap</strong></div>
          ${a.megjegyzes?`<div style="font-size:11.5px;color:var(--text2);font-style:italic;">${esc(a.megjegyzes)}</div>`:''}
        </div>${del}</div>`;
    });
    h += '</div>';
  }
  E('hianyListDiv').innerHTML = h;
}

export async function saveAbsence() {
  const nev = E('absFormNev').value;
  const tol = E('absFormTol').value;
  const ig  = E('absFormIg').value || tol;
  if (!nev) { msg('Válassz dolgozót!', 'error'); return; }
  if (!tol) { msg('Kezdő dátum kötelező!', 'error'); return; }
  if (ig < tol) { msg('A végdátum nem lehet korábbi a kezdőnél!', 'error'); return; }
  const absData = { dolgozoNev:nev, tol, ig, tipus:E('absFormTipus').value||'szabadsag', megjegyzes:E('absFormMegj').value.trim() };
  if (!navigator.onLine) {
    queueOp('absence.create', absData);
    msg('Offline — hiányzás sorba rakva, szinkronizálódik visszatéréskor.', 'info', 4000);
    E('absFormTol').value = E('absFormIg').value = E('absFormMegj').value = '';
    return;
  }
  try {
    await addDoc(collection(db,'absences'), { ...absData, createdBy: state.appUser.uid, createdAt: serverTimestamp() });
    msg('Hiányzás rögzítve.');
    logAction('absence.create', { dolgozoNev: nev, datum: tol });
    E('absFormTol').value = E('absFormIg').value = E('absFormMegj').value = '';
    loadAbsences();
    _loadSzabadsagMap().then(() => renderEmployeeGrid());
  } catch (e) { msg('Mentési hiba: '+e.message,'error'); }
}

export async function handleAbsenceClick(e) {
  const btn = e.target.closest('.abs-del-btn'); if (!btn) return;
  if (!confirm('Törlöd ezt a hiányzást?')) return;
  try {
    const absSnap = await getDoc(doc(db,'absences',btn.dataset.id));
    const absData = absSnap.exists() ? absSnap.data() : {};
    await deleteDoc(doc(db,'absences',btn.dataset.id));
    logAction('absence.delete', { dolgozoNev: absData.nev || '—', datum: absData.tol || '—' });
    msg('Hiányzás törölve.'); loadAbsences();
    _loadSzabadsagMap().then(() => renderEmployeeGrid());
  } catch (e) { msg('Törlési hiba','error'); }
}

/* ══════════════════════════════════════
   NAPTÁR — hiányzás roster
══════════════════════════════════════ */
export async function loadCalendar() {
  if (!_empLoaded) await loadEmployees();
  const honapF   = E('naptarHonapF')?.value;
  const reszlegF = E('naptarReszlegF')?.value || '';
  if (!honapF) { msg('Válassz hónapot!', 'error'); return; }

  _hideCalQuickAdd();
  const [yearStr, monthStr] = honapF.split('-');
  const year  = Number(yearStr), month = Number(monthStr);
  const days  = daysInMonth(year, month);
  const from  = `${honapF}-01`;
  const to    = `${honapF}-${String(days).padStart(2,'0')}`;
  const prevFrom = new Date(year, month - 2, 1).toISOString().slice(0, 10);

  E('naptarDiv').innerHTML = '<div class="empty-st"><div class="spinner" style="margin:0 auto"></div></div>';
  try {
    const snap = await getDocs(query(collection(db,'absences'),
      where('tol','>=',prevFrom), where('tol','<=',to), orderBy('tol')));
    const absences = snap.docs.map(d => ({ id:d.id, ...d.data() })).filter(a => (a.ig||a.tol) >= from);

    let emps = _employees.filter(e => (e.statusz || 'aktiv') !== 'inaktiv');
    if (reszlegF) emps = emps.filter(e => e.reszleg === reszlegF);

    const dayMap = {};
    absences.forEach(a => {
      const nev = a.dolgozoNev;
      if (!dayMap[nev]) dayMap[nev] = {};
      for (let d = 1; d <= days; d++) {
        const ds = `${honapF}-${String(d).padStart(2,'0')}`;
        if (isAbsentOnDay(a, ds)) dayMap[nev][d] = HIANYZAS[a.tipus] || HIANYZAS.egyeb;
      }
    });

    const names = [...new Set([...emps.map(e=>e.nev), ...Object.keys(dayMap)])]
      .sort((a,b)=>a.localeCompare(b,'hu'));

    if (!names.length) {
      E('naptarDiv').innerHTML = `<div class="empty-st"><div class="empty-ic">🗓</div><div class="empty-title">Nincs aktív dolgozó</div></div>`;
      return;
    }

    const HONAP_NEV = ['','Január','Február','Március','Április','Május','Június',
                       'Július','Augusztus','Szeptember','Október','November','December'];

    let h = `<div style="font-size:14px;font-weight:700;color:var(--text);margin-bottom:12px;">${HONAP_NEV[month]} ${year}</div>`;
    h += '<div style="overflow-x:auto;"><table class="abs-roster-table"><thead><tr>';
    h += '<th class="abs-roster-name-cell">Dolgozó</th>';
    for (let d = 1; d <= days; d++) {
      const dow  = new Date(year, month-1, d).getDay();
      const isWe = dow === 0 || dow === 6;
      h += `<th class="abs-roster-day-cell${isWe?' abs-roster-we':''}">${d}</th>`;
    }
    h += '</tr></thead><tbody>';
    names.forEach(nev => {
      h += `<tr><td class="abs-roster-name-cell">${esc(nev)}</td>`;
      for (let d = 1; d <= days; d++) {
        const dow  = new Date(year, month-1, d).getDay();
        const isWe = dow === 0 || dow === 6;
        const abs  = dayMap[nev]?.[d];
        const ds   = `${honapF}-${String(d).padStart(2,'0')}`;
        const cls  = abs ? ` ${abs.cls}` : (isWe ? ' abs-roster-we' : '');
        const tt   = abs ? ` title="${abs.label}"` : '';
        const canAdd = canEditEmp() && !abs && !isWe;
        h += `<td class="abs-roster-cell${cls}"${tt}${canAdd ? ` data-nev="${esc(nev)}" data-datum="${esc(ds)}" style="cursor:pointer;" title="+ Hiányzás rögzítése"` : ''}>${abs ? abs.icon : ''}</td>`;
      }
      h += '</tr>';
    });
    h += '</tbody></table></div>';
    h += '<div class="abs-roster-legend">';
    Object.values(HIANYZAS).forEach(t => {
      h += `<span class="abs-leg-item"><span class="abs-leg-dot ${t.cls}"></span>${t.label}</span>`;
    });
    if (canEditEmp()) h += '<span class="abs-leg-item" style="color:var(--text3);font-style:italic;margin-left:auto;font-size:11px;">Üres cellára kattintva hozzáadhatsz hiányzást</span>';
    h += '</div>';

    E('naptarDiv').innerHTML = h;

    // Kattintásra gyors-hozzáadás
    if (canEditEmp()) {
      E('naptarDiv').querySelectorAll('td[data-nev]').forEach(cell => {
        cell.addEventListener('click', () => {
          _showCalQuickAdd(cell.dataset.nev, cell.dataset.datum);
        });
      });
    }
  } catch (e) {
    msg('Hiba: '+e.message,'error');
    E('naptarDiv').innerHTML = '';
  }
}

function _showCalQuickAdd(nev, datum) {
  const panel = E('calQuickAddPanel'); if (!panel) return;
  E('calQaNev').value   = nev;
  E('calQaDatum').value = datum;
  E('calQaIg').value    = datum;
  E('calQaTipus').value = 'szabadsag';
  E('calQaMegj').value  = '';
  panel.style.display = '';
  panel.scrollIntoView({ behavior:'smooth', block:'nearest' });
}

function _hideCalQuickAdd() {
  const panel = E('calQuickAddPanel'); if (panel) panel.style.display = 'none';
}

export async function saveCalQuickAdd() {
  const nev  = E('calQaNev').value;
  const tol  = E('calQaDatum').value;
  const ig   = E('calQaIg').value || tol;
  const tip  = E('calQaTipus').value || 'szabadsag';
  if (!nev || !tol) { msg('Hiányzó adat!', 'error'); return; }
  if (ig < tol) { msg('A végdátum nem lehet korábbi a kezdőnél!', 'error'); return; }
  try {
    await addDoc(collection(db,'absences'), {
      dolgozoNev:nev, tol, ig, tipus:tip,
      megjegyzes:E('calQaMegj').value.trim(),
      createdBy:state.appUser.uid, createdAt:serverTimestamp()
    });
    msg('Hiányzás rögzítve.');
    _hideCalQuickAdd();
    loadCalendar();
    _loadSzabadsagMap().then(() => renderEmployeeGrid());
  } catch (e) { msg('Mentési hiba: '+e.message,'error'); }
}

/* ══════════════════════════════════════
   STATISZTIKA
══════════════════════════════════════ */
export async function loadStatisztika() {
  const evF = E('statEvF')?.value;
  if (!evF) { msg('Válassz évet!', 'error'); return; }
  const from = `${evF}-01-01`, to = `${evF}-12-31`;

  E('statDiv').innerHTML = '<div class="empty-st"><div class="spinner" style="margin:0 auto"></div></div>';
  try {
    const snap = await getDocs(query(collection(db,'absences'),
      where('tol','>=',from), where('tol','<=',to), orderBy('tol')));
    const absences = snap.docs.map(d => d.data());

    const empMap = {}, monthMap = {};
    absences.forEach(a => {
      if (!empMap[a.dolgozoNev]) empMap[a.dolgozoNev] = { szabadsag:0, betegseg:0, fizetesnelkuli:0, egyeb:0 };
      const n = countDays(a.tol, a.ig);
      empMap[a.dolgozoNev][a.tipus] = (empMap[a.dolgozoNev][a.tipus] || 0) + n;
      const mo = a.tol.slice(0,7);
      monthMap[mo] = (monthMap[mo] || 0) + n;
    });

    if (!Object.keys(empMap).length) {
      E('statDiv').innerHTML = `<div class="empty-st"><div class="empty-ic">📊</div><div class="empty-title">Nincs rögzített hiányzás ebben az évben</div></div>`;
      _lastStatData = null; return;
    }

    const sorted = Object.entries(empMap).map(([nev, d]) => {
      const keret = _employees.find(e => e.nev === nev)?.szabadsagKeret ?? 20;
      return { nev, ...d, total: d.szabadsag+d.betegseg+d.fizetesnelkuli+d.egyeb, keret };
    }).sort((a,b) => b.total - a.total);

    _lastStatData = { ev:evF, sorted };

    const totals = sorted.reduce(
      (acc, r) => ({ szabadsag:acc.szabadsag+r.szabadsag, betegseg:acc.betegseg+r.betegseg,
                     fizetesnelkuli:acc.fizetesnelkuli+r.fizetesnelkuli, egyeb:acc.egyeb+r.egyeb, total:acc.total+r.total }),
      { szabadsag:0, betegseg:0, fizetesnelkuli:0, egyeb:0, total:0 }
    );

    let h = '<div class="nossz" style="margin-bottom:16px;">';
    [{val:totals.total,lbl:'Összes nap'},{val:totals.szabadsag,lbl:'🌴 Szabadság'},
     {val:totals.betegseg,lbl:'🤒 Betegszab.'},{val:totals.fizetesnelkuli,lbl:'📋 Fiz. nélk.'}]
    .forEach(({val,lbl}) => h += `<div class="nossz-item"><div class="nossz-val">${val}</div><div class="nossz-lbl">${lbl}</div></div>`);
    h += '</div>';

    h += `<div style="overflow-x:auto;"><table class="stat-table">
      <thead><tr><th>Dolgozó</th><th>🌴 Szab.</th><th>🤒 Beteg</th><th>📋 Fiz.n.</th><th>❓ Egyéb</th><th>Össz.</th><th>Keret</th></tr></thead><tbody>`;
    sorted.forEach(r => {
      const marad = Math.max(0, r.keret - r.szabadsag);
      h += `<tr>
        <td style="font-weight:600;color:var(--text);">${esc(r.nev)}</td>
        <td>${r.szabadsag||'—'}</td><td>${r.betegseg||'—'}</td>
        <td>${r.fizetesnelkuli||'—'}</td><td>${r.egyeb||'—'}</td>
        <td style="font-weight:700;">${r.total}</td>
        <td style="color:${marad<5?'var(--red)':'var(--text2)'};font-weight:600;">${r.szabadsag}/${r.keret} · <strong>${marad} maradt</strong></td>
      </tr>`;
    });
    h += '</tbody></table></div>';

    // ── Részlegenként összesítés ──
    const deptMap = {};
    sorted.forEach(r => {
      const emp  = _employees.find(e => e.nev === r.nev);
      const dept = emp?.reszleg || '(Ismeretlen részleg)';
      if (!deptMap[dept]) deptMap[dept] = { szabadsag:0, betegseg:0, fizetesnelkuli:0, egyeb:0, total:0, count:0 };
      deptMap[dept].szabadsag      += r.szabadsag;
      deptMap[dept].betegseg       += r.betegseg;
      deptMap[dept].fizetesnelkuli += r.fizetesnelkuli;
      deptMap[dept].egyeb          += r.egyeb;
      deptMap[dept].total          += r.total;
      deptMap[dept].count          += 1;
    });

    if (Object.keys(deptMap).length > 1) {
      const deptSorted = Object.entries(deptMap).sort((a,b)=>b[1].total-a[1].total);
      const maxDept    = Math.max(...deptSorted.map(([,d])=>d.total));
      h += '<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:var(--text3);margin:20px 0 10px;">Részlegenként</div>';
      h += `<div style="overflow-x:auto;"><table class="stat-table">
        <thead><tr><th>Részleg</th><th>Dolgozók</th><th>🌴 Szab.</th><th>🤒 Beteg</th><th>📋 Fiz.n.</th><th>Össz.</th><th>Arány</th></tr></thead><tbody>`;
      deptSorted.forEach(([dept, d]) => {
        const pct  = maxDept > 0 ? Math.round(d.total / maxDept * 100) : 0;
        h += `<tr>
          <td style="font-weight:600;color:var(--text);">${esc(dept)}</td>
          <td style="color:var(--text3);">${d.count}</td>
          <td>${d.szabadsag||'—'}</td><td>${d.betegseg||'—'}</td><td>${d.fizetesnelkuli||'—'}</td>
          <td style="font-weight:700;">${d.total}</td>
          <td><div style="display:flex;align-items:center;gap:8px;">
            <div style="height:6px;width:${Math.round(pct*.7)}px;max-width:60px;background:var(--accent);border-radius:3px;opacity:.65;flex-shrink:0;"></div>
            <span style="font-size:12px;color:var(--text3);">${d.count>0?(d.total/d.count).toFixed(1):0} nap/fő</span>
          </div></td>
        </tr>`;
      });
      h += '</tbody></table></div>';
    }

    // Havi bontás
    if (Object.keys(monthMap).length > 1) {
      const HONAP = ['','Jan','Feb','Már','Ápr','Máj','Jún','Júl','Aug','Szep','Okt','Nov','Dec'];
      const maxVal = Math.max(...Object.values(monthMap));
      h += '<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:var(--text3);margin:20px 0 10px;">Havi bontás</div>';
      h += '<div class="nossz">';
      Object.entries(monthMap).sort().forEach(([mo,n]) => {
        const m = Number(mo.split('-')[1]);
        h += `<div class="nossz-item" style="min-width:65px;">
          <div class="nossz-val">${n}</div><div class="nossz-lbl">${HONAP[m]}</div>
          <div style="height:3px;background:var(--accent);border-radius:2px;margin-top:5px;width:${Math.round(n/maxVal*100)}%;min-width:4px;"></div>
        </div>`;
      });
      h += '</div>';
    }

    // ── Túlóra összesítő ──
    try {
      const tuSnap = await getDocs(query(collection(db, 'overtimes'),
        where('datum','>=',`${evF}-01-01`), where('datum','<=',`${evF}-12-31`), orderBy('datum')));
      const tuls = tuSnap.docs.map(d => d.data());
      if (tuls.length) {
        const tuByW = {};
        tuls.forEach(t => { tuByW[t.dolgozoNev] = (tuByW[t.dolgozoNev]||0) + (t.oraSzam||0); });
        const tuSorted = Object.entries(tuByW).sort((a,b)=>b[1]-a[1]);
        const tuTotal  = tuls.reduce((s,t)=>s+(t.oraSzam||0),0);
        h += `<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:var(--text3);margin:20px 0 10px;">⏰ Túlóra összesítő</div>
          <div class="nossz" style="margin-bottom:14px;">
            <div class="nossz-item"><div class="nossz-val">${tuTotal.toFixed(1)}</div><div class="nossz-lbl">Összes óra</div></div>
            <div class="nossz-item"><div class="nossz-val">${tuSorted.length}</div><div class="nossz-lbl">Dolgozó</div></div>
          </div>
          <div style="overflow-x:auto;"><table class="stat-table">
            <thead><tr><th>Dolgozó</th><th style="text-align:right;">Túlóra (óra)</th></tr></thead><tbody>`;
        tuSorted.forEach(([nev,ora]) => { h+=`<tr><td style="font-weight:600;">${esc(nev)}</td><td style="text-align:right;font-weight:700;">${ora.toFixed(1)} h</td></tr>`; });
        h += `</tbody></table></div>`;
      }
    } catch {}

    _lastStatData = { ev: evF, sorted, tuleraSorted: undefined };
    E('statDiv').innerHTML = h;
  } catch (e) { msg('Hiba: '+e.message,'error'); E('statDiv').innerHTML = ''; }
}

/* ══════════════════════════════════════
   TÚLÓRA NYILVÁNTARTÁS
══════════════════════════════════════ */
export async function loadTulora() {
  if (!_empLoaded) await loadEmployees();
  const honapF = E('tuloraHonapF')?.value || tod().slice(0, 7);
  const nevF   = E('tuloraNevF')?.value  || '';

  // Feltölti a dolgozó selecteket
  const aktiv = _employees.filter(e => e.statusz !== 'inaktiv').sort((a,b)=>a.nev.localeCompare(b.nev,'hu'));
  const nevOpts = '<option value="">— Mindenki —</option>' + aktiv.map(e=>`<option value="${esc(e.nev)}">${esc(e.nev)}</option>`).join('');
  if (E('tuloraNevF')) E('tuloraNevF').innerHTML = nevOpts;
  if (E('tuloraFormNev')) E('tuloraFormNev').innerHTML = '<option value="">— Válassz —</option>' + aktiv.map(e=>`<option value="${esc(e.nev)}">${esc(e.nev)}</option>`).join('');

  E('tuloraListDiv').innerHTML = '<div class="empty-st"><div class="spinner" style="margin:0 auto"></div></div>';
  try {
    const snap = await getDocs(query(
      collection(db, 'overtimes'),
      where('datum', '>=', honapF + '-01'),
      where('datum', '<=', honapF + '-31'),
      orderBy('datum')
    ));
    let list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (nevF) list = list.filter(t => t.dolgozoNev === nevF);
    _renderTulora(list);
  } catch (e) { msg('Betöltési hiba: ' + e.message, 'error'); }
}

function _renderTulora(list) {
  const div = E('tuloraListDiv'); if (!div) return;

  if (!list.length) {
    div.innerHTML = `<div class="empty-st"><div class="empty-ic">⏰</div><div class="empty-title">Nincs túlóra ebben a hónapban</div></div>`;
    return;
  }

  // Összesítő
  const byWorker = {};
  list.forEach(t => { byWorker[t.dolgozoNev] = (byWorker[t.dolgozoNev] || 0) + (t.oraSzam || 0); });
  const total = list.reduce((s, t) => s + (t.oraSzam || 0), 0);

  let h = '<div class="nossz" style="margin-bottom:16px;">';
  h += `<div class="nossz-item"><div class="nossz-val">${total.toFixed(1)}</div><div class="nossz-lbl">Összes óra</div></div>`;
  Object.entries(byWorker).sort((a,b) => b[1]-a[1]).slice(0,3).forEach(([nev,ora]) => {
    h += `<div class="nossz-item"><div class="nossz-val">${ora.toFixed(1)}</div><div class="nossz-lbl">${esc(nev)}</div></div>`;
  });
  h += '</div>';

  h += '<div style="display:flex;flex-direction:column;gap:8px;">';
  list.forEach(t => {
    const canDel = canEditEmp() || t.createdBy === state.appUser?.uid;
    h += `<div style="display:flex;align-items:center;gap:12px;padding:10px 14px;background:var(--surf);border:1px solid var(--border);border-radius:var(--r);">
      <span style="font-size:20px;flex-shrink:0;">⏰</span>
      <div style="flex:1;min-width:0;">
        <div style="font-weight:600;font-size:13.5px;color:var(--text);">${esc(t.dolgozoNev)}</div>
        <div style="font-size:12px;color:var(--text3);">${esc(t.datum)} · <strong>${t.oraSzam} óra</strong>${t.megjegyzes ? ' · ' + esc(t.megjegyzes) : ''}</div>
      </div>
      ${canDel ? `<button class="btn btn-danger btn-xs tulora-del-btn" data-id="${t.id}" data-nev="${esc(t.dolgozoNev||'')}" data-datum="${esc(t.datum||'')}">✕</button>` : ''}
    </div>`;
  });
  h += '</div>';
  div.innerHTML = h;
}

export async function saveTulora() {
  const nev  = E('tuloraFormNev').value;
  const datum= E('tuloraFormDatum').value;
  const ora  = parseFloat(E('tuloraFormOra').value);
  if (!nev)        { msg('Válassz dolgozót!', 'error'); return; }
  if (!datum)      { msg('Dátum kötelező!', 'error'); return; }
  if (!ora || ora <= 0) { msg('Adj meg érvényes óra értéket!', 'error'); return; }
  try {
    await addDoc(collection(db, 'overtimes'), {
      dolgozoNev: nev, datum, oraSzam: ora,
      megjegyzes: E('tuloraFormMegj').value.trim() || '',
      createdBy: state.appUser.uid, createdAt: serverTimestamp()
    });
    logAction('overtime.create', { dolgozoNev: nev, datum, oraSzam: ora });
    msg('Túlóra rögzítve.');
    E('tuloraFormDatum').value = E('tuloraFormOra').value = E('tuloraFormMegj').value = '';
    loadTulora();
  } catch (e) { msg('Mentési hiba: ' + e.message, 'error'); }
}

export async function handleTuloraClick(e) {
  const btn = e.target.closest('.tulora-del-btn'); if (!btn) return;
  if (!confirm('Törlöd ezt a túlóra bejegyzést?')) return;
  try {
    await deleteDoc(doc(db, 'overtimes', btn.dataset.id));
    logAction('overtime.delete', { dolgozoNev: btn.dataset.nev || '—', datum: btn.dataset.datum || '—' });
    msg('Túlóra törölve.'); loadTulora();
  } catch (e) { msg('Törlési hiba', 'error'); }
}

export function exportCsv() {
  if (!_lastStatData) { msg('Először kattints a Mutat gombra!','error'); return; }
  const { ev, sorted } = _lastStatData;
  let csv = 'Dolgozó;Szabadság;Betegszabadság;Fizetés nélküli;Egyéb;Összesen;Keret;Felhasznált;Maradt\n';
  sorted.forEach(r => {
    const marad = Math.max(0, r.keret - r.szabadsag);
    csv += `${r.nev};${r.szabadsag};${r.betegseg};${r.fizetesnelkuli};${r.egyeb};${r.total};${r.keret};${r.szabadsag};${marad}\n`;
  });
  const blob = new Blob(['﻿'+csv], { type:'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.download = `hianyzas_${ev}.csv`;
  a.href = URL.createObjectURL(blob);
  a.click();
  URL.revokeObjectURL(a.href);
  msg('CSV exportálva.');
}
