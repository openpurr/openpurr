// The "Add in-app purchases" page in this language (see en.ts for the notes).
import type { StartDict } from "./en";

export const startDe: StartDict = {
  meta: {
    title: "In-App-Käufe und Abos gratis in deine App einbauen - openpurr",
    description:
      "Neue App? Baue In-App-Käufe und Abos mit dem offiziellen Purchases SDK und einem Open-Source-Backend ein, das du selbst betreibst. Nie eine Umsatzbeteiligung.",
    ogImageAlt: "Neue App? Starte ohne Umsatzbeteiligung. Behalte deine 1 % und investiere sie in dein Geschäft.",
  },
  hero: {
    crumb: "In-App-Käufe einbauen",
    eyebrow: "Für neue Apps",
    headline: "Du startest eine neue App?",
    headlineAccent: "Starte ohne Umsatzbeteiligung.",
    lede: "Die meisten Kauf-Backends nehmen 1 % deines Umsatzes, sobald du {threshold} im Monat überschreitest, und die Rechnung wächst mit jedem Schritt mit. Am einfachsten umgehst du das vor deinem ersten Verkauf. openpurr ist ein kostenloses Open-Source-Backend für In-App-Käufe und Abos, das du selbst betreibst, mit demselben offiziellen SDK, das auch die großen Plattformen nutzen.",
    ctaStart: "Auf GitHub loslegen",
    ctaHow: "So funktioniert's",
    ctaAi: "Prompt für deinen KI-Assistenten kopieren",
  },
  growth: {
    title: "Deine 1 %, vom ersten Tag an",
    text: "Wähle, wo du deine App in drei Jahren siehst. So viel würde eine Umsatzbeteiligung von 1 % auf dem Weg dorthin ausmachen, bei gleichmäßigem Wachstum ab null.",
    target: "Monatsumsatz in drei Jahren",
    fee: "1 % Umsatzbeteiligung, über 3 Jahre",
    servers: "Selbst betrieben, über 3 Jahre",
    after: "Und danach, jedes Jahr",
    chartLabel: "Die Umsatzbeteiligung, Monat für Monat über drei Jahre aufsummiert",
    summary: "Das sind <b>{fee}</b>, die du bis zum vierten Jahr abgeben würdest, gegenüber <b>{servers}</b> für deine eigenen Server. Behalte das Geld und steck es stattdessen in dein Geschäft.",
  },
  invest: {
    title: "Investiere es in dein Geschäft und in dich",
    text: "Was ein Jahr deiner 1 % kauft, wenn du sie behältst:",
  },
  how: {
    title: "So funktioniert's",
    lede: "Vier Schritte, und dein Code ist derselbe wie in jedem RevenueCat-Tutorial.",
    steps: [
      {
        title: "openpurr bereitstellen",
        text: "Führe das Setup in deinem Cloudflare-Konto aus. Lite passt für kleine Apps in den <b>kostenlosen Tarif</b>, und du kannst das Setup gefahrlos erneut starten, falls es mittendrin abbricht.",
      },
      {
        title: "App und Produkte anlegen",
        text: "Das Dashboard beginnt damit, deine erste App anzulegen: Bundle-ID und Paketname, dann Produkte, Entitlements und Offerings.",
      },
      {
        title: "Purchases SDK einbauen",
        text: "Installiere das offizielle RevenueCat Purchases SDK, das Open Source unter der MIT-Lizenz ist, und setze <b>eine Proxy-URL</b>, bevor du es konfigurierst.",
      },
      {
        title: "Veröffentlichen",
        text: "Käufe werden bei Apple und Google validiert, Verlängerungen und Erstattungen kommen per Store-Benachrichtigung, und dein Backend bekommt Webhooks. Du nutzt Claude Code? Das openpurr-Plugin führt dich durch die Einrichtung in App Store Connect und der Play Console.",
      },
    ],
    setupLabel: "Setup, auf deinem Rechner",
  },
  ai: {
    title: "Mit deinem KI-Coding-Assistenten einrichten",
    text: "Öffne das Projekt deiner App in Claude Code, Codex, Cursor, Grok oder einem anderen Coding-Agenten und füge diesen Prompt ein. Er deployt openpurr, verbindet die Stores und fügt das SDK hinzu, und fragt dich vor allem, wofür du dich anmelden musst.",
    copy: "Prompt kopieren",
    copied: "Kopiert",
    claudeTip: "Nutzt du Claude Code? Füge zuerst das openpurr-Plugin hinzu, es hilft dir Schritt für Schritt:",
  },
  includes: {
    title: "Was du bekommst",
    yes: [
      "Käufe und Abos im App Store und bei Google Play",
      "Entitlements und Offerings",
      "Webhooks an dein Backend, signiert und mit Wiederholungen",
      "16 Diagramme: Umsatz, MRR, Churn, Testphasen und mehr",
      "Preisexperimente",
      "Deine Daten in deiner eigenen Datenbank",
    ],
    notYetTitle: "Noch nicht",
    notYet: "Paywall-Builder, Analytics-Integrationen von Drittanbietern, Werbeereignisse, Web-Billing und Amazon. Wenn du das vom ersten Tag an brauchst, bieten kommerzielle Plattformen es heute schon.",
  },
  lockin: {
    title: "Keine Abhängigkeit, in keine Richtung",
    text: "Weil openpurr das Standard-Purchases-SDK nutzt, funktioniert dein Kaufcode mit beiden Backends. Wenn du openpurr entwächst oder das willst, was kommerzielle Plattformen zusätzlich bieten, ist der Wechsel eine Konfigurationsänderung und ein Kundenimport, kein Neuschreiben.",
  },
  pricingLink: {
    text: "Neugierig, wohin die 1 % gehen, wenn du sie zahlst?",
    link: "Die Preise von RevenueCat, aufgeschlüsselt →",
  },
  faq: {
    title: "Häufige Fragen",
    items: {
      backend: {
        q: "Brauche ich ein Backend für In-App-Käufe?",
        a: "Nicht zwingend: StoreKit und Google Play Billing laufen auf dem Gerät. Aber ein Backend hält Abos verlässlich. Es validiert Käufe bei Apple und Google, verfolgt Verlängerungen, Kündigungen und Erstattungen über Store-Benachrichtigungen und sagt deiner App und deinem Server, wer Zugang hat. openpurr ist dieses Backend, und du betreibst es selbst.",
      },
      cheapest: {
        q: "Wie baue ich Abos am günstigsten in eine iOS- oder Android-App ein?",
        a: "Betreibe das Backend selbst. openpurr Lite passt für kleine Apps in den kostenlosen Cloudflare-Tarif und funktioniert mit dem kostenlosen Open-Source-Purchases-SDK. Du zahlst also nur die Server: in unserem Modell etwa {servers} im Jahr für eine App mit {m25k} Monatsumsatz, ohne Umsatzbeteiligung.",
      },
      free: {
        q: "Ist openpurr wirklich kostenlos?",
        a: "Ja. Es ist Open Source unter der Apache-2.0-Lizenz, ohne Umsatzbeteiligung und ohne Gebühren pro Transaktion. Du zahlst für deine eigenen Server, und kleine Apps passen in den kostenlosen Cloudflare-Tarif.",
      },
      switch: {
        q: "Kann ich später zu RevenueCat wechseln?",
        a: "Ja. openpurr nutzt das offizielle RevenueCat Purchases SDK, also funktioniert der Kaufcode deiner App mit beiden Backends, und deine Produkte in den Stores bleiben gleich. Der Wechsel ist eine Konfigurationsänderung plus der Umzug deiner Kundendaten.",
      },
      missing: {
        q: "Was kann openpurr noch nicht?",
        a: "Paywall-Builder, Analytics-Integrationen von Drittanbietern, Werbeereignisse, Web-Billing und Amazon. Preisexperimente sind eingebaut. Wenn du den Rest vom ersten Tag an brauchst, bietet eine kommerzielle Plattform ihn heute schon.",
      },
    },
  },
};
