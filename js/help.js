import { isMainAdmin, hasPerm } from './state.js';
import { E } from './utils.js';

/* Minden szekció: { id, icon, title, perm(), content() } */
const SECTIONS = [
  {
    id: 'navigacio', icon: '🧭', title: 'Navigáció & alapok',
    perm: () => true,
    content: () => `
      <p>A program bal oldalán (sidebar módban) vagy felül (klasszikus módban) található a <strong>navigációs sáv</strong> az elérhető modulokkal.</p>
      <ul>
        <li>A jobb felső sarokban a <strong>🌙/☀️ gombbal</strong> válthatsz sötét és világos mód között</li>
        <li>A <strong>🎨 gombbal</strong> 5 dizájn-téma közül választhatsz (Blueprint, Forest, Terra, Grafit, Viola)</li>
        <li>Az elrendezés a 🎨 menüben váltható: <strong>Klasszikus</strong> (fejléc + felső tabs) vagy <strong>Sidebar</strong> (oldalsáv üveges kártyákkal)</li>
      </ul>
      <div class="help-tip">Mobiltelefonon a ✏️ FAB gomb (jobb alul) gyorsbillentyűként működik az aktuális fülhöz igazodva.</div>
    `
  },
  {
    id: 'attekintes', icon: '🏠', title: 'Áttekintés (Dashboard)',
    perm: () => true,
    content: () => `
      <p>Az <strong>Áttekintés</strong> az alapértelmezett kezdőlap, személyre szabható widgetekkel.</p>
      <ul>
        <li>A <strong>⚙ Testreszab</strong> gombbal be/ki kapcsolhatod a widgeteket, és beállíthatod méretüket (▢ Kis = 1 cella, ▭ Nagy = 2 cella)</li>
        <li>A widgetek <strong>húzd-és-ejtsd</strong> módszerrel átrendezhetők — fogd meg a ⠿ jelzőt és húzd a célpozícióba</li>
        <li><strong>Auto frissítés</strong>: a konfig panelben 1–30 perces automatikus frissítés állítható be (pl. falra akasztott monitorhoz)</li>
        <li>A <strong>Gyors műveletek</strong> sáv (✏️ 📊 📌 👷) közvetlenül a leggyakoribb funkciókra navigál</li>
      </ul>
      <div class="help-tip">A widget számok animáltan „felszámlálnak" minden betöltéskor. A 🎂 Születésnapok widget 30 napon belüli születésnapokat mutat.</div>
    `
  },
  {
    id: 'adatbevitel', icon: '✏️', title: 'Adatbevitel',
    perm: () => isMainAdmin() || hasPerm('adatbevitel'),
    content: () => `
      <p>Az <strong>Adatbevitel</strong> lapon rögzítheted a napi termelési adatokat.</p>
      <ul>
        <li><strong>Dátum & Műszak</strong> — válaszd ki a napot (alapértelmezés: ma) és a műszakot (Délelőtt / Délután)</li>
        <li><strong>Részleg</strong> — a 📌 gombbal rögzítheted az aktuális részleget, hogy ne kelljen minden bejegyzésnél újra beírni</li>
        <li><strong>Dolgozó neve & Anyagtípus</strong> — a korábban felvett nevek automatikusan megjelennek; Enter-rel az adat rögzítésére ugrhatsz</li>
        <li><strong>Súlyok</strong> — add meg a darált súlyokat kg-ban, jelöld meg Teli vagy Megkezdett állapotot; a ＋ gombbal új sort adhatsz hozzá</li>
        <li><strong>Teli zsákok</strong> — a teli zsákok súlya külön oszlopban rögzíthető</li>
        <li><strong>Napi megjegyzés</strong> — gépprobléma, anyagszükséglet stb. az adott naphoz/részleghez</li>
      </ul>
      <div class="help-tip">Ha félbehagyod a formot és elhagyod az oldalt, az adatok automatikusan mentődnek <strong>vázlatként</strong>. Visszatéréskor egy sárga sáv kínálja a visszaállítást vagy elvetést.</div>
    `
  },
  {
    id: 'jelentesek', icon: '📋', title: 'Jelentések',
    perm: () => isMainAdmin() || hasPerm('sajatJelentes') || hasPerm('mindenJelentes'),
    content: () => `
      <p>A <strong>Jelentések</strong> lapon két al-fül érhető el:</p>
      <p><strong>Napi riport</strong> — válassz dátumot, majd kattints a Mutat gombra. A ‹ › nyilakkal naponként léphetsz. Szűrhetsz dolgozóra, műszakra és részlegre.</p>
      <p><strong>Időszakos riport</strong> — havi, éves vagy egyéni dátumtartományra. A <em>⚙ Szekciók beállítása</em> gombban személyre szabhatod mit tartalmazzon.</p>
      <ul>
        <li><strong>⬇ Kép</strong> — JPG exportálás</li>
        <li><strong>⬇ PDF</strong> — nyomtatható PDF (mindig világos módban generálódik)</li>
        <li><strong>⬇ Excel</strong> — XLSX fájl, minden táblázat külön munkalapon (Kovács Péter, Kiss Anna stb. névvel)</li>
        <li><strong>🖨 Nyomtat</strong> — böngészős nyomtatási párbeszéd</li>
      </ul>
      <div class="help-tip">A napi bontásban a kék dátumokra kattintva az érintett nap napi riportjára ugrhatsz.</div>
    `
  },
  {
    id: 'naptar', icon: '📅', title: 'Naptár',
    perm: () => isMainAdmin() || hasPerm('naptar'),
    content: () => `
      <p>A <strong>Naptár</strong> lapon vizuálisan látható a termelés alakulása.</p>
      <ul>
        <li><strong>📅 Havi nézet</strong> — minden nap egy cella, zöld intenzitás mutatja a termelés mértékét</li>
        <li><strong>🗓 Éves nézet</strong> — GitHub-stílusú hőtérkép, az egész év áttekintése egy képernyőn (52 hét × 7 nap)</li>
        <li>Bármely cellára kattintva egy <strong>popup</strong> jelenik meg: napi tonnában kifejezett adat + eltérés a havi átlagtól (+/-%). A „Teljes napi riport →" gombbal közvetlenül a riportra ugrhatsz</li>
      </ul>
    `
  },
  {
    id: 'elemzes', icon: '📈', title: 'Elemzés',
    perm: () => isMainAdmin() || hasPerm('elemzes'),
    content: () => `
      <p>Az <strong>Elemzés</strong> lapon négy al-fül érhető el:</p>
      <ul>
        <li><strong>Egyéni elemzés</strong> — válassz dolgozót és anyagot; láthatod az összefoglalót (átlag, legjobb/leggyengébb nap, szórás) és az üzemi átlaggal való összehasonlítást</li>
        <li><strong>Anyagtípus rangsor</strong> — egy adott anyagnál ki termel legtöbbet átlagosan, személyes rekorddal és leggyengébb nappal</li>
        <li><strong>Személyes rekordok</strong> — minden dolgozó legjobb napja, rangsorolva (kattintható tábla)</li>
        <li><strong>Összehasonlítás</strong> — két dolgozó egymás mellé helyezve, ugyanarra az anyagra: statisztikai tábla + vizuális sávdiagram</li>
      </ul>
    `
  },
  {
    id: 'feladatok', icon: '📌', title: 'Feladatok',
    perm: () => isMainAdmin() || hasPerm('feladatokKezeles'),
    content: () => `
      <p>A <strong>Feladatok</strong> lapon csapat-szintű feladatokat kezelhetsz.</p>
      <ul>
        <li><strong>☰ Lista nézet</strong> — feladatok időrendi listában, szűrhető állapot (Nyitott / Folyamatban / Kész) és részleg szerint</li>
        <li><strong>⬛ Kanban nézet</strong> — három oszlop: Nyitott · Folyamatban · Kész. A → gombbal léptetheted az állapotot a következő fázisba</li>
        <li>Bármely feladatkártyára kattintva megnyílik a <strong>szerkesztő drawer</strong>: szerkeszthető a cím, leírás, prioritás, határidő, felelős és állapot</li>
        <li><strong>Felelős</strong> — a feladat hozzárendelhető egy felhasználóhoz; a felelős is lezárhatja a feladatát</li>
        <li>Az <strong>Új feladat</strong> fejlécre kattintva nyílik ki a form; mentés után automatikusan becsukódik</li>
      </ul>
      <div class="help-tip">Mobilon a ✏️ FAB gombra kattintva a Feladatok lapon az Új feladat form automatikusan kinyílik.</div>
    `
  },
  {
    id: 'dolgozok', icon: '👷', title: 'Dolgozők',
    perm: () => isMainAdmin() || hasPerm('dolgozokMegtekintes') || hasPerm('dolgozokKezeles'),
    content: () => `
      <p>A <strong>Dolgozók</strong> lapon négy al-fül érhető el:</p>
      <ul>
        <li><strong>Adatlapok</strong> — kereshetsz névben, részlegben, pozícióban és kompetenciákban. Rendezhetsz névsor / belépési dátum / részleg szerint. Kártyára kattintva részletes drawer nyílik, ahol 📄 PDF adatlap is generálható</li>
        <li><strong>Hiányzások</strong> — havi szűrővel listázhatók a hiányzások (szabadság 🌴 · betegszabadság 🤒 · fizetés nélküli 📋 · egyéb ❓)</li>
        <li><strong>Naptár (roster)</strong> — havi nézet: ki mikor volt hiányzáson. Üres, munkanapra kattintva gyorsan rögzíthetsz hiányzást</li>
        <li><strong>Statisztika</strong> — éves összesítő tábla típusonként bontva, részlegenként összesítve. CSV exportálható</li>
      </ul>
      ${isMainAdmin() || hasPerm('dolgozokKezeles') ? `
      <p>Új dolgozó felvitelekor megadható: név, részleg, pozíció/beosztás, belépési dátum, szerződés típusa, éves szabadságkeret és <strong>kompetenciák</strong> (chip-alapú tag input — gépelj és nyomj Entert).</p>
      ` : ''}
    `
  },
  {
    id: 'tulora', icon: '⏰', title: 'Túlóra nyilvántartás',
    perm: () => isMainAdmin() || hasPerm('dolgozokKezeles'),
    content: () => `
      <p>A Dolgozók → <strong>Túlóra</strong> al-fülön rögzítheted a túlórákat.</p>
      <ul>
        <li>Szűrhetsz hónap és dolgozó szerint, majd kattints a Mutat gombra</li>
        <li>Minden bejegyzés tartalmaz: dolgozó neve, dátum, túlóra óra száma, megjegyzés</li>
        <li>A lista tetején összesítő kártyák mutatják az összes túlóra-órát és a top dolgozókat ebben a hónapban</li>
      </ul>
    `
  },
  {
    id: 'premium', icon: '💰', title: 'Prémium számítás',
    perm: () => isMainAdmin() || hasPerm('premiumMegtekintes') || hasPerm('premiumKezeles'),
    content: () => `
      <p>A <strong>Prémium</strong> lapon havi prémium kalkuláció végezhető.</p>
      <ul>
        <li>Válassz hónapot (és opcionálisan részleget), majd kattints a <strong>Számol</strong> gombra</li>
        <li>Minden dolgozóra megmutatja: aktív napok száma, prémium-jogosult napok, kiszámolt prémium összeg</li>
        <li>A számítás <strong>naponként értékeli</strong> az alapteljesítményt — csak azok a napok számítanak ahol elérte a napi alapot</li>
      </ul>
      ${isMainAdmin() || hasPerm('premiumKezeles') ? `
      <div class="help-tip">Admin → Prémium konfig fülön anyagonként beállítható az alapteljesítmény (kg/nap), a prémium aránya (%) és az eladási ár. Csak azok az anyagok kapnak prémiumot, amelyeknél ki van töltve a konfiguráció.</div>
      ` : ''}
    `
  },
  {
    id: 'kozlemeny', icon: '📢', title: 'Közlemények',
    perm: () => isMainAdmin() || hasPerm('kozlemenyIras'),
    content: () => `
      <p>Az <strong>Admin → Közlemény</strong> fülön közzétehetsz üzeneteket az Áttekintés oldalra.</p>
      <ul>
        <li><strong>7 típus</strong>: Tájékoztatás ℹ️ · Figyelmeztetés ⚠️ · Jó hír ✅ · Sürgős 🔴 · Esemény 📅 · Karbantartás 🔧 · Hír 🎉</li>
        <li><strong>Láthatóság</strong>: Mindenki / Csak adminok / Adott részleg</li>
        <li><strong>Lejárat</strong>: opcionálisan megadható dátum, ami után a közlemény automatikusan eltűnik</li>
        <li>A felhasználók az ✕ gombbal bezárhatják az üzenetet — az adminnak látszik hányan olvasták el (👁 N)</li>
      </ul>
    `
  },
  {
    id: 'admin', icon: '⚙️', title: 'Admin funkciók',
    perm: () => isMainAdmin() || hasPerm('felhasznalokKezelese'),
    content: () => `
      <p>Az <strong>Admin</strong> lapon az alábbi funkciók érhetők el:</p>
      <ul>
        ${isMainAdmin() ? '<li><strong>👥 Felhasználók</strong> — fióklistázás, szerepkörök hozzárendelése, fiókok törlése</li>' : ''}
        ${isMainAdmin() ? '<li><strong>🎭 Szerepkörök</strong> — 13 jogosultság 4 kategóriában (Termelés / Szervezet / Pénzügyi / Admin). 4 sablon: Dolgozó, Csoportvezető, HR, Könyvelő</li>' : ''}
        ${isMainAdmin() || hasPerm('felhasznalokKezelese') ? '<li><strong>📋 Listák</strong> — névlista, anyaglista, részleglista szerkesztése; dupla kattintás = szerkesztés</li>' : ''}
        ${isMainAdmin() ? '<li><strong>📋 Audit log</strong> — a rendszerben végrehajtott módosítások időrendben (utolsó 200 esemény)</li>' : ''}
        ${isMainAdmin() ? '<li><strong>💾 Adatok</strong> — bejegyzések mentése JSON fájlba és visszatöltése. <em>Minden bejegyzés törlése visszafordíthatatlan!</em></li>' : ''}
      </ul>
    `
  }
];

let _inited = false;

export function initHelp() {
  if (_inited) return;
  _inited = true;

  const container = E('helpSections');
  if (!container) return;

  const visible = SECTIONS.filter(s => s.perm());
  if (!visible.length) {
    container.innerHTML = `<div class="empty-st"><div class="empty-ic">❓</div><div class="empty-title">Nincs elérhető súgó</div></div>`;
    return;
  }

  container.innerHTML = visible.map(s => `
    <div class="help-section">
      <button class="help-section-hdr" data-help-id="${s.id}" type="button">
        <span class="help-section-icon">${s.icon}</span>
        <span class="help-section-title">${s.title}</span>
        <span class="help-section-arrow">›</span>
      </button>
      <div class="help-section-body" id="helpBody-${s.id}">${s.content()}</div>
    </div>
  `).join('');

  container.addEventListener('click', e => {
    const hdr = e.target.closest('[data-help-id]');
    if (!hdr) return;
    const body  = E('helpBody-' + hdr.dataset.helpId);
    const isOpen = hdr.classList.contains('open');
    hdr.classList.toggle('open', !isOpen);
    body.style.display = isOpen ? 'none' : 'block';
  });
}
