import { db, doc, addDoc, updateDoc, deleteDoc,
         collection, query, where, getDocs, orderBy, serverTimestamp } from './firebase.js';
import { state, hasPerm, isMainAdmin } from './state.js';
import { E, esc, msg, tod } from './utils.js';

const HIANYZAS = {
  szabadsag:      { label: 'Szabadság',       icon: '🌴', cls: 'abs-szabadsag' },
  betegseg:       { label: 'Betegszabadság',  icon: '🤒', cls: 'abs-betegseg' },
  fizetesnelkuli: { label: 'Fizetés nélküli', icon: '📋', cls: 'abs-fizetesnelkuli' },
  egyeb:          { label: 'Egyéb',            icon: '❓', cls: 'abs-egyeb' }
};

const SZERZODES = {
  hatarozatlan: 'Határozatlan',
  hatarozott:   'Határozott',
  megbizasi:    'Megbízási'
};

let _employees    = [];
let _empLoaded    = false;
let _editingId    = null;
let _szabadsagMap = {};
let _lastStatData = null;

/* ── Helpers ──────────────────────────────────────────── */

export function canEditEmp() { return isMainAdmin() || hasPerm('dolgozokKezeles'); }

function initials(nev) {
  return nev.split(' ').slice(0, 2).map(w => w[0]?.toUpperCase() || '').join('');
}

function avatarColor(nev) {
  const palette = ['#1565C0','#2E7D32','#C62828','#E65100','#6A1B9A','#00695C','#AD1457','#0277BD'];
  let h = 0;
  for (let i = 0; i < nev.length; i++) h = nev.charCodeAt(i) + ((h << 5) - h);
  return palette[Math.abs(h) % palette.length];
}

function countDays(tol, ig) {
  const a = new Date(tol), b = new Date(ig || tol);
  return Math.max(1, Math.round((b - a) / 86400000) + 1);
}

function daysInMonth(year, month) { return new Date(year, month, 0).getDate(); }

function isAbsentOnDay(abs, dateStr) {
  return abs.tol <= dateStr && dateStr <= (abs.ig || abs.tol);
}

async function _loadSzabadsagMap() {
  const ev   = new Date().getFullYear();
  const from = `${ev}-01-01`;
  const to   = `${ev}-12-31`;
  try {
    const snap = await getDocs(query(
      collection(db, 'absences'),
      where('tol', '>=', from), where('tol', '<=', to), orderBy('tol')
    ));
    _szabadsagMap = {};
    snap.docs.forEach(d => {
      const a = d.data();
      if (a.tipus !== 'szabadsag') return;
      _szabadsagMap[a.dolgozoNev] = (_szabadsagMap[a.dolgozoNev] || 0) + countDays(a.tol, a.ig);
    });
  } catch { _szabadsagMap = {}; }
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
  const aktiv = _employees.filter(e => e.statusz !== 'inaktiv')
    .sort((a, b) => a.nev.localeCompare(b.nev, 'hu'));
  const all   = [..._employees].sort((a, b) => a.nev.localeCompare(b.nev, 'hu'));
  const af = E('absFormNev');
  if (af) af.innerHTML = '<option value="">— Válassz —</option>' +
    aktiv.map(e => `<option value="${esc(e.nev)}">${esc(e.nev)}</option>`).join('');
  const hf = E('hianyNevF');
  if (hf) hf.innerHTML = '<option value="">— Mindenki —</option>' +
    all.map(e => `<option value="${esc(e.nev)}">${esc(e.nev)}</option>`).join('');
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
  let list = _employees;
  if (reszlegF) list = list.filter(e => e.reszleg === reszlegF);
  if (statuszF) list = list.filter(e => (e.statusz || 'aktiv') === statuszF);

  const grid = E('dolgozoGrid'); if (!grid) return;
  if (!list.length) {
    grid.innerHTML = '<div class="empty-st"><div class="empty-ic">👷</div>Nincs megjeleníthető dolgozó</div>';
    return;
  }

  const STATUSZ = {
    aktiv:     { label: 'Aktív',       cls: 'emp-aktiv' },
    inaktiv:   { label: 'Inaktív',     cls: 'emp-inaktiv' },
    szabadsag: { label: 'Szabadságon', cls: 'emp-szab' }
  };

  const today   = tod();
  const in30    = new Date(); in30.setDate(in30.getDate() + 30);
  const in30Str = in30.toISOString().slice(0, 10);

  grid.innerHTML = '<div class="emp-grid">' + list.map(emp => {
    const st    = STATUSZ[emp.statusz || 'aktiv'] || STATUSZ.aktiv;
    const keret = emp.szabadsagKeret ?? 20;
    const felh  = _szabadsagMap[emp.nev] || 0;
    const marad = Math.max(0, keret - felh);

    const szabBadge = `<div class="emp-szab-badge${marad < 5 ? ' emp-szab-low' : ''}">
      🌴 ${felh}/${keret} nap · <strong>${marad} maradt</strong></div>`;

    let probaWarn = '';
    if (emp.probaidoVege && emp.probaidoVege >= today && emp.probaidoVege <= in30Str) {
      probaWarn = `<div class="emp-proba-warn">⚠️ Próbaidő vége: ${esc(emp.probaidoVege)}</div>`;
    }

    return `<div class="emp-card emp-card-clickable" data-id="${esc(emp.id)}">
      <div style="display:flex;gap:12px;align-items:flex-start;">
        <div class="emp-avatar-sm" style="background:${avatarColor(emp.nev)};flex-shrink:0;">${initials(emp.nev)}</div>
        <div style="flex:1;min-width:0;">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:6px;">
            <div style="min-width:0;">
              <div class="emp-name">${esc(emp.nev)}</div>
              <div class="emp-dept">${esc(emp.reszleg || '—')}</div>
            </div>
            <span class="emp-status ${st.cls}" style="flex-shrink:0;margin-top:2px;">${st.label}</span>
          </div>
        </div>
      </div>
      ${szabBadge}
      ${probaWarn}
    </div>`;
  }).join('') + '</div>';
}

