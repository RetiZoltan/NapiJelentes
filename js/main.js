import { auth, db, doc, getDoc, setDoc, updateDoc, deleteDoc,
         collection, query, limit, getDocs, serverTimestamp,
         onAuthStateChanged, signInWithPopup, GoogleAuthProvider,
         createUserWithEmailAndPassword, signInWithEmailAndPassword,
         signOut, updateProfile } from './firebase.js';
import { state, isMainAdmin, hasPerm, canSeeAllReports, canManageUsers } from './state.js';
import { E, msg, ag, tod, initTheme, toggleTheme, showScreen,
         applyColorTheme, initColorTheme,
         applyLayout, initLayout } from './utils.js';
import { loadLists, refreshListUI, saveNapiFor, loadNapiFor,
         addToList, autoAddToList, delFromList, editItem } from './db.js';
import { addSuly, addZsak, rogzit, clearF, startEditEntry,
         syncOfflineQueue, getOfflineCount } from './data-entry.js';
import { napiRiport, haviRiport, evesRiport, egyeniRiport,
         napiKepMent, idoszakosKepMent,
         napiPdfMent, idoszakosPdfMent,
         napiNyomtat, idoszakosNyomtat,
         riportKlikk, napTorol, cleanupNapiListener, rerenderNapi } from './reports.js';
import { loadTasks, saveTask, handleTaskClick } from './tasks.js';
import { loadAdminUsers, loadRoles, saveRole, cancelRoleForm,
         handleRoleListClick, mentFajl, betoltFajl, mindTorol,
         loadNoticeAdmin, saveNotice, clearNotice } from './admin.js';
import { initElemzes } from './worker-analysis.js';
import { initNaptar } from './calendar.js';
import { initPremiumTab, initPremiumAdmin, savePremiumAdminConfig } from './premium.js';
import { loadEmployees, renderEmployeeGrid, openEmpForm, closeEmpForm, saveEmployee,
         handleEmpGridClick, loadAbsences, saveAbsence, handleAbsenceClick,
         loadCalendar, loadStatisztika, exportCsv,
         closeEmpDrawer, canEditEmp } from './employees.js';

let _prevReszleg = '';
let _prevIdo = '';

/* ── Bootstrap / user setup ── */
async function ensureUserDoc(fbUser) {
  const ref  = doc(db, 'users', fbUser.uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, {
      email:       fbUser.email || '',
      displayName: fbUser.displayName || fbUser.email || 'Ismeretlen',
      roleId:      null,
      isMainAdmin: false,
      createdAt:   serverTimestamp()
    });
    if (location.hash.includes('setup')) {
      const q = query(collection(db, 'users'), limit(2));
      const s = await getDocs(q);
      if (s.size === 1) {
        await updateDoc(ref, { isMainAdmin: true });
        history.replaceState(null, '', location.pathname);
      }
    }
  }
  return (await getDoc(ref)).data();
}

async function loadUserContext(fbUser) {
  try {
    const ud = await ensureUserDoc(fbUser);
    state.userData = ud;
    state.userRole = null;
    if (ud.roleId) {
      const rs = await getDoc(doc(db, 'roles', ud.roleId));
      if (rs.exists()) state.userRole = rs.data();
    }
    if (!ud.isMainAdmin && !ud.roleId) {
      E('pendingEmail').textContent = fbUser.email;
      showScreen('pending');
      return;
    }
    buildAppUI();
    showScreen('app');
  } catch (e) {
    console.error(e);
    msg('Hiba a betöltés során: ' + e.message, 'error', 6000);
    showScreen('login');
  }
}

