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

export function toggleTheme() {
  const dark = document.documentElement.getAttribute('data-theme') === 'dark';
  document.documentElement.setAttribute('data-theme', dark ? 'light' : 'dark');
  E('themeBtn').textContent = dark ? '🌙 Sötét' : '☀️ Világos';
  localStorage.setItem('napiJelentesTheme', dark ? 'light' : 'dark');
}

export function initTheme() {
  const t = localStorage.getItem('napiJelentesTheme') || 'light';
  document.documentElement.setAttribute('data-theme', t);
  E('themeBtn').textContent = t === 'dark' ? '☀️ Világos' : '🌙 Sötét';
}

export function showScreen(name) {
  ['loading','login','pending','app'].forEach(s => {
    const el = E('screen-' + s);
    if (el) el.style.display = s === name ? (s === 'app' ? 'block' : 'flex') : 'none';
  });
}