export function openEmpForm(emp = null) {
  _editingId = emp?.id || null;
  E('empFormNev').value            = emp?.nev            || '';
  E('empFormReszleg').value        = emp?.reszleg        || '';
  E('empFormBelepet').value        = emp?.belepet        || '';
  E('empFormStatusz').value        = emp?.statusz        || 'aktiv';
  E('empFormMegj').value           = emp?.megjegyzes     || '';
  E('empFormTelefon').value        = emp?.telefon        || '';
  E('empFormEmail').value          = emp?.email          || '';
  E('empFormSzulDatum').value      = emp?.szulDatum      || '';
  E('empFormProbaidoVege').value   = emp?.probaidoVege   || '';
  E('empFormSzerzodesT').value     = emp?.szerzodesTipus || 'hatarozatlan';
  E('empFormSzabadsagKeret').value = emp?.szabadsagKeret ?? 20;
  E('empFormTitle').textContent    = emp ? 'Dolgozó szerkesztése' : 'Új dolgozó';
  const dl = E('empFormReszlegDL');
  if (dl) dl.innerHTML = (state.reszlegek || [])
    .map(r => `<option value="${esc(r)}"></option>`).join('');
  E('dolgozoForm').style.display = '';
  E('empFormNev').focus();
}

export function closeEmpForm() {
  _editingId = null;
  E('dolgozoForm').style.display = 'none';
}

export async function saveEmployee() {
  const nev = E('empFormNev').value.trim();
  if (!nev) { msg('A név kötelező!', 'error'); return; }
  const data = {
    nev,
    reszleg:        E('empFormReszleg').value.trim(),
    belepet:        E('empFormBelepet').value        || null,
    statusz:        E('empFormStatusz').value        || 'aktiv',
    megjegyzes:     E('empFormMegj').value.trim(),
    telefon:        E('empFormTelefon').value.trim(),
    email:          E('empFormEmail').value.trim(),
    szulDatum:      E('empFormSzulDatum').value      || null,
    probaidoVege:   E('empFormProbaidoVege').value   || null,
    szerzodesTipus: E('empFormSzerzodesT').value     || 'hatarozatlan',
    szabadsagKeret: Number(E('empFormSzabadsagKeret').value) || 20
  };
  try {
    if (_editingId) {
      await updateDoc(doc(db, 'employees', _editingId),
        { ...data, updatedBy: state.appUser.uid, updatedAt: serverTimestamp() });
      msg('Dolgozó frissítve.');
    } else {
      await addDoc(collection(db, 'employees'),
        { ...data, createdBy: state.appUser.uid, createdAt: serverTimestamp() });
      msg('Dolgozó hozzáadva.');
    }
    closeEmpForm();
    await loadEmployees();
  } catch (e) { msg('Mentési hiba: ' + e.message, 'error'); }
}

