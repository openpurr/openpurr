// German copy of the migration page. Follows en.ts; see the notes there.
import type { MigrateDict } from "./en";

export const migrateDe: MigrateDict = {
  meta: {
    title: "Von RevenueCat zu openpurr migrieren: Schritt für Schritt",
    description:
      "Wechsle von RevenueCat zu openpurr, der Open-Source-Alternative zu RevenueCat: Behalte das Purchases SDK, importiere alle Abonnenten und erhalte ihren Zugang.",
    ogImageAlt:
      "Von RevenueCat zu openpurr wechseln, ohne einen Abonnenten zu verlieren: Das Purchases SDK bleibt, alle Kunden werden importiert und alte App-Versionen funktionieren weiter.",
  },
  hero: {
    crumb: "Umstieg von RevenueCat",
    eyebrow: "Migrationsanleitung",
    headline: "Von RevenueCat zu openpurr wechseln, ohne einen Abonnenten zu verlieren",
    lede: "Behalte das Purchases SDK, das deine App schon nutzt. Importiere deine bestehenden Kunden aus dem Export von RevenueCat: openpurr holt jeden Kauf selbst bei Apple und Google ab. Alte App-Versionen funktionieren weiter, während die Leute aktualisieren.",
    guide: "Die Schritt-für-Schritt-Anleitung lesen (Englisch)",
    steps: "Zu den Schritten",
    updated: "Aktualisiert am {date}",
  },
  summary: {
    title: "Kurz gesagt",
    items: [
      "openpurr ist eine selbst gehostete Open-Source-Alternative zu RevenueCat. Es funktioniert mit dem offiziellen, unveränderten RevenueCat Purchases SDK.",
      "Deine App bekommt eine zusätzliche Zeile (die Proxy-URL des SDK) und einen einmaligen Aufruf von <code>syncPurchases</code>. Der restliche Kaufcode bleibt gleich.",
      "<code>openpurr import</code> übernimmt bestehende Kunden aus dem Export von RevenueCat. Die Käufe selbst werden bei Apple und Google abgerufen, nicht kopiert.",
      "Apps im App Store können den Scheduled Data Export von RevenueCat nutzen. Für Google Play brauchst du einen Migrationsexport vom RevenueCat Support, denn nur dieser enthält Kauftokens.",
      "Beide Backends bleiben auf dem neuesten Stand, bis die meisten Leute die App aktualisiert haben. So verliert niemand seinen Zugang.",
      "Im kostenlosen Cloudflare-Tarif schafft der Import etwa 2.500 Kunden pro Tag. Mit Workers Paid dauert ein großer Import einige Stunden.",
    ],
  },
  how: {
    eyebrow: "So funktioniert's",
    title: "So funktioniert der Umstieg von RevenueCat",
    lede: "openpurr kopiert keine Kaufdatensätze aus RevenueCat. Es muss nur wissen, wem welcher Kauf gehört, und fragt dann die Stores, genau wie wenn deine App einen Kauf sendet.",
    ways: [
      {
        title: "Der Import",
        body: "Der Export von RevenueCat zeigt, welchem App-User welcher Store-Kauf gehört. <code>openpurr import</code> fragt Apple und Google nach jedem Kauf und speichert die Antwort des Stores für diesen User. So kommen alle auf einmal herüber, auch Leute, die die App nie wieder öffnen.",
      },
      {
        title: "Das App-Update",
        body: "Die neue Version richtet das Purchases SDK auf openpurr und sendet die Käufe jedes Kunden einmal mit <code>syncPurchases</code>. Das erfasst alle, die der Export verpasst hat, und alle, die nach seiner Erstellung gekauft haben.",
      },
      {
        title: "Eine Zeit lang beide Backends",
        body: "Alte App-Versionen sprechen weiter mit RevenueCat, bis die Leute aktualisieren. RevenueCat leitet die Benachrichtigungen von Apple an openpurr weiter, und eine zweite Pub/Sub-Subscription erledigt dasselbe für Google. So bleiben beide aktuell.",
      },
    ],
  },
  app: {
    eyebrow: "In deiner App",
    title: "Was sich in deiner App ändert",
    lede: "Setze die Proxy-URL vor configure und sende die Käufe jedes Kunden einmal. Dieselben zwei Änderungen funktionieren unter Android, Flutter und React Native; die Anleitung enthält den Code für jede Plattform.",
    codeLabel: "Swift-Beispiel: die Proxy-URL und eine einmalige Synchronisierung",
    proxyComment: "Vor configure(): die einzige neue Zeile in den meisten Apps",
    syncComment: "Einmal pro Installation: Käufe dieses Kunden an openpurr senden",
  },
  import: {
    eyebrow: "Der Import",
    title: "Kunden aus RevenueCat importieren",
    lede: "Die openpurr CLI liest die Spalten von RevenueCat so, wie sie sind: App-User-IDs, Transaktions-IDs aus dem App Store, Kauftokens von Google Play und Attribute wie <code>$email</code>.",
    codeLabel: "Terminal: den Export von RevenueCat importieren",
    dryRunComment: "Erste Zeilen prüfen: fragt Apple und Google, schreibt nichts",
    importComment: "Alle importieren. Jederzeit abbrechen; erneut starten, um fortzusetzen.",
    safeguards: [
      ["Niemand verliert seinen Zugang", "Ein Kauf, den die App bereits für einen Kunden gesendet hat, bleibt bei ihm; der Import verschiebt ihn nie."],
      ["Keine doppelten Webhooks", "Importierte Käufe sind nicht neu, deshalb sendet openpurr für sie keine Ereignisse."],
      ["Ehrliche Diagramme", "Importierte Kunden zählen ab ihrem ersten Kauf und nicht als Neukunden am Tag des Imports."],
      ["Deine App läuft weiter", "Im kostenlosen Cloudflare-Tarif hält der Import bei 90 % eines Tageslimits an und macht am nächsten Tag weiter."],
      ["Anhalten und fortsetzen", "Der Fortschritt wird gespeichert. Eine Zeile zweimal zu importieren ändert nichts, also kannst du einen neueren Export erneut einspielen."],
      ["Erst ausprobieren", "Ein Probelauf fragt die Stores und meldet, was passieren würde, ohne etwas zu schreiben."],
    ] as [string, string][],
  },
  steps: {
    eyebrow: "Schritt für Schritt",
    title: "In sieben Schritten von RevenueCat umsteigen",
    lede: "Beide Backends laufen weiter, bis du für den Wechsel bereit bist. So behalten Kunden mit älteren App-Versionen ihren Zugang.",
    items: [
      {
        title: "openpurr einrichten",
        body: "Stelle openpurr Lite in deinem Cloudflare-Konto bereit, gib ihm API-Zugriff auf App Store und Google Play und lege deine Produkte, Entitlements und Offerings mit denselben IDs neu an. Du kannst sogar deine öffentlichen SDK-Keys von RevenueCat behalten.",
      },
      {
        title: "Beide Backends auf dem Laufenden halten",
        body: "Trage openpurr in RevenueCat als Apple Server Notification Forwarding URL ein und füge die Push-Subscription von openpurr zu deinem Topic für Play-Benachrichtigungen hinzu.",
      },
      {
        title: "Export besorgen",
        body: "Nur App Store: Der Scheduled Data Export von RevenueCat enthält alles Nötige. Bei Google Play bittest du den RevenueCat Support um einen Migrationsexport, denn nur dieser enthält Kauftokens. Die Anleitung enthält eine Anfrage zum Kopieren.",
      },
      { title: "Importieren", body: "Führe <code>openpurr import</code> aus, zuerst als Probelauf. Probleme mit einzelnen Zeilen landen in einem Bericht und halten den Import nicht an." },
      { title: "App-Update ausliefern", body: "Ergänze die Proxy-URL und einen einmaligen Aufruf von <code>syncPurchases</code>. Veröffentliche das Update, sobald der Import fertig ist." },
      {
        title: "Prüfen",
        body: "<code>openpurr doctor</code> prüft die Einrichtung. Schlag Kunden nach, die du kennst, und vergleiche die aktiven Abos mit den Diagrammen von RevenueCat.",
      },
      {
        title: "Wechsel abschließen",
        body: "Sobald die meisten Kunden aktualisiert haben, richte Apple und Google direkt auf openpurr, schalte die Webhooks von openpurr ein und die von RevenueCat aus.",
      },
    ],
    source: "Quelle:",
    sourceNotifications: "RevenueCat: Apple Server Notifications (Englisch)",
    sourceExports: "RevenueCat: Daten exportieren oder wechseln (Englisch)",
    more: "Alle Befehle und Einstellungen stehen in der vollständigen Anleitung (Englisch) →",
  },
  moves: {
    eyebrow: "Was umzieht",
    title: "Was von RevenueCat mitkommt und was nicht",
    rows: [
      ["Abos und Käufe, mit Verlängerungen, Erstattungen, Kulanzzeiträumen und Ablauf", "Ja, abgerufen bei Apple und Google"],
      ["Wem welcher Kauf gehört", "Ja, aus dem Export von RevenueCat"],
      ["App-User-IDs, auch anonyme", "Ja, unverändert"],
      ["Kundenattribute ($email, $displayName und eigene)", "Ja, aus einem Audience export"],
      ["Produkte, Entitlements und Offerings", "Du legst sie mit denselben IDs neu an"],
      ["Diagrammverlauf vor dem Wechsel", "Teilweise: Bewahre die Diagramm-CSVs von RevenueCat für deine Unterlagen auf"],
      ["Experimente", "Du legst sie neu an: openpurr führt Preisexperimente mit deinen Offerings durch"],
      ["Paywalls, Integrationen, Customer Center", "Nein: Das bietet openpurr nicht"],
    ] as [string, string][],
  },
  faq: {
    eyebrow: "FAQ",
    title: "FAQ zum Umstieg von RevenueCat",
    items: [
      {
        q: "Muss ich meinen Kaufcode ändern?",
        a: "Nein. openpurr funktioniert mit dem offiziellen, unveränderten RevenueCat Purchases SDK. Das App-Update ergänzt die Proxy-URL vor configure und einen einmaligen Aufruf von syncPurchases. getOfferings, purchase, restorePurchases, logIn und der Rest bleiben, wie sie sind.",
      },
      {
        q: "Brauche ich für den Umstieg die Hilfe von RevenueCat?",
        a: "Für Apps im App Store nicht: Der Scheduled Data Export von RevenueCat enthält die Transaktions-IDs, die openpurr braucht. Für Google Play schon: Laut der Dokumentation von RevenueCat enthält nur ein Migrationsexport, den der RevenueCat Support erstellt, die Kauftokens, die Google verlangt.",
      },
      {
        q: "Was ist mit Kunden, die die App nie aktualisieren?",
        a: "Der Import deckt sie ab: Ihre Käufe werden bei Apple und Google abgerufen und denselben App-User-IDs zugeordnet. Solange sie noch eine alte App-Version nutzen, spricht diese mit RevenueCat. Deshalb bleiben beide Backends informiert, bis die meisten Leute aktualisiert haben.",
      },
      {
        q: "Wie lange dauert ein Import?",
        a: "Jeder Kunde braucht etwa 30 Schreibvorgänge für Datenbankzeilen. Im kostenlosen Cloudflare-Tarif sind das etwa 2.500 Kunden pro Tag, und der Import pausiert beim Tageslimit von selbst und macht am nächsten Tag weiter. Mit Workers Paid (5 $ im Monat) dauert ein großer Import einige Stunden.",
      },
      {
        q: "Werden meine Daten von RevenueCat kopiert?",
        a: "Nur die Zuordnung von App-Usern zu Store-Käufen, dazu Attribute, falls du sie importierst. Die Käufe selbst kommen direkt von Apple und Google, also speichert openpurr den aktuellen Stand der Stores, einschließlich Verlängerungen und Erstattungen.",
      },
    ],
  },
  cta: {
    title: "Bereit für den Wechsel?",
    body: "Die Anleitung führt dich durch jeden Schritt. Wenn etwas an deinem Setup nicht passt, eröffne ein Issue: Migrationen bestimmen mit, was als Nächstes gebaut wird.",
    guide: "Die Anleitung lesen (Englisch)",
    github: "openpurr auf GitHub",
    issue: "Issue eröffnen",
  },
};
