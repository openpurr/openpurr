// The "Add in-app purchases" page in this language (see en.ts for the notes).
import type { StartDict } from "./en";

export const startPl: StartDict = {
  meta: {
    title: "Zakupy w aplikacji i subskrypcje za darmo - openpurr",
    description:
      "Zaczynasz nową aplikację? Dodaj zakupy w aplikacji i subskrypcje z oficjalnym Purchases SDK i otwartoźródłowym backendem, który utrzymujesz sam. Bez prowizji.",
    ogImageAlt: "Zaczynasz nową aplikację? Zacznij bez prowizji od przychodów. Zatrzymaj swój 1% i zainwestuj go w swój biznes.",
  },
  hero: {
    crumb: "Dodaj zakupy w aplikacji",
    eyebrow: "Dla nowych aplikacji",
    headline: "Zaczynasz nową aplikację?",
    headlineAccent: "Zacznij bez prowizji od przychodów.",
    /** {threshold} is "$2,500". */
    lede: "Większość backendów zakupów zabiera 1% twoich przychodów, gdy tylko przekroczysz {threshold} miesięcznie, a rachunek rośnie razem z tobą. Najłatwiej tego uniknąć przed pierwszą sprzedażą. openpurr to darmowy, otwartoźródłowy backend do zakupów w aplikacji i subskrypcji, który utrzymujesz sam, z tym samym oficjalnym SDK, którego używają duże platformy.",
    ctaStart: "Zacznij na GitHubie",
    ctaHow: "Jak to działa",
    ctaAi: "Skopiuj prompt dla asystenta AI",
  },
  growth: {
    title: "Twój 1%, od pierwszego dnia",
    text: "Wybierz, gdzie widzisz swoją aplikację za trzy lata. Tyle po drodze uzbierałaby prowizja w wysokości 1%, przy równym wzroście od zera.",
    target: "Przychód miesięczny za trzy lata",
    /** Labels for the totals. */
    fee: "1% prowizji przez 3 lata",
    servers: "Własne serwery przez 3 lata",
    after: "A potem co roku",
    /** The chart's accessible description. */
    chartLabel: "Prowizja od przychodów rosnąca miesiąc po miesiącu przez trzy lata",
    /** HTML. {fee} and {servers} are amounts that move with the slider. */
    summary: "To <b>{fee}</b>, które oddałbyś przed czwartym rokiem, wobec <b>{servers}</b> za własne serwery. Zatrzymaj je i zainwestuj w biznes.",
  },
  invest: {
    title: "Zainwestuj go w swój biznes i w siebie",
    text: "Co kupisz za rok swojego 1%, gdy go zatrzymasz:",
  },
  how: {
    title: "Jak to działa",
    lede: "Cztery kroki, a kod, który piszesz, jest taki sam jak w każdym tutorialu RevenueCat.",
    steps: [
      {
        title: "Wdróż openpurr",
        /** HTML. */
        text: "Uruchom instalację na swoim koncie Cloudflare. Dla małych aplikacji Lite mieści się w <b>darmowym planie</b>, a instalację można bezpiecznie uruchomić ponownie, jeśli przerwie się w połowie.",
      },
      {
        title: "Dodaj aplikację i produkty",
        text: "Dashboard zaczyna od dodania pierwszej aplikacji: jej bundle ID i nazwy pakietu, a potem produktów, entitlementów i offeringów.",
      },
      {
        title: "Dodaj Purchases SDK",
        /** HTML. */
        text: "Zainstaluj oficjalne RevenueCat Purchases SDK, otwartoźródłowe na licencji MIT, i przed konfiguracją ustaw <b>jeden URL proxy</b>.",
      },
      {
        title: "Wydaj aplikację",
        text: "Zakupy są weryfikowane w Apple i Google, odnowienia i zwroty przychodzą w powiadomieniach ze sklepów, a twój backend dostaje webhooki. Używasz Claude Code? Plugin openpurr przeprowadzi cię przez konfigurację App Store Connect i Play Console.",
      },
    ],
    /** Above the setup commands. */
    setupLabel: "Instalacja, na twoim komputerze",
  },
  ai: {
    title: "Skonfiguruj to z asystentem AI do kodowania",
    text: "Otwórz projekt aplikacji w Claude Code, Codex, Cursor, Grok lub innym agencie do kodowania i wklej ten prompt. Wdroży openpurr, podłączy sklepy i doda SDK, pytając cię przed każdym krokiem, który wymaga twojego logowania.",
    copy: "Kopiuj prompt",
    copied: "Skopiowano",
    claudeTip: "Używasz Claude Code? Najpierw dodaj wtyczkę openpurr, która poprowadzi cię krok po kroku:",
  },
  includes: {
    title: "Co dostajesz",
    yes: [
      "Zakupy i subskrypcje w App Store i Google Play",
      "Entitlementy i offeringi",
      "Webhooki do twojego backendu, podpisane i ponawiane",
      "16 wykresów: przychód, MRR, churn, okresy próbne i więcej",
      "Eksperymenty cenowe",
      "Twoje dane we własnej bazie danych",
    ],
    notYetTitle: "Jeszcze nie",
    notYet: "Kreatory paywalli, integracje z zewnętrzną analityką, zdarzenia reklamowe, płatności webowe i Amazon. Jeśli potrzebujesz ich od pierwszego dnia, platformy komercyjne oferują je już dziś.",
  },
  lockin: {
    title: "Bez uzależnienia, w żadną stronę",
    text: "Ponieważ openpurr korzysta ze standardowego Purchases SDK, twój kod zakupów działa z oboma backendami. Jeśli wyrośniesz z openpurr albo zechcesz tego, co dodają platformy komercyjne, przejście to zmiana konfiguracji i import klientów, a nie przepisywanie kodu.",
  },
  pricingLink: {
    text: "Ciekawi cię, na co idzie 1%, kiedy już go płacisz?",
    link: "Zobacz cennik RevenueCat w rozbiciu →",
  },
  faq: {
    title: "Częste pytania",
    /** Each answer is also the page's FAQ structured data. */
    items: {
      backend: {
        q: "Czy do zakupów w aplikacji potrzebuję backendu?",
        a: "Nie jest to konieczne: StoreKit i Google Play Billing działają na urządzeniu. Ale backend pilnuje, żeby subskrypcje się zgadzały. Weryfikuje zakupy w Apple i Google, śledzi odnowienia, anulowania i zwroty przez powiadomienia ze sklepów oraz mówi twojej aplikacji i serwerowi, kto ma dostęp. openpurr jest takim backendem, a utrzymujesz go sam.",
      },
      cheapest: {
        q: "Jaki jest najtańszy sposób na dodanie subskrypcji do aplikacji na iOS lub Androida?",
        /** {servers} a yearly amount, {m25k} "$25,000". */
        a: "Utrzymuj backend sam. Dla małych aplikacji openpurr Lite mieści się w darmowym planie Cloudflare i działa z darmowym, otwartoźródłowym Purchases SDK, więc płacisz tylko za serwery: według naszego modelu około {servers} rocznie dla aplikacji zarabiającej {m25k} miesięcznie, bez prowizji od przychodów.",
      },
      free: {
        q: "Czy openpurr jest naprawdę darmowy?",
        a: "Tak. Jest otwartoźródłowy, na licencji Apache 2.0, bez prowizji od przychodów i bez opłat za transakcję. Płacisz za własne serwery, a małe aplikacje mieszczą się w darmowym planie Cloudflare.",
      },
      switch: {
        q: "Czy mogę później przejść na RevenueCat?",
        a: "Tak. openpurr korzysta z oficjalnego RevenueCat Purchases SDK, więc kod zakupów w twojej aplikacji działa z oboma backendami, a produkty w sklepach pozostają bez zmian. Przejście to zmiana konfiguracji plus przeniesienie danych klientów.",
      },
      missing: {
        q: "Czego openpurr jeszcze nie robi?",
        a: "Kreatory paywalli, integracje z zewnętrzną analityką, zdarzenia reklamowe, płatności webowe i Amazon. Eksperymenty cenowe są wbudowane. Jeśli resztę potrzebujesz od pierwszego dnia, platforma komercyjna oferuje ją już dziś.",
      },
    },
  },
};
