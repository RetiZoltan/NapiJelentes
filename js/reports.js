import { db, doc, getDoc, deleteDoc, collection, query, where,
         getDocs, orderBy, writeBatch, onSnapshot } from './firebase.js';
import { state, canSeeAllReports, isMainAdmin } from './state.js';
import { E, esc, msg, tod, fmtL, fmtS, fmtKg } from './utils.js';
import { fetchEntries, deleteDailyNoteForReszleg } from './db.js';

let unsubNapi = null;
let _lastNapiState = null;

const RIPORT_DEF = {
  teljes: true, dolgRangsor: true, anyagOssz: true,
  napiAtlag: true, dolgNapiAtlag: false, haviAtlag: false, muszak: false,
  dolgReszlet: false, anyagReszlet: false, napiBontas: true
};
function getRiportSet(key) {
  try { const s = JSON.parse(localStorage.getItem('napiJelentesRiportSet') || '{}'); return key in s ? s[key] : (RIPORT_DEF[key] ?? true); }
  catch { return RIPORT_DEF[key] ?? true; }
}

export function cleanupNapiListener() {
  if (unsubNapi) { unsubNapi(); unsubNapi = null; }
}

/* ── Napi riport with onSnapshot ── */
export function napiRiport() {
  const rd = E('riportD').value;
  if (!rd) { msg('Válassz dátumot!', 'error'); return; }
  const szuro = canSeeAllReports() ? E('dolgSzuro').value : '';

  E('napiRiportDiv').innerHTML = '<div class="empty-st"><div class="spinner" style="margin:0 auto"></div></div>';
  cleanupNapiListener();

  const constraints = [where('datum', '==', rd)];
  if (!canSeeAllReports()) constraints.push(where('createdBy', '==', state.appUser.uid));
  if (szuro) constraints.push(where('nev', '==', szuro));
  constraints.push(orderBy('datum'), orderBy('createdAt'));

  unsubNapi = onSnapshot(
    query(collection(db, 'entries'), ...constraints),
    async snap => {
      const lista = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      let napiNotes = {};
      try {
        const ns = await getDoc(doc(db, 'dailyNotes', rd));
        if (ns.exists()) {
          const nd = ns.data();
          napiNotes = nd.reszlegek || (nd.szoveg ? { '': nd.szoveg } : {});
        }
      } catch {}
      renderNapi(rd, lista, napiNotes, szuro);
    },
    err => msg('Lekérdezési hiba: ' + err.message, 'error', 5000)
  );
}

export function rerenderNapi() {
  if (!_lastNapiState) return;
  const { rd, lista, napiNotes, szuro } = _lastNapiState;
  renderNapi(rd, lista, napiNotes, szuro);
}

function renderNapi(rd, lista, napiNotes, szuro) {
  _lastNapiState = { rd, lista, napiNotes, szuro };

  const muszakF  = E('napiMuszakSzuro')?.value  || '';
  const reszlegF = E('napiReszlegSzuro')?.value || '';
  let filtered = lista;
  if (muszakF)  filtered = filtered.filter(a => a.ido === muszakF);
  if (reszlegF) filtered = filtered.filter(a => (a.reszleg || '') === reszlegF);

  const hasNotes = Object.values(napiNotes).some(v => v);
  if (!lista.length && !hasNotes) {
    E('napiRiportDiv').innerHTML = `<div class="empty-st"><div class="empty-ic">📭</div>Nincs adat a(z) ${esc(fmtL(rd))} napra${szuro ? ' (' + esc(szuro) + ')' : ''}</div>`;
    E('napiKepMentBtn').disabled = true;
    E('napiNyomtatBtn').disabled = true;
    return;
  }
  const allShifts = [...new Set(filtered.map(a => a.ido))].sort();
  const needsShiftBlocks = !muszakF && allShifts.length > 1;
  const badges = needsShiftBlocks ? '' : allShifts.map(s => `<span class="r-shift">(${esc(s)})</span>`).join(' ');
  let h = `<div class="r-head">${esc(fmtL(rd))}${badges}</div>`;
  h += napiOsszHtml(lista);

  const hasReszlegGrouping = filtered.some(a => (a.reszleg || '').trim());
  if (filtered.length) {
    if (needsShiftBlocks) {
      allShifts.forEach(shift => {
        const se = filtered.filter(a => a.ido === shift);
        const hasRGInShift = se.some(a => (a.reszleg || '').trim());
        h += `<div class="muszak-block"><div class="muszak-hd"><span class="muszak-dot"></span>${esc(shift)}</div>`;
        h += reszlegHtml(se, rd, napiNotes, shift);
        if (!hasRGInShift) {
          getNotesForDept(napiNotes, reszlegF || '', shift)
            .forEach(n => { h += dayNoteHtml(n.key, n.note, rd, true); });
        }
        h += `</div>`;
      });
    } else {
      h += reszlegHtml(filtered, rd, napiNotes, muszakF);
      if (!hasReszlegGrouping) {
        getNotesForDept(napiNotes, reszlegF || '', muszakF)
          .forEach(n => { h += dayNoteHtml(n.key, n.note, rd); });
      }
    }
  } else if (lista.length) {
    h += `<div style="padding:14px 0;color:var(--text3);font-size:13px;font-style:italic;">A szűrő alapján nincs megjeleníthető adat.</div>`;
    getNotesForDept(napiNotes, reszlegF || '', muszakF)
      .forEach(n => { h += dayNoteHtml(n.key, n.note, rd); });
  }
  E('napiRiportDiv').innerHTML = h;
  E('napiKepMentBtn').disabled = false;
  E('napiNyomtatBtn').disabled = false;
}

