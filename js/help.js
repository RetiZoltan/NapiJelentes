import { isMainAdmin, hasPerm } from './state.js';
import { E } from './utils.js';

const SECTIONS = [
  /* ── Navigáció & Alapok ─────────────────────────────── */
  {
    id: 'navigacio', icon: '🧭', title: 'Navigáció & alapok',
    teaser: 'Témák, elrendezés, mobilos funkciók',
    perm: () => true,
    content: () => `
      <p>A program tetején (klasszikus mód) vagy bal oldalán (sidebar mód) találod a <strong>navigációs sávot</strong> — csak azok a fülek látszanak, amihez jogosultságod van.</p>

      <p><strong>Dizájn beállítások</strong> (jobb felső sarokban, 🎨 ikon):</p>
      <ul>
        <li><strong>🌙 / ☀️</strong> — sötét / világos mód váltása</li>
        <li><strong>Színtémák</strong> — 5 lehetőség: Blueprint (kék), Forest (zöld), Terra (barna), Grafit (szürke), Viola (lila)</li>
        <li><strong>Elrendezés</strong> — Klasszikus (vízszintes fülek) vagy Sidebar (függőleges oldalsáv üveges háttérrel)</li>
        <li><strong>Adatbevitel nézet</strong> — Kompakt vagy Bővített form megjelenítés</li>
      </ul>

      <p><strong>Mobilos funkciók:</strong></p>
      <ul>
        <li>A <strong>✏️ FAB gomb</strong> (jobb alul, csak mobilon) az aktuális fülhöz igazodik: Adatbevitelen → adatrögzítés, Feladatokon → új feladat form</li>
        <li><strong>Lefelé húzással</strong> (pull-to-refresh) frissíthető az aktív oldal</li>
      </ul>

      <div class="help-tip">Az oldal először mindig az <strong>Áttekintés</strong> fülre nyílik. A téma és elrendezés-beállítások eszközönként mentődnek (localStorage).</div>
    `
  },

  /* ── Áttekintés ─────────────────────────────────────── */
  {
    id: 'attekintes', icon: '🏠', title: 'Áttekintés',
    teaser: 'Személyre szabható widgetek, gyors műveletek, auto-frissítés',
    perm: () => true,
    content: () => `
      <p>Az <strong>Áttekintés</strong> a személyre szabható kezdőlap. A widgetek fölött egy <strong>kompakt összesítő sáv</strong> mutatja: Ma · Ezen a héten · Ebben a hónapban termelés tonnában.</p>

      <p><strong>⚙️ Beállítások panel</strong> (jobb felső sarokból vagy a gyors műveletek sorából nyitható):</p>
      <ul>
        <li><strong>Widgetek</strong> — be/ki kapcsolás, méret (▢ Kis = 1 cella / ▭ Nagy = 2 cella széles), egyedi cím, szín</li>
        <li><strong>Sorrend</strong> — hover-re megjelenő <strong>‹ ›</strong> nyilakkal balra/jobbra mozgatható; automatikusan mentődik</li>
        <li><strong>⚡ Gyors műveletek</strong> — a gyorsgombok be/ki kapcsolhatók</li>
        <li><strong>🔄 Auto frissítés</strong> — 1 / 5 / 10 / 30 perc, vagy kikapcsolva</li>
      </ul>

      <p><strong>Elérhető widgetek (13 db):</strong></p>
      <ul>
        <li>⚖️ <strong>Mai össztermelés</strong> — mai termelés tonnában, %-os eltérés a havi átlagtól</li>
        <li>📊 <strong>Havi összesítő</strong> — hónap eddigi termelése + napi átlag</li>
        <li>📉 <strong>Heti grafikon</strong> — SVG oszlopdiagram, mai nap kiemelve</li>
        <li>📈 <strong>Heti trend</strong> — e hét összege és az előző héthez viszonyított %-os változás</li>
        <li>📦 <strong>Anyag rangsor</strong> — havi top anyagok sávdiagrammal</li>
        <li>🏅 <strong>Havi legjobb</strong> — top 3 dolgozó 🥇🥈🥉 érmekkel</li>
        <li>👤 <strong>Saját teljesítmény</strong> — kiválasztott dolgozó mai / heti / havi termelése</li>
        <li>📌 <strong>Nyitott feladatok</strong> — darabszám, lejárt határidők kiemelve</li>
        <li>👷 <strong>Aktív dolgozók</strong> — jelenleg aktív státuszú dolgozók száma</li>
        <li>🎂 <strong>Közelgő születésnapok</strong> — 30 napon belüli születésnapok</li>
        <li>🎖️ <strong>Belépési jubileumok</strong> — 30 napon belüli munkaévfordulók (1+ év)</li>
        <li>📋 <strong>Utóbbi bejegyzések</strong> — az utolsó 5 bejegyzés dátummal és tonnával</li>
        <li>🔧 <strong>Karbantartás</strong> — 14 napon belül esedékes gépeseménynek figyelmeztető</li>
      </ul>

      <div class="help-tip">Az üdvözlő szöveg naphoz igazodik: hétfőn a múlt hét összesítőjét, pénteken az aktuális hét összesítőjét mutatja.</div>
    `
  },

  /* ── Adatbevitel ────────────────────────────────────── */
  {
    id: 'adatbevitel', icon: '✏️', title: 'Adatbevitel',
    teaser: 'Termelési adatok rögzítése, WIP zsákok, offline, vázlat',
    perm: () => isMainAdmin() || hasPerm('adatbevitel'),
    content: () => `
      <p>Az <strong>Adatbevitel</strong> lapon rögzítheted a napi termelési adatokat.</p>

      <p><strong>Form mezők:</strong></p>
      <ul>
        <li><strong>Dátum & Műszak</strong> — alapértelmezés: ma + Délelőtt. A 📌 gombbal rögzíthető a műszak, és visszatéréskor automatikusan kitöltődik. A dátum a múltba visszamódosítható</li>
        <li><strong>Részleg</strong> — a 📌 gombbal rögzíthető; rögzítés után minden bejegyzésnél automatikusan kitöltődik. A lista az Admin → Listák → Részleg → Anyag hozzárendelés szerint szűrődik</li>
        <li><strong>Dolgozó neve</strong> — a névlistából választható; ha van hozzárendelve alapértelmezett részleg, az automatikusan kitöltődik</li>
        <li><strong>Anyagtípus</strong> — részlegenként szűrt lista; csoportosítva jelenik meg ha csoportok vannak beállítva</li>
        <li><strong>Darált súlyok</strong> — minden sor: súly kg-ban + <strong>Teli</strong> / <strong>Megkezdett</strong> állapot. ＋ gombbal új sort adsz hozzá, ✕ törölsz. Ezek az értékek jelennek meg a teljesítmény statisztikákban</li>
        <li><strong>Teli zsákok</strong> — a véglegesen lezárt, csomagolt anyag súlyai; ezek alapozzák meg a Készlet modult</li>
        <li><strong>Napi megjegyzés</strong> — az adott naphoz és részleghez kötve; a Jelentésekben megjelenik</li>
      </ul>

      <p><strong>🟡 Gépen lévő zsákok (megkezdett zsákok nyilvántartása):</strong></p>
      <ul>
        <li>Ha „Megkezdett" állapotú súlyt rögzítesz, a rendszer egy folyamatban lévő zsák-tételt nyit, és az Adatbevitel tetején a <strong>🟡 Gépen lévő zsákok</strong> kártyán jelenik meg — anyag, részleg, aktuális súly, utolsó hozzáadó/dátum/műszak</li>
        <li>A következő műszakban ugyanahhoz a tételhez hozzáadhatsz további súlyt; minden lépés bekerül az <strong>előzmények</strong> listájába</li>
        <li><strong>✓ Befejezem</strong> — a zsák végső súlyának megadásával lezárod: ekkor Teli zsákká válik és bekerül a termelési összesítésbe; az anyag és részleg automatikusan kitöltődik az adatbeviteli formba</li>
        <li><strong>↩ Visszavon</strong> — az utolsó hozzáadás visszavonható; ha egyetlen bejegyzés volt, megerősítés után a teljes tétel törlődik</li>
      </ul>

      <div class="help-tip"><strong>Auto-save vázlat:</strong> félbehagyás és oldal elhagyásakor az adatok 24 óráig automatikusan mentődnek. Visszatéréskor sárga sáv kínálja a visszaállítást.<br><strong>Offline mód:</strong> internet nélkül is rögzíthetsz — a bejegyzések várósorba kerülnek és visszakapcsolódáskor automatikusan feltöltődnek.</div>
    `
  },

  /* ── Jelentések ─────────────────────────────────────── */
  {
    id: 'jelentesek', icon: '📋', title: 'Jelentések',
    teaser: 'Napi és időszakos riportok, szűrők, PDF / Excel / kép export',
    perm: () => isMainAdmin() || hasPerm('sajatJelentes') || hasPerm('mindenJelentes'),
    content: () => `
      <p>A <strong>Jelentések</strong> lapon két al-fül érhető el: <strong>📋 Napi</strong> és <strong>📊 Időszakos</strong>.</p>

      <p><strong>📋 Napi riport:</strong></p>
      <ul>
        <li>Válassz dátumot, majd kattints a <strong>Mutat</strong> gombra. A <strong>‹ ›</strong> nyilakkal naponként léphetsz, a <strong>Ma</strong> gombbal az aktuális napra ugraszhatsz</li>
        <li>Szűrhetsz: Dolgozó · Műszak (Délelőtt/Délután) · Részleg — változtatáskor azonnal frissül</li>
        <li>A fejlécen: aznapi össztermelés, legjobb teljesítmény, aktív dolgozók száma; alatta részlegenkénti és dolgozónkénti bontás, napi megjegyzések</li>
        <li>Megfelelő jogosultsággal bejegyzések <strong>szerkeszthetők</strong> (✎) vagy <strong>törölhetők</strong> (✕, több is egyszerre)</li>
      </ul>

      <p><strong>📊 Időszakos riport:</strong></p>
      <ul>
        <li><strong>4 mód</strong>: Havi · Heti · Éves · Egyéni tartomány (tól–ig dátum)</li>
        <li>Szűrők: Részleg · Dolgozó · Anyagtípus · Műszak — aktív szűrők chipekként jelennek meg</li>
        <li><strong>⚙ Szekciók beállítása</strong> — testreszabható, mi látsszon a riportban (eszközönként mentődik):
          <ul>
            <li><em>Fő összesítések:</em> Teljes termelés · Dolgozói rangsor · Anyagtípus összesítés</li>
            <li><em>Grafikonok:</em> 🏆 Időszak rekordjai · 🗓 Naptár hőtérkép · Napi vonaldiagram · Dolgozói sávdiagram</li>
            <li><em>Átlagok:</em> Napi átlagteljesítmény · Dolgozónkénti napi átlag · Havi átlag (csak Éves riportnál) · Műszakok összehasonlítása</li>
            <li><em>Részletező táblázatok:</em> Dolgozónkénti · Anyagonkénti · Napi bontás</li>
          </ul>
        </li>
        <li><strong>🏭 Részleg összesítés</strong> — mindig látható (legalább két aktív részlegnél)</li>
      </ul>

      <p><strong>📊 Időszak-összehasonlítás:</strong></p>
      <ul>
        <li>„Összevetés az előző időszakkal" jelölőnégyzet bekapcsolásával megjelenik egy összehasonlító kártya</li>
        <li>Havinál az előző hónap, Hetinél az előző hét, Évesnél az előző év, Egyéninél az ugyanannyi napos megelőző intervallum</li>
        <li>▲ zöld = növekedés, ▼ piros = csökkenés; részlegenként és anyagonként is bontva</li>
      </ul>

      <p><strong>Export lehetőségek:</strong></p>
      <ul>
        <li><strong>⬇ Kép</strong> — JPG, mindig világos háttérrel (sötét módban is olvasható)</li>
        <li><strong>⬇ PDF</strong> — nyomtatható, többoldalas ha szükséges</li>
        <li><strong>⬇ Excel</strong> — XLSX; dolgozónkénti/anyagonkénti részletezésnél minden tétel külön munkalapon</li>
        <li><strong>🖨 Nyomtat</strong> — böngészős nyomtatási párbeszéd fejléccel és lábléccel</li>
      </ul>
      <div class="help-tip">Az exportgombok csak akkor aktívak, ha már megjelenítettél egy riportot.</div>
    `
  },

  /* ── Naptár ─────────────────────────────────────────── */
  {
    id: 'naptar', icon: '📅', title: 'Naptár',
    teaser: 'Havi és éves termelési hőtérkép nézet',
    perm: () => isMainAdmin() || hasPerm('naptar'),
    content: () => `
      <p>A <strong>Naptár</strong> lapon vizuálisan látható a termelés alakulása.</p>
      <ul>
        <li><strong>📅 Havi nézet</strong> — minden nap egy cella. 5 szint: szürke (nincs adat) → kék → türkiz → zöld → narancs (maximális termelés). Legenda a jobb alsó sarokban</li>
        <li><strong>🗓 Éves nézet</strong> — GitHub-stílusú hőtérkép: 52 hét × 7 nap, az egész év egy képernyőn, hónapfeliratokkal</li>
        <li>Bármelyik napra kattintva <strong>popup</strong> jelenik meg az aznapi termelés tonnában és a havi átlagtól való eltéréssel. „Teljes napi riport →" gombbal a Jelentések fülre ugrik</li>
        <li>A <strong>‹ Előző / Következő ›</strong> gombokkal léphetsz hónapot vagy évet (nézettől függően)</li>
      </ul>
    `
  },

  /* ── Elemzés ─────────────────────────────────────────── */
  {
    id: 'elemzes', icon: '📈', title: 'Elemzés',
    teaser: 'Kattintható csempék: anyagok, dolgozók, műszakok, csapatok, részlegek, rekordok és egyéni mélyfúrás',
    perm: () => isMainAdmin() || hasPerm('elemzes'),
    content: () => `
      <p>Az <strong>Elemzés</strong> lapon csempék listája jelenik meg — egy csempére kattintva alatta nyílik meg a részletes, grafikonos panel: <strong>Tól/Ig dátumszűrővel</strong> (plusz gyorsgombok: 7/30/90 nap, Idei hónap, Idei év, Teljes előzmény) és egy <strong>⚙ Beállítások</strong> panellel, ami csempénként más opciókat kínál.</p>

      <p><strong>📦 Anyagtípusok / 👤 Dolgozók / 👥 Csapatok / 🏭 Részlegek összehasonlítása:</strong> Top-N rangsor sávdiagrammal és táblázattal, szűrőkkel (részleg, csapat, anyagcsoport, archivált dolgozók, egy konkrét anyagra szűrés a Dolgozóknál). Egy táblázatsorra kattintva megnyílik az adott elem napi trendje.</p>

      <p><strong>🕐 Műszakok összehasonlítása:</strong> Délelőtt vs. Délután, összesen vagy napi átlag nézetben; bekapcsolható a dolgozónkénti bontás, ami megmutatja, ki melyik műszakban termel jobban.</p>

      <p><strong>🧩 Anyag-specializáció mátrix:</strong> Dolgozó × anyag táblázat, a cellák az adott dolgozó termelésén belüli arányt mutatják — kiderül, ki mire "specializálódott".</p>

      <p><strong>🔍 Anyag kereső:</strong> Élő (gépelés közbeni) rész-szó keresés az anyagnév mezőn, listázza az egyező bejegyzéseket és az összsúlyt.</p>

      <p><strong>📅 Dátum szerinti elemzés:</strong> Naptár hőtérkép, heti bontás és a hét napjai szerinti átlagok, legjobb/leggyengébb nap.</p>

      <p><strong>📐 Átlag / Medián:</strong> Anyagonként (és dolgozónkénti bontásban) a napi átlag/medián termelés, kiugró napok IQR-alapú kiszűrésével, Min–Max és trend-jelzéssel. Kereső mezővel egyesíthetők a rész-egyezéssel talált anyagok (pl. ugyanaz az anyag más néven/színnel elmentve).</p>

      <p><strong>🏆 Rekordok:</strong> Minden dolgozó saját legjobb napja a kiválasztott időszakban, rangsorolva, 🥇🥈🥉 érmekkel.</p>

      <p><strong>👑 Csapat részletei:</strong> Egy kiválasztott csapatvezető csapatának tagonkénti rangsora (össztermelés, napi átlag, legjobb nap) + a csapat napi trendje. A vezető 👑 koronával jelölve.</p>

      <p><strong>🔬 Egyéni elemzés:</strong> Egy dolgozó + egy anyag kiválasztásával: napi átlag/medián/legjobb/leggyengébb nap, összevetés az adott anyagot termelő összes dolgozó átlagával, napi trend és naptár hőtérkép, a dolgozó összes anyagának rangsora napi átlag szerint (a kiválasztott anyag ◀ jelöléssel kiemelve), és egy napi bontás táblázat.</p>

      <p><strong>⚡ Gyors áttekintő:</strong> A dashboard-widgetekhez hasonló kártyás gyorsnézet: összesítő szám + trend görbe (a kiválasztott időszakra), Top 3 dolgozó és Top 3 anyag érmes mini-rangsorral, heti bontás oszlopdiagram (mindig az aktuális naptári hétre, a Tól/Ig szűrőtől függetlenül), legjobb/leggyengébb nap, műszak-megoszlás (Délelőtt/Délután arány), és — ha vannak műszakvezetők beállítva — Top csapatok mini-rangsor. A ⚙ Beállítások panelben Részleg szerint is szűrhető (a heti bontás kártyára is vonatkozik). <strong>Bármelyik kártyára kattintva</strong> helyben kibontható a részletesebb adat (pl. teljes rangsor, napi bontás, top 5 legjobb/leggyengébb nap) — újra kattintva bezárul.</p>
    `
  },

  /* ── Feladatok ──────────────────────────────────────── */
  {
    id: 'feladatok', icon: '📌', title: 'Feladatok',
    teaser: 'Lista & Kanban nézet, prioritás, felelős, határidő',
    perm: () => isMainAdmin() || hasPerm('feladatokKezeles'),
    content: () => `
      <p>A <strong>Feladatok</strong> lapon csapat-szintű teendőket kezelhetsz.</p>

      <p><strong>Nézetek:</strong></p>
      <ul>
        <li><strong>☰ Lista nézet</strong> — időrendi, szűrhető állapot és részleg szerint. Lejárt/közelgő határidő piros/sárga jelzéssel</li>
        <li><strong>⬛ Kanban nézet</strong> — 3 oszlop: Nyitott → Folyamatban → Kész. A <strong>→</strong> gombbal léptethetők az oszlopok között</li>
      </ul>

      <p><strong>Szűrők:</strong> Állapot (Nyitott / Folyamatban / Kész / Mind) · Részleg</p>

      <p><strong>Feladat létrehozása</strong> („Új feladat ›" fejlécre kattintva nyílik a form):</p>
      <ul>
        <li><strong>Cím</strong> (kötelező) · <strong>Leírás</strong> · <strong>Prioritás</strong>: 📌 Normal vagy ⚡ Fontos (piros kiemelés a listában)</li>
        <li><strong>Határidő</strong> · <strong>Részleg</strong> · <strong>Felelős</strong> hozzárendelése</li>
      </ul>

      <p><strong>Feladat szerkesztő drawer</strong> (kártyára kattintva nyílik):</p>
      <ul>
        <li>Szerkeszthető: cím, leírás, prioritás, határidő, részleg, felelős, állapot</li>
        <li>Előzmény: létrehozta ki és mikor, lezárta ki</li>
        <li>Felelős is lezárhatja a saját feladatát; újranyitás admin jog</li>
      </ul>

      <div class="help-tip">Mobilon a ✏️ FAB gomb (jobb alul) a Feladatok lapon az Új feladat formt nyitja meg közvetlenül.</div>
    `
  },

  /* ── Dolgozók ───────────────────────────────────────── */
  {
    id: 'dolgozok', icon: '👷', title: 'Dolgozók',
    teaser: 'Adatlapok, hiányzások, naptár, túlóra, statisztika',
    perm: () => isMainAdmin() || hasPerm('dolgozokMegtekintes') || hasPerm('dolgozokKezeles'),
    content: () => `
      <p>A <strong>Dolgozók</strong> lapon 5 al-fül érhető el.</p>

      <p><strong>👤 Adatlapok:</strong></p>
      <ul>
        <li><strong>⊞ Kártya / ☰ Lista nézet</strong> váltható a szűrők mellett</li>
        <li>Szűrők: Részleg · Státusz (Aktív/Inaktív/Szabadságon) · Névkeresés (névben, részlegben, pozícióban, kompetenciákban is keres)</li>
        <li>Rendezés: Névsor / Belépési dátum / Részleg szerint</li>
        <li>Kártyán látható: szabadság felhasznált/keret, státusz jelvény</li>
        <li>Kártyára kattintva <strong>részletes drawer</strong> nyílik:
          <ul>
            <li><strong>Alapadatok</strong> — telefon, e-mail, belépési dátum, születési dátum, szerződéstípus</li>
            <li><strong>Hiányzások (idei)</strong> — 🌴 Szabadság felh/keret/maradt · 🤒 Betegszabadság · 📋 Fizetés nélküli · ❓ Egyéb · összes hiányzás</li>
            <li><strong>Kompetenciák</strong> chipek formájában</li>
            <li><strong>Megjegyzés</strong> (ha van rögzítve)</li>
            <li><strong>📚 Képzési napló</strong> — dátum + képzés neve + megjegyzés, időrendben visszafelé. Szerkesztési joggal bővíthető (képzés neve + dátum + megjegyzés) és egyenként törölhető</li>
            <li><strong>📈 Termelési teljesítmény</strong> — összes idők darált adatai alapján: összes kg · aktív napok · rekord/nap · fő anyag · legjobb nap dátuma + 12 havi mini sávdiagram</li>
          </ul>
        </li>
      </ul>

      <p><strong>📄 PDF adatlap</strong> tartalmazza: alapadatok tábla (részleg, pozíció, belépés, születési dátum, szerződés, telefon, e-mail) · hiányzások részletezve · termelési teljesítmény statisztikák · kompetenciák · képzési napló (rendezett táblázat) · megjegyzés</p>

      <p><strong>📅 Hiányzások:</strong> Havi + dolgozó szűrővel listázható. Típusok: 🌴 Szabadság · 🤒 Betegszabadság · 📋 Fizetés nélküli · ❓ Egyéb. <em>Csak admin rögzíthet hiányzást.</em></p>

      <p><strong>🗓 Naptár (roster):</strong> Havi táblázat, ki mikor volt távol. Részleg szűrővel. Üres munkanapra kattintva gyors beviteli form jelenik meg alul.</p>

      <p><strong>⏰ Túlóra:</strong> Havi lista, dolgozó szűrővel. Összesítő kártyák: összes óra + érintett dolgozók száma. Statisztika fülön éves bontás dolgozónként.</p>

      <p><strong>📊 Statisztika:</strong> Éves összesítő hiányzásból típusonként és részlegenként. Az év kiválasztása után a túlóra éves összesítője is megjelenik. <strong>CSV export</strong> lehetséges.</p>

      ${isMainAdmin() || hasPerm('dolgozokKezeles') ? `
      <div class="help-tip"><strong>Dolgozó felvitelekor</strong> megadható: név (kötelező), részleg, pozíció, belépési dátum, születési dátum, státusz, szerződéstípus (határozatlan/határozott/megbízási), éves szabadságkeret (alapért.: 20 nap), telefon, e-mail, megjegyzés, kompetenciák (Enter-rel chipként adhatók hozzá).</div>
      ` : ''}
    `
  },

  /* ── Készlet ─────────────────────────────────────────── */
  {
    id: 'keszlet', icon: '📦', title: 'Készlet & Anyagmozgás',
    teaser: 'Anyagkészlet nyilvántartás, betárolás, áttárolás, helyszínek',
    perm: () => isMainAdmin() || hasPerm('keszletMegtekintes') || hasPerm('keszletKezeles'),
    content: () => `
      <p>A <strong>Készlet</strong> lapon az anyagkészlet és a belső mozgások tarthatók nyilván. A rendszer eseményalapú: minden készletváltozás egy-egy mozgásbejegyzés.</p>

      <p><strong>📊 Aktuális készlet:</strong></p>
      <ul>
        <li>Anyagonként és helyszínenként: <strong>zsák darabszám</strong> · összsúly (kg/t) · átlag/zsák · 🚛 kamion-szám</li>
        <li>A kamion kapacitás a ⚙️ Beállítások fülön helyszínenként állítható (alapértelmezett: 22 zsák)</li>
        <li>Kattintásra ▶ kinyílik a részletező: bevitelezések dátumával és <strong>egyedi zsák súlyok chipekben</strong></li>
        <li>Szűrhető anyag és helyszín szerint</li>
      </ul>

      <p><strong>↔️ Anyagmozgás — 2 típus:</strong></p>
      <ul>
        <li><strong>↔️ Áttárolás</strong> — meglévő készlet átvitele egyik helyszínről egy másikra (pl. raktárközi mozgatás). Zsák-csempékkel jelölheted ki melyiket, majd add meg a cél helyszínt</li>
        <li><strong>⬇️ Termelésből</strong> — a még be nem tárolt teli zsákos termelési bejegyzések közül a kijelöltek betárolódnak egy célhelyszínre</li>
      </ul>
      <p>A kijelölés zsák-csempékkel (chip) történik; az anyag/helyszín szűrőkkel megtalálod a kívánt tételt. Kijelölés után a felbukkanó <strong>⚡ panelen</strong> add meg a célhelyszínt, dátumot, opcionális megjegyzést, majd <strong>✓ Rögzít</strong>. A <strong>🗑 Töröl</strong> gombbal visszavonható egy korábban rögzített mozgás (jogosultságtól függően).</p>

      <p><strong>⚙️ Helyszínek</strong> (szerkesztési joggal): raktárak/területek felvétele, szerkesztése, színkóddal való megkülönböztetése. Archiválás nem töröl — a mozgások hivatkoznak rá.</p>
    `
  },

  /* ── Gépek ──────────────────────────────────────────── */
  {
    id: 'gepek', icon: '🔧', title: 'Gépek',
    teaser: 'Géppark, karbantartási napló, állapot és esedékesség',
    perm: () => isMainAdmin() || hasPerm('gepekMegtekintes') || hasPerm('gepekKezeles'),
    content: () => `
      <p>A <strong>Gépek</strong> lapon a darálók, présgépek és egyéb berendezések törzsadatai és üzemeltetési naplója vezethető.</p>

      <p><strong>Gépkártyák:</strong></p>
      <ul>
        <li>Állapot színes jelvénnyel: ✅ Üzemel · 🚨 Leállva · 🔧 Karbantartás alatt</li>
        <li>Ha a karbantartás 7 napon belül esedékes (vagy már lejárt), figyelmeztető sáv jelenik meg a kártyán</li>
      </ul>

      <p><strong>Részletező drawer</strong> (kártyára kattintva):</p>
      <ul>
        <li><strong>Alapadatok</strong> — gyártó, gyártási év, karbantartási ciklus (napban), utolsó karbantartás dátuma, megjegyzés</li>
        <li><strong>Következő karbantartás</strong> — automatikusan kiszámolt esedékesség, hátralévő napok és egy zöld → sárga → piros előrehaladás-sáv</li>
        <li><strong>Esemény napló</strong> — utolsó 10 bejegyzés: 🔧 Karbantartás · 🚨 Leállás · 🔨 Javítás · ✅ Üzembe helyezés — dátummal, opcionális időtartammal (óra) és megjegyzéssel</li>
      </ul>

      ${isMainAdmin() || hasPerm('gepekKezeles') ? `
      <p><strong>Szerkesztési jogosultsággal:</strong></p>
      <ul>
        <li><strong>＋ Új gép</strong> — felvétel: név (kötelező), típus, gyártó, gyártási év, karbantartási ciklus napban, utolsó karbantartás dátuma, kezdeti állapot, megjegyzés</li>
        <li><strong>Esemény rögzítése</strong> — típus, dátum, opcionális időtartam és megjegyzés; ezek alkotják a gép üzemeltetési előzményét</li>
        <li><strong>✎ Szerkeszt / 🗑 Töröl</strong> — az esemény napló egyes elemei is törölhetők egyenként (✕)</li>
      </ul>
      ` : ''}

      <div class="help-tip">A karbantartási ciklus és az utolsó karbantartás dátuma alapján a rendszer automatikusan kiszámolja a következő esedékességet — mindig tartsd naprakészen.</div>
    `
  },

  /* ── Prémium ─────────────────────────────────────────── */
  {
    id: 'premium', icon: '💰', title: 'Prémium számítás',
    teaser: 'Teljesítményalapú prémium kiszámítása és archiválás',
    perm: () => isMainAdmin() || hasPerm('premiumMegtekintes') || hasPerm('premiumKezeles'),
    content: () => `
      <p>A <strong>Prémium</strong> lapon két al-fül érhető el.</p>

      <p><strong>📊 Számítás:</strong></p>
      <ul>
        <li>Válassz hónapot (és opcionálisan részleget), majd kattints a <strong>Számol</strong> gombra</li>
        <li>A számítás <strong>naponként értékeli</strong> az alapteljesítményt — csak azok a napok számítanak prémiumba, ahol az adott anyagból elérte a napi alapot</li>
        <li>Dolgozóra kattintva kinyílik az anyagonkénti részletes bontás: napi alap (kg) · prémium napok száma · túlteljesítés · kiszámolt prémium összeg</li>
        <li>A <strong>💾 Mentés</strong> gombbal az aktuális eredmény az Előzmények fülre kerül</li>
      </ul>

      <p><strong>📋 Előzmények:</strong></p>
      <ul>
        <li>Listázza az összes mentett hónap összesítőjét: hónap · összprémium · mentő neve · dátum · dolgozók száma</li>
        <li><strong>Betölt</strong> — visszatölti az adott hónap eredményét a Számítás nézetre</li>
        <li><strong>✕</strong> — törli a mentett előzményt</li>
      </ul>

      ${isMainAdmin() || hasPerm('premiumKezeles') ? `
      <div class="help-tip">Admin → <strong>💰 Prémium konfig</strong> fülön anyagonként beállítható: napi alap (kg/nap), prémium aránya (%), eladási ár (Ft/kg). Csak konfigurált anyagok kapnak prémiumot.</div>
      ` : ''}
    `
  },

  /* ── Közlemény ──────────────────────────────────────── */
  {
    id: 'kozlemeny', icon: '📢', title: 'Közlemények',
    teaser: 'Üzenetek közzététele az Áttekintés oldalon',
    perm: () => isMainAdmin() || hasPerm('kozlemenyIras'),
    content: () => `
      <p>Az <strong>Admin → Közlemény</strong> fülön közzétehetsz üzeneteket, amelyek az Áttekintés oldalon kártyaként jelennek meg.</p>
      <ul>
        <li><strong>7 típus</strong>: ℹ️ Tájékoztatás · ⚠️ Figyelmeztetés · ✅ Jó hír · 🔴 Sürgős · 📅 Esemény · 🔧 Karbantartás · 🎉 Hír — minden típus más színű bal oldali sávval jelenik meg</li>
        <li><strong>Láthatóság</strong>: Mindenki / Csak adminok</li>
        <li><strong>Lejárat</strong>: opcionálisan megadható dátum — a lejárt közlemények automatikusan eltűnnek a felhasználóknál</li>
        <li>A felhasználók az <strong>✕ gombbal</strong> bezárhatják az üzenetet; a bezárás eszközönként mentődik</li>
        <li>Az admin látja hányan olvasták el (<strong>👁 N elolvasva</strong>) és mikor járt le</li>
        <li>Törlés: a lista jobb szélén lévő ✕ gombbal</li>
      </ul>
    `
  },

  /* ── Admin ──────────────────────────────────────────── */
  {
    id: 'admin', icon: '⚙️', title: 'Admin funkciók',
    teaser: 'Felhasználók, szerepkörök, listák, naplók, biztonsági mentés',
    perm: () => isMainAdmin() || hasPerm('felhasznalokKezelese') || hasPerm('kozlemenyIras'),
    content: () => `
      <p>Az <strong>Admin</strong> lapon az alábbi funkciók érhetők el (jogosultságtól függően):</p>

      ${isMainAdmin() ? `
      <p><strong>👥 Felhasználók:</strong></p>
      <ul>
        <li>Listázza az összes regisztrált fiókot: név · e-mail · szerepkör · <strong>utolsó belépés időpontja</strong></li>
        <li>Szerepkör hozzárendelése a legördülőből (nem főadmin fiókoknál)</li>
        <li><strong>⏸ Letiltás</strong> — a felhasználó fiókja deaktiválható törlés nélkül. Visszakapcsolható ▶ Aktivál gombbal</li>
        <li>Törlés — véglegesen törli a felhasználó dokumentumát</li>
      </ul>

      <p><strong>🎭 Szerepkörök:</strong></p>
      <ul>
        <li>13+ jogosultság 4 kategóriában: Termelés / Szervezet / Pénzügyi / Adminisztráció</li>
        <li>4 gyors sablon: 👷 Dolgozó · 👨‍💼 Csoportvezető · 📋 HR · 📊 Könyvelő</li>
        <li>A szerepkör kártyákon color-coded badge-ek mutatják a jogosultságokat</li>
      </ul>
      ` : ''}

      ${isMainAdmin() || hasPerm('felhasznalokKezelese') ? `
      <p><strong>📋 Listák:</strong></p>
      <ul>
        <li><strong>Névlista</strong> — Ctrl+klik = több · Dupla klik = szerkesztés · dőlt = archivált. Archiválás eltünteti a legördülőből, de az adatok megmaradnak; Visszaállítás visszahozza</li>
        <li><strong>Anyaglista</strong> — Ctrl+klik = több · Dupla klik = szerkesztés · Kijelöltek törlése</li>
        <li><strong>Részleglista</strong> — Ctrl+klik = több · Dupla klik = szerkesztés · Kijelöltek törlése</li>
        <li><strong>Anyagcsoportok</strong> — anyagok csoportosítása; az adatbevitelben csoportosítva jelennek meg a legördülőben</li>
      </ul>
      <p><strong>Hozzárendelések</strong> (összecsukható szekciók):</p>
      <ul>
        <li><strong>Dolgozó → Alapértelmezett részleg</strong> — névválasztáskor automatikusan kitöltődik (ha nincs 📌-el rögzítve)</li>
        <li><strong>Részleg → Anyag hozzárendelés</strong> — melyik részleg melyik anyagokkal dolgozik; ha üres, minden anyag látható</li>
        <li><strong>Anyag → Csoport hozzárendelés</strong> — anyagokat csoporthoz rendelve csoportosított legördülő az adatbevitelben</li>
        <li><strong>Dolgozó → Műszakvezető hozzárendelés</strong> — minden aktív dolgozóhoz egy műszakvezetőt lehet rendelni. Szekció automatikusan megjelenik, ha legalább 2 aktív dolgozó van. Mentés után a napi és időszakos jelentésekben megjelenik a műszakvezető szűrő, az Elemzés lapon a Csapatok/Csapat részletei csempék, és a dashboardon a Csapat összesítő widget.</li>
      </ul>
      ` : ''}

      ${isMainAdmin() || hasPerm('kozlemenyIras') ? `
      <p><strong>📢 Közlemény:</strong> Lásd a Közlemények szekciót.</p>
      ` : ''}

      ${isMainAdmin() ? `
      <p><strong>💰 Prémium konfig:</strong> Anyagonként beállítható napi alap (kg), prémium arány (%), eladási ár (Ft/kg).</p>

      <p><strong>📋 Audit log:</strong></p>
      <ul>
        <li>Rendszerbeli műveletek naplója (utolsó 500 esemény)</li>
        <li>Szűrők: típus (bejegyzés · dolgozó · feladat · közlemény · bejelentkezés · szerepkör · prémium · felhasználó · hiányzás · túlóra) · felhasználó · dátum tól–ig</li>
      </ul>

      <p><strong>🔑 Belépési napló:</strong> Minden sikeres Google-bejelentkezés időpontja, felhasználó neve és e-mail címe, valamint az eszköz típusa (OS + böngésző, pl. Windows · Chrome).</p>

      <p><strong>💾 Adatok:</strong></p>
      <ul>
        <li><strong>⬇ Mentés fájlba</strong> — JSON export (bejegyzések + listák + napi megjegyzések)</li>
        <li><strong>⬆ Betöltés fájlból</strong> — JSON importálás visszaállításhoz</li>
        <li><strong>Minden bejegyzés törlése</strong> — visszafordíthatatlan! Confirm párbeszéd véd véletlen törlés ellen</li>
      </ul>
      ` : ''}
    `
  }
];

