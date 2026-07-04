import { db, doc, getDoc, deleteDoc, collection, query, where,
         getDocs, orderBy, writeBatch, onSnapshot } from './firebase.js';
import { logAction } from './auditlog.js';
import { state, canSeeAllReports, isMainAdmin, isMuszakVezeto } from './state.js';
import { E, esc, msg, tod, fmtL, fmtS, fmtKg, skelHtml } from './utils.js';
import { fetchEntries, deleteDailyNoteForReszleg } from './db.js';

let unsubNapi = null;
let _lastNapiState = null;

const HONAP_NEVEK = ['január','február','március','április','május','június','július','augusztus','szeptember','október','november','december'];

const RIPORT_DEF = {
  teljes: true, dolgRangsor: true, anyagOssz: true,
  napiAtlag: true, dolgNapiAtlag: false, haviAtlag: false, muszak: false,
  dolgReszlet: false, anyagReszlet: false, napiBontas: true
};
function getRiportSet(key) {
  try { const s = JSON.parse(localStorage.getItem('napiJelentesRiportSet') || '{}'); return key in s ? s[key] : (RIPORT_DEF[key] ?? true); }
  catch { return RIPORT_DEF[key] ?? true; }
}

/* ── Napi termelés vonaldiagram ── */
function _riportLineChart(hA) {
  const byDay = {};
  hA.forEach(e => {
    const kg = (e.sulyok || []).reduce((s, x) => s + x.suly, 0);
    byDay[e.datum] = (byDay[e.datum] || 0) + kg;
  });
  const days = Object.entries(byDay).sort((a, b) => a[0].localeCompare(b[0]))
    .map(([datum, kg]) => ({ datum, kg }));
  if (days.length < 2) return '';

  const W = 600, H = 140, PL = 46, PR = 12, PT = 14, PB = 26;
  const cW = W - PL - PR, cH = H - PT - PB;
  const vals = days.map(d => d.kg);
  const maxV = Math.max(...vals, 1);
  const n    = days.length;
  const xP   = i => PL + (i / Math.max(n - 1, 1)) * cW;
  const yP   = v => PT + cH - (v / maxV) * cH;

  const gridLines = [0, 0.25, 0.5, 0.75, 1].map(p => {
    const y = PT + cH - p * cH;
    return `<line x1="${PL}" y1="${y}" x2="${W - PR}" y2="${y}" stroke="var(--border)" stroke-width="0.6"/>
    <text x="${PL - 5}" y="${y + 3.5}" font-size="9.5" text-anchor="end" fill="var(--text3)">${((p * maxV) / 1000).toFixed(1)}t</text>`;
  }).join('');

  const linePts  = days.map((d, i) => `${xP(i)} ${yP(d.kg)}`).join(' L ');
  const areaPath = `M ${xP(0)} ${PT + cH} L ${linePts} L ${xP(n - 1)} ${PT + cH} Z`;
  const dots     = n <= 60
    ? days.map((d, i) => `<circle cx="${xP(i)}" cy="${yP(d.kg)}" r="${n > 30 ? 2 : 3}" fill="var(--accent)" opacity=".85"/>`)
      .join('')
    : '';

  const step    = Math.max(1, Math.ceil(n / 7));
  const xLabels = days
    .filter((_, i) => i % step === 0 || i === n - 1)
    .map(d => {
      const i = days.indexOf(d);
      return `<text x="${xP(i)}" y="${H - 5}" font-size="9" text-anchor="middle" fill="var(--text3)">${d.datum.slice(5)}</text>`;
    }).join('');

  const uid = Math.random().toString(36).slice(2, 7);
  return `<div class="r-section">
    <div class="r-sec-title">📈 Napi termelés</div>
    <svg viewBox="0 0 ${W} ${H}" style="width:100%;overflow:visible;">
      <defs><linearGradient id="rlcg_${uid}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="var(--accent)" stop-opacity=".22"/>
        <stop offset="100%" stop-color="var(--accent)" stop-opacity=".02"/>
      </linearGradient></defs>
      ${gridLines}
      <path d="${areaPath}" fill="url(#rlcg_${uid})"/>
      <path d="M ${linePts}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
      ${dots}${xLabels}
    </svg>
  </div>`;
}

/* ── Dolgozói sávdiagram ── */
function _riportBarChart(hA) {
  const byW = {};
  hA.forEach(e => {
    const kg = (e.sulyok || []).reduce((s, x) => s + x.suly, 0);
    if (e.nev && kg > 0) byW[e.nev] = (byW[e.nev] || 0) + kg;
  });
  const rank = Object.entries(byW).sort((a, b) => b[1] - a[1]);
  if (!rank.length) return '';

  const maxKg  = rank[0][1];
  const BAR_H  = 28, GAP = 8, PL = 130, PR = 60, PT = 8;
  const W      = 600;
  const H      = PT + rank.length * (BAR_H + GAP) + 4;

  const bars = rank.map(([nev, kg], i) => {
    const y      = PT + i * (BAR_H + GAP);
    const barW   = Math.max(2, Math.round((kg / maxKg) * (W - PL - PR)));
    const alpha  = 0.9 - i * (0.55 / Math.max(rank.length - 1, 1));
    const valLbl = `${(kg / 1000).toFixed(2)} t`;
    const medal  = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
    return `
      <text x="${PL - 8}" y="${y + BAR_H * 0.65}" font-size="11.5" text-anchor="end" fill="var(--text2)"
        style="font-family:'Source Sans 3',sans-serif">${esc(nev.length > 16 ? nev.slice(0, 15) + '…' : nev)}</text>
      <text x="4" y="${y + BAR_H * 0.65}" font-size="11" text-anchor="start" fill="var(--text3)">${medal}</text>
      <rect x="${PL}" y="${y}" width="${barW}" height="${BAR_H}" rx="4"
        fill="var(--accent)" opacity="${alpha.toFixed(2)}"/>
      <text x="${PL + barW + 6}" y="${y + BAR_H * 0.65}" font-size="11" fill="var(--text2)"
        style="font-family:'Source Sans 3',sans-serif;font-weight:600">${valLbl}</text>`;
  }).join('');

  return `<div class="r-section">
    <div class="r-sec-title">📊 Dolgozói rangsor</div>
    <svg viewBox="0 0 ${W} ${H}" style="width:100%;overflow:visible;">
      ${bars}
    </svg>
  </div>`;
}