function dayNoteHtml(key, note, rd, hideIdo = false) {
  const ido = key.includes('|') ? key.split('|')[1] : '';
  const lbl = (ido && !hideIdo) ? `📌 Napi megjegyzés (${esc(ido)})` : '📌 Napi megjegyzés';
  const delBtn = isMainAdmin()
    ? `<button class="del-btn" data-type="megj" data-datum="${esc(rd)}" data-reszleg="${esc(key)}" style="position:absolute;top:11px;right:11px;">✕</button>`
    : '';
  return `<div class="day-note"><div class="day-note-lbl">${lbl}</div><p>${esc(note).replace(/\n/g, '<br>')}</p>${delBtn}</div>`;
}

// Returns notes matching a given dept key (and optional shift filter).
// Handles both new format keys ("R A|Délelőtt") and old format ("R A").
function getNotesForDept(napiNotes, deptKey, muszakF) {
  const result = [];
  Object.entries(napiNotes || {}).forEach(([k, v]) => {
    if (!v) return;
    if (k.includes('|')) {
      const pipe     = k.indexOf('|');
      const kReszleg = k.slice(0, pipe);
      const kIdo     = k.slice(pipe + 1);
      if (kReszleg === deptKey && (!muszakF || !kIdo || kIdo === muszakF)) {
        result.push({ key: k, note: v });
      }
    } else if (k === deptKey) {
      result.push({ key: k, note: v });
    }
  });
  result.sort((a, b) => {
    const iA = a.key.includes('|') ? a.key.split('|')[1] : '';
    const iB = b.key.includes('|') ? b.key.split('|')[1] : '';
    return iA.localeCompare(iB, 'hu');
  });
  return result;
}

/* ── Napi összesítő kártya ── */
function napiOsszHtml(lista) {
  if (!lista.length) return '';
  const totalS = lista.reduce((s, a) => s + (a.sulyok || []).reduce((x, y) => x + y.suly, 0), 0);
  const totalZ = lista.reduce((s, a) => s + (a.zsakSulyok || []).reduce((x, y) => x + y, 0), 0);
  if (totalS === 0 && totalZ === 0) return '';
  const workerSet = new Set(lista.map(a => a.nev));
  const byWorker  = {};
  lista.forEach(a => {
    const kg = (a.sulyok || []).reduce((s, x) => s + x.suly, 0);
    if (kg > 0) byWorker[a.nev] = (byWorker[a.nev] || 0) + kg;
  });
  const top = Object.entries(byWorker).sort((a, b) => b[1] - a[1])[0];
  let h = `<div class="napi-ossz nossz">`;
  if (totalS > 0) h += `<div class="nossz-item"><div class="nossz-val v-bold">${fmtKg(totalS)}</div><div class="nossz-lbl">Darált összesen</div></div>`;
  if (totalZ > 0) h += `<div class="nossz-item"><div class="nossz-val v-green">${fmtKg(totalZ)}</div><div class="nossz-lbl">Teli zsák összesen</div></div>`;
  h += `<div class="nossz-item"><div class="nossz-val" style="color:var(--accent);">${workerSet.size}</div><div class="nossz-lbl">Aktív dolgozó</div></div>`;
  if (top && workerSet.size > 1) h += `<div class="nossz-item"><div class="nossz-val" style="font-size:13px;">${esc(top[0])}</div><div class="nossz-lbl">Legjobb · ${fmtKg(top[1])}</div></div>`;
  return h + `</div>`;
}

/* ── Napi riport részleg-csoportosítás ── */
function reszlegHtml(lista, rd, napiNotes, muszakF) {
  const hasReszleg = lista.some(a => (a.reszleg || '').trim());
  if (!hasReszleg) return workerHtml(grpWorkers(lista));

  const byReszleg = {};
  lista.forEach(a => {
    const r = (a.reszleg || '').trim() || 'Ismeretlen részleg';
    if (!byReszleg[r]) byReszleg[r] = [];
    byReszleg[r].push(a);
  });
  const keys = Object.keys(byReszleg).sort((a, b) => {
    if (a === 'Ismeretlen részleg') return 1;
    if (b === 'Ismeretlen részleg') return -1;
    return a.localeCompare(b, 'hu');
  });
  let h = '';
  keys.forEach(r => {
    const deptKey = r === 'Ismeretlen részleg' ? '' : r;
    const notes   = getNotesForDept(napiNotes, deptKey, muszakF);
    h += `<div class="reszleg-block">
      <div class="reszleg-hd"><span class="reszleg-dot"></span>${esc(r)}</div>
      ${workerHtml(grpWorkers(byReszleg[r]))}
      ${notes.map(n => dayNoteHtml(n.key, n.note, rd, !!muszakF)).join('')}
    </div>`;
  });
  return h;
}

