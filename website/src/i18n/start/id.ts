// The "Add in-app purchases" page in this language (see en.ts for the notes).
import type { StartDict } from "./en";

export const startId: StartDict = {
  meta: {
    title: "Pembelian dalam aplikasi dan langganan, gratis - openpurr",
    description:
      "Aplikasi baru? Tambahkan pembelian dalam aplikasi dan langganan dengan Purchases SDK resmi dan backend open source Anda sendiri. Tanpa bagi hasil, selamanya.",
    ogImageAlt: "Membuat aplikasi baru? Mulailah tanpa bagi hasil pendapatan. Simpan 1% Anda dan investasikan ke bisnis Anda.",
  },
  hero: {
    crumb: "Tambahkan pembelian dalam aplikasi",
    eyebrow: "Untuk aplikasi baru",
    headline: "Membuat aplikasi baru?",
    headlineAccent: "Mulailah tanpa bagi hasil pendapatan.",
    /** {threshold} is "$2,500". */
    lede: "Sebagian besar backend pembelian mengambil 1% pendapatan Anda begitu melewati {threshold} per bulan, dan tagihannya ikut naik setiap kali Anda tumbuh. Paling mudah menghindarinya sebelum penjualan pertama. openpurr adalah backend gratis dan open source untuk pembelian dalam aplikasi dan langganan yang Anda jalankan sendiri, dengan SDK resmi yang sama yang dipakai platform-platform besar.",
    ctaStart: "Mulai di GitHub",
    ctaAi: "Salin prompt untuk asisten AI Anda",
  },
  growth: {
    title: "1% Anda, sejak hari pertama",
    text: "Pilih perkiraan posisi aplikasi Anda tiga tahun lagi. Inilah total bagi hasil 1% yang akan Anda bayar sampai ke sana, dengan asumsi pertumbuhan stabil dari nol.",
    target: "Pendapatan bulanan tiga tahun lagi",
    /** Labels for the totals. */
    fee: "Bagi hasil 1%, selama 3 tahun",
    servers: "Menjalankannya sendiri, selama 3 tahun",
    after: "Dan setelah itu, setiap tahun",
    /** The chart's accessible description. */
    chartLabel: "Bagi hasil pendapatan yang terus bertambah dari bulan ke bulan selama tiga tahun",
    /** HTML. {fee} and {servers} are amounts that move with the slider. */
    summary: "Itu <b>{fee}</b> yang Anda serahkan sebelum tahun keempat, dibandingkan <b>{servers}</b> untuk server Anda sendiri. Simpan uangnya, dan masukkan ke bisnis Anda.",
  },
  invest: {
    title: "Investasikan ke bisnis Anda, dan ke diri Anda",
    text: "Yang bisa dibeli 1% Anda selama setahun jika disimpan:",
  },
  how: {
    title: "Cara kerjanya",
    lede: "Empat langkah, dan kode yang Anda tulis sama seperti di tutorial RevenueCat mana pun.",
    steps: [
      {
        title: "Deploy openpurr",
        /** HTML. */
        text: "Jalankan setup di akun Cloudflare Anda. Untuk aplikasi kecil, Lite muat di <b>paket gratis</b>, dan setup aman dijalankan ulang jika berhenti di tengah jalan.",
      },
      {
        title: "Tambahkan aplikasi dan produk Anda",
        text: "Dashboard langsung dibuka pada penambahan aplikasi pertama Anda: bundle ID dan nama paketnya, lalu produk, entitlement, dan offering.",
      },
      {
        title: "Tambahkan Purchases SDK",
        /** HTML. */
        text: "Pasang Purchases SDK resmi dari RevenueCat, yang open source dengan lisensi MIT, lalu atur <b>satu URL proxy</b> sebelum Anda mengonfigurasinya.",
      },
      {
        title: "Rilis",
        text: "Pembelian divalidasi dengan Apple dan Google, perpanjangan dan refund masuk lewat notifikasi store, dan backend Anda menerima webhook. Memakai Claude Code? Plugin openpurr memandu Anda menyiapkan App Store Connect dan Play Console.",
      },
    ],
    /** Above the setup commands. */
    setupLabel: "Setup, di komputer Anda",
  },
  ai: {
    title: "Siapkan dengan asisten coding AI Anda",
    text: "Buka proyek aplikasi Anda di Claude Code, Codex, Cursor, Grok, atau agen coding lain, lalu tempel prompt ini. Prompt ini men-deploy openpurr, menghubungkan store, dan menambahkan SDK, serta bertanya dulu sebelum langkah yang perlu login Anda.",
    copy: "Salin prompt",
    copied: "Tersalin",
    claudeTip: "Pakai Claude Code? Tambahkan dulu plugin openpurr untuk panduan langkah demi langkah:",
  },
  includes: {
    title: "Yang Anda dapatkan",
    yes: [
      "Pembelian dan langganan di App Store dan Google Play",
      "Entitlement dan offering",
      "Webhook ke backend Anda, bertanda tangan dan dikirim ulang bila gagal",
      "16 grafik: pendapatan, MRR, churn, uji coba, dan lainnya",
      "Eksperimen harga",
      "Data Anda di database Anda sendiri",
    ],
    notYetTitle: "Belum tersedia",
    notYet: "Pembuat paywall, integrasi analitik pihak ketiga, event iklan, penagihan web, dan Amazon. Jika Anda membutuhkannya sejak hari pertama, platform komersial sudah menyediakannya sekarang.",
  },
  lockin: {
    title: "Tidak terkunci, ke arah mana pun",
    text: "Karena openpurr memakai Purchases SDK standar, kode pembelian Anda bekerja dengan backend mana pun. Jika aplikasi Anda tumbuh melampaui openpurr, atau Anda menginginkan fitur tambahan dari platform komersial, beralih cukup dengan mengubah konfigurasi dan mengimpor pelanggan, bukan menulis ulang kode.",
  },
  pricingLink: {
    text: "Penasaran ke mana 1% itu pergi saat Anda membayarnya?",
    link: "Lihat rincian harga RevenueCat →",
  },
  faq: {
    title: "Pertanyaan yang sering diajukan",
    /** Each answer is also the page's FAQ structured data. */
    items: {
      backend: {
        q: "Apakah saya butuh backend untuk pembelian dalam aplikasi?",
        a: "Tidak wajib: StoreKit dan Google Play Billing berjalan di perangkat. Tetapi backend menjaga langganan tetap akurat. Backend memvalidasi pembelian dengan Apple dan Google, mengikuti perpanjangan, pembatalan, dan refund melalui notifikasi store, serta memberi tahu aplikasi dan server Anda siapa yang punya akses. openpurr adalah backend tersebut, dan Anda menjalankannya sendiri.",
      },
      cheapest: {
        q: "Apa cara termurah menambahkan langganan ke aplikasi iOS atau Android?",
        /** {servers} a yearly amount, {m25k} "$25,000". */
        a: "Jalankan backend sendiri. Untuk aplikasi kecil, openpurr Lite muat di paket gratis Cloudflare dan bekerja dengan Purchases SDK yang gratis dan open source, jadi yang Anda bayar hanya server: sekitar {servers} per tahun untuk aplikasi berpendapatan {m25k} per bulan menurut model kami, tanpa bagi hasil pendapatan.",
      },
      free: {
        q: "Apakah openpurr benar-benar gratis?",
        a: "Ya. Kodenya open source dengan lisensi Apache 2.0, tanpa bagi hasil pendapatan dan tanpa biaya per transaksi. Anda membayar server Anda sendiri, dan aplikasi kecil muat di paket gratis Cloudflare.",
      },
      switch: {
        q: "Bisakah saya pindah ke RevenueCat nanti?",
        a: "Bisa. openpurr memakai Purchases SDK resmi dari RevenueCat, jadi kode pembelian aplikasi Anda bekerja dengan backend mana pun dan produk Anda di store tetap sama. Beralih cukup dengan mengubah konfigurasi dan memindahkan data pelanggan Anda.",
      },
      missing: {
        q: "Apa yang belum bisa dilakukan openpurr?",
        a: "Pembuat paywall, integrasi analitik pihak ketiga, event iklan, penagihan web, dan Amazon. Eksperimen harga sudah tersedia. Jika Anda membutuhkan sisanya sejak hari pertama, platform komersial sudah menyediakannya sekarang.",
      },
    },
  },
};