/* ── Időszak rekordjai ── */
function _riportRekordok(hA) {
  const byDay = {}, byWorker = {}, byMat = {};
  hA.forEach(e => {
    const kg = (e.sulyok || []).reduce((s, x) => s + x.suly, 0);
    if (kg <= 0) return;
    byDay[e.datum]     = (byDay[e.datum]     || 0) + kg;
    if (e.nev)   byWorker[e.nev]   = (byWorker[e.nev]   || 0) + kg;
    if (e.anyag) byMat[e.anyag]    = (byMat[e.anyag]    || 0) + kg;
  });
  const top = obj => Object.entries(obj).sort((a, b) => b[1] - a[1])[0];
  const bestDay    = top(byDay);
  const bestWorker = top(byWorker);
  const bestMat    = top(byMat);
  if (!bestDay) return '';

  const card = (icon, label, value, sub, color = 'var(--accent)', bg = 'var(--agl)') =>
    `<div class="r-rekord-card">
      <div class="r-rekord-icon" style="background:${bg};color:${color}">${icon}</div>
      <div class="r-rekord-body">
        <div class="r-rekord-label">${label}</div>
        <div class="r-rekord-value">${value}</div>
        <div class="r-rekord-sub">${sub}</div>
      </div>
    </div>`;

  return `<div class="r-section">
    <div class="r-sec-title">🏆 Időszak rekordjai</div>
    <div class="r-rekord-grid">
      ${bestDay    ? card('📅', 'Legjobb nap',      esc(fmtS(bestDay[0])),    `${(bestDay[1]/1000).toFixed(2)} t`, 'var(--amber)', 'var(--amberl)') : ''}
      ${bestWorker ? card('👤', 'Legjobb dolgozó',   esc(bestWorker[0]),       `${(bestWorker[1]/1000).toFixed(2)} t az időszakban`, 'var(--accent)', 'var(--agl)') : ''}
      ${bestMat    ? card('📦', 'Vezető anyag',       esc(bestMat[0]),          `${(bestMat[1]/1000).toFixed(2)} t az időszakban`, 'var(--green)', 'var(--greenl)') : ''}
    </div>
  </div>`;
}

/* ── Termelés naptár nézet (hőtérkép) ── */
function _riportKalendarNezet(hA) {
  const byDay = {};
  hA.forEach(e => {
    const kg = (e.sulyok || []).reduce((s, x) => s + x.suly, 0);
    byDay[e.datum] = (byDay[e.datum] || 0) + kg;
  });
  const datumok = hA.map(e => e.datum).filter(Boolean);
  if (!datumok.length) return '';
  const minDate = datumok.reduce((a, b) => a < b ? a : b);
  const maxDate = datumok.reduce((a, b) => a > b ? a : b);
  const maxKg   = Math.max(...Object.values(byDay), 1);

  // Hétfőre igazított kezdet
  const fmtLocal = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const startD   = new Date(minDate + 'T12:00:00');
  const dow      = startD.getDay() || 7;
  startD.setDate(startD.getDate() - dow + 1);
  const endD     = new Date(maxDate + 'T12:00:00');

  const days = [];
  const cur  = new Date(startD);
  while (cur <= endD) { days.push(fmtLocal(cur)); cur.setDate(cur.getDate() + 1); }

  const CELL = 13, GAP = 2, ML = 22, MT = 18;
  const numWeeks = Math.ceil(days.length / 7);
  const W = ML + numWeeks * (CELL + GAP);
  const H = MT + 7 * (CELL + GAP) + 4;

  const HU_MONTHS = ['Jan','Feb','Már','Ápr','Máj','Jún','Júl','Aug','Sze','Okt','Nov','Dec'];
  const HU_DAYS   = ['H','K','Sz','Cs','P','Sz','V'];

  let lastMonth = -1;
  const monthLbls = [], cells = [];

  days.forEach((datum, i) => {
    const wk  = Math.floor(i / 7);
    const dow = i % 7;
    const x   = ML + wk * (CELL + GAP);
    const y   = MT + dow * (CELL + GAP);
    const d   = new Date(datum + 'T12:00:00');
    const mo  = d.getMonth();
    if (dow === 0 && mo !== lastMonth) {
      lastMonth = mo;
      monthLbls.push(`<text x="${x}" y="${MT - 4}" font-size="8.5" fill="var(--text3)">${HU_MONTHS[mo]}</text>`);
    }
    const inRange = datum >= minDate && datum <= maxDate;
    const kg      = byDay[datum] || 0;
    const alpha   = kg > 0 ? (0.2 + (kg / maxKg) * 0.8).toFixed(2) : (inRange ? '0.07' : '0.02');
    const fill    = kg > 0 ? 'var(--accent)' : 'var(--border2)';
    const tip     = `${datum}: ${kg > 0 ? (kg/1000).toFixed(2) + ' t' : 'Nincs adat'}`;
    cells.push(`<rect x="${x}" y="${y}" width="${CELL}" height="${CELL}" rx="2" fill="${fill}" opacity="${alpha}"><title>${esc(tip)}</title></rect>`);
  });

  const dayLbls = [0,2,4,6].map(i =>
    `<text x="${ML-3}" y="${MT + i*(CELL+GAP) + CELL*0.78}" font-size="8" text-anchor="end" fill="var(--text3)">${HU_DAYS[i]}</text>`
  ).join('');

  // Jelmagyarázat
  const legend = [0.07, 0.3, 0.5, 0.7, 1].map(a =>
    `<span style="display:inline-block;width:11px;height:11px;border-radius:2px;background:var(--accent);opacity:${a};flex-shrink:0;"></span>`
  ).join('');

  return `<div class="r-section">
    <div class="r-sec-title">🗓 Termelés naptár nézet</div>
    <div style="overflow-x:auto;-webkit-overflow-scrolling:touch;">
      <svg viewBox="0 0 ${W} ${H}" style="min-width:${Math.min(W,300)}px;height:${H}px;display:block;">
        ${dayLbls}${monthLbls.join('')}${cells.join('')}
      </svg>
    </div>
    <div style="display:flex;align-items:center;gap:5px;margin-top:8px;font-size:11px;color:var(--text3);">
      Kevés ${legend} Sok
    </div>
  </div>`;
}

export function cleanupNapiListener() {
  if (unsubNapi) { unsubNapi(); unsubNapi = null; }
}