export function handleEmpGridClick(e) {
  const card = e.target.closest('.emp-card-clickable');
  if (!card) return;
  const emp = _employees.find(x => x.id === card.dataset.id);
  if (emp) openEmpDrawer(emp);
}

export function openEmpDrawer(emp) {
  const STATUSZ = {
    aktiv:     { label: 'Aktív',       cls: 'emp-aktiv' },
    inaktiv:   { label: 'Inaktív',     cls: 'emp-inaktiv' },
    szabadsag: { label: 'Szabadságon', cls: 'emp-szab' }
  };
  const st    = STATUSZ[emp.statusz || 'aktiv'] || STATUSZ.aktiv;
  const keret = emp.szabadsagKeret ?? 20;
  const felh  = _szabadsagMap[emp.nev] || 0;
  const marad = Math.max(0, keret - felh);
  const today   = tod();
  const in30    = new Date(); in30.setDate(in30.getDate() + 30);
  const in30Str = in30.toISOString().slice(0, 10);

  E('empDrawerAvatar').textContent      = initials(emp.nev);
  E('empDrawerAvatar').style.background = avatarColor(emp.nev);
  E('empDrawerName').textContent        = emp.nev;
  E('empDrawerDept').textContent        = emp.reszleg || '—';
  E('empDrawerStatus').innerHTML        = `<span class="emp-status ${st.cls}">${st.label}</span>`;

  let body = '';

  // Alapadatok
  const rows = [
    emp.telefon        ? `<div class="emp-drawer-row"><span class="emp-drawer-row-icon">📞</span><span>${esc(emp.telefon)}</span></div>` : '',
    emp.email          ? `<div class="emp-drawer-row"><span class="emp-drawer-row-icon">✉️</span><span>${esc(emp.email)}</span></div>` : '',
    emp.belepet        ? `<div class="emp-drawer-row"><span class="emp-drawer-row-icon">📅</span><span>Belépett: <strong>${esc(emp.belepet)}</strong></span></div>` : '',
    emp.szulDatum      ? `<div class="emp-drawer-row"><span class="emp-drawer-row-icon">🎂</span><span>Születési dátum: <strong>${esc(emp.szulDatum)}</strong></span></div>` : '',
    emp.szerzodesTipus ? `<div class="emp-drawer-row"><span class="emp-drawer-row-icon">📋</span><span>${esc(SZERZODES[emp.szerzodesTipus] || emp.szerzodesTipus)}</span></div>` : '',
  ].filter(Boolean);
  if (rows.length) {
    body += `<div class="emp-drawer-section">
      <div class="emp-drawer-section-title">Alapadatok</div>${rows.join('')}</div>`;
  }

  // Próbaidő
  if (emp.probaidoVege) {
    const isWarn = emp.probaidoVege >= today && emp.probaidoVege <= in30Str;
    const isOver = emp.probaidoVege < today;
    body += `<div class="emp-drawer-section">
      <div class="emp-drawer-section-title">Próbaidő</div>
      <div class="emp-drawer-row">
        <span class="emp-drawer-row-icon">${isWarn ? '⚠️' : isOver ? '✅' : '⏳'}</span>
        <span style="${isWarn ? 'color:var(--amber);font-weight:600;' : ''}">
          ${isOver ? 'Lejárt: ' : 'Vége: '}<strong>${esc(emp.probaidoVege)}</strong>${isWarn ? ' — hamarosan!' : ''}
        </span>
      </div>
    </div>`;
  }

  // Szabadság
  body += `<div class="emp-drawer-section">
    <div class="emp-drawer-section-title">Szabadság — ${new Date().getFullYear()}</div>
    <div class="nossz">
      <div class="nossz-item"><div class="nossz-val">${felh}</div><div class="nossz-lbl">Felhasznált</div></div>
      <div class="nossz-item"><div class="nossz-val">${keret}</div><div class="nossz-lbl">Keret</div></div>
      <div class="nossz-item${marad < 5 ? ' emp-szab-low' : ''}">
        <div class="nossz-val">${marad}</div><div class="nossz-lbl">Maradt</div>
      </div>
    </div>
  </div>`;

  // Megjegyzés
  if (emp.megjegyzes) {
    body += `<div class="emp-drawer-section">
      <div class="emp-drawer-section-title">Megjegyzés</div>
      <div style="font-size:13.5px;color:var(--text2);font-style:italic;line-height:1.6;">${esc(emp.megjegyzes)}</div>
    </div>`;
  }

  // Műveletek
  if (canEditEmp()) {
    const isInaktiv = (emp.statusz || 'aktiv') === 'inaktiv';
    body += `<div class="emp-drawer-actions">
      <button class="btn btn-primary btn-sm" id="drawerEditBtn">✎ Szerkeszt</button>
      <button class="btn btn-${isInaktiv ? 'ghost' : 'danger'} btn-sm" id="drawerArchBtn">
        ${isInaktiv ? '▶ Aktivál' : '⏸ Archivál'}
      </button>
      <button class="btn btn-danger btn-sm" id="drawerDelBtn" style="margin-left:auto;">🗑 Töröl</button>
    </div>`;
  }

  E('empDrawerBody').innerHTML = body;

  E('drawerEditBtn')?.addEventListener('click', () => { closeEmpDrawer(); openEmpForm(emp); });
  E('drawerArchBtn')?.addEventListener('click', async () => {
    const newSt = (emp.statusz || 'aktiv') === 'inaktiv' ? 'aktiv' : 'inaktiv';
    if (!confirm(`Biztosan ${newSt === 'inaktiv' ? 'archiválod' : 'aktiválod'}?`)) return;
    try {
      await updateDoc(doc(db, 'employees', emp.id),
        { statusz: newSt, updatedBy: state.appUser.uid, updatedAt: serverTimestamp() });
      msg('Státusz frissítve.'); closeEmpDrawer(); loadEmployees();
    } catch (err) { msg('Hiba: ' + err.message, 'error'); }
  });
  E('drawerDelBtn')?.addEventListener('click', async () => {
    if (!confirm(`Véglegesen törlöd „${emp.nev}" dolgozót?`)) return;
    try {
      await deleteDoc(doc(db, 'employees', emp.id));
      msg('Dolgozó törölve.'); closeEmpDrawer(); loadEmployees();
    } catch (err) { msg('Hiba: ' + err.message, 'error'); }
  });

  E('empDrawerOverlay').classList.add('open');
  E('empDrawer').classList.add('open');
  document.body.style.overflow = 'hidden';
}

