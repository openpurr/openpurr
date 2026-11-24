// The RevenueCat pricing page in this language (see en.ts for the notes).
import type { PricingDict } from "./en";

export const pricingHi: PricingDict = {
  meta: {
    title: "RevenueCat pricing: आपका 1% असल में कहाँ जाता है - openpurr",
    description:
      "RevenueCat आपके revenue का 1% लेता है। आपके app के पीछे के servers का ख़र्च न के बराबर है। देखिए बाक़ी पैसा कहाँ जाता है: salaries, sales और VC investors।",
    ogImageAlt: "RevenueCat आपके revenue का 1% लेता है; servers का ख़र्च न के बराबर है। बाक़ी पैसा किसमें जाता है।",
  },
  hero: {
    crumb: "RevenueCat pricing",
    eyebrow: "आपका 1% कहाँ जाता है",
    headline: "आप servers के पैसे नहीं दे रहे।",
    /** The headline's second, highlighted sentence. {valuation} is "$500 million". */
    headlineAccent: "आप {valuation} की company के पैसे दे रहे हैं।",
    /** {threshold} is "$2,500". */
    lede: "हर महीने {threshold} पार करते ही RevenueCat आपके पूरे tracked revenue का 1% लेता है, और आप जितना बढ़ते हैं, bill भी उतना बढ़ता है। आपके app के पीछे के servers का ख़र्च न के बराबर है। बाक़ी पैसा company चलाता है: उसकी payroll, उसकी sales team और उसके investors का return।",
    updated: "अपडेट: {date} - Public आँकड़ों पर आधारित अनुमान",
  },
  answer: {
    title: "RevenueCat pricing, एक line में",
    /** HTML. {threshold} is "$2,500". */
    text: "हर महीने {threshold} से कम tracked revenue पर मुफ़्त, उसके बाद <strong>पूरे revenue का 1%</strong>। एक साल में यह कितना बनता है, और उसी app के servers का ख़र्च कितना है:",
    colRevenue: "मासिक revenue",
    colFee: "RevenueCat, सालाना",
    colServers: "Servers, सालाना",
  },
  calc: {
    revenue: "आपके app का मासिक revenue",
    fee: "RevenueCat लेता है",
    servers: "Servers का असली ख़र्च",
    perYear: "प्रति वर्ष",
    stackLabel: "आपकी सालाना fee, servers और RevenueCat की teams में बँटी हुई",
    /** HTML. {servers} and {rest} are percentages. */
    stackNote: "Servers: {servers}। बाक़ी सब, {rest}, उनकी teams पर जाता है:",
    /** {people} is a number, {salary} is like "$210K". */
    teamMeta: "लगभग {people} लोग - आम salary {salary}",
    swag: "बिल में यह भी शामिल है: टीम के लिए जगमगाते RevenueCat स्केटबोर्ड। इसका खर्च भी आपका 1% उठाता है।",
    swagPostAlt: "X पर RevenueCat के एक कर्मचारी की पोस्ट: “मेरा RevenueCat स्केटबोर्ड कल आ गया! अपना मुफ़्त RevenueCat स्केटबोर्ड पाने का लिंक यह रहा,” और लिंक RevenueCat के jobs पेज पर जाता है",
    swagPhotoAlt: "एक जगमगाता RevenueCat स्केटबोर्ड",
    swagCaption: "X पर {date} को पोस्ट किया गया। “अपना पाएँ” वाला लिंक उनके jobs पेज पर जाता है। {link}",
    swagLink: "पोस्ट देखें",
    ceoLink: "आपका 1% CEO के social media का ख़र्च भी उठाता है: X पर रोज़ लगभग {perDay} posts, हर दिन।",
    ceoLinkLabel: "आँकड़े देखें →",
    ownersTitle: "आपका 1% किसी और का exit बना रहा है",
    ownersPunch: "आप सबसे अमीर 1% को 1% दे रहे हैं।",
    /** {pct} is like "55%". */
    ownersInvestors: "VC investors - लगभग {pct}",
    ownersRest: "Founders और employees",
    ownersBarLabel: "हमारे अनुमान से RevenueCat का लगभग {pct} हिस्सा VC investors के पास है",
    /** HTML. {funding} is "$100 million"; {vc} is an amount that moves with the slider. */
    ownersText:
      "VC investors ने पाँच rounds में RevenueCat में लगभग {funding} लगाए हैं, और reported valuations के हिसाब से company का आधे से ज़्यादा हिस्सा उनका है। उन्हें हर payment में cut नहीं चाहिए। आपकी दी हुई हर fee उनकी company की value बढ़ाती है, और company बिकने पर वे कमाते हैं। Ownership के हिसाब से, आप हर साल जो देते हैं उसमें से लगभग {vc} उनका return बना रहा है।",
    investorsLabel: "RevenueCat के investors",
    /** HTML. {days} is a number, {infra} an amount; both move with the slider. */
    punch: "आपका 1% यही खरीदता है। यही काम ख़ुद चलाने का ख़र्च {infra} है।",
    /** HTML. {keep} is an amount that moves with the slider. */
    keep: "बाक़ी {keep} अपने पास रखें।",
    ctaKeep: "अपना 1% अपने पास रखें →",
    ctaGithub: "GitHub पर openpurr",
  },
  receipts: {
    title: "अपना 1% अपने पास रखें, तो क्या-क्या आएगा",
    note: "मोटे-मोटे दाम, US dollars में, US के solo developer के लिए।",
    /** The receipts are styled like till receipts; keep these short. */
    header: "आपका 1%, आपके पास",
    /** {revenue} is like "$10,000". */
    revenue: "App revenue {revenue}/माह",
    year: "1% प्रति वर्ष",
    total: "कुल",
    change: "बाक़ी",
    /** {zero} is "$0.00". */
    shareLine: "Revenue share: {zero}",
    thanks: "अपने पास रखने के लिए धन्यवाद",
    /** {n} is a number. */
    items: {
      ugc: "{n} creator वीडियो (UGC ads)",
      ugcCampaign: "Creator campaign, {n} वीडियो",
      ira: "Retirement बचत (IRA)",
      k401: "Solo 401(k) योगदान",
      health: "Health insurance, {n} महीने",
      weekend: "एक weekend getaway",
      vacation: "एक हफ़्ते की छुट्टी",
      apple: "Apple Developer Program",
    },
  },
  teams: {
    eng: { name: "Engineering", basis: "Senior SDK engineer की job posting, $212K" },
    product: { name: "Product, design और data", basis: "Senior product manager की postings, $230K; senior data scientist, $220K" },
    sales: { name: "Sales", basis: "Head of Sales की posting, $363K; senior sales engineer, $200K; product expert, $133K" },
    growth: { name: "Marketing और growth", basis: "Head of Customer Growth की posting, $259K; CRO designer, $205K; product marketing, $168K" },
    support: { name: "Customer success और support", basis: "Developer support engineer की posting, $118K" },
    community: { name: "Developer relations और community", basis: "सभी postings का overall median, लगभग $215K, अलग-अलग levels के mix के लिए थोड़ा कम करके" },
    ops: { name: "Operations, finance और people", basis: "Sales and operations specialist की posting, $167K; Head of People, $280K" },
    exec: { name: "Executives", basis: "कुछ के लिए Head of Sales की posting ($363K) से ज़्यादा, कुछ के लिए कम" },
  },
  faq: {
    title: "लोग ये सवाल पूछते हैं",
    /** Each answer is also the page's FAQ structured data. Amounts are filled in by the page. */
    items: {
      cost: {
        q: "RevenueCat की कीमत कितनी है?",
        /** {threshold} "$2,500"; {at10k} the yearly fee at $10,000 a month, {at100k} at $100,000 a month; {m10k} "$10,000", {m100k} "$100,000". */
        a: "RevenueCat का Pro plan हर महीने {threshold} से कम tracked revenue पर मुफ़्त है। उसके बाद यह पूरे revenue का 1% लेता है, सिर्फ़ {threshold} से ऊपर वाले हिस्से का नहीं: {m10k} महीना कमाने वाले app के लिए {at10k} सालाना, और {m100k} महीने पर {at100k} सालाना। बड़े accounts Enterprise pricing पर बातचीत कर सकते हैं।",
      },
      pays: {
        q: "RevenueCat की 1% fee किस चीज़ के लिए है?",
        /** {servers} and {fee} are yearly amounts for an app making {m25k} ("$25,000") a month; {people} is a number. */
        a: "ज़्यादातर company के लिए। एक आम app के पीछे के servers चलाने में महीने के कुछ dollars लगते हैं: {m25k} महीना कमाने वाले app के लिए {servers} सालाना, जबकि fees {fee}। बाक़ी पैसा लगभग {people} लोगों की team पर जाता है, जिसमें engineering, sales, marketing और executives शामिल हैं, और company के investors के लिए value बनाता है।",
      },
      owns: {
        q: "RevenueCat का मालिक कौन है?",
        /** {funding} "$100 million"; {investors} the list of firms, already joined; {pct} like "55%". */
        a: "RevenueCat ने पाँच rounds में VC investors से लगभग {funding} जुटाए हैं, जिनमें {investors} शामिल हैं। Reported round valuations को compound करने पर, अनुमान है कि company का लगभग {pct} हिस्सा investors के पास है। बाक़ी इसके founders और employees का है।",
      },
      worth: {
        q: "RevenueCat की value कितनी है?",
        /** {valuation} "$500 million", {round} "$50 million", {revenue} "$30 million". */
        a: "2025 में जब RevenueCat ने {round} का Series C जुटाया, तब इसकी valuation {valuation} बताई गई थी, और उस समय इसका सालाना revenue लगभग {revenue} था। ये press और analysts के आँकड़े हैं, company के disclosures नहीं।",
      },
      alternative: {
        q: "क्या RevenueCat का कोई ऐसा विकल्प है जिसमें revenue share न हो?",
        a: "हाँ। openpurr एक मुफ़्त, open-source, self-hosted backend है जो आधिकारिक RevenueCat Purchases SDK के साथ काम करता है। आप SDK का proxy URL अपने server पर set करते हैं और अपना purchase code वैसा ही रखते हैं। छोटे apps के लिए यह Cloudflare के free plan पर चलता है, बिना revenue share और बिना per-transaction fees के।",
      },
    },
  },
  more: {
    title: "हाँ, वे और भी बहुत कुछ करते हैं",
    text: "RevenueCat सिर्फ़ purchase backend नहीं बनाता: paywalls, experiments, integrations, support line भी। अगर आप यह सब इस्तेमाल करते हैं, तो शायद आपके लिए यह पैसा वसूल है। लेकिन अगर आपको बस purchases validate करवानी हैं और subscriptions up to date रखनी हैं, तो आप अपनी आगे की हर कमाई का हिस्सा एक ऐसे काम के लिए दे रहे हैं जो महीने के कुछ dollars के servers पर चल जाता है।",
  },
  method: {
    title: "हम इसका अनुमान कैसे लगाते हैं",
    /** HTML. Each item starts with a bold label. */
    fee: "<b>आपकी fee:</b> RevenueCat के Pro plan की list price, {threshold} से मासिक tracked revenue का 1%। बड़े accounts दूसरी pricing पर बातचीत कर सकते हैं।",
    /** HTML. {calculator} becomes a link labelled with `calculatorLink`. */
    servers:
      "<b>Servers:</b> उतने revenue वाले app के लिए Cloudflare पर openpurr Lite का ख़र्च, उसी model से जो हमारे {calculator} में है। RevenueCat का अपना hosting ख़र्च public नहीं है; यह वह ख़र्च है जो यही काम ख़ुद चलाने पर आता है।",
    calculatorLink: "savings calculator",
    /** HTML. {used}, {low}, {high} are headcounts; {loaded} is "1.3". */
    teams:
      "<b>Teams:</b> job functions, लोग नहीं। हम {used} लोग मानते हैं (public अनुमान {low} से {high} तक हैं) और उन्हें functions में ख़ुद बाँटते हैं। Salaries RevenueCat की public job postings से ली गई हैं, जिनमें pay लिखा होता है; हर team का ख़र्च = लोग × salary × {loaded}, taxes, benefits और equipment के लिए, equity के बिना। आपकी fee का जो हिस्सा servers पर नहीं जाता, वह इन्हीं ख़र्चों के अनुपात में बाँटा गया है।",
    split:
      "<b>Sales और growth में engineering से ज़्यादा लोग क्यों:</b> {date} को RevenueCat के job board पर {open} खुली positions थीं: {gtm} sales, marketing और growth में, और {eng} core engineering में। इस stage की company अपना go-to-market खड़ा कर रही होती है, और इसकी नई Head of Sales posting board पर सबसे ज़्यादा pay वाली है।",
    /** HTML. {funding} "$100 million", {pct} like "55%", {revenue} "$30 million". */
    investors:
      "<b>Investors:</b> 2018 से 2025 तक पाँच rounds, कुल लगभग {funding}। Ownership public नहीं है, इसलिए हम इसे reported valuations से compound करते हैं: हर round के investors को रकम ÷ post-money valuation जितना हिस्सा मिलता है, और पहले वाले सभी उतने ही हिस्से से dilute होते हैं। इससे लगभग {pct} आता है। Option pools और Y Combinator के accelerator stake को नहीं गिना गया। उनका हिस्सा company की value में है, उसके ख़र्चों की कोई line नहीं, इसलिए इसे अलग दिखाया गया है। 2025 के round के समय company का सालाना revenue लगभग {revenue} बताया गया था, break-even के क़रीब।",
    colRound: "Round",
    colRaised: "जुटाए",
    colValuation: "Valuation",
    colLead: "Lead investor",
    notReported: "reported नहीं",
    /** HTML. */
    affiliation: "<b>कोई संबंध नहीं:</b> openpurr का RevenueCat से कोई संबंध नहीं है। ये हमारे अनुमान हैं, RevenueCat के आँकड़े नहीं।",
    assumptions: "Assumptions, हर team के हिसाब से",
    colTeam: "Team",
    colPeople: "लोग",
    colSalary: "Salary",
    colCost: "सालाना ख़र्च",
    colBasis: "Salary का आधार",
  },
  sources: {
    title: "Sources",
    /** One label per source, in this order. The links themselves are in English. */
    items: [
      "RevenueCat pricing: $2,500 से मासिक tracked revenue का 1%",
      "RevenueCat का job board, pay ranges के साथ (Ashby)",
      "RevenueCat की पुरानी postings, pay के साथ (Greenhouse)",
      "TechCrunch: RevenueCat ने $50M जुटाए, कुल funding $100M (मई 2025)",
      "TechCrunch: $40M का Series B, Y Combinator के Continuity Fund की lead में, $300M valuation पर (2021)",
      "TechCrunch: Adjacent की lead में $12M का Series C (2024)",
      "SaaStr: 2018 का seed round $7M valuation पर, और उसके बाद के rounds",
      "Multiples.vc: 2025 के round पर लगभग $30M revenue और $500M valuation (अनुमान)",
      "Headcount के अनुमान: TipRanks (185)",
      "Headcount के अनुमान: TrueUp (130)",
    ],
    /** HTML. {date} is the date; {issue} becomes a link labelled with `issueLink`. */
    checked: "{date} को जाँचा गया। कुछ पुराना दिखा? {issue}।",
    issueLink: "Issue खोलें",
  },
};
