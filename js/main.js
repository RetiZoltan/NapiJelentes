import { auth, db, doc, getDoc, setDoc, updateDoc, deleteDoc,
         collection, query, limit, getDocs, orderBy, arrayUnion, serverTimestamp,
         onAuthStateChanged, signInWithPopup, GoogleAuthProvider,
         createUserWithEmailAndPassword, signInWithEmailAndPassword,
         signOut, updateProfile } from './firebase.js';
import { state, isMainAdmin, hasPerm, canSeeAllReports, canManageUsers } from './state.js';
import { E, esc, msg, ag, tod, initTheme, toggleTheme, showScreen,
         applyColorTheme, initColorTheme,
         applyLayout, initLayout } from './utils.js';
import { loadLists, refreshListUI, saveNapiFor, loadNapiFor,
         addToList, autoAddToList, delFromList, editItem,
         getWorkerMaterials, updIdoszakosFilters } from './db.js';
import { addSuly, addZsak, rogzit, clearF, startEditEntry,
         saveDraft, loadDraft, restoreDraft, clearDraft,
         syncOfflineQueue, getOfflineCount } from './data-entry.js';
import { napiRiport, haviRiport, hetiRiport, evesRiport, egyeniRiport,
         napiKepMent, idoszakosKepMent,
         napiPdfMent, idoszakosPdfMent, idoszakosXlsxMent,
         napiNyomtat, idoszakosNyomtat,
         riportKlikk, napTorol, cleanupNapiListener, rerenderNapi } from './reports.js';
import { loadTasks, saveTask, handleTaskClick,
         initTasksUI, openTaskDrawer, closeTaskDrawer } from './tasks.js';
import { loadAdminUsers, loadRoles, saveRole, cancelRoleForm,
         handleRoleListClick, mentFajl, betoltFajl, mindTorol,
         loadNoticeAdmin, saveNotice, applyRoleTemplate,
         loadAuditLogAdmin, loadLoginLog, exportAllDataExcel } from './admin.js';
import { initElemzes } from './worker-analysis.js';
import { initDashboard, reloadDashboard, setAutoRefresh, closeWidgetDrawer } from './dashboard.js';
import { initHelp } from './help.js';
import { logAction } from './auditlog.js';
import { queueOp, syncOfflineOps, getOfflineOpCount, initOfflineBadge } from './offlineQueue.js';
import { loadMachines, saveMachine, openGepForm, closeGepForm,
         closeMachineDrawer, canManageMachines, canViewMachines } from './machines.js';
import { renderWipSection, saveWipTransfer, rollbackWipBag, completeWipBag } from './wip-bags.js';
import { initKeszletTab, switchKeszletTab, loadKeszlet, loadElozmenyek,
         loadImportFromProduction, executeImport, saveBevetelez,
         saveMozgas, onMozgTipusChange, saveLocation,
         canViewStock, canManageStock } from './stock.js';
import { initNaptar } from './calendar.js';
import { initPremiumTab, initPremiumAdmin, savePremiumAdminConfig,
         savePremiumHistory, switchPremiumTab } from './premium.js';
import { loadEmployees, renderEmployeeGrid, openEmpForm, closeEmpForm, saveEmployee,
         handleEmpGridClick, loadAbsences, saveAbsence, handleAbsenceClick,
         loadCalendar, loadStatisztika, exportCsv, saveCalQuickAdd,
         loadTulora, saveTulora, handleTuloraClick,
         closeEmpDrawer, canEditEmp, setEmpListView } from './employees.js';