/* ══════════════════════════════════════
   MODAL
══════════════════════════════════════ */
let _modalEl = null;

function _ensureModal() {
  if (_modalEl) return _modalEl;
  const el = document.createElement('div');
  el.id = 'helpModalOverlay';
  el.className = 'help-modal-overlay';
  el.style.display = 'none';
  el.innerHTML = `
    <div class="help-modal" role="dialog" aria-modal="true">
      <div class="help-modal-hdr">
        <span class="help-modal-hdr-icon" id="helpModalIcon"></span>
        <span class="help-modal-hdr-title" id="helpModalTitle"></span>
        <button class="help-modal-close" id="helpModalClose" type="button" aria-label="Bezárás">✕</button>
      </div>
      <div class="help-modal-body help-section-body" id="helpModalBody"></div>
    </div>`;
  document.body.appendChild(el);
  _modalEl = el;

  el.addEventListener('click', ev => {
    if (ev.target === el) _closeModal();
  });
  document.getElementById('helpModalClose').addEventListener('click', _closeModal);
  document.addEventListener('keydown', ev => {
    if (ev.key === 'Escape' && el.style.display !== 'none') _closeModal();
  });
  return el;
}

function _openModal(section) {
  const el = _ensureModal();
  document.getElementById('helpModalIcon').textContent  = section.icon;
  document.getElementById('helpModalTitle').textContent = section.title;
  document.getElementById('helpModalBody').innerHTML    = section.content();
  el.style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

function _closeModal() {
  if (_modalEl) _modalEl.style.display = 'none';
  document.body.style.overflow = '';
}

/* ══════════════════════════════════════
   INIT
══════════════════════════════════════ */
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

  container.innerHTML = `<div class="help-grid">${visible.map(s => `
    <button class="help-tile" data-help-id="${s.id}" type="button">
      <div class="help-tile-icon">${s.icon}</div>
      <div class="help-tile-title">${s.title}</div>
      <div class="help-tile-desc">${s.teaser}</div>
    </button>`).join('')}</div>`;

  container.addEventListener('click', ev => {
    const tile = ev.target.closest('[data-help-id]');
    if (!tile) return;
    const section = SECTIONS.find(s => s.id === tile.dataset.helpId);
    if (section) _openModal(section);
  });
}
