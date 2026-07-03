import { fetchEntries, fillSel } from './db.js';
import { state } from './state.js';
import { E, esc, fmtKg, fmtS, skelHtml, tod, addD } from './utils.js';
import { analitikaKepMent, analitikaPdfMent } from './reports.js';

/* ── Vizuális összehasonlító elemzés (Jelentések → Analitika) ──
   Kattintható, egyszerű csempék; kattintásra a csempék alatt nyílik meg
   a nagyobb, részletes panel (dátum/kiválasztás + oszlopdiagram + táblázat).
   Csak termelési adatokra (entries) épül. Nem használ color-mix()-et
   sehol (html2canvas 1.4.1 nem tudja parse-olni), és minden SVG-nek
   explicit viewBox-a van, hogy a reports.js _buildWrap export-konverziója
   helyesen tudja méretezni. */

const PALETTE = ['#1565C0', '#2E7D32', '#E65100', '#8E24AA', '#C62828', '#00838F'];
const HU_DAYS = ['Hétfő', 'Kedd', 'Szerda', 'Csütörtök', 'Péntek', 'Szombat', 'Vasárnap'];

const WIDGETS = [
  { id: 'anyagok', icon: '📦', title: 'Anyagtípusok összehasonlítása', unit: 'anyagtípus', max: 5,
    keyFn: e => (e.anyag || '').trim(), listSrc: () => state.anyagok },
  { id: 'dolgozok', icon: '👤', title: 'Dolgozók összehasonlítása', unit: 'dolgozó', max: 6,
    keyFn: e => e.nev, listSrc: () => state.nevek.filter(n => !state.nevMetadata[n]?.archivalt) },
  { id: 'muszakok', icon: '🕐', title: 'Műszakok összehasonlítása', unit: 'műszak', max: 2,
    keyFn: e => (e.ido || '').trim() === 'Délután' ? 'Délután' : 'Délelőtt', listSrc: () => ['Délelőtt', 'Délután'] },
  { id: 'datum', icon: '📅', title: 'Dátum szerinti elemzés', kind: 'datum' },
];

let _panelKind   = null;
let _lastSeries  = null;
let _lastHeader  = null;

function _wdMeta(kind) { return WIDGETS.find(w => w.id === kind); }
function _kg(e) { return (e.sulyok || []).reduce((s, x) => s + x.suly, 0); }

function _totals(entries, keyFn) {
  const t = {};
  entries.forEach(e => {
    const k = keyFn(e); if (!k) return;
    const kg = _kg(e); if (kg <= 0) return;
    t[k] = (t[k] || 0) + kg;
  });
  return Object.entries(t).sort((a, b) => b[1] - a[1]);
}
function _topKeys(entries, keyFn, n) { return _totals(entries, keyFn).slice(0, n).map(([k]) => k); }

function _perDaySeries(entries, keyFn, keys) {
  const byKeyDay = {};
  entries.forEach(e => {
    const k = keyFn(e);
    if (!k || !keys.includes(k)) return;
    const kg = _kg(e); if (kg <= 0) return;
    (byKeyDay[k] ??= {})[e.datum] = (byKeyDay[k]?.[e.datum] || 0) + kg;
  });
  return keys.map(k => ({
    label: k,
    perDay: Object.entries(byKeyDay[k] || {})
      .map(([datum, kg]) => ({ datum, kg }))
      .sort((a, b) => a.datum.localeCompare(b.datum)),
  }));
}

/* ── Szövegszélesség mérés (canvas), hogy a hosszú nevek ne vágódjanak le feleslegesen ── */
let _measureCtx = null;
const _BAR_FONT = '11.5px "Source Sans 3", sans-serif';
function _textWidth(text, font = _BAR_FONT) {
  if (!_measureCtx) _measureCtx = document.createElement('canvas').getContext('2d');
  _measureCtx.font = font;
  return _measureCtx.measureText(text).width;
}
function _fitLabel(text, maxW, font = _BAR_FONT) {
  if (_textWidth(text, font) <= maxW) return text;
  let lbl = text;
  while (lbl.length > 1 && _textWidth(lbl + '…', font) > maxW) lbl = lbl.slice(0, -1);
  return lbl + '…';
}

