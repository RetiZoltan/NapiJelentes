import { fetchEntries, fillSel, getWorkerMaterials } from './db.js';
import { state, isMuszakVezeto } from './state.js';
import { E, esc, fmtKg, fmtS, skelHtml, tod, addD } from './utils.js';
import { analitikaKepMent, analitikaPdfMent, nyomtatDiv } from './reports.js';
import { _sparkline, _card } from './dashboard.js';

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
    keyFn: e => {
      const anyag = (e.anyag || '').trim();
      return _getSettings().anyagCsoport ? (state.anyagCsoportMap[anyag] || 'Egyéb csoport') : anyag;
    },
    listSrc: () => _getSettings().anyagCsoport ? state.anyagCsoportok : state.anyagok,
    filterFn: (e, s) => !s.reszlegSzuro || (e.reszleg || '').trim() === s.reszlegSzuro },
  { id: 'dolgozok', icon: '👤', title: 'Dolgozók összehasonlítása', unit: 'dolgozó', max: 6,
    keyFn: e => e.nev,
    listSrc: () => state.nevek.filter(n => _getSettings().archivalt || !state.nevMetadata[n]?.archivalt),
    filterFn: (e, s) => {
      if (!s.archivalt && state.nevMetadata[e.nev]?.archivalt) return false;
      if (s.reszlegSzuro && (e.reszleg || '').trim() !== s.reszlegSzuro) return false;
      if (s.csapatSzuro) {
        const csapat = state.muszakVezetokMap[s.csapatSzuro] || [];
        if (e.nev !== s.csapatSzuro && !csapat.includes(e.nev)) return false;
      }
      if (s.dolgozokAnyagSzuro && (e.anyag || '').trim() !== s.dolgozokAnyagSzuro) return false;
      return true;
    } },
  { id: 'muszakok', icon: '🕐', title: 'Műszakok összehasonlítása', unit: 'műszak', max: 2,
    keyFn: e => (e.ido || '').trim() === 'Délután' ? 'Délután' : 'Délelőtt', listSrc: () => ['Délelőtt', 'Délután'] },
  { id: 'csapatok', icon: '👥', title: 'Csapatok összehasonlítása', unit: 'csapat', max: 8,
    visible: () => Object.keys(state.muszakVezetokMap).length > 0,
    keyFn: _csapatKeyFn, listSrc: () => Object.keys(state.muszakVezetokMap).map(v => `${v} csapata`) },
  { id: 'reszlegek', icon: '🏭', title: 'Részlegek összehasonlítása', unit: 'részleg', max: 8,
    keyFn: e => (e.reszleg || '').trim(), listSrc: () => state.reszlegek },
  { id: 'anyagspec', icon: '🧩', title: 'Anyag-specializáció mátrix', kind: 'matrix' },
  { id: 'anyagkereso', icon: '🔍', title: 'Anyag kereső', kind: 'search' },
  { id: 'datum', icon: '📅', title: 'Dátum szerinti elemzés', kind: 'datum' },
  { id: 'atlagmedian', icon: '📐', title: 'Átlag / Medián', kind: 'atlagmedian' },
  { id: 'rekordok', icon: '🏆', title: 'Rekordok', kind: 'rekordok' },
  { id: 'csapatreszletes', icon: '👑', title: 'Csapat részletei', kind: 'csapatreszletes',
    visible: () => Object.keys(state.muszakVezetokMap).length > 0 },
  { id: 'egyeni', icon: '🔬', title: 'Egyéni elemzés', kind: 'egyeni' },
  { id: 'attekinto', icon: '⚡', title: 'Gyors áttekintő', kind: 'attekinto' },
];

/* A dolgozó nevéből visszakeresi, melyik műszakvezető csapatához tartozik
   (a vezető saját bejegyzései is a saját csapatához számítanak). */
function _csapatKeyFn(e) {
  for (const [vezeto, csapat] of Object.entries(state.muszakVezetokMap)) {
    if (e.nev === vezeto || (csapat || []).includes(e.nev)) return `${vezeto} csapata`;
  }
  return null;
}

let _panelKind   = null;
let _lastSeries  = null;
let _lastHeader  = null;
let _lastEntries = null;
let _lastByDay   = null;
let _expandedLabel = null;      // melyik táblázatsor napi trendje van kinyitva
let _attekintoCache = null;     // Gyors áttekintő: egyszer lekérdezett/összesített adatok
let _attekintoExpanded = null;  // Gyors áttekintő: melyik mini-kártya van helyben kibontva
let _searchDebounceT = null;    // anyag kereső élő szűrésének debounce timere
let _amSearchDebounceT = null;  // átlag/medián anyag-egyesítő szűrő debounce timere

/* Előző időszak összevetéséhez: a nyers (szűretlen) bejegyzéseket dátumtartomány
   szerint gyorsítótárazzuk, hogy a beállítások (Top N, szűrők stb.) váltása
   ne indítson újra hálózati lekérdezést — csak új tartományváltásnál. */
let _lastPrevEntriesRaw = null;
let _lastPrevRangeKey   = null;
let _lastPrevMap        = null; // { map: {label: kg}, label: "előző időszak felirata" }

/* ── Beállítások (közösek + csempe-specifikusak) —
   localStorage-ban perzisztálva. */
const _SET_KEY = 'nj_ana_settings';
const _SET_DEFAULTS = {
  topN: '', sortBy: 'kg', unit: 't', showOther: false, compareEnabled: false, // közös
  reszlegSzuro: '', csapatSzuro: '',                     // anyagok + dolgozók
  anyagCsoport: false,                                   // csak anyagok
  archivalt: false, dolgozokAnyagSzuro: '',               // csak dolgozók
  muszakMode: 'osszeg', muszakDolgozonkent: false,        // csak műszakok: 'osszeg' | 'atlag', dolgozónkénti bontás
  sajatCsapat: false,                                    // csak csapatok (műszakvezetőknek)
  hetiBontas: false,                                     // csak dátum szerinti elemzés
  napSorrend: 'kronologikus',                            // csak dátum szerinti elemzés: 'kronologikus' | 'rangsor'
  defaultRangeDays: 30,                                  // globális: alapértelmezett időszak megnyitáskor
  matrixDolgN: '8', matrixAnyagN: '6',                    // csak anyag-specializáció mátrix
  searchMode: 'reszletes', searchSortBy: 'datum', searchUnit: 't', // csak anyag kereső
  searchShowDatum: true, searchShowDolgozo: true, searchShowReszleg: true,
  amViewMode: 'mindket', amSortBy: 'nev', amUnit: 'kg',            // csak átlag/medián
  amFilterOutliers: true, amShowRawVsFiltered: false, amShowMinMax: true, amShowTrend: true,
};
function _getSettings() {
  try { return { ..._SET_DEFAULTS, ...JSON.parse(localStorage.getItem(_SET_KEY) || '{}') }; }
  catch { return { ..._SET_DEFAULTS }; }
}
function _saveSettings(patch) {
  try { localStorage.setItem(_SET_KEY, JSON.stringify({ ..._getSettings(), ...patch })); } catch {}
}
function _fmtUnitPlain(kg, unit) { return unit === 'kg' ? `${Math.round(kg)} kg` : `${(kg / 1000).toFixed(2)} t`; }
function _fmtUnitHtml(kg, unit)  { return unit === 'kg' ? fmtKg(kg) : (kg > 0 ? `${(kg / 1000).toFixed(2)} t` : '—'); }

function _wdMeta(kind) { return WIDGETS.find(w => w.id === kind); }
/* 'datum', 'matrix' és 'search' saját, egyedi nézettel rendelkezik — nincs
   entitás-választó és nem a közös Top N/rendezés/mértékegység beállítás-blokkot
   használja. */
function _hasPicker(meta) { return !meta.kind; }
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

