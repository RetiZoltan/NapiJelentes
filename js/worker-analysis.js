import { fetchEntries, fillSelGrouped, getMuszakVezetok } from './db.js';
import { state } from './state.js';
import { E, esc, msg, fmtKg, fmtS } from './utils.js';
import { nyomtatDiv } from './reports.js';

/* ── Dátumszűrő állapot ── */
let cachedEntries = null;
let _cacheKey     = '';
let _preset       = 'all';  // 'all' | '30d' | '90d' | 'year' | 'custom'
let _dateFrom     = '';
let _dateTo       = '';

function _getFilters() {
  const today = new Date().toISOString().split('T')[0];
  if (_preset === '30d')   { const d = new Date(); d.setDate(d.getDate()-30);  return { datumFrom: d.toISOString().split('T')[0], datumTo: today }; }
  if (_preset === '90d')   { const d = new Date(); d.setDate(d.getDate()-90);  return { datumFrom: d.toISOString().split('T')[0], datumTo: today }; }
  if (_preset === 'year')  return { datumFrom: `${new Date().getFullYear()}-01-01`, datumTo: today };
  if (_preset === 'custom') return { datumFrom: _dateFrom || undefined, datumTo: _dateTo || undefined };
  return {};
}

async function getEntries() {
  const key = JSON.stringify(_getFilters());
  if (cachedEntries && _cacheKey === key) return cachedEntries;
  cachedEntries = await fetchEntries(_getFilters());
  _cacheKey = key;
  return cachedEntries;
}

function _invalidateCache() { cachedEntries = null; _cacheKey = ''; }

/* ── Tab váltás ── */
function switchETab(name) {
  ['Egyeni','AnyagRangsor','Rekordok','Osszehasonlit','Muszak','Reszleg','MuszakVezeto'].forEach(t => {
    const panel = E('eTab' + t), btn = E('eBtn' + t);
    if (panel) panel.style.display = t === name ? '' : 'none';
    if (btn)   btn.classList.toggle('active', t === name);
  });
}

/* ── Vonaldiagram (SVG, külső lib nélkül) ── */
function _svgLineChart(perDay) {
  const days = [...perDay].reverse(); // kronológiai sorrend
  if (days.length < 2) return '';
  const vals = days.map(d => d.kg);
  const maxV = Math.max(...vals, 1);
  const W = 600, H = 130, PL = 42, PR = 10, PT = 12, PB = 22;
  const cW = W-PL-PR, cH = H-PT-PB;
  const n  = days.length;
  const xP = i => PL + (i / Math.max(n-1,1)) * cW;
  const yP = v => PT + cH - (v / maxV) * cH;

  const grid = [0, 0.25, 0.5, 0.75, 1].map(p => {
    const y = PT + cH - p*cH;
    return `<line x1="${PL}" y1="${y}" x2="${W-PR}" y2="${y}" stroke="var(--border)" stroke-width="0.5"/>
    <text x="${PL-4}" y="${y+3.5}" font-size="9" text-anchor="end" fill="var(--text3)">${((p*maxV)/1000).toFixed(1)}t</text>`;
  }).join('');

  const linePts = days.map((d,i) => `${xP(i)} ${yP(d.kg)}`).join(' L ');
  const areaPath = `M ${xP(0)} ${PT+cH} L ${linePts} L ${xP(n-1)} ${PT+cH} Z`;
  const dots = n <= 90 ? days.map((d,i) =>
    `<circle cx="${xP(i)}" cy="${yP(d.kg)}" r="2.5" fill="var(--accent)" opacity=".8" title="${d.datum}: ${d.kg.toFixed(0)} kg"/>`
  ).join('') : '';

  const step = Math.max(1, Math.floor(n/5));
  const xLabels = days.filter((_,i) => i%step===0||i===n-1).map(d => {
    const i = days.indexOf(d);
    return `<text x="${xP(i)}" y="${H-4}" font-size="9" text-anchor="middle" fill="var(--text3)">${d.datum.slice(5)}</text>`;
  }).join('');

  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;margin:10px 0 4px;overflow:visible;">
    <defs><linearGradient id="lcg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="var(--accent)" stop-opacity=".18"/>
      <stop offset="100%" stop-color="var(--accent)" stop-opacity=".01"/>
    </linearGradient></defs>
    ${grid}
    <path d="${areaPath}" fill="url(#lcg)"/>
    <path d="M ${linePts}" fill="none" stroke="var(--accent)" stroke-width="1.8" stroke-linejoin="round"/>
    ${dots}${xLabels}
  </svg>`;
}

function _svgDualLineChart(perDay1, perDay2, name1, name2) {
  const d1=[...perDay1].sort((a,b)=>a.datum.localeCompare(b.datum));
  const d2=[...perDay2].sort((a,b)=>a.datum.localeCompare(b.datum));
  const allDates=[...new Set([...d1.map(d=>d.datum),...d2.map(d=>d.datum)])].sort();
  if (allDates.length<2) return '';
  const map1=Object.fromEntries(d1.map(d=>[d.datum,d.kg]));
  const map2=Object.fromEntries(d2.map(d=>[d.datum,d.kg]));
  const maxV=Math.max(...allDates.map(d=>Math.max(map1[d]||0,map2[d]||0)),1);
  const W=600,H=150,PL=44,PR=12,PT=14,PB=22;
  const cW=W-PL-PR,cH=H-PT-PB,n=allDates.length;
  const xP=i=>PL+(i/Math.max(n-1,1))*cW;
  const yP=v=>PT+cH-(v/maxV)*cH;
  const grid=[0,.25,.5,.75,1].map(p=>{const y=PT+cH-p*cH;return `<line x1="${PL}" y1="${y}" x2="${W-PR}" y2="${y}" stroke="var(--border)" stroke-width="0.5"/><text x="${PL-4}" y="${y+3.5}" font-size="9" text-anchor="end" fill="var(--text3)">${((p*maxV)/1000).toFixed(1)}t</text>`;}).join('');
  const makeLine=(map,col)=>{let p='',s=false;allDates.forEach((d,i)=>{if(map[d]!==undefined){p+=`${s?'L':'M'} ${xP(i)} ${yP(map[d])} `;s=true;}else s=false;});return p?`<path d="${p}" fill="none" stroke="${col}" stroke-width="1.8" stroke-linejoin="round"/>`:'';};
  const makeDots=(map,col)=>n<=90?allDates.map((d,i)=>map[d]!==undefined?`<circle cx="${xP(i)}" cy="${yP(map[d])}" r="2.5" fill="${col}" opacity=".85"/>`:'').join(''):'';
  const step=Math.max(1,Math.floor(n/6));
  const xLabels=allDates.filter((_,i)=>i%step===0||i===n-1).map(d=>{const i=allDates.indexOf(d);return `<text x="${xP(i)}" y="${H-4}" font-size="9" text-anchor="middle" fill="var(--text3)">${d.slice(5)}</text>`;}).join('');
  const lx=W-PR-2,ly=PT+2;
  const n1=name1.length>14?name1.slice(0,14)+'…':name1, n2=name2.length>14?name2.slice(0,14)+'…':name2;
  const legend=`<rect x="${lx-90}" y="${ly}" width="8" height="8" rx="1" fill="var(--accent)"/><text x="${lx-78}" y="${ly+7}" font-size="9" fill="var(--text2)">${esc(n1)}</text><rect x="${lx-90}" y="${ly+13}" width="8" height="8" rx="1" fill="var(--green)"/><text x="${lx-78}" y="${ly+20}" font-size="9" fill="var(--text2)">${esc(n2)}</text>`;
  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;margin:10px 0 4px;overflow:visible;">${grid}${makeLine(map1,'var(--accent)')}${makeLine(map2,'var(--green)')}${makeDots(map1,'var(--accent)')}${makeDots(map2,'var(--green)')}${xLabels}${legend}</svg>`;
}

