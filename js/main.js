import { auth, db, doc, getDoc, setDoc, updateDoc, deleteDoc,
         collection, query, limit, getDocs, serverTimestamp,
         onAuthStateChanged, signInWithPopup, GoogleAuthProvider,
         createUserWithEmailAndPassword, signInWithEmailAndPassword,
         signOut, updateProfile } from './firebase.js';
import { state, isMainAdmin, hasPerm, canSeeAllReports, canManageUsers } from './state.js';
import { E, msg, ag, tod, initTheme, toggleTheme, showScreen } from './utils.js';
import { loadLists, refreshListUI, saveNapiFor, loadNapiFor,
         addToList, delFromList, editItem } from './db.js';
import { addSuly, addZsak, rogzit, clearF, startEditEntry } from './data-entry.js';
import { napiRiport, haviRiport, evesRiport,
         napiKepMent, idoszakosKepMent,
         napiNyomtat, idoszakosNyomtat,
         riportKlikk, napTorol, cleanupNapiListener, rerenderNapi } from './reports.js';
import { loadAdminUsers, loadRoles, saveRole, cancelRoleForm,
         handleRoleListClick, mentFajl, betoltFajl, mindTorol } from './admin.js';
import { initElemzes } from './worker-analysis.js';
import { initNaptar } from './calendar.js';
import { initPremiumTab, initPremiumAdmin, savePremiumAdminConfig } from './premium.js';

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
  E('tabBtnNapi').style.display        = (hasPerm('sajatJelentes') || hasPerm('mindenJelentes'))     ? '' : 'none';
  E('tabBtnIdoszakos').style.display   = (hasPerm('sajatJelentes') || hasPerm('mindenJelentes'))     ? '' : 'none';
  E('tabBtnNaptar').style.display      = (hasPerm('sajatJelentes') || hasPerm('mindenJelentes'))     ? '' : 'none';
  E('tabBtnElemzes').style.display     = (hasPerm('sajatJelentes') || canSeeAllReports())            ? '' : 'none';
  E('tabBtnPremium').style.display     = (isMainAdmin() || hasPerm('premiumMegtekintes') || hasPerm('premiumKezeles')) ? '' : 'none';
  E('tabBtnAdmin').style.display       = canManageUsers()                                             ? '' : 'none';

  E('stab-roles-btn').style.display        = isMainAdmin() ? '' : 'none';
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


  loadLists();
  addSuly(); addZsak();

  if (!hasPerm('adatbevitel') && (hasPerm('sajatJelentes') || hasPerm('mindenJelentes'))) {
    switchTab('napi', E('tabBtnNapi'));
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
  if (name === 'admin') loadAdminUsers();
  if (name !== 'napi') cleanupNapiListener();
  if (name === 'naptar')  initNaptar();
  if (name === 'premium') initPremiumTab();
  if (name === 'elemzes' && !switchTab._elemzesInited) {
    switchTab._elemzesInited = true;
    initElemzes();
  }
}

function switchAdminSubtab(name) {
  document.querySelectorAll('.stab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.stab-panel').forEach(p => p.classList.remove('active'));
  document.querySelector(`.stab-btn[data-stab="${name}"]`).classList.add('active');
  E('stab-' + name).classList.add('active');
  if (name === 'roles')        loadRoles();
  if (name === 'lists')        refreshListUI();
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

  // Main tabs
  E('mainTabs').addEventListener('click', e => {
    const btn = e.target.closest('.tab-btn'); if (!btn || !btn.dataset.tab) return;
    switchTab(btn.dataset.tab, btn);
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
  E('addNevBtn').addEventListener('click',    () => addToList(E('nev'),    state.nevek));
  E('addAnyagBtn').addEventListener('click',  () => addToList(E('anyag'),  state.anyagok));
  E('addReszlegBtn').addEventListener('click',() => addToList(E('reszleg'),state.reszlegek));
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

  // Napi jelentés
  E('maBtn').addEventListener('click',         () => { E('riportD').value = tod(); });
  E('mutatBtn').addEventListener('click',      napiRiport);
  E('napTorBtn').addEventListener('click',     napTorol);
  E('napiKepMentBtn').addEventListener('click', napiKepMent);
  E('napiNyomtatBtn').addEventListener('click', napiNyomtat);
  E('napiRiportDiv').addEventListener('click', riportKlikk);
  document.addEventListener('napi-goto', () => { switchTab('napi', E('tabBtnNapi')); napiRiport(); });
  document.addEventListener('napi-edit-entry', async e => {
    switchTab('adatbevitel', E('tabBtnAdatbevitel'));
    await startEditEntry(e.detail);
  });
  E('editCancelBtn').addEventListener('click', () => clearF(false));

  // Időszakos jelentés
  function updateIdoszakInputs() {
    const isHavi = E('idoszakTipus').value === 'havi';
    E('haviInputWrap').style.display    = isHavi ? '' : 'none';
    E('evesInputWrap').style.display    = isHavi ? 'none' : '';
    E('setHaviAtlagWrap').style.display = isHavi ? 'none' : '';
  }
  E('idoszakTipus').addEventListener('change', updateIdoszakInputs);
  updateIdoszakInputs();
  E('idoszakosBtn').addEventListener('click', () => {
    if (E('idoszakTipus').value === 'havi') haviRiport(); else evesRiport();
  });
  E('idoszakosKepMentBtn').addEventListener('click', idoszakosKepMent);
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
