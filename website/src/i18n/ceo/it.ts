// The "RevenueCat's CEO on X" page in this language (see en.ts for the notes).
import type { CeoDict } from "./en";

export const ceoIt: CeoDict = {
  meta: {
    title: "Il CEO di RevenueCat posta su X {perDay} volte al giorno - openpurr",
    description:
      "In 90 giorni il CEO di RevenueCat ha postato {posts} volte su X, in {hours} ore diverse al giorno. Circa il {pct} parla di RevenueCat. Il tuo 1% finanzia la sua azienda.",
    ogImageAlt: "Il CEO di RevenueCat posta su X circa 10 volte al giorno, ogni giorno. Il tuo 1% finanzia l'azienda che guida.",
  },
  hero: {
    crumb: "Il CEO su X",
    eyebrow: "Dove finisce il tuo 1%",
    headline: "Il CEO di RevenueCat posta su X {perDay} volte al giorno.",
    headlineAccent: "Il tuo 1% finanzia l'azienda che guida.",
    lede: "Negli ultimi {days} giorni il CEO di RevenueCat, Jacob Eiting ({handle}), ha postato {posts} volte su X. Sono circa {perDay} post al giorno, distribuiti su {hours} ore diverse al giorno, in {active} giorni su {days}.",
    updated: "Aggiornato il {date} - Conteggio dai post pubblici",
  },
  stats: {
    posts: "post in {days} giorni",
    perDay: "post al giorno",
    hours: "ore attive al giorno",
    active: "giorni con almeno un post, su {days}",
  },
  calendar: {
    title: "{days} giorni di post",
    note: "Ogni quadrato è un giorno. Più è scuro, più ore di quel giorno hanno avuto un post.",
    less: "Nessun post",
    more: "Più ore",
    cell: "{date}: {posts} post in {hours} ore",
  },
  topic: {
    title: "Quanto parla di RevenueCat?",
    text: "Secondo le regole qui sotto, il <b>{pct}</b> dei suoi post menziona RevenueCat o il suo business: {onTopic} su {posts}. Sui post dell'account {base} le stesse regole trovano il {basePct}, quindi qualcosa sfugge. Anche così, la maggior parte di ciò che posta parla d'altro.",
    ceo: "I suoi post",
    base: "I post di {base}",
    about: "Su RevenueCat",
  },
  pays: {
    title: "Cosa paga il tuo 1%",
    text: "RevenueCat si prende l'1% di tutti i tuoi ricavi appena superi {threshold} al mese. Con quei soldi va avanti l'azienda, dai server ai vertici.",
    link: "Guarda dove finisce il resto del tuo 1% →",
    ctaKeep: "Tieniti il tuo 1% →",
    ctaGithub: "openpurr su GitHub",
  },
  method: {
    title: "Come abbiamo contato",
    posts: "<b>Post:</b> tutti i post e le risposte pubblici di {handle} dal {start} al {end}, letti dall'API di X il {checked}. I repost non sono contati, e i post cancellati non si possono contare.",
    hours: "<b>Ore attive:</b> ore dell'orologio con almeno un post. Post alle 9:05, 9:40 e 14:10 fanno 2 ore attive. Conta le ore con un post, non il tempo speso. I giorni vanno da mezzanotte a mezzanotte, UTC.",
    rules: "<b>Su RevenueCat:</b> un post che menziona {accounts}, rimanda a {sites} o usa uno di questi termini: {terms}.",
    limits: "<b>Cosa non dice:</b> postare può far parte del lavoro di un CEO, e questi numeri non mostrano quando lavora. Mostrano quanto spesso posta, e di cosa.",
    data: "<b>Dati:</b> teniamo solo i conteggi, nessun testo dei post. Lo script che li ha contati è {script}.",
    scriptLink: "nel nostro repository",
    affiliation: "<b>Nessuna affiliazione:</b> openpurr non è affiliato a RevenueCat.",
  },
};
