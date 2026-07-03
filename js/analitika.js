import { fetchEntries } from './db.js';
import { E, esc, msg, fmtKg, skelHtml } from './utils.js';

/* ── Vizuális összehasonlító elemzés (Jelentések → Analitika) ──
   Csak termelési adatokra (entries) épül. Nem használ color-mix()-et
   sehol (html2canvas 1.4.1 nem tudja parse-olni), és minden SVG-nek
   explicit viewBox-a van, hogy a reports.js _buildWrap export-konverziója
   helyesen tudja méretezni. */

const PALETTE = ['#1565C0', '#2E7D32', '#E65100', '#8E24AA', '#C62828', '#00838F'];

function _kg(e) { return (e.sulyok || []).reduce((s, x) => s + x.suly, 0); }

function _selected(id) {
  const el = E(id);
  if (!el) return [];
  return Array.from(el.selectedOptions).map(o => o.value).filter(Boolean);
}

function _topKeys(entries, keyFn, n) {
  const totals = {};
  entries.forEach(e => {
    const k = keyFn(e); if (!k) return;
    const kg = _kg(e); if (kg <= 0) return;
    totals[k] = (totals[k] || 0) + kg;
  });
  return Object.entries(totals).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => k);
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

/* ── N-sorozatos vonaldiagram (worker-analysis.js _svgDualLineChart általánosítása) ── */
function _multiLineChart(series) {
  const all = [...new Set(series.flatMap(s => s.perDay.map(d => d.datum)))].sort();
  if (all.length < 2) return '';

  const W = 600, H = 190, PL = 46, PR = 14, PT = 16, PB = 26;
  const cW = W - PL - PR, cH = H - PT - PB, n = all.length;
  const xP = i => PL + (i / Math.max(n - 1, 1)) * cW;
  const maps = series.map(s => Object.fromEntries(s.perDay.map(d => [d.datum, d.kg])));
  const maxV = Math.max(1, ...maps.flatMap(m => Object.values(m)));
  const yP = v => PT + cH - (v / maxV) * cH;

  const grid = [0, .25, .5, .75, 1].map(p => {
    const y = PT + cH - p * cH;
    return `<line x1="${PL}" y1="${y}" x2="${W - PR}" y2="${y}" stroke="var(--border)" stroke-width="0.6"/>
    <text x="${PL - 5}" y="${y + 3.5}" font-size="9.5" text-anchor="end" fill="var(--text3)">${((p * maxV) / 1000).toFixed(1)}t</text>`;
  }).join('');

  const lines = series.map((s, i) => {
    const col = PALETTE[i % PALETTE.length];
    const map = maps[i];
    let path = '', started = false;
    all.forEach((d, idx) => {
      if (map[d] !== undefined) { path += `${started ? 'L' : 'M'} ${xP(idx)} ${yP(map[d])} `; started = true; }
      else started = false;
    });
    return path ? `<path d="${path}" fill="none" stroke="${col}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>` : '';
  }).join('');

  const step = Math.max(1, Math.ceil(n / 7));
  const xLabels = all.filter((_, i) => i % step === 0 || i === n - 1).map(d => {
    const i = all.indexOf(d);
    return `<text x="${xP(i)}" y="${H - 6}" font-size="9" text-anchor="middle" fill="var(--text3)">${d.slice(5)}</text>`;
  }).join('');

  const legend = series.map((s, i) => {
    const col = PALETTE[i % PALETTE.length];
    const y   = PT + i * 13;
    const lbl = s.label.length > 18 ? s.label.slice(0, 17) + '…' : s.label;
    return `<rect x="${W - PR - 96}" y="${y}" width="8" height="8" rx="1.5" fill="${col}"/>
      <text x="${W - PR - 84}" y="${y + 7}" font-size="9" fill="var(--text2)">${esc(lbl)}</text>`;
  }).join('');

  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;overflow:visible;">${grid}${lines}${xLabels}${legend}</svg>`;
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

function _section(title, icon, series) {
  if (!series.length) return '';
  const chart = _multiLineChart(series);
  return `<div class="r-section">
    <div class="r-sec-title">${icon} ${esc(title)}</div>
    ${chart || '<p style="color:var(--text3);font-size:13px;">Nincs elég adat trendvonalhoz (legalább 2 nap szükséges).</p>'}
    ${_rankTable(series)}
  </div>`;
}

function _setBtns(disabled) {
  ['analitikaKepMentBtn', 'analitikaPdfBtn'].forEach(id => { const el = E(id); if (el) el.disabled = disabled; });
}

export async function analitikaMutat() {
  const from = E('analitikaTolInput').value;
  const to   = E('analitikaIgInput').value;
  if (!from || !to) { msg('Válassz időszakot!', 'error'); return; }
  if (from > to) { msg('A "Tól" dátum nem lehet később mint az "Ig"!', 'error'); return; }

  E('analitikaRiportDiv').innerHTML = skelHtml('report');
  _setBtns(true);

  const entries = await fetchEntries({ datumFrom: from, datumTo: to });
  if (!entries.length) {
    E('analitikaRiportDiv').innerHTML = `<div class="empty-st"><div class="empty-ic">📭</div>Nincs adat a kiválasztott időszakra</div>`;
    return;
  }

  const reszlegSel = _selected('analitikaReszlegSzuro');
  const anyagSel   = _selected('analitikaAnyagSzuro');
  const dolgSel    = _selected('analitikaDolgozoSzuro');

  const reszlegKeyFn = e => (e.reszleg || '').trim() || 'Ismeretlen részleg';
  const anyagKeyFn   = e => (e.anyag   || '').trim();
  const dolgKeyFn    = e => e.nev;

  const reszlegKeys = reszlegSel.length ? reszlegSel : _topKeys(entries, reszlegKeyFn, 5);
  const anyagKeys   = anyagSel.length   ? anyagSel   : _topKeys(entries, anyagKeyFn, 5);
  const dolgKeys    = dolgSel.length    ? dolgSel.slice(0, 6) : _topKeys(entries, dolgKeyFn, 6);

  const html = `<div class="r-head">Analitika · ${esc(from)} – ${esc(to)}</div>`
    + _section('Részlegek összehasonlítása', '🏭', _perDaySeries(entries, reszlegKeyFn, reszlegKeys))
    + _section('Anyagtípusok összehasonlítása', '📦', _perDaySeries(entries, anyagKeyFn, anyagKeys))
    + _section('Dolgozók összehasonlítása', '👤', _perDaySeries(entries, dolgKeyFn, dolgKeys));

  E('analitikaRiportDiv').innerHTML = html || `<div class="empty-st"><div class="empty-ic">📭</div>Nincs megjeleníthető adat</div>`;
  _setBtns(false);
}

export function analitikaPreset(days) {
  const to = new Date();
  const from = new Date(); from.setDate(from.getDate() - (days - 1));
  const fmt = d => d.toISOString().slice(0, 10);
  E('analitikaTolInput').value = fmt(from);
  E('analitikaIgInput').value  = fmt(to);
}
