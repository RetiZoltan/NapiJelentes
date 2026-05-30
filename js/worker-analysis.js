import { fetchEntries } from './db.js';
import { E, esc, msg, fmtKg, fmtS } from './utils.js';

let cachedEntries = null;

async function getEntries() {
  if (!cachedEntries) cachedEntries = await fetchEntries({});
  return cachedEntries;
}

function switchETab(name) {
  ['Egyeni', 'AnyagRangsor', 'Rekordok', 'Osszehasonlit'].forEach(t => {
    const panel = E('eTab' + t);
    const btn   = E('eBtn' + t);
    if (panel) panel.style.display = t === name ? '' : 'none';
    if (btn)   btn.classList.toggle('active', t === name);
  });
}

async function populateWorkers() {
  const entries = await getEntries();
  const workers = [...new Set(entries.map(a => a.nev))].sort((a, b) => a.localeCompare(b, 'hu'));
  const opts = workers.length
    ? workers.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join('')
    : '<option value="">Nincs adat</option>';
  E('egyeniDolgozo').innerHTML = opts;
  if (E('osszDolg1')) E('osszDolg1').innerHTML = opts;
  if (E('osszDolg2')) {
    E('osszDolg2').innerHTML = opts;
    if (workers.length > 1) E('osszDolg2').value = workers[1];
  }
  if (workers.length) filterMaterials(entries, workers[0]);
}

function filterMaterials(entries, nev) {
  const mats = [...new Set(
    entries.filter(a => a.nev === nev && (a.anyag || '').trim())
           .map(a => (a.anyag || '').trim())
  )].sort((a, b) => a.localeCompare(b, 'hu'));
  E('egyeniAnyag').innerHTML = mats.length
    ? mats.map(m => `<option value="${esc(m)}">${esc(m)}</option>`).join('')
    : '<option value="">—</option>';
}

async function populateAnyagSel() {
  const entries = await getEntries();
  const mats = [...new Set(
    entries.filter(a => (a.anyag || '').trim()).map(a => (a.anyag || '').trim())
  )].sort((a, b) => a.localeCompare(b, 'hu'));
  const opts = mats.length
    ? mats.map(m => `<option value="${esc(m)}">${esc(m)}</option>`).join('')
    : '<option value="">Nincs adat</option>';
  E('anyagRangsorSel').innerHTML = opts;
  if (E('osszAnyag')) E('osszAnyag').innerHTML = opts;
}