/* ── Havi riport ── */
export async function haviRiport() {
  const raw = E('haviHonapInput').value;
  if (!raw) { msg('Válassz hónapot!', 'error'); return; }
  const [ev, honap1] = raw.split('-').map(Number);
  const honap  = honap1 - 1;
  const prefix = `${ev}-${String(honap1).padStart(2, '0')}`;
  const lastDay = new Date(ev, honap + 1, 0).getDate();
  const from = `${prefix}-01`, to = `${prefix}-${String(lastDay).padStart(2, '0')}`;
  const honNev = ['január','február','március','április','május','június','július','augusztus','szeptember','október','november','december'];
  const reszlegF = E('idoszakosReszlegSzuro')?.value || '';

  E('idoszakosRiportDiv').innerHTML = '<div class="empty-st"><div class="spinner" style="margin:0 auto"></div></div>';
  let hA = await fetchEntries({ datumFrom: from, datumTo: to });
  if (reszlegF) hA = hA.filter(a => (a.reszleg || '') === reszlegF);
  if (!hA.length) {
    E('idoszakosRiportDiv').innerHTML = `<div class="empty-st"><div class="empty-ic">📭</div>Nincs adat erre a hónapra${reszlegF ? ' (' + esc(reszlegF) + ')' : ''}</div>`;
    E('idoszakosKepMentBtn').disabled = true;
    E('idoszakosNyomtatBtn').disabled = true; return;
  }

  const reszlegBadge = reszlegF ? `<span class="r-shift">· ${esc(reszlegF)}</span>` : '';
  let html = `<div class="r-head">${ev}. ${honNev[honap]}${reszlegBadge}</div>`;
  if (getRiportSet('teljes'))        html += teljesHtml(hA);
  html += reszlegOsszesitoHtml(hA);
  if (getRiportSet('dolgRangsor'))   html += dolgRangsorHtml(hA);
  if (getRiportSet('anyagOssz'))     html += anyagOsszesitoHtml(hA);
  if (getRiportSet('napiAtlag'))     html += napiAtlagHtml(hA);
  if (getRiportSet('dolgNapiAtlag')) html += dolgNapiAtlagHtml(hA);
  if (getRiportSet('muszak'))        html += muszakHtml(hA);
  if (getRiportSet('dolgReszlet'))   html += dolgReszletHtml(hA);
  if (getRiportSet('anyagReszlet'))  html += anyagReszletHtml(hA);
  if (getRiportSet('napiBontas'))    html += napiBontasHtml(hA, false);
  E('idoszakosRiportDiv').innerHTML = html;
  E('idoszakosKepMentBtn').disabled = false;
  E('idoszakosNyomtatBtn').disabled = false;
}

/* ── Éves riport ── */
export async function evesRiport() {
  const ev = parseInt(E('evesEvInput').value);
  if (!ev) { msg('Válassz évet!', 'error'); return; }
  const from = `${ev}-01-01`, to = `${ev}-12-31`;
  const reszlegF = E('idoszakosReszlegSzuro')?.value || '';

  E('idoszakosRiportDiv').innerHTML = '<div class="empty-st"><div class="spinner" style="margin:0 auto"></div></div>';
  let hA = await fetchEntries({ datumFrom: from, datumTo: to });
  if (reszlegF) hA = hA.filter(a => (a.reszleg || '') === reszlegF);
  if (!hA.length) {
    E('idoszakosRiportDiv').innerHTML = `<div class="empty-st"><div class="empty-ic">📭</div>Nincs adat ${ev}. évre${reszlegF ? ' (' + esc(reszlegF) + ')' : ''}</div>`;
    E('idoszakosKepMentBtn').disabled = true;
    E('idoszakosNyomtatBtn').disabled = true; return;
  }

  const reszlegBadge = reszlegF ? `<span class="r-shift">· ${esc(reszlegF)}</span>` : '';
  let html = `<div class="r-head">${ev}. év${reszlegBadge}</div>`;
  if (getRiportSet('teljes'))        html += teljesHtml(hA);
  html += reszlegOsszesitoHtml(hA);
  if (getRiportSet('dolgRangsor'))   html += dolgRangsorHtml(hA);
  if (getRiportSet('anyagOssz'))     html += anyagOsszesitoHtml(hA);
  if (getRiportSet('napiAtlag'))     html += napiAtlagHtml(hA);
  if (getRiportSet('haviAtlag'))     html += haviAtlagHtml(hA);
  if (getRiportSet('dolgNapiAtlag')) html += dolgNapiAtlagHtml(hA);
  if (getRiportSet('muszak'))        html += muszakHtml(hA);
  if (getRiportSet('dolgReszlet'))   html += dolgReszletHtml(hA);
  if (getRiportSet('anyagReszlet'))  html += anyagReszletHtml(hA);
  if (getRiportSet('napiBontas'))    html += napiBontasHtml(hA, true);
  E('idoszakosRiportDiv').innerHTML = html;
  E('idoszakosKepMentBtn').disabled = false;
  E('idoszakosNyomtatBtn').disabled = false;
}

/* ── Klikk handler (törlés + nap-link) ── */
export async function riportKlikk(e) {
  const gotoNapi = e.target.dataset?.goto;
  if (gotoNapi) {
    E('riportD').value = gotoNapi;
    document.dispatchEvent(new CustomEvent('napi-goto'));
    return;
  }
  const gotoHavi = e.target.dataset?.gotoHavi;
  if (gotoHavi) {
    E('haviHonapInput').value  = gotoHavi;
    E('idoszakTipus').value    = 'havi';
    E('haviInputWrap').style.display = '';
    E('evesInputWrap').style.display = 'none';
    E('setHaviAtlagWrap').style.display = 'none';
    haviRiport();
    return;
  }
  const toggle = e.target.closest('.dtoggle');
  if (toggle) {
    const box = toggle.nextElementSibling;
    if (box) box.style.display = box.style.display === 'none' ? 'block' : 'none';
    return;
  }
  const editBtn = e.target.closest('.edit-btn');
  if (editBtn) {
    const id = editBtn.dataset.editId;
    const snap = await getDoc(doc(db, 'entries', id));
    if (snap.exists()) {
      document.dispatchEvent(new CustomEvent('napi-edit-entry', { detail: { id: snap.id, ...snap.data() } }));
    }
    return;
  }
  const btn = e.target.closest('.del-btn'); if (!btn) return;
  const dtype = btn.dataset.type, datum = btn.dataset.datum, ids = btn.dataset.ids;
  if (dtype === 'megj' && datum) {
    if (!confirm('Törlöd a napi megjegyzést?')) return;
    const reszleg = btn.dataset.reszleg ?? '';
    await deleteDailyNoteForReszleg(datum, reszleg);
    napiRiport();
  } else if (ids) {
    const arr = ids.split(',');
    if (!confirm(`Biztosan törlöd a kijelölt ${arr.length} bejegyzést?`)) return;
    const batch = writeBatch(db);
    arr.forEach(id => batch.delete(doc(db, 'entries', id)));
    await batch.commit();
    msg('Bejegyzés törölve.');
  }
}

