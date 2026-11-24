// Polish copy. Follows en.ts; see the notes there. Uses informal "ty", as is usual for developer tools; "webhooki", "entitlementy", "paywalle" stay English-derived, declined as Polish devs do.
import type { Dict } from "./en";

export const pl: Dict = {
  meta: {
    title: "openpurr: alternatywa dla RevenueCat, open source i self-hosted",
    description:
      "openpurr to alternatywa dla RevenueCat: open source, na twoim serwerze. Zachowaj swoje Purchases SDK, zmień jeden URL i nie płać prowizji od przychodów.",
    ogImageAlt: "openpurr: alternatywa dla RevenueCat, open source i na własnym serwerze, obok panelu z wykresami subskrypcji",
  },
  header: {
    home: "Strona główna openpurr",
    nav: { features: "Funkcje", editions: "Edycje", roadmap: "Roadmapa", faq: "FAQ", migrate: "Migracja" },
    language: "Język",
  },
  footer: {
    tagline: "Otwartoźródłowa infrastruktura zakupów w aplikacji, którą utrzymujesz sam.",
    roadmap: "Roadmapa",
    contributing: "Współtworzenie",
    sponsor: "Wesprzyj",
    contact: "Kontakt",
    privacy: "Prywatność (po angielsku)",
    disclaimer:
      "openpurr to niezależny projekt. Nie jest powiązany z RevenueCat, Inc. ani przez nią wspierany. App Store jest znakiem towarowym Apple Inc. Google Play jest znakiem towarowym Google LLC.",
    copyright: "Copyright {year} współtwórcy openpurr.",
    cookieSettings: "Ustawienia cookies",
  },
  consent: {
    label: "Zgoda na cookies",
    text: "Chcielibyśmy używać plików cookie Google Analytics, żeby liczyć odwiedziny i sprawdzać, które strony są pomocne. Nic nie zostanie zapisane bez twojej zgody, a decyzję możesz w każdej chwili zmienić w Ustawieniach cookies.",
    privacy: "Prywatność (po angielsku)",
    decline: "Odrzuć",
    accept: "Akceptuj",
  },
  snippet: {
    tabs: "Platforma SDK",
    note: "Jedna linijka. To samo SDK, ten sam kod zakupów.",
  },
  home: {
    hero: {
      /** HTML */
      title: '<span class="accent">Alternatywa dla RevenueCat</span>: open source i <span class="nowrap">na własnym serwerze</span>',
      lede: "Miej kontrolę nad własną infrastrukturą zakupów, nie oddawaj części przychodów i nie uzależniaj się od żadnej komercyjnej usługi. Zostajesz przy Purchases SDK, którego już używasz: zmieniasz jeden URL, a nie kod zakupów.",
      star: "Daj gwiazdkę na GitHubie",
      how: "Jak to działa",
      runsOn: "Działa na",
      shotAlt:
        "Panel openpurr Lite z 12 miesiącami zmian MRR, aktywnymi subskrypcjami, churnem, nowymi klientami, nowymi i aktywnymi okresami próbnymi",
    },
    why: {
      eyebrow: "Dla kogo",
      title: "Dla twórców aplikacji, którzy wolą utrzymywać to sami",
      lede: "openpurr działa z oficjalnymi, niezmodyfikowanymi SDK. Przejście zaczyna się od zmiany jednego URL-a, a nie od przepisywania kodu zakupów.",
      reasons: [
        {
          title: "Twoje dane, twoje serwery",
          body: "Historia zakupów, entitlementy i dane dostępowe do sklepów trafiają do bazy, którą sam utrzymujesz, odpytujesz, backupujesz i eksportujesz. Między twoją aplikacją a klientami nie stoi żadna zewnętrzna usługa.",
        },
        {
          title: "Bez prowizji od przychodów",
          body: "Żadnego procentu od przychodów ani opłat za transakcję. Edycja Lite została zaprojektowana tak, by mieścić się w darmowym planie Cloudflare, więc mała aplikacja może z niej korzystać za darmo.",
        },
        {
          title: "Bez uzależnienia od dostawcy",
          body: "To open source na licencji Apache 2.0. Czytaj kod, zmieniaj go i przenoś między Cloudflare a własną chmurą.",
        },
      ],
    },
    how: {
      eyebrow: "Jak to działa",
      title: "Twój serwer zajmuje miejsce dostawcy",
      lede: "Twoja aplikacja zostaje przy otwartoźródłowym Purchases SDK, z którym już jest wydawana. SDK rozmawia z openpurr. openpurr rozmawia ze sklepami, przechowuje stan subskrypcji i informuje twój backend o zmianach.",
      flowLabel: "Przepływ żądań",
      app: "Twoja aplikacja",
      sdkLicense: "Oficjalne, niezmodyfikowane, na licencji MIT",
      sdkPlatforms: "iOS, Android, Flutter lub React Native",
      coreWhere: "Na Cloudflare Workers lub we własnej chmurze",
      appStoreApi: "Server API i powiadomienia",
      playApi: "Developer API i RTDN",
      backend: "Twój backend",
      backendHooks: "Podpisane webhooki",
      steps: [
        {
          title: "Wdróż",
          /** HTML */
          body: "Uruchom openpurr Lite na własnym koncie Cloudflare. Konfigurator <code>pnpm run setup</code> przeprowadzi cię przez proces: utworzy bazę danych, wdroży oba Workers i założy twoje konto właściciela.",
        },
        {
          title: "Skieruj SDK",
          /** HTML */
          body: "Ustaw URL proxy przed wywołaniem <code>configure</code>. Użyj własnej domeny, żeby móc się później przenieść.",
        },
        {
          title: "Podłącz sklepy",
          /** HTML */
          body: "Dodaj dane dostępowe do sklepów i adresy URL powiadomień. Test konfiguracji, <code>openpurr doctor</code>, sprawdza je i podpowiada, jak uzupełnić to, czego brakuje.",
        },
      ],
    },
    features: {
      eyebrow: "Co potrafi",
      title: "Backend subskrypcji bez dodatków, których nie używasz",
      items: [
        {
          title: "Zakupy i powiadomienia ze sklepów",
          body: "Weryfikuje transakcje StoreKit 2 i zakupy w Google Play, zwraca CustomerInfo i entitlementy, których oczekuje SDK, a dzięki powiadomieniom z App Store i Google Play odnowienia, zwroty i okresy karencji są zawsze aktualne.",
        },
        {
          title: "Webhooki",
          body: "Wysyła do twojego backendu zdarzenia w formacie RevenueCat, podpisane HMAC-SHA256 i ponawiane przez około 72 godziny.",
        },
        {
          title: "Wykresy",
          body: "16 wykresów: przychody, MRR i ARR, zmiany MRR i subskrypcji, aktywne i płatne subskrypcje, status subskrypcji, churn, okresy próbne i ich konwersja, nowi klienci, zwroty i wskaźnik zwrotów oraz zakupy jednorazowe. Filtrowanie według aplikacji, sklepu, produktu i środowiska, z przychodami przeliczonymi na USD.",
        },
        {
          title: "Eksperymenty cenowe",
          body: "Pokazuj nowym klientom aplikacji różne oferty i porównuj konwersję oraz przychód na klienta, wraz z szansą, że dany wariant wypadnie lepiej niż kontrolny. Bez aktualizacji aplikacji.",
        },
        {
          title: "Uwierzytelnianie i audyt",
          body: "Klucze SDK i klucze tajne, logowanie operatorów z opcjonalnymi kodami z aplikacji uwierzytelniającej, role, tokeny dostępu i dziennik audytu.",
        },
        {
          title: "Serwer MCP i skille Claude",
          body: "Zapytaj asystenta AI, dlaczego klient ma lub nie ma danego entitlementu, wyszukaj zakupy albo daj się przeprowadzić przez konfigurację w App Store Connect i Play Console.",
        },
      ],
    },
    editions: {
      eyebrow: "Dwie edycje",
      title: "Zacznij od małego, przejdź wyżej bez aktualizacji aplikacji",
      lede: "Obie edycje przechodzą ten sam zestaw testów zgodności. Jeśli twoja aplikacja łączy się z własną domeną, przejście z Lite na Standard nie wymaga nowego wydania aplikacji.",
      lite: {
        badge: "Dla aplikacji indie",
        price: "0 USD",
        priceNote: "w darmowym planie Cloudflare",
        items: ["TypeScript na Cloudflare Workers i D1", "Lekka i tania w utrzymaniu", "Alerty, zanim dojdziesz do limitów darmowego planu"],
      },
      standard: {
        badge: "Wkrótce",
        price: "Twój rachunek za chmurę",
        priceNote: "nic więcej",
        items: ["Go i Postgres w kontenerach", "GCP lub AWS", "Dla większych portfeli aplikacji"],
      },
    },
    savings: {
      eyebrow: "Koszty",
      title: "Ile zatrzymujesz w porównaniu z RevenueCat",
      lede: "Plan Pro w RevenueCat jest darmowy poniżej 2500 USD śledzonych przychodów miesięcznie, a potem kosztuje 1% całości. Lite działa w darmowym planie Cloudflare, a gdy aplikacja z niego wyrośnie, w planie Workers Paid od 5 USD miesięcznie.",
      revenue: "Przychód miesięczny",
      rc: "RevenueCat",
      op: "openpurr Lite",
      saved: "Oszczędność rocznie",
      perMonth: "{amount} miesięcznie",
      free: "Darmowy plan Cloudflare",
      paid: "Cloudflare Workers Paid",
      chartLabel: "Koszt miesięczny w zależności od przychodu miesięcznego: w RevenueCat rośnie razem z przychodem, w openpurr Lite pozostaje bliski zera",
      gapLegend: "Ile zatrzymujesz",
      tableSummary: "Porównaj przy innych przychodach",
      colRevenue: "Przychód miesięczny",
      colRc: "RevenueCat, miesięcznie",
      colOp: "openpurr Lite, miesięcznie",
      colSaved: "Oszczędność rocznie",
      methodSummary: "Jak to liczymy",
      pricingLink: "Na co idzie 1% RevenueCat? →",
      method: [
        "RevenueCat: cena katalogowa planu Pro, 1% śledzonych przychodów miesięcznych od 2500 USD. Śledzone przychody liczą plany roczne i zakupy jednorazowe w miesiącu płatności, więc mogą być wyższe niż MRR. Duzi klienci mogą negocjować ceny Enterprise.",
        "openpurr Lite: ceny Cloudflare za Workers i D1. Zakładamy około 1,50 USD przychodu miesięcznego i około 10 zapytań SDK dziennie na dziennie aktywnego użytkownika. Przy takich założeniach 100 000 zapytań dziennie w darmowym planie wystarcza do około {paidFrom} przychodu miesięcznego, z zapasem. Powyżej liczymy Workers Paid: 5 USD miesięcznie plus 0,30 USD za każdy milion zapytań ponad 10 milionów.",
        "Nie uwzględniono: Twojego czasu na utrzymanie. Prowizje sklepów są takie same w obu przypadkach.",
        "Ceny sprawdzone {date}. openpurr nie jest powiązany z RevenueCat.",
      ],
    },
    fit: {
      eyebrow: "Uczciwie",
      title: "Może jeszcze nie być dla ciebie",
      lede: "Jeśli potrzebujesz kreatora paywalli, integracji z zewnętrzną analityką albo umowy wsparcia, komercyjne platformy oferują to już dziś.",
      outTitle: "Na razie poza zakresem",
      tags: ["Paywalle", "Zdarzenia reklamowe", "Customer Center", "Waluty wirtualne", "Płatności webowe", "Amazon", "Integracje analityczne"],
    },
    roadmap: {
      eyebrow: "Roadmapa",
      title: "Dokąd zmierzamy",
      lede: "Kolejność jest ustalona, ale terminów nie ma. Jeśli coś jest dla ciebie ważne, napisz o tym w issue.",
      status: { done: "Gotowe", wip: "W toku", planned: "Zaplanowane", later: "Twój wybór" },
      phases: [
        {
          phase: "Lite",
          items: [
            "Najnowsze wydanie: {version}",
            "Zaprojektowana pod darmowy plan Cloudflare",
            "App Store i Google Play",
            "Webhooki, panel i administracja",
            "Wiele aplikacji w jednym wdrożeniu",
            "Eksperymenty cenowe",
            "Serwer MCP, CLI i skille Claude",
            "Dalej: testy na urządzeniach, potem 1.0",
          ],
        },
        {
          phase: "Standard",
          items: ["Go i Postgres w kontenerach", "Najpierw GCP, potem AWS", "Ten sam zestaw testów zgodności co Lite", "Przejście z Lite bez aktualizacji aplikacji"],
        },
        {
          phase: "Kształtowane przez społeczność",
          items: ["Zweryfikowana tożsamość użytkowników końcowych", "Dodatki do Standard dla większych zespołów", "Aplikacja mobilna z wykresami i alertem, gdy zakupy ustają", "Te same alerty w Slacku, Discordzie i Telegramie", "Wszystko, o co poprosisz w issues"],
        },
      ],
      more: "Przeczytaj pełną roadmapę (po angielsku) →",
    },
    cta: {
      title: "Pomóż go kształtować",
      body: "Najbardziej przyda się teraz feedback: błędne założenia dotyczące SDK lub sklepów oraz prawdziwe przypadki brzegowe przy odnowieniach, zwrotach i okresach karencji.",
      star: "Daj gwiazdkę na GitHubie",
      issue: "Zgłoś issue",
      coffee: "Postaw nam kawę",
    },
  },
  faq: {
    eyebrow: "FAQ",
    title: "openpurr jako alternatywa dla RevenueCat",
    lede: "Co się zmienia, gdy utrzymujesz własny backend subskrypcji, a co zostaje bez zmian.",
    items: [
      {
        q: "Czym jest openpurr?",
        a: "openpurr to otwartoźródłowa alternatywa dla RevenueCat, którą hostujesz samodzielnie. To backend do zakupów w aplikacji i subskrypcji, który działa z oficjalnym RevenueCat Purchases SDK. Weryfikuje zakupy z App Store i Google Play, śledzi entitlementy, odbiera powiadomienia ze sklepów, wysyła webhooki do twojego backendu i pokazuje na wykresach najważniejsze wskaźniki subskrypcji, a wszystko to na infrastrukturze, którą kontrolujesz.",
      },
      {
        q: "Czym openpurr różni się od RevenueCat?",
        a: "RevenueCat to hostowana usługa komercyjna, która powyżej darmowego progu pobiera część przychodów. openpurr to oprogramowanie, które uruchamiasz sam: historia zakupów, entitlementy i dane dostępowe do sklepów są w twojej własnej bazie danych, a nie ma żadnej prowizji od przychodów ani opłat za transakcję. RevenueCat oferuje dziś więcej funkcji, takich jak paywalle i integracje analityczne. openpurr skupia się na podstawowym backendzie subskrypcji.",
      },
      {
        q: "Czy przy przejściu z RevenueCat muszę przepisać kod zakupów?",
        a: "Nie. openpurr działa z oficjalnym, niezmodyfikowanym Purchases SDK. Przed wywołaniem configure ustawiasz w SDK URL proxy na swój serwer openpurr, a reszta kodu zakupów zostaje bez zmian. Użyj własnej domeny, żeby później móc zmienić serwer bez aktualizacji aplikacji.",
      },
      {
        q: "Jak przenieść moich obecnych klientów z RevenueCat?",
        a: "Zaimportuj ich. Poproś RevenueCat o eksport migracyjny, a polecenie openpurr import pobierze zakupy każdego klienta z Apple i Google i przypisze je do tych samych identyfikatorów użytkowników aplikacji. Nowa wersja twojej aplikacji także jednorazowo wysyła zakupy każdego klienta, a oba backendy pozostają aktualne, dopóki ludzie aktualizują aplikację, więc nikt nie traci dostępu.",
        link: "Jak przeprowadzić migrację",
      },
      {
        q: "Czy mogę przejść z Adapty?",
        a: "Tak, przez aktualizację aplikacji. SDK Adapty nie da się skierować na inny serwer, więc aktualizacja zastępuje je Purchases SDK, z którym działa openpurr. Twoje produkty w sklepach pozostają bez zmian. openpurr importuje twoich klientów z App Store z eksportu zdarzeń Adapty, nowa wersja twojej aplikacji przenosi wszystkich pozostałych przy pierwszym uruchomieniu, a oba backendy pozostają aktualne, dopóki ludzie aktualizują aplikację.",
        link: "Przeczytaj przewodnik po migracji z Adapty",
        linkTo: "adapty",
      },
      {
        q: "Jakie platformy i sklepy obsługuje openpurr?",
        a: "openpurr obsługuje Purchases SDK dla iOS, Androida, Fluttera i React Native, z zakupami z App Store i Google Play. Amazon i płatności webowe są na razie poza zakresem.",
      },
      {
        q: "Ile kosztuje openpurr?",
        a: "openpurr jest darmowy i otwartoźródłowy, na licencji Apache 2.0. Płacisz tylko za infrastrukturę, na której działa. Edycja Lite została zaprojektowana do działania w darmowym planie Cloudflare, więc mała aplikacja może z niej korzystać za darmo. Edycja Standard działa w kontenerach we własnej chmurze, więc jej koszt to twój rachunek za chmurę.",
      },
      {
        q: "Gdzie są przechowywane moje dane?",
        a: "W twojej własnej bazie danych. Edycja Lite używa Cloudflare D1 na twoim koncie Cloudflare. Edycja Standard używa Postgresa na GCP lub AWS. Możesz te dane odpytywać, backupować i eksportować, a między twoją aplikacją a klientami nie stoi żadna zewnętrzna usługa.",
      },
      {
        q: "Czy openpurr wysyła webhooki tak jak RevenueCat?",
        a: "Tak. openpurr wysyła do twojego backendu zdarzenia w formacie RevenueCat, podpisane HMAC-SHA256 i ponawiane przez około 72 godziny, więc istniejące handlery webhooków wymagają niewielu zmian albo żadnych.",
      },
      {
        q: "Czego openpurr nie robi, a RevenueCat tak?",
        a: "Paywalle, integracje z zewnętrzną analityką, Customer Center, waluty wirtualne, płatności webowe, Amazon, zdarzenia reklamowe i komercyjna umowa wsparcia są na razie poza zakresem. Eksperymenty cenowe są wbudowane. Jeśli potrzebujesz pozostałych funkcji już dziś, lepiej sprawdzi się komercyjna platforma.",
      },
      {
        q: "Czy openpurr jest gotowy do użycia na produkcji?",
        a: "Jeszcze nie. openpurr jest na wczesnym etapie: edycja Lite jest w toku, a edycja Standard pojawi się później. Śledź roadmapę na GitHubie i zgłoś issue, jeśli coś jest dla ciebie ważne.",
      },
      {
        q: "Czy openpurr jest powiązany z RevenueCat?",
        a: "Nie. openpurr to niezależny projekt open source, który nie jest powiązany z RevenueCat, Inc. ani przez nią wspierany. Działa z oficjalnym Purchases SDK od RevenueCat, udostępnianym na licencji MIT.",
      },
    ],
  },
  structured: {
    description:
      "Otwartoźródłowa alternatywa dla RevenueCat, hostowana samodzielnie: backend do zakupów w aplikacji i subskrypcji z App Store i Google Play, który działa z oficjalnym, niezmodyfikowanym Purchases SDK. Weryfikuje zakupy, śledzi entitlementy, odbiera powiadomienia ze sklepów, wysyła webhooki i pokazuje wskaźniki subskrypcji na wykresach.",
    subCategory: "Backend do zakupów w aplikacji i subskrypcji",
    features: [
      "Działa z oficjalnym RevenueCat Purchases SDK dla iOS, Androida, Fluttera i React Native",
      "Weryfikacja zakupów StoreKit 2 i Google Play",
      "App Store Server Notifications V2 i Google Play Real-time Developer Notifications",
      "Webhooki w formacie RevenueCat podpisane HMAC-SHA256",
      "16 wykresów subskrypcji, w tym MRR, churn i konwersja okresów próbnych",
      "Eksperymenty cenowe na ofertach, z wynikami dla każdego wariantu",
      "Serwer MCP, CLI i skille Claude",
    ],
  },
};