/* ── Naptár-hőtérkép (GitHub-szerű) ── */
function _calendarHeatmap(perDay) {
  if (perDay.length < 5) return '';
  const map = new Map(perDay.map(d => [d.datum, d.kg]));
  const dates = [...map.keys()].sort();
  const minD = new Date(dates[0] + 'T00:00:00');
  const maxD = new Date(dates[dates.length - 1] + 'T00:00:00');

  const start = new Date(minD);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7)); // hétfőre igazítás
  const end = new Date(maxD);
  end.setDate(end.getDate() + (6 - (end.getDay() + 6) % 7)); // vasárnapra igazítás

  const maxV   = Math.max(...map.values());
  const dayMs  = 86400000;
  const weeks  = Math.round((end - start) / dayMs / 7) + 1;
  const monthNames = ['Jan','Feb','Márc','Ápr','Máj','Jún','Júl','Aug','Szept','Okt','Nov','Dec'];
  const dowLabels   = ['H','K','Sze','Cs','P','Szo','V'];

  let cells = '', monthLabels = '', lastMonth = -1;
  const cur = new Date(start);
  for (let w = 0; w < weeks; w++) {
    for (let d = 0; d < 7; d++) {
      const iso     = cur.toISOString().split('T')[0];
      const inRange = cur >= minD && cur <= maxD;
      const val     = map.get(iso) || 0;
      if (d === 0 && inRange && cur.getMonth() !== lastMonth) {
        monthLabels += `<div style="grid-row:1;grid-column:${w + 2};font-size:9px;color:var(--text3);">${monthNames[cur.getMonth()]}</div>`;
        lastMonth = cur.getMonth();
      }
      let bg = 'transparent', title = '';
      if (inRange) {
        if (val > 0) {
          const pct = Math.round((val / maxV) * 70 + 12);
          bg = `color-mix(in srgb, var(--accent) ${pct}%, var(--surf2))`;
        } else {
          bg = 'var(--surf2)';
        }
        title = `${iso}: ${val > 0 ? val.toFixed(0) + ' kg' : 'nincs adat'}`;
      }
      cells += `<div style="grid-row:${d + 2};grid-column:${w + 2};width:11px;height:11px;border-radius:2px;background:${bg};" title="${title}"></div>`;
      cur.setDate(cur.getDate() + 1);
    }
  }
  const dowCol = dowLabels.map((l, i) =>
    `<div style="grid-row:${i + 2};grid-column:1;font-size:9px;color:var(--text3);display:flex;align-items:center;">${l}</div>`
  ).join('');

  return `<div style="overflow-x:auto;padding-bottom:4px;">
    <div style="display:grid;grid-template-columns:24px repeat(${weeks},11px);grid-template-rows:14px repeat(7,11px);gap:2px;width:max-content;">
      ${dowCol}${monthLabels}${cells}
    </div>
  </div>
  <div style="display:flex;align-items:center;gap:6px;font-size:10.5px;color:var(--text3);margin-top:6px;">
    <span>Kevesebb</span>
    <div style="width:11px;height:11px;border-radius:2px;background:var(--surf2);"></div>
    <div style="width:11px;height:11px;border-radius:2px;background:color-mix(in srgb, var(--accent) 26%, var(--surf2));"></div>
    <div style="width:11px;height:11px;border-radius:2px;background:color-mix(in srgb, var(--accent) 48%, var(--surf2));"></div>
    <div style="width:11px;height:11px;border-radius:2px;background:color-mix(in srgb, var(--accent) 70%, var(--surf2));"></div>
    <div style="width:11px;height:11px;border-radius:2px;background:color-mix(in srgb, var(--accent) 82%, var(--surf2));"></div>
    <span>Több</span>
  </div>`;
}

/* ── Dolgozók és anyagok feltöltése ── */
async function populateWorkers() {
  const entries = await getEntries();
  const workers = [...new Set(entries.map(a => a.nev))].sort((a,b) => a.localeCompare(b,'hu'));
  const opts = workers.length ? workers.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join('') : '<option value="">Nincs adat</option>';
  E('egyeniDolgozo').innerHTML = opts;
  if (E('osszDolg1')) E('osszDolg1').innerHTML = opts;
  if (E('osszDolg2')) { E('osszDolg2').innerHTML = opts; if (workers.length>1) E('osszDolg2').value = workers[1]; }
  if (workers.length) filterMaterials(entries, workers[0]);
  filterOsszAnyag();
}

function filterMaterials(entries, nev) {
  const mats = [...new Set(entries.filter(a => a.nev===nev && (a.anyag||'').trim()).map(a => (a.anyag||'').trim()))].sort((a,b) => a.localeCompare(b,'hu'));
  if (!mats.length) { E('egyeniAnyag').innerHTML = '<option value="">—</option>'; return; }
  fillSelGrouped(E('egyeniAnyag'), mats);
}