/* ── Nap törlése ── */
export async function napTorol() {
  const d = E('riportD').value;
  if (!d) { msg('Válassz dátumot!', 'error'); return; }
  if (!confirm(`Biztosan törlöd a(z) ${d} nap összes adatát?`)) return;
  try {
    const snap = await getDocs(query(collection(db, 'entries'), where('datum', '==', d)));
    const batch = writeBatch(db);
    snap.docs.forEach(dc => batch.delete(dc.ref));
    await batch.commit();
    await deleteDoc(doc(db, 'dailyNotes', d));
    msg('Napi adatok törölve.');
    napiRiport();
  } catch (e) { msg('Törlési hiba: ' + e.message, 'error'); }
}

/* ── Mentés képként ── */
export function napiKepMent()      { kepMentDiv('napiRiportDiv',      E('riportD').value || tod()); }
export function idoszakosKepMent() { kepMentDiv('idoszakosRiportDiv', tod()); }

/* ── Nyomtatás ── */
export function napiNyomtat()      { nyomtatDiv('napiRiportDiv'); }
export function idoszakosNyomtat() { nyomtatDiv('idoszakosRiportDiv'); }

function nyomtatDiv(divId) {
  const src = E(divId);
  if (!src.children.length || src.querySelector('.empty-st')) {
    msg('Nincs nyomtatható tartalom.', 'error'); return;
  }
  const clone = src.cloneNode(true);
  clone.querySelectorAll('.napi-ossz').forEach(x => x.remove());
  clone.querySelectorAll('.del-btn').forEach(x => x.remove());
  clone.querySelectorAll('.edit-btn').forEach(x => x.remove());
  clone.querySelectorAll('.dlink').forEach(x => {
    const sp = document.createElement('span');
    sp.textContent = x.textContent;
    x.replaceWith(sp);
  });
  const now = new Date();
  const nyomtatva = now.toLocaleDateString('hu-HU', { year: 'numeric', month: 'long', day: 'numeric' })
                  + ', ' + now.toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit' });
  const pf = document.getElementById('print-frame');
  pf.innerHTML = '';
  const hdr = document.createElement('div');
  hdr.className = 'pf-hdr';
  hdr.innerHTML = `<span class="pf-brand">Napi Jelentés – Termelési nyilvántartó</span><span class="pf-meta">Nyomtatva: ${esc(nyomtatva)}</span>`;
  pf.appendChild(hdr);
  pf.appendChild(clone);
  const ftr = document.createElement('div');
  ftr.className = 'pf-ftr';
  ftr.textContent = 'Plasticnapi termelési nyilvántartó';
  pf.appendChild(ftr);
  document.body.classList.add('is-printing');
  window.print();
}

window.addEventListener('afterprint', () => {
  document.body.classList.remove('is-printing');
  const pf = document.getElementById('print-frame');
  if (pf) pf.innerHTML = '';
});

