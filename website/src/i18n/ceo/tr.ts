// The "RevenueCat's CEO on X" page in this language (see en.ts for the notes).
import type { CeoDict } from "./en";

export const ceoTr: CeoDict = {
  meta: {
    title: "RevenueCat CEO'su X'te günde {perDay} kez paylaşım yapıyor - openpurr",
    description:
      "RevenueCat CEO'su 90 günde X'te {posts} kez paylaşım yaptı, günde {hours} farklı saatte. RevenueCat'ten bahsedenler yaklaşık {pct}. %1'iniz onun şirketini finanse ediyor.",
    ogImageAlt: "RevenueCat CEO'su X'te günde yaklaşık 10 kez paylaşım yapıyor, her gün. %1'iniz onun yönettiği şirketi finanse ediyor.",
  },
  hero: {
    crumb: "X'teki CEO",
    eyebrow: "%1'iniz nereye gidiyor",
    headline: "RevenueCat CEO'su X'te günde {perDay} kez paylaşım yapıyor.",
    headlineAccent: "%1'iniz onun yönettiği şirketi finanse ediyor.",
    lede: "Son {days} günde RevenueCat'in CEO'su Jacob Eiting ({handle}), X'te {posts} kez paylaşım yaptı. Bu, günde yaklaşık {perDay} paylaşım demek: her gün {hours} farklı saate yayılmış, {days} günün {active} gününde.",
    updated: "Güncellendi: {date} - Kamuya açık paylaşımlardan sayıldı",
  },
  stats: {
    posts: "paylaşım ({days} günde)",
    perDay: "günlük paylaşım",
    hours: "günlük aktif saat",
    active: "paylaşım yapılan gün ({days} günde)",
  },
  calendar: {
    title: "{days} günlük paylaşım",
    note: "Her kare bir gün. Kare ne kadar koyuysa, o günün o kadar çok saatinde paylaşım var.",
    less: "Paylaşım yok",
    more: "Daha çok saat",
    cell: "{date}: {hours} saatte {posts} paylaşım",
  },
  topic: {
    title: "Bunun ne kadarı RevenueCat hakkında?",
    text: "Aşağıdaki kurallara göre paylaşımlarının <b>{pct}</b> kadarı RevenueCat'ten ya da şirketin işinden bahsediyor: {posts} paylaşımdan {onTopic} tanesi. Aynı kurallar {base} hesabının kendi paylaşımlarında {basePct} buluyor, yani bazılarını kaçırıyorlar. Yine de paylaşımlarının çoğu başka konularda.",
    ceo: "Onun paylaşımları",
    base: "{base} paylaşımları",
    about: "RevenueCat hakkında",
  },
  pays: {
    title: "%1'iniz neyi ödüyor",
    text: "Aylık {threshold} eşiğini geçtiğiniz anda RevenueCat tüm gelirinizin %1'ini alır. Şirket bu parayla döner, sunucularından yönetimine kadar.",
    link: "%1'inizin geri kalanının nereye gittiğini görün →",
    ctaKeep: "%1'iniz sizde kalsın →",
    ctaGithub: "GitHub'da openpurr",
  },
  method: {
    title: "Nasıl saydık",
    posts: "<b>Paylaşımlar:</b> {handle} hesabının {start} ile {end} arasındaki tüm herkese açık paylaşımları ve yanıtları; X'in API'sinden {checked} tarihinde okundu. Yeniden paylaşımlar sayılmadı, silinmiş paylaşımlar ise sayılamaz.",
    hours: "<b>Aktif saatler:</b> en az bir paylaşım yapılan saat dilimleri (9-10, 10-11 gibi). 9:05, 9:40 ve 14:10'daki paylaşımlar 2 aktif saat eder. Harcanan zamanı değil, paylaşım olan saatleri sayar. Günler gece yarısından gece yarısına, UTC'ye göre.",
    rules: "<b>RevenueCat hakkında:</b> {accounts} hesaplarından bahseden, {sites} adreslerine bağlantı veren ya da şu terimlerden birini kullanan paylaşım: {terms}.",
    limits: "<b>Bunun söylemedikleri:</b> paylaşım yapmak bir CEO'nun işinin parçası olabilir ve bu rakamlar onun ne zaman çalıştığını göstermez. Ne sıklıkta ve ne hakkında paylaşım yaptığını gösterir.",
    data: "<b>Veri:</b> yalnızca sayıları saklıyoruz, paylaşım metinlerini değil. Bunları sayan betik {script} bulunuyor.",
    scriptLink: "depomuzda",
    affiliation: "<b>Bağlantı yok:</b> openpurr'ın RevenueCat ile bir bağlantısı yoktur.",
  },
};
