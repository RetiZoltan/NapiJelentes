import { db, doc, getDoc, deleteDoc, collection, query, where,
         getDocs, orderBy, writeBatch, onSnapshot } from './firebase.js';
import { state, canSeeAllReports, isMainAdmin } from './state.js';
import { E, esc, msg, tod, monday, addD, fmtL, fmtS, fmtKg } from './utils.js';
import { fetchEntries } from './db.js';

let aktView   = 'napi';
let unsubNapi = null;

const RIPORT_DEF = { napiB: true, dolgozoi: true, anyag: true, legek: true, muszak: false, elozo: false };
function getRiportSet(key) {
  try { const s = JSON.parse(localStorage.getItem('napiJelentesRiportSet') || '{}'); return key in s ? s[key] : (RIPORT_DEF[key] ?? true); }
  catch { return RIPORT_DEF[key] ?? true; }
}

export function cleanupNapiListener() {
  if (unsubNapi) { unsubNapi(); unsubNapi = null; }
}

export function switchView(v, btn) {
  aktView = v;
  document.querySelectorAll('.vbtn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.querySelectorAll('.vc').forEach(c => c.classList.remove('active'));
  E('vc' + v.charAt(0).toUpperCase() + v.slice(1)).classList.add('active');
  E('idoszakosRiportDiv').innerHTML = `<div class="empty-st"><div class="empty-ic">📋</div>Kattints a <strong>Mutat</strong> gombra</div>`;
  E('idoszakosKepMentBtn').disabled = true;
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
      let altM = '';
      try {
        const ns = await getDoc(doc(db, 'dailyNotes', rd));
        if (ns.exists()) altM = ns.data().szoveg || '';
      } catch {}
      renderNapi(rd, lista, altM, szuro);
    },
    err => msg('Lekérdezési hiba: ' + err.message, 'error', 5000)
  );
}

function renderNapi(rd, lista, altM, szuro) {
  if (!lista.length && !altM) {
    E('napiRiportDiv').innerHTML = `<div class="empty-st"><div class="empty-ic">📭</div>Nincs adat a(z) ${esc(fmtL(rd))} napra${szuro ? ' (' + esc(szuro) + ')' : ''}</div>`;
    E('napiKepMentBtn').disabled = true;
    return;
  }
  const shifts = [...new Set(lista.map(a => a.ido))].sort();
  const badges = shifts.map(s => `<span class="r-shift">(${esc(s)})</span>`).join(' ');
  let h = `<div class="r-head">${esc(fmtL(rd))}${badges}</div>`;
  if (lista.length) h += workerHtml(grpWorkers(lista));
  if (altM) h += `<div class="day-note"><div class="day-note-lbl">📌 Napi megjegyzés</div><p>${esc(altM).replace(/\n/g, '<br>')}</p>${isMainAdmin() ? `<button class="del-btn" data-type="megj" data-datum="${rd}" style="position:absolute;top:11px;right:11px;">✕</button>` : ''}</div>`;
  E('napiRiportDiv').innerHTML = h;
  E('napiKepMentBtn').disabled = false;
}

