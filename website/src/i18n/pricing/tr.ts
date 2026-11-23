// The RevenueCat pricing page in this language (see en.ts for the notes).
import type { PricingDict } from "./en";

export const pricingTr: PricingDict = {
  meta: {
    title: "RevenueCat fiyatları: %1'iniz nereye gidiyor? · openpurr",
    description:
      "RevenueCat gelirinizin %1'ini alır. Uygulamanızın sunucuları ise devede kulak. Gerisinin neye gittiğini görün: maaşlar, satış ekibi ve risk sermayedarları.",
    ogImageAlt: "RevenueCat gelirinizin %1'ini alıyor; sunucular devede kulak. Gerisi neye gidiyor?",
  },
  hero: {
    crumb: "RevenueCat fiyatları",
    eyebrow: "%1'iniz nereye gidiyor",
    headline: "Sunuculara para ödemiyorsunuz.",
    /** The headline's second, highlighted sentence. {valuation} is "$500 million". */
    headlineAccent: "{valuation} değerinde bir şirkete ödüyorsunuz.",
    /** {threshold} is "$2,500". */
    lede: "Aylık {threshold} eşiğini geçtiğiniz anda RevenueCat izlenen gelirinizin tamamının %1'ini alır ve siz büyüdükçe fatura da büyür. Uygulamanızın arkasındaki sunucular devede kulak. Gerisi şirkete gider: maaşlarına, satış ekibine ve yatırımcılarının kazancına.",
    updated: "Güncellendi: {date} · Kamuya açık verilere dayalı tahminler",
  },
  answer: {
    title: "Tek satırda RevenueCat fiyatları",
    /** HTML. {threshold} is "$2,500". */
    text: "Aylık {threshold} izlenen gelirin altında ücretsiz, sonrasında <strong>tamamının %1'i</strong>. Bunun yıllık tutarı ve aynı uygulamanın sunucu maliyeti yan yana:",
    colRevenue: "Aylık gelir",
    colFee: "RevenueCat, yıllık",
    colServers: "Sunucular, yıllık",
  },
  calc: {
    revenue: "Uygulamanızın aylık geliri",
    fee: "RevenueCat'in aldığı",
    servers: "Sunucuların gerçek maliyeti",
    perYear: "/ yıl",
    stackLabel: "Yıllık ücretiniz: sunucular ve RevenueCat'in ekipleri",
    /** HTML. {servers} and {rest} are percentages. */
    stackNote: "Sunucular: {servers}. Geri kalan her şey, yani {rest}, ekiplerine gidiyor:",
    /** {people} is a number, {salary} is like "$210K". */
    teamMeta: "Yaklaşık {people} kişi · tipik maaş {salary}",
    ownersTitle: "Üstelik yarısından fazlası başkasının exit'ini büyütüyor",
    /** {pct} is like "55%". */
    ownersInvestors: "Risk sermayesi yatırımcıları · yaklaşık {pct}",
    ownersRest: "Kurucular ve çalışanlar",
    ownersBarLabel: "Tahminimize göre risk sermayesi yatırımcıları RevenueCat'te yaklaşık {pct} paya sahip",
    /** HTML. {funding} is "$100 million"; {vc} is an amount that moves with the slider. */
    ownersText:
      "Risk sermayesi yatırımcıları beş turda RevenueCat'e yaklaşık {funding} yatırdı ve açıklanan değerlemelere göre şirketin yarısından fazlası onların. Her ödemeden pay almalarına gerek yok. Ödediğiniz her ücret, sahibi oldukları şirketin değerini artırır; şirket satıldığında parayı da onlar toplar. Hisse payı açısından, her yıl ödediğiniz tutarın yaklaşık {vc} kadarı onların kazancını büyütüyor.",
    investorsLabel: "RevenueCat'in yatırımcıları",
    /** HTML. {days} is a number, {infra} an amount; both move with the slider. */
    punch: "%1'iniz RevenueCat'te yılda yaklaşık {days} mühendis-günü satın alır. Aynı işi kendiniz çalıştırmanın maliyeti ise {infra}.",
    /** HTML. {keep} is an amount that moves with the slider. */
    keep: "Kalan {keep} cebinizde kalsın.",
    ctaKeep: "%1'iniz sizde kalsın →",
    ctaGithub: "GitHub'da openpurr",
  },
  teams: {
    eng: { name: "Mühendislik", basis: "Kıdemli SDK mühendisi ilanı, 212 bin $" },
    product: { name: "Ürün, tasarım ve veri", basis: "Kıdemli ürün yöneticisi ilanları, 230 bin $; kıdemli veri bilimci, 220 bin $" },
    sales: { name: "Satış", basis: "Head of Sales ilanı, 363 bin $; kıdemli satış mühendisi, 200 bin $; ürün uzmanı, 133 bin $" },
    growth: { name: "Pazarlama ve büyüme", basis: "Head of Customer Growth ilanı, 259 bin $; CRO tasarımcısı, 205 bin $; ürün pazarlama, 168 bin $" },
    support: { name: "Müşteri başarısı ve destek", basis: "Geliştirici destek mühendisi ilanı, 118 bin $" },
    community: { name: "Geliştirici ilişkileri ve topluluk", basis: "İlanların genel medyanı, yaklaşık 215 bin $, farklı kıdem seviyeleri için aşağı çekilmiş" },
    ops: { name: "Operasyon, finans ve insan kaynakları", basis: "Satış ve operasyon uzmanı ilanı, 167 bin $; Head of People, 280 bin $" },
    exec: { name: "Üst yönetim", basis: "Bazıları için Head of Sales ilanının (363 bin $) üstünde, diğerleri için altında" },
  },
  faq: {
    title: "Sık sorulan sorular",
    /** Each answer is also the page's FAQ structured data. Amounts are filled in by the page. */
    items: {
      cost: {
        q: "RevenueCat'in fiyatı ne kadar?",
        /** {threshold} "$2,500"; {at10k} the yearly fee at $10,000 a month, {at100k} at $100,000 a month; {m10k} "$10,000", {m100k} "$100,000". */
        a: "RevenueCat'in Pro planı aylık {threshold} izlenen gelirin altında ücretsizdir. Bu eşikten sonra yalnızca {threshold} üzerindeki kısmın değil, gelirin tamamının %1'ini alır: ayda {m10k} kazanan bir uygulama için yılda {at10k}, ayda {m100k} kazanan bir uygulama için yılda {at100k}. Büyük hesaplar Enterprise fiyatı için pazarlık yapabilir.",
      },
      pays: {
        q: "RevenueCat'in %1'lik ücreti neye gidiyor?",
        /** {servers} and {fee} are yearly amounts for an app making {m25k} ("$25,000") a month; {people} is a number. */
        a: "Büyük ölçüde şirkete. Tipik bir uygulamanın arkasındaki sunucuların aylık maliyeti birkaç dolardır: ayda {m25k} kazanan bir uygulama için yılda {servers}, buna karşılık ücret olarak {fee}. Geri kalanı mühendislik, satış, pazarlama ve üst yönetim dahil yaklaşık {people} kişilik bir ekibe gider ve şirketin yatırımcıları için değer yaratır.",
      },
      owns: {
        q: "RevenueCat kimin?",
        /** {funding} "$100 million"; {investors} the list of firms, already joined; {pct} like "55%". */
        a: "RevenueCat, beş turda risk sermayesi yatırımcılarından yaklaşık {funding} topladı; aralarında {investors} var. Açıklanan tur değerlemeleri birleştirildiğinde, yatırımcıların şirketin tahminen {pct} kadarına sahip olduğu görülüyor. Geri kalanı kurucularına ve çalışanlarına ait.",
      },
      worth: {
        q: "RevenueCat'in değeri ne kadar?",
        /** {valuation} "$500 million", {round} "$50 million", {revenue} "$30 million". */
        a: "Basında çıkan haberlere göre RevenueCat, 2025'te {round} tutarındaki Series C turunu topladığında {valuation} değerindeydi; o sırada yıllık geliri yaklaşık {revenue} idi. Bunlar şirket açıklamaları değil, basın ve analist rakamlarıdır.",
      },
      alternative: {
        q: "Gelir payı almayan bir RevenueCat alternatifi var mı?",
        a: "Evet. openpurr, resmi RevenueCat Purchases SDK ile çalışan, ücretsiz, açık kaynak ve kendi sunucunuzda çalışan bir backend'dir. SDK'nın proxy URL'sini kendi sunucunuza ayarlarsınız ve satın alma kodunuz aynen kalır. Küçük uygulamalar için Cloudflare'in ücretsiz planında çalışır; gelir payı da işlem başına ücret de yoktur.",
      },
    },
  },
  more: {
    title: "Evet, daha fazlasını yapıyorlar",
    text: "RevenueCat bir satın alma backend'inden fazlasını sunuyor: paywall'lar, deneyler, entegrasyonlar, bir destek hattı. Hepsini kullanıyorsanız belki sizin için buna değer. İhtiyacınız satın almaların doğrulanması ve aboneliklerin güncel tutulmasıysa, ayda birkaç dolarlık sunucuyla dönen bir iş için bundan sonra kazanacağınız her şeyin bir payını devrediyorsunuz.",
  },
  method: {
    title: "Nasıl hesaplıyoruz",
    /** HTML. Each item starts with a bold label. */
    fee: "<b>Ücretiniz:</b> RevenueCat'in Pro planının liste fiyatı; aylık izlenen gelir {threshold} eşiğini geçtiğinde gelirin %1'i. Büyük hesaplar farklı fiyatlar için pazarlık yapabilir.",
    /** HTML. {calculator} becomes a link labelled with `calculatorLink`. */
    servers:
      "<b>Sunucular:</b> openpurr Lite'ın bu gelire sahip bir uygulama için Cloudflare'deki maliyeti; {calculator} ile aynı model. RevenueCat'in kendi barındırma maliyetleri açıklanmıyor; bu, işi kendiniz çalıştırdığınızda ödediğiniz tutar.",
    calculatorLink: "tasarruf hesaplayıcımız",
    /** HTML. {used}, {low}, {high} are headcounts; {loaded} is "1.3". */
    teams:
      "<b>Ekipler:</b> kişiler değil, iş fonksiyonları. {used} kişi varsayıyoruz (kamuya açık tahminler {low} ile {high} arasında) ve onları fonksiyonlara kendimiz dağıtıyoruz. Maaşlar, RevenueCat'in maaş bilgisi içeren herkese açık iş ilanlarından geliyor; her ekibin maliyeti vergiler, yan haklar ve ekipman için kişi × maaş × {loaded}, hisse hariç. Ücretinizin sunuculara gitmeyen kısmı bu maliyetlerle orantılı olarak bölünüyor.",
    /** HTML. {funding} "$100 million", {pct} like "55%", {revenue} "$30 million". */
    investors:
      "<b>Yatırımcılar:</b> 2018–2025 arasında beş tur, toplamda yaklaşık {funding}. Hisse dağılımı açıklanmıyor, bu yüzden açıklanan değerlemelerden hesaplıyoruz: her turun yatırımcıları, tutarın post-money değerlemeye bölümü kadar pay alır ve öncekilerin hepsi aynı oranda sulanır. Sonuç yaklaşık {pct}. Opsiyon havuzları ve Y Combinator'ın hızlandırıcı payı hesaba katılmıyor. Yatırımcıların payı şirketin maliyetlerinde bir kalem değil, şirketin değerinden bir pay; bu yüzden ayrı gösteriliyor. 2025 turunda şirketin yıllık gelirinin yaklaşık {revenue} olduğu ve başa baş noktasına yakın olduğu bildirildi.",
    colRound: "Tur",
    colRaised: "Toplanan",
    colValuation: "Değerleme",
    colLead: "Lider yatırımcı",
    notReported: "açıklanmadı",
    /** HTML. */
    affiliation: "<b>Bağlantı yok:</b> openpurr'ın RevenueCat ile bir bağlantısı yoktur. Bunlar RevenueCat'in rakamları değil, bizim tahminlerimizdir.",
    assumptions: "Varsayımlar, ekip ekip",
    colTeam: "Ekip",
    colPeople: "Kişi",
    colSalary: "Maaş",
    colCost: "Yıllık maliyet",
    colBasis: "Maaş kaynağı",
  },
  sources: {
    title: "Kaynaklar",
    /** One label per source, in this order. The links themselves are in English. */
    items: [
      "RevenueCat fiyatları: 2.500 $'dan itibaren aylık izlenen gelirin %1'i",
      "RevenueCat'in maaş aralıklarını içeren iş ilanları (Ashby)",
      "RevenueCat'in maaş bilgisi içeren eski ilanları (Greenhouse)",
      "TechCrunch: RevenueCat 50 milyon $ topladı, toplam 100 milyon $'a ulaştı (Mayıs 2025)",
      "TechCrunch: Y Combinator'ın Continuity Fund'ı liderliğinde, 300 milyon $ değerlemeyle 40 milyon $'lık Series B (2021)",
      "TechCrunch: Adjacent liderliğinde 12 milyon $'lık Series C (2024)",
      "SaaStr: 7 milyon $ değerlemeyle 2018 seed turu ve sonraki turlar",
      "Multiples.vc: 2025 turunda yaklaşık 30 milyon $ gelir ve 500 milyon $ değerleme (tahminler)",
      "Çalışan sayısı tahminleri: TipRanks (185)",
      "Çalışan sayısı tahminleri: TrueUp (130)",
    ],
    /** HTML. {date} is the date; {issue} becomes a link labelled with `issueLink`. */
    checked: "Kontrol tarihi: {date}. Güncel olmayan bir şey mi gördünüz? {issue}.",
    issueLink: "Issue açın",
  },
};