/* ── Napi riport with onSnapshot ── */
export function napiRiport() {
  const rd = E('riportD').value;
  if (!rd) { msg('Válassz dátumot!', 'error'); return; }
  const szuro   = canSeeAllReports() ? E('dolgSzuro').value : '';
  const autoMV  = isMuszakVezeto() ? (state.userData?.displayName || '') : '';
  const mvSzuro = autoMV || (canSeeAllReports() ? E('napiMuszakVezetoSzuro')?.value || '' : '');

  E('napiRiportDiv').innerHTML = skelHtml('report');
  cleanupNapiListener();

  const constraints = [where('datum', '==', rd)];
  if (!canSeeAllReports()) constraints.push(where('createdBy', '==', state.appUser.uid));
  constraints.push(orderBy('datum'), orderBy('createdAt'));

  unsubNapi = onSnapshot(
    query(collection(db, 'entries'), ...constraints),
    async snap => {
      let lista = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      if (szuro) lista = lista.filter(a => a.nev === szuro);
      if (mvSzuro && !szuro) {
        const csapat = state.muszakVezetokMap[mvSzuro] || [];
        lista = lista.filter(a => csapat.includes(a.nev) || a.nev === mvSzuro);
      }
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
    E('napiKepMentBtn').disabled = E('napiPdfBtn').disabled = E('napiNyomtatBtn').disabled = true;
    return;
  }
  const allShifts = [...new Set(filtered.map(a => a.ido))].sort();
  const needsShiftBlocks = !muszakF && allShifts.length > 1;
  const badges = needsShiftBlocks ? '' : allShifts.map(s => `<span class="r-shift">(${esc(s)})</span>`).join(' ');
  let h = `<div class="r-head">${esc(fmtL(rd))}${badges}</div>`;
  h += napiOsszHtml(filtered);

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
  E('napiKepMentBtn').disabled = E('napiPdfBtn').disabled = E('napiNyomtatBtn').disabled = false;
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

function _setIdoszakBtns(disabled) {
  ['idoszakosKepMentBtn','idoszakosPdfBtn','idoszakosNyomtatBtn'].forEach(id => {
    const el = E(id); if (el) el.disabled = disabled;
  });
  const xlsx = E('idoszakosXlsxBtn');
  if (xlsx) xlsx.disabled = disabled;
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

  E('idoszakosRiportDiv').innerHTML = skelHtml('report');
  let hA = _applyIdoszakosFilters(await fetchEntries({ datumFrom: from, datumTo: to }));
  if (!hA.length) {
    E('idoszakosRiportDiv').innerHTML = `<div class="empty-st"><div class="empty-ic">📭</div>Nincs adat erre a hónapra</div>`;
    _setIdoszakBtns(true); return;
  }
  const cmpHtml = await _osszehasonlitoBlokk('havi', from, to, `${ev}. ${HONAP_NEVEK[honap]}`, hA);

  let html = `<div class="r-head">${ev}. ${HONAP_NEVEK[honap]}${_filterBadges()}</div>${cmpHtml}`;
  if (getRiportSet('rekordok'))      html += _riportRekordok(hA);
  if (getRiportSet('kalendarNezet')) html += _riportKalendarNezet(hA);
  if (getRiportSet('teljes'))        html += teljesHtml(hA);
  if (getRiportSet('lineChart'))     html += _riportLineChart(hA);
  html += reszlegOsszesitoHtml(hA);
  if (getRiportSet('dolgRangsor'))   html += dolgRangsorHtml(hA);
  if (getRiportSet('barChart'))      html += _riportBarChart(hA);
  if (getRiportSet('anyagOssz'))     html += anyagOsszesitoHtml(hA);
  if (getRiportSet('napiAtlag'))     html += napiAtlagHtml(hA);
  if (getRiportSet('dolgNapiAtlag')) html += dolgNapiAtlagHtml(hA);
  if (getRiportSet('muszak'))        html += muszakHtml(hA);
  if (getRiportSet('dolgReszlet'))   html += dolgReszletHtml(hA);
  if (getRiportSet('anyagReszlet'))  html += anyagReszletHtml(hA);
  if (getRiportSet('napiBontas'))    html += napiBontasHtml(hA, false);
  E('idoszakosRiportDiv').innerHTML = html;
  _setIdoszakBtns(false);
}

/* ── Heti riport ── */
function _weekToRange(weekStr) {
  const [yr, wk] = weekStr.split('-W').map(Number);
  const jan4 = new Date(yr, 0, 4);
  const dow  = jan4.getDay() || 7; // 1=Hétfő…7=Vasárnap
  // Helyi dátum számítás (timezone-safe)
  const monD = new Date(yr, 0, jan4.getDate() - dow + 1 + (wk - 1) * 7);
  const sunD = new Date(yr, 0, jan4.getDate() - dow + 7 + (wk - 1) * 7);
  const fmt  = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  return { from: fmt(monD), to: fmt(sunD), yr, wk };
}

function _applyIdoszakosFilters(hA) {
  const rF  = E('idoszakosReszlegSzuro')?.value       || '';
  const dF  = E('idoszakosDolgozoSzuro')?.value       || '';
  const aF  = E('idoszakosAnyagSzuro')?.value         || '';
  const mF  = E('idoszakosMuszakSzuro')?.value        || '';
  const mvF = isMuszakVezeto()
    ? (state.userData?.displayName || '')
    : (E('idoszakosMuszakVezetoSzuro')?.value || '');
  if (rF) hA = hA.filter(a => (a.reszleg || '') === rF);
  if (dF) hA = hA.filter(a => (a.nev     || '') === dF);
  if (aF) hA = hA.filter(a => (a.anyag   || '') === aF);
  if (mF) hA = hA.filter(a => (a.ido     || '') === mF);
  if (mvF && !dF) {
    const csapat = state.muszakVezetokMap[mvF] || [];
    hA = hA.filter(a => csapat.includes(a.nev) || a.nev === mvF);
  }
  return hA;
}

function _filterBadges() {
  const mvF = E('idoszakosMuszakVezetoSzuro')?.value;
  return [
    E('idoszakosReszlegSzuro')?.value,
    E('idoszakosDolgozoSzuro')?.value,
    E('idoszakosAnyagSzuro')?.value,
    E('idoszakosMuszakSzuro')?.value,
    mvF ? `${mvF} csapata` : '',
  ].filter(Boolean).map(v => `<span class="r-shift">· ${esc(v)}</span>`).join('');
}

/* ── Időszak-összehasonlítás (előző azonos hosszú időszakkal) ── */
function _addNapok(dateStr, napok) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d + napok);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

function _elozoIdoszak(tipus, from, to) {
  switch (tipus) {
    case 'havi': {
      const [ev, honap1] = from.split('-').map(Number);
      const prevD  = new Date(ev, honap1 - 2, 1);
      const pEv = prevD.getFullYear(), pHonap = prevD.getMonth();
      const prefix = `${pEv}-${String(pHonap + 1).padStart(2, '0')}`;
      const lastDay = new Date(pEv, pHonap + 1, 0).getDate();
      return { from: `${prefix}-01`, to: `${prefix}-${String(lastDay).padStart(2, '0')}`,
               label: `${pEv}. ${HONAP_NEVEK[pHonap]}` };
    }
    case 'heti': {
      const pf = _addNapok(from, -7), pt = _addNapok(to, -7);
      return { from: pf, to: pt, label: `${fmtS(pf)} – ${fmtS(pt)}` };
    }
    case 'eves': {
      const pEv = parseInt(from.slice(0, 4), 10) - 1;
      return { from: `${pEv}-01-01`, to: `${pEv}-12-31`, label: `${pEv}. év` };
    }
    default: { // egyéni: ugyanolyan hosszú, közvetlenül megelőző időszak
      const [y1, m1, d1] = from.split('-').map(Number);
      const [y2, m2, d2] = to.split('-').map(Number);
      const napok = Math.round((new Date(y2, m2 - 1, d2) - new Date(y1, m1 - 1, d1)) / 86400000) + 1;
      const pTo   = _addNapok(from, -1);
      const pFrom = _addNapok(pTo, -(napok - 1));
      return { from: pFrom, to: pTo, label: `${fmtS(pFrom)} – ${fmtS(pTo)}` };
    }
  }
}

function _osszeg(entries) {
  return entries.reduce((s, a) => s + (a.sulyok || []).reduce((x, y) => x + y.suly, 0), 0);
}

function _csoportOsszeg(entries, kulcs) {
  const by = {};
  entries.forEach(a => {
    const k = (a[kulcs] || '').trim() || 'Ismeretlen';
    by[k] = (by[k] || 0) + (a.sulyok || []).reduce((s, x) => s + x.suly, 0);
  });
  return by;
}

function _deltaHtml(curr, prev) {
  if (!prev) return curr ? `<span style="color:var(--green);font-weight:600;">▲ új</span>` : `<span style="color:var(--text3);">–</span>`;
  const pct  = (curr - prev) / prev * 100;
  const szin = pct > 0.05 ? 'var(--green)' : (pct < -0.05 ? 'var(--red)' : 'var(--text3)');
  const nyil = pct > 0.05 ? '▲' : (pct < -0.05 ? '▼' : '–');
  return `<span style="color:${szin};font-weight:600;">${nyil} ${Math.abs(pct).toFixed(1)}%</span>`;
}

function _osszehasonlitoCsoportTbl(cim, ikon, currBy, prevBy) {
  const kulcsok = [...new Set([...Object.keys(currBy), ...Object.keys(prevBy)])]
    .sort((a, b) => (currBy[b] || 0) - (currBy[a] || 0));
  if (!kulcsok.length) return '';
  let h = `<p class="rs-group-lbl" style="margin-top:14px;">${ikon} ${esc(cim)} szerint</p><table class="stbl"><thead><tr><th>${esc(cim)}</th><th>Jelenlegi</th><th>Előző</th><th>Változás</th></tr></thead><tbody>`;
  kulcsok.forEach(k => {
    const c = currBy[k] || 0, p = prevBy[k] || 0;
    h += `<tr><td style="font-weight:600;">${esc(k)}</td><td class="v-bold">${fmtKg(c)}</td><td style="color:var(--text3);">${fmtKg(p)}</td><td>${_deltaHtml(c, p)}</td></tr>`;
  });
  return h + `</tbody></table>`;
}

function _osszehasonlitoHtml(curr, prev, currLabel, prevLabel) {
  const currOssz = _osszeg(curr), prevOssz = _osszeg(prev);
  const currNapok = new Set(curr.map(a => a.datum)).size || 1;
  const prevNapok = new Set(prev.map(a => a.datum)).size || 1;
  const currAtlag = currOssz / currNapok, prevAtlag = prevOssz / prevNapok;
  return `<div class="card" style="margin-bottom:12px;">
    <div class="card-title"><span class="card-title-icon">📊</span>Összevetés az előző időszakkal</div>
    <p style="color:var(--text3);font-size:12.5px;margin:-4px 0 12px;">Jelenlegi: <strong style="color:var(--text);">${esc(currLabel)}</strong> · Előző: <strong style="color:var(--text);">${esc(prevLabel)}</strong></p>
    <table class="stbl"><thead><tr><th>Megnevezés</th><th>Jelenlegi</th><th>Előző</th><th>Változás</th></tr></thead><tbody>
      <tr><td>Összesített termelés</td><td class="v-bold">${fmtKg(currOssz)}</td><td style="color:var(--text3);">${fmtKg(prevOssz)}</td><td>${_deltaHtml(currOssz, prevOssz)}</td></tr>
      <tr><td>Napi átlag</td><td class="v-bold">${fmtKg(currAtlag)}</td><td style="color:var(--text3);">${fmtKg(prevAtlag)}</td><td>${_deltaHtml(currAtlag, prevAtlag)}</td></tr>
    </tbody></table>
    ${_osszehasonlitoCsoportTbl('Részleg', '🏭', _csoportOsszeg(curr, 'reszleg'), _csoportOsszeg(prev, 'reszleg'))}
    ${_osszehasonlitoCsoportTbl('Anyagtípus', '📦', _csoportOsszeg(curr, 'anyag'), _csoportOsszeg(prev, 'anyag'))}
  </div>`;
}

async function _osszehasonlitoBlokk(tipus, from, to, currLabel, currEntries) {
  if (!E('idoszakosOsszehasonlitas')?.checked) return '';
  const prevRange = _elozoIdoszak(tipus, from, to);
  const prevA = _applyIdoszakosFilters(await fetchEntries({ datumFrom: prevRange.from, datumTo: prevRange.to }));
  return _osszehasonlitoHtml(currEntries, prevA, currLabel, prevRange.label);
}

export async function hetiRiport() {
  const raw = E('hetiHetInput').value;
  if (!raw) { msg('Válassz hetet!', 'error'); return; }
  const { from, to, yr, wk } = _weekToRange(raw);

  E('idoszakosRiportDiv').innerHTML = skelHtml('report');
  let hA = _applyIdoszakosFilters(await fetchEntries({ datumFrom: from, datumTo: to }));
  if (!hA.length) {
    E('idoszakosRiportDiv').innerHTML = `<div class="empty-st"><div class="empty-ic">📭</div>Nincs adat erre a hétre</div>`;
    _setIdoszakBtns(true); return;
  }
  const cmpHtml = await _osszehasonlitoBlokk('heti', from, to, `${yr}. ${wk}. hét · ${fmtS(from)} – ${fmtS(to)}`, hA);

  let html = `<div class="r-head">${yr}. ${wk}. hét · ${esc(fmtS(from))} – ${esc(fmtS(to))}${_filterBadges()}</div>${cmpHtml}`;
  if (getRiportSet('rekordok'))      html += _riportRekordok(hA);
  if (getRiportSet('kalendarNezet')) html += _riportKalendarNezet(hA);
  if (getRiportSet('teljes'))        html += teljesHtml(hA);
  if (getRiportSet('lineChart'))     html += _riportLineChart(hA);
  html += reszlegOsszesitoHtml(hA);
  if (getRiportSet('dolgRangsor'))   html += dolgRangsorHtml(hA);
  if (getRiportSet('barChart'))      html += _riportBarChart(hA);
  if (getRiportSet('anyagOssz'))     html += anyagOsszesitoHtml(hA);
  if (getRiportSet('napiAtlag'))     html += napiAtlagHtml(hA);
  if (getRiportSet('dolgNapiAtlag')) html += dolgNapiAtlagHtml(hA);
  if (getRiportSet('muszak'))        html += muszakHtml(hA);
  if (getRiportSet('dolgReszlet'))   html += dolgReszletHtml(hA);
  if (getRiportSet('anyagReszlet'))  html += anyagReszletHtml(hA);
  if (getRiportSet('napiBontas'))    html += napiBontasHtml(hA, false);
  E('idoszakosRiportDiv').innerHTML = html;
  _setIdoszakBtns(false);
}

/* ── Egyéni tartomány riport ── */
export async function egyeniRiport() {
  const from = E('egyeniTolInput').value;
  const to   = E('egyeniIgInput').value;
  if (!from || !to) { msg('Add meg a kezdő és záró dátumot!', 'error'); return; }
  if (from > to) { msg('A kezdő dátum nem lehet nagyobb a záró dátumnál!', 'error'); return; }

  E('idoszakosRiportDiv').innerHTML = skelHtml('report');
  let hA = _applyIdoszakosFilters(await fetchEntries({ datumFrom: from, datumTo: to }));
  if (!hA.length) {
    E('idoszakosRiportDiv').innerHTML = `<div class="empty-st"><div class="empty-ic">📭</div>Nincs adat a megadott időszakra</div>`;
    _setIdoszakBtns(true); return;
  }
  const cmpHtml = await _osszehasonlitoBlokk('egyeni', from, to, `${fmtS(from)} – ${fmtS(to)}`, hA);

  let html = `<div class="r-head">${esc(fmtS(from))} – ${esc(fmtS(to))}${_filterBadges()}</div>${cmpHtml}`;
  if (getRiportSet('rekordok'))      html += _riportRekordok(hA);
  if (getRiportSet('kalendarNezet')) html += _riportKalendarNezet(hA);
  if (getRiportSet('teljes'))        html += teljesHtml(hA);
  if (getRiportSet('lineChart'))     html += _riportLineChart(hA);
  html += reszlegOsszesitoHtml(hA);
  if (getRiportSet('dolgRangsor'))   html += dolgRangsorHtml(hA);
  if (getRiportSet('barChart'))      html += _riportBarChart(hA);
  if (getRiportSet('anyagOssz'))     html += anyagOsszesitoHtml(hA);
  if (getRiportSet('napiAtlag'))     html += napiAtlagHtml(hA);
  if (getRiportSet('dolgNapiAtlag')) html += dolgNapiAtlagHtml(hA);
  if (getRiportSet('muszak'))        html += muszakHtml(hA);
  if (getRiportSet('dolgReszlet'))   html += dolgReszletHtml(hA);
  if (getRiportSet('anyagReszlet'))  html += anyagReszletHtml(hA);
  if (getRiportSet('napiBontas'))    html += napiBontasHtml(hA, false);
  E('idoszakosRiportDiv').innerHTML = html;
  _setIdoszakBtns(false);
}

/* ── Éves riport ── */
export async function evesRiport() {
  const ev = parseInt(E('evesEvInput').value);
  if (!ev) { msg('Válassz évet!', 'error'); return; }
  const from = `${ev}-01-01`, to = `${ev}-12-31`;
  E('idoszakosRiportDiv').innerHTML = skelHtml('report');
  let hA = _applyIdoszakosFilters(await fetchEntries({ datumFrom: from, datumTo: to }));
  if (!hA.length) {
    E('idoszakosRiportDiv').innerHTML = `<div class="empty-st"><div class="empty-ic">📭</div>Nincs adat ${ev}. évre</div>`;
    _setIdoszakBtns(true); return;
  }
  const cmpHtml = await _osszehasonlitoBlokk('eves', from, to, `${ev}. év`, hA);

  let html = `<div class="r-head">${ev}. év${_filterBadges()}</div>${cmpHtml}`;
  if (getRiportSet('rekordok'))      html += _riportRekordok(hA);
  if (getRiportSet('kalendarNezet')) html += _riportKalendarNezet(hA);
  if (getRiportSet('teljes'))        html += teljesHtml(hA);
  if (getRiportSet('lineChart'))     html += _riportLineChart(hA);
  html += reszlegOsszesitoHtml(hA);
  if (getRiportSet('dolgRangsor'))   html += dolgRangsorHtml(hA);
  if (getRiportSet('barChart'))      html += _riportBarChart(hA);
  if (getRiportSet('anyagOssz'))     html += anyagOsszesitoHtml(hA);
  if (getRiportSet('napiAtlag'))     html += napiAtlagHtml(hA);
  if (getRiportSet('haviAtlag'))     html += haviAtlagHtml(hA);
  if (getRiportSet('dolgNapiAtlag')) html += dolgNapiAtlagHtml(hA);
  if (getRiportSet('muszak'))        html += muszakHtml(hA);
  if (getRiportSet('dolgReszlet'))   html += dolgReszletHtml(hA);
  if (getRiportSet('anyagReszlet'))  html += anyagReszletHtml(hA);
  if (getRiportSet('napiBontas'))    html += napiBontasHtml(hA, true);
  E('idoszakosRiportDiv').innerHTML = html;
  _setIdoszakBtns(false);
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
    logAction('dailyNote.delete', { datum, reszleg });
    napiRiport();
  } else if (ids) {
    const arr = ids.split(',');
    if (!confirm(`Biztosan törlöd a kijelölt ${arr.length} bejegyzést?`)) return;
    const batch = writeBatch(db);
    arr.forEach(id => batch.delete(doc(db, 'entries', id)));
    await batch.commit();
    logAction('entry.delete', { count: arr.length, datum });
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
    logAction('entry.delete_day', { datum: d, count: snap.docs.length });
    msg('Napi adatok törölve.');
    napiRiport();
  } catch (e) { msg('Törlési hiba: ' + e.message, 'error'); }
}