/* ── Heti riport ── */
export async function hetiRiport() {
  const kezdo = E('hetiKezdo').value;
  if (!kezdo) { msg('Válassz hetet!', 'error'); return; }
  const h     = monday(kezdo);
  const napok = Array.from({ length: 7 }, (_, i) => addD(h, i));
  E('idoszakosRiportDiv').innerHTML = '<div class="empty-st"><div class="spinner" style="margin:0 auto"></div></div>';
  const needElozo = getRiportSet('elozo');
  const [hA, prevA] = await Promise.all([
    fetchEntries({ datumFrom: napok[0], datumTo: napok[6] }),
    needElozo ? fetchEntries({ datumFrom: addD(napok[0], -7), datumTo: addD(napok[6], -7) }) : Promise.resolve([])
  ]);
  if (!hA.length) { E('idoszakosRiportDiv').innerHTML = `<div class="empty-st"><div class="empty-ic">📭</div>Nincs adat erre a hétre</div>`; E('idoszakosKepMentBtn').disabled = true; return; }

  const d1  = new Date(h + 'T12:00:00');
  const d2  = new Date(napok[6] + 'T12:00:00');
  const cim = `${d1.toLocaleDateString('hu-HU',{month:'long',day:'numeric'})} – ${d2.toLocaleDateString('hu-HU',{month:'long',day:'numeric',year:'numeric'})}`;
  let html  = `<div class="r-head">Heti összesítő <span class="r-shift">· ${esc(cim)}</span></div>`;

  if (getRiportSet('napiB')) {
    let hs = 0, hz = 0;
    html += `<div class="card" style="margin-bottom:12px;"><div class="card-title"><span class="card-title-icon">📅</span>Napi bontás</div><table class="stbl"><thead><tr><th>Nap</th><th>Darált súly</th><th>Zsákok</th><th>Dolgozók</th></tr></thead><tbody>`;
    napok.forEach(d => {
      const na = hA.filter(a => a.datum === d); if (!na.length) return;
      const s  = na.reduce((ac, a) => ac + (a.sulyok || []).reduce((x, y) => x + y.suly, 0), 0);
      const z  = na.reduce((ac, a) => ac + (a.zsakSulyok || []).reduce((x, y) => x + y, 0), 0);
      hs += s; hz += z;
      const nn = [...new Set(na.map(a => a.nev))];
      html += `<tr><td><button class="dlink" data-goto="${d}">${esc(fmtS(d))}</button></td><td class="v-bold">${fmtKg(s)}</td><td class="v-green" style="font-weight:600;">${fmtKg(z)}</td><td style="color:var(--text3);font-size:12.5px;">${esc(nn.join(', '))}</td></tr>`;
    });
    html += `</tbody><tfoot><tr class="tot"><td>Heti összesen</td><td>${fmtKg(hs)}</td><td style="color:var(--green);font-weight:600;">${fmtKg(hz)}</td><td></td></tr></tfoot></table></div>`;
  }

  if (getRiportSet('dolgozoi')) {
    const do_ = {};
    hA.forEach(a => {
      if (!do_[a.nev]) do_[a.nev] = { s: 0, z: 0, np: new Set() };
      do_[a.nev].s += (a.sulyok || []).reduce((x, y) => x + y.suly, 0);
      do_[a.nev].z += (a.zsakSulyok || []).reduce((x, y) => x + y, 0);
      do_[a.nev].np.add(a.datum);
    });
    html += `<div class="card" style="margin-bottom:12px;"><div class="card-title"><span class="card-title-icon">👥</span>Dolgozói összesítő</div><table class="stbl"><thead><tr><th>Dolgozó</th><th>Darált súly</th><th>Zsákok</th><th>Aktív napok</th></tr></thead><tbody>`;
    Object.keys(do_).sort((a, b) => a.localeCompare(b, 'hu')).forEach(n => {
      const d = do_[n];
      html += `<tr><td style="font-weight:600;color:var(--text);">${esc(n)}</td><td class="v-bold">${fmtKg(d.s)}</td><td class="v-green" style="font-weight:600;">${fmtKg(d.z)}</td><td style="color:var(--text3);">${d.np.size} nap</td></tr>`;
    });
    html += `</tbody></table></div>`;
  }

  if (getRiportSet('anyag'))  html += anyagOsszesitoHtml(hA);
  if (getRiportSet('muszak')) html += muszakHtml(hA);
  if (needElozo)              html += elozoHtml(hA, prevA, 'előző hét');
  if (getRiportSet('legek'))  html += legekHtml(hA);
  E('idoszakosRiportDiv').innerHTML = html; E('idoszakosKepMentBtn').disabled = false;
}