function kepMentDiv(divId, suffix) {
  const cs  = getComputedStyle(document.documentElement);
  const g   = v => cs.getPropertyValue(v).trim();
  const bg  = g('--bg'), surf = g('--surf'), surf2 = g('--surf2'), surf3 = g('--surf3');
  const b   = g('--border'), b2 = g('--border2');
  const t1  = g('--text'), t2 = g('--text2'), t3 = g('--text3');
  const acc = g('--accent'), green = g('--green'), amber = g('--amber'), amberl = g('--amberl'), red = g('--red');
  const clone = E(divId).cloneNode(true);
  clone.querySelectorAll('.napi-ossz').forEach(x => x.remove());
  clone.querySelectorAll('.del-btn').forEach(x => x.remove());
  clone.querySelectorAll('.edit-btn').forEach(x => x.remove());
  const wrap = document.createElement('div');
  wrap.style.cssText = `position:fixed;left:-9999px;top:0;width:800px;font-family:'Source Sans 3','Segoe UI',sans-serif;font-size:15px;line-height:1.65;color:${t1};background:${bg};padding:30px 32px 36px;box-sizing:border-box;`;
  const inner = document.createElement('div');
  inner.style.cssText = `background:${surf};border:1px solid ${b};border-radius:11px;padding:24px 26px 28px;`;
  const style = document.createElement('style');
  style.textContent = `.r-head{font-family:'Lora',Georgia,serif;font-size:20px;font-weight:500;color:${t1};margin-bottom:16px;padding-bottom:11px;border-bottom:2px solid ${b2};display:flex;align-items:baseline;flex-wrap:wrap;}.r-shift{font-family:'Lora',Georgia,serif;font-size:20px;font-weight:400;font-style:italic;color:${t2};margin-left:10px;}.reszleg-block{margin-bottom:12px;}.reszleg-hd{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:${acc};padding:6px 0 5px;border-bottom:1px solid ${b2};margin-bottom:7px;display:flex;align-items:center;gap:6px;}.reszleg-dot{width:7px;height:7px;border-radius:50%;background:${acc};flex-shrink:0;}.muszak-block{margin-bottom:18px;}.muszak-hd{font-size:13px;font-weight:700;color:${t1};background:${surf2};border:1px solid ${b};border-radius:7px;padding:7px 12px;margin-bottom:10px;display:flex;align-items:center;gap:7px;}.muszak-dot{width:8px;height:8px;border-radius:50%;background:${acc};flex-shrink:0;}.worker-block{background:${surf};border:1px solid ${b};border-radius:7px;overflow:hidden;margin-bottom:10px;}.worker-hd{background:${surf2};border-bottom:1px solid ${b};padding:8px 14px;display:flex;align-items:center;gap:8px;}.worker-dot{width:7px;height:7px;border-radius:50%;background:${acc};}.worker-nm{font-size:14px;font-weight:600;color:${t1};}table.rt{width:100%;border-collapse:collapse;font-size:13px;}.rt th{text-align:left;color:${t3};font-size:10.5px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;padding:7px 14px;border-bottom:1px solid ${b};background:${surf2};}.rt td{padding:9px 14px;border-bottom:1px solid ${b};color:${t2};vertical-align:top;}.rt tfoot td{padding:8px 14px;border-top:1px solid ${b2};font-weight:600;font-size:12.5px;color:${t1};background:${surf3};}.v-teli{color:${red};font-weight:600;}.v-kezdett{color:${amber};font-weight:600;}.v-green{color:${green};font-weight:600;}.v-bold{color:${t1};font-weight:600;}.dtoggle{text-decoration:none;cursor:default;}.edit-btn{display:none;}.wnote{padding:8px 14px;border-top:1px solid ${b};background:${surf2};font-size:13px;color:${t2};white-space:pre-wrap;}.day-note{margin-top:11px;padding:13px 15px;background:${amberl};border:1px solid rgba(0,0,0,.1);border-radius:7px;font-size:13px;color:${t2};white-space:pre-wrap;}.day-note-lbl{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:${amber};margin-bottom:5px;}.card{background:${surf};border:1px solid ${b};border-radius:11px;padding:18px 20px;margin-bottom:12px;}.stbl{width:100%;border-collapse:collapse;font-size:13px;}.stbl th{text-align:left;color:${t3};font-size:10.5px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;padding:7px 13px;border-bottom:1px solid ${b};background:${surf2};}.stbl td{padding:9px 13px;border-bottom:1px solid ${b};color:${t2};}.stbl .tot td{font-weight:700;color:${t1};border-top:2px solid ${b2};background:${surf3};font-size:12.5px;}`;
  inner.appendChild(style); inner.appendChild(clone); wrap.appendChild(inner); document.body.appendChild(wrap);
  html2canvas(wrap, { backgroundColor: bg, scale: 2, useCORS: true, allowTaint: true }).then(canvas => {
    document.body.removeChild(wrap);
    const a = document.createElement('a');
    a.download = `jelentes_${suffix}.jpg`;
    a.href = canvas.toDataURL('image/jpeg', .93);
    a.click();
    msg('Kép mentve!');
  }).catch(() => { document.body.removeChild(wrap); msg('Mentési hiba.', 'error'); });
}

/* ── Napi riport belső segédfüggvények ── */
function grpWorkers(list) {
  const c = {};
  list.forEach(a => {
    if (!c[a.nev]) c[a.nev] = { anyagok: {}, csMegj: [] };
    const ak = (a.anyag || '').trim().toLowerCase() || '_';
    const hS = Array.isArray(a.sulyok) && a.sulyok.length > 0;
    const hZ = Array.isArray(a.zsakSulyok) && a.zsakSulyok.length > 0;
    if ((a.anyag || '').trim() || hS || hZ) {
      if (!c[a.nev].anyagok[ak]) c[a.nev].anyagok[ak] = { nev: (a.anyag || '').trim() || '—', sulyok: [], zsakSulyok: [], megj: [], ids: [], owners: [] };
      if (hS) c[a.nev].anyagok[ak].sulyok.push(...a.sulyok);
      if (hZ) c[a.nev].anyagok[ak].zsakSulyok.push(...a.zsakSulyok);
      if (a.megjegyzes?.trim()) c[a.nev].anyagok[ak].megj.push(a.megjegyzes.trim());
      c[a.nev].anyagok[ak].ids.push(a.id);
      c[a.nev].anyagok[ak].owners.push(a.createdBy);
    } else if (a.megjegyzes?.trim()) c[a.nev].csMegj.push({ id: a.id, text: a.megjegyzes.trim(), owner: a.createdBy });
  });
  return c;
}

