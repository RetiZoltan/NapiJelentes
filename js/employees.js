import { db, doc, addDoc, updateDoc, deleteDoc,
         collection, query, where, getDocs, orderBy, serverTimestamp } from './firebase.js';
import { state, hasPerm, isMainAdmin } from './state.js';
import { E, esc, msg, tod } from './utils.js';
import { fetchEntries } from './db.js';

const HIANYZAS = {
  szabadsag:      { label: 'Szabadság',       icon: '🌴' },
  betegseg:       { label: 'Betegszabadság',  icon: '🤒' },
  fizetesnelkuli: { label: 'Fizetés nélküli', icon: '📋' },
  egyeb:          { label: 'Egyéb',            icon: '❓' }
};

let _employees  = [];
let _empLoaded  = false;
let _editingId  = null;

export function canEditEmp() { return isMainAdmin() || hasPerm('dolgozokKezeles'); }

function countDays(tol, ig) {
  const a = new Date(tol), b = new Date(ig || tol);
  return Math.max(1, Math.round((b - a) / 86400000) + 1);
}

/* ══════════════════════════════════════
   ADATLAPOK
══════════════════════════════════════ */

export async function loadEmployees() {
  try {
    const snap = await getDocs(query(collection(db, 'employees'), orderBy('nev')));
    _employees = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    _empLoaded = true;
    _updateDolgReszlegF();
    _updateAbsDropdowns();
    renderEmployeeGrid();
  } catch (e) { msg('Betöltési hiba: ' + e.message, 'error'); }
}

function _updateDolgReszlegF() {
  const sel = E('dolgReszlegF'); if (!sel) return;
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
  const all = [..._employees].sort((a, b) => a.nev.localeCompare(b.nev, 'hu'));

  const af = E('absFormNev');
  if (af) af.innerHTML = '<option value="">— Válassz —</option>' +
    aktiv.map(e => `<option value="${esc(e.nev)}">${esc(e.nev)}</option>`).join('');

  const hf = E('hianyNevF');
  if (hf) hf.innerHTML = '<option value="">— Mindenki —</option>' +
    all.map(e => `<option value="${esc(e.nev)}">${esc(e.nev)}</option>`).join('');
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

  grid.innerHTML = '<div class="emp-grid">' + list.map(emp => {
    const st = STATUSZ[emp.statusz || 'aktiv'] || STATUSZ.aktiv;
    const btns = canEditEmp() ? `
      <div style="display:flex;gap:6px;margin-top:12px;padding-top:10px;border-top:1px solid var(--border);">
        <button class="btn btn-ghost btn-xs emp-edit-btn" data-id="${esc(emp.id)}">Szerkeszt</button>
        <button class="btn btn-${(emp.statusz||'aktiv') === 'inaktiv' ? 'ghost' : 'danger'} btn-xs emp-arch-btn"
          data-id="${esc(emp.id)}" data-statusz="${esc(emp.statusz || 'aktiv')}">
          ${(emp.statusz || 'aktiv') === 'inaktiv' ? 'Aktivál' : 'Archivál'}
        </button>
      </div>` : '';
    return `<div class="emp-card">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
        <div style="min-width:0;">
          <div class="emp-name">${esc(emp.nev)}</div>
          <div class="emp-dept">${esc(emp.reszleg || '—')}</div>
          ${emp.belepet ? `<div style="font-size:11px;color:var(--text3);margin-top:3px;">Belépett: ${esc(emp.belepet)}</div>` : ''}
        </div>
        <span class="emp-status ${st.cls}">${st.label}</span>
      </div>
      ${emp.megjegyzes ? `<div style="font-size:12px;color:var(--text2);margin-top:8px;font-style:italic;">${esc(emp.megjegyzes)}</div>` : ''}
      ${btns}
    </div>`;
  }).join('') + '</div>';
}