/* ── Havi riport ── */
export async function haviRiport() {
  const ev     = parseInt(E('haviEv').value);
  const honap  = parseInt(E('haviHonap').value);
  const prefix = `${ev}-${String(honap + 1).padStart(2, '0')}`;
  const lastDay = new Date(ev, honap + 1, 0).getDate();
  const from   = `${prefix}-01`, to = `${prefix}-${String(lastDay).padStart(2, '0')}`;
  const honNev = ['január','február','március','április','május','június','július','augusztus','szeptember','október','november','december'];
  E('idoszakosRiportDiv').innerHTML = '<div class="empty-st"><div class="spinner" style="margin:0 auto"></div></div>';
  const needElozo = getRiportSet('elozo');
  const prevD  = new Date(ev, honap, 0);
  const pEv = prevD.getFullYear(), pHonap = prevD.getMonth();
  const pPfx = `${pEv}-${String(pHonap + 1).padStart(2, '0')}`;
  const pLast = new Date(pEv, pHonap + 1, 0).getDate();
  const [hA, prevA] = await Promise.all([
    fetchEntries({ datumFrom: from, datumTo: to }),
    needElozo ? fetchEntries({ datumFrom: `${pPfx}-01`, datumTo: `${pPfx}-${String(pLast).padStart(2, '0')}` }) : Promise.resolve([])
  ]);
  if (!hA.length) { E('idoszakosRiportDiv').innerHTML = `<div class="empty-st"><div class="empty-ic">📭</div>Nincs adat erre a hónapra</div>`; E('idoszakosKepMentBtn').disabled = true; return; }

  let html = `<div class="r-head">${ev}. ${honNev[honap]}</div>`;

  if (getRiportSet('napiB')) {
    const nm = {};
    hA.forEach(a => {
      if (!nm[a.datum]) nm[a.datum] = { s: 0, z: 0, n: new Set() };
      nm[a.datum].s += (a.sulyok || []).reduce((x, y) => x + y.suly, 0);
      nm[a.datum].z += (a.zsakSulyok || []).reduce((x, y) => x + y, 0);
      nm[a.datum].n.add(a.nev);
    });
    let hs = 0, hz = 0;
    html += `<div class="card" style="margin-bottom:12px;"><div class="card-title"><span class="card-title-icon">📅</span>Napi bontás</div><table class="stbl"><thead><tr><th>Nap</th><th>Darált súly</th><th>Zsákok</th><th>Dolgozók</th></tr></thead><tbody>`;
    Object.keys(nm).sort().forEach(d => {
      const n = nm[d]; hs += n.s; hz += n.z;
      html += `<tr><td><button class="dlink" data-goto="${d}">${esc(fmtS(d))}</button></td><td class="v-bold">${fmtKg(n.s)}</td><td class="v-green" style="font-weight:600;">${fmtKg(n.z)}</td><td style="color:var(--text3);font-size:12.5px;">${esc([...n.n].join(', '))}</td></tr>`;
    });
    html += `</tbody><tfoot><tr class="tot"><td>Havi összesen</td><td>${fmtKg(hs)}</td><td style="color:var(--green);font-weight:600;">${fmtKg(hz)}</td><td></td></tr></tfoot></table></div>`;
  }

  if (getRiportSet('dolgozoi')) {
    const do2 = {};
    hA.forEach(a => {
      if (!do2[a.nev]) do2[a.nev] = { s: 0, z: 0, np: new Set() };
      do2[a.nev].s += (a.sulyok || []).reduce((x, y) => x + y.suly, 0);
      do2[a.nev].z += (a.zsakSulyok || []).reduce((x, y) => x + y, 0);
      do2[a.nev].np.add(a.datum);
    });
    html += `<div class="card" style="margin-bottom:12px;"><div class="card-title"><span class="card-title-icon">👥</span>Dolgozói összesítő</div><table class="stbl"><thead><tr><th>Dolgozó</th><th>Darált súly</th><th>Zsákok</th><th>Aktív napok</th></tr></thead><tbody>`;
    Object.keys(do2).sort((a, b) => a.localeCompare(b, 'hu')).forEach(n => {
      const d = do2[n];
      html += `<tr><td style="font-weight:600;color:var(--text);">${esc(n)}</td><td class="v-bold">${fmtKg(d.s)}</td><td class="v-green" style="font-weight:600;">${fmtKg(d.z)}</td><td style="color:var(--text3);">${d.np.size} nap</td></tr>`;
    });
    html += `</tbody></table></div>`;
  }

  if (getRiportSet('anyag'))  html += anyagOsszesitoHtml(hA);
  if (getRiportSet('muszak')) html += muszakHtml(hA);
  if (needElozo)              html += elozoHtml(hA, prevA, 'előző hónap');
  if (getRiportSet('legek'))  html += legekHtml(hA);
  E('idoszakosRiportDiv').innerHTML = html; E('idoszakosKepMentBtn').disabled = false;
}