/* ── 1. fül: Egyéni elemzés ── */
async function egyeniElemzes() {
  const nev   = E('egyeniDolgozo').value;
  const anyag = E('egyeniAnyag').value;
  if (!nev || !anyag) { msg('Válassz dolgozót és anyagot!', 'error'); return; }

  E('egyeniDiv').innerHTML = '<div class="empty-st"><div class="spinner" style="margin:0 auto"></div></div>';
  const entries = await getEntries();

  const wa          = entries.filter(a => a.nev === nev && (a.anyag || '').trim() === anyag);
  const allForAnyag = entries.filter(a => (a.anyag || '').trim() === anyag);

  if (!wa.length) {
    E('egyeniDiv').innerHTML = `<div class="empty-st"><div class="empty-ic">📭</div>Nincs adat</div>`;
    return;
  }

  const byDay = {};
  wa.forEach(a => {
    const kg = (a.sulyok || []).reduce((s, x) => s + x.suly, 0);
    if (!byDay[a.datum]) byDay[a.datum] = { kg: 0, idok: new Set() };
    byDay[a.datum].kg += kg;
    if (a.ido) byDay[a.datum].idok.add(a.ido);
  });
  const perDay = Object.entries(byDay)
    .map(([datum, d]) => ({ datum, kg: d.kg, ido: [...d.idok].join(' / ') }))
    .filter(d => d.kg > 0)
    .sort((a, b) => b.datum.localeCompare(a.datum));

  const perEntry = perDay.map(d => d.kg);
  const count    = perEntry.length;
  const total    = perEntry.reduce((s, v) => s + v, 0);
  const avg      = count > 0 ? total / count : 0;
  const minV     = count > 0 ? Math.min(...perEntry) : 0;
  const maxV     = count > 0 ? Math.max(...perEntry) : 0;
  const szoras   = count > 1 ? Math.sqrt(perEntry.reduce((s, v) => s + Math.pow(v - avg, 2), 0) / count) : 0;

  const globalByWD = {};
  allForAnyag.forEach(a => {
    const key = `${a.nev}__${a.datum}`;
    const kg  = (a.sulyok || []).reduce((s, x) => s + x.suly, 0);
    globalByWD[key] = (globalByWD[key] || 0) + kg;
  });
  const globalVals = Object.values(globalByWD).filter(v => v > 0);
  const globalAvg  = globalVals.length > 0 ? globalVals.reduce((s, v) => s + v, 0) / globalVals.length : 0;
  const diffPct    = globalAvg > 0 ? (avg - globalAvg) / globalAvg * 100 : null;

  let html = `<div class="r-head">${esc(nev)} <span class="r-shift">· ${esc(anyag)}</span></div>`;

  html += `<div class="card" style="margin-bottom:12px;"><div class="card-title"><span class="card-title-icon">📊</span>Összefoglaló</div>
    <table class="stbl"><thead><tr><th>Mutató</th><th>Érték</th></tr></thead><tbody>
    <tr><td>Aktív munkanapok</td><td style="font-weight:600;color:var(--text);">${count}</td></tr>
    <tr><td>Legjobb nap</td><td class="v-bold">${fmtKg(maxV)}</td></tr>
    <tr><td>Leggyengébb nap</td><td class="v-bold">${fmtKg(minV)}</td></tr>
    <tr><td>Napi átlag</td><td class="v-bold">${fmtKg(avg)}</td></tr>
    <tr><td>Szórás (kiegyensúlyozottság)</td><td style="color:var(--text2);">${szoras.toFixed(0)} kg</td></tr>
    </tbody></table></div>`;

  if (globalAvg > 0) {
    const col  = diffPct > 0 ? 'var(--green)' : diffPct < 0 ? 'var(--red)' : 'var(--text3)';
    const sign = diffPct > 0 ? '+' : '';
    html += `<div class="card" style="margin-bottom:12px;"><div class="card-title"><span class="card-title-icon">📈</span>Összehasonlítás — üzemi átlag</div>
      <table class="stbl"><thead><tr><th>Mutató</th><th>Érték</th></tr></thead><tbody>
      <tr><td>${esc(nev)} átlaga</td><td class="v-bold">${fmtKg(avg)}</td></tr>
      <tr><td>Üzemi átlag (${esc(anyag)})</td><td style="color:var(--text2);">${fmtKg(globalAvg)}</td></tr>
      ${diffPct !== null ? `<tr><td>Különbség</td><td><span style="color:${col};font-weight:600;">${sign}${diffPct.toFixed(1)}%</span></td></tr>` : ''}
      </tbody></table></div>`;
  }

  html += `<div class="card"><div class="card-title"><span class="card-title-icon">📋</span>Napi bontás</div>
    <table class="stbl"><thead><tr><th>Dátum</th><th>Műszak</th><th>Napi összesen</th></tr></thead><tbody>`;
  perDay.forEach(d => {
    html += `<tr>
      <td>${esc(fmtS(d.datum))}</td>
      <td style="color:var(--text3);">${esc(d.ido || '—')}</td>
      <td class="v-bold">${fmtKg(d.kg)}</td>
    </tr>`;
  });
  html += `</tbody></table></div>`;
  E('egyeniDiv').innerHTML = html;
}