/* ── App UI init ── */
function buildAppUI() {
  const name = state.userData.displayName || state.appUser.email;
  E('userNameChip').textContent = name;
  E('userAvatar').textContent   = (name[0] || '?').toUpperCase();

  E('tabBtnAdatbevitel').style.display = hasPerm('adatbevitel')                                      ? '' : 'none';
  E('tabBtnJelentesek').style.display  = (hasPerm('sajatJelentes') || hasPerm('mindenJelentes'))     ? '' : 'none';
  E('tabBtnNaptar').style.display      = (hasPerm('naptar') || hasPerm('sajatJelentes') || hasPerm('mindenJelentes'))    ? '' : 'none';
  E('tabBtnElemzes').style.display     = (hasPerm('elemzes') || hasPerm('sajatJelentes') || canSeeAllReports())           ? '' : 'none';
  E('tabBtnFeladatok').style.display   = (isMainAdmin() || state.userRole) ? '' : 'none';
  E('tabBtnDolgozok').style.display    = (isMainAdmin() || hasPerm('dolgozokMegtekintes') || hasPerm('dolgozokKezeles')) ? '' : 'none';
  E('tabBtnPremium').style.display     = (isMainAdmin() || hasPerm('premiumMegtekintes') || hasPerm('premiumKezeles')) ? '' : 'none';
  E('tabBtnAdmin').style.display       = canManageUsers()                                             ? '' : 'none';

  E('stab-roles-btn').style.display        = isMainAdmin() ? '' : 'none';
  E('stab-kozlemeny-btn').style.display    = canManageUsers() ? '' : 'none';
  E('stab-premium-cfg-btn').style.display  = (isMainAdmin() || hasPerm('premiumKezeles')) ? '' : 'none';
  E('stab-data-btn').style.display         = isMainAdmin() ? '' : 'none';
  E('napTorBtn').style.display      = isMainAdmin() ? '' : 'none';
  E('dolgSzuroWrap').style.display  = canSeeAllReports() ? '' : 'none';

  E('nev').value    = '';
  E('reszleg').value = '';
  state.prevDatum = tod();
  E('datum').value   = state.prevDatum;
  E('riportD').value = state.prevDatum;

  // Restore pinned reszleg from localStorage
  const savedReszleg = localStorage.getItem('pinnedReszleg');
  if (savedReszleg !== null) {
    state.isReszlegPinned = true;
    E('reszleg').value = savedReszleg;
    E('pinReszlegBtn').style.background = 'var(--accent)';
    E('pinReszlegBtn').style.color      = '#fff';
    E('pinReszlegBtn').title = 'Részleg rögzítve — kattints a feloldáshoz';
  }
  _prevReszleg = E('reszleg').value.trim();
  _prevIdo     = E('ido').value;

  const now = new Date();
  const yr  = now.getFullYear();
  const mo  = now.getMonth() + 1;
  E('haviHonapInput').value = `${yr}-${String(mo).padStart(2, '0')}`;
  E('evesEvInput').value    = yr;


  applyColorTheme(state.userData.colorTheme || 'blueprint');
  applyLayout(state.userData.layout || 'classic');
  loadLists().then(() => _updateFeladatReszlegF());
  loadAndDisplayNotice();
  addSuly(); addZsak();

  if (!hasPerm('adatbevitel') && (hasPerm('sajatJelentes') || hasPerm('mindenJelentes'))) {
    switchTab('jelentesek', E('tabBtnJelentesek'));
  } else if (!hasPerm('adatbevitel') && canManageUsers()) {
    switchTab('admin', E('tabBtnAdmin'));
  }
}

/* ── Tab navigation ── */
function switchTab(name, btn) {
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  E('tab-' + name).classList.add('active');
  btn.classList.add('active');
  if (typeof _updateFab === 'function') _updateFab();
  if (name === 'admin')     loadAdminUsers();
  if (name === 'adatbevitel') loadAndDisplayNotice();
  if (name !== 'jelentesek') cleanupNapiListener();
  if (name === 'naptar')    initNaptar();
  if (name === 'feladatok') loadTasks();
  if (name === 'dolgozok')  { loadEmployees(); _setupDolgozokUI(); }
  if (name === 'premium')   initPremiumTab();
  if (name === 'elemzes' && !switchTab._elemzesInited) {
    switchTab._elemzesInited = true;
    initElemzes();
  }
}

async function loadAndDisplayNotice() {
  try {
    const s = await getDoc(doc(db, 'config', 'notice'));
    const banner = E('noticeBanner');
    if (s.exists() && s.data().text) {
      const d = s.data();
      const icons = { info: 'ℹ️', warning: '⚠️', success: '✅' };
      E('noticeBannerIcon').textContent = icons[d.type] || 'ℹ️';
      E('noticeBannerMsg').textContent  = d.text;
      banner.className = `notice-banner active ${d.type || 'info'}`;
    } else {
      banner.className = 'notice-banner';
    }
  } catch {}
}