/* ── Éves riport ── */
export async function evesRiport() {
  const ev   = parseInt(E('evesEv').value);
  const from = `${ev}-01-01`, to = `${ev}-12-31`;
  const honNev = ['Január','Február','Március','Április','Május','Június','Július','Augusztus','Szeptember','Október','November','December'];

  E('idoszakosRiportDiv').innerHTML = '<div class="empty-st"><div class="spinner" style="margin:0 auto"></div></div>';
  const hA = await fetchEntries({ datumFrom: from, datumTo: to });
  if (!hA.length) { E('idoszakosRiportDiv').innerHTML = `<div class="empty-st"><div class="empty-ic">📭</div>Nincs adat ${ev}. évre</div>`; E('idoszakosKepMentBtn').disabled = true; return; }

  let html = `<div class="r-head">${ev}. év</div>`;

  /* Havi bontás */
  const byMonth = {};
  for (let m = 0; m < 12; m++) byMonth[`${ev}-${String(m + 1).padStart(2, '0')}`] = { s: 0, z: 0, n: new Set() };
  hA.forEach(a => {
    const mk = a.datum.substring(0, 7);
    if (!byMonth[mk]) byMonth[mk] = { s: 0, z: 0, n: new Set() };
    byMonth[mk].s += (a.sulyok || []).reduce((x, y) => x + y.suly, 0);
    byMonth[mk].z += (a.zsakSulyok || []).reduce((x, y) => x + y, 0);
    byMonth[mk].n.add(a.nev);
  });
  let totalS = 0, totalZ = 0;
  if (getRiportSet('napiB')) {
    html += `<div class="card" style="margin-bottom:12px;"><div class="card-title"><span class="card-title-icon">📅</span>Havi bontás</div><table class="stbl"><thead><tr><th>Hónap</th><th>Darált súly</th><th>Zsákok</th><th>Dolgozók</th></tr></thead><tbody>`;
    Object.keys(byMonth).sort().forEach(mk => {
      const m = byMonth[mk]; if (m.s === 0 && m.z === 0) return;
      totalS += m.s; totalZ += m.z;
      const hi = parseInt(mk.split('-')[1]) - 1;
      html += `<tr><td><button class="dlink" data-goto-havi="${mk}">${honNev[hi]}</button></td><td class="v-bold">${fmtKg(m.s)}</td><td class="v-green" style="font-weight:600;">${fmtKg(m.z)}</td><td style="color:var(--text3);font-size:12.5px;">${esc([...m.n].join(', '))}</td></tr>`;
    });
    html += `</tbody><tfoot><tr class="tot"><td>Éves összesen</td><td>${fmtKg(totalS)}</td><td style="color:var(--green);font-weight:600;">${fmtKg(totalZ)}</td><td></td></tr></tfoot></table></div>`;
  }

  /* Dolgozói összesítő */
  if (getRiportSet('dolgozoi')) {
    const dw = {};
    hA.forEach(a => {
      if (!dw[a.nev]) dw[a.nev] = { s: 0, z: 0, np: new Set() };
      dw[a.nev].s += (a.sulyok || []).reduce((x, y) => x + y.suly, 0);
      dw[a.nev].z += (a.zsakSulyok || []).reduce((x, y) => x + y, 0);
      dw[a.nev].np.add(a.datum);
    });
    html += `<div class="card" style="margin-bottom:12px;"><div class="card-title"><span class="card-title-icon">👥</span>Dolgozói összesítő</div><table class="stbl"><thead><tr><th>Dolgozó</th><th>Darált súly</th><th>Zsákok</th><th>Aktív napok</th></tr></thead><tbody>`;
    Object.keys(dw).sort((a, b) => dw[b].s - dw[a].s).forEach(n => {
      const w = dw[n];
      html += `<tr><td style="font-weight:600;color:var(--text);">${esc(n)}</td><td class="v-bold">${fmtKg(w.s)}</td><td class="v-green" style="font-weight:600;">${fmtKg(w.z)}</td><td style="color:var(--text3);">${w.np.size}</td></tr>`;
    });
    html += `</tbody></table></div>`;
  }

  /* Anyag összesítő (mindig számítjuk, Legekhez kell) */
  const anyagok = {};
  hA.forEach(a => {
    const ak = (a.anyag || '').trim(); if (!ak) return;
    if (!anyagok[ak]) anyagok[ak] = 0;
    anyagok[ak] += (a.sulyok || []).reduce((x, y) => x + y.suly, 0);
  });
  const anyagRank = Object.entries(anyagok).sort((a, b) => b[1] - a[1]);
  if (getRiportSet('anyag')) html += anyagOsszesitoHtml(hA);
  if (getRiportSet('muszak')) html += muszakHtml(hA);

  /* Előző év összehasonlítás */
  if (getRiportSet('elozo')) {
    const prevA = await fetchEntries({ datumFrom: `${ev - 1}-01-01`, datumTo: `${ev - 1}-12-31` });
    html += elozoHtml(hA, prevA, `${ev - 1}. év`);
  }

  /* Legek (legjobb hónap + legtöbb anyag) */
  if (getRiportSet('legek')) {
    const bestMonth = Object.entries(byMonth).filter(([, m]) => m.s > 0).sort((a, b) => b[1].s - a[1].s)[0];
    const bestAnyag = anyagRank[0];
    if (bestMonth || bestAnyag) {
      html += `<div class="card"><div class="card-title"><span class="card-title-icon">🏆</span>Legek</div><table class="stbl"><thead><tr><th>Rekord</th><th>Érték</th><th>Adat</th></tr></thead><tbody>`;
      if (bestMonth) html += `<tr><td>🥇 Legjobb hónap</td><td class="v-bold">${fmtKg(bestMonth[1].s)}</td><td style="color:var(--text3);font-size:12.5px;">${honNev[parseInt(bestMonth[0].split('-')[1]) - 1]}</td></tr>`;
      if (bestAnyag) html += `<tr><td>📦 Legtöbb anyag</td><td class="v-bold">${fmtKg(bestAnyag[1])}</td><td style="color:var(--text3);font-size:12.5px;">${esc(bestAnyag[0])}</td></tr>`;
      html += `</tbody></table></div>`;
    }
  }

  E('idoszakosRiportDiv').innerHTML = html;
  E('idoszakosKepMentBtn').disabled = false;
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
    const [y, m] = gotoHavi.split('-');
    E('haviEv').value    = y;
    E('haviHonap').value = parseInt(m) - 1;
    switchView('havi', E('vbHavi'));
    haviRiport();
    return;
  }
  const btn = e.target.closest('.del-btn'); if (!btn) return;
  const dtype = btn.dataset.type, datum = btn.dataset.datum, ids = btn.dataset.ids;
  if (dtype === 'megj' && datum) {
    if (!confirm(`Törlöd a(z) ${datum} napi megjegyzést?`)) return;
    await deleteDoc(doc(db, 'dailyNotes', datum));
    msg('Megjegyzés törölve.');
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

function kepMentDiv(divId, suffix) {
  const cs   = getComputedStyle(document.documentElement);
  const g    = v => cs.getPropertyValue(v).trim();
  const bg   = g('--bg'), surf = g('--surf'), surf2 = g('--surf2'), surf3 = g('--surf3');
  const b    = g('--border'), b2 = g('--border2');
  const t1   = g('--text'), t2 = g('--text2'), t3 = g('--text3');
  const acc  = g('--accent'), green = g('--green'), amber = g('--amber'), amberl = g('--amberl'), red = g('--red');
  const clone = E(divId).cloneNode(true);
  clone.querySelectorAll('.del-btn').forEach(x => x.remove());
  const wrap  = document.createElement('div');
  wrap.style.cssText = `position:fixed;left:-9999px;top:0;width:800px;font-family:'Source Sans 3','Segoe UI',sans-serif;font-size:15px;line-height:1.65;color:${t1};background:${bg};padding:30px 32px 36px;box-sizing:border-box;`;
  const inner = document.createElement('div');
  inner.style.cssText = `background:${surf};border:1px solid ${b};border-radius:11px;padding:24px 26px 28px;`;
  const style = document.createElement('style');
  style.textContent = `.r-head{font-family:'Lora',Georgia,serif;font-size:20px;font-weight:500;color:${t1};margin-bottom:16px;padding-bottom:11px;border-bottom:2px solid ${b2};display:flex;align-items:baseline;flex-wrap:wrap;}.r-shift{font-family:'Lora',Georgia,serif;font-size:20px;font-weight:400;font-style:italic;color:${t2};margin-left:10px;}.worker-block{background:${surf};border:1px solid ${b};border-radius:7px;overflow:hidden;margin-bottom:10px;}.worker-hd{background:${surf2};border-bottom:1px solid ${b};padding:8px 14px;display:flex;align-items:center;gap:8px;}.worker-dot{width:7px;height:7px;border-radius:50%;background:${acc};}.worker-nm{font-size:14px;font-weight:600;color:${t1};}table.rt{width:100%;border-collapse:collapse;font-size:13px;}.rt th{text-align:left;color:${t3};font-size:10.5px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;padding:7px 14px;border-bottom:1px solid ${b};background:${surf2};}.rt td{padding:9px 14px;border-bottom:1px solid ${b};color:${t2};vertical-align:top;}.rt tfoot td{padding:8px 14px;border-top:1px solid ${b2};font-weight:600;font-size:12.5px;color:${t1};background:${surf3};}.v-teli{color:${red};font-weight:600;}.v-kezdett{color:${amber};font-weight:600;}.v-green{color:${green};font-weight:600;}.v-bold{color:${t1};font-weight:600;}.wnote{padding:8px 14px;border-top:1px solid ${b};background:${surf2};font-size:13px;color:${t2};white-space:pre-wrap;}.day-note{margin-top:11px;padding:13px 15px;background:${amberl};border:1px solid rgba(0,0,0,.1);border-radius:7px;font-size:13px;color:${t2};white-space:pre-wrap;}.day-note-lbl{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:${amber};margin-bottom:5px;}.card{background:${surf};border:1px solid ${b};border-radius:11px;padding:18px 20px;margin-bottom:12px;}.stbl{width:100%;border-collapse:collapse;font-size:13px;}.stbl th{text-align:left;color:${t3};font-size:10.5px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;padding:7px 13px;border-bottom:1px solid ${b};background:${surf2};}.stbl td{padding:9px 13px;border-bottom:1px solid ${b};color:${t2};}.stbl .tot td{font-weight:700;color:${t1};border-top:2px solid ${b2};background:${surf3};font-size:12.5px;}`;
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

/* ── Internal helpers ── */
function grpWorkers(list) {
  const c = {};
  list.forEach(a => {
    if (!c[a.nev]) c[a.nev] = { anyagok: {}, csMegj: [] };
    const ak = (a.anyag || '').trim().toLowerCase() || '_';
    const hS = Array.isArray(a.sulyok) && a.sulyok.length > 0;
    const hZ = Array.isArray(a.zsakSulyok) && a.zsakSulyok.length > 0;
    if ((a.anyag || '').trim() || hS || hZ) {
      if (!c[a.nev].anyagok[ak]) c[a.nev].anyagok[ak] = { nev: (a.anyag || '').trim() || '—', sulyok: [], zsakSulyok: [], megj: [], ids: [] };
      if (hS) c[a.nev].anyagok[ak].sulyok.push(...a.sulyok);
      if (hZ) c[a.nev].anyagok[ak].zsakSulyok.push(...a.zsakSulyok);
      if (a.megjegyzes?.trim()) c[a.nev].anyagok[ak].megj.push(a.megjegyzes.trim());
      c[a.nev].anyagok[ak].ids.push(a.id);
    } else if (a.megjegyzes?.trim()) c[a.nev].csMegj.push({ id: a.id, text: a.megjegyzes.trim() });
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
          sh = `<span class="dtoggle" style="cursor:default">${fmtKg(os)}</span><div style="display:none;font-size:12px;margin-top:3px;">${det}</div>`;
        }
        let zh = '—';
        if (aa.zsakSulyok.length > 0) { const zo = aa.zsakSulyok.reduce((s, x) => s + x, 0); dz += zo; zh = `<span class="v-green">${aa.zsakSulyok.map(s => s.toFixed(0)).join(', ')} kg</span>`; }
        h += `<tr><td>${esc(aa.nev)}</td><td>${sh}</td><td>${zh}</td><td><button class="del-btn" data-ids="${esc(ids)}">✕</button></td></tr>`;
        aa.megj.forEach(m => { notes += `<div class="wnote">${esc(m)}</div>`; });
      });
      h += `</tbody><tfoot><tr><td>Összesen</td><td class="v-bold">${fmtKg(ds)}</td><td class="v-green" style="font-weight:600;">${fmtKg(dz)}</td><td></td></tr></tfoot></table>`;
    }
    cd.csMegj.forEach(m => { notes += `<div class="wnote">${esc(m.text)}<button class="del-btn" data-ids="${m.id}" style="position:absolute;top:6px;right:8px;">✕</button></div>`; });
    if (notes) h += notes;
    h += `</div>`;
  });
  return h;
}