async function populateAnyagSel() {
  const entries = await getEntries();
  const mats = [...new Set(entries.filter(a=>(a.anyag||'').trim()).map(a=>(a.anyag||'').trim()))].sort((a,b)=>a.localeCompare(b,'hu'));
  if (!mats.length) { E('anyagRangsorSel').innerHTML = '<option value="">Nincs adat</option>'; return; }
  fillSelGrouped(E('anyagRangsorSel'), mats);
}

async function filterOsszAnyag() {
  if (!E('osszAnyag')) return;
  const nev1 = E('osszDolg1')?.value;
  const nev2 = E('osszDolg2')?.value;
  if (!nev1 || !nev2 || nev1 === nev2) {
    E('osszAnyag').innerHTML = '<option value="">— Válassz két különböző dolgozót —</option>';
    return;
  }
  const entries = await getEntries();
  const mats1 = new Set(entries.filter(a => a.nev===nev1 && (a.anyag||'').trim()).map(a => (a.anyag||'').trim()));
  const mats2 = new Set(entries.filter(a => a.nev===nev2 && (a.anyag||'').trim()).map(a => (a.anyag||'').trim()));
  const common = [...mats1].filter(m => mats2.has(m)).sort((a,b) => a.localeCompare(b,'hu'));
  if (!common.length) { E('osszAnyag').innerHTML = '<option value="">Nincs közös anyag</option>'; return; }
  fillSelGrouped(E('osszAnyag'), common);
}

/* ══════════════════════════════════════
   1. fül: Egyéni elemzés
══════════════════════════════════════ */
async function egyeniElemzes() {
  const nev = E('egyeniDolgozo').value, anyag = E('egyeniAnyag').value;
  if (!nev || !anyag) { msg('Válassz dolgozót és anyagot!', 'error'); return; }
  E('egyeniDiv').innerHTML = '<div class="empty-st"><div class="spinner" style="margin:0 auto"></div></div>';
  const entries = await getEntries();

  const wa          = entries.filter(a => a.nev===nev && (a.anyag||'').trim()===anyag);
  const allForAnyag = entries.filter(a => (a.anyag||'').trim()===anyag);
  if (!wa.length) { E('egyeniDiv').innerHTML = `<div class="empty-st"><div class="empty-ic">📭</div>Nincs adat</div>`; return; }

  const byDay = {};
  wa.forEach(a => {
    const kg = (a.sulyok||[]).reduce((s,x)=>s+x.suly,0);
    if (!byDay[a.datum]) byDay[a.datum] = { kg:0, idok:new Set() };
    byDay[a.datum].kg += kg;
    if (a.ido) byDay[a.datum].idok.add(a.ido);
  });
  const perDay = Object.entries(byDay).map(([datum,d]) => ({ datum, kg:d.kg, ido:[...d.idok].join(' / ') })).filter(d=>d.kg>0).sort((a,b)=>b.datum.localeCompare(a.datum));

  const perEntry = perDay.map(d=>d.kg);
  const count = perEntry.length, total = perEntry.reduce((s,v)=>s+v,0);
  const avg = count>0 ? total/count : 0;
  const minV = count>0 ? Math.min(...perEntry) : 0, maxV = count>0 ? Math.max(...perEntry) : 0;
  const szoras = count>1 ? Math.sqrt(perEntry.reduce((s,v)=>s+Math.pow(v-avg,2),0)/count) : 0;

  const globalByWD = {};
  allForAnyag.forEach(a => { const k=`${a.nev}__${a.datum}`, kg=(a.sulyok||[]).reduce((s,x)=>s+x.suly,0); globalByWD[k]=(globalByWD[k]||0)+kg; });
  const globalVals = Object.values(globalByWD).filter(v=>v>0);
  const globalAvg = globalVals.length>0 ? globalVals.reduce((s,v)=>s+v,0)/globalVals.length : 0;
  const diffPct = globalAvg>0 ? (avg-globalAvg)/globalAvg*100 : null;

  let html = `<div class="r-head">${esc(nev)} <span class="r-shift">· ${esc(anyag)}</span></div>`;

  html += `<div class="card" style="margin-bottom:12px;"><div class="card-title"><span class="card-title-icon">📊</span>Összefoglaló</div>
    <table class="stbl"><thead><tr><th>Mutató</th><th>Érték</th></tr></thead><tbody>
    <tr><td>Aktív munkanapok</td><td style="font-weight:600;">${count}</td></tr>
    <tr><td>Legjobb nap</td><td class="v-bold">${fmtKg(maxV)}</td></tr>
    <tr><td>Leggyengébb nap</td><td class="v-bold">${fmtKg(minV)}</td></tr>
    <tr><td>Napi átlag</td><td class="v-bold">${fmtKg(avg)}</td></tr>
    <tr><td>Szórás</td><td style="color:var(--text2);">${szoras.toFixed(0)} kg</td></tr>
    </tbody></table></div>`;

  if (globalAvg>0) {
    const col=diffPct>0?'var(--green)':diffPct<0?'var(--red)':'var(--text3)', sign=diffPct>0?'+':'';
    html += `<div class="card" style="margin-bottom:12px;"><div class="card-title"><span class="card-title-icon">📈</span>Összehasonlítás — üzemi átlag</div>
      <table class="stbl"><tbody>
      <tr><td>${esc(nev)} átlaga</td><td class="v-bold">${fmtKg(avg)}</td></tr>
      <tr><td>Üzemi átlag (${esc(anyag)})</td><td>${fmtKg(globalAvg)}</td></tr>
      ${diffPct!==null?`<tr><td>Különbség</td><td><span style="color:${col};font-weight:600;">${sign}${diffPct.toFixed(1)}%</span></td></tr>`:''}
      </tbody></table></div>`;
  }

  // Vonaldiagram
  if (perDay.length >= 2) {
    html += `<div class="card" style="margin-bottom:12px;"><div class="card-title"><span class="card-title-icon">📉</span>Trend</div>
      ${_svgLineChart(perDay)}</div>`;
  }

  // Naptár-hőtérkép
  const heatmap = _calendarHeatmap(perDay);
  if (heatmap) {
    html += `<div class="card" style="margin-bottom:12px;"><div class="card-title"><span class="card-title-icon">🗓️</span>Naptár nézet</div>${heatmap}</div>`;
  }

  // Saját anyag rangsor (az összes anyag amit ez a dolgozó dolgozott)
  const matMap = {};
  entries.filter(a=>a.nev===nev && (a.anyag||'').trim()).forEach(a => {
    const mat=(a.anyag||'').trim(), kg=(a.sulyok||[]).reduce((s,x)=>s+x.suly,0);
    if (kg<=0) return;
    if (!matMap[mat]) matMap[mat] = { total:0, days:new Set() };
    matMap[mat].total += kg;
    matMap[mat].days.add(a.datum);
  });
  const matRank = Object.entries(matMap).map(([mat,d])=>({ mat, avg:d.total/d.days.size, days:d.days.size })).sort((a,b)=>b.avg-a.avg);
  if (matRank.length > 1) {
    html += `<div class="card" style="margin-bottom:12px;"><div class="card-title"><span class="card-title-icon">📦</span>Anyagok szerinti rangsor — ${esc(nev)}</div>
      <table class="stbl"><thead><tr><th>#</th><th>Anyag</th><th>Átlag/nap</th><th>Aktív napok</th></tr></thead><tbody>`;
    matRank.forEach((m,i) => {
      const isSel = m.mat === anyag;
      html += `<tr style="${isSel?'background:var(--agl);':''}">
        <td style="color:var(--text3);">${i+1}.</td>
        <td style="font-weight:${isSel?700:600};">${esc(m.mat)}${isSel?' ◀':''}</td>
        <td class="v-bold">${fmtKg(m.avg)}</td>
        <td style="color:var(--text3);">${m.days} nap</td></tr>`;
    });
    html += `</tbody></table></div>`;
  }

  // Napi bontás
  html += `<div class="card"><div class="card-title"><span class="card-title-icon">📋</span>Napi bontás</div>
    <table class="stbl"><thead><tr><th>Dátum</th><th>Műszak</th><th>Napi összesen</th></tr></thead><tbody>`;
  perDay.forEach(d => { html += `<tr><td>${esc(fmtS(d.datum))}</td><td style="color:var(--text3);">${esc(d.ido||'—')}</td><td class="v-bold">${fmtKg(d.kg)}</td></tr>`; });
  html += `</tbody></table></div>`;
  E('egyeniDiv').innerHTML = html;
}