/* A megjelenített riport ".r-head" címéből képez fájlnevet (szanitizálva),
   hogy a mentett fájl neve mindig azt tükrözze, amit a felhasználó ténylegesen
   lát a képernyőn — nem kell külön időszak-leírást összeállítani hívásonként. */
function _reportFilename(el, fallbackLabel) {
  const raw  = el?.querySelector('.r-head')?.textContent || '';
  const name = raw.replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim();
  return (name || `${fallbackLabel} ${tod()}`).slice(0, 120);
}

/* ── Mentés képként ── */
export function napiKepMent()      { kepMentDiv('napiRiportDiv',      'Napi jelentés'); }
export function idoszakosKepMent() { kepMentDiv('idoszakosRiportDiv', 'Időszakos jelentés'); }

/* ── PDF export ── */
export async function napiPdfMent() {
  const el = E('napiRiportDiv');
  if (!el.children.length || el.querySelector('.empty-st')) { msg('Nincs riport a PDF-hez!', 'error'); return; }
  await _exportPdf(el, 'Napi jelentés');
}

export async function idoszakosPdfMent() {
  const el = E('idoszakosRiportDiv');
  if (!el.children.length || el.querySelector('.empty-st')) { msg('Nincs riport a PDF-hez!', 'error'); return; }
  await _exportPdf(el, 'Időszakos jelentés');
}