function anyagOsszesitoHtml(entries) {
  const byAnyag = {};
  entries.forEach(a => {
    const ak = (a.anyag || '').trim(); if (!ak) return;
    if (!byAnyag[ak]) byAnyag[ak] = 0;
    byAnyag[ak] += (a.sulyok || []).reduce((s, x) => s + x.suly, 0);
  });
  const rank = Object.entries(byAnyag).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  if (!rank.length) return '';
  const total = rank.reduce((s, [, v]) => s + v, 0);
  let h = `<div class="card" style="margin-bottom:12px;"><div class="card-title"><span class="card-title-icon">📦</span>Anyag összesítő</div><table class="stbl"><thead><tr><th>#</th><th>Anyag</th><th>Összesen</th><th>Arány</th></tr></thead><tbody>`;
  rank.forEach(([anyag, kg], i) => {
    const pct  = total > 0 ? (kg / total * 100).toFixed(1) : 0;
    const barW = Math.round(Math.min(parseFloat(pct), 100) * 0.8);
    h += `<tr><td style="color:var(--text3);width:28px;">${i + 1}.</td><td style="font-weight:600;">${esc(anyag)}</td><td class="v-bold">${fmtKg(kg)}</td><td><div style="display:flex;align-items:center;gap:8px;"><div style="height:6px;width:${barW}px;max-width:80px;background:var(--accent);border-radius:3px;opacity:.65;flex-shrink:0;"></div><span style="color:var(--text3);font-size:12px;">${pct}%</span></div></td></tr>`;
  });
  return h + `</tbody></table></div>`;
}