/* ── Rangsoroló oszlopdiagram (reports.js _riportBarChart mintájára, egyedi színekkel) ──
   A bal oldali címke-sáv szélessége a leghosszabb névhez igazodik (mért szövegszélesség
   alapján, nem karakterszám-becsléssel), így a hosszú nevek nem vágódnak le feleslegesen. */
function _multiBarChart(series) {
  const totals = series.map((s, i) => ({
    label: s.label, kg: s.perDay.reduce((a, d) => a + d.kg, 0), color: PALETTE[i % PALETTE.length],
  })).sort((a, b) => b.kg - a.kg);
  if (!totals.length) return '';

  const maxKg = totals[0].kg || 1;
  const BAR_H = 28, GAP = 8, PR = 64, PT = 8;
  const W = 600;
  const MIN_PL = 70, MAX_PL = 260;
  const longestLabelW = Math.max(...totals.map(t => _textWidth(t.label)));
  const PL = Math.min(MAX_PL, Math.max(MIN_PL, Math.ceil(longestLabelW) + 18));
  const H = PT + totals.length * (BAR_H + GAP) + 4;

  const bars = totals.map((t, i) => {
    const y    = PT + i * (BAR_H + GAP);
    const barW = Math.max(2, Math.round((t.kg / maxKg) * (W - PL - PR)));
    const lbl  = _fitLabel(t.label, PL - 12);
    return `
      <text x="${PL - 8}" y="${y + BAR_H * 0.65}" font-size="11.5" text-anchor="end" fill="var(--text2)">${esc(lbl)}</text>
      <rect x="${PL}" y="${y}" width="${barW}" height="${BAR_H}" rx="4" fill="${t.color}" opacity=".85"/>
      <text x="${PL + barW + 6}" y="${y + BAR_H * 0.65}" font-size="11" fill="var(--text2)" style="font-weight:600">${(t.kg / 1000).toFixed(2)} t</text>`;
  }).join('');

  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;overflow:visible;">${bars}</svg>`;
}

function _rankTable(series) {
  const totals = series.map(s => ({ label: s.label, kg: s.perDay.reduce((a, d) => a + d.kg, 0) }))
    .sort((a, b) => b.kg - a.kg);
  if (!totals.length) return '';
  const total = totals.reduce((s, t) => s + t.kg, 0);
  let h = `<table class="stbl"><thead><tr><th>#</th><th>Megnevezés</th><th>Összesen</th><th>Arány</th></tr></thead><tbody>`;
  totals.forEach((t, i) => {
    const pct  = total > 0 ? (t.kg / total * 100).toFixed(1) : 0;
    const barW = Math.round(Math.min(parseFloat(pct), 100) * 0.8);
    h += `<tr><td style="color:var(--text3);width:28px;">${i + 1}.</td><td style="font-weight:600;">${esc(t.label)}</td><td class="v-bold">${fmtKg(t.kg)}</td><td><div style="display:flex;align-items:center;gap:8px;"><div style="height:6px;width:${barW}px;max-width:80px;background:var(--accent);border-radius:3px;opacity:.65;flex-shrink:0;"></div><span style="color:var(--text3);font-size:12px;">${pct}%</span></div></td></tr>`;
  });
  return h + `</tbody></table>`;
}

/* ── Naptár hőtérkép (reports.js _riportKalendarNezet mintájára, a kiválasztott
   időszakra igazítva, nem az adatból kikövetkeztetett min/max dátumra) ── */