/* ══════════════════════════════════════
   2. fül: Anyagtípus rangsor
══════════════════════════════════════ */
async function anyagRangsor() {
  const anyag = E('anyagRangsorSel').value;
  if (!anyag) { msg('Válassz anyagot!', 'error'); return; }
  E('anyagRangsorDiv').innerHTML = '<div class="empty-st"><div class="spinner" style="margin:0 auto"></div></div>';
  const entries = await getEntries();
  const byWD = {};
  entries.filter(a=>(a.anyag||'').trim()===anyag).forEach(a => {
    const kg=(a.sulyok||[]).reduce((s,x)=>s+x.suly,0), key=`${a.nev}__${a.datum}`;
    if (!byWD[key]) byWD[key]={nev:a.nev,kg:0};
    byWD[key].kg += kg;
  });
  const byW = {};
  Object.values(byWD).forEach(({nev,kg}) => { if (!byW[nev]) byW[nev]=[]; byW[nev].push(kg); });
  if (!Object.keys(byW).length) { E('anyagRangsorDiv').innerHTML=`<div class="empty-st"><div class="empty-ic">📭</div>Nincs adat</div>`; return; }
  const rank = Object.entries(byW).map(([nev,vals])=>({ nev, avg:vals.reduce((s,v)=>s+v,0)/vals.length, best:Math.max(...vals), worst:Math.min(...vals) })).sort((a,b)=>b.avg-a.avg);
  let html = `<div class="r-head">${esc(anyag)} <span class="r-shift">· Rangsor</span></div>`;
  html += `<div class="card"><div class="card-title"><span class="card-title-icon">🏅</span>Dolgozói rangsor</div>
    <table class="stbl"><thead><tr><th>#</th><th>Dolgozó</th><th>Átlagos</th><th>Legjobb</th><th>Leggyengébb</th></tr></thead><tbody>`;
  rank.forEach((w,i) => { html+=`<tr><td style="color:var(--text3);">${i+1}.</td><td style="font-weight:600;">${esc(w.nev)}</td><td class="v-bold">${fmtKg(w.avg)}</td><td style="color:var(--green);font-weight:600;">${fmtKg(w.best)}</td><td style="color:var(--text3);">${fmtKg(w.worst)}</td></tr>`; });
  html += `</tbody></table></div>`;
  E('anyagRangsorDiv').innerHTML = html;
}

/* ══════════════════════════════════════
   3. fül: Személyes rekordok
══════════════════════════════════════ */
async function rekordok() {
  E('rekordokDiv').innerHTML='<div class="empty-st"><div class="spinner" style="margin:0 auto"></div></div>';
  const entries = await getEntries();
  if (!entries.length) { E('rekordokDiv').innerHTML=`<div class="empty-st"><div class="empty-ic">📭</div>Nincs adat</div>`; return; }
  const byWD={};
  entries.forEach(a => {
    const key=`${a.nev}__${a.datum}`, kg=(a.sulyok||[]).reduce((s,x)=>s+x.suly,0), ak=(a.anyag||'').trim();
    if (!byWD[key]) byWD[key]={nev:a.nev,datum:a.datum,kg:0,anyagok:{}};
    byWD[key].kg+=kg;
    if (ak&&kg>0) byWD[key].anyagok[ak]=(byWD[key].anyagok[ak]||0)+kg;
  });
  const byW={};
  Object.values(byWD).forEach(d=>{ if (!byW[d.nev]||d.kg>byW[d.nev].kg) byW[d.nev]=d; });
  const sorted=Object.values(byW).sort((a,b)=>b.kg-a.kg);
  let html=`<div class="r-head">Személyes rekordok</div>`;
  html+=`<div class="card"><div class="card-title"><span class="card-title-icon">🏆</span>Legjobb napi teljesítmény</div>
    <table class="stbl"><thead><tr><th>#</th><th>Dolgozó</th><th>Rekord</th><th>Anyag</th><th>Dátum</th></tr></thead><tbody>`;
  const medals=['🥇','🥈','🥉'];
  const medalBg=['rgba(255,215,0,.09)','rgba(192,192,192,.09)','rgba(205,127,50,.09)'];
  sorted.forEach((w,i)=>{ const fa=Object.entries(w.anyagok).sort((a,b)=>b[1]-a[1])[0];
    const rank=i<3?`<span style="font-size:16px;">${medals[i]}</span>`:`<span style="color:var(--text3);">${i+1}.</span>`;
    const row=i<3?`style="background:${medalBg[i]}"`:'';
    html+=`<tr ${row}><td>${rank}</td><td style="font-weight:600;">${esc(w.nev)}</td><td class="v-bold">${fmtKg(w.kg)}</td><td>${fa?esc(fa[0]):'—'}</td><td style="color:var(--text3);font-size:12.5px;">${esc(fmtS(w.datum))}</td></tr>`; });
  html+=`</tbody></table></div>`;
  E('rekordokDiv').innerHTML=html;
}