function switchJelentesekSubtab(name) {
  document.querySelectorAll('#jelentesekSubtabs .stab-btn').forEach(b => b.classList.remove('active'));
  document.querySelector(`#jelentesekSubtabs .stab-btn[data-jstab="${name}"]`).classList.add('active');
  document.querySelectorAll('.jstab-panel').forEach(p => p.classList.remove('active'));
  E('jstab-' + name).classList.add('active');
  if (name !== 'napi') cleanupNapiListener();
}

function switchDolgozokSubtab(name) {
  document.querySelectorAll('#dolgozokSubtabs .stab-btn').forEach(b => b.classList.remove('active'));
  document.querySelector(`#dolgozokSubtabs .stab-btn[data-dtab="${name}"]`).classList.add('active');
  document.querySelectorAll('.dtab-panel').forEach(p => p.classList.remove('active'));
  E('dtab-' + name).classList.add('active');
  if (name === 'hianyok') loadAbsences();
}

let _dolgozokUISetup = false;
function _setupDolgozokUI() {
  if (_dolgozokUISetup) return;
  _dolgozokUISetup = true;
  const ce  = canEditEmp();
  E('ujDolgozoWrap').style.display = ce ? '' : 'none';
  E('hianyFormWrap').style.display = ce ? '' : 'none';
  const now = new Date();
  const mo  = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  if (!E('hianyHonapF').value)  E('hianyHonapF').value  = mo;
  if (!E('naptarHonapF').value) E('naptarHonapF').value = mo;
  if (!E('statEvF').value)      E('statEvF').value      = now.getFullYear();
}

function _updateOnlineStatus() {
  const online = navigator.onLine;
  E('offlineBanner').style.display = online ? 'none' : 'flex';
  const cnt = getOfflineCount();
  E('offlineCount').textContent = cnt > 0 ? `(${cnt} várakozó)` : '';
  if (online && cnt > 0) syncOfflineQueue().then(() => {
    E('offlineCount').textContent = '';
  });
}

// Részleg szűrő feltöltése feladatoknál
function _updateFeladatReszlegF() {
  const sel = E('feladatReszlegF'); if (!sel) return;
  const prev = sel.value;
  sel.innerHTML = '<option value="">— Mind —</option>' +
    (state.reszlegek || []).sort((a,b) => a.localeCompare(b,'hu'))
      .map(r => `<option value="${r}">${r}</option>`).join('');
  if (prev) sel.value = prev;
}

function switchAdminSubtab(name) {
  document.querySelectorAll('#adminSubtabs .stab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.stab-panel').forEach(p => p.classList.remove('active'));
  document.querySelector(`#adminSubtabs .stab-btn[data-stab="${name}"]`).classList.add('active');
  E('stab-' + name).classList.add('active');
  if (name === 'roles')        loadRoles();
  if (name === 'lists')        refreshListUI();
  if (name === 'kozlemeny')    loadNoticeAdmin();
  if (name === 'premium-cfg')  initPremiumAdmin();
}

/* ── Auth helpers ── */
async function doGoogleLogin() {
  try { await signInWithPopup(auth, new GoogleAuthProvider()); }
  catch (e) { showAuthErr(e.message); }
}

async function doEmailLogin() {
  const email = E('authEmail').value.trim(), pwd = E('authPwd').value;
  if (!email || !pwd) { showAuthErr('Töltsd ki az összes mezőt!'); return; }
  try { await signInWithEmailAndPassword(auth, email, pwd); }
  catch (e) { showAuthErr(translateAuthErr(e.code)); }
}

async function doRegister() {
  const nev = E('regNev').value.trim(), email = E('regEmail').value.trim(), pwd = E('regPwd').value;
  if (!nev || !email || !pwd) { showAuthErr('Töltsd ki az összes mezőt!'); return; }
  if (pwd.length < 6) { showAuthErr('A jelszó legalább 6 karakter legyen!'); return; }
  try {
    const cred = await createUserWithEmailAndPassword(auth, email, pwd);
    await updateProfile(cred.user, { displayName: nev });
  } catch (e) { showAuthErr(translateAuthErr(e.code)); }
}

