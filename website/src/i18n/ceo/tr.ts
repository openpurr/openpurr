// The "RevenueCat's CEO on X" page in this language (see en.ts for the notes).
import type { CeoDict } from "./en";

export const ceoTr: CeoDict = {
  meta: {
    title: "RevenueCat CEO'su Jacob Eiting: X'te günde {perDay} paylaşım",
    description:
      "RevenueCat CEO'su Jacob Eiting 90 günde X'te {posts} kez paylaşım yaptı, günde {hours} farklı saatte. RevenueCat'ten bahsedenler yaklaşık {pct}. %1'iniz bunun parasını da ödüyor.",
    ogImageAlt: "RevenueCat CEO'su X'te günde yaklaşık 10 kez paylaşım yapıyor, her gün. %1'iniz bunun parasını da ödüyor.",
  },
  hero: {
    crumb: "X'teki CEO",
    eyebrow: "%1'iniz nereye gidiyor",
    headline: "RevenueCat CEO'su Jacob Eiting, X'te günde {perDay} kez paylaşım yapıyor.",
    headlineAccent: "%1'iniz bunun parasını da ödüyor.",
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
    title: "%1'iniz onun sosyal medyasını da ödüyor",
    text: "Aylık {threshold} eşiğini geçtiğiniz anda RevenueCat tüm gelirinizin %1'ini alır. Şirket bu parayla döner, CEO'suna ödediği maaş da buna dahil. Yani %1'inizin bir kısmı, X'te günde yaklaşık {perDay} paylaşımın parasını ödüyor.",
    link: "%1'inizin geri kalanının nereye gittiğini görün →",
    ctaKeep: "%1'iniz sizde kalsın →",
    ctaGithub: "GitHub'da openpurr",
  },
  faq: {
    title: "Sık sorulan sorular",
    items: {
      who: {
        q: "RevenueCat'in CEO'su kim?",
        a: "Jacob Eiting, RevenueCat'in kurucu ortağı ve CEO'su. X'te {handle} hesabıyla paylaşım yapıyor ve onu yaklaşık {followers} kişi takip ediyor.",
      },
      often: {
        q: "RevenueCat'in CEO'su X'te ne sıklıkla paylaşım yapıyor?",
        a: "{end} tarihine kadarki {days} günde Jacob Eiting X'te {posts} kez paylaşım yaptı; yanıtlar dahil, yeniden paylaşımlar hariç. Bu, günde yaklaşık {perDay} paylaşım demek: her gün {hours} farklı saatte, {days} günün {active} gününde.",
      },
      about: {
        q: "RevenueCat'in CEO'su X'te ne hakkında paylaşım yapıyor?",
        a: "Çoğunlukla RevenueCat dışındaki konular hakkında. Anahtar kelime kurallarımıza göre paylaşımlarının {pct} kadarı RevenueCat'ten ya da şirketin işinden bahsediyor; {base} hesabının kendi paylaşımlarında bu oran {basePct}. Kurallar bazı paylaşımları kaçırıyor, bu yüzden {pct} oranını bir alt sınır olarak görün.",
      },
      pays: {
        q: "RevenueCat'in %1'lik ücreti CEO'suna da gidiyor mu?",
        a: "Kısmen. Aylık {threshold} eşiğini geçtiğiniz anda RevenueCat tüm gelirinizin %1'ini alır ve şirket bu parayla döner; yönetim kadrosuna ödediği para da buna dahil. RevenueCat, üst yöneticilerine ne kadar ödediğini açıklamıyor.",
      },
    },
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
