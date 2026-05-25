import { fetchEntries } from './db.js';
import { E, esc, msg, fmtKg, fmtS } from './utils.js';

export async function elemzesRiport() {
  const ev    = parseInt(E('elemzesEv').value);
  const honap = parseInt(E('elemzesHonap').value);
  const prefix  = `${ev}-${String(honap + 1).padStart(2, '0')}`;
  const lastDay = new Date(ev, honap + 1, 0).getDate();
  const from    = `${prefix}-01`, to = `${prefix}-${String(lastDay).padStart(2, '0')}`;

  E('elemzesDiv').innerHTML = '<div class="empty-st"><div class="spinner" style="margin:0 auto"></div></div>';

  const entries = await fetchEntries({ datumFrom: from, datumTo: to });
  if (!entries.length) {
    E('elemzesDiv').innerHTML = `<div class="empty-st"><div class="empty-ic">📭</div>Nincs adat erre a hónapra</div>`;
    return;
  }

  const workers = {};
  entries.forEach(a => {
    if (!workers[a.nev]) workers[a.nev] = { totalS: 0, totalZ: 0, napok: new Set(), byNap: {}, anyagok: {} };
    const s = (a.sulyok || []).reduce((x, y) => x + y.suly, 0);
    const z = (a.zsakSulyok || []).reduce((x, y) => x + y, 0);
    workers[a.nev].totalS += s;
    workers[a.nev].totalZ += z;
    workers[a.nev].napok.add(a.datum);
    if (!workers[a.nev].byNap[a.datum]) workers[a.nev].byNap[a.datum] = 0;
    workers[a.nev].byNap[a.datum] += s;
    const ak = (a.anyag || '').trim(); if (!ak) return;
    if (!workers[a.nev].anyagok[ak]) workers[a.nev].anyagok[ak] = 0;
    workers[a.nev].anyagok[ak] += s;
  });

  const anyagTotals = {};
  entries.forEach(a => {
    const ak = (a.anyag || '').trim(); if (!ak) return;
    if (!anyagTotals[ak]) anyagTotals[ak] = 0;
    anyagTotals[ak] += (a.sulyok || []).reduce((x, y) => x + y.suly, 0);
  });

  const honNev = ['Január','Február','Március','Április','Május','Június','Július','Augusztus','Szeptember','Október','November','December'];
  let html = `<div class="r-head">${ev}. ${honNev[honap]} — Elemzés</div>`;

  /* ── Dolgozói teljesítmény ── */
  html += `<div class="card" style="margin-bottom:12px;"><div class="card-title"><span class="card-title-icon">👤</span>Dolgozói teljesítmény</div>
    <table class="stbl"><thead><tr><th>Dolgozó</th><th>Darált</th><th>Zsákok</th><th>Napok</th><th>Napi átlag</th><th>Legjobb nap</th></tr></thead><tbody>`;
  Object.keys(workers).sort((a, b) => workers[b].totalS - workers[a].totalS).forEach(n => {
    const w = workers[n];
    const napSzam = w.napok.size;
    const atlag   = napSzam > 0 ? w.totalS / napSzam : 0;
    const bestDay = Object.entries(w.byNap).sort((a, b) => b[1] - a[1])[0];
    const bestDayStr = bestDay ? `${fmtS(bestDay[0])}: ${bestDay[1].toFixed(0)} kg` : '—';
    html += `<tr>
      <td style="font-weight:600;color:var(--text);">${esc(n)}</td>
      <td class="v-bold">${fmtKg(w.totalS)}</td>
      <td class="v-green" style="font-weight:600;">${w.totalZ > 0 ? fmtKg(w.totalZ) : '—'}</td>
      <td style="color:var(--text3);">${napSzam}</td>
      <td>${atlag > 0 ? atlag.toFixed(0) + ' kg' : '—'}</td>
      <td style="color:var(--text3);font-size:12px;">${esc(bestDayStr)}</td>
    </tr>`;
  });
  html += `</tbody></table></div>`;

  /* ── Anyag rangsor ── */
  const anyagRank = Object.entries(anyagTotals).sort((a, b) => b[1] - a[1]);
  if (anyagRank.length > 0) {
    const totalMind = anyagRank.reduce((s, [, v]) => s + v, 0);
    html += `<div class="card" style="margin-bottom:12px;"><div class="card-title"><span class="card-title-icon">📦</span>Anyag rangsor</div>
      <table class="stbl"><thead><tr><th>#</th><th>Anyag</th><th>Összesen</th><th>Arány</th></tr></thead><tbody>`;
    anyagRank.forEach(([anyag, kg], i) => {
      const pct = totalMind > 0 ? (kg / totalMind * 100).toFixed(1) : 0;
      const barW = Math.round(Math.min(parseFloat(pct), 100) * 0.8);
      html += `<tr>
        <td style="color:var(--text3);width:28px;">${i + 1}.</td>
        <td style="font-weight:600;">${esc(anyag)}</td>
        <td class="v-bold">${fmtKg(kg)}</td>
        <td><div style="display:flex;align-items:center;gap:8px;">
          <div style="height:6px;width:${barW}px;max-width:80px;background:var(--accent);border-radius:3px;opacity:.65;flex-shrink:0;"></div>
          <span style="color:var(--text3);font-size:12px;">${pct}%</span>
        </div></td>
      </tr>`;
    });
    html += `</tbody></table></div>`;
  }

  /* ── Egyéni rekordok ── */
  html += `<div class="card"><div class="card-title"><span class="card-title-icon">🏅</span>Egyéni rekordok</div>
    <table class="stbl"><thead><tr><th>Dolgozó</th><th>Legjobb nap</th><th>Legtöbb anyag</th></tr></thead><tbody>`;
  Object.keys(workers).sort((a, b) => a.localeCompare(b, 'hu')).forEach(n => {
    const w = workers[n];
    const bestDay   = Object.entries(w.byNap).sort((a, b) => b[1] - a[1])[0];
    const bestAnyag = Object.entries(w.anyagok).sort((a, b) => b[1] - a[1])[0];
    html += `<tr>
      <td style="font-weight:600;color:var(--text);">${esc(n)}</td>
      <td>${bestDay ? `<strong>${bestDay[1].toFixed(0)} kg</strong> <span style="color:var(--text3);font-size:12px;">(${esc(fmtS(bestDay[0]))})</span>` : '—'}</td>
      <td>${bestAnyag ? `<strong>${esc(bestAnyag[0])}</strong> <span style="color:var(--text3);font-size:12px;">(${bestAnyag[1].toFixed(0)} kg)</span>` : '—'}</td>
    </tr>`;
  });
  html += `</tbody></table></div>`;

  E('elemzesDiv').innerHTML = html;
}
