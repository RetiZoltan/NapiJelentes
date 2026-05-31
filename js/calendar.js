import { fetchEntries } from './db.js';
import { E, tod } from './utils.js';

const HU_MONTHS       = ['Január','Február','Március','Április','Május','Június','Július','Augusztus','Szeptember','Október','November','December'];
const HU_MONTHS_SHORT = ['Jan','Feb','Már','Ápr','Máj','Jún','Júl','Aug','Sze','Okt','Nov','Dec'];
const HU_DAYS         = ['H','K','Sze','Cs','P','Szo','V'];

let calYear, calMonth;
let heatYear;
let calView = 'monthly'; // 'monthly' | 'yearly'
let _inited = false;

/* Kék → Türkiz → Zöld → Sárgazöld → Narancs gradiens a termelési szint szerint */
function _productionColor(ratio) {
  if (ratio <= 0) return { bg: '', text: 'inherit' };
  const hue   = Math.round(212 - ratio * 182); // 212 (kék) → 30 (narancs)
  const sat   = Math.round(58  + ratio * 22);  // 58 → 80%
  const light = Math.round(74  - ratio * 30);  // 74 → 44%
  return { bg: `hsl(${hue},${sat}%,${light}%)`, text: light < 58 ? '#fff' : 'inherit' };
}

const LEGEND_HTML = `<div class="cal-legend">
  <div class="cal-leg-item"><div class="cal-leg-dot" style="background:var(--surf2);border:1px solid var(--border);"></div><span>Nincs adat</span></div>
  <div class="cal-leg-item"><div class="cal-leg-dot" style="background:hsl(200,60%,70%);"></div><span>Alacsony</span></div>
  <div class="cal-leg-item"><div class="cal-leg-dot" style="background:hsl(155,62%,55%);"></div><span>Közepes</span></div>
  <div class="cal-leg-item"><div class="cal-leg-dot" style="background:hsl(88,68%,50%);"></div><span>Jó</span></div>
  <div class="cal-leg-item"><div class="cal-leg-dot" style="background:hsl(30,80%,52%);"></div><span>Magas</span></div>
</div>`;

export async function initNaptar() {
  if (!_inited) {
    _inited = true;
    const now = new Date();
    calYear  = now.getFullYear();
    calMonth = now.getMonth();
    heatYear = now.getFullYear();

    E('naptarPrevBtn').addEventListener('click', async () => {
      if (calView === 'monthly') {
        calMonth--; if (calMonth < 0) { calMonth = 11; calYear--; }
        await renderCalendar();
      } else {
        heatYear--;
        await renderHeatmap();
      }
    });
    E('naptarNextBtn').addEventListener('click', async () => {
      if (calView === 'monthly') {
        calMonth++; if (calMonth > 11) { calMonth = 0; calYear++; }
        await renderCalendar();
      } else {
        heatYear++;
        await renderHeatmap();
      }
    });

    E('calViewHavi').addEventListener('click', async () => {
      if (calView === 'monthly') return;
      calView = 'monthly';
      E('calViewHavi').classList.add('active');
      E('calViewEves').classList.remove('active');
      await renderCalendar();
    });
    E('calViewEves').addEventListener('click', async () => {
      if (calView === 'yearly') return;
      calView = 'yearly';
      E('calViewEves').classList.add('active');
      E('calViewHavi').classList.remove('active');
      await renderHeatmap();
    });

    // Preview popup handlers
    E('calPreviewClose').addEventListener('click', _closePreview);
    E('calPreviewBackdrop').addEventListener('click', _closePreview);
    E('calPreviewGotoBtn').addEventListener('click', () => {
      const datum = E('calPreviewGotoBtn').dataset.datum;
      _closePreview();
      if (datum) {
        E('riportD').value = datum;
        document.dispatchEvent(new CustomEvent('napi-goto'));
      }
    });
  }
  await renderCalendar();
}