export function analitikaKepMent() { kepMentDiv('analitikaRiportDiv', 'Analitika'); }

export async function analitikaPdfMent() {
  const el = E('analitikaRiportDiv');
  if (!el.children.length || el.querySelector('.empty-st')) { msg('Nincs riport a PDF-hez!', 'error'); return; }
  await _exportPdf(el, 'Analitika');
}

// HTML <link> stíluslapok ideiglenes eltávolítása a DOM-ból.
// html2canvas document.cloneNode(true)-t hív, ezért a .disabled trükk nem elég —
// a linkeket teljesen ki kell venni, hogy a klónban se legyenek benne.
function _removeLinks() {
  const links = Array.from(document.head.querySelectorAll('link[rel="stylesheet"]'));
  links.forEach(l => l.remove());
  return links;
}
function _restoreLinks(links) { links.forEach(l => document.head.appendChild(l)); }

function _exportOverlay() {
  const ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#EFF2F7;display:flex;align-items:center;justify-content:center;font-size:15px;color:#475569;font-family:sans-serif;';
  ov.textContent = 'Generálás…';
  document.body.appendChild(ov);
  return ov;
}

async function _exportPdf(el, fallbackLabel) {
  if (!window.jspdf) { msg('jsPDF nem töltődött be!', 'error'); return; }
  msg('PDF generálás…', 'info', 7000);

  const filename = `${_reportFilename(el, fallbackLabel)}.pdf`;
  const { wrap, bg } = _buildWrap(el);
  document.body.appendChild(wrap);

  const ov    = _exportOverlay();
  const links = _removeLinks();
  try {
    const MARGIN  = 10;
    const { jsPDF } = window.jspdf;
    const pdf     = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const pdfW    = pdf.internal.pageSize.getWidth();
    const pdfH    = pdf.internal.pageSize.getHeight();
    const usableW = pdfW - MARGIN * 2;
    const usableH = pdfH - MARGIN * 2;
    const scale   = wrap.scrollHeight > 4000 ? 1.5 : 2;

    await Promise.all(Array.from(wrap.querySelectorAll('img')).map(img =>
      img.complete ? Promise.resolve() : new Promise(r => { img.onload = r; img.onerror = r; })
    ));
    const canvas = await html2canvas(wrap, { scale, useCORS: true, allowTaint: true, backgroundColor: bg });
    document.body.removeChild(wrap);

    const iw = canvas.width, ih = canvas.height;
    const imgH = ih * (usableW / iw);

    if (imgH <= usableH) {
      pdf.addImage(canvas.toDataURL('image/jpeg', 0.94), 'JPEG', MARGIN, MARGIN, usableW, imgH);
    } else {
      const pageHpx = Math.floor(iw * usableH / usableW);
      let sy = 0;
      while (sy < ih) {
        const sliceH = Math.min(pageHpx, ih - sy);
        const tmp = document.createElement('canvas');
        tmp.width = iw; tmp.height = sliceH;
        tmp.getContext('2d').drawImage(canvas, 0, sy, iw, sliceH, 0, 0, iw, sliceH);
        if (sy > 0) pdf.addPage();
        pdf.addImage(tmp.toDataURL('image/jpeg', 0.94), 'JPEG',
          MARGIN, MARGIN, usableW, sliceH * (usableW / iw));
        sy += pageHpx;
      }
    }
    pdf.save(filename);
    msg(`PDF mentve: ${filename}`);
  } catch (err) {
    if (document.body.contains(wrap)) document.body.removeChild(wrap);
    console.error('PDF export hiba:', err);
    msg('PDF hiba: ' + err.message, 'error');
  } finally {
    _restoreLinks(links);
    document.body.removeChild(ov);
  }
}