/* ── 2. fül: Anyagtípus rangsor ── */
async function anyagRangsor() {
  const anyag = E('anyagRangsorSel').value;
  if (!anyag) { msg('Válassz anyagot!', 'error'); return; }

  E('anyagRangsorDiv').innerHTML = '<div class="empty-st"><div class="spinner" style="margin:0 auto"></div></div>';
  const entries = await getEntries();

  const byWorkerDay = {};
  entries.filter(a => (a.anyag || '').trim() === anyag).forEach(a => {
    const kg  = (a.sulyok || []).reduce((s, x) => s + x.suly, 0);
    const key = `${a.nev}__${a.datum}`;
    if (!byWorkerDay[key]) byWorkerDay[key] = { nev: a.nev, kg: 0 };
    byWorkerDay[key].kg += kg;
  });
  const byWorker = {};
  Object.values(byWorkerDay).forEach(({ nev, kg }) => {
    if (!byWorker[nev]) byWorker[nev] = [];
    byWorker[nev].push(kg);
  });

  if (!Object.keys(byWorker).length) {
    E('anyagRangsorDiv').innerHTML = `<div class="empty-st"><div class="empty-ic">📭</div>Nincs adat ehhez az anyaghoz</div>`;
    return;
  }

  const rank = Object.entries(byWorker).map(([nev, vals]) => ({
    nev,
    avg:   vals.reduce((s, v) => s + v, 0) / vals.length,
    best:  Math.max(...vals),
    worst: Math.min(...vals),
  })).sort((a, b) => b.avg - a.avg);

  let html = `<div class="r-head">${esc(anyag)} <span class="r-shift">· Rangsor</span></div>`;
  html += `<div class="card"><div class="card-title"><span class="card-title-icon">🏅</span>Dolgozói rangsor — átlagos teljesítmény szerint</div>
    <table class="stbl"><thead><tr><th>#</th><th>Dolgozó</th><th>Átlagos termelés</th><th>Személyes legjobb</th><th>Személyes leggyengébb</th></tr></thead><tbody>`;
  rank.forEach((w, i) => {
    html += `<tr>
      <td style="color:var(--text3);width:28px;">${i + 1}.</td>
      <td style="font-weight:600;color:var(--text);">${esc(w.nev)}</td>
      <td class="v-bold">${fmtKg(w.avg)}</td>
      <td style="color:var(--green);font-weight:600;">${fmtKg(w.best)}</td>
      <td style="color:var(--text3);">${fmtKg(w.worst)}</td>
    </tr>`;
  });
  html += `</tbody></table></div>`;
  E('anyagRangsorDiv').innerHTML = html;
}

/* ── 3. fül: Személyes rekordok ── */
async function rekordok() {
  E('rekordokDiv').innerHTML = '<div class="empty-st"><div class="spinner" style="margin:0 auto"></div></div>';
  const entries = await getEntries();

  if (!entries.length) {
    E('rekordokDiv').innerHTML = `<div class="empty-st"><div class="empty-ic">📭</div>Nincs adat</div>`;
    return;
  }

  const byWorkerDay = {};
  entries.forEach(a => {
    const key = `${a.nev}__${a.datum}`;
    const kg  = (a.sulyok || []).reduce((s, x) => s + x.suly, 0);
    const ak  = (a.anyag || '').trim();
    if (!byWorkerDay[key]) byWorkerDay[key] = { nev: a.nev, datum: a.datum, kg: 0, anyagok: {} };
    byWorkerDay[key].kg += kg;
    if (ak && kg > 0) byWorkerDay[key].anyagok[ak] = (byWorkerDay[key].anyagok[ak] || 0) + kg;
  });

  const byWorker = {};
  Object.values(byWorkerDay).forEach(d => {
    if (!byWorker[d.nev] || d.kg > byWorker[d.nev].kg) byWorker[d.nev] = d;
  });

  const sorted = Object.values(byWorker).sort((a, b) => b.kg - a.kg);

  let html = `<div class="r-head">Személyes rekordok</div>`;
  html += `<div class="card"><div class="card-title"><span class="card-title-icon">🏆</span>Legjobb napi teljesítmény dolgozónként</div>
    <table class="stbl"><thead><tr><th>#</th><th>Dolgozó</th><th>Rekord súly</th><th>Anyag</th><th>Dátum</th></tr></thead><tbody>`;
  sorted.forEach((w, i) => {
    const foAnyag = Object.entries(w.anyagok).sort((a, b) => b[1] - a[1])[0];
    html += `<tr>
      <td style="color:var(--text3);width:28px;">${i + 1}.</td>
      <td style="font-weight:600;color:var(--text);">${esc(w.nev)}</td>
      <td class="v-bold">${fmtKg(w.kg)}</td>
      <td style="color:var(--text2);">${foAnyag ? esc(foAnyag[0]) : '—'}</td>
      <td style="color:var(--text3);font-size:12.5px;">${esc(fmtS(w.datum))}</td>
    </tr>`;
  });
  html += `</tbody></table></div>`;
  E('rekordokDiv').innerHTML = html;
}