let _prevReszleg = '';
let _prevIdo = '';
let _prevTab = 'dashboard';
const TAB_ORDER = ['dashboard','adatbevitel','jelentesek','naptar','elemzes','feladatok','dolgozok','premium','admin'];

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
    if (ud.isDisabled && !ud.isMainAdmin) {
      E('pendingEmail').textContent = fbUser.email;
      const pt = document.querySelector('.pending-title');
      if (pt) pt.textContent = 'Fiók letiltva';
      const ps = document.querySelector('.pending-sub');
      if (ps) ps.textContent = 'Ez a fiók le van tiltva az adminisztrátor által. Kérj feloldást.';
      showScreen('pending');
      return;
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

  E('tabBtnDashboard').style.display   = '';
  E('tabBtnAdatbevitel').style.display = (isMainAdmin() || hasPerm('adatbevitel'))                                      ? '' : 'none';
  E('tabBtnJelentesek').style.display  = (isMainAdmin() || hasPerm('sajatJelentes') || hasPerm('mindenJelentes'))       ? '' : 'none';
  E('tabBtnNaptar').style.display      = (isMainAdmin() || hasPerm('naptar'))                                           ? '' : 'none';
  E('tabBtnElemzes').style.display     = (isMainAdmin() || hasPerm('elemzes'))                                          ? '' : 'none';
  E('tabBtnFeladatok').style.display   = (isMainAdmin() || hasPerm('feladatokKezeles'))                                 ? '' : 'none';
  E('tabBtnDolgozok').style.display    = (isMainAdmin() || hasPerm('dolgozokMegtekintes') || hasPerm('dolgozokKezeles')) ? '' : 'none';
  E('tabBtnPremium').style.display     = (isMainAdmin() || hasPerm('premiumMegtekintes') || hasPerm('premiumKezeles'))  ? '' : 'none';
  E('tabBtnKeszlet').style.display     = (isMainAdmin() || hasPerm('keszletMegtekintes') || hasPerm('keszletKezeles'))  ? '' : 'none';
  E('tabBtnGepek').style.display       = (isMainAdmin() || hasPerm('gepekMegtekintes') || hasPerm('gepekKezeles'))      ? '' : 'none';
  if (E('ujGepWrap')) E('ujGepWrap').style.display = canManageMachines() ? '' : 'none';
  if (E('sztBeallitasBtn')) E('sztBeallitasBtn').style.display = canManageStock() ? '' : 'none';
  E('tabBtnAdmin').style.display       = (isMainAdmin() || canManageUsers() || hasPerm('kozlemenyIras'))                ? '' : 'none';
  E('tabBtnSugo').style.display        = '';

  E('stab-roles-btn').style.display        = isMainAdmin() ? '' : 'none';
  E('stab-kozlemeny-btn').style.display    = (canManageUsers() || hasPerm('kozlemenyIras')) ? '' : 'none';
  E('stab-premium-cfg-btn').style.display  = (isMainAdmin() || hasPerm('premiumKezeles')) ? '' : 'none';
  E('stab-data-btn').style.display         = isMainAdmin() ? '' : 'none';
  E('stab-audit-btn').style.display        = isMainAdmin() ? '' : 'none';
  E('stab-belepes-btn').style.display     = isMainAdmin() ? '' : 'none';
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
  // Aktuális ISO hét beállítása
  const _isoWk = (() => {
    const d = new Date(now); d.setHours(0,0,0,0); d.setDate(d.getDate()+4-(d.getDay()||7));
    const y1 = new Date(d.getFullYear(),0,1);
    return `${d.getFullYear()}-W${String(Math.ceil(((d-y1)/86400000+1)/7)).padStart(2,'0')}`;
  })();
  if (E('hetiHetInput')) E('hetiHetInput').value = _isoWk;


  applyColorTheme(state.userData.colorTheme || 'plexiq');
  applyLayout(state.userData.layout || 'classic');
  loadLists().then(() => _updateFeladatReszlegF());
  addSuly(); addZsak();
  // Login logolás + lastLoginAt mentés
  logAction('auth.login', { email: state.appUser.email, ua: navigator.userAgent.slice(0, 300) });
  updateDoc(doc(db, 'users', state.appUser.uid), { lastLoginAt: serverTimestamp() }).catch(() => {});

  // Vázlat ellenőrzés
  const draft = loadDraft();
  if (draft) {
    const b = E('draftBanner');
    if (b) b.style.display = 'flex';
  }

  // Dashboard mindig betölt alapértelmezetten
  initDashboard();
  loadAndDisplayNotice();
}

