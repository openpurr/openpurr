// The "RevenueCat's CEO on X" page in this language (see en.ts for the notes).
import type { CeoDict } from "./en";

export const ceoVi: CeoDict = {
  meta: {
    title: "CEO RevenueCat Jacob Eiting: {perDay} bài mỗi ngày trên X",
    description:
      "CEO RevenueCat Jacob Eiting đăng {posts} bài trên X trong 90 ngày, trong {hours} khung giờ khác nhau mỗi ngày. Khoảng {pct} nhắc đến RevenueCat. 1% của bạn góp phần trả cho việc đó.",
    ogImageAlt: "CEO RevenueCat đăng bài trên X khoảng 10 lần mỗi ngày, ngày nào cũng vậy. 1% của bạn góp phần trả cho việc đó.",
  },
  hero: {
    crumb: "CEO trên X",
    eyebrow: "1% của bạn đi đâu",
    headline: "CEO RevenueCat, Jacob Eiting, đăng bài trên X {perDay} lần mỗi ngày.",
    headlineAccent: "1% của bạn góp phần trả cho việc đó.",
    lede: "Trong {days} ngày qua, CEO của RevenueCat, Jacob Eiting ({handle}), đã đăng {posts} bài trên X. Tức khoảng {perDay} bài mỗi ngày, rải trong {hours} khung giờ khác nhau mỗi ngày, vào {active} trên {days} ngày.",
    updated: "Cập nhật {date} - Đếm từ các bài đăng công khai",
  },
  stats: {
    posts: "bài đăng trong {days} ngày",
    perDay: "bài đăng mỗi ngày",
    hours: "giờ hoạt động mỗi ngày",
    active: "ngày có bài đăng, trên {days}",
  },
  calendar: {
    title: "{days} ngày đăng bài",
    note: "Mỗi ô là một ngày. Ô càng đậm, ngày đó càng có nhiều khung giờ có bài đăng.",
    less: "Không có bài",
    more: "Nhiều giờ hơn",
    cell: "{date}: {posts} bài trong {hours} giờ",
  },
  topic: {
    title: "Bao nhiêu trong số đó nói về RevenueCat?",
    text: "Theo các quy tắc bên dưới, <b>{pct}</b> bài đăng của ông ấy nhắc đến RevenueCat hoặc việc kinh doanh của công ty: {onTopic} trên {posts}. Cũng các quy tắc đó chỉ tìm thấy {basePct} trong chính các bài của {base}, nên chúng bỏ sót một phần. Dù vậy, phần lớn những gì ông ấy đăng là về chuyện khác.",
    ceo: "Bài của ông ấy",
    base: "Bài của {base}",
    about: "Về RevenueCat",
  },
  pays: {
    title: "1% của bạn cũng trả cho mạng xã hội của ông ấy",
    text: "RevenueCat lấy 1% trên toàn bộ doanh thu của bạn khi vượt {threshold} mỗi tháng. Số tiền đó vận hành công ty, kể cả khoản trả cho CEO. Vậy một phần 1% của bạn đang trả cho {perDay} bài đăng mỗi ngày trên X.",
    link: "Xem phần còn lại trong 1% của bạn đi đâu →",
    ctaKeep: "Giữ lại 1% của bạn →",
    ctaGithub: "openpurr trên GitHub",
  },
  faq: {
    title: "Những câu hỏi thường gặp",
    items: {
      who: {
        q: "CEO của RevenueCat là ai?",
        a: "Jacob Eiting là đồng sáng lập kiêm CEO của RevenueCat. Ông ấy đăng bài trên X với tên {handle}, nơi có khoảng {followers} người theo dõi.",
      },
      often: {
        q: "CEO RevenueCat đăng bài trên X thường xuyên đến mức nào?",
        a: "Trong {days} ngày tính đến {end}, Jacob Eiting đã đăng {posts} bài trên X, tính cả trả lời nhưng không tính repost. Tức khoảng {perDay} bài mỗi ngày, trong {hours} khung giờ khác nhau mỗi ngày, vào {active} trên {days} ngày.",
      },
      about: {
        q: "CEO RevenueCat đăng gì trên X?",
        a: "Phần lớn là những chuyện khác ngoài RevenueCat. Theo các quy tắc từ khóa của chúng tôi, {pct} bài đăng của ông ấy nhắc đến RevenueCat hoặc việc kinh doanh của công ty, so với {basePct} trong chính các bài của {base}. Các quy tắc bỏ sót một số bài, nên hãy xem {pct} là mức tối thiểu.",
      },
      pays: {
        q: "Phí 1% của RevenueCat có trả cho CEO không?",
        a: "Một phần. RevenueCat lấy 1% trên toàn bộ doanh thu của bạn khi vượt {threshold} mỗi tháng, và số tiền đó vận hành công ty, kể cả khoản trả cho ban lãnh đạo. RevenueCat không công bố mức trả cho các giám đốc điều hành của mình.",
      },
    },
  },
  method: {
    title: "Cách chúng tôi đếm",
    posts: "<b>Bài đăng:</b> mọi bài đăng và trả lời công khai của {handle} từ {start} đến {end}, đọc từ API của X vào {checked}. Không tính repost, và bài đã xóa thì không thể đếm.",
    hours: "<b>Giờ hoạt động:</b> các khung giờ đồng hồ (9–10 giờ, 10–11 giờ…) có ít nhất một bài đăng. Bài đăng lúc 9:05, 9:40 và 14:10 tính là 2 giờ hoạt động. Đây là số giờ có bài đăng, không phải thời gian bỏ ra. Một ngày tính từ nửa đêm đến nửa đêm, theo giờ UTC.",
    rules: "<b>Về RevenueCat:</b> bài đăng nhắc đến {accounts}, có liên kết tới {sites}, hoặc dùng một trong các từ sau: {terms}.",
    limits: "<b>Những gì số liệu này không nói:</b> đăng bài có thể là một phần công việc của CEO, và các con số này không cho thấy khi nào ông ấy làm việc. Chúng cho thấy ông ấy đăng bài thường xuyên đến đâu, và về chủ đề gì.",
    data: "<b>Dữ liệu:</b> chúng tôi chỉ lưu số đếm, không lưu nội dung bài đăng. Script dùng để đếm nằm {script}.",
    scriptLink: "trong repository của chúng tôi",
    affiliation: "<b>Không liên kết:</b> openpurr không liên kết với RevenueCat.",
  },
};
