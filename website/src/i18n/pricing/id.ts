// The RevenueCat pricing page in this language (see en.ts for the notes).
import type { PricingDict } from "./en";

export const pricingId: PricingDict = {
  meta: {
    title: "Harga RevenueCat: ke mana sebenarnya 1% Anda - openpurr",
    description:
      "RevenueCat memotong 1% pendapatan Anda. Server di balik aplikasi Anda nyaris tanpa biaya. Lihat untuk apa sisanya: gaji, tim sales, dan investor ventura.",
    ogImageAlt: "RevenueCat mengambil 1% pendapatan Anda; servernya nyaris tanpa biaya. Untuk apa sisanya.",
  },
  hero: {
    crumb: "Harga RevenueCat",
    eyebrow: "Ke mana 1% Anda pergi",
    headline: "Anda tidak membayar server.",
    /** The headline's second, highlighted sentence. {valuation} is "$500 million". */
    headlineAccent: "Anda membayar perusahaan senilai {valuation}.",
    /** {threshold} is "$2,500". */
    lede: "RevenueCat mengambil 1% dari seluruh pendapatan terlacak Anda begitu melewati {threshold} per bulan, dan tagihannya ikut naik setiap kali Anda tumbuh. Server di balik aplikasi Anda nyaris tanpa biaya. Sisanya membiayai perusahaannya: gaji karyawan, tim sales, dan imbal hasil investornya.",
    updated: "Diperbarui {date} - Perkiraan dari data publik",
  },
  answer: {
    title: "Harga RevenueCat dalam satu kalimat",
    /** HTML. {threshold} is "$2,500". */
    text: "Gratis di bawah {threshold} pendapatan terlacak per bulan, lalu <strong>1% dari seluruhnya</strong>. Segini jumlahnya dalam setahun, dibandingkan biaya server untuk aplikasi yang sama:",
    colRevenue: "Pendapatan bulanan",
    colFee: "RevenueCat, per tahun",
    colServers: "Server, per tahun",
  },
  calc: {
    revenue: "Pendapatan bulanan aplikasi Anda",
    fee: "RevenueCat mengambil",
    servers: "Biaya server sebenarnya",
    perYear: "per tahun",
    stackLabel: "Biaya tahunan Anda, dibagi antara server dan tim-tim RevenueCat",
    /** HTML. {servers} and {rest} are percentages. */
    stackNote: "Server: {servers}. Selebihnya, {rest}, membiayai tim mereka:",
    /** {people} is a number, {salary} is like "$210K". */
    teamMeta: "Sekitar {people} orang - gaji umum {salary}",
    swag: "Juga masuk tagihan: skateboard RevenueCat yang menyala untuk tim. 1% Anda juga membayar itu.",
    swagPostAlt: "Postingan karyawan RevenueCat di X: “Skateboard RevenueCat saya tiba kemarin! Ini tautan untuk mendapatkan skateboard RevenueCat gratis milikmu sendiri,” yang mengarah ke halaman lowongan RevenueCat",
    swagPhotoAlt: "Skateboard RevenueCat yang menyala",
    swagCaption: "Diposting di X, {date}. Tautan “dapatkan milikmu” mengarah ke halaman lowongan mereka. {link}",
    swagLink: "Lihat postingan",
    ownersTitle: "1% Anda membangun exit orang lain",
    /** {pct} is like "55%". */
    ownersInvestors: "Investor ventura - sekitar {pct}",
    ownersRest: "Pendiri dan karyawan",
    ownersBarLabel: "Investor ventura memiliki sekitar {pct} RevenueCat, menurut perkiraan kami",
    /** HTML. {funding} is "$100 million"; {vc} is an amount that moves with the slider. */
    ownersText:
      "Investor ventura telah menanamkan sekitar {funding} ke RevenueCat dalam lima putaran, dan menurut valuasi yang dilaporkan mereka memiliki lebih dari separuhnya. Mereka tidak perlu potongan dari setiap pembayaran. Setiap biaya yang Anda bayar menaikkan nilai perusahaan milik mereka, dan mereka panen saat perusahaan itu dijual. Dari sisi kepemilikan, sekitar {vc} dari yang Anda bayar setiap tahun sedang membangun keuntungan mereka.",
    investorsLabel: "Investor RevenueCat",
    /** HTML. {days} is a number, {infra} an amount; both move with the slider. */
    punch: "1% Anda membeli sekitar {days} hari kerja engineer per tahun di RevenueCat. Menjalankan pekerjaan yang sama sendiri cukup {infra}.",
    /** HTML. {keep} is an amount that moves with the slider. */
    keep: "Simpan {keep} sisanya.",
    ctaKeep: "Simpan 1% Anda →",
    ctaGithub: "openpurr di GitHub",
  },
  teams: {
    eng: { name: "Engineering", basis: "Lowongan senior SDK engineer, $212K" },
    product: { name: "Produk, desain, dan data", basis: "Lowongan senior product manager, $230K; senior data scientist, $220K" },
    sales: { name: "Sales", basis: "Lowongan Head of Sales, $363K; senior sales engineer, $200K; product expert, $133K" },
    growth: { name: "Marketing dan growth", basis: "Lowongan Head of Customer Growth, $259K; desainer CRO, $205K; product marketing, $168K" },
    support: { name: "Customer success dan dukungan", basis: "Lowongan developer support engineer, $118K" },
    community: { name: "Developer relations dan komunitas", basis: "Median keseluruhan lowongan, sekitar $215K, didiskon karena campuran level" },
    ops: { name: "Operasional, keuangan, dan SDM", basis: "Lowongan sales and operations specialist, $167K; Head of People, $280K" },
    exec: { name: "Eksekutif", basis: "Di atas lowongan Head of Sales ($363K) untuk sebagian, di bawahnya untuk yang lain" },
  },
  faq: {
    title: "Pertanyaan yang sering diajukan",
    /** Each answer is also the page's FAQ structured data. Amounts are filled in by the page. */
    items: {
      cost: {
        q: "Berapa biaya RevenueCat?",
        /** {threshold} "$2,500"; {at10k} the yearly fee at $10,000 a month, {at100k} at $100,000 a month; {m10k} "$10,000", {m100k} "$100,000". */
        a: "Paket Pro RevenueCat gratis di bawah {threshold} pendapatan terlacak per bulan. Setelah itu biayanya 1% dari seluruhnya, bukan hanya bagian di atas {threshold}: {at10k} per tahun untuk aplikasi berpendapatan {m10k} per bulan, {at100k} per tahun pada {m100k} per bulan. Akun besar bisa menegosiasikan harga Enterprise.",
      },
      pays: {
        q: "Untuk apa biaya 1% RevenueCat?",
        /** {servers} and {fee} are yearly amounts for an app making {m25k} ("$25,000") a month; {people} is a number. */
        a: "Sebagian besar untuk perusahaannya. Server di balik aplikasi biasa hanya butuh beberapa dolar per bulan: {servers} per tahun untuk aplikasi berpendapatan {m25k} per bulan, dibandingkan {fee} biaya RevenueCat. Sisanya membiayai tim sekitar {people} orang, termasuk engineering, sales, marketing, dan eksekutif, serta membangun nilai bagi investor perusahaan.",
      },
      owns: {
        q: "Siapa pemilik RevenueCat?",
        /** {funding} "$100 million"; {investors} the list of firms, already joined; {pct} like "55%". */
        a: "RevenueCat telah menghimpun sekitar {funding} dari investor ventura dalam lima putaran, termasuk {investors}. Dengan menggabungkan valuasi tiap putaran yang dilaporkan, investor diperkirakan memiliki sekitar {pct} perusahaan. Sisanya milik para pendiri dan karyawannya.",
      },
      worth: {
        q: "Berapa nilai RevenueCat?",
        /** {valuation} "$500 million", {round} "$50 million", {revenue} "$30 million". */
        a: "RevenueCat dilaporkan bervaluasi {valuation} saat menghimpun Series C senilai {round} pada 2025, dengan pendapatan tahunan sekitar {revenue} saat itu. Ini angka dari media dan analis, bukan pengungkapan resmi perusahaan.",
      },
      alternative: {
        q: "Adakah alternatif RevenueCat tanpa bagi hasil pendapatan?",
        a: "Ada. openpurr adalah backend gratis, open source, dan di-host sendiri yang bekerja dengan Purchases SDK resmi dari RevenueCat. Anda mengatur URL proxy SDK ke server Anda sendiri dan tetap memakai kode pembelian yang sama. Untuk aplikasi kecil, openpurr berjalan di paket gratis Cloudflare, tanpa bagi hasil pendapatan dan tanpa biaya per transaksi.",
      },
    },
  },
  more: {
    title: "Ya, mereka menawarkan lebih banyak",
    text: "RevenueCat membangun lebih dari sekadar backend pembelian: paywall, eksperimen, integrasi, layanan dukungan. Kalau Anda memakai semuanya, mungkin itu sepadan bagi Anda. Kalau yang Anda butuhkan hanya validasi pembelian dan status langganan yang selalu terkini, Anda menyerahkan sebagian dari semua yang akan Anda hasilkan untuk pekerjaan yang cukup dijalankan dengan server beberapa dolar per bulan.",
  },
  method: {
    title: "Cara kami memperkirakannya",
    /** HTML. Each item starts with a bold label. */
    fee: "<b>Biaya Anda:</b> harga daftar paket Pro RevenueCat, 1% dari pendapatan bulanan terlacak mulai {threshold}. Akun besar bisa menegosiasikan harga lain.",
    /** HTML. {calculator} becomes a link labelled with `calculatorLink`. */
    servers:
      "<b>Server:</b> biaya openpurr Lite di Cloudflare untuk aplikasi dengan pendapatan tersebut, dengan model yang sama seperti {calculator} kami. Biaya hosting RevenueCat sendiri tidak dipublikasikan; ini biaya pekerjaan tersebut jika Anda menjalankannya sendiri.",
    calculatorLink: "kalkulator penghematan",
    /** HTML. {used}, {low}, {high} are headcounts; {loaded} is "1.3". */
    teams:
      "<b>Tim:</b> fungsi pekerjaan, bukan orang. Kami mengasumsikan {used} orang (perkiraan publik berkisar dari {low} hingga {high}) dan membaginya ke berbagai fungsi sendiri. Gaji diambil dari lowongan kerja publik RevenueCat yang mencantumkan gaji; biaya tiap tim adalah jumlah orang × gaji × {loaded} untuk pajak, tunjangan, dan peralatan, tanpa ekuitas. Bagian biaya Anda yang bukan untuk server dibagi sesuai proporsi biaya tersebut.",
    split:
      "<b>Mengapa penjualan dan pertumbuhan melebihi engineering:</b> pada {date}, papan lowongan RevenueCat mencantumkan {open} posisi terbuka: {gtm} di penjualan, pemasaran, dan pertumbuhan, serta {eng} di core engineering. Perusahaan di tahap ini sedang membangun go-to-market, dan lowongan Head of Sales barunya adalah yang bergaji tertinggi di papan tersebut.",
    /** HTML. {funding} "$100 million", {pct} like "55%", {revenue} "$30 million". */
    investors:
      "<b>Investor:</b> lima putaran dari 2018 hingga 2025, total sekitar {funding}. Kepemilikan tidak dipublikasikan, jadi kami menghitungnya bertahap dari valuasi yang dilaporkan: investor tiap putaran mendapat jumlah investasi dibagi valuasi post-money, dan semua pemegang saham sebelumnya terdilusi dengan porsi yang sama. Hasilnya sekitar {pct}. Option pool dan saham akselerator Y Combinator tidak dihitung. Porsi mereka adalah bagian dari nilai perusahaan, bukan pos dalam biayanya, karena itu ditampilkan terpisah. Pada putaran 2025, perusahaan dilaporkan berpendapatan tahunan sekitar {revenue}, mendekati titik impas.",
    colRound: "Putaran",
    colRaised: "Dana",
    colValuation: "Valuasi",
    colLead: "Dipimpin oleh",
    notReported: "tidak dilaporkan",
    /** HTML. */
    affiliation: "<b>Tidak berafiliasi:</b> openpurr tidak berafiliasi dengan RevenueCat. Ini perkiraan kami, bukan angka dari RevenueCat.",
    assumptions: "Asumsi, tim demi tim",
    colTeam: "Tim",
    colPeople: "Orang",
    colSalary: "Gaji",
    colCost: "Biaya tahunan",
    colBasis: "Sumber gaji",
  },
  sources: {
    title: "Sumber",
    /** One label per source, in this order. The links themselves are in English. */
    items: [
      "Harga RevenueCat: 1% dari pendapatan bulanan terlacak mulai $2.500",
      "Papan lowongan RevenueCat, dengan rentang gaji (Ashby)",
      "Lowongan RevenueCat sebelumnya dengan gaji (Greenhouse)",
      "TechCrunch: RevenueCat menghimpun $50 juta, totalnya menjadi $100 juta (Mei 2025)",
      "TechCrunch: Series B $40 juta, dipimpin Continuity Fund dari Y Combinator, dengan valuasi $300 juta (2021)",
      "TechCrunch: Series C $12 juta yang dipimpin Adjacent (2024)",
      "SaaStr: putaran seed 2018 dengan valuasi $7 juta, dan putaran-putaran sesudahnya",
      "Multiples.vc: pendapatan sekitar $30 juta dan valuasi $500 juta pada putaran 2025 (perkiraan)",
      "Perkiraan jumlah karyawan: TipRanks (185)",
      "Perkiraan jumlah karyawan: TrueUp (130)",
    ],
    /** HTML. {date} is the date; {issue} becomes a link labelled with `issueLink`. */
    checked: "Diperiksa pada {date}. Ada yang sudah usang? {issue}.",
    issueLink: "Buka issue",
  },
};