/* ══════════════════════════════════════
   4. fül: Összehasonlítás
══════════════════════════════════════ */
async function osszehasonlitas() {
  const nev1=E('osszDolg1').value, nev2=E('osszDolg2').value, anyag=E('osszAnyag').value;
  if (!nev1||!nev2||!anyag) { msg('Válassz két dolgozót és anyagot!','error'); return; }
  if (nev1===nev2) { msg('Válassz két különböző dolgozót!','error'); return; }
  E('osszDiv').innerHTML='<div class="empty-st"><div class="spinner" style="margin:0 auto"></div></div>';
  const entries=await getEntries();
  function getStats(nev){
    const wa=entries.filter(a=>a.nev===nev&&(a.anyag||'').trim()===anyag); if(!wa.length)return null;
    const byDay={}; wa.forEach(a=>{const kg=(a.sulyok||[]).reduce((s,x)=>s+x.suly,0); byDay[a.datum]=(byDay[a.datum]||0)+kg;});
    const per=Object.values(byDay).filter(v=>v>0); if(!per.length)return null;
    const perDay=Object.entries(byDay).filter(([,v])=>v>0).sort(([a],[b])=>a.localeCompare(b)).map(([datum,kg])=>({datum,kg}));
    const total=per.reduce((s,v)=>s+v,0), avg=total/per.length;
    return {napok:per.length,total,avg,best:Math.max(...per),worst:Math.min(...per),szoras:per.length>1?Math.sqrt(per.reduce((s,v)=>s+Math.pow(v-avg,2),0)/per.length):0,perDay};
  }
  const s1=getStats(nev1), s2=getStats(nev2);
  if (!s1&&!s2){E('osszDiv').innerHTML=`<div class="empty-st"><div class="empty-ic">📭</div>Nincs adat</div>`;return;}
  const fKg=v=>`${v.toFixed(0)} kg`, fN=v=>String(v);
  function statRow(lbl,v1,v2,fmt,hb=true){
    if(v1===null&&v2===null)return'';
    const w=v1!==null&&v2!==null?(hb?(v1>v2?1:v2>v1?2:0):(v1<v2?1:v2<v1?2:0)):0;
    const c1=w===1?'color:var(--green);font-weight:700;':'color:var(--text2);', c2=w===2?'color:var(--green);font-weight:700;':'color:var(--text2);';
    return `<tr><td style="color:var(--text2);">${lbl}</td><td style="${c1}">${v1!==null?fmt(v1)+(w===1?' ✓':''):'—'}</td><td style="${c2}">${v2!==null?fmt(v2)+(w===2?' ✓':''):'—'}</td></tr>`;
  }
  let html=`<div class="r-head">Összehasonlítás <span class="r-shift">· ${esc(anyag)}</span></div>`;
  html+=`<div class="card" style="margin-bottom:12px;"><div class="card-title"><span class="card-title-icon">⚖️</span>Statisztikai összehasonlítás</div>
    <table class="stbl"><thead><tr><th>Mutató</th><th style="color:var(--accent);font-size:12px;">${esc(nev1)}</th><th style="color:var(--accent);font-size:12px;">${esc(nev2)}</th></tr></thead><tbody>
    ${statRow('Aktív napok',s1?.napok??null,s2?.napok??null,fN)}${statRow('Össztermelés',s1?.total??null,s2?.total??null,fKg)}
    ${statRow('Napi átlag',s1?.avg??null,s2?.avg??null,fKg)}${statRow('Legjobb nap',s1?.best??null,s2?.best??null,fKg)}
    ${statRow('Leggyengébb nap',s1?.worst??null,s2?.worst??null,fKg)}${statRow('Szórás (kisebb=jobb)',s1?.szoras??null,s2?.szoras??null,fKg,false)}
    </tbody></table></div>`;
  if (s1&&s2){
    const mA=Math.max(s1.avg,s2.avg), b1=mA>0?Math.round(s1.avg/mA*100):0, b2=mA>0?Math.round(s2.avg/mA*100):0;
    const dp=s2.avg>0?(s1.avg-s2.avg)/s2.avg*100:0, dc=dp>0?'var(--green)':dp<0?'var(--red)':'var(--text3)';
    html+=`<div class="card"><div class="card-title"><span class="card-title-icon">📊</span>Vizuális összehasonlítás</div>
      <div style="margin-bottom:14px;"><div style="font-size:12px;color:var(--text3);margin-bottom:5px;font-weight:600;">${esc(nev1)}</div>
      <div style="height:20px;background:var(--surf2);border-radius:4px;overflow:hidden;"><div style="height:100%;width:${b1}%;background:var(--accent);border-radius:4px;display:flex;align-items:center;padding:0 7px;box-sizing:border-box;"><span style="font-size:11px;color:#fff;font-weight:700;">${s1.avg.toFixed(0)} kg</span></div></div></div>
      <div style="margin-bottom:14px;"><div style="font-size:12px;color:var(--text3);margin-bottom:5px;font-weight:600;">${esc(nev2)}</div>
      <div style="height:20px;background:var(--surf2);border-radius:4px;overflow:hidden;"><div style="height:100%;width:${b2}%;background:var(--accent);border-radius:4px;opacity:.6;display:flex;align-items:center;padding:0 7px;box-sizing:border-box;"><span style="font-size:11px;color:#fff;font-weight:700;">${s2.avg.toFixed(0)} kg</span></div></div></div>
      <div style="text-align:center;font-size:13px;color:var(--text2);border-top:1px solid var(--border);padding-top:8px;">
        <strong>${esc(nev1)}</strong> <span style="color:${dc};font-weight:700;">${dp>=0?'+':''}${dp.toFixed(1)}%</span> ${dp>=0?'több':'kevesebb'} mint <strong>${esc(nev2)}</strong>-é</div>
    </div>`;
    const dualChart=_svgDualLineChart(s1.perDay,s2.perDay,nev1,nev2);
    if (dualChart) html+=`<div class="card" style="margin-top:12px;"><div class="card-title"><span class="card-title-icon">📈</span>Napi teljesítmény — ${esc(anyag)}</div>${dualChart}<div style="font-size:11px;color:var(--text3);margin-top:2px;">Narancs: ${esc(nev1)} · Zöld: ${esc(nev2)}</div></div>`;
  }
  E('osszDiv').innerHTML=html;
}