function workerHtml(c) {
  let h = '';
  Object.keys(c).sort((a, b) => a.localeCompare(b, 'hu')).forEach(nev => {
    const cd = c[nev]; let notes = '';
    h += `<div class="worker-block"><div class="worker-hd"><span class="worker-dot"></span><span class="worker-nm">${esc(nev)}</span></div>`;
    if (Object.keys(cd.anyagok).length > 0) {
      let ds = 0, dz = 0;
      h += `<table class="rt"><thead><tr><th>Anyag</th><th>Darált súly</th><th>Teli zsákok</th><th></th></tr></thead><tbody>`;
      Object.keys(cd.anyagok).sort((a, b) => cd.anyagok[a].nev.localeCompare(cd.anyagok[b].nev, 'hu')).forEach(ak => {
        const aa = cd.anyagok[ak]; const ids = aa.ids.join(',');
        let sh = '—';
        if (aa.sulyok.length > 0) {
          const os  = aa.sulyok.reduce((s, x) => s + x.suly, 0); ds += os;
          const det = aa.sulyok.map(s => `<span class="${s.statusz === 'teli' ? 'v-teli' : 'v-kezdett'}">${s.suly.toFixed(0)}</span>`).join(', ');
          sh = `<span class="dtoggle" style="cursor:pointer">${fmtKg(os)}</span><div style="display:none;font-size:12px;margin-top:3px;">${det}</div>`;
        }
        let zh = '—';
        if (aa.zsakSulyok.length > 0) { const zo = aa.zsakSulyok.reduce((s, x) => s + x, 0); dz += zo; zh = `<span class="v-green">${aa.zsakSulyok.map(s => s.toFixed(0)).join(', ')} kg</span>`; }
        const canEdit = aa.ids.length === 1 && (isMainAdmin() || aa.owners[0] === state.appUser.uid);
        const canDelete = isMainAdmin() || aa.owners.every(o => o === state.appUser.uid);
        const editBtn = canEdit ? `<button class="edit-btn" data-edit-id="${esc(aa.ids[0])}" title="Szerkesztés">✎</button>` : '';
        const delBtnHtml = canDelete ? `<button class="del-btn" data-ids="${esc(ids)}">✕</button>` : '';
        h += `<tr><td>${esc(aa.nev)}</td><td>${sh}</td><td>${zh}</td><td style="white-space:nowrap;">${editBtn}${delBtnHtml}</td></tr>`;
        aa.megj.forEach(m => { notes += `<div class="wnote">${esc(m)}</div>`; });
      });
      h += `</tbody><tfoot><tr><td>Összesen</td><td class="v-bold">${fmtKg(ds)}</td><td class="v-green" style="font-weight:600;">${fmtKg(dz)}</td><td></td></tr></tfoot></table>`;
    }
    cd.csMegj.forEach(m => {
      const canDelNote = isMainAdmin() || m.owner === state.appUser.uid;
      const delBtn = canDelNote ? `<button class="del-btn" data-ids="${m.id}" style="position:absolute;top:6px;right:8px;">✕</button>` : '';
      notes += `<div class="wnote">${esc(m.text)}${delBtn}</div>`;
    });
    if (notes) h += notes;
    h += `</div>`;
  });
  return h;
}

/* ── Időszakos szekció-generátorok ── */
function reszlegOsszesitoHtml(entries) {
  const by = {};
  entries.forEach(a => {
    const r = (a.reszleg || '').trim() || 'Ismeretlen részleg';
    by[r] = (by[r] || 0) + (a.sulyok || []).reduce((s, x) => s + x.suly, 0);
  });
  const rank = Object.entries(by).filter(([, v]) => v > 0).sort((a, b) => {
    if (a[0] === 'Ismeretlen részleg') return 1;
    if (b[0] === 'Ismeretlen részleg') return -1;
    return b[1] - a[1];
  });
  if (rank.length < 2) return '';
  const total = rank.reduce((s, [, v]) => s + v, 0);
  let h = `<div class="card" style="margin-bottom:12px;"><div class="card-title"><span class="card-title-icon">🏭</span>Részleg összesítés</div><table class="stbl"><thead><tr><th>#</th><th>Részleg</th><th>Összesen</th><th>Arány</th></tr></thead><tbody>`;
  rank.forEach(([r, kg], i) => {
    const pct  = total > 0 ? (kg / total * 100).toFixed(1) : 0;
    const barW = Math.round(Math.min(parseFloat(pct), 100) * 0.8);
    h += `<tr><td style="color:var(--text3);width:28px;">${i + 1}.</td><td style="font-weight:600;">${esc(r)}</td><td class="v-bold">${fmtKg(kg)}</td><td><div style="display:flex;align-items:center;gap:8px;"><div style="height:6px;width:${barW}px;max-width:80px;background:var(--accent);border-radius:3px;opacity:.65;flex-shrink:0;"></div><span style="color:var(--text3);font-size:12px;">${pct}%</span></div></td></tr>`;
  });
  return h + `</tbody></table></div>`;
}

function teljesHtml(entries) {
  const totalS = entries.reduce((s, a) => s + (a.sulyok || []).reduce((x, y) => x + y.suly, 0), 0);
  let h = `<div class="card" style="margin-bottom:12px;"><div class="card-title"><span class="card-title-icon">📊</span>Teljes termelés</div><table class="stbl"><thead><tr><th>Megnevezés</th><th>Érték</th></tr></thead><tbody>`;
  h += `<tr><td>Darált súly</td><td class="v-bold">${fmtKg(totalS)}</td></tr>`;
  return h + `</tbody></table></div>`;
}

function dolgRangsorHtml(entries) {
  const by = {};
  entries.forEach(a => {
    by[a.nev] = (by[a.nev] || 0) + (a.sulyok || []).reduce((s, x) => s + x.suly, 0);
  });
  const rank = Object.entries(by).sort((a, b) => b[1] - a[1]);
  if (!rank.length) return '';
  let h = `<div class="card" style="margin-bottom:12px;"><div class="card-title"><span class="card-title-icon">🏅</span>Dolgozói rangsor</div><table class="stbl"><thead><tr><th>#</th><th>Dolgozó</th><th>Összes súly</th></tr></thead><tbody>`;
  rank.forEach(([nev, kg], i) => {
    h += `<tr><td style="color:var(--text3);width:28px;">${i + 1}.</td><td style="font-weight:600;color:var(--text);">${esc(nev)}</td><td class="v-bold">${fmtKg(kg)}</td></tr>`;
  });
  return h + `</tbody></table></div>`;
}