function _showCalPreview(datum, kg, byDay) {
  const vals = Object.values(byDay).filter(v => v > 0);
  const avg  = vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : 0;

  const d       = new Date(datum + 'T12:00:00');
  const fmtDate = d.toLocaleDateString('hu-HU', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });

  let content = `<div class="cprev-date">${fmtDate}</div>`;
  if (kg > 0) {
    const diffPct  = avg > 0 && vals.length > 1 ? ((kg - avg) / avg * 100) : null;
    const diffSign = diffPct !== null && diffPct > 0 ? '+' : '';
    const diffCol  = diffPct !== null ? (diffPct > 0 ? 'var(--green)' : diffPct < 0 ? 'var(--red)' : 'var(--text3)') : '';
    content += `<div class="cprev-kg">${(kg / 1000).toFixed(2)} t<span class="cprev-kgsmall"> (${kg.toFixed(0)} kg)</span></div>`;
    if (diffPct !== null) {
      content += `<div class="cprev-diff" style="color:${diffCol}">${diffSign}${diffPct.toFixed(1)}% az átlaghoz képest</div>`;
    }
  } else {
    content += `<div class="cprev-empty">Ezen a napon nincs termelési adat</div>`;
  }

  E('calPreviewContent').innerHTML = content;
  E('calPreviewGotoBtn').dataset.datum = datum;
  E('calPreview').style.display = 'flex';
}

function _closePreview() {
  E('calPreview').style.display = 'none';
}

async function renderCalendar() {
  E('naptarHonap').textContent = `${calYear}. ${HU_MONTHS[calMonth]}`;
  E('naptarGrid').innerHTML = '<div style="text-align:center;padding:30px;"><div class="spinner"></div></div>';

  const prefix  = `${calYear}-${String(calMonth + 1).padStart(2, '0')}`;
  const lastDay = new Date(calYear, calMonth + 1, 0).getDate();
  const entries = await fetchEntries({
    datumFrom: `${prefix}-01`,
    datumTo:   `${prefix}-${String(lastDay).padStart(2, '0')}`
  });

  const byDay = {};
  entries.forEach(a => {
    const kg = (a.sulyok || []).reduce((s, x) => s + x.suly, 0);
    if (kg > 0) byDay[a.datum] = (byDay[a.datum] || 0) + kg;
  });

  const vals  = Object.values(byDay);
  const maxKg = vals.length ? Math.max(...vals) : 1;
  const total = vals.reduce((s, v) => s + v, 0);
  const avg   = vals.length ? total / vals.length : 0;
  const today = tod();

  const firstDow = new Date(calYear, calMonth, 1).getDay();
  const startOff = (firstDow + 6) % 7;

  let html = '<div class="cal-grid">';
  HU_DAYS.forEach(d => { html += `<div class="cal-hd">${d}</div>`; });
  for (let i = 0; i < startOff; i++) html += '<div class="cal-cell cal-empty"></div>';

  for (let day = 1; day <= lastDay; day++) {
    const datum = `${prefix}-${String(day).padStart(2, '0')}`;
    const kg    = byDay[datum] || 0;
    let style = '', kgHtml = '';

    if (kg > 0) {
      const c = _productionColor(kg / maxKg);
      style  = `background:${c.bg};color:${c.text};`;
      kgHtml = `<div class="cal-kg">${(kg / 1000).toFixed(2)} t</div>`;
    }

    const cls = ['cal-cell', kg > 0 ? 'cal-has' : '', datum === today ? 'cal-today' : ''].filter(Boolean).join(' ');
    html += `<div class="${cls}" style="${style}" data-datum="${datum}" title="${kg > 0 ? kg.toFixed(0) + ' kg' : 'Nincs adat'}">
      <div class="cal-day">${day}</div>${kgHtml}</div>`;
  }
  html += '</div>';

  if (vals.length) {
    html += `<div class="cal-summary">
      <span><strong>${vals.length}</strong> aktív nap</span>
      <span><strong>${(total / 1000).toFixed(2)} t</strong> összesen</span>
      <span><strong>${(avg / 1000).toFixed(2)} t</strong> napi átlag</span>
    </div>`;
  }

  html += LEGEND_HTML;

  E('naptarGrid').innerHTML = html;

  E('naptarGrid').querySelectorAll('.cal-cell[data-datum]').forEach(cell => {
    cell.addEventListener('click', () => {
      _showCalPreview(cell.dataset.datum, byDay[cell.dataset.datum] || 0, byDay);
    });
  });
}