/* ── 4. fül: Két dolgozó összehasonlítása ── */
async function osszehasonlitas() {
  const nev1  = E('osszDolg1').value;
  const nev2  = E('osszDolg2').value;
  const anyag = E('osszAnyag').value;
  if (!nev1 || !nev2 || !anyag) { msg('Válassz két dolgozót és egy anyagot!', 'error'); return; }
  if (nev1 === nev2) { msg('Válassz két különböző dolgozót!', 'error'); return; }

  E('osszDiv').innerHTML = '<div class="empty-st"><div class="spinner" style="margin:0 auto"></div></div>';
  const entries = await getEntries();

  function getStats(nev) {
    const wa = entries.filter(a => a.nev === nev && (a.anyag || '').trim() === anyag);
    if (!wa.length) return null;
    const byDay = {};
    wa.forEach(a => {
      const kg = (a.sulyok || []).reduce((s, x) => s + x.suly, 0);
      byDay[a.datum] = (byDay[a.datum] || 0) + kg;
    });
    const perDay = Object.values(byDay).filter(v => v > 0);
    if (!perDay.length) return null;
    const total  = perDay.reduce((s, v) => s + v, 0);
    const avg    = total / perDay.length;
    const best   = Math.max(...perDay);
    const worst  = Math.min(...perDay);
    const szoras = perDay.length > 1
      ? Math.sqrt(perDay.reduce((s, v) => s + Math.pow(v - avg, 2), 0) / perDay.length)
      : 0;
    return { napok: perDay.length, total, avg, best, worst, szoras };
  }

  const s1 = getStats(nev1);
  const s2 = getStats(nev2);

  if (!s1 && !s2) {
    E('osszDiv').innerHTML = `<div class="empty-st"><div class="empty-ic">📭</div>Egyik dolgozónak sincs adata ehhez az anyaghoz</div>`;
    return;
  }

  function statRow(label, v1, v2, fmt, higherBetter = true) {
    if (v1 === null && v2 === null) return '';
    const winner = (v1 !== null && v2 !== null)
      ? (higherBetter ? (v1 > v2 ? 1 : v2 > v1 ? 2 : 0) : (v1 < v2 ? 1 : v2 < v1 ? 2 : 0))
      : 0;
    const c1 = winner === 1 ? 'color:var(--green);font-weight:700;' : 'color:var(--text2);';
    const c2 = winner === 2 ? 'color:var(--green);font-weight:700;' : 'color:var(--text2);';
    const w1 = winner === 1 ? ' ✓' : '';
    const w2 = winner === 2 ? ' ✓' : '';
    return `<tr>
      <td style="color:var(--text2);font-size:13px;">${label}</td>
      <td style="${c1}">${v1 !== null ? fmt(v1) + w1 : '—'}</td>
      <td style="${c2}">${v2 !== null ? fmt(v2) + w2 : '—'}</td>
    </tr>`;
  }

  const fKg = v => `${v.toFixed(0)} kg`;
  const fN  = v => String(v);

  let html = `<div class="r-head">Összehasonlítás <span class="r-shift">· ${esc(anyag)}</span></div>`;

  html += `<div class="card" style="margin-bottom:12px;"><div class="card-title"><span class="card-title-icon">⚖️</span>Statisztikai összehasonlítás</div>
    <table class="stbl"><thead><tr>
      <th>Mutató</th>
      <th style="color:var(--accent);font-size:12px;">${esc(nev1)}</th>
      <th style="color:var(--accent);font-size:12px;">${esc(nev2)}</th>
    </tr></thead><tbody>`;
  html += statRow('Aktív munkanapok', s1?.napok ?? null, s2?.napok ?? null, fN);
  html += statRow('Össztermelés', s1?.total ?? null, s2?.total ?? null, fKg);
  html += statRow('Napi átlag', s1?.avg ?? null, s2?.avg ?? null, fKg);
  html += statRow('Legjobb nap', s1?.best ?? null, s2?.best ?? null, fKg);
  html += statRow('Leggyengébb nap', s1?.worst ?? null, s2?.worst ?? null, fKg);
  html += statRow('Szórás (alacsonyabb = egyenletesebb)', s1?.szoras ?? null, s2?.szoras ?? null, fKg, false);
  html += `</tbody></table></div>`;

  // Visual bar comparison
  if (s1 && s2) {
    const maxAvg  = Math.max(s1.avg, s2.avg);
    const bar1W   = maxAvg > 0 ? Math.round(s1.avg / maxAvg * 100) : 0;
    const bar2W   = maxAvg > 0 ? Math.round(s2.avg / maxAvg * 100) : 0;
    const diffPct = s2.avg > 0 ? ((s1.avg - s2.avg) / s2.avg * 100) : 0;
    const sign    = diffPct >= 0 ? '+' : '';
    const diffCol = diffPct > 0 ? 'var(--green)' : diffPct < 0 ? 'var(--red)' : 'var(--text3)';
    const diffTxt = diffPct >= 0 ? 'több' : 'kevesebb';

    html += `<div class="card"><div class="card-title"><span class="card-title-icon">📊</span>Napi átlag vizuálisan</div>
      <div style="margin-bottom:16px;">
        <div style="font-size:12px;color:var(--text3);margin-bottom:6px;font-weight:600;">${esc(nev1)}</div>
        <div style="height:22px;background:var(--surf2);border-radius:5px;overflow:hidden;">
          <div style="height:100%;width:${bar1W}%;background:var(--accent);border-radius:5px;display:flex;align-items:center;padding:0 8px;box-sizing:border-box;">
            <span style="font-size:11px;color:#fff;font-weight:700;white-space:nowrap;">${s1.avg.toFixed(0)} kg</span>
          </div>
        </div>
      </div>
      <div style="margin-bottom:16px;">
        <div style="font-size:12px;color:var(--text3);margin-bottom:6px;font-weight:600;">${esc(nev2)}</div>
        <div style="height:22px;background:var(--surf2);border-radius:5px;overflow:hidden;">
          <div style="height:100%;width:${bar2W}%;background:var(--accent);border-radius:5px;opacity:.6;display:flex;align-items:center;padding:0 8px;box-sizing:border-box;">
            <span style="font-size:11px;color:#fff;font-weight:700;white-space:nowrap;">${s2.avg.toFixed(0)} kg</span>
          </div>
        </div>
      </div>
      <div style="text-align:center;font-size:13px;color:var(--text2);padding-top:8px;border-top:1px solid var(--border);">
        <strong>${esc(nev1)}</strong> átlaga <span style="color:${diffCol};font-weight:700;">${sign}${diffPct.toFixed(1)}%</span> ${diffTxt} mint <strong>${esc(nev2)}</strong>-é
      </div>
    </div>`;
  } else if (!s1) {
    html += `<div class="empty-st" style="margin-top:8px;"><div class="empty-ic">📭</div>${esc(nev1)}-nek nincs adata ehhez az anyaghoz</div>`;
  } else {
    html += `<div class="empty-st" style="margin-top:8px;"><div class="empty-ic">📭</div>${esc(nev2)}-nek nincs adata ehhez az anyaghoz</div>`;
  }

  E('osszDiv').innerHTML = html;
}

