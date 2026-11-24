// The "RevenueCat's CEO on X" page in this language (see en.ts for the notes).
import type { CeoDict } from "./en";

export const ceoHi: CeoDict = {
  meta: {
    title: "RevenueCat के CEO X पर दिन में {perDay} बार post करते हैं - openpurr",
    description:
      "90 दिनों में RevenueCat के CEO ने X पर {posts} बार post किया, रोज़ {hours} अलग-अलग घंटों में। लगभग {pct} में RevenueCat का ज़िक्र है। आपका 1% उनकी company चलाता है।",
    ogImageAlt: "RevenueCat के CEO X पर दिन में लगभग 10 बार post करते हैं, हर दिन। आपका 1% उस company का ख़र्च उठाता है जिसे वे चलाते हैं।",
  },
  hero: {
    crumb: "X पर CEO",
    eyebrow: "आपका 1% कहाँ जाता है",
    headline: "RevenueCat के CEO X पर दिन में {perDay} बार post करते हैं।",
    headlineAccent: "आपका 1% उस company का ख़र्च उठाता है जिसे वे चलाते हैं।",
    lede: "पिछले {days} दिनों में RevenueCat के CEO, Jacob Eiting ({handle}), ने X पर {posts} बार post किया। यानी दिन में लगभग {perDay} posts, जो हर दिन {hours} अलग-अलग घंटों में फैले थे, {days} में से {active} दिनों पर।",
    updated: "अपडेट: {date} - Public posts से गिना गया",
  },
  stats: {
    posts: "{days} दिनों में posts",
    perDay: "posts प्रति दिन",
    hours: "active घंटे प्रति दिन",
    active: "post वाले दिन, {days} में से",
  },
  calendar: {
    title: "{days} दिनों की posting",
    note: "हर square एक दिन है। रंग जितना गहरा, उस दिन उतने ज़्यादा घंटों में post हुआ।",
    less: "कोई post नहीं",
    more: "ज़्यादा घंटे",
    cell: "{date}: {hours} घंटों में {posts} posts",
  },
  topic: {
    title: "इसमें से कितना RevenueCat के बारे में है?",
    text: "नीचे दिए नियमों के हिसाब से उनके <b>{pct}</b> posts में RevenueCat या उसके business का ज़िक्र है: {posts} में से {onTopic}। यही नियम {base} के अपने posts में सिर्फ़ {basePct} पकड़ते हैं, यानी कुछ छूट जाते हैं। फिर भी, वे जो post करते हैं उसका ज़्यादातर हिस्सा किसी और विषय पर होता है।",
    ceo: "उनके posts",
    base: "{base} के posts",
    about: "RevenueCat के बारे में",
  },
  pays: {
    title: "आपका 1% किसका ख़र्च उठाता है",
    text: "हर महीने {threshold} पार करते ही RevenueCat आपके पूरे revenue का 1% लेता है। इसी पैसे से company चलती है, servers से लेकर leadership तक।",
    link: "देखिए आपके 1% का बाक़ी हिस्सा कहाँ जाता है →",
    ctaKeep: "अपना 1% अपने पास रखें →",
    ctaGithub: "GitHub पर openpurr",
  },
  method: {
    title: "हमने कैसे गिना",
    posts: "<b>Posts:</b> {start} से {end} तक {handle} के सभी public posts और replies, जिन्हें {checked} को X की API से पढ़ा गया। Reposts नहीं गिने गए, और delete हुए posts गिने नहीं जा सकते।",
    hours: "<b>Active घंटे:</b> घड़ी के वे घंटे (9 से 10, 10 से 11…) जिनमें कम से कम एक post हुआ। 9:05, 9:40 और 14:10 के posts से 2 active घंटे बनते हैं। यह post वाले घंटे गिनता है, बिताया गया समय नहीं। दिन आधी रात से आधी रात तक, UTC में गिना जाता है।",
    rules: "<b>RevenueCat के बारे में:</b> ऐसा post जिसमें {accounts} का ज़िक्र हो, {sites} का link हो, या इनमें से कोई शब्द हो: {terms}।",
    limits: "<b>यह क्या नहीं बताता:</b> posting किसी CEO के काम का हिस्सा हो सकती है, और ये आँकड़े यह नहीं दिखाते कि वे कब काम करते हैं। ये दिखाते हैं कि वे कितनी बार post करते हैं, और किस बारे में।",
    data: "<b>Data:</b> हम सिर्फ़ गिनती रखते हैं, post का कोई text नहीं। इन्हें गिनने वाली script {script} है।",
    scriptLink: "हमारी repository में",
    affiliation: "<b>कोई संबंध नहीं:</b> openpurr का RevenueCat से कोई संबंध नहीं है।",
  },
};
