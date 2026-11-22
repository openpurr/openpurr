// Dutch copy of the migration page. Follows en.ts; see the notes there.
import type { MigrateDict } from "./en";

export const migrateNl: MigrateDict = {
  meta: {
    title: "Migreren van RevenueCat naar openpurr: stap voor stap",
    description:
      "Stap over van RevenueCat naar openpurr, het open-source alternatief voor RevenueCat: behoud de Purchases SDK, importeer elke abonnee en behoud hun toegang.",
    ogImageAlt:
      "Stap over van RevenueCat naar openpurr zonder één abonnee te verliezen: behoud de Purchases SDK, importeer elke klant en oude appversies blijven werken.",
  },
  hero: {
    crumb: "Overstappen van RevenueCat",
    eyebrow: "Migratiegids",
    headline: "Stap over van RevenueCat naar openpurr zonder één abonnee te verliezen",
    lede: "Behoud de Purchases SDK die je app al gebruikt. Importeer je bestaande klanten uit de export van RevenueCat: openpurr haalt elke aankoop zelf op bij Apple en Google. Oude appversies blijven werken terwijl mensen updaten.",
    guide: "Lees de stapsgewijze handleiding (Engels)",
    steps: "Bekijk de stappen",
    updated: "Bijgewerkt op {date}",
  },
  summary: {
    title: "In het kort",
    items: [
      "openpurr is een self-hosted, open-source alternatief voor RevenueCat. Het werkt met de officiële, ongewijzigde RevenueCat Purchases SDK.",
      "Je app krijgt één extra regel (de proxy-URL van de SDK) en een eenmalige aanroep van <code>syncPurchases</code>. De rest van je aankoopcode blijft hetzelfde.",
      "<code>openpurr import</code> haalt bestaande klanten over uit de export van RevenueCat. De aankopen zelf worden opgehaald bij Apple en Google, niet gekopieerd.",
      "Apps in de App Store kunnen de Scheduled Data Export van RevenueCat gebruiken. Voor Google Play heb je een migratie-export van RevenueCat Support nodig, de enige met aankooptokens.",
      "Beide backends blijven bijgewerkt tot de meeste mensen de app hebben geüpdatet, zodat niemand zijn toegang verliest.",
      "Op het gratis abonnement van Cloudflare verwerkt de import ongeveer 2.500 klanten per dag. Met Workers Paid duurt een grote import een paar uur.",
    ],
  },
  how: {
    eyebrow: "Zo werkt het",
    title: "Zo werkt een migratie van RevenueCat",
    lede: "openpurr kopieert geen aankoopgegevens uit RevenueCat. Het hoeft alleen te weten wie welke aankoop bezit en vraagt het daarna aan de stores, precies zoals wanneer je app een aankoop doorstuurt.",
    ways: [
      {
        title: "De import",
        body: "De export van RevenueCat vermeldt welke app-user welke store-aankoop bezit. <code>openpurr import</code> vraagt Apple en Google naar elke aankoop en legt het antwoord van de store vast voor die user. Zo komt iedereen in één keer over, ook mensen die de app nooit meer openen.",
      },
      {
        title: "De app-update",
        body: "De nieuwe versie richt de Purchases SDK op openpurr en stuurt de aankopen van elke klant één keer door met <code>syncPurchases</code>. Zo vang je iedereen op die in de export ontbrak, en iedereen die daarna nog iets kocht.",
      },
      {
        title: "Een tijdje beide backends",
        body: "Oude appversies blijven met RevenueCat praten tot mensen updaten. RevenueCat stuurt de meldingen van Apple door naar openpurr, en een tweede Pub/Sub-subscription doet hetzelfde voor Google, zodat beide actueel blijven.",
      },
    ],
  },
  app: {
    eyebrow: "In je app",
    title: "Wat er verandert in je app",
    lede: "Stel de proxy-URL in vóór configure en stuur de aankopen van elke klant één keer door. Dezelfde twee wijzigingen werken op Android, Flutter en React Native; de handleiding bevat de code voor elk platform.",
    codeLabel: "Swift-voorbeeld: de proxy-URL en een eenmalige synchronisatie",
    proxyComment: "Vóór configure(): de enige regel die de meeste apps toevoegen",
    syncComment: "Eén keer per installatie: aankopen van deze klant naar openpurr sturen",
  },
  import: {
    eyebrow: "De import",
    title: "Klanten importeren uit RevenueCat",
    lede: "De openpurr CLI leest de kolommen van RevenueCat zoals ze zijn: app-user-ID's, transactie-ID's uit de App Store, aankooptokens van Google Play en attributen zoals <code>$email</code>.",
    codeLabel: "Terminal: de export van RevenueCat importeren",
    dryRunComment: "Controleer de eerste rijen: vraagt Apple en Google, schrijft niets",
    importComment: "Importeer iedereen. Stop wanneer je wilt; start opnieuw om verder te gaan.",
    safeguards: [
      ["Niemand verliest toegang", "Een aankoop die de app al voor een klant heeft doorgestuurd, blijft van die klant; de import verplaatst hem nooit."],
      ["Geen dubbele webhooks", "Geïmporteerde aankopen zijn niet nieuw, dus openpurr stuurt er geen events voor."],
      ["Eerlijke grafieken", "Geïmporteerde klanten krijgen de datum van hun eerste aankoop en tellen niet als nieuw op de dag van de import."],
      ["Je app blijft werken", "Op het gratis abonnement van Cloudflare stopt de import bij 90% van een daglimiet en gaat de volgende dag verder."],
      ["Stoppen en hervatten", "De voortgang wordt opgeslagen. Een rij twee keer importeren verandert niets, dus je kunt een nieuwere export opnieuw draaien."],
      ["Probeer het eerst", "Een proefrun vraagt het aan de stores en meldt wat er zou gebeuren, zonder iets te schrijven."],
    ] as [string, string][],
  },
  steps: {
    eyebrow: "Stap voor stap",
    title: "Overstappen van RevenueCat in zeven stappen",
    lede: "Beide backends blijven draaien tot je klaar bent om over te schakelen, zodat klanten met oudere appversies hun toegang houden.",
    items: [
      {
        title: "openpurr opzetten",
        body: "Rol openpurr Lite uit in je Cloudflare-account, geef het API-toegang tot de App Store en Google Play, en maak je producten, entitlements en offerings opnieuw aan met dezelfde identifiers. Je kunt zelfs je openbare SDK-sleutels van RevenueCat houden.",
      },
      {
        title: "Beide backends op de hoogte houden",
        body: "Stel openpurr in RevenueCat in als Apple Server Notification Forwarding URL, en voeg de push-subscription van openpurr toe aan je topic voor Play-meldingen.",
      },
      {
        title: "Je export ophalen",
        body: "Alleen App Store: de Scheduled Data Export van RevenueCat bevat wat nodig is. Gebruik je Google Play, vraag RevenueCat Support dan om een migratie-export, want alleen die bevat aankooptokens. De handleiding bevat een verzoek dat je kunt kopiëren.",
      },
      { title: "Importeren", body: "Voer <code>openpurr import</code> uit, eerst als proefrun. Problemen met afzonderlijke rijen komen in een rapport en houden de import niet tegen." },
      { title: "De app-update uitbrengen", body: "Voeg de proxy-URL en een eenmalige <code>syncPurchases</code> toe. Publiceer de update zodra de import klaar is." },
      {
        title: "Controleren",
        body: "<code>openpurr doctor</code> controleert de setup. Zoek klanten op die je kent en vergelijk de actieve abonnementen met de grafieken van RevenueCat.",
      },
      {
        title: "De overstap afronden",
        body: "Zodra de meeste klanten hebben geüpdatet, richt je Apple en Google rechtstreeks op openpurr, zet je de webhooks van openpurr aan en die van RevenueCat uit.",
      },
    ],
    source: "Bron:",
    sourceNotifications: "RevenueCat: Apple server notifications (Engels)",
    sourceExports: "RevenueCat: data exporteren of overstappen (Engels)",
    more: "Alle commando's en instellingen staan in de volledige handleiding (Engels) →",
  },
  moves: {
    eyebrow: "Wat er meegaat",
    title: "Wat er van RevenueCat meegaat, en wat niet",
    rows: [
      ["Abonnementen en aankopen, met verlengingen, terugbetalingen, respijtperiodes en afloop", "Ja, opgehaald bij Apple en Google"],
      ["Wie welke aankoop bezit", "Ja, uit de export van RevenueCat"],
      ["App-user-ID's, ook anonieme", "Ja, ongewijzigd"],
      ["Klantattributen ($email, $displayName en je eigen attributen)", "Ja, uit een Audience export"],
      ["Producten, entitlements en offerings", "Je maakt ze opnieuw aan, met dezelfde identifiers"],
      ["Grafiekgeschiedenis van vóór de overstap", "Deels: bewaar de grafiek-CSV's van RevenueCat voor je administratie"],
      ["Experimenten", "Je maakt ze opnieuw aan: openpurr voert prijsexperimenten uit op je offerings"],
      ["Paywalls, integraties, Customer Center", "Nee: openpurr heeft ze niet"],
    ] as [string, string][],
  },
  faq: {
    eyebrow: "FAQ",
    title: "FAQ over migreren van RevenueCat",
    items: [
      {
        q: "Moet ik mijn aankoopcode aanpassen?",
        a: "Nee. openpurr werkt met de officiële, ongewijzigde RevenueCat Purchases SDK. De app-update voegt de proxy-URL toe vóór configure, plus een eenmalige aanroep van syncPurchases. getOfferings, purchase, restorePurchases, logIn en de rest blijven zoals ze zijn.",
      },
      {
        q: "Heb ik de hulp van RevenueCat nodig om over te stappen?",
        a: "Voor apps in de App Store niet: de Scheduled Data Export van RevenueCat bevat de transactie-ID's die openpurr nodig heeft. Voor Google Play wel: volgens de documentatie van RevenueCat bevat alleen een migratie-export die RevenueCat Support voorbereidt de aankooptokens die Google vereist.",
      },
      {
        q: "Hoe zit het met klanten die de app nooit updaten?",
        a: "De import dekt hen: hun aankopen worden opgehaald bij Apple en Google en gekoppeld aan dezelfde app-user-ID's. Zolang ze nog een oude appversie gebruiken, praat die versie met RevenueCat. Daarom blijven beide backends op de hoogte tot de meeste mensen hebben geüpdatet.",
      },
      {
        q: "Hoe lang duurt een import?",
        a: "Elke klant kost ongeveer 30 schrijfacties naar databaserijen. Op het gratis abonnement van Cloudflare zijn dat ongeveer 2.500 klanten per dag, en de import pauzeert zichzelf bij de daglimiet en gaat de volgende dag verder. Met Workers Paid ($ 5 per maand) duurt een grote import een paar uur.",
      },
      {
        q: "Worden mijn gegevens gekopieerd uit RevenueCat?",
        a: "Alleen de koppeling tussen app-users en store-aankopen, plus attributen als je die importeert. De aankopen zelf komen rechtstreeks van Apple en Google, dus openpurr legt de actuele stand van de stores vast, inclusief verlengingen en terugbetalingen.",
      },
    ],
  },
  cta: {
    title: "Klaar om over te stappen?",
    body: "De handleiding loopt elke stap met je door. Past iets in je setup niet, open dan een issue: migraties bepalen mee wat er hierna wordt gebouwd.",
    guide: "Lees de handleiding (Engels)",
    github: "openpurr op GitHub",
    issue: "Open een issue",
  },
};