/* ══════════════════════════════════════
   6. fül: Műszak elemzés
══════════════════════════════════════ */
async function muszakElemzes() {
  E('muszakDiv').innerHTML='<div class="empty-st"><div class="spinner" style="margin:0 auto"></div></div>';
  const entries=await getEntries();
  if (!entries.length){E('muszakDiv').innerHTML=`<div class="empty-st"><div class="empty-ic">📭</div>Nincs adat</div>`;return;}

  // (dolgozó, műszak, nap) → kg
  const byWSD={};
  entries.forEach(a=>{
    const kg=(a.sulyok||[]).reduce((s,x)=>s+x.suly,0); if(kg<=0)return;
    const shift=(a.ido||'').trim()==='Délután'?'Délután':'Délelőtt';
    const key=`${a.nev}||${shift}||${a.datum}`;
    byWSD[key]=(byWSD[key]||0)+kg;
  });
  const wStats={};
  Object.entries(byWSD).forEach(([key,kg])=>{
    const [nev,shift]=key.split('||');
    if (!wStats[nev])wStats[nev]={'Délelőtt':[],'Délután':[]};
    wStats[nev][shift].push(kg);
  });

  const workers=Object.keys(wStats).sort((a,b)=>a.localeCompare(b,'hu'));
  const avg=arr=>arr.length>0?arr.reduce((s,v)=>s+v,0)/arr.length:null;
  const maxAvg=workers.reduce((m,w)=>{
    const a1=avg(wStats[w]['Délelőtt']), a2=avg(wStats[w]['Délután']);
    return Math.max(m,a1||0,a2||0);
  },1);

  let h=`<div class="r-head">Műszak elemzés</div>`;
  h+=`<div class="card" style="margin-bottom:12px;"><div class="card-title"><span class="card-title-icon">🕐</span>Délelőtt vs. Délután — átlagos napi termelés</div>
    <table class="stbl"><thead><tr><th>Dolgozó</th><th>☀️ Délelőtt</th><th>🌙 Délután</th><th>Jobb műszak</th></tr></thead><tbody>`;
  workers.forEach(w=>{
    const a1=avg(wStats[w]['Délelőtt']), a2=avg(wStats[w]['Délután']);
    const winner=a1&&a2?(a1>a2?'☀️ Délelőtt':a1<a2?'🌙 Délután':'='):a1?'☀️ Délelőtt':a2?'🌙 Délután':'—';
    const c1=a1&&a2&&a1>a2?'color:var(--green);font-weight:700;':'';
    const c2=a1&&a2&&a2>a1?'color:var(--green);font-weight:700;':'';
    h+=`<tr><td style="font-weight:600;">${esc(w)}</td>
      <td style="${c1}">${a1?fmtKg(a1):'<span style="color:var(--text3);">—</span>'}</td>
      <td style="${c2}">${a2?fmtKg(a2):'<span style="color:var(--text3);">—</span>'}</td>
      <td style="font-size:12px;color:var(--text3);">${winner}</td></tr>`;
  });
  h+=`</tbody></table></div>`;

  // Összesítő: üzemi szinten melyik műszak termel többet
  const deTotal=Object.values(wStats).flatMap(w=>w['Délelőtt']), duTotal=Object.values(wStats).flatMap(w=>w['Délután']);
  const deAvg=avg(deTotal), duAvg=avg(duTotal);
  if (deAvg&&duAvg) {
    const diff=((deAvg-duAvg)/duAvg*100).toFixed(1), col=deAvg>duAvg?'var(--green)':'var(--red)';
    h+=`<div class="card"><div class="card-title"><span class="card-title-icon">📊</span>Üzemi összesítő</div>
      <table class="stbl"><tbody>
      <tr><td>☀️ Délelőtt átlag/nap/fő</td><td class="v-bold">${fmtKg(deAvg)}</td></tr>
      <tr><td>🌙 Délután átlag/nap/fő</td><td class="v-bold">${fmtKg(duAvg)}</td></tr>
      <tr><td>Különbség</td><td><span style="color:${col};font-weight:600;">${deAvg>duAvg?'+':''}${diff}%</span> (Délelőtt ${deAvg>duAvg?'jobb':'gyengébb'})</td></tr>
      </tbody></table></div>`;
  }
  E('muszakDiv').innerHTML=h;
}

