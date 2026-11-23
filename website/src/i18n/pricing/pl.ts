// The RevenueCat pricing page in this language (see en.ts for the notes).
import type { PricingDict } from "./en";

export const pricingPl: PricingDict = {
  meta: {
    title: "Cennik RevenueCat: na co naprawdę idzie twój 1% · openpurr",
    description:
      "RevenueCat pobiera 1% twoich przychodów. Serwery twojej aplikacji kosztują grosze. Zobacz, za co płaci reszta: pensje, sprzedaż i fundusze VC.",
    ogImageAlt: "RevenueCat zabiera 1% twoich przychodów; serwery kosztują grosze. Za co płaci reszta.",
  },
  hero: {
    crumb: "Cennik RevenueCat",
    eyebrow: "Na co idzie twój 1%",
    headline: "Nie płacisz za serwery.",
    /** The headline's second, highlighted sentence. {valuation} is "$500 million". */
    headlineAccent: "Płacisz za firmę wartą {valuation}.",
    /** {threshold} is "$2,500". */
    lede: "RevenueCat zabiera 1% wszystkich twoich śledzonych przychodów, gdy tylko przekroczysz {threshold} miesięcznie, a rachunek rośnie razem z tobą. Serwery twojej aplikacji kosztują grosze. Reszta utrzymuje firmę: jej pensje, dział sprzedaży i zysk inwestorów.",
    updated: "Zaktualizowano {date} · Szacunki na podstawie publicznych danych",
  },
  answer: {
    title: "Cennik RevenueCat w jednym zdaniu",
    /** HTML. {threshold} is "$2,500". */
    text: "Za darmo poniżej {threshold} śledzonych przychodów miesięcznie, potem <strong>1% od całości</strong>. Ile to wynosi rocznie, obok kosztu serwerów dla tej samej aplikacji:",
    colRevenue: "Przychód miesięczny",
    colFee: "RevenueCat rocznie",
    colServers: "Serwery rocznie",
  },
  calc: {
    revenue: "Miesięczny przychód twojej aplikacji",
    fee: "RevenueCat zabiera",
    servers: "Serwery naprawdę kosztują",
    perYear: "rocznie",
    stackLabel: "Twoja roczna opłata w podziale na serwery i zespoły RevenueCat",
    /** HTML. {servers} and {rest} are percentages. */
    stackNote: "Serwery: {servers}. Cała reszta, {rest}, idzie na ich zespoły:",
    /** {people} is a number, {salary} is like "$210K". */
    teamMeta: "Około {people} osób · typowa pensja {salary}",
    ownersTitle: "A ponad połowa z tego buduje cudzy exit",
    /** {pct} is like "55%". */
    ownersInvestors: "Inwestorzy VC · około {pct}",
    ownersRest: "Założyciele i pracownicy",
    ownersBarLabel: "Inwestorzy VC mają około {pct} RevenueCat, według naszych szacunków",
    /** HTML. {funding} is "$100 million"; {vc} is an amount that moves with the slider. */
    ownersText:
      "Inwestorzy VC włożyli w RevenueCat około {funding} w pięciu rundach i według podawanych wycen mają ponad połowę firmy. Nie potrzebują działki od każdej płatności. Każda opłata, którą płacisz, podnosi wartość firmy, do której należą, a pieniądze zgarniają przy sprzedaży. W przeliczeniu na udziały około {vc} z tego, co płacisz co roku, buduje ich zysk.",
    investorsLabel: "Inwestorzy RevenueCat",
    /** HTML. {days} is a number, {infra} an amount; both move with the slider. */
    punch: "Twój 1% kupuje w RevenueCat około {days} dni pracy inżyniera rocznie. Ta sama robota na własnej infrastrukturze kosztuje {infra}.",
    /** HTML. {keep} is an amount that moves with the slider. */
    keep: "Zatrzymaj pozostałe {keep}.",
    ctaKeep: "Zatrzymaj swój 1% →",
    ctaGithub: "openpurr na GitHubie",
  },
  teams: {
    eng: { name: "Inżynieria", basis: "Oferta pracy: senior SDK engineer, 212 tys. USD" },
    product: { name: "Produkt, design i dane", basis: "Oferty pracy: senior product manager, 230 tys. USD; senior data scientist, 220 tys. USD" },
    sales: { name: "Sprzedaż", basis: "Oferta pracy: Head of Sales, 363 tys. USD; senior sales engineer, 200 tys. USD; product expert, 133 tys. USD" },
    growth: { name: "Marketing i wzrost", basis: "Oferta pracy: Head of Customer Growth, 259 tys. USD; projektant CRO, 205 tys. USD; product marketing, 168 tys. USD" },
    support: { name: "Customer success i wsparcie", basis: "Oferta pracy: developer support engineer, 118 tys. USD" },
    community: { name: "Developer relations i społeczność", basis: "Ogólna mediana z ofert, około 215 tys. USD, obniżona ze względu na różne poziomy stanowisk" },
    ops: { name: "Operacje, finanse i HR", basis: "Oferta pracy: specjalista ds. sprzedaży i operacji, 167 tys. USD; Head of People, 280 tys. USD" },
    exec: { name: "Zarząd", basis: "Dla części powyżej oferty na Head of Sales (363 tys. USD), dla pozostałych poniżej" },
  },
  faq: {
    title: "Częste pytania",
    /** Each answer is also the page's FAQ structured data. Amounts are filled in by the page. */
    items: {
      cost: {
        q: "Ile kosztuje RevenueCat?",
        /** {threshold} "$2,500"; {at10k} the yearly fee at $10,000 a month, {at100k} at $100,000 a month; {m10k} "$10,000", {m100k} "$100,000". */
        a: "Plan Pro w RevenueCat jest darmowy poniżej {threshold} śledzonych przychodów miesięcznie. Od tego progu kosztuje 1% całości, a nie tylko nadwyżki ponad {threshold}: {at10k} rocznie dla aplikacji zarabiającej {m10k} miesięcznie, {at100k} rocznie przy {m100k} miesięcznie. Duzi klienci mogą negocjować ceny Enterprise.",
      },
      pays: {
        q: "Za co płacisz w 1% prowizji RevenueCat?",
        /** {servers} and {fee} are yearly amounts for an app making {m25k} ("$25,000") a month; {people} is a number. */
        a: "Głównie za firmę. Serwery typowej aplikacji kosztują kilka dolarów miesięcznie: {servers} rocznie dla aplikacji zarabiającej {m25k} miesięcznie, wobec {fee} opłat. Reszta utrzymuje zespół około {people} osób, w tym inżynierię, sprzedaż, marketing i zarząd, i buduje wartość dla inwestorów firmy.",
      },
      owns: {
        q: "Do kogo należy RevenueCat?",
        /** {funding} "$100 million"; {investors} the list of firms, already joined; {pct} like "55%". */
        a: "RevenueCat pozyskał od inwestorów venture capital około {funding} w pięciu rundach, m.in. od {investors}. Po złożeniu podawanych wycen kolejnych rund inwestorzy mają szacunkowo {pct} firmy. Reszta należy do założycieli i pracowników.",
      },
      worth: {
        q: "Ile jest wart RevenueCat?",
        /** {valuation} "$500 million", {round} "$50 million", {revenue} "$30 million". */
        a: "Według doniesień RevenueCat był wyceniany na {valuation}, gdy w 2025 roku pozyskał {round} w rundzie Series C, przy rocznych przychodach rzędu {revenue}. To dane z prasy i od analityków, a nie informacje ujawnione przez firmę.",
      },
      alternative: {
        q: "Czy istnieje alternatywa dla RevenueCat bez prowizji od przychodów?",
        a: "Tak. openpurr to darmowy, otwartoźródłowy backend hostowany samodzielnie, który działa z oficjalnym RevenueCat Purchases SDK. Ustawiasz w SDK URL proxy na własny serwer i zachowujesz swój kod zakupów. Małe aplikacje mogą go uruchomić w darmowym planie Cloudflare, bez prowizji od przychodów i bez opłat za transakcję.",
      },
    },
  },
  more: {
    title: "Tak, robią więcej",
    text: "RevenueCat to więcej niż backend zakupów: paywalle, eksperymenty, integracje, linia wsparcia. Jeśli korzystasz z tego wszystkiego, może ci się to opłacać. Jeśli potrzebujesz tylko walidacji zakupów i aktualnych subskrypcji, oddajesz część wszystkiego, co kiedykolwiek zarobisz, za robotę, która działa na serwerach za kilka dolarów miesięcznie.",
  },
  method: {
    title: "Jak to liczymy",
    /** HTML. Each item starts with a bold label. */
    fee: "<b>Twoja opłata:</b> cena katalogowa planu Pro w RevenueCat, 1% śledzonych przychodów miesięcznych od {threshold}. Duzi klienci mogą negocjować inne ceny.",
    /** HTML. {calculator} becomes a link labelled with `calculatorLink`. */
    servers:
      "<b>Serwery:</b> ile kosztuje openpurr Lite na Cloudflare dla aplikacji z takim przychodem, według tego samego modelu co nasz {calculator}. Koszty hostingu samego RevenueCat nie są publiczne; to tyle, ile kosztuje ta praca, gdy prowadzisz ją sam.",
    calculatorLink: "kalkulator oszczędności",
    /** HTML. {used}, {low}, {high} are headcounts; {loaded} is "1.3". */
    teams:
      "<b>Zespoły:</b> funkcje, nie konkretne osoby. Zakładamy {used} osób (publiczne szacunki wahają się od {low} do {high}) i sami dzielimy je między funkcje. Pensje pochodzą z publicznych ofert pracy RevenueCat, które podają wynagrodzenie; koszt każdego zespołu to osoby × pensja × {loaded} na podatki, benefity i sprzęt, bez udziałów. Część twojej opłaty, która nie idzie na serwery, dzielimy proporcjonalnie do tych kosztów.",
    split:
      "<b>Dlaczego sprzedaż i wzrost przeważają nad inżynierią:</b> według strony z ofertami pracy RevenueCat z dnia {date} liczba otwartych stanowisk wynosiła {open}: {gtm} w sprzedaży, marketingu i wzroście oraz {eng} w kluczowej inżynierii. Firma na tym etapie rozbudowuje go-to-market, a jej nowa oferta na stanowisko Head of Sales jest najlepiej płatną na liście.",
    /** HTML. {funding} "$100 million", {pct} like "55%", {revenue} "$30 million". */
    investors:
      "<b>Inwestorzy:</b> pięć rund w latach 2018–2025, łącznie około {funding}. Struktura udziałów nie jest publiczna, więc składamy ją z podawanych wycen: inwestorzy każdej rundy dostają kwotę podzieloną przez wycenę post-money, a wszyscy wcześniejsi są rozwadniani o ten sam udział. Wychodzi około {pct}. Nie uwzględniamy puli opcji ani udziału akceleratora Y Combinator. Ich udział dotyczy wartości firmy, a nie pozycji w kosztach, dlatego pokazujemy go osobno. Przy rundzie z 2025 roku firma miała według doniesień około {revenue} rocznych przychodów i była blisko progu rentowności.",
    colRound: "Runda",
    colRaised: "Pozyskano",
    colValuation: "Wycena",
    colLead: "Lider rundy",
    notReported: "brak danych",
    /** HTML. */
    affiliation: "<b>Brak powiązań:</b> openpurr nie jest powiązany z RevenueCat. To nasze szacunki, a nie dane RevenueCat.",
    assumptions: "Założenia, zespół po zespole",
    colTeam: "Zespół",
    colPeople: "Osoby",
    colSalary: "Pensja",
    colCost: "Koszt roczny",
    colBasis: "Źródło pensji",
  },
  sources: {
    title: "Źródła",
    /** One label per source, in this order. The links themselves are in English. */
    items: [
      "Cennik RevenueCat: 1% śledzonych przychodów miesięcznych od 2500 USD",
      "Oferty pracy RevenueCat z widełkami płac (Ashby)",
      "Wcześniejsze oferty pracy RevenueCat z wynagrodzeniem (Greenhouse)",
      "TechCrunch: RevenueCat pozyskuje 50 mln USD, łącznie już 100 mln USD (maj 2025)",
      "TechCrunch: runda Series B na 40 mln USD pod wodzą Continuity Fund od Y Combinator, przy wycenie 300 mln USD (2021)",
      "TechCrunch: runda Series C na 12 mln USD pod wodzą Adjacent (2024)",
      "SaaStr: runda seed z 2018 roku przy wycenie 7 mln USD i kolejne rundy",
      "Multiples.vc: około 30 mln USD przychodu i wycena 500 mln USD przy rundzie z 2025 roku (szacunki)",
      "Szacunki zatrudnienia: TipRanks (185)",
      "Szacunki zatrudnienia: TrueUp (130)",
    ],
    /** HTML. {date} is the date; {issue} becomes a link labelled with `issueLink`. */
    checked: "Sprawdzono {date}. Coś jest nieaktualne? {issue}.",
    issueLink: "Zgłoś issue",
  },
};