function muszakHtml(entries) {
  const byShift = {};
  entries.forEach(a => {
    const s = (a.ido || '').trim() || 'Ismeretlen';
    if (!byShift[s]) byShift[s] = { s: 0, z: 0, napok: new Set() };
    byShift[s].s += (a.sulyok || []).reduce((x, y) => x + y.suly, 0);
    byShift[s].z += (a.zsakSulyok || []).reduce((x, y) => x + y, 0);
    byShift[s].napok.add(a.datum);
  });
  const shifts = Object.entries(byShift);
  if (shifts.length < 2) return '';
  const totalS = shifts.reduce((s, [, v]) => s + v.s, 0);
  let h = `<div class="card" style="margin-bottom:12px;"><div class="card-title"><span class="card-title-icon">🕐</span>Műszakok összehasonlítása</div><table class="stbl"><thead><tr><th>Műszak</th><th>Darált súly</th><th>Zsákok</th><th>Aktív napok</th></tr></thead><tbody>`;
  shifts.sort((a, b) => a[0].localeCompare(b[0], 'hu')).forEach(([shift, d]) => {
    const pct = totalS > 0 ? (d.s / totalS * 100).toFixed(1) : 0;
    h += `<tr><td style="font-weight:600;color:var(--text);">${esc(shift)}</td><td class="v-bold">${fmtKg(d.s)} <span style="color:var(--text3);font-size:11px;">(${pct}%)</span></td><td class="v-green" style="font-weight:600;">${d.z > 0 ? fmtKg(d.z) : '—'}</td><td style="color:var(--text3);">${d.napok.size}</td></tr>`;
  });
  return h + `</tbody></table></div>`;
}

