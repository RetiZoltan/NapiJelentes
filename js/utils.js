export const E = id => document.getElementById(id);

export function esc(s) {
  if (typeof s !== 'string') return '';
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
}

export function ag(ta) {
  if (!ta) return;
  ta.style.height = 'auto';
  ta.style.height = ta.scrollHeight + 'px';
}

export function tod()           { return new Date().toISOString().split('T')[0]; }
export function monday(d)       { const dt=new Date(d+'T12:00:00'),day=dt.getDay(); dt.setDate(dt.getDate()+(day===0?-6:1-day)); return dt.toISOString().split('T')[0]; }
export function addD(d, n)      { const dt=new Date(d+'T12:00:00'); dt.setDate(dt.getDate()+n); return dt.toISOString().split('T')[0]; }
export function fmtL(d)         { return new Date(d+'T12:00:00').toLocaleDateString('hu-HU',{year:'numeric',month:'long',day:'numeric',weekday:'long'}); }
export function fmtS(d)         { return new Date(d+'T12:00:00').toLocaleDateString('hu-HU',{month:'short',day:'numeric',weekday:'short'}); }

let toastT = null;
export function msg(text, type='success', ms=2800) {
  const t = E('toast');
  E('tmsg').textContent = text;
  t.className = 'toast ' + type + ' show';
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove('show'), ms);
}

function _setThemeBtn(isDark) {
  const icon = document.getElementById('themeBtnIcon');
  const lbl  = document.querySelector('.theme-lbl');
  if (icon) icon.textContent = isDark ? '☀️' : '🌙';
  if (lbl)  lbl.textContent  = isDark ? ' Világos' : ' Sötét';
}

export function toggleTheme() {
  const dark = document.documentElement.getAttribute('data-theme') === 'dark';
  document.documentElement.setAttribute('data-theme', dark ? 'light' : 'dark');
  _setThemeBtn(!dark);
  localStorage.setItem('napiJelentesTheme', dark ? 'light' : 'dark');
}

export function initTheme() {
  const t = localStorage.getItem('napiJelentesTheme') || 'light';
  document.documentElement.setAttribute('data-theme', t);
  _setThemeBtn(t === 'dark');
}

export function applyLayout(name) {
  const l = name || 'classic';
  if (l === 'classic') {
    document.documentElement.removeAttribute('data-layout');
  } else {
    document.documentElement.setAttribute('data-layout', l);
  }
  localStorage.setItem('napiJelentesLayout', l);
  document.querySelectorAll('.layout-opt').forEach(b =>
    b.classList.toggle('active', b.dataset.layout === l)
  );
}

export function initLayout() {
  const l = localStorage.getItem('napiJelentesLayout') || 'classic';
  applyLayout(l);
}

export function applyColorTheme(name) {
  const c = name || 'plexiq';
  if (c === 'blueprint') {
    document.documentElement.removeAttribute('data-color');
  } else {
    document.documentElement.setAttribute('data-color', c);
  }
  localStorage.setItem('napiJelentesDizajn', c);
  document.querySelectorAll('.color-swatch').forEach(s => {
    const wrap = s.closest('.color-swatch-wrap');
    s.classList.toggle('active', wrap?.dataset.color === c);
  });
}

export function initColorTheme() {
  const c = localStorage.getItem('napiJelentesDizajn') || 'plexiq';
  applyColorTheme(c);
}

export function fmtKg(kg) {
  if (!kg || isNaN(+kg) || +kg <= 0) return '—';
  const v = +kg, t = v / 1000;
  return t >= 0.1
    ? `${v.toFixed(0)} kg <span style="font-size:.82em;opacity:.55;font-weight:400;">(${t.toFixed(2)} t)</span>`
    : `${v.toFixed(0)} kg`;
}

export function emptyHtml(icon, title, subtitle = '') {
  return `<div class="empty-st"><div class="empty-ic">${icon}</div><div class="empty-title">${esc(title)}</div>${subtitle ? `<div class="empty-sub">${esc(subtitle)}</div>` : ''}</div>`;
}

export function skelHtml(type = 'report') {
  const line = (w) => `<div class="sk sk-h ${w}" style="margin-bottom:9px;"></div>`;
  if (type === 'report') {
    const card = (lines) => `<div class="sk-card">
      <div class="sk sk-title"></div>${lines.map(line).join('')}</div>`;
    return `<div class="sk-wrap">
      ${card(['w90','w70','w50'])}${card(['w90','w60','w40'])}</div>`;
  }
  if (type === 'tasks') {
    const item = () => `<div class="sk-card" style="display:flex;gap:10px;align-items:flex-start;padding:13px 14px;">
      <div class="sk sk-circ" style="width:10px;height:10px;margin-top:5px;flex-shrink:0;"></div>
      <div style="flex:1;">${line('w70')}${line('w50')}</div></div>`;
    return `<div class="sk-wrap">${item()}${item()}${item()}</div>`;
  }
  if (type === 'grid') {
    const card = () => `<div class="sk-card" style="display:flex;gap:12px;align-items:flex-start;">
      <div class="sk sk-circ" style="width:44px;height:44px;flex-shrink:0;"></div>
      <div style="flex:1;">${line('w60')}${line('w40')}</div></div>`;
    return `<div class="emp-grid">${card()}${card()}${card()}</div>`;
  }
  return `<div class="sk-wrap">${line('w90')}${line('w70')}${line('w50')}</div>`;
}

export function showScreen(name) {
  ['loading','login','pending','app'].forEach(s => {
    const el = E('screen-' + s);
    if (el) el.style.display = s === name ? (s === 'app' ? 'block' : 'flex') : 'none';
  });
}