function showAuthErr(m) { const el = E('authErr'); el.textContent = m; el.style.display = 'block'; }
function hideAuthErr()  { E('authErr').style.display = 'none'; }
function translateAuthErr(code) {
  const m = {
    'auth/invalid-email':      'Érvénytelen e-mail cím.',
    'auth/user-not-found':     'Nem létezik ilyen felhasználó.',
    'auth/wrong-password':     'Hibás jelszó.',
    'auth/email-already-in-use': 'Ez az e-mail már regisztrált.',
    'auth/weak-password':      'A jelszó túl gyenge.',
    'auth/too-many-requests':  'Túl sok próbálkozás. Kérjük próbáld később.'
  };
  return m[code] || 'Hiba: ' + code;
}

/* ── Event listeners ── */
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  initColorTheme();
  initLayout();

  // Auth screen
  E('googleBtn').addEventListener('click', doGoogleLogin);
  E('loginBtn').addEventListener('click', doEmailLogin);
  E('regBtn').addEventListener('click', doRegister);
  E('showRegBtn').addEventListener('click', () => { E('loginForm').style.display = 'none'; E('regForm').style.display = 'block'; hideAuthErr(); });
  E('showLoginBtn').addEventListener('click', () => { E('regForm').style.display = 'none'; E('loginForm').style.display = 'block'; hideAuthErr(); });
  [E('authEmail'), E('authPwd'), E('regNev'), E('regEmail'), E('regPwd')].forEach(el => { if (el) el.addEventListener('input', hideAuthErr); });
  E('authPwd').addEventListener('keydown', e => { if (e.key === 'Enter') doEmailLogin(); });
  E('regPwd').addEventListener('keydown',  e => { if (e.key === 'Enter') doRegister(); });

  // Pending
  E('pendingLogoutBtn').addEventListener('click', () => signOut(auth));

  // App header
  E('themeBtn').addEventListener('click', toggleTheme);
  E('logoutBtn').addEventListener('click', () => { if (confirm('Biztosan kijelentkezel?')) signOut(auth); });

  // Dizájn téma picker
  E('colorThemeBtn').addEventListener('click', e => {
    e.stopPropagation();
    E('colorPickerPanel').classList.toggle('open');
  });
  E('colorPickerPanel').addEventListener('click', async e => {
    const swatchWrap = e.target.closest('.color-swatch-wrap');
    const layoutBtn  = e.target.closest('.layout-opt');
    if (swatchWrap) {
      const c = swatchWrap.dataset.color;
      applyColorTheme(c);
      E('colorPickerPanel').classList.remove('open');
      if (state.appUser) {
        try { await updateDoc(doc(db, 'users', state.appUser.uid), { colorTheme: c }); }
        catch {}
      }
    } else if (layoutBtn) {
      const l = layoutBtn.dataset.layout;
      applyLayout(l);
      if (state.appUser) {
        try { await updateDoc(doc(db, 'users', state.appUser.uid), { layout: l }); }
        catch {}
      }
    }
  });

  // Hamburger (sidebar mobile)
  E('hamburgerBtn').addEventListener('click', () => {
    E('mainTabs').classList.toggle('open');
    E('sidebarOverlay').classList.toggle('open');
  });
  E('sidebarOverlay').addEventListener('click', () => {
    E('mainTabs').classList.remove('open');
    E('sidebarOverlay').classList.remove('open');
  });
  // Sidebar: tab click → close on mobile
  E('mainTabs').addEventListener('click', e => {
    if (e.target.closest('.tab-btn') && window.innerWidth <= 800 &&
        document.documentElement.hasAttribute('data-layout')) {
      E('mainTabs').classList.remove('open');
      E('sidebarOverlay').classList.remove('open');
    }
  });
  document.addEventListener('click', e => {
    if (!E('colorPickerPanel').contains(e.target) && e.target !== E('colorThemeBtn')) {
      E('colorPickerPanel').classList.remove('open');
    }
  });

  // Main tabs
  E('mainTabs').addEventListener('click', e => {
    const btn = e.target.closest('.tab-btn'); if (!btn || !btn.dataset.tab) return;
    switchTab(btn.dataset.tab, btn);
  });

  // Jelentések al-fülek
  E('jelentesekSubtabs').addEventListener('click', e => {
    const btn = e.target.closest('.stab-btn'); if (!btn || !btn.dataset.jstab) return;
    switchJelentesekSubtab(btn.dataset.jstab);
  });

  // Admin subtabs
  E('adminSubtabs').addEventListener('click', e => {
    const btn = e.target.closest('.stab-btn'); if (!btn || !btn.dataset.stab) return;
    switchAdminSubtab(btn.dataset.stab);
  });

  // Adatbevitel
  E('pinNevBtn').addEventListener('click', () => {
    state.isNamePinned = !state.isNamePinned;
    const btn = E('pinNevBtn');
    btn.style.background = state.isNamePinned ? 'var(--accent)' : '';
    btn.style.color      = state.isNamePinned ? '#fff' : '';
    btn.title = state.isNamePinned ? 'Név rögzítve — kattints a feloldáshoz' : 'Név rögzítése';
  });
  E('nev').addEventListener('change',   async () => autoAddToList(E('nev').value,   state.nevek));
  E('anyag').addEventListener('change', async () => autoAddToList(E('anyag').value, state.anyagok));
  E('addReszlegBtn').addEventListener('click', async () => addToList(E('reszleg'), state.reszlegek));
  E('pinReszlegBtn').addEventListener('click', () => {
    state.isReszlegPinned = !state.isReszlegPinned;
    const btn = E('pinReszlegBtn');
    btn.style.background = state.isReszlegPinned ? 'var(--accent)' : '';
    btn.style.color      = state.isReszlegPinned ? '#fff' : '';
    btn.title = state.isReszlegPinned ? 'Részleg rögzítve — kattints a feloldáshoz' : 'Részleg rögzítése';
    if (state.isReszlegPinned) localStorage.setItem('pinnedReszleg', E('reszleg').value);
    else localStorage.removeItem('pinnedReszleg');
  });
  E('reszleg').addEventListener('focus', () => { _prevReszleg = E('reszleg').value.trim(); });
  E('reszleg').addEventListener('change', async () => {
    const newReszleg = E('reszleg').value.trim();
    const curIdo     = E('ido').value;
    if (_prevReszleg !== newReszleg) {
      await saveNapiFor(E('datum').value, _prevReszleg, curIdo);
      await loadNapiFor(E('datum').value, newReszleg, curIdo);
    }
    _prevReszleg = newReszleg;
    if (state.isReszlegPinned) localStorage.setItem('pinnedReszleg', E('reszleg').value);
  });
  E('ido').addEventListener('focus', () => { _prevIdo = E('ido').value; });
  E('ido').addEventListener('change', async () => {
    const newIdo     = E('ido').value;
    const curReszleg = E('reszleg').value.trim();
    if (_prevIdo !== newIdo) {
      await saveNapiFor(E('datum').value, curReszleg, _prevIdo);
      await loadNapiFor(E('datum').value, curReszleg, newIdo);
    }
    _prevIdo = newIdo;
  });
  E('rogzitBtn').addEventListener('click',   rogzit);
  E('torlesBtn').addEventListener('click',   () => clearF(true));
  E('napiMegj').addEventListener('input',    () => ag(E('napiMegj')));