function elozoHtml(currA, prevA, prevLabel) {
  if (!prevA.length) return '';
  const sumS  = arr => arr.reduce((s, a) => s + (a.sulyok || []).reduce((x, y) => x + y.suly, 0), 0);
  const sumZ  = arr => arr.reduce((s, a) => s + (a.zsakSulyok || []).reduce((x, y) => x + y, 0), 0);
  const napok = arr => new Set(arr.map(a => a.datum)).size;
  const cS = sumS(currA), pS = sumS(prevA);
  const cZ = sumZ(currA), pZ = sumZ(prevA);
  const cN = napok(currA), pN = napok(prevA);
  const diff = (c, p) => {
    if (!p) return `<span style="color:var(--text3);">—</span>`;
    const d = c - p, pct = (d / p * 100).toFixed(1);
    const col = d > 0 ? 'var(--green)' : d < 0 ? 'var(--red)' : 'var(--text3)';
    return `<span style="color:${col};font-weight:600;">${d > 0 ? '+' : ''}${pct}%</span>`;
  };
  let h = `<div class="card" style="margin-bottom:12px;"><div class="card-title"><span class="card-title-icon">📊</span>Összehasonlítás — ${esc(prevLabel)}</div><table class="stbl"><thead><tr><th>Mutató</th><th>Jelenlegi</th><th>${esc(prevLabel)}</th><th>Változás</th></tr></thead><tbody>`;
  h += `<tr><td>Darált súly</td><td class="v-bold">${fmtKg(cS)}</td><td style="color:var(--text3);">${fmtKg(pS)}</td><td>${diff(cS, pS)}</td></tr>`;
  if (cZ > 0 || pZ > 0) h += `<tr><td>Zsákok</td><td class="v-green" style="font-weight:600;">${cZ > 0 ? fmtKg(cZ) : '—'}</td><td style="color:var(--text3);">${pZ > 0 ? fmtKg(pZ) : '—'}</td><td>${diff(cZ, pZ)}</td></tr>`;
  h += `<tr><td>Aktív napok</td><td style="font-weight:600;color:var(--text);">${cN}</td><td style="color:var(--text3);">${pN}</td><td>${diff(cN, pN)}</td></tr>`;
  return h + `</tbody></table></div>`;
}

