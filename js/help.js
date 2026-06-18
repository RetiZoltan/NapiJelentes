import { isMainAdmin, hasPerm } from './state.js';
import { E } from './utils.js';

const SECTIONS = [
  /* ── Navigáció & Alapok ─────────────────────────────── */
  {
    id: 'navigacio', icon: '🧭', title: 'Navigáció & alapok',
    perm: () => true,
    content: () => `
      <p>A program tetején (klasszikus mód) vagy bal oldalán (sidebar mód) találod a <strong>navigációs sávot</strong> az elérhető modulokkal — csak azok a fülek látszanak, amihez jogosultságod van.</p>
      <p><strong>Dizájn beállítások</strong> (jobb felső sarokban):</p>
      <ul>
        <li><strong>🌙 / ☀️</strong> — sötét / világos mód váltása</li>
        <li><strong>🎨</strong> — 5 színtéma: Blueprint (kék), Forest (zöld), Terra (barna), Grafit (szürke), Viola (lila)</li>
        <li>A 🎨 menüben az <strong>Elrendezés</strong> is váltható: Klasszikus (vízszintes fülek) vagy Sidebar (függőleges oldalsáv üveges háttérrel)</li>
      </ul>
      <p><strong>Mobilos funkciók:</strong></p>
      <ul>
        <li>A <strong>✏️ FAB gomb</strong> (jobb alul, csak mobilon) az aktuális fülhöz igazodik: Adatbevitelen → adatrögzítés, Feladatokon → új feladat form megnyitása</li>
        <li><strong>Lefelé húzással</strong> (pull-to-refresh) frissíthető az aktív oldal</li>
      </ul>
      <div class="help-tip">Az oldal először mindig az <strong>Áttekintés</strong> fülre nyílik, ahol személyre szabott összefoglalót láthatsz.</div>
    `
  },

  /* ── Áttekintés ─────────────────────────────────────── */
  {
    id: 'attekintes', icon: '🏠', title: 'Áttekintés (Dashboard)',
    perm: () => true,
    content: () => `
      <p>Az <strong>Áttekintés</strong> a személyre szabható kezdőlap, ami a legfontosabb adatokat jeleníti meg widgetekben.</p>

      <p><strong>Gyors műveletek sáv</strong> — a widgetek felett egy sor gomb a leggyakoribb funkciókhoz. A sor végén lévő <strong>⚙️ Beállítások</strong> gombra kattintva nyílik a konfiguráció.</p>

      <p><strong>Widget testreszabás</strong> (⚙️ Beállítások panel):</p>
      <ul>
        <li><strong>Widgetek szekció</strong> — be/ki kapcsolhatod az egyes widgeteket. Méretük is állítható: <strong>▢ Kis</strong> (1 cella) vagy <strong>▭ Nagy</strong> (2 cella széles)</li>
        <li><strong>Sorrend</strong> — minden widgeten hover-re megjelenő <strong>‹ ›</strong> nyilakkal balra/jobbra mozgatható. A beállítás automatikusan mentődik</li>
        <li><strong>⚡ Gyors műveletek szekció</strong> — a gyorsgombok is testreszabhatók; be/ki kapcsolható melyik látsszon</li>
        <li><strong>🔄 Auto frissítés</strong> — 1/5/10/30 perc, vagy kikapcsolva. Hasznos monitoron rögzített megjelenítőhöz</li>
      </ul>

      <p><strong>Elérhető widgetek:</strong></p>
      <ul>
        <li>⚖️ <strong>Mai össztermelés</strong> — mai termelés tonnában, %-os eltérés a havi átlagtól</li>
        <li>📊 <strong>Havi összesítő</strong> — hónap eddigi termelése + napi átlag</li>
        <li>📉 <strong>Heti grafikon</strong> — SVG oszlopdiagram, mai nap kiemelve, jövő halványítva</li>
        <li>📈 <strong>Heti trend</strong> — e hét összege és az előző héthez viszonyított %-os változás</li>
        <li>📦 <strong>Anyag rangsor</strong> — havi top anyagok sávdiagrammal (kis: 4 db, nagy: 6 db)</li>
        <li>🏅 <strong>Havi legjobb</strong> — top 3 dolgozó 🥇🥈🥉 érmekkel, havi termelésük alapján</li>
        <li>👤 <strong>Saját teljesítmény</strong> — megadott dolgozó mai / heti / havi átlag termelése; a widgetben lévő legördülőből bármely dolgozó kiválasztható</li>
        <li>📌 <strong>Nyitott feladatok</strong> — darabszám, lejárt határidők kiemelve</li>
        <li>👷 <strong>Aktív dolgozók</strong> — jelenleg aktív státuszú dolgozók száma</li>
        <li>🎂 <strong>Közelgő születésnapok</strong> — 30 napon belüli születésnapok listája</li>
        <li>🎖️ <strong>Belépési jubileumok</strong> — 30 napon belüli munkaévfordulók (1+ év)</li>
        <li>📋 <strong>Utóbbi bejegyzések</strong> — az utolsó 5 bejegyzés dátummal és tonnával</li>
      </ul>

      <p><strong>Összefoglaló sáv</strong> — a widgetek felett mindig látható kompakt sor: <em>Ma: X t · Ezen a héten: Y t · Ebben a hónapban: Z t</em></p>

      <div class="help-tip">Az üdvözlő szöveg naphoz igazodik: hétfőn a múlt hét összesítőjét, pénteken az aktuális hét összesítőjét mutatja.</div>
    `
  },

  /* ── Adatbevitel ────────────────────────────────────── */
  {
    id: 'adatbevitel', icon: '✏️', title: 'Adatbevitel',
    perm: () => isMainAdmin() || hasPerm('adatbevitel'),
    content: () => `
      <p>Az <strong>Adatbevitel</strong> lapon rögzítheted a napi termelési adatokat.</p>
      <ul>
        <li><strong>Dátum & Műszak</strong> — alapértelmezés: ma + Délelőtt. A dátum a múltba visszamódosítható, ha kimaradt egy rögzítés</li>
        <li><strong>Részleg</strong> — a 📌 gombbal rögzítheted; rögzítés után minden bejegyzésnél automatikusan kitöltődik. Újra 📌-re kattintva feloldható</li>
        <li><strong>Dolgozó neve & Anyagtípus</strong> — a beépített listából választható; Enter a következő mezőre ugrik</li>
        <li><strong>Darált súlyok</strong> — minden sor: súly kg-ban + <strong>Teli</strong> / <strong>Megkezdett</strong> állapot. ＋ gombbal újabb sort adsz hozzá, ✕ gombbal törölsz. A súlyokra kattintva kinyílik az egyedi zsák súlyok listája</li>
        <li><strong>Teli zsákok</strong> — a véglegesen lezárt, csomagolt anyag súlyát tartjuk nyilván külön; ez alapozza meg a Készlet modult, mert csak ezek a zsákok tárolhatók be</li>
        <li><strong>Napi megjegyzés</strong> — gépprobléma, anyaghiány, egyéb info az adott naphoz és részleghez kötve</li>
        <li><strong>Rögzítés gomb</strong> — csak az aktuális dolgozó+anyag bejegyzést menti; több dolgozó esetén minden sorhoz külön kattints</li>
      </ul>

      <p><strong>🟡 Gépen lévő zsákok (megkezdett zsákok nyilvántartása):</strong></p>
      <ul>
        <li>Ha egy bejegyzésnél „Megkezdett" állapotú súlyt rögzítesz, a rendszer egy folyamatban lévő zsák-tételt nyit, és az Adatbevitel tetején a <strong>🟡 Gépen lévő zsákok</strong> kártyán jelenik meg — anyag, részleg, jelenlegi súly és az utoljára hozzáadó dolgozó/dátum/műszak feltüntetésével</li>
        <li>A következő műszakban ugyanahhoz a tételhez hozzáadhatsz további súlyt — a rendszer ekkor a meglévő, megkezdett zsákot folytatja ahelyett, hogy újat nyitna; minden hozzáadás bekerül az <strong>előzmények</strong> listájába (ki, mikor, mennyit adott hozzá)</li>
        <li><strong>✓ Befejezem</strong> — a zsák végső súlyának megadásával lezárod a tételt: ekkor az véglegesen „Teli" zsákká válik, és bekerül a normál termelési összesítésbe</li>
        <li><strong>↩ Visszavon</strong> — az utolsó hozzáadás visszavonható; ha ez az egyetlen bejegyzés volt, a teljes tétel törlődik megerősítés után</li>
      </ul>

      <div class="help-tip"><strong>Auto-save vázlat:</strong> ha félbehagyod és elhagyod az oldalt, az adatok automatikusan mentődnek. Visszatéréskor egy sárga sáv kínálja a visszaállítást (Visszaállítás) vagy elvetést (Elvet).</div>
    `
  },

  /* ── Jelentések ─────────────────────────────────────── */
  {
    id: 'jelentesek', icon: '📋', title: 'Jelentések',
    perm: () => isMainAdmin() || hasPerm('sajatJelentes') || hasPerm('mindenJelentes'),
    content: () => `
      <p>A <strong>Jelentések</strong> lapon napi és időszakos riportok tekinthetők meg.</p>

      <p><strong>📋 Napi riport:</strong></p>
      <ul>
        <li>Válassz dátumot, majd kattints a <strong>Mutat</strong> gombra. A <strong>‹ ›</strong> nyilakkal naponként léphetsz, a <strong>Ma</strong> gombbal az aktuális napra ugraszhatsz</li>
        <li>Szűrhetsz dolgozóra, műszakra (Délelőtt/Délután) és részlegre — szűrő változtatásakor a riport azonnal frissül</li>
        <li>Az összesítő fejlécen látható az aznapi össztermelés, a legjobb teljesítményt nyújtó dolgozó és az aktív dolgozók száma; alatta részlegenkénti és dolgozónkénti bontás, valamint a napi megjegyzések</li>
        <li>A kék dátumokra/hivatkozásokra kattintva (pl. naptárból vagy más riportból) közvetlenül az adott napra ugrik a riport</li>
        <li>Megfelelő jogosultsággal a bejegyzések innen is <strong>szerkeszthetők</strong> (✎) vagy <strong>törölhetők</strong> (✕, kijelölhető több is egyszerre törlésre)</li>
      </ul>

      <p><strong>📊 Időszakos riport:</strong></p>
      <ul>
        <li>Négy mód érhető el a <strong>Jelentés típusa</strong> legördülőben: <strong>Havi</strong> (hónapválasztó), <strong>Heti</strong> (ISO hét-választó), <strong>Éves</strong> (évszám), <strong>Egyéni tartomány</strong> (tól–ig dátum)</li>
        <li>Ugyanazok a szűrők elérhetők, mint a napi nézetnél (Részleg / Dolgozó / Anyagtípus / Műszak); az aktív szűrők chipekként jelennek meg a riport fejlécében</li>
        <li>A <strong>⚙ Szekciók beállítása</strong> gombbal testreszabható, mely blokkok jelenjenek meg a riportban — a beállítás eszközönként mentődik (localStorage):
          <ul>
            <li><em>Fő összesítések</em>: Teljes termelés · Dolgozói rangsor (táblázat) · Anyagtípusok összesítése</li>
            <li><em>Grafikonok &amp; vizuális</em>: 🏆 Időszak rekordjai (legjobb nap/dolgozó/anyag) · 🗓 Naptár nézet (hőtérkép) · Napi termelés vonaldiagram · Dolgozói sávdiagram</li>
            <li><em>Átlagok és statisztikák</em>: Napi átlagteljesítmény · Dolgozónkénti napi átlag · Havi átlagteljesítmény (csak Éves riportnál) · Műszakok összehasonlítása</li>
            <li><em>Részletező táblázatok</em>: Dolgozónkénti részletezés · Anyagonkénti részletezés · Napi bontás</li>
          </ul>
        </li>
        <li>A <strong>🏭 Részleg összesítés</strong> blokk mindig megjelenik (legalább két aktív részleg esetén), és a riport elején automatikusan kiírja a legjobb teljesítményeket is</li>
      </ul>

      <p><strong>📊 Időszak-összehasonlítás:</strong></p>
      <ul>
        <li>A szűrők melletti <strong>„Összevetés az előző időszakkal"</strong> jelölőnégyzet bekapcsolásával a riport tetején egy összehasonlító kártya jelenik meg</li>
        <li>A rendszer automatikusan az aktuálissal azonos hosszúságú, közvetlenül megelőző időszakot veszi alapul: Havinál az előző hónapot, Hetinél az előző hetet, Évesnél az előző évet, Egyéni tartománynál pedig az ugyanannyi napos, közvetlenül megelőző intervallumot</li>
        <li>Mutatja az <strong>összesített termelés</strong> és a <strong>napi átlag</strong> változását (▲ zöld = növekedés, ▼ piros = csökkenés, %-ban kifejezve), valamint a <strong>részlegenkénti</strong> és <strong>anyagtípusonkénti</strong> bontás eltéréseit, jelenlegi/előző érték szerint rendezve</li>
        <li>A beállított szűrők (Részleg/Dolgozó/Anyagtípus/Műszak) mindkét időszak adataira egyformán érvényesülnek, így valódi „alma az almával" összevetést kapsz</li>
      </ul>

      <p><strong>Export lehetőségek:</strong></p>
      <ul>
        <li><strong>⬇ Kép</strong> — JPG formátum, mindig világos színekkel (sötét módban is olvasható)</li>
        <li><strong>⬇ PDF</strong> — nyomtatható, többoldalas ha szükséges</li>
        <li><strong>⬇ Excel</strong> — XLSX fájl; a Dolgozónkénti és Anyagonkénti részletezés esetén minden dolgozó/anyag külön munkalapon</li>
        <li><strong>🖨 Nyomtat</strong> — böngészős nyomtatási párbeszéd, fejléccel és lábléccel</li>
      </ul>
      <div class="help-tip">Az exportgombok csak akkor aktívak, ha már megjelenítettél egy riportot — üres találati listánál (pl. „Nincs adat erre a hónapra") inaktívak maradnak.</div>
    `
  },

  /* ── Naptár ─────────────────────────────────────────── */
  {
    id: 'naptar', icon: '📅', title: 'Naptár',
    perm: () => isMainAdmin() || hasPerm('naptar'),
    content: () => `
      <p>A <strong>Naptár</strong> lapon vizuálisan látható a termelés alakulása.</p>
      <ul>
        <li><strong>📅 Havi nézet</strong> — minden nap egy cella. A szín 5 szintet jelöl: szürke (nincs adat) → kék → türkiz → zöld → narancs (maximális termelés). A legenda a jobb alsó sarokban</li>
        <li><strong>🗓 Éves nézet</strong> — GitHub-stílusú hőtérkép: 52 hét × 7 nap, az egész év egy képernyőn. Hétfő–vasárnapig, hónapfeliratokkal</li>
        <li>Bármelyik cellára kattintva egy <strong>popup</strong> jelenik meg: az adott nap termelése tonnában és az eltérés a havi átlagtól. „Teljes napi riport →" gombbal a Jelentések fülre ugrik</li>
        <li>A <strong>‹ Előző</strong> / <strong>Következő ›</strong> gombokkal léphetsz hónapot vagy évet (nézettől függően)</li>
      </ul>
    `
  },

  /* ── Elemzés ─────────────────────────────────────────── */
  {
    id: 'elemzes', icon: '📈', title: 'Elemzés',
    perm: () => isMainAdmin() || hasPerm('elemzes'),
    content: () => `
      <p>Az <strong>Elemzés</strong> lapon 6 al-fül érhető el, és minden nézethez <strong>időszak szűrő</strong> állítható be a tetején: Minden adat / 30 nap / 90 nap / Ez az év / Egyéni tól–ig.</p>

      <p><strong>👤 Egyéni elemzés:</strong></p>
      <ul>
        <li>Válassz dolgozót és anyagot → Összefoglaló: aktív napok, legjobb/leggyengébb nap, napi átlag, szórás</li>
        <li>Üzemi átlaggal való összehasonlítás (+/-% eltérés)</li>
        <li><strong>📉 Trend vonaldiagram</strong> — SVG grafikon az időbeli változásról (≥2 adatpont esetén)</li>
        <li><strong>🗓️ Naptár nézet</strong> — hőtérkép-szerű naptár, ahol a sötétebb cella nagyobb napi termelést jelent (≥5 aktív nap esetén); hover megmutatja a pontos értéket</li>
        <li><strong>📦 Anyagok szerinti rangsor</strong> — az adott dolgozó összes anyaga átlag/nap szerint sorrendben; a kiválasztott anyag ◀ jelöléssel kiemelve</li>
        <li>Napi bontás táblázat a végén</li>
      </ul>

      <p><strong>🏅 Anyagtípus rangsor:</strong> Egy anyagnál ki termel legtöbbet átlagosan — személyes legjobb és leggyengébb nappal.</p>

      <p><strong>🏆 Személyes rekordok:</strong> Minden dolgozó valaha volt legjobb napja, rangsorolva.</p>

      <p><strong>⚖️ Összehasonlítás:</strong> Két dolgozó egymás mellé helyezve ugyanarra az anyagra — statisztikai tábla (✓ jelöli a győztest) + vizuális sávdiagram.</p>

      <p><strong>🕐 Műszak elemzés:</strong> Dolgozónként Délelőtt vs. Délután átlagos napi termelés, ✓ jelöli a jobb műszakot. Üzemi összesítő: melyik műszak termel többet és mennyivel.</p>

      <p><strong>🏭 Részleg összesítő:</strong> Részlegenként össztermelés sávdiagrammal (🥇🥈🥉 érmek a top 3-nak), napi átlag és legjobb nap feltüntetésével. Alatta részletes összehasonlító táblázat: össztermelés · aktív napok · napi átlag · legjobb nap.</p>
    `
  },

  /* ── Feladatok ──────────────────────────────────────── */
  {
    id: 'feladatok', icon: '📌', title: 'Feladatok',
    perm: () => isMainAdmin() || hasPerm('feladatokKezeles'),
    content: () => `
      <p>A <strong>Feladatok</strong> lapon csapat-szintű teendőket kezelhetsz.</p>
      <ul>
        <li><strong>☰ Lista nézet / ⬛ Kanban nézet</strong> — a szűrők mellett váltható. Lista: időrendi, szűrhető állapot és részleg szerint. Kanban: 3 oszlop (Nyitott → Folyamatban → Kész), a <strong>→</strong> gombbal léptethetők</li>
        <li><strong>Állapotok</strong>: Nyitott · Folyamatban · Kész — a → gomb lépteti, vagy a draweren belül is változtatható</li>
        <li><strong>Felelős hozzárendelése</strong> — a feladat hozzárendelhető bármely felhasználóhoz; a felelős is lezárhatja saját feladatát</li>
        <li>Kártyára kattintva megnyílik a <strong>szerkesztő drawer</strong>: szerkeszthető a cím, leírás, prioritás, határidő, felelős és állapot egyszerre</li>
        <li><strong>Új feladat</strong> — a „Új feladat ›" fejlécre kattintva kinyílik a form, mentés vagy mégse után automatikusan becsukódik</li>
      </ul>
      <div class="help-tip">Mobilon a ✏️ FAB gomb (jobb alul) a Feladatok lapon az Új feladat formt nyitja meg közvetlenül.</div>
    `
  },

  /* ── Dolgozók ───────────────────────────────────────── */
  {
    id: 'dolgozok', icon: '👷', title: 'Dolgozók',
    perm: () => isMainAdmin() || hasPerm('dolgozokMegtekintes') || hasPerm('dolgozokKezeles'),
    content: () => `
      <p>A <strong>Dolgozók</strong> lapon 5 al-fül érhető el.</p>

      <p><strong>👤 Adatlapok:</strong></p>
      <ul>
        <li><strong>⊞ Kártya / ☰ Lista nézet</strong> váltható a szűrők mellett. Lista nézet sok dolgozónál kompaktabb</li>
        <li>Keresés: névben, részlegben, pozícióban és kompetenciákban is keres egyszerre</li>
        <li>Rendezés: Névsor / Belépési dátum / Részleg szerint</li>
        <li>Kártyára kattintva részletes <strong>drawer</strong> nyílik:
          <ul>
            <li><strong>Alapadatok</strong> — telefon, e-mail, belépési dátum, születési dátum, szerződéstípus (ha meg van adva)</li>
            <li><strong>Hiányzások</strong> — 🌴 Szabadság felhasznált/keret/maradt · 🤒 Betegszabadság · 📋 Fizetés nélküli · ❓ Egyéb · összes idei hiányzás</li>
            <li><strong>Kompetenciák</strong> chipek formájában</li>
            <li><strong>Megjegyzés</strong> — ha rögzítve van a dolgozóhoz</li>
            <li><strong>📚 Képzési napló</strong> — dátum + képzés neve + megjegyzés listában, időrendben visszafelé. Szerkesztési joggal új bejegyzés adható hozzá (képzés neve + dátum + opcionális megjegyzés), egyenként is törölhető</li>
            <li><strong>📈 Termelési teljesítmény</strong> — az összes rögzített adat alapján: összes kg · aktív napok · rekord/nap · fő anyag · legjobb nap dátuma + 12 havi mini sávdiagram</li>
            <li><strong>📄 PDF adatlap</strong> — teljes tartalmú exportált dokumentum (lásd lent)</li>
          </ul>
        </li>
      </ul>

      <p><strong>📄 PDF adatlap tartalma:</strong></p>
      <ul>
        <li>Alapadatok tábla: részleg, pozíció, belépési dátum, születési dátum, szerződéstípus, telefon, e-mail</li>
        <li>Hiányzások panel: szabadság keret / felhasznált / maradt + betegszabadság, fizetés nélküli, egyéb napok</li>
        <li>Termelési teljesítmény: összes kg, aktív napok, rekord/nap, fő anyag, legjobb nap</li>
        <li>Kompetenciák · Képzési napló (rendezett táblázat) · Megjegyzés</li>
      </ul>

      <p><strong>📅 Hiányzások:</strong> Havi szűrővel listázhatók. Típusok: 🌴 Szabadság · 🤒 Betegszabadság · 📋 Fizetés nélküli · ❓ Egyéb. Csak admin rögzíthet hiányzást.</p>

      <p><strong>🗓 Naptár (roster):</strong> Havi táblázat, ki mikor volt távol. Üres munkanapra kattintva gyors beviteli form jelenik meg alul — nem kell átmenni a Hiányzások fülre.</p>

      <p><strong>⏰ Túlóra:</strong> Havi lista szűrőkkel. Összesítő kártyák mutatják az összes órát és top dolgozókat.</p>

      <p><strong>📊 Statisztika:</strong> Éves összesítő hiányzásból típusonként, részlegenként. Az év kiválasztása után a túlóra összesítő is megjelenik. CSV export.</p>

      ${isMainAdmin() || hasPerm('dolgozokKezeles') ? `
      <p><strong>Dolgozó felvitelekor</strong> megadható: név (kötelező), részleg, pozíció/beosztás, belépési dátum, születési dátum, státusz (Aktív/Inaktív/Szabadságon), szerződés típusa (határozatlan/határozott/megbízási), éves szabadságkeret (alapért.: 20 nap), telefon, e-mail, megjegyzés. A <strong>Kompetenciák</strong> mezőbe gépelj és nyomj Entert — chipként adódnak hozzá, × gombbal törölhetők.</p>
      ` : ''}
    `
  },

  /* ── Túlóra ─────────────────────────────────────────── */
  {
    id: 'tulora', icon: '⏰', title: 'Túlóra nyilvántartás',
    perm: () => isMainAdmin() || hasPerm('dolgozokKezeles'),
    content: () => `
      <p>A <strong>Dolgozók → Túlóra</strong> al-fülön rögzítheted és elemzed a túlóra bejegyzéseket.</p>
      <ul>
        <li>Szűrhetsz hónap és dolgozó szerint, majd kattints a <strong>Mutat</strong> gombra</li>
        <li>Minden bejegyzés: dolgozó neve · dátum · túlóra óraszáma · opcionális megjegyzés</li>
        <li>A lista tetején összesítő kártyák: összes óra + hónapban részt vett dolgozók száma</li>
        <li>A <strong>Statisztika</strong> fülön az éves hiányzás-statisztika után a túlóra éves összesítője is megjelenik dolgozónkénti bontásban</li>
      </ul>
    `
  },

  /* ── Készlet ─────────────────────────────────────────── */
  {
    id: 'keszlet', icon: '📦', title: 'Készlet & Anyagmozgás',
    perm: () => isMainAdmin() || hasPerm('keszletMegtekintes') || hasPerm('keszletKezeles'),
    content: () => `
      <p>A <strong>Készlet</strong> lapon az anyagkészlet és a belső mozgások tarthatók nyilván. A rendszer eseményalapú: minden készletváltozás egy-egy mozgásbejegyzés.</p>

      <p><strong>📊 Aktuális készlet:</strong></p>
      <ul>
        <li>Anyagonként és helyszínenként mutatja: <strong>zsák darabszám</strong> · összsúly (kg/t) · átlag/zsák · 🚛 kamion-szám</li>
        <li>A kamion kapacitás a ⚙️ Helyszínek fülön állítható be (alapértelmezett: 22 zsák)</li>
        <li>Kattintásra ▶ kinyílik a részletező: bevitelezések dátumával és az <strong>egyedi zsák súlyok chipekben</strong></li>
        <li>Szűrhető anyag és helyszín szerint</li>
      </ul>

      <p><strong>↔️ Mozgás:</strong> Az anyag mindig a termelésből kerül a készletbe — külső bevételezésre nincs szükség. Két mozgástípus van:</p>
      <ul>
        <li><strong>⬇️ Termelésből</strong> — a még be nem tárolt, teli zsákos termelési bejegyzések közül választva a kijelölt zsákok betárolódnak egy célhelyszínre</li>
        <li><strong>↔️ Áttárolás</strong> — meglévő készlet átvitele az egyik helyszínről egy másikra (pl. raktárközi mozgatás)</li>
      </ul>
      <p>A kijelölés zsák-csempékkel (chip) történik, melyeken az egyedi súlyok is látszanak; a fenti szűrőkkel (anyag, helyszín) könnyen rá lehet keresni a kívánt tételekre. Kijelölés után a felbukkanó <strong>⚡ panelen</strong> add meg a célhelyszínt (betárolásnál), a dátumot és az opcionális megjegyzést, majd <strong>✓ Rögzít</strong> menti a mozgást — a <strong>Kijelölés törlése</strong> gombbal a kiválasztás visszavonható, a <strong>🗑 Töröl</strong> gombbal pedig egy korábban rögzített mozgás vonható vissza (jogosultságtól függően).</p>

      <p><strong>⚙️ Beállítások</strong> (szerkesztési joggal): <strong>Helyszínek</strong> — raktárak/területek felvétele, szerkesztése és színkóddal való megkülönböztetése. Az archiválás nem töröl — a mozgások hivatkoznak rá.</p>
    `
  },

  /* ── Gépek ──────────────────────────────────────────── */
  {
    id: 'gepek', icon: '🔧', title: 'Gépek',
    perm: () => isMainAdmin() || hasPerm('gepekMegtekintes') || hasPerm('gepekKezeles'),
    content: () => `
      <p>A <strong>Gépek</strong> lapon a darálók, présgépek és egyéb berendezések törzsadatai és üzemeltetési naplója vezethető.</p>
      <ul>
        <li>A gépkártyákon az <strong>állapot</strong> színes jelvénnyel látszik: ✅ Üzemel · 🚨 Leállva · 🔧 Karbantartás alatt. Ha a karbantartás 7 napon belül esedékes (vagy már lejárt), figyelmeztető sáv jelenik meg közvetlenül a kártyán</li>
        <li>Kártyára kattintva nyílik a <strong>részletező drawer</strong>, amely a következő blokkokból áll:
          <ul>
            <li><strong>Alapadatok</strong> — gyártó, gyártási év, karbantartási ciklus (napban), utolsó karbantartás dátuma, megjegyzés</li>
            <li><strong>Következő karbantartás</strong> — a ciklusból automatikusan kiszámolt esedékesség dátuma, a hátralévő napok száma és egy színváltó (zöld → sárga → piros) előrehaladás-sáv, ami vizuálisan mutatja, mennyire közeledik a határidő</li>
            <li><strong>Esemény napló</strong> — időrendben az utolsó 10 bejegyzés: 🔧 Karbantartás · 🚨 Leállás · 🔨 Javítás · ✅ Üzembe helyezés, mindegyik dátummal, opcionális időtartammal (óra) és megjegyzéssel</li>
          </ul>
        </li>
      </ul>

      ${isMainAdmin() || hasPerm('gepekKezeles') ? `
      <p><strong>Szerkesztési jogosultsággal</strong>:</p>
      <ul>
        <li><strong>＋ Új gép</strong> — felvétel: név (kötelező), típus, gyártó, gyártási év, karbantartási ciklus napban, utolsó karbantartás dátuma, kezdeti állapot, megjegyzés</li>
        <li><strong>Esemény rögzítése</strong> — a drawer alján típus, dátum, opcionális időtartam és megjegyzés megadásával új eseményt vehetsz fel; ezek alkotják a gép üzemeltetési előzményét</li>
        <li><strong>✎ Szerkeszt</strong> / <strong>🗑 Töröl</strong> — a gép adatai módosíthatók, a törlés (megerősítés után) véglegesen eltávolítja a berendezést és előzményeit</li>
        <li>Az esemény napló egyes elemei is törölhetők egyenként a ✕ gombbal</li>
      </ul>
      ` : ''}

      <div class="help-tip">A karbantartási ciklus és az utolsó karbantartás dátuma alapján a rendszer automatikusan kiszámolja a következő esedékességet — ezt érdemes mindig naprakészen tartani, hogy a figyelmeztetések pontosak legyenek.</div>
    `
  },

  /* ── Prémium ─────────────────────────────────────────── */
  {
    id: 'premium', icon: '💰', title: 'Prémium számítás',
    perm: () => isMainAdmin() || hasPerm('premiumMegtekintes') || hasPerm('premiumKezeles'),
    content: () => `
      <p>A <strong>Prémium</strong> lapon két al-fül érhető el.</p>

      <p><strong>📊 Számítás:</strong></p>
      <ul>
        <li>Válassz hónapot (és opcionálisan részleget), majd kattints a <strong>Számol</strong> gombra</li>
        <li>A számítás <strong>naponként értékeli</strong> az alapteljesítményt — csak azok a napok számítanak prémiumba, ahol az adott anyagból elérte a napi alapot</li>
        <li>Dolgozóra kattintva kinyílik a részletes anyagonkénti bontás: napi alap, prémium napok száma, túlteljesítés, kiszámolt prémium összeg</li>
        <li>A <strong>💾 Mentés</strong> gombbal az aktuális eredmény az Előzmények fülre kerül</li>
      </ul>

      <p><strong>📋 Előzmények:</strong></p>
      <ul>
        <li>Listázza az összes mentett hónap prémium összesítőjét: hónap neve · összesített prémium · mentő neve · dátum · dolgozók száma</li>
        <li><strong>Betölt</strong> gomb: visszatölti az adott hónap eredményét a Számítás nézetre</li>
        <li><strong>✕</strong> gomb: törli a mentett előzményt</li>
      </ul>

      ${isMainAdmin() || hasPerm('premiumKezeles') ? `
      <div class="help-tip">Admin → Prémium konfig fülön anyagonként beállítható az alap (kg/nap), a prémium aránya (%) és az eladási ár (Ft/kg). Csak konfigurált anyagok kapnak prémiumot.</div>
      ` : ''}
    `
  },

  /* ── Közlemény ──────────────────────────────────────── */
  {
    id: 'kozlemeny', icon: '📢', title: 'Közlemények',
    perm: () => isMainAdmin() || hasPerm('kozlemenyIras'),
    content: () => `
      <p>Az <strong>Admin → Közlemény</strong> fülön közzétehetsz üzeneteket, amelyek az Áttekintés oldalon jelennek meg kártyaként.</p>
      <ul>
        <li><strong>7 típus</strong>: ℹ️ Tájékoztatás · ⚠️ Figyelmeztetés · ✅ Jó hír · 🔴 Sürgős · 📅 Esemény · 🔧 Karbantartás · 🎉 Hír — minden típus más színű bal oldali sávval jelenik meg</li>
        <li><strong>Láthatóság</strong>: Mindenki / Csak adminok / Adott részleg (részleg lista alapján)</li>
        <li><strong>Lejárat</strong>: opcionálisan megadható dátum — a lejárt közlemények automatikusan eltűnnek a felhasználóknál</li>
        <li>A felhasználók az <strong>✕ gombbal</strong> bezárhatják az üzenetet; a bezárás eszközönként mentődik (localStorage + Firestore)</li>
        <li>Az admin látja hányan olvasták el (<strong>👁 N elolvasva</strong>) és mikor járt le</li>
        <li>Törlés: a lista jobb szélén lévő ✕ gombbal törölhető bármely közlemény</li>
      </ul>
    `
  },

  /* ── Admin ──────────────────────────────────────────── */
  {
    id: 'admin', icon: '⚙️', title: 'Admin funkciók',
    perm: () => isMainAdmin() || hasPerm('felhasznalokKezelese') || hasPerm('kozlemenyIras'),
    content: () => `
      <p>Az <strong>Admin</strong> lapon az alábbi funkciók érhetők el (jogosultságtól függően):</p>

      ${isMainAdmin() ? `
      <p><strong>👥 Felhasználók:</strong></p>
      <ul>
        <li>Listázza az összes regisztrált fiókot: név · e-mail · szerepkör · <strong>utolsó belépés időpontja</strong></li>
        <li>Szerepkör hozzárendelése a legördülőből (nem főadmin fiókoknál)</li>
        <li><strong>⏸ Letiltás</strong> — a felhasználó fiókja deaktiválható törlés nélkül. A letiltott felhasználó belépési kísérletnél „Fiók letiltva" üzenetet kap. Visszakapcsolható ▶ Aktivál gombbal</li>
        <li>Törlés — véglegesen törli a felhasználó dokumentumát (Firebase Auth fiókot nem törli)</li>
      </ul>

      <p><strong>🎭 Szerepkörök:</strong></p>
      <ul>
        <li>13 jogosultság 4 kategóriában: Termelés / Szervezet / Pénzügyi / Adminisztráció</li>
        <li>Minden jogosultság mellett leírás segíti a döntést</li>
        <li>4 gyors sablon: 👷 Dolgozó · 👨‍💼 Csoportvezető · 📋 HR · 📊 Könyvelő</li>
        <li>A szerepkör kártyákon color-coded badge-ek mutatják a jogosultságokat</li>
      </ul>
      ` : ''}

      ${isMainAdmin() || hasPerm('felhasznalokKezelese') ? `
      <p><strong>📋 Listák:</strong> Névlista, anyaglista, részleglista szerkesztése. Dupla kattintás = helyszíni szerkesztés. Ctrl+klik = több kijelölés, majd törlés.</p>
      ` : ''}

      ${isMainAdmin() || hasPerm('kozlemenyIras') ? `
      <p><strong>📢 Közlemény:</strong> Lásd a Közlemények szekciót.</p>
      ` : ''}

      ${isMainAdmin() ? `
      <p><strong>📋 Audit log:</strong></p>
      <ul>
        <li>A rendszerben végrehajtott műveletek naplója (utolsó 500 esemény)</li>
        <li><strong>Szűrők</strong>: típus (10 kategória: bejegyzés, dolgozó, feladat, közlemény, bejelentkezés, szerepkör, prémium, felhasználó, hiányzás, túlóra) · felhasználó · dátum tól–ig</li>
        <li>Logolt események: bejegyzés/nap törlése, dolgozó CRUD, feladat CRUD, közlemény CRUD, bejelentkezés, szerepkör változás, prémium konfig mentés, felhasználó letiltás/aktiválás</li>
      </ul>

      <p><strong>🔑 Belépési napló:</strong> Minden sikeres Google-bejelentkezés időpontja, e-mail címe és neve — időrendben visszafelé.</p>

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
    const body   = E('helpBody-' + hdr.dataset.helpId);
    const isOpen = hdr.classList.contains('open');
    hdr.classList.toggle('open', !isOpen);
    body.style.display = isOpen ? 'none' : 'block';
  });
}
