// The "RevenueCat's CEO on X" page in this language (see en.ts for the notes).
import type { CeoDict } from "./en";

export const ceoId: CeoDict = {
  meta: {
    title: "CEO RevenueCat posting di X {perDay} kali sehari - openpurr",
    description:
      "Dalam 90 hari, CEO RevenueCat memposting {posts} kali di X, di {hours} jam berbeda per hari. Sekitar {pct} menyebut RevenueCat. 1% Anda ikut membayar waktunya di X.",
    ogImageAlt: "CEO RevenueCat posting di X sekitar 10 kali sehari, setiap hari. 1% Anda ikut membayarnya.",
  },
  hero: {
    crumb: "CEO di X",
    eyebrow: "Ke mana 1% Anda pergi",
    headline: "CEO RevenueCat posting di X {perDay} kali sehari.",
    headlineAccent: "1% Anda ikut membayarnya.",
    lede: "Dalam {days} hari terakhir, CEO RevenueCat, Jacob Eiting ({handle}), memposting {posts} kali di X. Itu sekitar {perDay} postingan sehari, tersebar di {hours} jam berbeda per hari, pada {active} dari {days} hari.",
    updated: "Diperbarui {date} - Dihitung dari postingan publik",
  },
  stats: {
    posts: "postingan dalam {days} hari",
    perDay: "postingan per hari",
    hours: "jam aktif per hari",
    active: "hari dengan postingan, dari {days}",
  },
  calendar: {
    title: "{days} hari posting",
    note: "Setiap kotak adalah satu hari. Makin gelap, makin banyak jam di hari itu yang ada postingannya.",
    less: "Tanpa postingan",
    more: "Lebih banyak jam",
    cell: "{date}: {posts} postingan dalam {hours} jam",
  },
  topic: {
    title: "Seberapa banyak yang membahas RevenueCat?",
    text: "Menurut aturan di bawah, <b>{pct}</b> postingannya menyebut RevenueCat atau bisnisnya: {onTopic} dari {posts}. Aturan yang sama hanya menemukan {basePct} pada postingan akun {base} sendiri, jadi sebagian terlewat. Meski begitu, sebagian besar postingannya membahas hal lain.",
    ceo: "Postingannya",
    base: "Postingan {base}",
    about: "Tentang RevenueCat",
  },
  pays: {
    title: "1% Anda juga membayar media sosialnya",
    text: "RevenueCat mengambil 1% dari seluruh pendapatan Anda begitu melewati {threshold} per bulan. Uang itu menjalankan perusahaan, termasuk gaji CEO-nya. Jadi sebagian 1% Anda membayar {perDay} postingan sehari di X.",
    link: "Lihat ke mana sisa 1% Anda pergi →",
    ctaKeep: "Simpan 1% Anda →",
    ctaGithub: "openpurr di GitHub",
  },
  method: {
    title: "Cara kami menghitung",
    posts: "<b>Postingan:</b> semua postingan dan balasan publik dari {handle} dari {start} hingga {end}, dibaca dari API X pada {checked}. Repost tidak dihitung, dan postingan yang dihapus tidak bisa dihitung.",
    hours: "<b>Jam aktif:</b> jam menurut jam dinding (pukul 9–10, 10–11, dan seterusnya) yang memiliki setidaknya satu postingan. Postingan pukul 9.05, 9.40, dan 14.10 berarti 2 jam aktif. Yang dihitung adalah jam yang ada postingannya, bukan waktu yang dihabiskan. Satu hari dihitung dari tengah malam ke tengah malam, UTC.",
    rules: "<b>Tentang RevenueCat:</b> postingan yang menyebut {accounts}, menautkan ke {sites}, atau memakai salah satu istilah ini: {terms}.",
    limits: "<b>Yang tidak ditunjukkan angka ini:</b> posting bisa jadi bagian dari pekerjaan seorang CEO, dan angka ini tidak menunjukkan kapan ia bekerja. Angka ini menunjukkan seberapa sering ia posting, dan tentang apa.",
    data: "<b>Data:</b> kami hanya menyimpan jumlah, tanpa teks postingan. Skrip yang menghitungnya ada {script}.",
    scriptLink: "di repositori kami",
    affiliation: "<b>Tidak berafiliasi:</b> openpurr tidak berafiliasi dengan RevenueCat.",
  },
};