function average(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0; }
function median(arr) {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
function _percentile(sorted, p) {
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}
/* IQR-alapú kiugró-szűrés: a Q1-1.5·IQR .. Q3+1.5·IQR tartományon kívüli
   értékek kimaradnak. 4 elemnél kevesebbnél nincs értelme szűrni. */
function _iqrFilter(values) {
  if (values.length < 4) return values;
  const sorted = [...values].sort((a, b) => a - b);
  const q1 = _percentile(sorted, 25), q3 = _percentile(sorted, 75);
  const iqr = q3 - q1;
  const lo = q1 - 1.5 * iqr, hi = q3 + 1.5 * iqr;
  return values.filter(v => v >= lo && v <= hi);
}
function _filteredStats(values) {
  const filtered = _iqrFilter(values);
  const stats = arr => ({ avg: average(arr), med: median(arr), min: arr.length ? Math.min(...arr) : 0, max: arr.length ? Math.max(...arr) : 0, n: arr.length });
  return { raw: stats(values), filtered: stats(filtered), wasFiltered: filtered.length !== values.length };
}

/* ── Előző időszak (reports.js _elozoIdoszak "egyéni" ágának mintájára) —
   ugyanolyan hosszú, közvetlenül megelőző időszak. ── */
function _prevPeriod(from, to) {
  const [y1, m1, d1] = from.split('-').map(Number);
  const [y2, m2, d2] = to.split('-').map(Number);
  const napok = Math.round((new Date(y2, m2 - 1, d2) - new Date(y1, m1 - 1, d1)) / 86400000) + 1;
  const pTo   = addD(from, -1);
  const pFrom = addD(pTo, -(napok - 1));
  return { from: pFrom, to: pTo, label: `${fmtS(pFrom)} – ${fmtS(pTo)}` };
}

/* reports.js _deltaHtml mintájára — ▲/▼ jelzés %-os változással. */
function _deltaBadge(curr, prev) {
  if (!prev) return curr > 0 ? `<span style="color:var(--green);font-weight:600;font-size:11.5px;">▲ új</span>` : `<span style="color:var(--text3);font-size:11.5px;">–</span>`;
  const pct   = (curr - prev) / prev * 100;
  const color = pct > 0.05 ? 'var(--green)' : (pct < -0.05 ? 'var(--red)' : 'var(--text3)');
  const arrow = pct > 0.05 ? '▲' : (pct < -0.05 ? '▼' : '–');
  return `<span style="color:${color};font-weight:600;font-size:11.5px;">${arrow} ${Math.abs(pct).toFixed(1)}%</span>`;
}

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

/* ── Rendezett összesítés — az "Egyéb" (ha van) mindig a lista végére kerül,
   a többi elem a beállított sorrend (mennyiség vagy név) szerint rendeződik. */
function _orderedTotals(series, sortBy, avgMode) {
  const rows = series.map((s, i) => {
    const total = s.perDay.reduce((a, d) => a + d.kg, 0);
    return {
      label: s.label, kg: avgMode && s.perDay.length ? total / s.perDay.length : total,
      color: s.label === 'Egyéb' ? 'var(--text3)' : PALETTE[i % PALETTE.length],
      isOther: s.label === 'Egyéb',
    };
  });
  const main  = rows.filter(r => !r.isOther);
  const other = rows.filter(r => r.isOther);
  main.sort(sortBy === 'nev' ? (a, b) => a.label.localeCompare(b.label, 'hu') : (a, b) => b.kg - a.kg);
  return [...main, ...other];
}

/* ── Rangsoroló oszlopdiagram (reports.js _riportBarChart mintájára, egyedi színekkel) ──
   A bal oldali címke-sáv szélessége a leghosszabb névhez igazodik (mért szövegszélesség
   alapján, nem karakterszám-becsléssel), így a hosszú nevek nem vágódnak le feleslegesen. */
function _multiBarChart(series, opts = {}) {
  const totals = _orderedTotals(series, opts.sortBy, opts.avgMode);
  if (!totals.length) return '';

  const maxKg = Math.max(...totals.map(t => t.kg), 1);
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
      <text x="${PL + barW + 6}" y="${y + BAR_H * 0.65}" font-size="11" fill="var(--text2)" style="font-weight:600">${_fmtUnitPlain(t.kg, opts.unit)}</text>`;
  }).join('');

  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;overflow:visible;">${bars}</svg>`;
}

function _rankTable(series, opts = {}) {
  const totals = _orderedTotals(series, opts.sortBy, opts.avgMode);
  if (!totals.length) return '';
  const total = totals.reduce((s, t) => s + t.kg, 0);
  const perDayByLabel = Object.fromEntries(series.map(s => [s.label, s.perDay]));
  const showCompare = !!opts.prevMap;
  const colspan = showCompare ? 5 : 4;

  let h = `<table class="stbl"><thead><tr><th>#</th><th>Megnevezés</th><th>${opts.avgMode ? 'Napi átlag' : 'Összesen'}</th><th>Arány</th>${showCompare ? '<th>Változás</th>' : ''}</tr></thead><tbody>`;
  totals.forEach((t, i) => {
    const pct  = total > 0 ? (t.kg / total * 100).toFixed(1) : 0;
    const barW = Math.round(Math.min(parseFloat(pct), 100) * 0.8);
    const compareCell = showCompare
      ? `<td>${t.isOther ? '<span style="color:var(--text3);">–</span>' : _deltaBadge(t.kg, opts.prevMap.map[t.label])}</td>`
      : '';
    h += `<tr class="ana-row" data-label="${esc(t.label)}" style="cursor:pointer;" title="Kattints a napi trendhez"><td style="color:var(--text3);width:28px;">${t.isOther ? '' : i + 1 + '.'}</td><td style="font-weight:600;${t.isOther ? 'color:var(--text3);font-style:italic;' : ''}">${esc(t.label)}</td><td class="v-bold">${_fmtUnitHtml(t.kg, opts.unit)}</td><td><div style="display:flex;align-items:center;gap:8px;"><div style="height:6px;width:${barW}px;max-width:80px;background:${t.isOther ? 'var(--text3)' : 'var(--accent)'};border-radius:3px;opacity:.65;flex-shrink:0;"></div><span style="color:var(--text3);font-size:12px;">${pct}%</span></div></td>${compareCell}</tr>`;

    if (_expandedLabel === t.label) {
      const perDay = perDayByLabel[t.label] || [];
      h += `<tr><td colspan="${colspan}" style="padding:10px 14px;background:var(--surf2);">
        ${perDay.length >= 2 ? _sparkline(perDay, 50) : '<p style="color:var(--text3);font-size:12px;margin:0;">Nincs elég adat a napi trendhez (legalább 2 nap szükséges).</p>'}
      </td></tr>`;
    }
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

function _weekdayRows(avgs, labelWidth = 82) {
  const maxAvg = Math.max(...avgs.map(a => a.avg), 1);
  return avgs.map(a => {
    const pct = Math.round((a.avg / maxAvg) * 100);
    return `<div style="display:flex;align-items:center;gap:8px;padding:5px 0;">
      <span style="font-size:12.5px;color:var(--text2);width:${labelWidth}px;flex-shrink:0;">${esc(a.name)}</span>
      <div style="height:7px;background:var(--surf2);border-radius:3px;flex:1;overflow:hidden;">
        <div style="height:100%;width:${pct}%;background:var(--accent);border-radius:3px;opacity:.7;"></div>
      </div>
      <span style="font-size:12px;font-weight:600;width:60px;text-align:right;">${a.avg > 0 ? (a.avg / 1000).toFixed(2) + ' t' : '—'}</span>
    </div>`;
  }).join('');
}

/* ── Heti bontás — hétfőtől induló 7-napos blokkok összesített termelése ── */
function _weeklyBuckets(byDay, from, to) {
  const fmtLocal = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const startD = new Date(from + 'T12:00:00');
  const dow0   = startD.getDay() || 7;
  startD.setDate(startD.getDate() - dow0 + 1);
  const endD = new Date(to + 'T12:00:00');

  const weeks = [];
  const cur = new Date(startD);
  while (cur <= endD) {
    const weekStart = new Date(cur);
    let kg = 0;
    for (let i = 0; i < 7; i++) {
      const d = new Date(cur); d.setDate(d.getDate() + i);
      kg += byDay[fmtLocal(d)] || 0;
    }
    const weekEnd = new Date(cur); weekEnd.setDate(weekEnd.getDate() + 6);
    weeks.push({ name: `${fmtS(fmtLocal(weekStart))} – ${fmtS(fmtLocal(weekEnd))}`, avg: kg });
    cur.setDate(cur.getDate() + 7);
  }
  return weeks;
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

/* ── Beállítás-blokk: közös mezők + csempénkénti extra mezők ── */
function _settingsBlockHtml(meta) {
  const s = _getSettings();
  const opt = (val, cur, label) => `<option value="${val}"${cur === val ? ' selected' : ''}>${label}</option>`;
  const reszlegOpts = ['<option value="">— Mind —</option>', ...[...state.reszlegek].sort((a, b) => a.localeCompare(b, 'hu'))
    .map(r => `<option value="${esc(r)}"${s.reszlegSzuro === r ? ' selected' : ''}>${esc(r)}</option>`)].join('');
  const csapatVezetok = Object.keys(state.muszakVezetokMap).sort((a, b) => a.localeCompare(b, 'hu'));
  const csapatOpts = ['<option value="">— Mind —</option>', ...csapatVezetok
    .map(v => `<option value="${esc(v)}"${s.csapatSzuro === v ? ' selected' : ''}>${esc(v)} csapata</option>`)].join('');

  let extra = '';
  if (meta.id === 'anyagok') {
    extra = `
      <div class="field">
        <label class="lbl">Részleg szerint</label>
        <select id="anaSetReszleg">${reszlegOpts}</select>
      </div>
      <div class="field" style="margin-bottom:9px;">
        <label class="rs-lbl"><input type="checkbox" id="anaSetAnyagCsoport"${s.anyagCsoport ? ' checked' : ''}> Csoportosítás anyagcsoport szerint</label>
      </div>`;
  } else if (meta.id === 'dolgozok') {
    const anyagOpts = ['<option value="">— Mind —</option>', ...[...state.anyagok].sort((a, b) => a.localeCompare(b, 'hu'))
      .map(a => `<option value="${esc(a)}"${s.dolgozokAnyagSzuro === a ? ' selected' : ''}>${esc(a)}</option>`)].join('');
    extra = `
      <div class="field">
        <label class="lbl">Részleg szerint</label>
        <select id="anaSetReszleg">${reszlegOpts}</select>
      </div>
      ${csapatVezetok.length ? `
      <div class="field">
        <label class="lbl">Csapat szerint</label>
        <select id="anaSetCsapat">${csapatOpts}</select>
      </div>` : ''}
      <div class="field">
        <label class="lbl">Csak egy anyag (összevetéshez)</label>
        <select id="anaSetDolgozokAnyag">${anyagOpts}</select>
      </div>
      <div class="field" style="margin-bottom:9px;">
        <label class="rs-lbl"><input type="checkbox" id="anaSetArchivalt"${s.archivalt ? ' checked' : ''}> Archivált dolgozók is</label>
      </div>`;
  } else if (meta.id === 'muszakok') {
    extra = `
      <div class="field">
        <label class="lbl">Megjelenítés</label>
        <select id="anaSetMuszakMode">
          ${opt('osszeg', s.muszakMode, 'Összesen')}${opt('atlag', s.muszakMode, 'Napi átlag (aktív napokra)')}
        </select>
      </div>
      <div class="field" style="margin-bottom:9px;">
        <label class="rs-lbl"><input type="checkbox" id="anaSetMuszakDolgozonkent"${s.muszakDolgozonkent ? ' checked' : ''}> Dolgozónkénti bontás (melyik műszakban jobb ki)</label>
      </div>`;
  } else if (meta.id === 'csapatok' && isMuszakVezeto()) {
    extra = `
      <div class="field" style="margin-bottom:9px;">
        <label class="rs-lbl"><input type="checkbox" id="anaSetSajatCsapat"${s.sajatCsapat ? ' checked' : ''}> Csak a saját csapatom (${esc(state.userData?.displayName || '')})</label>
      </div>`;
  } else if (meta.kind === 'datum') {
    extra = `
      <div class="field">
        <label class="lbl">Hét napjai sorrend</label>
        <select id="anaSetNapSorrend">
          ${opt('kronologikus', s.napSorrend, 'Kronologikus (Hétfő→Vasárnap)')}${opt('rangsor', s.napSorrend, 'Rangsor szerint')}
        </select>
      </div>
      <div class="field" style="margin-bottom:9px;">
        <label class="rs-lbl"><input type="checkbox" id="anaSetHetiBontas"${s.hetiBontas ? ' checked' : ''}> Heti bontás nézet</label>
      </div>`;
  } else if (meta.kind === 'matrix') {
    extra = `
      <div class="field">
        <label class="lbl">Dolgozók száma (sorok)</label>
        <select id="anaSetMatrixDolgN">
          ${opt('5', s.matrixDolgN, 'Top 5')}${opt('8', s.matrixDolgN, 'Top 8')}${opt('12', s.matrixDolgN, 'Top 12')}${opt('all', s.matrixDolgN, 'Mind')}
        </select>
      </div>
      <div class="field">
        <label class="lbl">Anyagok száma (oszlopok)</label>
        <select id="anaSetMatrixAnyagN">
          ${opt('3', s.matrixAnyagN, 'Top 3')}${opt('6', s.matrixAnyagN, 'Top 6')}${opt('9', s.matrixAnyagN, 'Top 9')}${opt('all', s.matrixAnyagN, 'Mind')}
        </select>
      </div>`;
  } else if (meta.kind === 'search') {
    extra = `
      <div class="field">
        <label class="lbl">Nézet</label>
        <select id="anaSetSearchMode">
          ${opt('reszletes', s.searchMode, 'Részletes lista')}${opt('osszesitve', s.searchMode, 'Anyagonként összesítve')}
        </select>
      </div>
      <div class="field">
        <label class="lbl">Rendezés</label>
        <select id="anaSetSearchSort">
          ${opt('datum', s.searchSortBy, 'Dátum szerint')}${opt('suly', s.searchSortBy, 'Súly szerint')}${opt('anyag', s.searchSortBy, 'Anyag szerint (ABC)')}
        </select>
      </div>
      <div class="field">
        <label class="lbl">Mértékegység</label>
        <select id="anaSetSearchUnit">
          ${opt('t', s.searchUnit, 'Tonna')}${opt('kg', s.searchUnit, 'Kilogramm')}
        </select>
      </div>
      <div class="field" style="margin-bottom:9px;">
        <label class="rs-lbl"><input type="checkbox" id="anaSetSearchDatum"${s.searchShowDatum ? ' checked' : ''}> Dátum oszlop</label>
      </div>
      <div class="field" style="margin-bottom:9px;">
        <label class="rs-lbl"><input type="checkbox" id="anaSetSearchDolgozo"${s.searchShowDolgozo ? ' checked' : ''}> Dolgozó oszlop</label>
      </div>
      <div class="field" style="margin-bottom:9px;">
        <label class="rs-lbl"><input type="checkbox" id="anaSetSearchReszleg"${s.searchShowReszleg ? ' checked' : ''}> Részleg oszlop</label>
      </div>`;
  } else if (meta.kind === 'atlagmedian') {
    extra = `
      <div class="field">
        <label class="lbl">Nézet</label>
        <select id="anaSetAmView">
          ${opt('mindket', s.amViewMode, 'Összesített + dolgozónkénti')}${opt('osszesitve', s.amViewMode, 'Csak összesített')}${opt('dolgozonkent', s.amViewMode, 'Csak dolgozónkénti')}
        </select>
      </div>
      <div class="field">
        <label class="lbl">Rendezés</label>
        <select id="anaSetAmSort">
          ${opt('nev', s.amSortBy, 'Anyag neve (ABC)')}${opt('mennyiseg', s.amSortBy, 'Átlagos mennyiség szerint')}
        </select>
      </div>
      <div class="field">
        <label class="lbl">Mértékegység</label>
        <select id="anaSetAmUnit">
          ${opt('kg', s.amUnit, 'Kilogramm')}${opt('t', s.amUnit, 'Tonna')}
        </select>
      </div>
      <div class="field" style="margin-bottom:9px;">
        <label class="rs-lbl"><input type="checkbox" id="anaSetAmFilter"${s.amFilterOutliers ? ' checked' : ''}> Kiugró műszak-értékek kiszűrése (IQR)</label>
      </div>
      <div class="field" style="margin-bottom:9px;">
        <label class="rs-lbl"><input type="checkbox" id="anaSetAmRawVsFiltered"${s.amShowRawVsFiltered ? ' checked' : ''}> Nyers érték is látszódjon a szűrt mellett</label>
      </div>
      <div class="field" style="margin-bottom:9px;">
        <label class="rs-lbl"><input type="checkbox" id="anaSetAmMinMax"${s.amShowMinMax ? ' checked' : ''}> Min–Max oszlop</label>
      </div>
      <div class="field" style="margin-bottom:9px;">
        <label class="rs-lbl"><input type="checkbox" id="anaSetAmTrend"${s.amShowTrend ? ' checked' : ''}> Trend-jelzés</label>
      </div>`;
  } else if (meta.kind === 'attekinto') {
    extra = `
      <div class="field">
        <label class="lbl">Részleg szerint</label>
        <select id="anaSetReszleg">${reszlegOpts}</select>
      </div>`;
  }

  const common = !_hasPicker(meta) ? '' : `
    <div class="field">
      <label class="lbl">Megjelenítendő elemek</label>
      <select id="anaSetTopN">
        ${opt('', s.topN, 'Alapértelmezett')}${opt('3', s.topN, 'Top 3')}${opt('5', s.topN, 'Top 5')}${opt('10', s.topN, 'Top 10')}${opt('all', s.topN, 'Mind')}
      </select>
    </div>
    <div class="field">
      <label class="lbl">Rendezés</label>
      <select id="anaSetSort">
        ${opt('kg', s.sortBy, 'Mennyiség szerint')}${opt('nev', s.sortBy, 'Név szerint (ABC)')}
      </select>
    </div>
    <div class="field">
      <label class="lbl">Mértékegység</label>
      <select id="anaSetUnit">
        ${opt('t', s.unit, 'Tonna')}${opt('kg', s.unit, 'Kilogramm')}
      </select>
    </div>
    <div class="field" style="margin-bottom:9px;">
      <label class="rs-lbl"><input type="checkbox" id="anaSetOther"${s.showOther ? ' checked' : ''}> "Egyéb" összesítő sor</label>
    </div>
    <div class="field" style="margin-bottom:9px;">
      <label class="rs-lbl"><input type="checkbox" id="anaSetCompare"${s.compareEnabled ? ' checked' : ''}> Összevetés az előző időszakkal</label>
    </div>`;

  const rangeRow = `<div style="display:flex;flex-wrap:wrap;gap:14px;align-items:flex-end;margin-bottom:12px;padding-bottom:12px;border-bottom:1px solid var(--border);">
    <div class="field">
      <label class="lbl">Alapértelmezett időszak megnyitáskor</label>
      <select id="anaSetDefaultRange">
        ${opt('7', String(s.defaultRangeDays), '7 nap')}${opt('30', String(s.defaultRangeDays), '30 nap')}${opt('90', String(s.defaultRangeDays), '90 nap')}
      </select>
    </div>
  </div>`;

  return `<div id="anaSettingsBlock" style="display:none;border:1px solid var(--border);border-radius:var(--r);padding:12px 14px;margin-bottom:14px;background:var(--surf2);">
    ${rangeRow}
    ${common ? `<div style="display:flex;flex-wrap:wrap;gap:14px;align-items:flex-end;margin-bottom:${extra ? '12px' : '0'};">${common}</div>` : ''}
    ${extra ? `<div style="display:flex;flex-wrap:wrap;gap:14px;align-items:flex-end;${common ? 'border-top:1px solid var(--border);padding-top:12px;' : ''}">${extra}</div>` : ''}
  </div>`;
}

/* ── Csempék (Jelentések → Analitika fül belépéskor) ── */
export function analitikaInitWidgets() {
  const cont = E('analitikaWidgets'); if (!cont) return;
  _closePanel();
  cont.innerHTML = WIDGETS.filter(w => !w.visible || w.visible()).map(_tile).join('');
}

/* ── Részletes panel (kattintásra jelenik meg a kártyák alatt, saját dátum/kiválasztás) ── */
export async function analitikaShowPanel(kind) {
  const meta = _wdMeta(kind); if (!meta) return;
  _panelKind = kind;
  _expandedLabel = null;
  _lastPrevMap = null;
  _attekintoCache = null;
  _attekintoExpanded = null;
  const panel = E('analitikaPanel'); if (!panel) return;

  document.querySelectorAll('#analitikaWidgets .dash-widget-clickable').forEach(w => {
    w.classList.toggle('active', w.dataset.wid === kind);
  });

  const rangeDays = Number(_getSettings().defaultRangeDays) || 30;
  const defTo = tod(), defFrom = addD(defTo, -(rangeDays - 1));
  panel.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;">
      <span style="font-size:20px;">${meta.icon}</span>
      <div class="card-title" style="margin:0;flex:1;border:none;padding:0;">${esc(meta.title)}</div>
      <button class="btn btn-ghost btn-sq" id="anaPanelCloseBtn" title="Bezárás">✕</button>
    </div>
    <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end;margin-bottom:10px;">
      <div class="field" style="min-width:130px;margin-bottom:13px;"><label class="lbl">Tól</label><input type="date" id="anaDrTol" value="${defFrom}"></div>
      <div class="field" style="min-width:130px;margin-bottom:13px;"><label class="lbl">Ig</label><input type="date" id="anaDrIg" value="${defTo}"></div>
    </div>
    <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px;">
      <button class="btn btn-ghost btn-sm" data-range="7">7 nap</button>
      <button class="btn btn-ghost btn-sm" data-range="30">30 nap</button>
      <button class="btn btn-ghost btn-sm" data-range="90">90 nap</button>
      <button class="btn btn-ghost btn-sm" data-range="honap">Idei hónap</button>
      <button class="btn btn-ghost btn-sm" data-range="ev">Idei év</button>
      <button class="btn btn-ghost btn-sm" data-range="mind">Teljes előzmény</button>
    </div>
    ${!_hasPicker(meta) ? '' : `
    <div class="lbox" style="margin-bottom:12px;">
      <div class="lbox-t">${esc(meta.title)}</div>
      <p class="lhint">Ctrl+klik = több · üresen hagyva = top ${meta.max}</p>
      <select id="anaDrSel" multiple size="5" style="width:100%;"></select>
    </div>`}
    ${meta.kind === 'search' ? `
    <div class="field" style="margin-bottom:14px;">
      <label class="lbl">Anyag keresése</label>
      <input type="text" id="anaSearchInput" placeholder="Kezdj el gépelni egy anyagnevet…" autocomplete="off">
    </div>` : ''}
    ${meta.kind === 'atlagmedian' ? `
    <div class="field" style="margin-bottom:14px;">
      <label class="lbl">Anyag szűrő (egyesített átlag/medián)</label>
      <input type="text" id="anaAmSearchInput" placeholder="Pl. azonos anyag különböző színekkel elmentve…" autocomplete="off">
      <p class="lhint">Ha kitöltöd, a rész-egyezéssel talált anyagokat egyesítve, egyetlen összesített átlag/mediánt mutat.</p>
    </div>` : ''}
    ${meta.kind === 'csapatreszletes' ? `
    <div class="field" style="margin-bottom:14px;min-width:200px;">
      <label class="lbl">Csapatvezető</label>
      <select id="anaCsapatVezetoSel"></select>
    </div>` : ''}
    ${meta.kind === 'egyeni' ? `
    <div style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:14px;">
      <div class="field" style="min-width:170px;"><label class="lbl">Dolgozó</label><select id="anaEgyeniDolgozoSel"></select></div>
      <div class="field" style="min-width:170px;"><label class="lbl">Anyag</label><select id="anaEgyeniAnyagSel"></select></div>
    </div>` : ''}
    <button class="btn btn-ghost btn-sm" id="anaSettingsToggle" style="margin-bottom:10px;">⚙ Beállítások</button>
    ${_settingsBlockHtml(meta)}
    <button class="btn btn-primary btn-sm" id="anaDrRefreshBtn" style="margin-bottom:14px;">Frissítés</button>
    <div id="analitikaRiportDiv"></div>
    <div class="btn-row" style="margin-top:12px;">
      <button class="btn btn-ghost" style="flex:1;" id="analitikaKepMentBtn" disabled>⬇ Kép</button>
      <button class="btn btn-ghost" id="analitikaPdfBtn" disabled>⬇ PDF</button>
      <button class="btn btn-ghost" id="analitikaNyomtatBtn" disabled>🖨 Nyomtat</button>
    </div>`;
  if (_hasPicker(meta)) _fillMultiSel(E('anaDrSel'), meta.listSrc(), meta.noSort);
  if (meta.kind === 'csapatreszletes') {
    fillSel(E('anaCsapatVezetoSel'), Object.keys(state.muszakVezetokMap), '— Válassz csapatvezetőt —');
  }
  if (meta.kind === 'egyeni') {
    fillSel(E('anaEgyeniDolgozoSel'), state.nevek.filter(n => !state.nevMetadata[n]?.archivalt), '— Válassz dolgozót —');
    fillSel(E('anaEgyeniAnyagSel'), state.anyagok, '— Válassz anyagot —');
  }

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
  ['analitikaKepMentBtn', 'analitikaPdfBtn', 'analitikaNyomtatBtn'].forEach(id => { const el = E(id); if (el) el.disabled = disabled; });
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
  _lastEntries = entries;
  if (!entries.length) {
    out.innerHTML = `<div class="empty-st"><div class="empty-ic">📭</div>Nincs adat a kiválasztott időszakra</div>`;
    _lastSeries = null; _setBtns(true); return;
  }

  if (meta.kind === 'datum') {
    _lastByDay = {};
    entries.forEach(e => { _lastByDay[e.datum] = (_lastByDay[e.datum] || 0) + _kg(e); });
    _lastHeader = { title: meta.title, from, to };
    _computeDatumResult();
    _setBtns(false);
    return;
  }

  if (meta.kind === 'matrix') {
    _lastHeader = { title: meta.title, from, to };
    _computeMatrixResult();
    _setBtns(false);
    return;
  }

  if (meta.kind === 'search') {
    _lastHeader = { title: meta.title, from, to };
    _computeSearchResult();
    return;
  }

  if (meta.kind === 'atlagmedian') {
    _lastHeader = { title: meta.title, from, to };
    _computeAtlagMedianResult();
    _setBtns(false);
    return;
  }

  if (meta.kind === 'rekordok') {
    _lastHeader = { title: meta.title, from, to };
    _computeRekordokResult();
    _setBtns(false);
    return;
  }

  if (meta.kind === 'csapatreszletes') {
    _lastHeader = { title: meta.title, from, to };
    _computeCsapatReszletekResult();
    _setBtns(false);
    return;
  }

  if (meta.kind === 'egyeni') {
    _lastHeader = { title: meta.title, from, to };
    _computeEgyeniResult();
    _setBtns(false);
    return;
  }

  if (meta.kind === 'attekinto') {
    _lastHeader = { title: meta.title, from, to };
    await _computeAttekintoResult();
    _setBtns(false);
    return;
  }

  _lastHeader = { title: meta.title, from, to };
  _computeCompareResult();
  _setBtns(false);
}

/* Csak a már lekérdezett _lastByDay-ból épít újra — a heti bontás és a hét
   napjai sorrend váltása nem igényel új lekérdezést. */
function _computeDatumResult() {
  const out = E('analitikaRiportDiv'); if (!out || !_lastByDay || !_lastHeader) return;
  const settings = _getSettings();
  const { from, to } = _lastHeader;

  let weekdayAvgs = _weekdayAverages(_lastByDay, from, to);
  if (settings.napSorrend === 'rangsor') weekdayAvgs = [...weekdayAvgs].sort((a, b) => b.avg - a.avg);

  const hetiSzekcio = settings.hetiBontas
    ? `<div class="r-section"><div class="r-sec-title">📆 Heti bontás</div>${_weekdayRows(_weeklyBuckets(_lastByDay, from, to), 150)}</div>`
    : '';

  out.innerHTML = `<div class="r-head" style="font-size:16px;">${esc(_lastHeader.title)} · ${esc(from)} – ${esc(to)}</div>
    <div class="r-section"><div class="r-sec-title">🗓 Naptár nézet</div>${_calendarHeatmap(_lastByDay, from, to)}</div>
    ${hetiSzekcio}
    <div class="r-section"><div class="r-sec-title">📊 Átlag napi termelés, hét napja szerint</div>${_weekdayRows(weekdayAvgs)}</div>
    ${_bestWorstDay(_lastByDay)}`;
}

/* ── Anyag-specializáció mátrix: soronként dolgozó, oszloponként anyag, a cella
   az adott dolgozó adott anyagra eső arányát mutatja (nem a teljes termelést) —
   így az látszik, ki mire "specializálódott", nem az, ki termel a legtöbbet. */
function _computeMatrixResult() {
  if (!_lastEntries || !_lastHeader) return;
  const settings = _getSettings();
  const dolgN   = settings.matrixDolgN === 'all'   ? Infinity : Number(settings.matrixDolgN || 8);
  const anyagN  = settings.matrixAnyagN === 'all'  ? Infinity : Number(settings.matrixAnyagN || 6);

  const entries = _lastEntries.filter(e => !state.nevMetadata[e.nev]?.archivalt);
  const dolgTotals = _totals(entries, e => e.nev);
  const dolgKeys   = dolgTotals.slice(0, dolgN).map(([k]) => k);
  const relevant   = entries.filter(e => dolgKeys.includes(e.nev));
  const anyagKeys  = _totals(relevant, e => (e.anyag || '').trim()).slice(0, anyagN).map(([k]) => k);

  const matrix = {};
  relevant.forEach(e => {
    const anyag = (e.anyag || '').trim();
    const kg = _kg(e); if (kg <= 0) return;
    const col = anyagKeys.includes(anyag) ? anyag : 'Egyéb';
    ((matrix[e.nev] ??= {})[col] = (matrix[e.nev]?.[col] || 0) + kg);
  });

  _renderMatrixResult(dolgKeys, anyagKeys, matrix, Object.fromEntries(dolgTotals));
}

function _renderMatrixResult(dolgKeys, anyagKeys, matrix, dolgTotalsMap) {
  const out = E('analitikaRiportDiv'); if (!out) return;

  if (!dolgKeys.length) {
    out.innerHTML = `<div class="r-head" style="font-size:16px;">${esc(_lastHeader.title)} · ${esc(_lastHeader.from)} – ${esc(_lastHeader.to)}</div>
      <div class="empty-st"><div class="empty-ic">📭</div>Nincs megjeleníthető adat</div>`;
    return;
  }

  const cols = [...anyagKeys, 'Egyéb'];
  const cell = (nev, col) => {
    const rowTotal = dolgTotalsMap[nev] || 0;
    const kg  = matrix[nev]?.[col] || 0;
    const pct = rowTotal > 0 ? (kg / rowTotal * 100) : 0;
    if (kg <= 0) return `<td style="text-align:center;color:var(--text3);">–</td>`;
    return `<td style="position:relative;text-align:center;padding:0;">
      <div style="position:absolute;inset:2px;background:var(--accent);opacity:${(0.12 + pct / 100 * 0.75).toFixed(2)};border-radius:3px;"></div>
      <span style="position:relative;font-size:12px;font-weight:600;padding:8px 6px;display:block;">${pct.toFixed(0)}%</span>
    </td>`;
  };
  const domins = nev => {
    const row = matrix[nev] || {};
    const top = Object.entries(row).sort((a, b) => b[1] - a[1])[0];
    if (!top) return '<span style="color:var(--text3);">–</span>';
    const pct = dolgTotalsMap[nev] > 0 ? (top[1] / dolgTotalsMap[nev] * 100).toFixed(0) : 0;
    return `<strong>${esc(top[0])}</strong> <span style="color:var(--text3);font-size:11.5px;">${pct}%</span>`;
  };

  const headCells = cols.map(c => `<th style="text-align:center;">${esc(c)}</th>`).join('');
  const rows = dolgKeys.map(nev => `<tr>
      <td style="font-weight:600;white-space:nowrap;">${esc(nev)}</td>
      ${cols.map(c => cell(nev, c)).join('')}
      <td style="white-space:nowrap;">${domins(nev)}</td>
    </tr>`).join('');

  out.innerHTML = `<div class="r-head" style="font-size:16px;">${esc(_lastHeader.title)} · ${esc(_lastHeader.from)} – ${esc(_lastHeader.to)}</div>
    <p style="color:var(--text3);font-size:12px;margin:-6px 0 12px;">A százalék az adott dolgozó teljes termelésén belüli arányt mutatja, nem az abszolút mennyiséget.</p>
    <div style="overflow-x:auto;">
      <table class="stbl"><thead><tr><th>Dolgozó</th>${headCells}<th>Domináns anyag</th></tr></thead><tbody>${rows}</tbody></table>
    </div>`;
}

/* ── Átlag / Medián: anyagonként (és dolgozónkénti bontásban) a MŰSZAKONKÉNTI
   termelés átlaga/mediánja, IQR-alapú kiugró-szűréssel — egy műszak-példány
   = adott nap + délelőtt/délután, hogy a felhasználó ebből tudjon számolni
   arra, egy (8 órás) műszakban mennyi termelés reális egy adott anyagból. */
function _computeAtlagMedianResult() {
  if (!_lastEntries || !_lastHeader) return;

  const matData = {};
  _lastEntries.forEach(e => {
    const mat = (e.anyag || '').trim();
    if (!mat) return;
    const kg = _kg(e); if (kg <= 0) return;
    const shiftKey = `${e.datum}||${e.ido || ''}`;
    matData[mat] ??= { shifts: {}, workers: {} };
    matData[mat].shifts[shiftKey] = (matData[mat].shifts[shiftKey] || 0) + kg;
    const nev = e.nev || 'Ismeretlen';
    matData[mat].workers[nev] ??= {};
    matData[mat].workers[nev][shiftKey] = (matData[mat].workers[nev][shiftKey] || 0) + kg;
  });

  const query = (E('anaAmSearchInput')?.value || '').trim().toLowerCase();
  if (!query) { _renderAtlagMedianResult(matData, null); return; }

  // Rész-egyezés alapján egyesíti a talált anyagokat (pl. ugyanaz az anyag,
  // csak más színnel elmentve) egyetlen összesített átlag/medián sorrá.
  const matched = Object.keys(matData).filter(m => m.toLowerCase().includes(query));
  if (!matched.length) { _renderAtlagMedianResult({}, { query, matched }); return; }

  const merged = { shifts: {}, workers: {} };
  matched.forEach(mat => {
    const d = matData[mat];
    Object.entries(d.shifts).forEach(([k, v]) => { merged.shifts[k] = (merged.shifts[k] || 0) + v; });
    Object.entries(d.workers).forEach(([nev, shifts]) => {
      merged.workers[nev] ??= {};
      Object.entries(shifts).forEach(([k, v]) => { merged.workers[nev][k] = (merged.workers[nev][k] || 0) + v; });
    });
  });

  _renderAtlagMedianResult({ [`🔎 "${query}" — egyesített`]: merged }, { query, matched });
}

/* Az időszak felére osztva a második fél szűrt műszak-átlagát hasonlítja az
   elsőhöz — csak durva irány-jelzés, nem statisztikai próba. A kulcs
   "YYYY-MM-DD||műszak" alakú, ezért a nap-részét kell kivágni a
   dátum-összehasonlításhoz. */
function _trend(shifts, from, to) {
  const keys = Object.keys(shifts).sort();
  if (keys.length < 4) return null;
  const [y1, m1, d1] = from.split('-').map(Number);
  const [y2, m2, d2] = to.split('-').map(Number);
  const mid = new Date((new Date(y1, m1 - 1, d1).getTime() + new Date(y2, m2 - 1, d2).getTime()) / 2).toISOString().slice(0, 10);
  const firstHalf  = keys.filter(k => k.split('||')[0] <= mid).map(k => shifts[k]);
  const secondHalf = keys.filter(k => k.split('||')[0] >  mid).map(k => shifts[k]);
  if (firstHalf.length < 2 || secondHalf.length < 2) return null;
  const a1 = average(_iqrFilter(firstHalf)), a2 = average(_iqrFilter(secondHalf));
  if (a1 <= 0) return null;
  const pct = (a2 - a1) / a1 * 100;
  if (Math.abs(pct) < 5) return { dir: '→', label: 'stabil', pct: 0 };
  return pct > 0 ? { dir: '↑', label: `+${pct.toFixed(0)}%`, pct } : { dir: '↓', label: `${pct.toFixed(0)}%`, pct };
}

function _renderAtlagMedianResult(matData, searchInfo) {
  const out = E('analitikaRiportDiv'); if (!out) return;
  const settings = _getSettings();
  const mats = Object.keys(matData);

  if (!mats.length) {
    out.innerHTML = `<div class="r-head" style="font-size:16px;">${esc(_lastHeader.title)} · ${esc(_lastHeader.from)} – ${esc(_lastHeader.to)}</div>
      <div class="empty-st"><div class="empty-ic">📭</div>${searchInfo ? `Nincs egyező anyag ehhez: „${esc(searchInfo.query)}”` : 'Nincs megjeleníthető adat'}</div>`;
    return;
  }

  const withStats = mats.map(mat => ({ mat, data: matData[mat], stats: _filteredStats(Object.values(matData[mat].shifts)) }));
  withStats.sort((a, b) => settings.amSortBy === 'mennyiseg'
    ? b.stats.filtered.avg - a.stats.filtered.avg
    : a.mat.localeCompare(b.mat, 'hu'));

  const showCombined = settings.amViewMode !== 'dolgozonkent';
  const showWorkers  = settings.amViewMode !== 'osszesitve';
  const alwaysOpen   = settings.amViewMode === 'dolgozonkent';

  const sep = ' <span class="cel-sep">·</span> ';
  const statLine = (s, unit) => `Átlag/műszak: <b>${_fmtUnitHtml(s.avg, unit)}</b>${sep}Medián/műszak: <b>${_fmtUnitHtml(s.med, unit)}</b>`;

  const rows = withStats.map(({ mat, data, stats }) => {
    const primary = settings.amFilterOutliers ? stats.filtered : stats.raw;
    const statParts = [];
    if (showCombined) {
      statParts.push(statLine(primary, settings.amUnit));
      if (settings.amShowRawVsFiltered && settings.amFilterOutliers && stats.wasFiltered) {
        statParts.push(`<span style="color:var(--text3);">(nyers: ${_fmtUnitHtml(stats.raw.avg, settings.amUnit)} átlag)</span>`);
      }
      if (settings.amShowMinMax) {
        statParts.push(`Min–Max: <b>${_fmtUnitHtml(primary.min, settings.amUnit)} – ${_fmtUnitHtml(primary.max, settings.amUnit)}</b>`);
      }
    }
    if (settings.amShowTrend) {
      const tr = _trend(data.shifts, _lastHeader.from, _lastHeader.to);
      if (tr) statParts.push(`<span style="color:var(--text3);">${tr.dir} ${tr.label}</span>`);
    }
    const combinedHtml = statParts.join(sep);

    let workerHtml = '';
    if (showWorkers) {
      const workerRows = Object.entries(data.workers)
        .map(([nev, shifts]) => ({ nev, stats: _filteredStats(Object.values(shifts)) }))
        .sort((a, b) => b.stats.filtered.avg - a.stats.filtered.avg)
        .map(w => {
          const p = settings.amFilterOutliers ? w.stats.filtered : w.stats.raw;
          return `<div class="cel-worker-row"><b>${esc(w.nev)}</b> — átlag ${_fmtUnitHtml(p.avg, settings.amUnit)}${sep}medián ${_fmtUnitHtml(p.med, settings.amUnit)} (${p.n} műszak)</div>`;
        })
        .join('') || '<div class="cel-worker-row"><span style="color:var(--text3);">Nincs adat.</span></div>';
      workerHtml = `<div class="cel-worker-detail">${workerRows}</div>`;
    }

    const clickable = showWorkers && !alwaysOpen;

    return `<div class="cel-mat-row${alwaysOpen ? ' open' : ''}" data-mat="${esc(mat)}">
      <div class="cel-mat-hdr"${clickable ? '' : ' style="cursor:default;"'}>
        <div class="cel-mat-left">
          ${clickable ? '<span class="cel-chev">▸</span>' : ''}
          <span class="cel-mat-name">${esc(mat)}</span>
        </div>
        <div class="cel-mat-stats">
          ${combinedHtml}
        </div>
      </div>
      ${workerHtml}
    </div>`;
  }).join('');

  const matchedInfo = searchInfo?.matched?.length
    ? `<p style="color:var(--text3);font-size:12px;margin:-6px 0 12px;">Egyesített anyagok (${searchInfo.matched.length}): ${searchInfo.matched.map(esc).join(', ')}</p>` : '';

  out.innerHTML = `<div class="r-head" style="font-size:16px;">${esc(_lastHeader.title)} · ${esc(_lastHeader.from)} – ${esc(_lastHeader.to)}</div>
    ${matchedInfo}
    ${settings.amFilterOutliers ? '<p style="color:var(--text3);font-size:12px;margin:-6px 0 12px;">A kiugróan magas/alacsony műszak-értékek ki vannak szűrve (IQR-módszer) az átlag/medián számításából.</p>' : ''}
    ${rows}`;
}

/* ── Rekordok: mindenki saját legjobb egyedi napja a kiválasztott
   időszakban — nem anyag-specifikus, a napi teljes termelést nézi. */
function _computeRekordokResult() {
  const out = E('analitikaRiportDiv'); if (!out || !_lastEntries || !_lastHeader) return;

  const byWorkerDay = {};
  _lastEntries.forEach(e => {
    const kg = _kg(e); if (kg <= 0) return;
    const nev = e.nev || 'Ismeretlen';
    byWorkerDay[nev] ??= {};
    byWorkerDay[nev][e.datum] ??= { total: 0, mats: {} };
    byWorkerDay[nev][e.datum].total += kg;
    const mat = (e.anyag || '').trim();
    if (mat) byWorkerDay[nev][e.datum].mats[mat] = (byWorkerDay[nev][e.datum].mats[mat] || 0) + kg;
  });

  const records = Object.entries(byWorkerDay).map(([nev, days]) => {
    const best = Object.entries(days).reduce((a, [datum, d]) => d.total > a.total ? { datum, ...d } : a, { total: -1 });
    const domMat = Object.entries(best.mats || {}).sort((a, b) => b[1] - a[1])[0]?.[0] || '—';
    return { nev, total: best.total, datum: best.datum, domMat };
  }).filter(r => r.total > 0).sort((a, b) => b.total - a.total);

  if (!records.length) {
    out.innerHTML = `<div class="r-head" style="font-size:16px;">${esc(_lastHeader.title)} · ${esc(_lastHeader.from)} – ${esc(_lastHeader.to)}</div>
      <div class="empty-st"><div class="empty-ic">📭</div>Nincs megjeleníthető adat</div>`;
    return;
  }

  const settings = _getSettings();
  const medal = i => i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
  const rows = records.map((r, i) => `<tr>
    <td style="font-weight:700;width:32px;">${medal(i)}</td>
    <td style="font-weight:600;">${esc(r.nev)}</td>
    <td class="v-bold">${_fmtUnitHtml(r.total, settings.unit)}</td>
    <td>${esc(fmtS(r.datum))}</td>
    <td>${esc(r.domMat)}</td>
  </tr>`).join('');

  out.innerHTML = `<div class="r-head" style="font-size:16px;">${esc(_lastHeader.title)} · ${esc(_lastHeader.from)} – ${esc(_lastHeader.to)}</div>
    <p style="color:var(--text3);font-size:12px;margin:-6px 0 12px;">Mindenki saját legjobb egyedi napja a kiválasztott időszakban.</p>
    <div style="overflow-x:auto;">
      <table class="stbl"><thead><tr><th></th><th>Dolgozó</th><th>Napi termelés</th><th>Dátum</th><th>Domináns anyag</th></tr></thead><tbody>${rows}</tbody></table>
    </div>`;
}

/* ── Csapat részletei: egy kiválasztott csapatvezető csapatának tagonkénti
   rangsora + a csapat napi termelésének trendje. */
function _computeCsapatReszletekResult() {
  const out = E('analitikaRiportDiv'); if (!out || !_lastEntries || !_lastHeader) return;
  const vezeto = E('anaCsapatVezetoSel')?.value;
  if (!vezeto) {
    out.innerHTML = `<div class="r-head" style="font-size:16px;">${esc(_lastHeader.title)} · ${esc(_lastHeader.from)} – ${esc(_lastHeader.to)}</div>
      <div class="empty-st"><div class="empty-ic">👑</div>Válassz csapatvezetőt fent.</div>`;
    return;
  }

  const team = [vezeto, ...(state.muszakVezetokMap[vezeto] || [])];
  const entries = _lastEntries.filter(e => team.includes(e.nev));
  const settings = _getSettings();

  const byMember = {};
  entries.forEach(e => {
    const kg = _kg(e); if (kg <= 0) return;
    byMember[e.nev] ??= {};
    byMember[e.nev][e.datum] = (byMember[e.nev][e.datum] || 0) + kg;
  });

  const members = team.map(nev => {
    const vals = Object.values(byMember[nev] || {});
    return { nev, total: vals.reduce((a, b) => a + b, 0), avg: average(vals), best: vals.length ? Math.max(...vals) : 0, n: vals.length };
  }).sort((a, b) => b.avg - a.avg);

  if (!members.some(m => m.n > 0)) {
    out.innerHTML = `<div class="r-head" style="font-size:16px;">${esc(_lastHeader.title)} · ${esc(_lastHeader.from)} – ${esc(_lastHeader.to)}</div>
      <div class="empty-st"><div class="empty-ic">📭</div>Nincs megjeleníthető adat ehhez a csapathoz.</div>`;
    return;
  }

  const teamDayTotals = {};
  entries.forEach(e => { const kg = _kg(e); if (kg > 0) teamDayTotals[e.datum] = (teamDayTotals[e.datum] || 0) + kg; });
  const teamVals  = Object.values(teamDayTotals);
  const teamTotal = teamVals.reduce((a, b) => a + b, 0);

  const rows = members.map(m => `<tr>
    <td style="font-weight:600;">${m.nev === vezeto ? '👑 ' : ''}${esc(m.nev)}</td>
    <td class="v-bold">${_fmtUnitHtml(m.total, settings.unit)}</td>
    <td>${_fmtUnitHtml(m.avg, settings.unit)}</td>
    <td>${_fmtUnitHtml(m.best, settings.unit)}</td>
    <td>${m.n}</td>
  </tr>`).join('');

  const spark = teamVals.length >= 2
    ? `<div class="r-section" style="margin-top:14px;"><div class="r-sec-title">📈 Csapat napi termelése</div>${_sparkline(
        Object.entries(teamDayTotals).sort((a, b) => a[0].localeCompare(b[0])).map(([datum, kg]) => ({ datum, kg })), 60)}</div>`
    : '';

  out.innerHTML = `<div class="r-head" style="font-size:16px;">${esc(_lastHeader.title)} · ${esc(_lastHeader.from)} – ${esc(_lastHeader.to)}</div>
    <div class="prem-grand" style="margin-bottom:14px;">
      <span>Csapat összesen: <strong>${_fmtUnitHtml(teamTotal, settings.unit)}</strong></span>
      <span>Napi átlag: <strong>${_fmtUnitHtml(average(teamVals), settings.unit)}</strong></span>
    </div>
    <div style="overflow-x:auto;">
      <table class="stbl"><thead><tr><th>Dolgozó</th><th>Összesen</th><th>Napi átlag</th><th>Legjobb nap</th><th>Aktív napok</th></tr></thead><tbody>${rows}</tbody></table>
    </div>
    ${spark}`;
}

/* ── Egyéni elemzés: egy dolgozó + egy anyag napi trendje, naptár-heatmap,
   és összevetés az adott anyagot termelő összes dolgozó átlagával. */
function _computeEgyeniResult() {
  const out = E('analitikaRiportDiv'); if (!out || !_lastEntries || !_lastHeader) return;
  const nev   = E('anaEgyeniDolgozoSel')?.value;
  const anyag = E('anaEgyeniAnyagSel')?.value;

  if (!nev || !anyag) {
    out.innerHTML = `<div class="r-head" style="font-size:16px;">${esc(_lastHeader.title)} · ${esc(_lastHeader.from)} – ${esc(_lastHeader.to)}</div>
      <div class="empty-st"><div class="empty-ic">👤</div>Válassz dolgozót és anyagot fent.</div>`;
    return;
  }

  const settings  = _getSettings();
  const allForMat = _lastEntries.filter(e => (e.anyag || '').trim() === anyag && _kg(e) > 0);
  const ownDays   = {};
  allForMat.filter(e => e.nev === nev).forEach(e => { ownDays[e.datum] = (ownDays[e.datum] || 0) + _kg(e); });

  const ownVals = Object.values(ownDays);
  if (!ownVals.length) {
    out.innerHTML = `<div class="r-head" style="font-size:16px;">${esc(_lastHeader.title)} · ${esc(_lastHeader.from)} – ${esc(_lastHeader.to)}</div>
      <div class="empty-st"><div class="empty-ic">📭</div>${esc(nev)} nem termelt ${esc(anyag)}-t ebben az időszakban.</div>`;
    return;
  }

  // Üzemi átlag: az adott anyagot termelő összes dolgozó napi átlaga (a mi dolgozónkat is beleértve).
  const plantByWorker = {};
  allForMat.forEach(e => {
    plantByWorker[e.nev] ??= {};
    plantByWorker[e.nev][e.datum] = (plantByWorker[e.nev][e.datum] || 0) + _kg(e);
  });
  const plantAvgs = Object.values(plantByWorker).map(days => average(Object.values(days)));
  const plantAvg  = average(plantAvgs);

  const ownAvg  = average(ownVals);
  const ownMed  = median(ownVals);
  const ownBest = Math.max(...ownVals);
  const ownWorst = Math.min(...ownVals);
  const diffPct = plantAvg > 0 ? (ownAvg - plantAvg) / plantAvg * 100 : 0;

  const statHtml = `<div class="prem-grand" style="margin-bottom:14px;flex-wrap:wrap;gap:10px;">
    <span>Napi átlag: <strong>${_fmtUnitHtml(ownAvg, settings.unit)}</strong></span>
    <span>Medián: <strong>${_fmtUnitHtml(ownMed, settings.unit)}</strong></span>
    <span>Legjobb nap: <strong>${_fmtUnitHtml(ownBest, settings.unit)}</strong></span>
    <span>Leggyengébb nap: <strong>${_fmtUnitHtml(ownWorst, settings.unit)}</strong></span>
    <span>Aktív napok: <strong>${ownVals.length}</strong></span>
  </div>`;

  const compareHtml = `<p style="color:${diffPct >= 0 ? 'var(--green)' : 'var(--red)'};font-size:13px;margin:0 0 14px;">
    ${esc(nev)} napi átlaga ${diffPct >= 0 ? '+' : ''}${diffPct.toFixed(0)}%-kal ${diffPct >= 0 ? 'jobb' : 'rosszabb'}, mint az üzemi átlag (${_fmtUnitHtml(plantAvg, settings.unit)}/nap, ${plantAvgs.length} dolgozó alapján) ${esc(anyag)}-ból.</p>`;

  const sparkData = Object.entries(ownDays).sort((a, b) => a[0].localeCompare(b[0])).map(([datum, kg]) => ({ datum, kg }));
  const trendHtml = sparkData.length >= 2
    ? `<div class="r-section"><div class="r-sec-title">📈 Napi trend</div>${_sparkline(sparkData, 60)}</div>` : '';

  // Anyagok szerinti rangsor: a dolgozó összes anyaga átlag/nap szerint,
  // a jelenleg kiválasztott anyag ◀ jelöléssel kiemelve.
  const ownAllMat = {};
  _lastEntries.filter(e => e.nev === nev && _kg(e) > 0).forEach(e => {
    const mat = (e.anyag || '').trim(); if (!mat) return;
    ownAllMat[mat] ??= {};
    ownAllMat[mat][e.datum] = (ownAllMat[mat][e.datum] || 0) + _kg(e);
  });
  const matRanking = Object.entries(ownAllMat)
    .map(([mat, days]) => ({ mat, avg: average(Object.values(days)), n: Object.keys(days).length }))
    .sort((a, b) => b.avg - a.avg);
  const rankingHtml = matRanking.length > 1 ? `<div class="r-section"><div class="r-sec-title">📦 ${esc(nev)} anyagai napi átlag szerint</div>
    <div style="overflow-x:auto;"><table class="stbl"><thead><tr><th>#</th><th>Anyag</th><th>Napi átlag</th><th>Aktív napok</th></tr></thead><tbody>
      ${matRanking.map((r, i) => `<tr${r.mat === anyag ? ' style="background:var(--agl);"' : ''}><td style="color:var(--text3);width:28px;">${i + 1}.</td><td style="font-weight:600;">${r.mat === anyag ? '◀ ' : ''}${esc(r.mat)}</td><td class="v-bold">${_fmtUnitHtml(r.avg, settings.unit)}</td><td>${r.n}</td></tr>`).join('')}
    </tbody></table></div></div>` : '';

  const dailyRows = Object.entries(ownDays).sort((a, b) => b[0].localeCompare(a[0]))
    .map(([datum, kg]) => `<tr><td>${esc(fmtS(datum))}</td><td class="v-bold">${_fmtUnitHtml(kg, settings.unit)}</td></tr>`).join('');
  const dailyTableHtml = `<div class="r-section"><div class="r-sec-title">📋 Napi bontás</div>
    <div style="overflow-x:auto;max-height:320px;overflow-y:auto;"><table class="stbl"><thead><tr><th>Dátum</th><th>Mennyiség</th></tr></thead><tbody>${dailyRows}</tbody></table></div></div>`;

  out.innerHTML = `<div class="r-head" style="font-size:16px;">${esc(_lastHeader.title)} · ${esc(_lastHeader.from)} – ${esc(_lastHeader.to)}</div>
    ${statHtml}
    ${compareHtml}
    ${trendHtml}
    <div class="r-section" style="margin-top:14px;"><div class="r-sec-title">🗓 Naptár nézet</div>${_calendarHeatmap(ownDays, _lastHeader.from, _lastHeader.to)}</div>
    ${rankingHtml}
    ${dailyTableHtml}`;
}

/* Kis, dashboard-widget-stílusú érmés rangsor (top 3 kiemelve), a _card()
   "extra" tartalmaként — anyagok/dolgozók top listájához egyaránt jó. */
function _miniRanking(totals) {
  if (!totals.length) return '<p style="color:var(--text3);font-size:12.5px;margin:6px 0 0;">Nincs adat.</p>';
  const medalGrad = ['linear-gradient(135deg,#FFD700,#E6A000)', 'linear-gradient(135deg,#C8C8C8,#909090)', 'linear-gradient(135deg,#CD853F,#8B4513)'];
  const medal = i => i < 3
    ? `<span style="background:${medalGrad[i]};color:#fff;border-radius:50%;width:22px;height:22px;display:inline-flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;flex-shrink:0;margin-right:8px;">${i + 1}</span>`
    : `<span style="color:var(--text3);width:22px;text-align:center;display:inline-block;flex-shrink:0;font-size:12px;margin-right:8px;">${i + 1}.</span>`;
  // Nem flex `gap`-pel térközölünk a medál/név/érték között, mert az html2canvas
  // (Kép/PDF export) nem veszi figyelembe a gap-et — explicit margin-right marad.
  const rows = totals.map(([label, kg], i) => `
    <div style="display:flex;align-items:center;padding:5px 0;border-bottom:1px solid var(--border);">
      ${medal(i)}
      <span style="font-size:${i === 0 ? '13.5' : '12.5'}px;font-weight:${i === 0 ? 700 : 600};color:var(--text);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-right:8px;">${esc(label)}</span>
      <span style="font-size:12px;color:var(--text2);white-space:nowrap;font-weight:${i === 0 ? 600 : 400};">${_fmtUnitPlain(kg, 't')}</span>
    </div>`).join('');
  return `<div style="margin-top:6px;">${rows}</div>`;
}

/* Mini heti oszlopdiagram (mindig az aktuális naptári hét, a panel Tól/Ig
   szűrőjétől függetlenül — ugyanaz a "Heti bontás" fogalom, mint a dashboardon). */
function _weekBarSvg(weekStart, byDay) {
  const days = Array.from({ length: 7 }, (_, i) => addD(weekStart, i));
  const today = tod();
  const vals = days.map(d => byDay[d] || 0);
  const maxV = Math.max(...vals, 1);
  const BAR_H = 52, BAR_W = 28, GAP = 5;
  const svgW = 7 * (BAR_W + GAP) - GAP;

  const bars = days.map((d, i) => {
    const v = vals[i];
    const h = v > 0 ? Math.max(4, Math.round(v / maxV * BAR_H)) : 0;
    const x = i * (BAR_W + GAP);
    const isToday = d === today, isFuture = d > today;
    const barFill = `style="fill:var(--accent);opacity:${isFuture ? '0.18' : isToday ? '1' : '0.52'}"`;
    const lblFill = `style="fill:${isToday ? 'var(--accent)' : 'var(--text3)'};font-weight:${isToday ? '700' : '400'}"`;
    const valFill = `style="fill:${isToday ? 'var(--accent)' : 'var(--text3)'}"`;
    return [
      h > 0 ? `<rect x="${x}" y="${BAR_H - h}" width="${BAR_W}" height="${h}" rx="3" ${barFill}/>` : '',
      `<text x="${x + BAR_W / 2}" y="${BAR_H + 12}" text-anchor="middle" font-size="9.5" font-family="Source Sans 3,sans-serif" ${lblFill}>${HU_DAYS[i].slice(0, 1)}</text>`,
      v > 0 && !isFuture ? `<text x="${x + BAR_W / 2}" y="${BAR_H - h - 3}" text-anchor="middle" font-size="8.5" font-family="Source Sans 3,sans-serif" ${valFill}>${(v / 1000).toFixed(1)}t</text>` : '',
    ].join('');
  }).join('');

  return `<svg viewBox="0 0 ${svgW} ${BAR_H + 16}" style="width:100%;margin-top:10px;overflow:visible;">${bars}</svg>`;
}

/* ── Gyors áttekintő: kis, dashboard-widget-stílusú kártyák —
   nem a teljes 12-csempés rácsot előre kiszámolva, csak erre az egyre,
   amikor rákattintanak. Az adatgyűjtés (async, hét-lekérdezéssel) és a
   renderelés szét van választva, hogy egy kártyára kattintva a helyben
   kibontható részlet újrarajzolása ne indítson felesleges lekérdezést. */
async function _computeAttekintoResult() {
  if (!_lastEntries || !_lastHeader) return;
  const settings = _getSettings();
  const entries  = settings.reszlegSzuro ? _lastEntries.filter(e => (e.reszleg || '').trim() === settings.reszlegSzuro) : _lastEntries;

  const byDay = {};
  entries.forEach(e => { const kg = _kg(e); if (kg > 0) byDay[e.datum] = (byDay[e.datum] || 0) + kg; });

  const dolgTotals   = _totals(entries, e => e.nev);
  const anyagTotals  = _totals(entries, e => (e.anyag || '').trim());
  const csapatTotals = Object.keys(state.muszakVezetokMap).length > 0 ? _totals(entries, _csapatKeyFn) : [];

  const todayStr  = tod();
  const dow       = new Date(todayStr + 'T12:00:00').getDay() || 7;
  const weekStart = addD(todayStr, -(dow - 1));
  const weekEntriesAll = await fetchEntries({ datumFrom: weekStart, datumTo: addD(weekStart, 6) }).catch(() => []);
  const weekEntries = settings.reszlegSzuro ? weekEntriesAll.filter(e => (e.reszleg || '').trim() === settings.reszlegSzuro) : weekEntriesAll;
  const weekByDay = {};
  weekEntries.forEach(e => { const kg = _kg(e); if (kg > 0) weekByDay[e.datum] = (weekByDay[e.datum] || 0) + kg; });

  let deKg = 0, duKg = 0;
  entries.forEach(e => {
    const kg = _kg(e); if (kg <= 0) return;
    if ((e.ido || '').trim() === 'Délután') duKg += kg; else deKg += kg;
  });

  _attekintoCache = { entries, byDay, dolgTotals, anyagTotals, csapatTotals, weekStart, weekByDay, deKg, duKg };
  _renderAttekinto();
}

/* Csak a már összesített _attekintoCache-ből épít újra — kártyára kattintva
   (helyben kibontás) vagy nézet-beállítás váltásakor nincs új lekérdezés. */
function _renderAttekinto() {
  const out = E('analitikaRiportDiv'); if (!out || !_attekintoCache || !_lastHeader) return;
  const settings = _getSettings();
  const { entries, byDay, dolgTotals, anyagTotals, csapatTotals, weekStart, weekByDay, deKg, duKg } = _attekintoCache;

  const totalKg = Object.values(byDay).reduce((a, b) => a + b, 0);
  const activeDays = Object.keys(byDay).length;
  const sparkData = Object.entries(byDay).sort((a, b) => a[0].localeCompare(b[0])).map(([datum, kg]) => ({ datum, kg }));

  const cardWrap = (key, html) => `<div data-card="${key}" class="dash-widget-clickable" title="Kattints a részletekért">${html}</div>`;

  const summaryCard = cardWrap('summary', _card('📊', 'Összesítő (kiválasztott időszak)',
    totalKg > 0 ? _fmtUnitHtml(totalKg, settings.unit) : '<span style="color:var(--text3);font-size:20px;">—</span>',
    activeDays > 0 ? `${activeDays} aktív nap · átlag ${_fmtUnitPlain(totalKg / activeDays, settings.unit)}/nap` : 'Nincs adat',
    sparkData.length >= 2 ? _sparkline(sparkData) : ''));

  const topDolgCard = cardWrap('dolg', _card('🏅', 'Top 3 dolgozó', '', 'Kiválasztott időszak', _miniRanking(dolgTotals.slice(0, 3))));
  const topAnyagCard = cardWrap('anyag', _card('📦', 'Top 3 anyag', '', 'Kiválasztott időszak', _miniRanking(anyagTotals.slice(0, 3))));

  const weekTotal = Object.values(weekByDay).reduce((a, b) => a + b, 0);
  const weekCard = cardWrap('week', _card('📉', 'Heti bontás (aktuális hét)', '',
    weekTotal > 0 ? `${_fmtUnitPlain(weekTotal, 't')} ezen a héten` : 'Még nincs adat ezen a héten',
    _weekBarSvg(weekStart, weekByDay)));

  const bestWorstHtml = _bestWorstDay(byDay);
  const bestWorstCard = cardWrap('bestworst', bestWorstHtml
    ? _card('🏆', 'Legjobb / Leggyengébb nap', '', '', bestWorstHtml)
    : _card('🏆', 'Legjobb / Leggyengébb nap', '', 'Nincs adat', ''));

  const muszakTotal = deKg + duKg;
  const dePct = muszakTotal > 0 ? deKg / muszakTotal * 100 : 0;
  const duPct = muszakTotal > 0 ? duKg / muszakTotal * 100 : 0;
  // Nem justify-content:space-between-nel térközölünk (html2canvas nem veszi
  // figyelembe export közben), hanem két flex:1 elemmel, jobbra igazítva a másodikat.
  const muszakExtra = muszakTotal > 0 ? `
    <div style="display:flex;height:10px;border-radius:5px;overflow:hidden;margin-top:8px;">
      <div style="width:${dePct.toFixed(1)}%;background:var(--accent);"></div>
      <div style="width:${duPct.toFixed(1)}%;background:var(--amber);"></div>
    </div>
    <div style="display:flex;font-size:11px;color:var(--text3);margin-top:6px;">
      <span style="flex:1;">☀️ Délelőtt ${dePct.toFixed(0)}%</span>
      <span style="flex:1;text-align:right;">🌙 Délután ${duPct.toFixed(0)}%</span>
    </div>` : '';
  const muszakCard = cardWrap('muszak', _card('🕐', 'Műszak-megoszlás', '',
    muszakTotal > 0 ? `${_fmtUnitPlain(muszakTotal, 't')} összesen` : 'Nincs adat', muszakExtra));

  const csapatCard = csapatTotals.length ? cardWrap('csapat', _card('👥', 'Top csapatok', '', 'Kiválasztott időszak', _miniRanking(csapatTotals.slice(0, 3)))) : '';

  const reszlegInfo = settings.reszlegSzuro
    ? `<p style="color:var(--text3);font-size:12px;margin:-6px 0 12px;">Szűrve: <strong style="color:var(--text);">${esc(settings.reszlegSzuro)}</strong> részleg (a heti bontás is erre a részlegre vonatkozik)</p>` : '';

  const detailHtml = _attekintoExpanded ? _attekintoDetailHtml(_attekintoExpanded, _attekintoCache, settings.unit) : '';

  out.innerHTML = `<div class="r-head" style="font-size:16px;">${esc(_lastHeader.title)} · ${esc(_lastHeader.from)} – ${esc(_lastHeader.to)}</div>
    ${reszlegInfo}
    <div class="dash-grid" style="margin-top:4px;">${summaryCard}${weekCard}${topDolgCard}${topAnyagCard}${bestWorstCard}${muszakCard}${csapatCard}</div>
    ${detailHtml}`;
}

function _detailWrap(title, body) {
  return `<div class="card" style="margin-top:14px;"><div class="card-title">${esc(title)}</div>${body}</div>`;
}

function _fullRankingTable(totals, unit) {
  if (!totals.length) return '<p style="color:var(--text3);font-size:13px;margin:0;">Nincs adat.</p>';
  const rows = totals.map(([label, kg], i) => `<tr><td style="color:var(--text3);width:28px;">${i + 1}.</td><td style="font-weight:600;">${esc(label)}</td><td class="v-bold">${_fmtUnitHtml(kg, unit)}</td></tr>`).join('');
  return `<div style="overflow-x:auto;max-height:340px;overflow-y:auto;"><table class="stbl"><thead><tr><th>#</th><th>Megnevezés</th><th>Mennyiség</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

/* A Gyors áttekintő kártyáira kattintva helyben kibontott részlet-tartalom —
   ugyanabból a cache-elt adatból, nincs új lekérdezés. */
function _attekintoDetailHtml(key, cache, unit) {
  const { entries, byDay, dolgTotals, anyagTotals, csapatTotals, weekStart, weekByDay } = cache;
  const closeNote = `<p style="color:var(--text3);font-size:11.5px;margin:0 0 10px;">Kattints újra a kártyára a bezáráshoz.</p>`;

  if (key === 'summary') {
    const rows = Object.entries(byDay).sort((a, b) => b[0].localeCompare(a[0]))
      .map(([datum, kg]) => `<tr><td>${esc(fmtS(datum))}</td><td class="v-bold">${_fmtUnitHtml(kg, unit)}</td></tr>`).join('')
      || '<tr><td colspan="2" style="color:var(--text3);">Nincs adat.</td></tr>';
    return _detailWrap('📊 Napi bontás — teljes időszak', closeNote +
      `<div style="overflow-x:auto;max-height:340px;overflow-y:auto;"><table class="stbl"><thead><tr><th>Dátum</th><th>Mennyiség</th></tr></thead><tbody>${rows}</tbody></table></div>`);
  }
  if (key === 'week') {
    const days = Array.from({ length: 7 }, (_, i) => addD(weekStart, i));
    const rows = days.map(d => `<tr><td>${esc(fmtS(d))}</td><td class="v-bold">${_fmtUnitHtml(weekByDay[d] || 0, unit)}</td></tr>`).join('');
    return _detailWrap('📉 Heti bontás — napi értékek', closeNote +
      `<table class="stbl"><thead><tr><th>Nap</th><th>Mennyiség</th></tr></thead><tbody>${rows}</tbody></table>`);
  }
  if (key === 'dolg')   return _detailWrap('🏅 Dolgozók — teljes rangsor', closeNote + _fullRankingTable(dolgTotals, unit));
  if (key === 'anyag')  return _detailWrap('📦 Anyagok — teljes rangsor', closeNote + _fullRankingTable(anyagTotals, unit));
  if (key === 'csapat') return _detailWrap('👥 Csapatok — teljes rangsor', closeNote + _fullRankingTable(csapatTotals, unit));
  if (key === 'bestworst') {
    const list = Object.entries(byDay).filter(([, kg]) => kg > 0).sort((a, b) => b[1] - a[1]);
    const top5 = list.slice(0, 5), bottom5 = list.slice(-5).reverse();
    const dayTable = rows => rows.length
      ? `<table class="stbl"><thead><tr><th>Dátum</th><th>Mennyiség</th></tr></thead><tbody>${rows.map(([datum, kg]) => `<tr><td>${esc(fmtS(datum))}</td><td class="v-bold">${_fmtUnitHtml(kg, unit)}</td></tr>`).join('')}</tbody></table>`
      : '<p style="color:var(--text3);font-size:13px;margin:0;">Nincs adat.</p>';
    return _detailWrap('🏆 Top 5 legjobb / leggyengébb nap', closeNote +
      `<div class="g2"><div><p class="rs-group-lbl" style="margin-bottom:6px;">Legjobb napok</p>${dayTable(top5)}</div><div><p class="rs-group-lbl" style="margin-bottom:6px;">Leggyengébb napok</p>${dayTable(bottom5)}</div></div>`);
  }
  if (key === 'muszak') return _detailWrap('🕐 Dolgozónkénti műszak-bontás', closeNote + (_muszakDolgozonkentHtml(unit, entries) || '<p style="color:var(--text3);font-size:13px;margin:0;">Nincs adat.</p>'));
  return '';
}

/* ── Anyag kereső: élő (gépelés közbeni) részszó-keresés az anyag mezőn,
   nyers bejegyzés-lista + összsúly — nem aggregál dolgozó/anyag szerint,
   mint a többi csempe, hanem a konkrét egyedi bejegyzéseket listázza. */
function _computeSearchResult() {
  const out = E('analitikaRiportDiv'); if (!out || !_lastHeader) return;
  const query = (E('anaSearchInput')?.value || '').trim();
  const settings = _getSettings();

  if (!query) {
    out.innerHTML = `<div class="r-head" style="font-size:16px;">${esc(_lastHeader.title)} · ${esc(_lastHeader.from)} – ${esc(_lastHeader.to)}</div>
      <div class="empty-st"><div class="empty-ic">🔍</div>Kezdj el gépelni egy anyagnevet a kereséshez.</div>`;
    _setBtns(true);
    return;
  }

  const q = query.toLowerCase();
  const rows = (_lastEntries || [])
    .filter(e => (e.anyag || '').toLowerCase().includes(q))
    .map(e => ({ ...e, _kg: _kg(e) }))
    .filter(r => r._kg > 0);

  if (!rows.length) {
    out.innerHTML = `<div class="r-head" style="font-size:16px;">${esc(_lastHeader.title)} · "${esc(query)}" · ${esc(_lastHeader.from)} – ${esc(_lastHeader.to)}</div>
      <div class="empty-st"><div class="empty-ic">📭</div>Nincs találat</div>`;
    _setBtns(true);
    return;
  }

  const total = rows.reduce((s, r) => s + r._kg, 0);
  let bodyHtml;

  if (settings.searchMode === 'osszesitve') {
    const byAnyag = {};
    rows.forEach(r => {
      (byAnyag[r.anyag] ??= { anyag: r.anyag, kg: 0, count: 0 });
      byAnyag[r.anyag].kg += r._kg;
      byAnyag[r.anyag].count++;
    });
    const list = Object.values(byAnyag).sort(
      settings.searchSortBy === 'anyag' ? (a, b) => a.anyag.localeCompare(b.anyag, 'hu') : (a, b) => b.kg - a.kg
    );
    bodyHtml = `<table class="stbl"><thead><tr><th>Anyag</th><th>Összsúly</th><th>Bejegyzések</th></tr></thead><tbody>
      ${list.map(g => `<tr><td style="font-weight:600;">${esc(g.anyag)}</td><td class="v-bold">${_fmtUnitHtml(g.kg, settings.searchUnit)}</td><td>${g.count}</td></tr>`).join('')}
    </tbody></table>`;
  } else {
    rows.sort(
      settings.searchSortBy === 'suly'  ? (a, b) => b._kg - a._kg :
      settings.searchSortBy === 'anyag' ? (a, b) => a.anyag.localeCompare(b.anyag, 'hu') :
      (a, b) => b.datum.localeCompare(a.datum)
    );
    const heads = [
      settings.searchShowDatum   ? '<th>Dátum</th>'   : '',
      settings.searchShowDolgozo ? '<th>Dolgozó</th>' : '',
      settings.searchShowReszleg ? '<th>Részleg</th>' : '',
      '<th>Anyag</th><th>Súly</th>',
    ].join('');
    const tableRows = rows.map(r => [
      settings.searchShowDatum   ? `<td style="white-space:nowrap;">${esc(fmtS(r.datum))}</td>` : '',
      settings.searchShowDolgozo ? `<td>${esc(r.nev)}</td>` : '',
      settings.searchShowReszleg ? `<td>${esc(r.reszleg || '—')}</td>` : '',
      `<td>${esc(r.anyag)}</td><td class="v-bold">${_fmtUnitHtml(r._kg, settings.searchUnit)}</td>`,
    ].join('')).map(cells => `<tr>${cells}</tr>`).join('');
    bodyHtml = `<table class="stbl"><thead><tr>${heads}</tr></thead><tbody>${tableRows}</tbody></table>`;
  }

  out.innerHTML = `<div class="r-head" style="font-size:16px;">${esc(_lastHeader.title)} · "${esc(query)}" · ${esc(_lastHeader.from)} – ${esc(_lastHeader.to)}</div>
    <div class="nossz" style="margin-bottom:14px;">
      <div class="nossz-item"><div class="nossz-val">${rows.length}</div><div class="nossz-lbl">Találat</div></div>
      <div class="nossz-item"><div class="nossz-val">${_fmtUnitPlain(total, settings.searchUnit)}</div><div class="nossz-lbl">Összsúly</div></div>
    </div>
    <div style="overflow-x:auto;">${bodyHtml}</div>`;
  _setBtns(false);
}

/* Csak a már lekérdezett _lastEntries-ből számol újra — nincs hálózati hívás,
   így a beállítások (Top N, rendezés, "Egyéb" sor, csempe-specifikus szűrők) váltása azonnali. */
function _computeCompareResult() {
  const meta = _wdMeta(_panelKind); if (!meta || !_hasPicker(meta) || !_lastEntries) return;
  const settings = _getSettings();
  const topN = settings.topN === 'all' ? Infinity : Number(settings.topN || meta.max);
  const entries = meta.filterFn ? _lastEntries.filter(e => meta.filterFn(e, settings)) : _lastEntries;

  let keys;
  if (meta.id === 'csapatok' && settings.sajatCsapat && isMuszakVezeto()) {
    keys = [`${state.userData?.displayName || ''} csapata`];
  } else {
    const sel = Array.from(E('anaDrSel')?.selectedOptions || []).map(o => o.value).filter(Boolean);
    keys = sel.length ? sel.slice(0, topN) : _topKeys(entries, meta.keyFn, topN);
  }
  _lastSeries = _perDaySeries(entries, meta.keyFn, keys);

  if (settings.showOther) {
    const otherSeries = _perDaySeries(entries, e => {
      const k = meta.keyFn(e);
      return (k && !keys.includes(k)) ? 'Egyéb' : null;
    }, ['Egyéb']);
    if (otherSeries[0].perDay.length) _lastSeries = [..._lastSeries, otherSeries[0]];
  }

  _lastPrevMap = null;
  _renderResultBody();

  if (settings.compareEnabled) _loadPrevComparison(meta, settings);
}

/* Az előző időszakot csak akkor kérdezi le újra a szervertől, ha maga a
   dátumtartomány változott — a nyers bejegyzéseket tartomány szerint
   gyorsítótárazza, minden más beállításváltás csak újraszűr/csoportosít. */
async function _loadPrevComparison(meta, settings) {
  const kindAtStart = _panelKind;
  const { from, to } = _lastHeader;
  const prevRange = _prevPeriod(from, to);
  const rangeKey  = `${prevRange.from}_${prevRange.to}`;

  if (_lastPrevRangeKey !== rangeKey) {
    _lastPrevEntriesRaw = await fetchEntries({ datumFrom: prevRange.from, datumTo: prevRange.to }).catch(() => []);
    _lastPrevRangeKey = rangeKey;
  }
  // A panel közben becsukódhatott, vagy másik csempére/időszakra váltottak — ne írjuk felül az újabb eredményt.
  if (_panelKind !== kindAtStart || _lastHeader?.from !== from || _lastHeader?.to !== to) return;
  const filtered = meta.filterFn ? _lastPrevEntriesRaw.filter(e => meta.filterFn(e, settings)) : _lastPrevEntriesRaw;
  _lastPrevMap = { map: Object.fromEntries(_totals(filtered, meta.keyFn)), label: prevRange.label };
  _renderResultBody();
}

/* A multi-select opciólistáját is újra kell építeni, ha egy beállítás megváltoztatja
   magát a kulcsteret (anyagcsoport-nézet, archiváltak be/kikapcsolása) — a puszta
   újraszámolás nem elég, mert a jelölőnégyzet-opciók is mások lesznek. */
function _rebuildSelectAndRecompute() {
  const meta = _wdMeta(_panelKind); if (!meta) return;
  _fillMultiSel(E('anaDrSel'), meta.listSrc(), meta.noSort);
  _computeCompareResult();
}

function _renderResultBody() {
  const out = E('analitikaRiportDiv'); if (!out || !_lastSeries) return;
  const series   = _lastSeries;
  const settings = _getSettings();
  const avgMode  = _panelKind === 'muszakok' && settings.muszakMode === 'atlag';
  // avgMode-nál (napi átlag) az előző időszak nyers összeghez való hasonlítás nem
  // lenne alma-alma összevetés, ezért ott nem mutatjuk a "Változás" oszlopot.
  const opts = { unit: settings.unit, sortBy: settings.sortBy, avgMode, prevMap: avgMode ? null : _lastPrevMap };
  const chart = series.length ? _multiBarChart(series, opts) : '';

  const compareCaption = opts.prevMap
    ? `<p style="color:var(--text3);font-size:12px;margin:-6px 0 10px;">Összevetve: <strong style="color:var(--text);">${esc(opts.prevMap.label)}</strong></p>`
    : '';

  const muszakDolgHtml = (_panelKind === 'muszakok' && settings.muszakDolgozonkent) ? _muszakDolgozonkentHtml(settings.unit) : '';

  out.innerHTML = `<div class="r-head" style="font-size:16px;">${esc(_lastHeader.title)} · ${esc(_lastHeader.from)} – ${esc(_lastHeader.to)}</div>${compareCaption}` + (
    series.length
      ? chart + _rankTable(series, opts) + muszakDolgHtml
      : `<div class="empty-st"><div class="empty-ic">📭</div>Nincs megjeleníthető adat</div>`
  );
}

/* Dolgozónkénti DE/DU napi átlag + melyik műszakban jobb az adott dolgozó —
   a "Műszakok összehasonlítása" csempe opcionális kiegészítő táblázata. */
function _muszakDolgozonkentHtml(unit, entries = _lastEntries) {
  if (!entries) return '';
  const buckets = {};
  entries.forEach(e => {
    const kg = _kg(e); if (kg <= 0) return;
    const nev = e.nev || 'Ismeretlen';
    const shift = (e.ido || '').trim() === 'Délután' ? 'Délután' : 'Délelőtt';
    buckets[nev] ??= { 'Délelőtt': {}, 'Délután': {} };
    buckets[nev][shift][e.datum] = (buckets[nev][shift][e.datum] || 0) + kg;
  });

  const rows = Object.entries(buckets).map(([nev, sh]) => {
    const deVals = Object.values(sh['Délelőtt']), duVals = Object.values(sh['Délután']);
    const deAvg = average(deVals), duAvg = average(duVals);
    const jobb = deVals.length && duVals.length ? (deAvg >= duAvg ? 'Délelőtt' : 'Délután')
      : (deVals.length ? 'Délelőtt' : duVals.length ? 'Délután' : '—');
    return { nev, deAvg, duAvg, deN: deVals.length, duN: duVals.length, jobb };
  }).sort((a, b) => Math.max(b.deAvg, b.duAvg) - Math.max(a.deAvg, a.duAvg));

  if (!rows.length) return '';

  const trs = rows.map(r => `<tr>
    <td style="font-weight:600;">${esc(r.nev)}</td>
    <td${r.jobb === 'Délelőtt' ? ' class="v-bold"' : ''}>${r.deN ? _fmtUnitHtml(r.deAvg, unit) : '—'}</td>
    <td${r.jobb === 'Délután' ? ' class="v-bold"' : ''}>${r.duN ? _fmtUnitHtml(r.duAvg, unit) : '—'}</td>
    <td>${esc(r.jobb)}</td>
  </tr>`).join('');

  return `<div class="r-section"><div class="r-sec-title">🕐 Dolgozónkénti műszak-bontás (napi átlag)</div>
    <div style="overflow-x:auto;">
      <table class="stbl"><thead><tr><th>Dolgozó</th><th>Délelőtt átlag</th><th>Délután átlag</th><th>Jobb műszak</th></tr></thead><tbody>${trs}</tbody></table>
    </div></div>`;
}

/* ── Panel belsejének eseménydelegálása (a tartalom többször újraépül) ── */
export function analitikaPanelClick(e) {
  if (e.target.closest('#anaPanelCloseBtn')) { _closePanel(); return; }
  if (e.target.closest('#anaSettingsToggle')) {
    const block = E('anaSettingsBlock');
    if (block) block.style.display = block.style.display === 'none' ? '' : 'none';
    return;
  }
  const rangeBtn = e.target.closest('[data-range]');
  if (rangeBtn) {
    const today = tod();
    const r = rangeBtn.dataset.range;
    let from;
    if (r === 'honap')      from = today.slice(0, 7) + '-01';
    else if (r === 'ev')    from = today.slice(0, 4) + '-01-01';
    else if (r === 'mind')  from = '2000-01-01';
    else                    from = addD(today, -(Number(r) - 1));
    E('anaDrTol').value = from;
    E('anaDrIg').value  = today;
    _renderPanelResult();
    return;
  }
  if (e.target.closest('#anaDrRefreshBtn'))      { _renderPanelResult(); return; }
  if (e.target.closest('#analitikaKepMentBtn'))  { analitikaKepMent(); return; }
  if (e.target.closest('#analitikaPdfBtn'))      { analitikaPdfMent(); return; }
  if (e.target.closest('#analitikaNyomtatBtn'))  { nyomtatDiv('analitikaRiportDiv'); return; }
  const row = e.target.closest('tr.ana-row');
  if (row) {
    const label = row.dataset.label;
    _expandedLabel = _expandedLabel === label ? null : label;
    _renderResultBody();
    return;
  }
  const matHdr = e.target.closest('.cel-mat-hdr');
  if (matHdr && matHdr.style.cursor !== 'default') {
    matHdr.closest('.cel-mat-row')?.classList.toggle('open');
    return;
  }
  const attCard = e.target.closest('[data-card]');
  if (attCard && _panelKind === 'attekinto') {
    const key = attCard.dataset.card;
    _attekintoExpanded = _attekintoExpanded === key ? null : key;
    _renderAttekinto();
    return;
  }
}

/* ── Beállítás-mezők (select/checkbox) change eseménye — mentés + azonnali
   újraszámolás a már lekérdezett adatokból, hálózati hívás nélkül. ── */
export function analitikaPanelChange(e) {
  if (e.target.id === 'anaSetTopN')        { _saveSettings({ topN: e.target.value });        _computeCompareResult(); return; }
  if (e.target.id === 'anaSetSort')        { _saveSettings({ sortBy: e.target.value });       _computeCompareResult(); return; }
  if (e.target.id === 'anaSetUnit')        { _saveSettings({ unit: e.target.value });         _renderResultBody();      return; }
  if (e.target.id === 'anaSetOther')       { _saveSettings({ showOther: e.target.checked });  _computeCompareResult(); return; }
  if (e.target.id === 'anaSetReszleg')     {
    _saveSettings({ reszlegSzuro: e.target.value });
    if (_panelKind === 'attekinto') _computeAttekintoResult(); else _computeCompareResult();
    return;
  }
  if (e.target.id === 'anaSetCsapat')      { _saveSettings({ csapatSzuro: e.target.value });  _computeCompareResult(); return; }
  if (e.target.id === 'anaSetAnyagCsoport'){ _saveSettings({ anyagCsoport: e.target.checked }); _rebuildSelectAndRecompute(); return; }
  if (e.target.id === 'anaSetArchivalt')   { _saveSettings({ archivalt: e.target.checked });    _rebuildSelectAndRecompute(); return; }
  if (e.target.id === 'anaSetDolgozokAnyag') { _saveSettings({ dolgozokAnyagSzuro: e.target.value }); _computeCompareResult(); return; }
  if (e.target.id === 'anaSetMuszakMode')  { _saveSettings({ muszakMode: e.target.value });     _renderResultBody();          return; }
  if (e.target.id === 'anaSetMuszakDolgozonkent') { _saveSettings({ muszakDolgozonkent: e.target.checked }); _renderResultBody(); return; }
  if (e.target.id === 'anaSetNapSorrend')  { _saveSettings({ napSorrend: e.target.value });     _computeDatumResult();        return; }
  if (e.target.id === 'anaSetHetiBontas')  { _saveSettings({ hetiBontas: e.target.checked });   _computeDatumResult();        return; }
  if (e.target.id === 'anaSetSajatCsapat') { _saveSettings({ sajatCsapat: e.target.checked });  _computeCompareResult();      return; }
  if (e.target.id === 'anaSetDefaultRange'){ _saveSettings({ defaultRangeDays: Number(e.target.value) }); return; }
  if (e.target.id === 'anaSetCompare')     { _saveSettings({ compareEnabled: e.target.checked }); _computeCompareResult(); return; }
  if (e.target.id === 'anaSetMatrixDolgN') { _saveSettings({ matrixDolgN: e.target.value });   _computeMatrixResult(); return; }
  if (e.target.id === 'anaSetMatrixAnyagN'){ _saveSettings({ matrixAnyagN: e.target.value });  _computeMatrixResult(); return; }
  if (e.target.id === 'anaSetSearchMode')    { _saveSettings({ searchMode: e.target.value });        _computeSearchResult(); return; }
  if (e.target.id === 'anaSetSearchSort')    { _saveSettings({ searchSortBy: e.target.value });       _computeSearchResult(); return; }
  if (e.target.id === 'anaSetSearchUnit')    { _saveSettings({ searchUnit: e.target.value });          _computeSearchResult(); return; }
  if (e.target.id === 'anaSetSearchDatum')   { _saveSettings({ searchShowDatum: e.target.checked });   _computeSearchResult(); return; }
  if (e.target.id === 'anaSetSearchDolgozo') { _saveSettings({ searchShowDolgozo: e.target.checked }); _computeSearchResult(); return; }
  if (e.target.id === 'anaSetSearchReszleg') { _saveSettings({ searchShowReszleg: e.target.checked }); _computeSearchResult(); return; }
  if (e.target.id === 'anaSetAmView')          { _saveSettings({ amViewMode: e.target.value });          _computeAtlagMedianResult(); return; }
  if (e.target.id === 'anaSetAmSort')          { _saveSettings({ amSortBy: e.target.value });            _computeAtlagMedianResult(); return; }
  if (e.target.id === 'anaSetAmUnit')          { _saveSettings({ amUnit: e.target.value });              _computeAtlagMedianResult(); return; }
  if (e.target.id === 'anaSetAmFilter')        { _saveSettings({ amFilterOutliers: e.target.checked });  _computeAtlagMedianResult(); return; }
  if (e.target.id === 'anaSetAmRawVsFiltered') { _saveSettings({ amShowRawVsFiltered: e.target.checked }); _computeAtlagMedianResult(); return; }
  if (e.target.id === 'anaSetAmMinMax')        { _saveSettings({ amShowMinMax: e.target.checked });      _computeAtlagMedianResult(); return; }
  if (e.target.id === 'anaSetAmTrend')         { _saveSettings({ amShowTrend: e.target.checked });       _computeAtlagMedianResult(); return; }
  if (e.target.id === 'anaCsapatVezetoSel')  { _computeCsapatReszletekResult(); return; }
  if (e.target.id === 'anaEgyeniAnyagSel')   { _computeEgyeniResult(); return; }
  if (e.target.id === 'anaEgyeniDolgozoSel') {
    const worker = e.target.value;
    if (!worker) { fillSel(E('anaEgyeniAnyagSel'), state.anyagok, '— Válassz anyagot —'); _computeEgyeniResult(); return; }
    getWorkerMaterials(worker).then(mats => fillSel(E('anaEgyeniAnyagSel'), mats, '— Válassz anyagot —'));
    _computeEgyeniResult();
    return;
  }
}

/* ── Élő (gépelés közbeni) szűrés az Anyag kereső mezőn — 280ms debounce,
   ugyanaz a minta, mint a készlet keresőmezőinél (js/main.js). ── */
export function analitikaPanelInput(e) {
  if (e.target.id === 'anaSearchInput') {
    clearTimeout(_searchDebounceT);
    _searchDebounceT = setTimeout(_computeSearchResult, 280);
    return;
  }
  if (e.target.id === 'anaAmSearchInput') {
    clearTimeout(_amSearchDebounceT);
    _amSearchDebounceT = setTimeout(_computeAtlagMedianResult, 280);
    return;
  }
}
