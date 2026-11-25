// The "Add in-app purchases" page in this language (see en.ts for the notes).
import type { StartDict } from "./en";

export const startVi: StartDict = {
  meta: {
    title: "Mua hàng trong ứng dụng và gói đăng ký, miễn phí - openpurr",
    description:
      "Làm ứng dụng mới? Thêm mua hàng trong ứng dụng và gói đăng ký bằng Purchases SDK chính thức và backend mã nguồn mở bạn tự chạy. Không bao giờ chia doanh thu.",
    ogImageAlt: "Làm ứng dụng mới? Hãy bắt đầu mà không chia doanh thu. Giữ lại 1% của bạn và đầu tư vào việc kinh doanh.",
  },
  hero: {
    crumb: "Thêm mua hàng trong ứng dụng",
    eyebrow: "Cho ứng dụng mới",
    headline: "Đang làm ứng dụng mới?",
    headlineAccent: "Bắt đầu mà không chia doanh thu.",
    /** {threshold} is "$2,500". */
    lede: "Phần lớn backend mua hàng lấy 1% doanh thu của bạn khi vượt {threshold} mỗi tháng, và hóa đơn tăng theo mỗi bước bạn lớn lên. Dễ tránh nhất là trước lần bán đầu tiên. openpurr là backend miễn phí, mã nguồn mở cho mua hàng trong ứng dụng và gói đăng ký mà bạn tự chạy, dùng cùng SDK chính thức mà các nền tảng lớn đang dùng.",
    ctaStart: "Bắt đầu trên GitHub",
    ctaAi: "Sao chép prompt cho trợ lý AI của bạn",
  },
  growth: {
    title: "1% của bạn, ngay từ ngày đầu",
    text: "Chọn mức bạn kỳ vọng ứng dụng đạt được sau ba năm. Đây là tổng số tiền mà phí chia doanh thu 1% cộng dồn trên chặng đường đó, giả sử tăng trưởng đều từ con số không.",
    target: "Doanh thu hằng tháng sau ba năm",
    /** Labels for the totals. */
    fee: "Chia doanh thu 1%, trong 3 năm",
    servers: "Tự chạy, trong 3 năm",
    after: "Và sau đó, mỗi năm",
    /** The chart's accessible description. */
    chartLabel: "Phí chia doanh thu cộng dồn qua từng tháng trong ba năm",
    /** HTML. {fee} and {servers} are amounts that move with the slider. */
    summary: "Đó là <b>{fee}</b> bạn sẽ phải giao đi trước năm thứ tư, so với <b>{servers}</b> cho server của chính bạn. Hãy giữ lại và đầu tư vào việc kinh doanh.",
  },
  invest: {
    title: "Đầu tư vào việc kinh doanh, và vào chính bạn",
    text: "Một năm 1% giữ lại mua được gì cho bạn:",
  },
  how: {
    title: "Cách hoạt động",
    lede: "Bốn bước, và code bạn viết giống hệt trong bất kỳ hướng dẫn RevenueCat nào.",
    steps: [
      {
        title: "Triển khai openpurr",
        /** HTML. */
        text: "Chạy setup trên tài khoản Cloudflare của bạn. Với ứng dụng nhỏ, Lite vừa với <b>gói miễn phí</b>, và có thể chạy lại setup an toàn nếu nó dừng giữa chừng.",
      },
      {
        title: "Thêm ứng dụng và sản phẩm",
        text: "Dashboard mở ra ngay ở bước thêm ứng dụng đầu tiên: bundle ID và package name, rồi đến sản phẩm, entitlement và offering.",
      },
      {
        title: "Thêm Purchases SDK",
        /** HTML. */
        text: "Cài Purchases SDK chính thức của RevenueCat, vốn là mã nguồn mở theo giấy phép MIT, và đặt <b>một proxy URL</b> trước khi cấu hình nó.",
      },
      {
        title: "Phát hành",
        text: "Giao dịch mua được xác thực với Apple và Google, gia hạn và hoàn tiền đến qua thông báo của store, và backend của bạn nhận webhook. Đang dùng Claude Code? Plugin openpurr hướng dẫn bạn thiết lập App Store Connect và Play Console.",
      },
    ],
    /** Above the setup commands. */
    setupLabel: "Setup, trên máy của bạn",
  },
  ai: {
    title: "Thiết lập bằng trợ lý lập trình AI",
    text: "Mở dự án ứng dụng của bạn trong Claude Code, Codex, Cursor, Grok hoặc bất kỳ agent lập trình nào và dán prompt này. Nó triển khai openpurr, kết nối các store và thêm SDK, đồng thời hỏi bạn trước mọi bước cần bạn đăng nhập.",
    copy: "Sao chép prompt",
    copied: "Đã sao chép",
    claudeTip: "Dùng Claude Code? Hãy thêm plugin openpurr trước để được hướng dẫn từng bước:",
  },
  includes: {
    title: "Bạn nhận được gì",
    yes: [
      "Mua hàng và gói đăng ký trên App Store và Google Play",
      "Entitlement và offering",
      "Webhook tới backend của bạn, có chữ ký và tự gửi lại",
      "16 biểu đồ: doanh thu, MRR, churn, dùng thử và hơn thế",
      "Thử nghiệm giá",
      "Dữ liệu nằm trong database của chính bạn",
    ],
    notYetTitle: "Chưa có",
    notYet: "Trình tạo paywall, tích hợp phân tích bên thứ ba, sự kiện quảng cáo, thanh toán trên web và Amazon. Nếu bạn cần những thứ đó ngay từ ngày đầu, các nền tảng thương mại đã có sẵn.",
  },
  lockin: {
    title: "Không bị khóa chặt, theo cả hai chiều",
    text: "Vì openpurr dùng Purchases SDK tiêu chuẩn, code mua hàng của bạn chạy được với cả hai backend. Nếu ứng dụng vượt khỏi openpurr, hoặc bạn muốn những gì các nền tảng thương mại bổ sung, việc chuyển đổi chỉ là thay cấu hình và import khách hàng, không phải viết lại.",
  },
  pricingLink: {
    text: "Tò mò 1% đó đi đâu khi bạn phải trả?",
    link: "Xem chi tiết giá của RevenueCat →",
  },
  faq: {
    title: "Những câu hỏi thường gặp",
    /** Each answer is also the page's FAQ structured data. */
    items: {
      backend: {
        q: "Tôi có cần backend cho mua hàng trong ứng dụng không?",
        a: "Không bắt buộc: StoreKit và Google Play Billing chạy trên thiết bị. Nhưng backend giúp gói đăng ký luôn chính xác. Nó xác thực giao dịch mua với Apple và Google, theo dõi gia hạn, hủy và hoàn tiền qua thông báo của store, và cho ứng dụng cùng server của bạn biết ai có quyền truy cập. openpurr chính là backend đó, và bạn tự chạy nó.",
      },
      cheapest: {
        q: "Cách rẻ nhất để thêm gói đăng ký vào ứng dụng iOS hoặc Android là gì?",
        /** {servers} a yearly amount, {m25k} "$25,000". */
        a: "Tự chạy backend. Với ứng dụng nhỏ, openpurr Lite vừa với gói miễn phí của Cloudflare và hoạt động với Purchases SDK miễn phí, mã nguồn mở, nên thứ bạn trả chỉ là server: khoảng {servers} mỗi năm cho ứng dụng có doanh thu {m25k} mỗi tháng theo mô hình của chúng tôi, không chia doanh thu.",
      },
      free: {
        q: "openpurr có thật sự miễn phí không?",
        a: "Có. Nó là mã nguồn mở theo giấy phép Apache 2.0, không chia doanh thu và không có phí trên mỗi giao dịch. Bạn trả tiền cho server của chính mình, và ứng dụng nhỏ vừa với gói miễn phí của Cloudflare.",
      },
      switch: {
        q: "Sau này tôi có thể chuyển sang RevenueCat không?",
        a: "Có. openpurr dùng Purchases SDK chính thức của RevenueCat, nên code mua hàng trong ứng dụng của bạn chạy được với cả hai backend và sản phẩm trên các store vẫn giữ nguyên. Chuyển đổi chỉ là thay cấu hình và chuyển dữ liệu khách hàng.",
      },
      missing: {
        q: "openpurr chưa làm được gì?",
        a: "Trình tạo paywall, tích hợp phân tích bên thứ ba, sự kiện quảng cáo, thanh toán trên web và Amazon. Thử nghiệm giá đã có sẵn. Nếu bạn cần phần còn lại ngay từ ngày đầu, các nền tảng thương mại đã có sẵn.",
      },
    },
  },
};