function legekHtml(entries) {
  const byDay = {};
  entries.forEach(a => {
    if (!byDay[a.datum]) byDay[a.datum] = 0;
    byDay[a.datum] += (a.sulyok || []).reduce((s, x) => s + x.suly, 0);
  });
  const bestDay = Object.entries(byDay).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1])[0];

  const byAnyag = {};
  entries.forEach(a => {
    const ak = (a.anyag || '').trim(); if (!ak) return;
    if (!byAnyag[ak]) byAnyag[ak] = 0;
    byAnyag[ak] += (a.sulyok || []).reduce((s, x) => s + x.suly, 0);
  });
  const bestAnyag = Object.entries(byAnyag).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1])[0];

  if (!bestDay && !bestAnyag) return '';

  let h = `<div class="card"><div class="card-title"><span class="card-title-icon">🏆</span>Legek</div><table class="stbl"><thead><tr><th>Rekord</th><th>Érték</th><th>Adat</th></tr></thead><tbody>`;
  if (bestDay)   h += `<tr><td>🥇 Legjobb nap</td><td class="v-bold">${fmtKg(bestDay[1])}</td><td style="color:var(--text3);font-size:12.5px;">${esc(fmtS(bestDay[0]))}</td></tr>`;
  if (bestAnyag) h += `<tr><td>📦 Legtöbb anyag</td><td class="v-bold">${fmtKg(bestAnyag[1])}</td><td style="color:var(--text3);font-size:12.5px;">${esc(bestAnyag[0])}</td></tr>`;
  h += `</tbody></table></div>`;
  return h;
}