/* ══════════════════════════════════════
   7. fül: Részleg összesítő
══════════════════════════════════════ */
async function reszlegElemzes() {
  E('reszlegElemzesDiv').innerHTML='<div class="empty-st"><div class="spinner" style="margin:0 auto"></div></div>';
  const entries=await getEntries();
  if (!entries.length){E('reszlegElemzesDiv').innerHTML=`<div class="empty-st"><div class="empty-ic">📭</div>Nincs adat</div>`;return;}
  const byRD={};
  entries.forEach(a=>{
    const r=(a.reszleg||'').trim(); if(!r)return;
    const kg=(a.sulyok||[]).reduce((s,x)=>s+x.suly,0); if(kg<=0)return;
    const key=`${r}||${a.datum}`; byRD[key]=(byRD[key]||0)+kg;
  });
  const rStats={};
  Object.entries(byRD).forEach(([key,kg])=>{
    const [r,datum]=key.split('||');
    if(!rStats[r])rStats[r]={total:0,days:new Set(),best:0};
    rStats[r].total+=kg; rStats[r].days.add(datum); rStats[r].best=Math.max(rStats[r].best,kg);
  });
  const sorted=Object.entries(rStats).map(([nev,s])=>({nev,total:s.total,napok:s.days.size,avg:s.total/s.days.size,best:s.best})).sort((a,b)=>b.total-a.total);
  if (!sorted.length){E('reszlegElemzesDiv').innerHTML=`<div class="empty-st"><div class="empty-ic">📭</div>Nincs adat</div>`;return;}
  const maxTotal=sorted[0].total;
  const medals=['🥇','🥈','🥉'];
  let h=`<div class="r-head">Részleg összesítő</div><div class="card"><div class="card-title"><span class="card-title-icon">🏭</span>Részlegek teljesítménye</div>`;
  sorted.forEach((r,i)=>{
    const bar=Math.round(r.total/maxTotal*100);
    h+=`<div style="margin-bottom:14px;">
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:4px;">
        <span style="font-weight:600;font-size:13px;">${i<3?medals[i]+' ':''}${esc(r.nev)}</span>
        <span style="font-size:12px;color:var(--text3);">${fmtKg(r.total)}</span>
      </div>
      <div style="height:20px;background:var(--surf2);border-radius:4px;overflow:hidden;">
        <div style="height:100%;width:${bar}%;background:var(--accent);border-radius:4px;display:flex;align-items:center;padding:0 8px;box-sizing:border-box;">
          ${bar>22?`<span style="font-size:11px;color:#fff;font-weight:700;">${fmtKg(r.avg)}/nap</span>`:''}
        </div>
      </div>
      <div style="font-size:11px;color:var(--text3);margin-top:3px;">${r.napok} aktív nap · átlag ${fmtKg(r.avg)}/nap · legjobb nap ${fmtKg(r.best)}</div>
    </div>`;
  });
  h+=`</div><div class="card" style="margin-top:12px;"><div class="card-title"><span class="card-title-icon">📋</span>Részletes táblázat</div>
    <table class="stbl"><thead><tr><th>#</th><th>Részleg</th><th>Össztermelés</th><th>Aktív napok</th><th>Napi átlag</th><th>Legjobb nap</th></tr></thead><tbody>`;
  sorted.forEach((r,i)=>{
    const rank=i<3?`<span style="font-size:15px;">${medals[i]}</span>`:`<span style="color:var(--text3);">${i+1}.</span>`;
    const rowBg=i<3?`style="background:${['rgba(255,215,0,.09)','rgba(192,192,192,.09)','rgba(205,127,50,.09)'][i]}"`:'';
    h+=`<tr ${rowBg}><td>${rank}</td><td style="font-weight:600;">${esc(r.nev)}</td><td class="v-bold">${fmtKg(r.total)}</td><td>${r.napok}</td><td>${fmtKg(r.avg)}</td><td>${fmtKg(r.best)}</td></tr>`;
  });
  h+=`</tbody></table></div>`;
  E('reszlegElemzesDiv').innerHTML=h;
}

/* ══════════════════════════════════════
   8. fül: Műszakvezető csapat elemzés
══════════════════════════════════════ */
async function muszakVezetoElemzes() {
  const vezeto = E('mvElemzSel').value;
  if (!vezeto) { msg('Válassz műszakvezetőt!', 'error'); return; }
  E('muszakVezetoDiv').innerHTML = '<div class="empty-st"><div class="spinner" style="margin:0 auto"></div></div>';
  const entries = await getEntries();
  const csapat  = [...(state.muszakVezetokMap[vezeto] || [])];
  if (!csapat.length) {
    E('muszakVezetoDiv').innerHTML = `<div class="empty-st"><div class="empty-ic">👷</div>Nincs beosztott dolgozó hozzárendelve</div>`;
    return;
  }
  const csapatAll = [vezeto, ...csapat];  // vezető + beosztottak összesítve
  const csapatEntries = entries.filter(a => csapatAll.includes(a.nev));
  if (!csapatEntries.length) {
    E('muszakVezetoDiv').innerHTML = `<div class="empty-st"><div class="empty-ic">📭</div>Nincs adat a csapathoz</div>`;
    return;
  }

  // Csapat összesítő statisztika
  const byWD = {};
  csapatEntries.forEach(a => {
    const kg = (a.sulyok || []).reduce((s, x) => s + x.suly, 0); if (kg <= 0) return;
    const key = `${a.nev}||${a.datum}`; byWD[key] = (byWD[key] || 0) + kg;
  });
  const byW = {};
  Object.entries(byWD).forEach(([key, kg]) => {
    const [nev] = key.split('||');
    if (!byW[nev]) byW[nev] = { total: 0, days: new Set(), best: 0 };
    byW[nev].total += kg; byW[nev].days.add(key.split('||')[1]); byW[nev].best = Math.max(byW[nev].best, kg);
  });
  const rank = Object.entries(byW).map(([nev, s]) => ({ nev, total: s.total, napok: s.days.size, avg: s.total / s.days.size, best: s.best })).sort((a, b) => b.avg - a.avg);

  const csapatTotal = rank.reduce((s, r) => s + r.total, 0);
  const csapatDays  = new Set(csapatEntries.map(a => a.datum)).size;
  const csapatAvg   = rank.length ? rank.reduce((s, r) => s + r.avg, 0) / rank.length : 0;
  const medals      = ['🥇', '🥈', '🥉'];

  let h = `<div class="r-head">${esc(vezeto)} csapata <span class="r-shift">· ${csapat.length} beosztott</span></div>`;

  // Csapat összesítő kártyák
  h += `<div class="card" style="margin-bottom:12px;"><div class="card-title"><span class="card-title-icon">📊</span>Csapat összesítő</div>
    <table class="stbl"><thead><tr><th>Mutató</th><th>Érték</th></tr></thead><tbody>
    <tr><td>Csapattagok száma</td><td style="font-weight:600;">${csapat.length} fő (+ vezető)</td></tr>
    <tr><td>Csapat össztermelés</td><td class="v-bold">${fmtKg(csapatTotal)}</td></tr>
    <tr><td>Aktív napok (összesen)</td><td style="font-weight:600;">${csapatDays}</td></tr>
    <tr><td>Átlagos napi teljesítmény/fő</td><td class="v-bold">${fmtKg(csapatAvg)}</td></tr>
    </tbody></table></div>`;

  // Rangsor sávdiagrammal
  const maxAvg = rank.length ? rank[0].avg : 1;
  h += `<div class="card" style="margin-bottom:12px;"><div class="card-title"><span class="card-title-icon">🏅</span>Csapat rangsor</div>`;
  rank.forEach((r, i) => {
    const bar = Math.round(r.avg / maxAvg * 100);
    const isVezeto = r.nev === vezeto;
    h += `<div style="margin-bottom:12px;">
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:4px;">
        <span style="font-weight:${isVezeto?700:600};font-size:13px;">${i < 3 ? medals[i] + ' ' : (i+1)+'. '}${esc(r.nev)}${isVezeto ? ' 👑' : ''}</span>
        <span style="font-size:12px;color:var(--text3);">${r.napok} nap</span>
      </div>
      <div style="height:20px;background:var(--surf2);border-radius:4px;overflow:hidden;">
        <div style="height:100%;width:${bar}%;background:${isVezeto?'var(--amber)':'var(--accent)'};border-radius:4px;opacity:${isVezeto?1:0.9-i*0.12};display:flex;align-items:center;padding:0 8px;box-sizing:border-box;">
          ${bar>18?`<span style="font-size:11px;color:#fff;font-weight:700;">${fmtKg(r.avg)}/nap</span>`:''}
        </div>
      </div>
      <div style="font-size:11px;color:var(--text3);margin-top:2px;">Összesen: ${fmtKg(r.total)} · Legjobb nap: ${fmtKg(r.best)}</div>
    </div>`;
  });
  h += `</div>`;

  // Részletes táblázat
  h += `<div class="card"><div class="card-title"><span class="card-title-icon">📋</span>Részletes táblázat</div>
    <table class="stbl"><thead><tr><th>#</th><th>Dolgozó</th><th>Össztermelés</th><th>Aktív napok</th><th>Napi átlag</th><th>Legjobb nap</th></tr></thead><tbody>`;
  rank.forEach((r, i) => {
    const isVezeto = r.nev === vezeto;
    h += `<tr style="${isVezeto ? 'background:var(--agl);' : ''}">
      <td>${i < 3 ? `<span style="font-size:15px;">${medals[i]}</span>` : `<span style="color:var(--text3);">${i+1}.</span>`}</td>
      <td style="font-weight:${isVezeto?700:600};">${esc(r.nev)}${isVezeto ? ' 👑' : ''}</td>
      <td class="v-bold">${fmtKg(r.total)}</td><td>${r.napok}</td>
      <td>${fmtKg(r.avg)}</td><td>${fmtKg(r.best)}</td></tr>`;
  });
  h += `</tbody></table></div>`;

  E('muszakVezetoDiv').innerHTML = h;
}