/* ── XLSX export ── */
export function idoszakosXlsxMent() {
  if (!window.XLSX) {
    msg('Az Excel könyvtár nem töltődött be — frissítsd az oldalt!', 'error', 5000);
    return;
  }
  const raw = E('idoszakosRiportDiv');
  if (!raw.children.length || raw.querySelector('.empty-st')) {
    msg('Nincs riport az exporthoz!', 'error'); return;
  }
  try {
    const wb     = window.XLSX.utils.book_new();
    const tables = raw.querySelectorAll('table.stbl');
    if (!tables.length) { msg('A riportban nincs exportálható táblázat.', 'error'); return; }

    const usedNames = new Set();
    tables.forEach((tbl, i) => {
      // Ha van előző testvér div (pl. dolgozó/anyag neve részletes szekciókban), azt használjuk
      const prevName  = tbl.previousElementSibling?.textContent?.replace(/[*?:/\\[\]]/g, '').trim();
      const cardName  = tbl.closest('.card')?.querySelector('.card-title')?.textContent?.replace(/[*?:/\\[\]]/g, '').trim();
      let name        = (prevName || cardName || `Lap ${i+1}`).slice(0, 31) || `Lap${i+1}`;
      // Egyedi lapnév: ha már létezik, számozzuk
      let finalName = name, counter = 2;
      while (usedNames.has(finalName)) finalName = `${name.slice(0, 28)} ${counter++}`;
      usedNames.add(finalName);
      window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.table_to_sheet(tbl), finalName);
    });

    const filename = `${_reportFilename(raw, 'Időszakos jelentés')}.xlsx`;
    const out  = window.XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    msg(`Excel mentve: ${filename}`);
  } catch (err) {
    msg('Excel hiba: ' + err.message, 'error', 6000);
    console.error('XLSX export error:', err);
  }
}

