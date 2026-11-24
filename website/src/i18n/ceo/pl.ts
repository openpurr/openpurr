// The "RevenueCat's CEO on X" page in this language (see en.ts for the notes).
import type { CeoDict } from "./en";

export const ceoPl: CeoDict = {
  meta: {
    title: "CEO RevenueCat Jacob Eiting publikuje na X {perDay} razy dziennie",
    description:
      "CEO RevenueCat Jacob Eiting w 90 dni opublikował na X postów: {posts}, w {hours} różnych godzinach dziennie. Około {pct} wspomina RevenueCat. Twój 1% pomaga za to płacić.",
    ogImageAlt: "CEO RevenueCat publikuje na X około 10 razy dziennie, codziennie. Twój 1% pomaga za to płacić.",
  },
  hero: {
    crumb: "CEO na X",
    eyebrow: "Na co idzie twój 1%",
    headline: "CEO RevenueCat, Jacob Eiting, publikuje na X {perDay} razy dziennie.",
    headlineAccent: "Twój 1% pomaga za to płacić.",
    lede: "W ciągu ostatnich {days} dni CEO RevenueCat, Jacob Eiting ({handle}), opublikował na X {posts} postów. To około {perDay} postów dziennie, rozłożonych na {hours} różnych godzin dziennie, w {active} z {days} dni.",
    updated: "Zaktualizowano {date} - Policzone z publicznych postów",
  },
  stats: {
    posts: "postów w {days} dni",
    perDay: "postów dziennie",
    hours: "aktywnych godzin dziennie",
    active: "dni z postem, z {days}",
  },
  calendar: {
    title: "{days} dni publikowania",
    note: "Każdy kwadrat to jeden dzień. Im ciemniejszy, tym więcej godzin tego dnia miało post.",
    less: "Brak postów",
    more: "Więcej godzin",
    cell: "{date}: postów: {posts}, godzin: {hours}",
  },
  topic: {
    title: "Ile z tego dotyczy RevenueCat?",
    text: "Według poniższych reguł <b>{pct}</b> jego postów wspomina RevenueCat lub jego biznes: {onTopic} z {posts}. Te same reguły znajdują {basePct} we własnych postach {base}, więc część im umyka. Mimo to większość tego, co publikuje, dotyczy czegoś innego.",
    ceo: "Jego posty",
    base: "Posty {base}",
    about: "O RevenueCat",
  },
  pays: {
    title: "Twój 1% płaci też za jego social media",
    text: "RevenueCat zabiera 1% wszystkich twoich przychodów, gdy tylko przekroczysz {threshold} miesięcznie. Z tych pieniędzy utrzymuje się firma, łącznie z pensją jej CEO. Część twojego 1% płaci więc za jego posty na X: około {perDay} dziennie.",
    link: "Zobacz, na co idzie reszta twojego 1% →",
    ctaKeep: "Zatrzymaj swój 1% →",
    ctaGithub: "openpurr na GitHubie",
  },
  faq: {
    title: "Częste pytania",
    items: {
      who: {
        q: "Kto jest CEO RevenueCat?",
        a: "Jacob Eiting jest współzałożycielem i CEO RevenueCat. Na X publikuje jako {handle}, gdzie liczba jego obserwujących to około {followers}.",
      },
      often: {
        q: "Jak często CEO RevenueCat publikuje na X?",
        a: "W ciągu {days} dni do {end} Jacob Eiting opublikował na X postów: {posts}, licząc odpowiedzi, ale nie reposty. To około {perDay} postów dziennie, rozłożonych na {hours} różnych godzin dziennie, w {active} z {days} dni.",
      },
      about: {
        q: "O czym CEO RevenueCat publikuje na X?",
        a: "Głównie o czymś innym niż RevenueCat. Według naszych reguł słów kluczowych {pct} jego postów wspomina RevenueCat lub jego biznes, wobec {basePct} we własnych postach {base}. Reguły pomijają część postów, więc traktuj {pct} jako dolną granicę.",
      },
      pays: {
        q: "Czy z 1% prowizji RevenueCat opłacany jest jego CEO?",
        a: "Częściowo. RevenueCat zabiera 1% wszystkich twoich przychodów, gdy tylko przekroczysz {threshold} miesięcznie, a z tych pieniędzy utrzymuje się firma, łącznie z wynagrodzeniami jej kierownictwa. RevenueCat nie ujawnia, ile płaci swoim menedżerom najwyższego szczebla.",
      },
    },
  },
  method: {
    title: "Jak liczyliśmy",
    posts: "<b>Posty:</b> wszystkie publiczne posty i odpowiedzi {handle} od {start} do {end}, odczytane z API X {checked}. Reposty nie są liczone, a usuniętych postów nie da się policzyć.",
    hours: "<b>Aktywne godziny:</b> pełne godziny zegarowe z co najmniej jednym postem. Posty o 9:05, 9:40 i 14:10 to 2 aktywne godziny. Liczymy godziny z postem, a nie poświęcony czas. Doba trwa od północy do północy, UTC.",
    rules: "<b>O RevenueCat:</b> post, który wspomina {accounts}, linkuje do {sites} lub używa jednego z tych terminów: {terms}.",
    limits: "<b>Czego to nie mówi:</b> publikowanie może być częścią pracy CEO, a te liczby nie pokazują, kiedy pracuje. Pokazują, jak często publikuje i o czym.",
    data: "<b>Dane:</b> przechowujemy tylko liczby, bez treści postów. Skrypt, który je policzył, jest {script}.",
    scriptLink: "w naszym repozytorium",
    affiliation: "<b>Brak powiązań:</b> openpurr nie jest powiązany z RevenueCat.",
  },
};