/* ── Inicializálás — lazy, első Elemzés tab-nyitáskor ── */
export async function initElemzes() {
  E('egyeniDiv').innerHTML = '<div class="empty-st"><div class="spinner" style="margin:0 auto"></div></div>';
  await Promise.all([populateWorkers(), populateAnyagSel()]);
  E('egyeniDiv').innerHTML = '<div class="empty-st"><div class="empty-ic">👤</div>Válassz dolgozót és anyagot</div>';

  E('eBtnEgyeni').addEventListener('click',         () => switchETab('Egyeni'));
  E('eBtnAnyagRangsor').addEventListener('click',   () => switchETab('AnyagRangsor'));
  E('eBtnRekordok').addEventListener('click', async () => { switchETab('Rekordok'); await rekordok(); });
  E('eBtnOsszehasonlit').addEventListener('click',  () => switchETab('Osszehasonlit'));

  E('egyeniDolgozo').addEventListener('change', async () => {
    const entries = await getEntries();
    filterMaterials(entries, E('egyeniDolgozo').value);
  });

  E('egyeniBtn').addEventListener('click',      egyeniElemzes);
  E('anyagRangsorBtn').addEventListener('click', anyagRangsor);
  E('osszBtn').addEventListener('click',         osszehasonlitas);
}