function _calendarHeatmap(byDay, from, to) {
  const maxKg = Math.max(...Object.values(byDay), 1);
  const fmtLocal = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  const startD = new Date(from + 'T12:00:00');
  const dow0   = startD.getDay() || 7;
  startD.setDate(startD.getDate() - dow0 + 1); // Hétfőre igazítás
  const endD   = new Date(to + 'T12:00:00');

  const days = [];
  const cur  = new Date(startD);
  while (cur <= endD) { days.push(fmtLocal(cur)); cur.setDate(cur.getDate() + 1); }

  const CELL = 13, GAP = 2, ML = 22, MT = 18;
  const numWeeks = Math.ceil(days.length / 7);
  const W = ML + numWeeks * (CELL + GAP);
  const H = MT + 7 * (CELL + GAP) + 4;
  const MONTHS = ['Jan', 'Feb', 'Már', 'Ápr', 'Máj', 'Jún', 'Júl', 'Aug', 'Sze', 'Okt', 'Nov', 'Dec'];
  const DOWL   = ['H', 'K', 'Sz', 'Cs', 'P', 'Sz', 'V'];

  let lastMonth = -1;
  const monthLbls = [], cells = [];
  days.forEach((datum, i) => {
    const wk = Math.floor(i / 7), d = i % 7;
    const x  = ML + wk * (CELL + GAP), y = MT + d * (CELL + GAP);
    const mo = new Date(datum + 'T12:00:00').getMonth();
    if (d === 0 && mo !== lastMonth) {
      lastMonth = mo;
      monthLbls.push(`<text x="${x}" y="${MT - 4}" font-size="8.5" fill="var(--text3)">${MONTHS[mo]}</text>`);
    }
    const inRange = datum >= from && datum <= to;
    const kg    = byDay[datum] || 0;
    const alpha = kg > 0 ? (0.2 + (kg / maxKg) * 0.8).toFixed(2) : (inRange ? '0.07' : '0.02');
    const fill  = kg > 0 ? 'var(--accent)' : 'var(--border2)';
    const tip   = `${datum}: ${kg > 0 ? (kg / 1000).toFixed(2) + ' t' : 'Nincs adat'}`;
    cells.push(`<rect x="${x}" y="${y}" width="${CELL}" height="${CELL}" rx="2" fill="${fill}" opacity="${alpha}"><title>${esc(tip)}</title></rect>`);
  });

  const dayLbls = [0, 2, 4, 6].map(i =>
    `<text x="${ML - 3}" y="${MT + i * (CELL + GAP) + CELL * 0.78}" font-size="8" text-anchor="end" fill="var(--text3)">${DOWL[i]}</text>`
  ).join('');
  const legend = [0.07, 0.3, 0.5, 0.7, 1].map(a =>
    `<span style="display:inline-block;width:11px;height:11px;border-radius:2px;background:var(--accent);opacity:${a};flex-shrink:0;"></span>`
  ).join('');

  return `<div style="overflow-x:auto;-webkit-overflow-scrolling:touch;">
    <svg viewBox="0 0 ${W} ${H}" style="min-width:${Math.min(W, 300)}px;height:${H}px;display:block;">
      ${dayLbls}${monthLbls.join('')}${cells.join('')}
    </svg>
  </div>
  <div style="display:flex;align-items:center;gap:5px;margin-top:8px;font-size:11px;color:var(--text3);">
    Kevés ${legend} Sok
  </div>`;
}

/* ── Hét napjai szerinti átlag (nem összeg, hogy a tartományban esetlegesen
   eggyel több hétfő/kedd stb. ne torzítsa a képet) ── */