/* ── Tab navigation ── */
function switchTab(name, btn) {
  const prevIdx = TAB_ORDER.indexOf(_prevTab);
  const newIdx  = TAB_ORDER.indexOf(name);
  const goBack  = _prevTab && newIdx < prevIdx;

  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active', 'anim-back'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));

  const panel = E('tab-' + name);
  panel.classList.add('active');
  if (goBack) panel.classList.add('anim-back');
  btn.classList.add('active');
  _prevTab = name;

  if (typeof _updateFab === 'function') _updateFab();
  if (name === 'admin')       loadAdminUsers();
  if (name !== 'jelentesek')  cleanupNapiListener();
  if (name === 'naptar')      initNaptar();
  if (name === 'feladatok')   { initTasksUI(); loadTasks(); }
  if (name === 'dolgozok')    { loadEmployees(); _setupDolgozokUI(); }
  if (name === 'premium')     initPremiumTab();
  if (name === 'keszlet')     initKeszletTab();
  if (name === 'gepek')       loadMachines();
  if (name === 'adatbevitel') renderWipSection();
  if (name === 'dashboard')   { initDashboard(); loadAndDisplayNotice(); }
  if (name === 'sugo')        initHelp();
  if (name === 'elemzes' && !switchTab._elemzesInited) {
    switchTab._elemzesInited = true;
    initElemzes();
  }
}

const _NOTICE_TYPES = {
  info:         { icon: 'ℹ️'  },
  warning:      { icon: '⚠️'  },
  success:      { icon: '✅'  },
  urgent:       { icon: '🔴'  },
  esemeny:      { icon: '📅'  },
  karbantartas: { icon: '🔧'  },
  hir:          { icon: '🎉'  },
};

function _getDismissed() {
  try { return JSON.parse(localStorage.getItem(`nj_dis_${state.appUser?.uid}`) || '[]'); }
  catch { return []; }
}
function _setDismissed(ids) {
  localStorage.setItem(`nj_dis_${state.appUser?.uid}`, JSON.stringify(ids));
}
function _timeAgo(date) {
  if (!date) return '';
  const diff = Math.floor((Date.now() - date.getTime()) / 60000);
  if (diff < 1)  return 'épp most';
  if (diff < 60) return `${diff} perce`;
  const h = Math.floor(diff / 60);
  if (h < 24)    return `${h} órája`;
  const d = Math.floor(h / 24);
  return d < 7 ? `${d} napja` : date.toLocaleDateString('hu-HU');
}

async function loadAndDisplayNotice() {
  const container = E('noticeCards'); if (!container) return;
  try {
    const today     = tod();
    const dismissed = _getDismissed();
    const snap      = await getDocs(query(collection(db, 'notices'), orderBy('createdAt', 'desc')));

    const visible = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(n => {
        if (dismissed.includes(n.id)) return false;
        if (n.lejarat && n.lejarat < today) return false;
        if (n.cel === 'admin' && !canManageUsers()) return false;
        return true;
      });

    if (!visible.length) { container.innerHTML = ''; return; }

    container.innerHTML = visible.map(n => {
      const icon    = _NOTICE_TYPES[n.tipus]?.icon || 'ℹ️';
      const timeAgo = n.createdAt ? _timeAgo(n.createdAt.toDate()) : '';
      const byLine  = [n.createdByName, timeAgo].filter(Boolean).join(' · ');
      const cel     = n.cel;
      const celBadge = (cel && cel !== 'mindenki')
        ? `<span class="notice-meta-badge">${cel === 'admin' ? '🔐 Csak admin' : '📍 ' + esc(cel.replace('reszleg:',''))}</span>`
        : '';
      const lejBadge = n.lejarat
        ? `<span class="notice-meta-badge">⏱ ${esc(n.lejarat)}-ig</span>`
        : '';
      return `<div class="notice-card notice-card-${esc(n.tipus || 'info')}">
        <div class="notice-card-icon">${icon}</div>
        <div class="notice-card-body">
          <div class="notice-card-text">${esc(n.szoveg)}</div>
          <div class="notice-card-meta">${esc(byLine)}${celBadge}${lejBadge}</div>
        </div>
        <button class="notice-card-close" data-nid="${n.id}" title="Bezár">×</button>
      </div>`;
    }).join('');

    container.querySelectorAll('.notice-card-close').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.nid;
        const dismissed = _getDismissed();
        if (!dismissed.includes(id)) _setDismissed([...dismissed, id]);
        btn.closest('.notice-card').remove();
        if (state.appUser) {
          try { await updateDoc(doc(db, 'notices', id), { readBy: arrayUnion(state.appUser.uid) }); }
          catch {}
        }
      });
    });
  } catch (err) {
    console.error('loadAndDisplayNotice error:', err);
    container.innerHTML = `<div style="padding:10px;font-size:12px;color:var(--red);background:var(--redl);border-radius:8px;margin-bottom:12px;">⚠️ Közlemény betöltési hiba: ${err.message}</div>`;
  }
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
  if (name === 'tulora')  loadTulora();
}

