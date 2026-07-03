import { fetchEntries, fillSel } from './db.js';
import { state } from './state.js';
import { E, esc, fmtKg, skelHtml, tod, addD } from './utils.js';
import { _card, _sparkline } from './dashboard.js';
import { analitikaKepMent, analitikaPdfMent } from './reports.js';

/* ── Vizuális összehasonlító elemzés (Jelentések → Analitika) ──
   A főoldal widget kártyáinak mintáját követi: előnézeti kártyák,
   kattintásra a kártyák alatt nyílik meg a nagyobb, részletes panel.
   Csak termelési adatokra (entries) épül. Nem használ color-mix()-et
   sehol (html2canvas 1.4.1 nem tudja parse-olni), és minden SVG-nek
   explicit viewBox-a van, hogy a reports.js _buildWrap export-konverziója
   helyesen tudja méretezni. */

const PALETTE = ['#1565C0', '#2E7D32', '#E65100', '#8E24AA', '#C62828', '#00838F'];

const WIDGETS = [
  { id: 'reszlegek', icon: '🏭', title: 'Részlegek összehasonlítása', unit: 'részleg', max: 5,
    keyFn: e => (e.reszleg || '').trim() || 'Ismeretlen részleg', listSrc: () => state.reszlegek },
  { id: 'anyagok', icon: '📦', title: 'Anyagtípusok összehasonlítása', unit: 'anyagtípus', max: 5,
    keyFn: e => (e.anyag || '').trim(), listSrc: () => state.anyagok },
  { id: 'dolgozok', icon: '👤', title: 'Dolgozók összehasonlítása', unit: 'dolgozó', max: 6,
    keyFn: e => e.nev, listSrc: () => state.nevek.filter(n => !state.nevMetadata[n]?.archivalt) },
];

let _panelKind = null;

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

function _clickableCard(wid, ...args) {
  return _card(...args).replace('class="dash-widget', `data-wid="${wid}" class="dash-widget-clickable dash-widget`);
}

/* ── Előnézeti kártyák (Jelentések → Analitika fül belépéskor) ── */
export async function analitikaInitWidgets() {
  const cont = E('analitikaWidgets'); if (!cont) return;
  _closePanel();
  cont.innerHTML = WIDGETS.map(w => _clickableCard(w.id, w.icon, w.title, '<span style="color:var(--text3);font-size:16px;">…</span>')).join('');

  const to = tod(), from = addD(to, -29);
  const entries = await fetchEntries({ datumFrom: from, datumTo: to }).catch(() => []);

  WIDGETS.forEach(w => {
    const host = cont.querySelector(`[data-wid="${w.id}"]`); if (!host) return;
    const totals = _totals(entries, w.keyFn);
    const top = totals[0];
    const dayTotals = {};
    entries.forEach(e => { dayTotals[e.datum] = (dayTotals[e.datum] || 0) + _kg(e); });
    const spark = Array.from({ length: 14 }, (_, i) => { const d = addD(to, -(13 - i)); return { datum: d, kg: dayTotals[d] || 0 }; });
    const val = top ? esc(top[0]) : '<span style="color:var(--text3);font-size:16px;">—</span>';
    const sub = top ? `${(top[1] / 1000).toFixed(2)} t · ${totals.length} ${w.unit} · utóbbi 30 nap` : 'Nincs adat az utóbbi 30 napban';
    host.outerHTML = _clickableCard(w.id, w.icon, w.title, val, sub, top ? _sparkline(spark, 40) : '');
  });
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
    <div class="lbox" style="margin-bottom:12px;">
      <div class="lbox-t">${esc(meta.title)}</div>
      <p class="lhint">Ctrl+klik = több · üresen hagyva = top ${meta.max}</p>
      <select id="anaDrSel" multiple size="5" style="width:100%;"></select>
    </div>
    <button class="btn btn-primary btn-sm" id="anaDrRefreshBtn" style="margin-bottom:14px;">Frissítés</button>
    <div id="analitikaRiportDiv"></div>
    <div class="btn-row" style="margin-top:12px;">
      <button class="btn btn-ghost" style="flex:1;" id="analitikaKepMentBtn" disabled>⬇ Kép</button>
      <button class="btn btn-ghost" id="analitikaPdfBtn" disabled>⬇ PDF</button>
    </div>`;
  fillSel(E('anaDrSel'), meta.listSrc());

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
    _setBtns(true); return;
  }

  out.innerHTML = skelHtml('report');
  _setBtns(true);

  const entries = await fetchEntries({ datumFrom: from, datumTo: to }).catch(() => []);
  if (!entries.length) {
    out.innerHTML = `<div class="empty-st"><div class="empty-ic">📭</div>Nincs adat a kiválasztott időszakra</div>`;
    return;
  }

  const sel  = Array.from(E('anaDrSel')?.selectedOptions || []).map(o => o.value).filter(Boolean);
  const keys = sel.length ? sel.slice(0, meta.max) : _topKeys(entries, meta.keyFn, meta.max);
  const series = _perDaySeries(entries, meta.keyFn, keys);
  const chart  = series.length ? _multiLineChart(series) : '';

  out.innerHTML = `<div class="r-head" style="font-size:16px;">${esc(meta.title)} · ${esc(from)} – ${esc(to)}</div>` + (
    series.length
      ? (chart || '<p style="color:var(--text3);font-size:13px;">Nincs elég adat trendvonalhoz (legalább 2 nap szükséges).</p>') + _rankTable(series)
      : `<div class="empty-st"><div class="empty-ic">📭</div>Nincs megjeleníthető adat</div>`
  );
  _setBtns(false);
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