async function renderHeatmap() {
  E('naptarHonap').textContent = `${heatYear}. év`;
  E('naptarGrid').innerHTML = '<div style="text-align:center;padding:30px;"><div class="spinner"></div></div>';

  const isLeap    = (heatYear % 4 === 0 && (heatYear % 100 !== 0 || heatYear % 400 === 0));
  const daysInYear = isLeap ? 366 : 365;
  const jan1      = new Date(heatYear, 0, 1);
  const firstDow  = (jan1.getDay() + 6) % 7; // Monday=0, Sunday=6
  const totalWeeks = Math.ceil((daysInYear + firstDow) / 7);

  const entries = await fetchEntries({
    datumFrom: `${heatYear}-01-01`,
    datumTo:   `${heatYear}-12-31`
  });

  const byDay = {};
  entries.forEach(a => {
    const kg = (a.sulyok || []).reduce((s, x) => s + x.suly, 0);
    if (kg > 0) byDay[a.datum] = (byDay[a.datum] || 0) + kg;
  });

  const vals  = Object.values(byDay);
  const maxKg = vals.length ? Math.max(...vals) : 1;
  const total = vals.reduce((s, v) => s + v, 0);
  const today = tod();

  // Month label positions (week index of each month's 1st day)
  const monthWeekIdx = [];
  for (let m = 0; m < 12; m++) {
    const firstOfMonth = new Date(heatYear, m, 1);
    const dayOfYear    = Math.round((firstOfMonth - jan1) / 86400000);
    monthWeekIdx.push(Math.floor((dayOfYear + firstDow) / 7));
  }

  // Month labels row (positioned by week index, each cell = 13px + 3px gap = 16px)
  let html = '<div class="heat-month-row">';
  monthWeekIdx.forEach((wIdx, m) => {
    html += `<span class="heat-month-lbl" style="left:${wIdx * 16}px">${HU_MONTHS_SHORT[m]}</span>`;
  });
  html += '</div>';

  // Grid: day labels + week columns
  html += '<div class="heat-wrapper"><div class="heat-days">';
  ['H', '', 'Sze', '', 'P', '', 'V'].forEach(d => { html += `<span>${d}</span>`; });
  html += '</div><div class="heat-weeks">';

  for (let week = 0; week < totalWeeks; week++) {
    html += '<div class="heat-week">';
    for (let dow = 0; dow < 7; dow++) {
      const dayIdx = week * 7 + dow - firstDow;
      if (dayIdx < 0 || dayIdx >= daysInYear) {
        html += '<div class="heat-cell heat-empty"></div>';
        continue;
      }
      const date  = new Date(heatYear, 0, dayIdx + 1);
      const datum = date.toISOString().split('T')[0];
      const kg    = byDay[datum] || 0;
      let style = '';
      if (kg > 0) {
        const c = _productionColor(kg / maxKg);
        style = `background:${c.bg}`;
      }
      const isToday = datum === today ? ' heat-today' : '';
      const title   = kg > 0 ? `${datum}: ${(kg / 1000).toFixed(2)} t` : datum;
      html += `<div class="heat-cell${isToday}" style="${style}" title="${title}" data-datum="${datum}" data-kg="${kg}"></div>`;
    }
    html += '</div>';
  }
  html += '</div></div>'; // heat-weeks + heat-wrapper

  if (vals.length) {
    html += `<div class="cal-summary" style="margin-top:12px;">
      <span><strong>${vals.length}</strong> aktív nap</span>
      <span><strong>${(total / 1000).toFixed(2)} t</strong> összesen</span>
      <span><strong>${((total / 1000) / vals.length).toFixed(2)} t</strong> napi átlag</span>
    </div>`;
  } else {
    html += `<div class="empty-st" style="margin-top:16px;"><div class="empty-ic">📭</div>Nincs adat ${heatYear}. évre</div>`;
  }

  html += LEGEND_HTML;

  E('naptarGrid').innerHTML = html;

  E('naptarGrid').querySelectorAll('.heat-cell[data-datum]').forEach(cell => {
    cell.addEventListener('click', () => {
      _showCalPreview(cell.dataset.datum, parseFloat(cell.dataset.kg) || 0, byDay);
    });
  });
}