export function closeEmpDrawer() {
  E('empDrawerOverlay').classList.remove('open');
  E('empDrawer').classList.remove('open');
  document.body.style.overflow = '';
}

/* ══════════════════════════════════════
   HIÁNYZÁSOK
══════════════════════════════════════ */

export async function loadAbsences() {
  if (!_empLoaded) await loadEmployees();
  const honapF = E('hianyHonapF')?.value || tod().slice(0, 7);
  const nevF   = E('hianyNevF')?.value   || '';
  try {
    const snap = await getDocs(query(
      collection(db, 'absences'),
      where('tol', '>=', honapF + '-01'),
      where('tol', '<=', honapF + '-31'),
      orderBy('tol')
    ));
    let list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (nevF) list = list.filter(a => a.dolgozoNev === nevF);
    renderAbsenceList(list);
  } catch (e) { msg('Betöltési hiba: ' + e.message, 'error'); }
}

function renderAbsenceList(list) {
  const summary = {};
  list.forEach(a => {
    if (!summary[a.dolgozoNev]) summary[a.dolgozoNev] = { total: 0, reszlet: {} };
    const n = countDays(a.tol, a.ig);
    summary[a.dolgozoNev].total += n;
    summary[a.dolgozoNev].reszlet[a.tipus] = (summary[a.dolgozoNev].reszlet[a.tipus] || 0) + n;
  });

  let h = '';
  if (Object.keys(summary).length) {
    h += '<div class="nossz" style="margin-bottom:16px;">';
    Object.entries(summary).sort(([a], [b]) => a.localeCompare(b, 'hu')).forEach(([nev, s]) => {
      const reszlet = Object.entries(s.reszlet)
        .map(([t, n]) => `${HIANYZAS[t]?.icon || ''}${n}n`).join(' ');
      h += `<div class="nossz-item">
        <div class="nossz-val">${s.total}</div>
        <div class="nossz-lbl">${esc(nev)}</div>
        <div style="font-size:10px;color:var(--text3);margin-top:2px;">${reszlet}</div>
      </div>`;
    });
    h += '</div>';
  }

  if (!list.length) {
    h += '<div class="empty-st"><div class="empty-ic">📅</div>Nincs rögzített hiányzás erre a hónapra</div>';
  } else {
    h += '<div style="display:flex;flex-direction:column;gap:8px;">';
    list.forEach(a => {
      const tip   = HIANYZAS[a.tipus] || HIANYZAS.egyeb;
      const napok = countDays(a.tol, a.ig);
      const del   = canEditEmp()
        ? `<button class="btn btn-danger btn-xs abs-del-btn" data-id="${a.id}" style="flex-shrink:0;">✕</button>`
        : '';
      h += `<div style="display:flex;align-items:center;gap:12px;padding:10px 14px;background:var(--surf);border:1px solid var(--border);border-radius:var(--r);">
        <span style="font-size:20px;flex-shrink:0;">${tip.icon}</span>
        <div style="flex:1;min-width:0;">
          <div style="font-weight:600;font-size:13.5px;color:var(--text);">${esc(a.dolgozoNev)}</div>
          <div style="font-size:12px;color:var(--text3);">${esc(tip.label)} · ${esc(a.tol)}${a.ig && a.ig !== a.tol ? ' → ' + esc(a.ig) : ''} · <strong>${napok} nap</strong></div>
          ${a.megjegyzes ? `<div style="font-size:11.5px;color:var(--text2);font-style:italic;">${esc(a.megjegyzes)}</div>` : ''}
        </div>
        ${del}
      </div>`;
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
  try {
    await addDoc(collection(db, 'absences'), {
      dolgozoNev: nev, tol, ig,
      tipus:      E('absFormTipus').value || 'szabadsag',
      megjegyzes: E('absFormMegj').value.trim(),
      createdBy:  state.appUser.uid,
      createdAt:  serverTimestamp()
    });
    msg('Hiányzás rögzítve.');
    E('absFormTol').value  = '';
    E('absFormIg').value   = '';
    E('absFormMegj').value = '';
    loadAbsences();
    _loadSzabadsagMap().then(() => renderEmployeeGrid());
  } catch (e) { msg('Mentési hiba: ' + e.message, 'error'); }
}

export async function handleAbsenceClick(e) {
  const btn = e.target.closest('.abs-del-btn'); if (!btn) return;
  if (!confirm('Törlöd ezt a hiányzást?')) return;
  try {
    await deleteDoc(doc(db, 'absences', btn.dataset.id));
    msg('Hiányzás törölve.');
    loadAbsences();
    _loadSzabadsagMap().then(() => renderEmployeeGrid());
  } catch (e) { msg('Törlési hiba', 'error'); }
}

/* ══════════════════════════════════════
   NAPTÁR — hiányzás roster
══════════════════════════════════════ */

export async function loadCalendar() {
  if (!_empLoaded) await loadEmployees();
  const honapF   = E('naptarHonapF')?.value;
  const reszlegF = E('naptarReszlegF')?.value || '';
  if (!honapF) { msg('Válassz hónapot!', 'error'); return; }

  const [yearStr, monthStr] = honapF.split('-');
  const year  = Number(yearStr);
  const month = Number(monthStr);
  const days  = daysInMonth(year, month);
  const from  = `${honapF}-01`;
  const to    = `${honapF}-${String(days).padStart(2, '0')}`;
  const prevFrom = new Date(year, month - 2, 1).toISOString().slice(0, 10);

  E('naptarDiv').innerHTML = '<div class="empty-st"><div class="spinner" style="margin:0 auto"></div></div>';
  try {
    const snap = await getDocs(query(
      collection(db, 'absences'),
      where('tol', '>=', prevFrom), where('tol', '<=', to), orderBy('tol')
    ));
    const absences = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .filter(a => (a.ig || a.tol) >= from);

    let emps = _employees.filter(e => (e.statusz || 'aktiv') !== 'inaktiv');
    if (reszlegF) emps = emps.filter(e => e.reszleg === reszlegF);

    const dayMap = {};
    absences.forEach(a => {
      const nev = a.dolgozoNev;
      if (!dayMap[nev]) dayMap[nev] = {};
      for (let d = 1; d <= days; d++) {
        const ds = `${honapF}-${String(d).padStart(2, '0')}`;
        if (isAbsentOnDay(a, ds)) dayMap[nev][d] = HIANYZAS[a.tipus] || HIANYZAS.egyeb;
      }
    });

    const names = [...new Set([
      ...emps.map(e => e.nev),
      ...Object.keys(dayMap)
    ])].sort((a, b) => a.localeCompare(b, 'hu'));

    if (!names.length) {
      E('naptarDiv').innerHTML = '<div class="empty-st"><div class="empty-ic">🗓</div>Nincs aktív dolgozó</div>';
      return;
    }

    const HONAP_NEV = ['','Január','Február','Március','Április','Május','Június',
                       'Július','Augusztus','Szeptember','Október','November','December'];

    let h = `<div style="font-size:14px;font-weight:700;color:var(--text);margin-bottom:12px;">${HONAP_NEV[month]} ${year}</div>`;
    h += '<div style="overflow-x:auto;"><table class="abs-roster-table"><thead><tr>';
    h += '<th class="abs-roster-name-cell">Dolgozó</th>';
    for (let d = 1; d <= days; d++) {
      const dow  = new Date(year, month - 1, d).getDay();
      const isWe = dow === 0 || dow === 6;
      h += `<th class="abs-roster-day-cell${isWe ? ' abs-roster-we' : ''}">${d}</th>`;
    }
    h += '</tr></thead><tbody>';
    names.forEach(nev => {
      h += `<tr><td class="abs-roster-name-cell">${esc(nev)}</td>`;
      for (let d = 1; d <= days; d++) {
        const dow  = new Date(year, month - 1, d).getDay();
        const isWe = dow === 0 || dow === 6;
        const abs  = dayMap[nev]?.[d];
        const cls  = abs ? ` ${abs.cls}` : (isWe ? ' abs-roster-we' : '');
        const tt   = abs ? ` title="${abs.label}"` : '';
        h += `<td class="abs-roster-cell${cls}"${tt}>${abs ? abs.icon : ''}</td>`;
      }
      h += '</tr>';
    });
    h += '</tbody></table></div>';
    h += '<div class="abs-roster-legend">';
    Object.values(HIANYZAS).forEach(t => {
      h += `<span class="abs-leg-item"><span class="abs-leg-dot ${t.cls}"></span>${t.label}</span>`;
    });
    h += '</div>';

    E('naptarDiv').innerHTML = h;
  } catch (e) {
    msg('Hiba: ' + e.message, 'error');
    E('naptarDiv').innerHTML = '';
  }
}

/* ══════════════════════════════════════
   STATISZTIKA
══════════════════════════════════════ */

export async function loadStatisztika() {
  const evF = E('statEvF')?.value;
  if (!evF) { msg('Válassz évet!', 'error'); return; }
  const from = `${evF}-01-01`;
  const to   = `${evF}-12-31`;

  E('statDiv').innerHTML = '<div class="empty-st"><div class="spinner" style="margin:0 auto"></div></div>';
  try {
    const snap = await getDocs(query(
      collection(db, 'absences'),
      where('tol', '>=', from), where('tol', '<=', to), orderBy('tol')
    ));
    const absences = snap.docs.map(d => d.data());

    const empMap   = {};
    const monthMap = {};
    absences.forEach(a => {
      if (!empMap[a.dolgozoNev]) empMap[a.dolgozoNev] = { szabadsag: 0, betegseg: 0, fizetesnelkuli: 0, egyeb: 0 };
      const n = countDays(a.tol, a.ig);
      empMap[a.dolgozoNev][a.tipus] = (empMap[a.dolgozoNev][a.tipus] || 0) + n;
      const mo = a.tol.slice(0, 7);
      monthMap[mo] = (monthMap[mo] || 0) + n;
    });

    if (!Object.keys(empMap).length) {
      E('statDiv').innerHTML = '<div class="empty-st"><div class="empty-ic">📊</div>Nincs rögzített hiányzás ebben az évben</div>';
      _lastStatData = null;
      return;
    }

    const sorted = Object.entries(empMap).map(([nev, d]) => {
      const keret = _employees.find(e => e.nev === nev)?.szabadsagKeret ?? 20;
      return { nev, ...d, total: d.szabadsag + d.betegseg + d.fizetesnelkuli + d.egyeb, keret };
    }).sort((a, b) => b.total - a.total);

    _lastStatData = { ev: evF, sorted };

    const totals = sorted.reduce(
      (acc, r) => ({ szabadsag: acc.szabadsag + r.szabadsag, betegseg: acc.betegseg + r.betegseg,
                     fizetesnelkuli: acc.fizetesnelkuli + r.fizetesnelkuli, egyeb: acc.egyeb + r.egyeb,
                     total: acc.total + r.total }),
      { szabadsag: 0, betegseg: 0, fizetesnelkuli: 0, egyeb: 0, total: 0 }
    );

    let h = '<div class="nossz" style="margin-bottom:16px;">';
    [
      { val: totals.total,          lbl: 'Összes nap' },
      { val: totals.szabadsag,      lbl: '🌴 Szabadság' },
      { val: totals.betegseg,       lbl: '🤒 Betegszab.' },
      { val: totals.fizetesnelkuli, lbl: '📋 Fiz. nélk.' },
    ].forEach(({ val, lbl }) => {
      h += `<div class="nossz-item"><div class="nossz-val">${val}</div><div class="nossz-lbl">${lbl}</div></div>`;
    });
    h += '</div>';

    h += `<div style="overflow-x:auto;"><table class="stat-table">
      <thead><tr>
        <th>Dolgozó</th><th>🌴 Szab.</th><th>🤒 Beteg</th>
        <th>📋 Fiz.n.</th><th>❓ Egyéb</th><th>Össz.</th><th>Szabadság keret</th>
      </tr></thead><tbody>`;
    sorted.forEach(r => {
      const marad = Math.max(0, r.keret - r.szabadsag);
      const low   = marad < 5 && r.keret > 0;
      h += `<tr>
        <td style="font-weight:600;color:var(--text);">${esc(r.nev)}</td>
        <td>${r.szabadsag || '—'}</td>
        <td>${r.betegseg  || '—'}</td>
        <td>${r.fizetesnelkuli || '—'}</td>
        <td>${r.egyeb     || '—'}</td>
        <td style="font-weight:700;">${r.total}</td>
        <td style="color:${low ? 'var(--red)' : 'var(--text2)'};font-weight:600;">
          ${r.szabadsag}/${r.keret} · <strong>${marad} maradt</strong>
        </td>
      </tr>`;
    });
    h += '</tbody></table></div>';

    if (Object.keys(monthMap).length > 1) {
      const HONAP = ['','Jan','Feb','Már','Ápr','Máj','Jún','Júl','Aug','Szep','Okt','Nov','Dec'];
      const maxVal = Math.max(...Object.values(monthMap));
      h += '<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:var(--text3);margin:20px 0 10px;">Havi bontás</div>';
      h += '<div class="nossz">';
      Object.entries(monthMap).sort().forEach(([mo, n]) => {
        const m = Number(mo.split('-')[1]);
        h += `<div class="nossz-item" style="min-width:65px;">
          <div class="nossz-val">${n}</div>
          <div class="nossz-lbl">${HONAP[m]}</div>
          <div style="height:3px;background:var(--accent);border-radius:2px;margin-top:5px;width:${Math.round(n/maxVal*100)}%;min-width:4px;"></div>
        </div>`;
      });
      h += '</div>';
    }

    E('statDiv').innerHTML = h;
  } catch (e) {
    msg('Hiba: ' + e.message, 'error');
    E('statDiv').innerHTML = '';
  }
}

export function exportCsv() {
  if (!_lastStatData) { msg('Először kattints a Mutat gombra!', 'error'); return; }
  const { ev, sorted } = _lastStatData;
  let csv = 'Dolgozó;Szabadság;Betegszabadság;Fizetés nélküli;Egyéb;Összesen;Keret;Felhasznált;Maradt\n';
  sorted.forEach(r => {
    const marad = Math.max(0, r.keret - r.szabadsag);
    csv += `${r.nev};${r.szabadsag};${r.betegseg};${r.fizetesnelkuli};${r.egyeb};${r.total};${r.keret};${r.szabadsag};${marad}\n`;
  });
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.download = `hianyzas_${ev}.csv`;
  a.href = URL.createObjectURL(blob);
  a.click();
  URL.revokeObjectURL(a.href);
  msg('CSV exportálva.');
}