function _weekdayAverages(byDay, from, to) {
  const counts = new Array(7).fill(0), sums = new Array(7).fill(0);
  const cur = new Date(from + 'T12:00:00');
  const end = new Date(to + 'T12:00:00');
  while (cur <= end) {
    const iso = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}-${String(cur.getDate()).padStart(2, '0')}`;
    const dow = cur.getDay() || 7;
    counts[dow - 1]++;
    sums[dow - 1] += byDay[iso] || 0;
    cur.setDate(cur.getDate() + 1);
  }
  return HU_DAYS.map((name, i) => ({ name, avg: counts[i] ? sums[i] / counts[i] : 0 }));
}

function _weekdayRows(avgs) {
  const maxAvg = Math.max(...avgs.map(a => a.avg), 1);
  return avgs.map(a => {
    const pct = Math.round((a.avg / maxAvg) * 100);
    return `<div style="display:flex;align-items:center;gap:8px;padding:5px 0;">
      <span style="font-size:12.5px;color:var(--text2);width:82px;flex-shrink:0;">${esc(a.name)}</span>
      <div style="height:7px;background:var(--surf2);border-radius:3px;flex:1;overflow:hidden;">
        <div style="height:100%;width:${pct}%;background:var(--accent);border-radius:3px;opacity:.7;"></div>
      </div>
      <span style="font-size:12px;font-weight:600;width:60px;text-align:right;">${a.avg > 0 ? (a.avg / 1000).toFixed(2) + ' t' : '—'}</span>
    </div>`;
  }).join('');
}

function _bestWorstDay(byDay) {
  const list = Object.entries(byDay).filter(([, kg]) => kg > 0);
  if (!list.length) return '';
  const best  = list.reduce((a, b) => b[1] > a[1] ? b : a);
  const worst = list.reduce((a, b) => b[1] < a[1] ? b : a);
  return `<div class="nossz" style="margin-top:14px;">
    <div class="nossz-item"><div class="nossz-val">${(best[1] / 1000).toFixed(2)} t</div><div class="nossz-lbl">Legjobb nap · ${esc(fmtS(best[0]))}</div></div>
    <div class="nossz-item"><div class="nossz-val">${(worst[1] / 1000).toFixed(2)} t</div><div class="nossz-lbl">Leggyengébb nap · ${esc(fmtS(worst[0]))}</div></div>
  </div>`;
}

function _tile(w) {
  return `<div class="ana-tile dash-widget-clickable" data-wid="${w.id}">
    <span class="ana-tile-icon">${w.icon}</span>
    <span class="ana-tile-title">${esc(w.title)}</span>
  </div>`;
}

/* fillSel (db.js) mindig ábécérendbe rendez — a hét napjainál a kronológiai
   sorrend (Hétfő…Vasárnap) számít, azt nem szabad összekeverni. */
function _fillMultiSel(sel, list, noSort) {
  if (!sel) return;
  if (!noSort) { fillSel(sel, list); return; }
  const prev = Array.from(sel.selectedOptions).map(o => o.value);
  sel.innerHTML = list.map(item => `<option value="${esc(item)}"${prev.includes(item) ? ' selected' : ''}>${esc(item)}</option>`).join('');
}

/* ── Csempék (Jelentések → Analitika fül belépéskor) ── */
export function analitikaInitWidgets() {
  const cont = E('analitikaWidgets'); if (!cont) return;
  _closePanel();
  cont.innerHTML = WIDGETS.map(_tile).join('');
}

/* ── Részletes panel (kattintásra jelenik meg a kártyák alatt, saját dátum/kiválasztás) ── */
export async function analitikaShowPanel(kind) {
  const meta = _wdMeta(kind); if (!meta) return;
  _panelKind = kind;
  const panel = E('analitikaPanel'); if (!panel) return;

  document.querySelectorAll('#analitikaWidgets .dash-widget-clickable').forEach(w => {
    w.classList.toggle('active', w.dataset.wid === kind);
  });

  const defTo = tod(), defFrom = addD(defTo, -29);
  panel.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;">
      <span style="font-size:20px;">${meta.icon}</span>
      <div class="card-title" style="margin:0;flex:1;border:none;padding:0;">${esc(meta.title)}</div>
      <button class="btn btn-ghost btn-sq" id="anaPanelCloseBtn" title="Bezárás">✕</button>
    </div>
    <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end;margin-bottom:14px;">
      <div class="field" style="min-width:130px;"><label class="lbl">Tól</label><input type="date" id="anaDrTol" value="${defFrom}"></div>
      <div class="field" style="min-width:130px;"><label class="lbl">Ig</label><input type="date" id="anaDrIg" value="${defTo}"></div>
      <div style="display:flex;gap:5px;">
        <button class="btn btn-ghost btn-sm" data-anadr-preset="7">7 nap</button>
        <button class="btn btn-ghost btn-sm" data-anadr-preset="30">30 nap</button>
        <button class="btn btn-ghost btn-sm" data-anadr-preset="90">90 nap</button>
      </div>
    </div>
    ${meta.kind === 'datum' ? '' : `
    <div class="lbox" style="margin-bottom:12px;">
      <div class="lbox-t">${esc(meta.title)}</div>
      <p class="lhint">Ctrl+klik = több · üresen hagyva = top ${meta.max}</p>
      <select id="anaDrSel" multiple size="5" style="width:100%;"></select>
    </div>`}
    <button class="btn btn-primary btn-sm" id="anaDrRefreshBtn" style="margin-bottom:14px;">Frissítés</button>
    <div id="analitikaRiportDiv"></div>
    <div class="btn-row" style="margin-top:12px;">
      <button class="btn btn-ghost" style="flex:1;" id="analitikaKepMentBtn" disabled>⬇ Kép</button>
      <button class="btn btn-ghost" id="analitikaPdfBtn" disabled>⬇ PDF</button>
    </div>`;
  if (meta.kind !== 'datum') _fillMultiSel(E('anaDrSel'), meta.listSrc(), meta.noSort);

  panel.style.display = '';
  panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  await _renderPanelResult();
}