[E('nev'), E('reszleg'), E('anyag'), E('megj')].forEach(el => el.addEventListener('focus', e => e.target.select()));
  E('napiMegj').addEventListener('focus', e => e.target.select());
  E('datum').addEventListener('change', async e => {
    const curReszleg = E('reszleg').value.trim();
    const curIdo     = E('ido').value;
    await saveNapiFor(state.prevDatum, curReszleg, curIdo);
    await loadNapiFor(e.target.value, curReszleg, curIdo);
    state.prevDatum = e.target.value;
  });

  E('sulyC').addEventListener('click', e => {
    if (e.target.classList.contains('aSuly')) addSuly();
    else if (e.target.classList.contains('dSuly') && E('sulyC').querySelectorAll('.wrow').length > 1) e.target.closest('.wrow').remove();
  });
  E('zsakC').addEventListener('click', e => {
    if (e.target.classList.contains('aZsak')) addZsak();
    else if (e.target.classList.contains('dZsak') && E('zsakC').querySelectorAll('.wrow').length > 1) e.target.closest('.wrow').remove();
  });

  // Napi szűrők → azonnali újrarajzolás
  E('napiMuszakSzuro').addEventListener('change',  rerenderNapi);
  E('napiReszlegSzuro').addEventListener('change', rerenderNapi);

  // Napi jelentés — navigáció
  function navNap(delta) {
    const cur = E('riportD').value;
    const d = cur ? new Date(cur) : new Date();
    d.setDate(d.getDate() + delta);
    E('riportD').value = d.toISOString().slice(0, 10);
    napiRiport();
  }
  E('prevNapBtn').addEventListener('click', () => navNap(-1));
  E('nextNapBtn').addEventListener('click', () => navNap(+1));
  E('maBtn').addEventListener('click', () => { E('riportD').value = tod(); });
  E('mutatBtn').addEventListener('click',      napiRiport);
  E('napTorBtn').addEventListener('click',     napTorol);
  E('napiKepMentBtn').addEventListener('click', napiKepMent);
  E('napiPdfBtn').addEventListener('click', napiPdfMent);
  E('napiNyomtatBtn').addEventListener('click', napiNyomtat);
  E('napiRiportDiv').addEventListener('click', riportKlikk);
  document.addEventListener('napi-goto', () => { switchTab('jelentesek', E('tabBtnJelentesek')); switchJelentesekSubtab('napi'); napiRiport(); });
  document.addEventListener('napi-edit-entry', async e => {
    switchTab('adatbevitel', E('tabBtnAdatbevitel'));
    await startEditEntry(e.detail);
  });
  E('editCancelBtn').addEventListener('click', () => clearF(false));

  // Időszakos jelentés
  function updateIdoszakInputs() {
    const v = E('idoszakTipus').value;
    E('haviInputWrap').style.display    = v === 'havi'   ? '' : 'none';
    E('evesInputWrap').style.display    = v === 'eves'   ? '' : 'none';
    E('egyeniTolWrap').style.display    = v === 'egyeni' ? '' : 'none';
    E('egyeniIgWrap').style.display     = v === 'egyeni' ? '' : 'none';
    E('setHaviAtlagWrap').style.display = v === 'eves'   ? '' : 'none';
  }
  E('idoszakTipus').addEventListener('change', updateIdoszakInputs);
  updateIdoszakInputs();
  E('idoszakosBtn').addEventListener('click', () => {
    const v = E('idoszakTipus').value;
    if (v === 'havi') haviRiport();
    else if (v === 'eves') evesRiport();
    else egyeniRiport();
  });
  E('idoszakosKepMentBtn').addEventListener('click', idoszakosKepMent);
  E('idoszakosPdfBtn').addEventListener('click', idoszakosPdfMent);
  E('idoszakosNyomtatBtn').addEventListener('click', idoszakosNyomtat);
  E('idoszakosRiportDiv').addEventListener('click', riportKlikk);

  // Időszakos — szekció beállítások
  const RIPORT_SETTINGS_MAP = [
    { id: 'setTeljes',        key: 'teljes',        def: true  },
    { id: 'setDolgRangsor',   key: 'dolgRangsor',   def: true  },
    { id: 'setAnyagOssz',     key: 'anyagOssz',     def: true  },
    { id: 'setNapiAtlag',     key: 'napiAtlag',     def: true  },
    { id: 'setDolgNapiAtlag', key: 'dolgNapiAtlag', def: false },
    { id: 'setHaviAtlag',     key: 'haviAtlag',     def: false },
    { id: 'setMuszak',        key: 'muszak',        def: false },
    { id: 'setDolgReszlet',   key: 'dolgReszlet',   def: false },
    { id: 'setAnyagReszlet',  key: 'anyagReszlet',  def: false },
    { id: 'setNapiBontas',    key: 'napiBontas',    def: true  },
  ];
  function saveRiportSettings() {
    const s = {};
    RIPORT_SETTINGS_MAP.forEach(({ id, key }) => { s[key] = E(id).checked; });
    localStorage.setItem('napiJelentesRiportSet', JSON.stringify(s));
  }
  function initRiportSettings() {
    let stored = {};
    try { stored = JSON.parse(localStorage.getItem('napiJelentesRiportSet') || '{}'); } catch {}
    RIPORT_SETTINGS_MAP.forEach(({ id, key, def }) => { E(id).checked = key in stored ? stored[key] : def; });
  }
  initRiportSettings();
  RIPORT_SETTINGS_MAP.forEach(({ id }) => E(id).addEventListener('change', saveRiportSettings));
  E('riportSettingsBtn').addEventListener('click', () => {
    const p = E('riportSettings');
    p.style.display = p.style.display === 'none' ? '' : 'none';
  });

  // Dolgozók
  E('dolgozokSubtabs').addEventListener('click', e => {
    const btn = e.target.closest('.stab-btn'); if (!btn || !btn.dataset.dtab) return;
    switchDolgozokSubtab(btn.dataset.dtab);
  });
  E('ujDolgozoBtn').addEventListener('click',  () => openEmpForm());
  E('empSaveBtn').addEventListener('click',    saveEmployee);
  E('empCancelBtn').addEventListener('click',  closeEmpForm);
  E('dolgozoGrid').addEventListener('click',   handleEmpGridClick);
  E('dolgReszlegF').addEventListener('change', renderEmployeeGrid);
  E('dolgStatuszF').addEventListener('change', renderEmployeeGrid);
  E('hianyMutatBtn').addEventListener('click', loadAbsences);
  E('absSaveBtn').addEventListener('click',    saveAbsence);
  E('hianyListDiv').addEventListener('click',  handleAbsenceClick);
  E('empDrawerClose').addEventListener('click', closeEmpDrawer);
  E('empDrawerOverlay').addEventListener('click', closeEmpDrawer);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeEmpDrawer(); });
  E('naptarMutatBtn').addEventListener('click', loadCalendar);
  E('statMutatBtn').addEventListener('click',   loadStatisztika);
  E('statExportBtn').addEventListener('click',  exportCsv);

  // Feladatok
  E('feladatStatuszF').addEventListener('change', loadTasks);
  E('feladatReszlegF').addEventListener('change', loadTasks);
  E('feladatMentBtn').addEventListener('click',   saveTask);
  E('feladatListDiv').addEventListener('click',   handleTaskClick);

  // Offline
  window.addEventListener('online',  _updateOnlineStatus);
  window.addEventListener('offline', _updateOnlineStatus);
  _updateOnlineStatus();

  // ── FAB ──────────────────────────────────────────────
  E('fabBtn').addEventListener('click', () => {
    switchTab('adatbevitel', E('tabBtnAdatbevitel'));
  });
  function _updateFab() {
    const tab = document.querySelector('.tab-btn.active')?.dataset.tab;
    E('fabBtn').classList.toggle('fab-off', tab === 'adatbevitel');
  }

  // ── Bottom sheet szűrők ──────────────────────────────
  function _openBS(filterCardId, title) {
    const fc = E(filterCardId);
    if (!fc) return;
    E('bsTitle').textContent = title;
    E('bsContent').innerHTML = '';
    E('bsContent').appendChild(fc.cloneNode(true));
    // Szinkronizálja az értékeket az eredeti elemekkel
    E('bsContent').querySelectorAll('[id]').forEach(el => {
      const orig = document.getElementById(el.id);
      if (!orig || orig === el) return;
      if (el.tagName === 'SELECT' || el.tagName === 'INPUT') el.value = orig.value;
    });
    E('bsOverlay').classList.add('open');
    E('bottomSheet').classList.add('open');
  }
  function _closeBS() {
    E('bsOverlay').classList.remove('open');
    E('bottomSheet').classList.remove('open');
  }
  function _applyBS(filterCardId) {
    E('bsContent').querySelectorAll('[id]').forEach(el => {
      const orig = document.getElementById(el.id);
      if (!orig || orig === el) return;
      if ((el.tagName === 'SELECT' || el.tagName === 'INPUT') && el.value !== orig.value) {
        orig.value = el.value;
        orig.dispatchEvent(new Event('change'));
      }
    });
    _closeBS();
  }
  E('napiFilterToggle').addEventListener('click',     () => _openBS('napiFilterCard',     'Szűrők & dátum'));
  E('idoszakosFilterToggle').addEventListener('click',() => _openBS('idoszakosFilterCard','Időszak & beállítások'));
  E('bsOverlay').addEventListener('click', _closeBS);
  E('bsApplyBtn').addEventListener('click', () => {
    const active = document.querySelector('.jstab-panel.active');
    const id = active?.id;
    if (id === 'jstab-napi') _applyBS('napiFilterCard');
    else if (id === 'jstab-idoszakos') _applyBS('idoszakosFilterCard');
    else _closeBS();
  });

  // ── Pull-to-refresh ──────────────────────────────────
  let _ptStart = 0, _ptDelta = 0, _ptActive = false;
  const PTR = E('ptrIndicator');
  const PTR_THRESHOLD = 75;
  document.addEventListener('touchstart', e => {
    if (window.scrollY < 5 && e.touches.length === 1) {
      _ptStart = e.touches[0].clientY; _ptActive = true;
    }
  }, { passive: true });
  document.addEventListener('touchmove', e => {
    if (!_ptActive) return;
    _ptDelta = e.touches[0].clientY - _ptStart;
    if (_ptDelta > 0 && _ptDelta < 130) {
      const progress = Math.min(_ptDelta / PTR_THRESHOLD, 1);
      PTR.style.top = `${-52 + _ptDelta * 0.65}px`;
      PTR.style.opacity = progress;
      PTR.textContent = _ptDelta >= PTR_THRESHOLD ? '↺' : '↓';
      PTR.classList.toggle('ptr-visible', _ptDelta > 10);
    }
  }, { passive: true });
  document.addEventListener('touchend', () => {
    if (!_ptActive) return;
    _ptActive = false;
    if (_ptDelta >= PTR_THRESHOLD) {
      PTR.classList.add('ptr-spin');
      PTR.style.top = '12px';
      const tab = document.querySelector('.tab-btn.active')?.dataset.tab;
      const done = () => { PTR.style.top = '-52px'; PTR.style.opacity = '0'; PTR.classList.remove('ptr-spin'); };
      if (tab === 'jelentesek') { napiRiport(); setTimeout(done, 1200); }
      else if (tab === 'feladatok') { loadTasks().then(done); }
      else { setTimeout(done, 600); }
    } else {
      PTR.style.top = '-52px';
      PTR.style.opacity = '0';
    }
    _ptDelta = 0;
  });

  // Admin — felhasználók
  E('userTableBody').addEventListener('change', async e => {
    if (!e.target.classList.contains('role-select')) return;
    const uid = e.target.dataset.uid, roleId = e.target.value || null;
    try {
      await updateDoc(doc(db, 'users', uid), { roleId });
      msg('Szerepkör frissítve.'); loadAdminUsers();
    } catch (ex) { msg('Frissítési hiba: ' + ex.message, 'error'); }
  });
  E('userTableBody').addEventListener('click', async e => {
    const btn = e.target.closest('[data-del-user]'); if (!btn) return;
    const uid = btn.dataset.delUser;
    if (!confirm('Biztosan törlöd ezt a felhasználót?')) return;
    try { await deleteDoc(doc(db, 'users', uid)); msg('Felhasználó törölve.'); loadAdminUsers(); }
    catch { msg('Törlési hiba', 'error'); }
  });

  // Admin — szerepkörök
  E('ujSzerepkorBtn').addEventListener('click', () => { E('newRoleForm').classList.toggle('open'); E('saveRoleBtn').textContent = 'Mentés'; });
  E('saveRoleBtn').addEventListener('click', saveRole);
  E('cancelRoleBtn').addEventListener('click', cancelRoleForm);
  E('roleListDiv').addEventListener('click', handleRoleListClick);

  // Admin — listák
  E('nevLista').addEventListener('dblclick',    e => editItem(e, state.nevek));
  E('anyagLista').addEventListener('dblclick',  e => editItem(e, state.anyagok));
  E('reszlegLista').addEventListener('dblclick',e => editItem(e, state.reszlegek));
  E('nevTorBtn').addEventListener('click',    () => delFromList(E('nevLista'),    state.nevek));
  E('anyagTorBtn').addEventListener('click',  () => delFromList(E('anyagLista'),  state.anyagok));
  E('reszlegTorBtn').addEventListener('click',() => delFromList(E('reszlegLista'),state.reszlegek));

  // Admin — közlemény
  E('noticeSaveBtn').addEventListener('click', saveNotice);
  E('noticeClearBtn').addEventListener('click', clearNotice);

  // Admin — prémium konfig
  E('premiumAdminSaveBtn').addEventListener('click', savePremiumAdminConfig);

  // Admin — adatok
  E('mentFajlBtn').addEventListener('click',  mentFajl);
  E('fajlKivBtn').addEventListener('click',   () => E('fajlInput').click());
  E('fajlInput').addEventListener('change',   betoltFajl);
  E('mindTorBtn').addEventListener('click',   mindTorol);
});

/* ── Auth state ── */
onAuthStateChanged(auth, async user => {
  if (user) {
    state.appUser = user;
    await loadUserContext(user);
  } else {
    state.appUser      = null;
    state.userData     = null;
    state.userRole     = null;
    state.isNamePinned = false;
    cleanupNapiListener();
    showScreen('login');
  }
});