/* ── Nyomtatás ── */
export function napiNyomtat()      { nyomtatDiv('napiRiportDiv'); }
export function idoszakosNyomtat() { nyomtatDiv('idoszakosRiportDiv'); }

export function nyomtatDiv(divId) {
  const src = E(divId);
  if (!src.children.length || src.querySelector('.empty-st')) {
    msg('Nincs nyomtatható tartalom.', 'error'); return;
  }
  const clone = src.cloneNode(true);
  clone.querySelectorAll('.napi-ossz').forEach(x => x.remove());
  clone.querySelectorAll('.del-btn').forEach(x => x.remove());
  clone.querySelectorAll('.edit-btn').forEach(x => x.remove());
  clone.querySelectorAll('.dlink, .dtoggle').forEach(x => {
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
  hdr.innerHTML = `<span class="pf-brand">Plexiq – Termelési nyilvántartó</span><span class="pf-meta">Nyomtatva: ${esc(nyomtatva)}</span>`;
  pf.appendChild(hdr);
  pf.appendChild(clone);
  document.body.classList.add('is-printing');
  window.print();
}

window.addEventListener('afterprint', () => {
  document.body.classList.remove('is-printing');
  const pf = document.getElementById('print-frame');
  if (pf) pf.innerHTML = '';
});

/* ── Közös capture segédfüggvény (kép + PDF) ──
   Mindig light mode színekkel dolgozik, hogy sötét téma esetén
   is olvasható, nyomtatható legyen a kimenet.
   CSS változó override-ok a wrap ID-jára → az inline var() is helyes értéket kap. */
function _buildWrap(el) {
  // Fix light-mode értékek (tokens.css light változatából)
  const LM = {
    bg:'#EFF2F7', surf:'#FFFFFF', surf2:'#F8FAFC', surf3:'#EEF2F8',
    b:'#E2E8F0', b2:'#CBD5E1',
    t1:'#1E293B', t2:'#475569', t3:'#94A3B8',
    acc:'#1565C0', agl:'rgba(21,101,192,0.10)',
    green:'#2E7D32', greenl:'#E8F5E9',
    amber:'#E65100', amberl:'#FFF3E0',
    red:'#C62828', redl:'#FFEBEE'
  };
  // SVG attribútumokban és inline style-ban lévő var() hivatkozások cseréje
  // html2canvas nem tud CSS változókat feloldani SVG kontextusban
  const VAR_MAP = {
    '--bg': LM.bg, '--surf': LM.surf, '--surf2': LM.surf2, '--surf3': LM.surf3,
    '--border': LM.b, '--border2': LM.b2,
    '--text': LM.t1, '--text2': LM.t2, '--text3': LM.t3,
    '--accent': LM.acc, '--agl': LM.agl,
    '--green': LM.green, '--greenl': LM.greenl,
    '--amber': LM.amber, '--amberl': LM.amberl,
    '--red': LM.red, '--redl': LM.redl,
  };
  const resolveVars = s => s.replace(/var\((--[\w-]+)\)/g, (_, v) => VAR_MAP[v] || '#888');

  const clone = el.cloneNode(true);
  // Inline style var() cseréje
  clone.querySelectorAll('*').forEach(node => {
    if (node.style?.cssText) node.style.cssText = resolveVars(node.style.cssText);
  });
  // SVG elemeket data: URL képpé alakítjuk — html2canvas nem tud SVG CSS változókat feloldani
  clone.querySelectorAll('svg').forEach(svg => {
    try {
      const vb = (svg.getAttribute('viewBox') || '').split(/\s+/).map(Number);
      const svgW = vb[2] || 600;
      const svgH = vb[3] || 200;
      // Explicit width/height az SVG-n: különben height:auto = 0 az img kontextusban
      svg.setAttribute('width', svgW);
      svg.setAttribute('height', svgH);
      svg.style.cssText = '';   // töröljük a width:100%;overflow:visible amit html2canvas figyelmen kívül hagy
      let markup = new XMLSerializer().serializeToString(svg);
      markup = resolveVars(markup);
      const img = document.createElement('img');
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(markup);
      img.width  = svgW;   // HTML attribútum: html2canvas tudja a természetes méretet
      img.height = svgH;
      img.style.cssText = `display:block;max-width:100%;height:auto;`;
      svg.replaceWith(img);
    } catch (e) { /* eredeti SVG marad ha hiba van */ }
  });
  clone.querySelectorAll('.napi-ossz, .del-btn, .edit-btn').forEach(x => x.remove());
  clone.querySelectorAll('.dlink, .dtoggle').forEach(x => {
    const sp = document.createElement('span');
    sp.textContent = x.textContent;
    x.replaceWith(sp);
  });

  const wrap  = document.createElement('div');
  wrap.id = 'rExport';
  wrap.style.cssText = `position:absolute;left:-9999px;top:${window.scrollY}px;width:800px;font-family:'Source Sans 3','Segoe UI',sans-serif;font-size:15px;line-height:1.65;color:${LM.t1};background:${LM.bg};padding:28px 30px 34px;box-sizing:border-box;`;
  const inner = document.createElement('div');
  inner.style.cssText = `background:${LM.surf};border:1px solid ${LM.b};border-radius:11px;padding:22px 24px 26px;`;

  const style = document.createElement('style');
  // CSS változó override: a wrap-en belül minden var() light mode értékre oldódik fel
  const vars = `#rExport{--bg:${LM.bg};--surf:${LM.surf};--surf2:${LM.surf2};--surf3:${LM.surf3};--border:${LM.b};--border2:${LM.b2};--text:${LM.t1};--text2:${LM.t2};--text3:${LM.t3};--accent:${LM.acc};--agl:${LM.agl};--green:${LM.green};--greenl:${LM.greenl};--amber:${LM.amber};--amberl:${LM.amberl};--red:${LM.red};--redl:${LM.redl};--r:8px;--rsm:5px;--rlg:12px;}#rExport *{box-sizing:border-box;animation:none!important;transition:none!important;opacity:1!important;transform:none!important;}`;
  const css = `.r-head{font-family:'Lora',Georgia,serif;font-size:20px;font-weight:500;color:${LM.t1};margin-bottom:16px;padding-bottom:11px;border-bottom:2px solid ${LM.b2};display:flex;align-items:baseline;flex-wrap:wrap;}.r-shift{font-family:'Lora',Georgia,serif;font-size:20px;font-weight:400;font-style:italic;color:${LM.t2};margin-left:10px;}.reszleg-block{margin-bottom:12px;}.reszleg-hd{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:${LM.acc};padding:6px 0 5px;border-bottom:1px solid ${LM.b2};margin-bottom:7px;display:flex;align-items:center;gap:6px;}.reszleg-dot{width:7px;height:7px;border-radius:50%;background:${LM.acc};flex-shrink:0;}.muszak-block{margin-bottom:18px;}.muszak-hd{font-size:13px;font-weight:700;color:${LM.t1};background:${LM.surf2};border:1px solid ${LM.b};border-radius:7px;padding:7px 12px;margin-bottom:10px;display:flex;align-items:center;gap:7px;}.muszak-dot{width:8px;height:8px;border-radius:50%;background:${LM.acc};flex-shrink:0;}.worker-block{background:${LM.surf};border:1px solid ${LM.b};border-radius:7px;overflow:hidden;margin-bottom:10px;}.worker-hd{background:${LM.surf2};border-bottom:1px solid ${LM.b};padding:8px 14px;display:flex;align-items:center;gap:8px;}.worker-dot{width:7px;height:7px;border-radius:50%;background:${LM.acc};}.worker-nm{font-size:14px;font-weight:600;color:${LM.t1};}table.rt{width:100%;border-collapse:collapse;font-size:13px;}.rt th{text-align:left;color:${LM.t3};font-size:10.5px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;padding:7px 14px;border-bottom:1px solid ${LM.b};background:${LM.surf2};}.rt td{padding:9px 14px;border-bottom:1px solid ${LM.b};color:${LM.t2};vertical-align:top;}.rt tfoot td{padding:8px 14px;border-top:1px solid ${LM.b2};font-weight:600;font-size:12.5px;color:${LM.t1};background:${LM.surf3};}.v-teli{color:${LM.red};font-weight:600;}.v-kezdett{color:${LM.amber};font-weight:600;}.v-green{color:${LM.green};font-weight:600;}.v-bold{color:${LM.t1};font-weight:600;}.del-btn,.edit-btn,.napi-ossz{display:none!important;}.wnote{padding:8px 14px;border-top:1px solid ${LM.b};background:${LM.surf2};font-size:13px;color:${LM.t2};white-space:pre-wrap;}.day-note{margin-top:11px;padding:13px 15px;background:${LM.amberl};border:1px solid rgba(0,0,0,.1);border-radius:7px;font-size:13px;color:${LM.t2};white-space:pre-wrap;}.day-note-lbl{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:${LM.amber};margin-bottom:5px;}.nossz{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px;}.nossz-item{flex:1;min-width:100px;text-align:center;padding:10px 12px;background:${LM.surf};border:1px solid ${LM.b};border-radius:8px;}.nossz-val{font-size:18px;font-weight:700;color:${LM.t1};line-height:1.2;}.nossz-lbl{font-size:10px;color:${LM.t3};text-transform:uppercase;letter-spacing:.6px;margin-top:3px;}.sec-hd{font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:${LM.t3};border-bottom:1px dashed ${LM.b2};padding-bottom:7px;margin-bottom:14px;}.sec-hd span{color:${LM.acc};margin-right:5px;}.card{background:${LM.surf};border:1px solid ${LM.b};border-radius:11px;padding:18px 20px;margin-bottom:12px;}.card-title{font-size:14px;font-weight:700;color:${LM.acc};border-bottom:1px solid ${LM.b};padding-bottom:10px;margin-bottom:16px;}.stbl{width:100%;border-collapse:collapse;font-size:13px;}.stbl th{text-align:left;color:${LM.t3};font-size:10.5px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;padding:7px 13px;border-bottom:1px solid ${LM.b};background:${LM.surf2};}.stbl td{padding:9px 13px;border-bottom:1px solid ${LM.b};color:${LM.t2};}.stbl .tot td{font-weight:700;color:${LM.t1};border-top:2px solid ${LM.b2};background:${LM.surf3};font-size:12.5px;}`;
  const rcss = `.r-section{margin-bottom:22px;padding-bottom:18px;border-bottom:1px solid ${LM.b};}.r-section:last-child{border-bottom:none;}.r-sec-title{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.7px;color:${LM.t3};margin-bottom:12px;}.r-rekord-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;}.r-rekord-card{display:flex;align-items:center;gap:12px;background:${LM.surf2};border:1px solid ${LM.b};border-radius:8px;padding:14px 16px;}.r-rekord-icon{width:42px;height:42px;border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:19px;flex-shrink:0;}.r-rekord-label{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:${LM.t3};margin-bottom:3px;}.r-rekord-value{font-size:15px;font-weight:700;color:${LM.t1};line-height:1.2;margin-bottom:2px;}.r-rekord-sub{font-size:12px;color:${LM.t3};}`;
  const hfix = `#rExport .card{border-top:2px solid ${LM.b2}!important;}.rs-group-lbl{font-size:9.5px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:${LM.acc};margin:0 0 9px;padding-bottom:7px;border-bottom:1px solid ${LM.b};}`;
  style.textContent = vars + css + rcss + hfix;
  inner.appendChild(style); inner.appendChild(clone); wrap.appendChild(inner);
  return { wrap, bg: LM.bg };
}

function kepMentDiv(divId, fallbackLabel) {
  const filename = `${_reportFilename(E(divId), fallbackLabel)}.jpg`;
  const { wrap, bg } = _buildWrap(E(divId));
  document.body.appendChild(wrap);
  const ov    = _exportOverlay();
  const links = _removeLinks();
  const imgReady = Promise.all(Array.from(wrap.querySelectorAll('img')).map(img =>
    img.complete ? Promise.resolve() : new Promise(r => { img.onload = r; img.onerror = r; })
  ));
  imgReady
    .then(() => html2canvas(wrap, { backgroundColor: bg, scale: 2, useCORS: true, allowTaint: true }))
    .then(canvas => {
      _restoreLinks(links); document.body.removeChild(ov);
      document.body.removeChild(wrap);
      const a = document.createElement('a');
      a.download = filename;
      a.href = canvas.toDataURL('image/jpeg', .93);
      a.click();
      msg(`Kép mentve: ${filename}`);
    })
    .catch(err => {
      _restoreLinks(links); document.body.removeChild(ov);
      if (document.body.contains(wrap)) document.body.removeChild(wrap);
      console.error('Kép export hiba:', err);
      msg('Mentési hiba: ' + (err?.message || err), 'error');
    });
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
