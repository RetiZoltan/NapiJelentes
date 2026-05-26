import { fetchEntries } from './db.js';
import { E, tod } from './utils.js';

const HU_MONTHS = ['Január','Február','Március','Április','Május','Június','Július','Augusztus','Szeptember','Október','November','December'];
const HU_DAYS   = ['H','K','Sze','Cs','P','Szo','V'];

let calYear, calMonth;
let _inited = false;

export async function initNaptar() {
  if (!_inited) {
    _inited = true;
    const now = new Date();
    calYear  = now.getFullYear();
    calMonth = now.getMonth();
    E('naptarPrevBtn').addEventListener('click', async () => {
      calMonth--; if (calMonth < 0) { calMonth = 11; calYear--; }
      await renderCalendar();
    });
    E('naptarNextBtn').addEventListener('click', async () => {
      calMonth++; if (calMonth > 11) { calMonth = 0; calYear++; }
      await renderCalendar();
    });
  }
  await renderCalendar();
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

  // Monday-first offset: Sun=0 → offset=6, Mon=1 → offset=0, …
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
      const ratio = kg / maxKg;
      const sat   = Math.round(42 + ratio * 28);
      const light = Math.round(82 - ratio * 47);
      const textC = light < 54 ? '#fff' : 'inherit';
      style  = `background:hsl(142,${sat}%,${light}%);color:${textC};`;
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

  html += `<div class="cal-legend">
    <div class="cal-leg-item"><div class="cal-leg-dot" style="background:var(--surf2);border:1px solid var(--border);"></div><span>Nincs adat</span></div>
    <div class="cal-leg-item"><div class="cal-leg-dot" style="background:hsl(142,52%,73%);"></div><span>Alacsony</span></div>
    <div class="cal-leg-item"><div class="cal-leg-dot" style="background:hsl(142,62%,55%);"></div><span>Közepes</span></div>
    <div class="cal-leg-item"><div class="cal-leg-dot" style="background:hsl(142,70%,35%);"></div><span>Magas</span></div>
  </div>`;

  E('naptarGrid').innerHTML = html;

  E('naptarGrid').querySelectorAll('.cal-cell[data-datum]').forEach(cell => {
    cell.addEventListener('click', () => {
      E('riportD').value = cell.dataset.datum;
      document.dispatchEvent(new CustomEvent('napi-goto'));
    });
  });
}