function anyagOsszesitoHtml(entries) {
  const by = {};
  entries.forEach(a => {
    const ak = (a.anyag || '').trim(); if (!ak) return;
    by[ak] = (by[ak] || 0) + (a.sulyok || []).reduce((s, x) => s + x.suly, 0);
  });
  const rank = Object.entries(by).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  if (!rank.length) return '';
  const total = rank.reduce((s, [, v]) => s + v, 0);
  let h = `<div class="card" style="margin-bottom:12px;"><div class="card-title"><span class="card-title-icon">📦</span>Anyagtípusok összesítése</div><table class="stbl"><thead><tr><th>#</th><th>Anyag</th><th>Összesen</th><th>Arány</th></tr></thead><tbody>`;
  rank.forEach(([anyag, kg], i) => {
    const pct  = total > 0 ? (kg / total * 100).toFixed(1) : 0;
    const barW = Math.round(Math.min(parseFloat(pct), 100) * 0.8);
    h += `<tr><td style="color:var(--text3);width:28px;">${i + 1}.</td><td style="font-weight:600;">${esc(anyag)}</td><td class="v-bold">${fmtKg(kg)}</td><td><div style="display:flex;align-items:center;gap:8px;"><div style="height:6px;width:${barW}px;max-width:80px;background:var(--accent);border-radius:3px;opacity:.65;flex-shrink:0;"></div><span style="color:var(--text3);font-size:12px;">${pct}%</span></div></td></tr>`;
  });
  return h + `</tbody></table></div>`;
}

function napiAtlagHtml(entries) {
  const totalS = entries.reduce((s, a) => s + (a.sulyok || []).reduce((x, y) => x + y.suly, 0), 0);
  const napok  = new Set(entries.map(a => a.datum)).size;
  if (!napok) return '';
  let h = `<div class="card" style="margin-bottom:12px;"><div class="card-title"><span class="card-title-icon">📈</span>Napi átlagteljesítmény</div><table class="stbl"><thead><tr><th>Mutató</th><th>Érték</th></tr></thead><tbody>`;
  h += `<tr><td>Aktív munkanapok</td><td style="font-weight:600;color:var(--text);">${napok}</td></tr>`;
  h += `<tr><td>Napi átlag (darált)</td><td class="v-bold">${fmtKg(totalS / napok)}</td></tr>`;
  return h + `</tbody></table></div>`;
}

function haviAtlagHtml(entries) {
  const totalS  = entries.reduce((s, a) => s + (a.sulyok || []).reduce((x, y) => x + y.suly, 0), 0);
  const honapok = new Set(entries.map(a => a.datum.substring(0, 7))).size;
  if (!honapok) return '';
  let h = `<div class="card" style="margin-bottom:12px;"><div class="card-title"><span class="card-title-icon">📅</span>Havi átlagteljesítmény</div><table class="stbl"><thead><tr><th>Mutató</th><th>Érték</th></tr></thead><tbody>`;
  h += `<tr><td>Aktív hónapok</td><td style="font-weight:600;color:var(--text);">${honapok}</td></tr>`;
  h += `<tr><td>Havi átlag (darált)</td><td class="v-bold">${fmtKg(totalS / honapok)}</td></tr>`;
  return h + `</tbody></table></div>`;
}

function dolgNapiAtlagHtml(entries) {
  const by = {};
  entries.forEach(a => {
    if (!by[a.nev]) by[a.nev] = { s: 0, napok: new Set() };
    by[a.nev].s += (a.sulyok || []).reduce((x, y) => x + y.suly, 0);
    by[a.nev].napok.add(a.datum);
  });
  let h = `<div class="card" style="margin-bottom:12px;"><div class="card-title"><span class="card-title-icon">👤</span>Dolgozónkénti napi átlag</div><table class="stbl"><thead><tr><th>Dolgozó</th><th>Összes</th><th>Aktív napok</th><th>Napi átlag</th></tr></thead><tbody>`;
  Object.entries(by).sort((a, b) => b[1].s - a[1].s).forEach(([nev, d]) => {
    h += `<tr><td style="font-weight:600;color:var(--text);">${esc(nev)}</td><td class="v-bold">${fmtKg(d.s)}</td><td style="color:var(--text3);">${d.napok.size}</td><td>${fmtKg(d.napok.size > 0 ? d.s / d.napok.size : 0)}</td></tr>`;
  });
  return h + `</tbody></table></div>`;
}

function muszakHtml(entries) {
  const sh = {
    'Délelőtt': { s: 0, napok: new Set(), anyagok: {} },
    'Délután':  { s: 0, napok: new Set(), anyagok: {} }
  };
  entries.forEach(a => {
    const key = (a.ido || '').trim() === 'Délután' ? 'Délután' : 'Délelőtt';
    const kg  = (a.sulyok || []).reduce((x, y) => x + y.suly, 0);
    sh[key].s += kg; sh[key].napok.add(a.datum);
    const ak = (a.anyag || '').trim();
    if (ak && kg > 0) sh[key].anyagok[ak] = (sh[key].anyagok[ak] || 0) + kg;
  });
  if (!Object.values(sh).some(s => s.s > 0)) return '';
  let h = `<div class="card" style="margin-bottom:12px;"><div class="card-title"><span class="card-title-icon">🕐</span>Műszakok összehasonlítása</div><table class="stbl"><thead><tr><th>Műszak</th><th>Összes</th><th>Aktív napok</th><th>Napi átlag</th><th>Legtöbb anyag</th></tr></thead><tbody>`;
  ['Délelőtt', 'Délután'].forEach(shift => {
    const d  = sh[shift];
    const ba = Object.entries(d.anyagok).sort((a, b) => b[1] - a[1])[0];
    h += `<tr><td style="font-weight:600;color:var(--text);">${shift}</td>`;
    if (d.s > 0) {
      h += `<td class="v-bold">${fmtKg(d.s)}</td><td style="color:var(--text3);">${d.napok.size}</td><td>${fmtKg(d.s / d.napok.size)}</td><td style="color:var(--text3);font-size:12px;">${ba ? esc(ba[0]) + ' (' + ba[1].toFixed(0) + ' kg)' : '—'}</td>`;
    } else {
      h += `<td colspan="4" style="color:var(--text3);">Nincs adat</td>`;
    }
    h += `</tr>`;
  });
  return h + `</tbody></table></div>`;
}

