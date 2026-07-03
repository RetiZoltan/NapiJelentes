import { fetchEntries, fillSel } from './db.js';
import { state, isMuszakVezeto } from './state.js';
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
      return true;
    } },
  { id: 'muszakok', icon: '🕐', title: 'Műszakok összehasonlítása', unit: 'műszak', max: 2,
    keyFn: e => (e.ido || '').trim() === 'Délután' ? 'Délután' : 'Délelőtt', listSrc: () => ['Délelőtt', 'Délután'] },
  { id: 'csapatok', icon: '👥', title: 'Csapatok összehasonlítása', unit: 'csapat', max: 8,
    visible: () => Object.keys(state.muszakVezetokMap).length > 0,
    keyFn: _csapatKeyFn, listSrc: () => Object.keys(state.muszakVezetokMap).map(v => `${v} csapata`) },
  { id: 'datum', icon: '📅', title: 'Dátum szerinti elemzés', kind: 'datum' },
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

/* ── Beállítások (közösek + csempe-specifikusak) —
   localStorage-ban perzisztálva. */
const _SET_KEY = 'nj_ana_settings';
const _SET_DEFAULTS = {
  topN: '', sortBy: 'kg', unit: 't', showOther: false,   // közös (mind a 4 összehasonlító csempénél)
  reszlegSzuro: '', csapatSzuro: '',                     // anyagok + dolgozók
  anyagCsoport: false,                                   // csak anyagok
  archivalt: false,                                      // csak dolgozók
  muszakMode: 'osszeg',                                  // csak műszakok: 'osszeg' | 'atlag'
  sajatCsapat: false,                                    // csak csapatok (műszakvezetőknek)
  hetiBontas: false,                                     // csak dátum szerinti elemzés
  napSorrend: 'kronologikus',                            // csak dátum szerinti elemzés: 'kronologikus' | 'rangsor'
  defaultRangeDays: 30,                                  // globális: alapértelmezett időszak megnyitáskor
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
  let h = `<table class="stbl"><thead><tr><th>#</th><th>Megnevezés</th><th>${opts.avgMode ? 'Napi átlag' : 'Összesen'}</th><th>Arány</th></tr></thead><tbody>`;
  totals.forEach((t, i) => {
    const pct  = total > 0 ? (t.kg / total * 100).toFixed(1) : 0;
    const barW = Math.round(Math.min(parseFloat(pct), 100) * 0.8);
    h += `<tr><td style="color:var(--text3);width:28px;">${t.isOther ? '' : i + 1 + '.'}</td><td style="font-weight:600;${t.isOther ? 'color:var(--text3);font-style:italic;' : ''}">${esc(t.label)}</td><td class="v-bold">${_fmtUnitHtml(t.kg, opts.unit)}</td><td><div style="display:flex;align-items:center;gap:8px;"><div style="height:6px;width:${barW}px;max-width:80px;background:${t.isOther ? 'var(--text3)' : 'var(--accent)'};border-radius:3px;opacity:.65;flex-shrink:0;"></div><span style="color:var(--text3);font-size:12px;">${pct}%</span></div></td></tr>`;
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
  }

  const common = meta.kind === 'datum' ? '' : `
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
    <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end;margin-bottom:14px;">
      <div class="field" style="min-width:130px;"><label class="lbl">Tól</label><input type="date" id="anaDrTol" value="${defFrom}"></div>
      <div class="field" style="min-width:130px;"><label class="lbl">Ig</label><input type="date" id="anaDrIg" value="${defTo}"></div>
    </div>
    ${meta.kind === 'datum' ? '' : `
    <div class="lbox" style="margin-bottom:12px;">
      <div class="lbox-t">${esc(meta.title)}</div>
      <p class="lhint">Ctrl+klik = több · üresen hagyva = top ${meta.max}</p>
      <select id="anaDrSel" multiple size="5" style="width:100%;"></select>
    </div>`}
    <button class="btn btn-ghost btn-sm" id="anaSettingsToggle" style="margin-bottom:10px;">⚙ Beállítások</button>
    ${_settingsBlockHtml(meta)}
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

/* Csak a már lekérdezett _lastEntries-ből számol újra — nincs hálózati hívás,
   így a beállítások (Top N, rendezés, "Egyéb" sor, csempe-specifikus szűrők) váltása azonnali. */
function _computeCompareResult() {
  const meta = _wdMeta(_panelKind); if (!meta || meta.kind === 'datum' || !_lastEntries) return;
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
  const opts     = { unit: settings.unit, sortBy: settings.sortBy, avgMode: _panelKind === 'muszakok' && settings.muszakMode === 'atlag' };
  const chart    = series.length ? _multiBarChart(series, opts) : '';

  out.innerHTML = `<div class="r-head" style="font-size:16px;">${esc(_lastHeader.title)} · ${esc(_lastHeader.from)} – ${esc(_lastHeader.to)}</div>` + (
    series.length
      ? chart + _rankTable(series, opts)
      : `<div class="empty-st"><div class="empty-ic">📭</div>Nincs megjeleníthető adat</div>`
  );
}

/* ── Panel belsejének eseménydelegálása (a tartalom többször újraépül) ── */
export function analitikaPanelClick(e) {
  if (e.target.closest('#anaPanelCloseBtn')) { _closePanel(); return; }
  if (e.target.closest('#anaSettingsToggle')) {
    const block = E('anaSettingsBlock');
    if (block) block.style.display = block.style.display === 'none' ? '' : 'none';
    return;
  }
  if (e.target.closest('#anaDrRefreshBtn'))      { _renderPanelResult(); return; }
  if (e.target.closest('#analitikaKepMentBtn'))  { analitikaKepMent(); return; }
  if (e.target.closest('#analitikaPdfBtn'))      { analitikaPdfMent(); return; }
}

/* ── Beállítás-mezők (select/checkbox) change eseménye — mentés + azonnali
   újraszámolás a már lekérdezett adatokból, hálózati hívás nélkül. ── */
export function analitikaPanelChange(e) {
  if (e.target.id === 'anaSetTopN')        { _saveSettings({ topN: e.target.value });        _computeCompareResult(); return; }
  if (e.target.id === 'anaSetSort')        { _saveSettings({ sortBy: e.target.value });       _computeCompareResult(); return; }
  if (e.target.id === 'anaSetUnit')        { _saveSettings({ unit: e.target.value });         _renderResultBody();      return; }
  if (e.target.id === 'anaSetOther')       { _saveSettings({ showOther: e.target.checked });  _computeCompareResult(); return; }
  if (e.target.id === 'anaSetReszleg')     { _saveSettings({ reszlegSzuro: e.target.value }); _computeCompareResult(); return; }
  if (e.target.id === 'anaSetCsapat')      { _saveSettings({ csapatSzuro: e.target.value });  _computeCompareResult(); return; }
  if (e.target.id === 'anaSetAnyagCsoport'){ _saveSettings({ anyagCsoport: e.target.checked }); _rebuildSelectAndRecompute(); return; }
  if (e.target.id === 'anaSetArchivalt')   { _saveSettings({ archivalt: e.target.checked });    _rebuildSelectAndRecompute(); return; }
  if (e.target.id === 'anaSetMuszakMode')  { _saveSettings({ muszakMode: e.target.value });     _renderResultBody();          return; }
  if (e.target.id === 'anaSetNapSorrend')  { _saveSettings({ napSorrend: e.target.value });     _computeDatumResult();        return; }
  if (e.target.id === 'anaSetHetiBontas')  { _saveSettings({ hetiBontas: e.target.checked });   _computeDatumResult();        return; }
  if (e.target.id === 'anaSetSajatCsapat') { _saveSettings({ sajatCsapat: e.target.checked });  _computeCompareResult();      return; }
  if (e.target.id === 'anaSetDefaultRange'){ _saveSettings({ defaultRangeDays: Number(e.target.value) }); return; }
}