let _dolgozokUISetup = false;
function _setupDolgozokUI() {
  if (_dolgozokUISetup) return;
  _dolgozokUISetup = true;
  const ce  = canEditEmp();
  E('ujDolgozoWrap').style.display    = ce ? '' : 'none';
  E('hianyFormWrap').style.display    = ce ? '' : 'none';
  E('tuloraFormWrap').style.display   = ce ? '' : 'none';
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
  if (name === 'audit')        loadAuditLogAdmin();
  if (name === 'belepes')      loadLoginLog();
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
  E('brandHome').addEventListener('click', () => switchTab('dashboard', E('tabBtnDashboard')));
  E('sbBrand').addEventListener('click',   () => switchTab('dashboard', E('tabBtnDashboard')));
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

  // Draft banner gombok
  E('draftRestoreBtn').addEventListener('click', () => {
    const d = loadDraft(); if (d) { restoreDraft(d); E('draftBanner').style.display = 'none'; }
  });
  E('draftDiscardBtn').addEventListener('click', () => { clearDraft(); E('draftBanner').style.display = 'none'; });

  // Auto-save draft debounced
  let _draftT = null;
  function _triggerDraft() { clearTimeout(_draftT); _draftT = setTimeout(saveDraft, 1000); }
  ['nev','anyag','megj','datum','ido','reszleg'].forEach(id => {
    E(id)?.addEventListener('input',  _triggerDraft);
    E(id)?.addEventListener('change', _triggerDraft);
  });
  E('sulyC').addEventListener('input',  _triggerDraft);
  E('zsakC').addEventListener('input',  _triggerDraft);
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

  // Rögzítés utáni automatikus WIP prompt
  let _wipPending = null;
  document.addEventListener('entry-megkezdett', e => {
    _wipPending = e.detail;
    E('wipPromptAnyag').textContent = e.detail.anyag;
    E('wipPromptSuly').textContent  = e.detail.suly;
    E('wipPromptBanner').style.display = 'flex';
    E('wipPromptBanner').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });
  E('wipPromptIgen').addEventListener('click', async () => {
    if (_wipPending) {
      await saveWipTransfer(_wipPending);
      _wipPending = null;
      E('wipPromptBanner').style.display = 'none';
    }
  });
  E('wipPromptNem').addEventListener('click', () => {
    E('wipPromptBanner').style.display = 'none';
    _wipPending = null;
  });

  E('wipList').addEventListener('click', async e => {
    const rollbackBtn = e.target.closest('.wipRollbackBtn');
    const completeBtn = e.target.closest('.wipCompleteBtn');
    if (rollbackBtn) {
      await rollbackWipBag(rollbackBtn.dataset.wid);
    } else if (completeBtn) {
      const item      = completeBtn.closest('.wip-item');
      const finalSuly = parseFloat(item?.querySelector('.wip-final-input')?.value);
      if (!finalSuly || finalSuly <= 0) { msg('Add meg a végső súlyt!', 'error'); return; }
      await completeWipBag(completeBtn.dataset.wid, finalSuly);
    }
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
    E('hetiInputWrap').style.display    = v === 'heti'   ? '' : 'none';
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
    if (v === 'havi')  haviRiport();
    else if (v === 'heti')  hetiRiport();
    else if (v === 'eves')  evesRiport();
    else egyeniRiport();
  });
  E('idoszakosKepMentBtn').addEventListener('click', idoszakosKepMent);
  E('idoszakosPdfBtn').addEventListener('click', idoszakosPdfMent);
  E('idoszakosXlsxBtn').addEventListener('click', idoszakosXlsxMent);
  E('idoszakosNyomtatBtn').addEventListener('click', idoszakosNyomtat);

  // Dolgozó szűrő → anyag lista dinamikus szűkítése
  E('idoszakosDolgozoSzuro').addEventListener('change', async () => {
    const worker = E('idoszakosDolgozoSzuro').value;
    const aEl    = E('idoszakosAnyagSzuro');
    if (!worker) {
      updIdoszakosFilters();   // Visszaállítja a teljes anyag listát
      return;
    }
    aEl.innerHTML = '<option value="">— Betöltés… —</option>';
    const materials = await getWorkerMaterials(worker);
    const prev = aEl.value;
    aEl.innerHTML = '<option value="">— Mind —</option>' +
      materials.map(m => `<option value="${esc(m)}"${m === prev ? ' selected' : ''}>${esc(m)}</option>`).join('');
    if (prev && !materials.includes(prev)) aEl.value = '';
  });
  E('idoszakosRiportDiv').addEventListener('click', riportKlikk);

  // Időszakos — szekció beállítások
  const RIPORT_SETTINGS_MAP = [
    { id: 'setTeljes',        key: 'teljes',        def: true  },
    { id: 'setDolgRangsor',   key: 'dolgRangsor',   def: true  },
    { id: 'setRekordok',      key: 'rekordok',      def: true  },
    { id: 'setKalendarNezet', key: 'kalendarNezet', def: true  },
    { id: 'setLineChart',     key: 'lineChart',     def: true  },
    { id: 'setBarChart',      key: 'barChart',      def: true  },
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
  E('dolgReszlegF').addEventListener('change',  renderEmployeeGrid);
  E('dolgStatuszF').addEventListener('change',  renderEmployeeGrid);
  E('empViewCard').addEventListener('click', () => { _empListView(false); });
  E('empViewList').addEventListener('click', () => { _empListView(true); });
  function _empListView(list) {
    localStorage.setItem('nj_emp_listview', list ? '1' : '0');
    // Frissítjük a listView állapotot az employees.js-ben (exportált setter-en keresztül)
    setEmpListView(list);
    renderEmployeeGrid();
  }
  E('dolgNevKeres').addEventListener('input',   renderEmployeeGrid);
  E('dolgRendezes').addEventListener('change',  renderEmployeeGrid);
  E('calQaSaveBtn').addEventListener('click',   saveCalQuickAdd);
  E('calQaCancelBtn').addEventListener('click', () => E('calQuickAddPanel').style.display = 'none');
  E('hianyMutatBtn').addEventListener('click', loadAbsences);
  E('tuloraMutatBtn').addEventListener('click', loadTulora);
  E('tuloraSaveBtn').addEventListener('click',  saveTulora);
  E('tuloraListDiv').addEventListener('click',  handleTuloraClick);
  E('absSaveBtn').addEventListener('click',    saveAbsence);
  E('hianyListDiv').addEventListener('click',  handleAbsenceClick);
  E('empDrawerClose').addEventListener('click', closeEmpDrawer);
  E('empDrawerOverlay').addEventListener('click', closeEmpDrawer);
  E('taskDrawerClose').addEventListener('click', closeTaskDrawer);
  E('taskDrawerOverlay').addEventListener('click', closeTaskDrawer);
  E('gepDrawerClose')?.addEventListener('click', closeMachineDrawer);
  E('gepDrawerOverlay')?.addEventListener('click', closeMachineDrawer);
  E('ujGepBtn')?.addEventListener('click', () => openGepForm());
  E('gepSaveBtn')?.addEventListener('click', saveMachine);
  E('gepCancelBtn')?.addEventListener('click', closeGepForm);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeEmpDrawer(); closeTaskDrawer(); closeWidgetDrawer(); closeMachineDrawer(); } });
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
  // Offline queue szinkron
  window.addEventListener('online', () => syncOfflineOps());
  initOfflineBadge();

  // ── FAB ──────────────────────────────────────────────
  E('fabBtn').addEventListener('click', () => {
    const tab = document.querySelector('.tab-btn.active')?.dataset.tab;
    if (tab === 'feladatok') {
      // Feladatok tabon: nyissa ki az Új feladat formt
      const body = E('ujFeladatBody'), chevron = E('ujFeladatChevron');
      if (body && body.style.display === 'none') {
        body.style.display = '';
        if (chevron) chevron.style.transform = 'rotate(90deg)';
      }
      setTimeout(() => E('feladatCim')?.focus(), 50);
    } else {
      switchTab('adatbevitel', E('tabBtnAdatbevitel'));
    }
  });
  function _updateFab() {
    const tab = document.querySelector('.tab-btn.active')?.dataset.tab;
    E('fabBtn').classList.toggle('fab-off', tab === 'adatbevitel' || tab === 'dashboard');
  }

  // ── Bottom sheet szűrők ──────────────────────────────
  function _openBS(filterCardId, title) {
    const fc = E(filterCardId);
    if (!fc) return;
    E('bsTitle').textContent = title;
    E('bsContent').innerHTML = '';
    const clone = fc.cloneNode(true);
    // A js-filter-card osztály display:none!important-ot kap mobilon –
    // a klónból el kell távolítani, hogy látható legyen a bottom sheet-ben
    clone.classList.remove('js-filter-card');
    clone.style.display = '';
    E('bsContent').appendChild(clone);
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
      if (tab === 'jelentesek')  { napiRiport(); setTimeout(done, 1200); }
      else if (tab === 'feladatok')  { loadTasks().then(done); }
      else if (tab === 'dashboard')  { reloadDashboard().then(done); }
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
    // Letiltás / Aktiválás
    const disBtn = e.target.closest('.dis-toggle-btn');
    if (disBtn && !disBtn.disabled) {
      const uid = disBtn.dataset.uid;
      const willDisable = disBtn.dataset.isDisabled !== '1';
      try {
        await updateDoc(doc(db, 'users', uid), { isDisabled: willDisable });
        logAction(willDisable ? 'user.disable' : 'user.enable', { nev: disBtn.dataset.name || uid });
        msg(willDisable ? 'Fiók letiltva.' : 'Fiók aktiválva.');
        loadAdminUsers();
      } catch (ex) { msg('Hiba: ' + ex.message, 'error'); }
      return;
    }
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
  // Szerepkör sablonok
  document.querySelectorAll('.role-tpl-btn').forEach(btn => {
    btn.addEventListener('click', () => applyRoleTemplate(btn.dataset.tpl));
  });

  // Feladatok – Új feladat lenyitható form
  E('ujFeladatToggle').addEventListener('click', () => {
    const body    = E('ujFeladatBody');
    const chevron = E('ujFeladatChevron');
    const open    = body.style.display !== 'none';
    body.style.display    = open ? 'none' : '';
    chevron.style.transform = open ? '' : 'rotate(90deg)';
    if (!open) setTimeout(() => E('feladatCim')?.focus(), 50);
  });

  // Dashboard gyors műveletek
  E('dashQuickActions').addEventListener('click', e => {
    const btn = e.target.closest('.dash-qa-btn'); if (!btn) return;
    const tab    = btn.dataset.tab;
    const action = btn.dataset.action;
    const url    = btn.dataset.url;
    if (url) { window.open(url, '_blank', 'noopener,noreferrer'); return; }
    if (tab) {
      const tabBtn = E('tabBtn' + tab.charAt(0).toUpperCase() + tab.slice(1));
      if (tabBtn) switchTab(tab, tabBtn);
      if (tab === 'feladatok') setTimeout(() => E('feladatCim')?.focus(), 250);
    }
    if (action === 'napi-report') {
      E('riportD').value = tod();
      document.dispatchEvent(new CustomEvent('napi-goto'));
    }
  });

  // Dashboard auto-frissítés
  E('dashAutoRefreshSel').addEventListener('change', e => {
    setAutoRefresh(parseInt(e.target.value, 10));
  });

  // Widget drawer – "Feladatok megnyitása →" gomb
  E('widgetDrawerBody').addEventListener('click', e => {
    if (e.target.closest('.wd-goto-tasks')) {
      closeWidgetDrawer();
      switchTab('feladatok', E('tabBtnFeladatok'));
    }
  });

  // Admin — listák
  E('nevLista').addEventListener('dblclick',    e => editItem(e, state.nevek));
  E('anyagLista').addEventListener('dblclick',  e => editItem(e, state.anyagok));
  E('reszlegLista').addEventListener('dblclick',e => editItem(e, state.reszlegek));
  E('nevTorBtn').addEventListener('click',    () => delFromList(E('nevLista'),    state.nevek));
  E('anyagTorBtn').addEventListener('click',  () => delFromList(E('anyagLista'),  state.anyagok));
  E('reszlegTorBtn').addEventListener('click',() => delFromList(E('reszlegLista'),state.reszlegek));

  // Admin — közlemény
  E('noticeSaveBtn').addEventListener('click', saveNotice);

  // Készlet al-fülek és gombok
  E('keszletSubtabs').addEventListener('click', e => {
    const btn = e.target.closest('.stab-btn'); if (!btn || !btn.dataset.ksTab) return;
    switchKeszletTab(btn.dataset.ksTab);
  });
  E('keszletFrissitBtn').addEventListener('click', loadKeszlet);
  E('elozMutatBtn').addEventListener('click', loadElozmenyek);
  E('importLekerdezBtn').addEventListener('click', loadImportFromProduction);
  E('importMentBtn').addEventListener('click', executeImport);
  E('bevSaveBtn').addEventListener('click', saveBevetelez);
  E('mozgSaveBtn').addEventListener('click', saveMozgas);
  document.querySelectorAll('.mozg-tipus-btn').forEach(btn => {
    btn.addEventListener('click', () => onMozgTipusChange(btn.dataset.tipus));
  });
  E('helyszinSaveBtn').addEventListener('click', saveLocation);
  // Dátum alapértelmezések
  const mozgDatum = E('mozgDatum'); if (mozgDatum) mozgDatum.value = tod();
  const bevDatum  = E('bevDatum');  if (bevDatum)  bevDatum.value  = tod();
  // Anyag szűrő feltöltése a készlet fülön (anyaglista alapján)
  E('keszletAnyagF').innerHTML = '<option value="">— Mind —</option>' +
    (state.anyagok || []).sort((a,b)=>a.localeCompare(b,'hu'))
      .map(a => `<option value="${esc(a)}">${esc(a)}</option>`).join('');

  // Prémium al-fülek
  E('premiumSubtabs').addEventListener('click', e => {
    const btn = e.target.closest('.stab-btn'); if (!btn || !btn.dataset.ptab) return;
    switchPremiumTab(btn.dataset.ptab);
  });
  E('premiumMentBtn').addEventListener('click', savePremiumHistory);

  // Admin — prémium konfig
  E('premiumAdminSaveBtn').addEventListener('click', savePremiumAdminConfig);

  // Admin — adatok
  E('exportAllBtn').addEventListener('click',       exportAllDataExcel);
  E('mentFajlBtn').addEventListener('click',        mentFajl);
  E('fajlKivBtn').addEventListener('click',         () => E('fajlInput').click());
  E('fajlInput').addEventListener('change',         betoltFajl);
  E('mindTorBtn').addEventListener('click',         mindTorol);
  E('loginLogRefreshBtn').addEventListener('click', loadLoginLog);
  E('auditRefreshBtn').addEventListener('click', loadAuditLogAdmin);
  ['auditTipusF','auditUserF','auditTolF','auditIgF'].forEach(id => {
    E(id)?.addEventListener('change', () => {
      import('./admin.js').then(m => m.applyAuditFilter?.());
    });
  });
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
