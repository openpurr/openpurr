// Polish copy of the migration page. Follows en.ts; see the notes there.
import type { MigrateDict } from "./en";

export const migratePl: MigrateDict = {
  meta: {
    title: "Migracja z RevenueCat do openpurr krok po kroku",
    description:
      "Przenieś aplikację z RevenueCat do openpurr, otwartoźródłowej alternatywy dla RevenueCat: zachowaj Purchases SDK, zaimportuj subskrybentów i ich dostęp.",
    ogImageAlt:
      "Przejście z RevenueCat do openpurr bez utraty subskrybentów: zostajesz przy Purchases SDK, importujesz wszystkich klientów, a stare wersje aplikacji dalej działają.",
  },
  hero: {
    crumb: "Migracja z RevenueCat",
    eyebrow: "Przewodnik migracji",
    headline: "Przejdź z RevenueCat do openpurr bez utraty żadnego subskrybenta",
    lede: "Zostajesz przy Purchases SDK, którego twoja aplikacja już używa. Importujesz obecnych klientów z eksportu RevenueCat, a openpurr sam pobiera każdy zakup z Apple i Google. Stare wersje aplikacji działają dalej, dopóki ludzie ich nie zaktualizują.",
    guide: "Przeczytaj przewodnik krok po kroku (po angielsku)",
    steps: "Zobacz kroki",
    updated: "Zaktualizowano {date}",
  },
  summary: {
    title: "W skrócie",
    items: [
      "openpurr to otwartoźródłowa alternatywa dla RevenueCat, hostowana samodzielnie. Działa z oficjalnym, niezmodyfikowanym RevenueCat Purchases SDK.",
      "Twoja aplikacja dostaje jedną linijkę (URL proxy w SDK) i jednorazowe wywołanie <code>syncPurchases</code>. Reszta kodu zakupów zostaje bez zmian.",
      "<code>openpurr import</code> przenosi obecnych klientów z eksportu RevenueCat. Same zakupy są pobierane z Apple i Google, a nie kopiowane.",
      "Aplikacje z App Store mogą użyć Scheduled Data Export z RevenueCat. Dla Google Play potrzebny jest eksport migracyjny od RevenueCat Support, jedyny, który zawiera tokeny zakupów.",
      "Oba backendy pozostają aktualne, dopóki większość ludzi nie zaktualizuje aplikacji, więc nikt nie traci dostępu.",
      "W darmowym planie Cloudflare import obsługuje około 2500 klientów dziennie. W planie Workers Paid duży import trwa kilka godzin.",
    ],
  },
  how: {
    eyebrow: "Jak to działa",
    title: "Jak przebiega migracja z RevenueCat",
    lede: "openpurr nie kopiuje historii zakupów z RevenueCat. Musi tylko wiedzieć, kto jest właścicielem którego zakupu, a potem pyta sklepy, dokładnie tak jak wtedy, gdy twoja aplikacja wysyła zakup.",
    ways: [
      {
        title: "Import",
        body: "Eksport RevenueCat mówi, który użytkownik aplikacji jest właścicielem którego zakupu w sklepie. <code>openpurr import</code> pyta Apple i Google o każdy zakup i zapisuje odpowiedź sklepu dla tego użytkownika. Przenosi wszystkich naraz, także tych, którzy już nigdy nie otworzą aplikacji.",
      },
      {
        title: "Aktualizacja aplikacji",
        body: "Nowa wersja kieruje Purchases SDK do openpurr i jednorazowo wysyła zakupy każdego klienta przez <code>syncPurchases</code>. To wyłapuje każdego, kogo pominął eksport, i każdego, kto kupił coś po jego utworzeniu.",
      },
      {
        title: "Przez jakiś czas oba backendy",
        body: "Stare wersje aplikacji rozmawiają z RevenueCat, dopóki ludzie ich nie zaktualizują. RevenueCat przekazuje powiadomienia Apple do openpurr, a druga subskrypcja Pub/Sub robi to samo dla Google, więc oba backendy pozostają aktualne.",
      },
    ],
  },
  app: {
    eyebrow: "W twojej aplikacji",
    title: "Co się zmienia w twojej aplikacji",
    lede: "Ustaw URL proxy przed configure i jednorazowo wyślij zakupy każdego klienta. Te same dwie zmiany działają na Androidzie, we Flutterze i w React Native; przewodnik zawiera kod dla każdej platformy.",
    codeLabel: "Przykład w Swift: URL proxy i jednorazowa synchronizacja",
    proxyComment: "Przed configure(): jedyna linijka, którą dodaje większość aplikacji",
    syncComment: "Raz na instalację: wyślij zakupy tego klienta do openpurr",
  },
  import: {
    eyebrow: "Import",
    title: "Import klientów z RevenueCat",
    lede: "CLI openpurr czyta kolumny RevenueCat bez przeróbek: identyfikatory użytkowników aplikacji, identyfikatory transakcji App Store, tokeny zakupów Google Play i atrybuty, takie jak <code>$email</code>.",
    codeLabel: "Terminal: import eksportu RevenueCat",
    dryRunComment: "Sprawdź pierwsze wiersze: pyta Apple i Google, nic nie zapisuje",
    importComment: "Zaimportuj wszystkich. Przerwij kiedy chcesz; uruchom ponownie, by kontynuować.",
    safeguards: [
      ["Nikt nie traci dostępu", "Zakup, który aplikacja już wysłała dla klienta, zostaje przy nim; import nigdy go nie przenosi."],
      ["Bez zdublowanych webhooków", "Zaimportowane zakupy nie są nowe, więc openpurr nie wysyła dla nich żadnych zdarzeń."],
      ["Rzetelne wykresy", "Zaimportowani klienci są datowani od pierwszego zakupu, a nie liczeni jako nowi w dniu importu."],
      ["Twoja aplikacja działa dalej", "W darmowym planie Cloudflare import zatrzymuje się przy 90% dziennego limitu i kontynuuje następnego dnia."],
      ["Przerwij i wznów", "Postęp jest zapisywany. Dwukrotny import tego samego wiersza niczego nie zmienia, więc nowszy eksport można uruchomić ponownie."],
      ["Najpierw przetestuj", "Przebieg próbny (dry run) pyta sklepy i pokazuje, co by się stało, niczego nie zapisując."],
    ] as [string, string][],
  },
  steps: {
    eyebrow: "Krok po kroku",
    title: "Jak przeprowadzić migrację z RevenueCat w siedmiu krokach",
    lede: "Oba backendy działają, dopóki nie będziesz gotowy na przełączenie, więc klienci ze starszymi wersjami aplikacji zachowują dostęp.",
    items: [
      {
        title: "Skonfiguruj openpurr",
        body: "Wdróż openpurr Lite na swoim koncie Cloudflare, daj mu dostęp do API App Store i Google Play i odtwórz swoje produkty, entitlementy i oferty z tymi samymi identyfikatorami. Możesz nawet zachować publiczne klucze SDK z RevenueCat.",
      },
      {
        title: "Informuj oba backendy",
        body: "Ustaw openpurr jako Apple Server Notification Forwarding URL w RevenueCat i dodaj subskrypcję push openpurr do swojego tematu powiadomień Play.",
      },
      {
        title: "Zdobądź eksport",
        body: "Tylko App Store: Scheduled Data Export z RevenueCat zawiera wszystko, co potrzebne. Przy Google Play poproś RevenueCat Support o eksport migracyjny, bo tylko on zawiera tokeny zakupów. Przewodnik zawiera prośbę, którą możesz skopiować.",
      },
      { title: "Importuj", body: "Uruchom <code>openpurr import</code>, najpierw jako przebieg próbny. Problemy z pojedynczymi wierszami trafiają do raportu i nie zatrzymują importu." },
      { title: "Wydaj aktualizację aplikacji", body: "Dodaj URL proxy i jednorazowe <code>syncPurchases</code>. Wydaj ją, gdy import się zakończy." },
      {
        title: "Sprawdź",
        body: "<code>openpurr doctor</code> sprawdza konfigurację. Wyszukaj klientów, których znasz, i porównaj aktywne subskrypcje z wykresami RevenueCat.",
      },
      {
        title: "Dokończ przełączenie",
        body: "Gdy większość klientów zaktualizuje aplikację, skieruj Apple i Google bezpośrednio do openpurr, włącz webhooki openpurr i wyłącz te z RevenueCat.",
      },
    ],
    source: "Źródło:",
    sourceNotifications: "RevenueCat: powiadomienia serwerowe Apple (po angielsku)",
    sourceExports: "RevenueCat: eksport danych lub migracja (po angielsku)",
    more: "Wszystkie polecenia i ustawienia znajdziesz w pełnym przewodniku (po angielsku) →",
  },
  moves: {
    eyebrow: "Co się przenosi",
    title: "Co przenosi się z RevenueCat, a co nie",
    rows: [
      ["Subskrypcje i zakupy, z odnowieniami, zwrotami, okresami karencji i wygaśnięciami", "Tak, pobierane z Apple i Google"],
      ["Kto jest właścicielem którego zakupu", "Tak, z eksportu RevenueCat"],
      ["Identyfikatory użytkowników aplikacji, także anonimowe", "Tak, bez zmian"],
      ["Atrybuty klientów ($email, $displayName i twoje własne)", "Tak, z Audience export"],
      ["Produkty, entitlementy i oferty", "Odtwarzasz je, z tymi samymi identyfikatorami"],
      ["Historia wykresów sprzed przełączenia", "Częściowo: zachowaj pliki CSV z wykresami RevenueCat do swojej dokumentacji"],
      ["Paywalle, eksperymenty, integracje, Customer Center", "Nie: openpurr ich nie ma"],
    ] as [string, string][],
  },
  faq: {
    eyebrow: "FAQ",
    title: "Migracja z RevenueCat: najczęstsze pytania",
    items: [
      {
        q: "Czy muszę zmienić kod zakupów?",
        a: "Nie. openpurr działa z oficjalnym, niezmodyfikowanym RevenueCat Purchases SDK. Aktualizacja aplikacji dodaje URL proxy przed configure i jednorazowe wywołanie syncPurchases. getOfferings, purchase, restorePurchases, logIn i cała reszta zostają bez zmian.",
      },
      {
        q: "Czy do migracji potrzebuję pomocy RevenueCat?",
        a: "W przypadku aplikacji z App Store nie, bo Scheduled Data Export z RevenueCat zawiera identyfikatory transakcji, których potrzebuje openpurr. W przypadku Google Play tak, bo według dokumentacji RevenueCat tylko eksport migracyjny przygotowany przez RevenueCat Support zawiera tokeny zakupów wymagane przez Google.",
      },
      {
        q: "Co z klientami, którzy nigdy nie zaktualizują aplikacji?",
        a: "Obejmuje ich import: ich zakupy są pobierane z Apple i Google i przypisywane do tych samych identyfikatorów użytkowników aplikacji. Dopóki korzystają ze starej wersji aplikacji, ta wersja rozmawia z RevenueCat, i dlatego oba backendy pozostają aktualne, dopóki większość ludzi nie zaktualizuje aplikacji.",
      },
      {
        q: "Ile trwa import?",
        a: "Każdy klient to około 30 zapisów wierszy w bazie danych. W darmowym planie Cloudflare daje to około 2500 klientów dziennie, a import sam wstrzymuje się przy dziennym limicie i wznawia następnego dnia. W planie Workers Paid (5 USD miesięcznie) duży import trwa kilka godzin.",
      },
      {
        q: "Czy moje dane są kopiowane z RevenueCat?",
        a: "Tylko przypisanie użytkowników aplikacji do zakupów w sklepach, oraz atrybuty, jeśli je importujesz. Same zakupy pochodzą bezpośrednio z Apple i Google, więc openpurr zapisuje aktualny stan ze sklepów, łącznie z odnowieniami i zwrotami.",
      },
    ],
  },
  cta: {
    title: "Gotowy na przejście?",
    body: "Przewodnik prowadzi przez każdy krok. Jeśli coś w twojej konfiguracji nie pasuje, zgłoś issue: migracje wpływają na to, co powstanie w następnej kolejności.",
    guide: "Przeczytaj przewodnik (po angielsku)",
    github: "openpurr na GitHubie",
    issue: "Zgłoś issue",
  },
};