function dolgReszletHtml(entries) {
  const by = {};
  entries.forEach(a => {
    if (!by[a.nev]) by[a.nev] = {};
    const ak = (a.anyag || '').trim() || '—';
    by[a.nev][ak] = (by[a.nev][ak] || 0) + (a.sulyok || []).reduce((s, x) => s + x.suly, 0);
  });
  if (!Object.keys(by).length) return '';
  let h = `<div class="card" style="margin-bottom:12px;"><div class="card-title"><span class="card-title-icon">👥</span>Dolgozónkénti részletezés</div>`;
  Object.keys(by).sort((a, b) => a.localeCompare(b, 'hu')).forEach(nev => {
    const anyagok = by[nev];
    const total   = Object.values(anyagok).reduce((s, v) => s + v, 0);
    h += `<div style="margin-bottom:10px;"><div style="font-size:13px;font-weight:600;color:var(--text);padding:6px 0 4px;border-bottom:1px solid var(--border);margin-bottom:4px;">${esc(nev)}</div>`;
    h += `<table class="stbl"><thead><tr><th>Anyag</th><th>Mennyiség</th></tr></thead><tbody>`;
    Object.entries(anyagok).sort((a, b) => b[1] - a[1]).forEach(([anyag, kg]) => {
      h += `<tr><td>${esc(anyag)}</td><td class="v-bold">${fmtKg(kg)}</td></tr>`;
    });
    h += `</tbody><tfoot><tr class="tot"><td>Összesen</td><td>${fmtKg(total)}</td></tr></tfoot></table></div>`;
  });
  return h + `</div>`;
}

function anyagReszletHtml(entries) {
  const by = {};
  entries.forEach(a => {
    const ak = (a.anyag || '').trim(); if (!ak) return;
    if (!by[ak]) by[ak] = {};
    by[ak][a.nev] = (by[ak][a.nev] || 0) + (a.sulyok || []).reduce((s, x) => s + x.suly, 0);
  });
  if (!Object.keys(by).length) return '';
  const rank = Object.entries(by).sort((a, b) =>
    Object.values(b[1]).reduce((s, v) => s + v, 0) - Object.values(a[1]).reduce((s, v) => s + v, 0)
  );
  let h = `<div class="card" style="margin-bottom:12px;"><div class="card-title"><span class="card-title-icon">📦</span>Anyagonkénti részletezés</div>`;
  rank.forEach(([anyag, workers]) => {
    const total = Object.values(workers).reduce((s, v) => s + v, 0);
    h += `<div style="margin-bottom:10px;"><div style="font-size:13px;font-weight:600;color:var(--text);padding:6px 0 4px;border-bottom:1px solid var(--border);margin-bottom:4px;">${esc(anyag)}</div>`;
    h += `<table class="stbl"><thead><tr><th>Dolgozó</th><th>Mennyiség</th></tr></thead><tbody>`;
    Object.entries(workers).sort((a, b) => b[1] - a[1]).forEach(([nev, kg]) => {
      h += `<tr><td style="font-weight:600;">${esc(nev)}</td><td class="v-bold">${fmtKg(kg)}</td></tr>`;
    });
    h += `</tbody><tfoot><tr class="tot"><td>Összesen</td><td>${fmtKg(total)}</td></tr></tfoot></table></div>`;
  });
  return h + `</div>`;
}

function napiBontasHtml(entries, isEves) {
  if (isEves) {
    const honNev = ['Január','Február','Március','Április','Május','Június','Július','Augusztus','Szeptember','Október','November','December'];
    const by = {};
    entries.forEach(a => {
      const mk = a.datum.substring(0, 7);
      by[mk] = (by[mk] || 0) + (a.sulyok || []).reduce((s, x) => s + x.suly, 0);
    });
    const months = Object.keys(by).sort();
    if (!months.length) return '';
    const total = Object.values(by).reduce((s, v) => s + v, 0);
    let h = `<div class="card" style="margin-bottom:12px;"><div class="card-title"><span class="card-title-icon">📅</span>Havi bontás</div><table class="stbl"><thead><tr><th>Hónap</th><th>Darált súly</th></tr></thead><tbody>`;
    months.forEach(mk => {
      h += `<tr><td><button class="dlink" data-goto-havi="${mk}">${honNev[parseInt(mk.split('-')[1]) - 1]}</button></td><td class="v-bold">${fmtKg(by[mk])}</td></tr>`;
    });
    return h + `</tbody><tfoot><tr class="tot"><td>Éves összesen</td><td>${fmtKg(total)}</td></tr></tfoot></table></div>`;
  } else {
    const by = {};
    entries.forEach(a => {
      by[a.datum] = (by[a.datum] || 0) + (a.sulyok || []).reduce((s, x) => s + x.suly, 0);
    });
    const days = Object.keys(by).sort();
    if (!days.length) return '';
    const total = Object.values(by).reduce((s, v) => s + v, 0);
    let h = `<div class="card" style="margin-bottom:12px;"><div class="card-title"><span class="card-title-icon">📅</span>Napi bontás</div><table class="stbl"><thead><tr><th>Nap</th><th>Darált súly</th></tr></thead><tbody>`;
    days.forEach(d => {
      h += `<tr><td><button class="dlink" data-goto="${d}">${esc(fmtS(d))}</button></td><td class="v-bold">${fmtKg(by[d])}</td></tr>`;
    });
    return h + `</tbody><tfoot><tr class="tot"><td>Összesen</td><td>${fmtKg(total)}</td></tr></tfoot></table></div>`;
  }
}