function _closePanel() {
  E('analitikaPanel').style.display = 'none';
  document.querySelectorAll('#analitikaWidgets .dash-widget-clickable').forEach(w => w.classList.remove('active'));
  _panelKind = null;
}

function _setBtns(disabled) {
  ['analitikaKepMentBtn', 'analitikaPdfBtn'].forEach(id => { const el = E(id); if (el) el.disabled = disabled; });
}

async function _renderPanelResult() {
  const meta = _wdMeta(_panelKind); if (!meta) return;
  const from = E('anaDrTol')?.value, to = E('anaDrIg')?.value;
  const out  = E('analitikaRiportDiv'); if (!out) return;

  if (!from || !to || from > to) {
    out.innerHTML = `<div class="empty-st"><div class="empty-ic">⚠️</div><div class="empty-title">Érvénytelen időszak</div></div>`;
    _lastSeries = null; _setBtns(true); return;
  }

  out.innerHTML = skelHtml('report');
  _setBtns(true);

  const entries = await fetchEntries({ datumFrom: from, datumTo: to }).catch(() => []);
  if (!entries.length) {
    out.innerHTML = `<div class="empty-st"><div class="empty-ic">📭</div>Nincs adat a kiválasztott időszakra</div>`;
    _lastSeries = null; _setBtns(true); return;
  }

  if (meta.kind === 'datum') {
    const byDay = {};
    entries.forEach(e => { byDay[e.datum] = (byDay[e.datum] || 0) + _kg(e); });
    _lastHeader = { title: meta.title, from, to };
    out.innerHTML = `<div class="r-head" style="font-size:16px;">${esc(meta.title)} · ${esc(from)} – ${esc(to)}</div>
      <div class="r-section"><div class="r-sec-title">🗓 Naptár nézet</div>${_calendarHeatmap(byDay, from, to)}</div>
      <div class="r-section"><div class="r-sec-title">📊 Átlag napi termelés, hét napja szerint</div>${_weekdayRows(_weekdayAverages(byDay, from, to))}</div>
      ${_bestWorstDay(byDay)}`;
    _setBtns(false);
    return;
  }

  const sel  = Array.from(E('anaDrSel')?.selectedOptions || []).map(o => o.value).filter(Boolean);
  const keys = sel.length ? sel.slice(0, meta.max) : _topKeys(entries, meta.keyFn, meta.max);
  _lastSeries = _perDaySeries(entries, meta.keyFn, keys);
  _lastHeader = { title: meta.title, from, to };
  _renderResultBody();
  _setBtns(false);
}

function _renderResultBody() {
  const out = E('analitikaRiportDiv'); if (!out || !_lastSeries) return;
  const series = _lastSeries;
  const chart  = series.length ? _multiBarChart(series) : '';

  out.innerHTML = `<div class="r-head" style="font-size:16px;">${esc(_lastHeader.title)} · ${esc(_lastHeader.from)} – ${esc(_lastHeader.to)}</div>` + (
    series.length
      ? chart + _rankTable(series)
      : `<div class="empty-st"><div class="empty-ic">📭</div>Nincs megjeleníthető adat</div>`
  );
}

/* ── Panel belsejének eseménydelegálása (a tartalom többször újraépül) ── */
export function analitikaPanelClick(e) {
  if (e.target.closest('#anaPanelCloseBtn')) { _closePanel(); return; }
  const presetBtn = e.target.closest('[data-anadr-preset]');
  if (presetBtn) {
    const days = Number(presetBtn.dataset.anadrPreset);
    E('anaDrIg').value  = tod();
    E('anaDrTol').value = addD(tod(), -(days - 1));
    return;
  }
  if (e.target.closest('#anaDrRefreshBtn'))      { _renderPanelResult(); return; }
  if (e.target.closest('#analitikaKepMentBtn'))  { analitikaKepMent(); return; }
  if (e.target.closest('#analitikaPdfBtn'))      { analitikaPdfMent(); return; }
}