function populateMuszakVezetoSel() {
  const sel = E('mvElemzSel'); if (!sel) return;
  const prev = sel.value;
  const vezetok = getMuszakVezetok();
  sel.innerHTML = '<option value="">— Válassz műszakvezetőt —</option>' +
    vezetok.map(mv => `<option value="${esc(mv)}">${esc(mv)}</option>`).join('');
  if (prev) sel.value = prev;
}

/* ══════════════════════════════════════
   INICIALIZÁLÁS
══════════════════════════════════════ */
export async function initElemzes() {
  E('egyeniDiv').innerHTML='<div class="empty-st"><div class="spinner" style="margin:0 auto"></div></div>';
  await Promise.all([populateWorkers(), populateAnyagSel()]);
  E('egyeniDiv').innerHTML=`<div class="empty-st"><div class="empty-ic">👤</div>Válassz dolgozót és anyagot</div>`;

  // Dátumszűrő kezelése
  document.querySelectorAll('.edate-preset').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.edate-preset').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      _preset = btn.dataset.preset;
      const customWrap = E('edateCustomWrap');
      if (customWrap) customWrap.style.display = _preset==='custom' ? 'flex' : 'none';
      if (_preset !== 'custom') { _invalidateCache(); _rerunActiveTab(); }
    });
  });
  E('edateAlkalmaz')?.addEventListener('click', () => {
    _dateFrom = E('edateTol')?.value || '';
    _dateTo   = E('edateIg')?.value  || '';
    _invalidateCache();
    _rerunActiveTab();
  });

  // Sub-tab gombok
  E('eBtnEgyeni').addEventListener('click',         () => switchETab('Egyeni'));
  E('eBtnAnyagRangsor').addEventListener('click',   () => switchETab('AnyagRangsor'));
  E('eBtnRekordok').addEventListener('click',  async () => { switchETab('Rekordok'); await rekordok(); });
  E('eBtnOsszehasonlit').addEventListener('click',  () => switchETab('Osszehasonlit'));
  E('eBtnMuszak').addEventListener('click',    async () => { switchETab('Muszak'); await muszakElemzes(); });
  E('eBtnReszleg').addEventListener('click',   async () => { switchETab('Reszleg'); await reszlegElemzes(); });
  E('eBtnMuszakVezeto')?.addEventListener('click',  () => { switchETab('MuszakVezeto'); populateMuszakVezetoSel(); });
  E('mvElemzBtn')?.addEventListener('click', muszakVezetoElemzes);

  E('egyeniDolgozo').addEventListener('change', async () => { const e=await getEntries(); filterMaterials(e,E('egyeniDolgozo').value); });
  E('osszDolg1').addEventListener('change', filterOsszAnyag);
  E('osszDolg2').addEventListener('change', filterOsszAnyag);
  E('egyeniBtn').addEventListener('click',       egyeniElemzes);
  E('anyagRangsorBtn').addEventListener('click', anyagRangsor);
  E('osszBtn').addEventListener('click',         osszehasonlitas);
  E('elemzesNyomtatBtn')?.addEventListener('click', _elemzesNyomtat);
}

/* ── Nyomtatás: az aktív al-fül tartalma a közös print-stílussal ── */
const _ETAB_DIVS = {
  eBtnEgyeni:         'egyeniDiv',
  eBtnAnyagRangsor:   'anyagRangsorDiv',
  eBtnRekordok:       'rekordokDiv',
  eBtnOsszehasonlit:  'osszDiv',
  eBtnMuszak:         'muszakDiv',
  eBtnReszleg:        'reszlegElemzesDiv',
  eBtnMuszakVezeto:   'muszakVezetoDiv'
};

function _elemzesNyomtat() {
  const active = document.querySelector('#tab-elemzes .vbtn.active');
  const divId  = active && _ETAB_DIVS[active.id];
  if (!divId) { msg('Nincs nyomtatható tartalom.', 'error'); return; }
  nyomtatDiv(divId);
}

function _rerunActiveTab() {
  const active = document.querySelector('#tab-elemzes .vbtn.active');
  if (!active) return;
  const id = active.id;
  if (id==='eBtnEgyeni'&&E('egyeniDolgozo')?.value) egyeniElemzes();
  else if (id==='eBtnAnyagRangsor'&&E('anyagRangsorSel')?.value) anyagRangsor();
  else if (id==='eBtnRekordok') rekordok();
  else if (id==='eBtnMuszak') muszakElemzes();
  else if (id==='eBtnReszleg') reszlegElemzes();
  else if (id==='eBtnMuszakVezeto'&&E('mvElemzSel')?.value) muszakVezetoElemzes();
}