export function openEmpForm(emp = null) {
  _editingId = emp?.id || null;
  E('empFormNev').value     = emp?.nev       || '';
  E('empFormReszleg').value = emp?.reszleg   || '';
  E('empFormBelepet').value = emp?.belepet   || '';
  E('empFormStatusz').value = emp?.statusz   || 'aktiv';
  E('empFormMegj').value    = emp?.megjegyzes || '';
  E('empFormTitle').textContent = emp ? 'Dolgozó szerkesztése' : 'Új dolgozó';
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
    reszleg:    E('empFormReszleg').value.trim(),
    belepet:    E('empFormBelepet').value || null,
    statusz:    E('empFormStatusz').value || 'aktiv',
    megjegyzes: E('empFormMegj').value.trim()
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

export async function handleEmpGridClick(e) {
  const editBtn = e.target.closest('.emp-edit-btn');
  if (editBtn) {
    const emp = _employees.find(x => x.id === editBtn.dataset.id);
    if (emp) openEmpForm(emp);
    return;
  }
  const archBtn = e.target.closest('.emp-arch-btn');
  if (!archBtn) return;
  const cur   = archBtn.dataset.statusz;
  const newSt = cur === 'inaktiv' ? 'aktiv' : 'inaktiv';
  if (!confirm(`Biztosan ${newSt === 'inaktiv' ? 'archiválod' : 'aktiválod'} ezt a dolgozót?`)) return;
  try {
    await updateDoc(doc(db, 'employees', archBtn.dataset.id),
      { statusz: newSt, updatedBy: state.appUser.uid, updatedAt: serverTimestamp() });
    msg('Státusz frissítve.');
    loadEmployees();
  } catch (e) { msg('Hiba: ' + e.message, 'error'); }
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
    E('absFormTol').value = '';
    E('absFormIg').value  = '';
    E('absFormMegj').value = '';
    loadAbsences();
  } catch (e) { msg('Mentési hiba: ' + e.message, 'error'); }
}

export async function handleAbsenceClick(e) {
  const btn = e.target.closest('.abs-del-btn'); if (!btn) return;
  if (!confirm('Törlöd ezt a hiányzást?')) return;
  try {
    await deleteDoc(doc(db, 'absences', btn.dataset.id));
    msg('Hiányzás törölve.');
    loadAbsences();
  } catch (e) { msg('Törlési hiba', 'error'); }
}

/* ══════════════════════════════════════
   TELJESÍTMÉNY
══════════════════════════════════════ */

export async function loadTeljesitmeny() {
  const honapF = E('teljHonapF')?.value;
  if (!honapF) { msg('Válassz hónapot!', 'error'); return; }
  const from = honapF + '-01';
  const to   = honapF + '-31';

  E('teljDiv').innerHTML = '<div class="empty-st"><div class="spinner" style="margin:0 auto"></div></div>';
  try {
    const [entries, absSnap] = await Promise.all([
      fetchEntries({ datumFrom: from, datumTo: to }),
      getDocs(query(collection(db, 'absences'),
        where('tol', '>=', from), where('tol', '<=', to), orderBy('tol')))
    ]);

    const absences = absSnap.docs.map(d => d.data());

    const workers = {};
    entries.forEach(e => {
      if (!e.nev) return;
      if (!workers[e.nev]) workers[e.nev] = { kg: 0, napok: new Set(), reszleg: e.reszleg || '' };
      const s = (e.sulyok     || []).reduce((a, b) => a + b.suly, 0);
      const z = (e.zsakSulyok || []).reduce((a, b) => a + b, 0);
      workers[e.nev].kg += s + z;
      workers[e.nev].napok.add(e.datum);
    });

    const absMap = {};
    absences.forEach(a => {
      absMap[a.dolgozoNev] = (absMap[a.dolgozoNev] || 0) + countDays(a.tol, a.ig);
    });

    const names = [...new Set([...Object.keys(workers), ...Object.keys(absMap)])]
      .sort((a, b) => a.localeCompare(b, 'hu'));

    if (!names.length) {
      E('teljDiv').innerHTML = '<div class="empty-st"><div class="empty-ic">📊</div>Nincs adat erre a hónapra</div>';
      return;
    }

    E('teljDiv').innerHTML = '<div class="emp-grid">' + names.map(nev => {
      const w          = workers[nev] || { kg: 0, napok: new Set(), reszleg: '' };
      const munkanapok = w.napok.size;
      const hianyzas   = absMap[nev] || 0;
      const kg         = w.kg;
      const atlag      = munkanapok > 0 ? Math.round(kg / munkanapok) : null;
      return `<div class="emp-card">
        <div class="emp-name">${esc(nev)}</div>
        ${w.reszleg ? `<div class="emp-dept">${esc(w.reszleg)}</div>` : ''}
        <div class="telj-grid">
          <div class="telj-item">
            <div class="telj-val">${kg > 0 ? (kg / 1000).toFixed(2) + ' t' : '—'}</div>
            <div class="telj-lbl">Össz. termelés</div>
          </div>
          <div class="telj-item">
            <div class="telj-val">${atlag !== null ? atlag + ' kg' : '—'}</div>
            <div class="telj-lbl">Napi átlag</div>
          </div>
          <div class="telj-item">
            <div class="telj-val">${munkanapok}</div>
            <div class="telj-lbl">Munkanap</div>
          </div>
          <div class="telj-item${hianyzas ? ' telj-hianyzas' : ''}">
            <div class="telj-val">${hianyzas}</div>
            <div class="telj-lbl">Hiányzás (nap)</div>
          </div>
        </div>
      </div>`;
    }).join('') + '</div>';
  } catch (e) {
    msg('Hiba: ' + e.message, 'error');
    E('teljDiv').innerHTML = '';
  }
}
