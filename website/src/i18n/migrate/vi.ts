// Vietnamese copy of the migration page. Follows en.ts; see the notes there.
import type { MigrateDict } from "./en";

export const migrateVi: MigrateDict = {
  meta: {
    title: "Hướng dẫn chuyển đổi từ RevenueCat sang openpurr từng bước",
    description:
      "Chuyển ứng dụng từ RevenueCat sang openpurr, giải pháp thay thế RevenueCat mã nguồn mở: giữ nguyên Purchases SDK, import mọi khách hàng và giữ quyền truy cập.",
    ogImageAlt:
      "Chuyển từ RevenueCat sang openpurr mà không mất một khách hàng nào: giữ nguyên Purchases SDK, import mọi khách hàng, các phiên bản ứng dụng cũ vẫn hoạt động.",
  },
  hero: {
    crumb: "Chuyển đổi từ RevenueCat",
    eyebrow: "Hướng dẫn chuyển đổi",
    headline: "Chuyển từ RevenueCat sang openpurr mà không mất một khách hàng nào",
    lede: "Giữ nguyên Purchases SDK mà ứng dụng của bạn đang dùng. Import khách hàng hiện có từ bản xuất dữ liệu của RevenueCat: openpurr tự lấy từng giao dịch mua từ Apple và Google. Các phiên bản ứng dụng cũ vẫn hoạt động trong lúc mọi người cập nhật.",
    guide: "Đọc hướng dẫn từng bước (tiếng Anh)",
    steps: "Xem các bước",
    updated: "Cập nhật {date}",
  },
  summary: {
    title: "Tóm tắt",
    items: [
      "openpurr là giải pháp thay thế RevenueCat mã nguồn mở, tự host. Nó hoạt động với Purchases SDK chính thức của RevenueCat, không chỉnh sửa.",
      "Ứng dụng của bạn chỉ thêm một dòng (proxy URL của SDK) và một lệnh gọi <code>syncPurchases</code> một lần. Phần code mua hàng còn lại giữ nguyên.",
      "<code>openpurr import</code> chuyển khách hàng hiện có từ bản xuất dữ liệu của RevenueCat sang. Bản thân các giao dịch mua được lấy từ Apple và Google, không phải sao chép.",
      "Ứng dụng trên App Store có thể dùng Scheduled Data Export của RevenueCat. Google Play cần bản xuất dữ liệu để chuyển đổi từ RevenueCat Support, bản duy nhất có purchase token.",
      "Cả hai backend đều được cập nhật cho đến khi phần lớn người dùng đã cập nhật ứng dụng, nên không ai bị mất quyền truy cập.",
      "Trên gói miễn phí của Cloudflare, quá trình import xử lý khoảng 2.500 khách hàng mỗi ngày. Trên Workers Paid, một lần import lớn chỉ mất vài giờ.",
    ],
  },
  how: {
    eyebrow: "Cách hoạt động",
    title: "Quá trình chuyển đổi từ RevenueCat diễn ra thế nào",
    lede: "openpurr không sao chép lịch sử mua hàng ra khỏi RevenueCat. Nó chỉ cần biết ai sở hữu giao dịch mua nào, rồi hỏi các store, giống hệt như khi ứng dụng của bạn gửi một giao dịch mua.",
    ways: [
      {
        title: "Import",
        body: "Bản xuất dữ liệu của RevenueCat cho biết app user nào sở hữu giao dịch mua nào trên store. <code>openpurr import</code> hỏi Apple và Google về từng giao dịch mua và ghi lại câu trả lời của store cho người dùng đó. Mọi người được chuyển sang cùng lúc, kể cả những người không bao giờ mở lại ứng dụng.",
      },
      {
        title: "Bản cập nhật ứng dụng",
        body: "Phiên bản mới trỏ Purchases SDK tới openpurr và gửi giao dịch mua của từng khách hàng một lần bằng <code>syncPurchases</code>. Cách này bao quát cả những người bị bản xuất dữ liệu bỏ sót và những người mua sau khi bản xuất được tạo.",
      },
      {
        title: "Hai backend song song, trong một thời gian",
        body: "Các phiên bản ứng dụng cũ vẫn giao tiếp với RevenueCat cho đến khi người dùng cập nhật. RevenueCat chuyển tiếp thông báo của Apple tới openpurr, và một subscription Pub/Sub thứ hai làm điều tương tự cho Google, nên cả hai đều luôn được cập nhật.",
      },
    ],
  },
  app: {
    eyebrow: "Trong ứng dụng của bạn",
    title: "Những gì thay đổi trong ứng dụng của bạn",
    lede: "Đặt proxy URL trước khi gọi configure, và gửi giao dịch mua của từng khách hàng một lần. Hai thay đổi này cũng áp dụng cho Android, Flutter và React Native; hướng dẫn có code cho từng nền tảng.",
    codeLabel: "Ví dụ Swift: proxy URL và đồng bộ một lần",
    proxyComment: "Trước configure(): dòng duy nhất mà hầu hết ứng dụng cần thêm",
    syncComment: "Một lần mỗi lượt cài đặt: gửi giao dịch mua của khách hàng này tới openpurr",
  },
  import: {
    eyebrow: "Import",
    title: "Import khách hàng từ RevenueCat",
    lede: "CLI của openpurr đọc nguyên các cột của RevenueCat: app user ID, mã giao dịch App Store, purchase token của Google Play và các thuộc tính như <code>$email</code>.",
    codeLabel: "Terminal: import bản xuất dữ liệu của RevenueCat",
    dryRunComment: "Kiểm tra vài dòng đầu: hỏi Apple và Google, không ghi gì cả",
    importComment: "Import tất cả. Dừng bất cứ lúc nào; chạy lại để tiếp tục.",
    safeguards: [
      ["Không ai mất quyền truy cập", "Giao dịch mua mà ứng dụng đã gửi cho một khách hàng vẫn thuộc về họ; quá trình import không bao giờ chuyển nó đi."],
      ["Không có webhook trùng lặp", "Giao dịch mua được import không phải giao dịch mới, nên openpurr không gửi sự kiện nào cho chúng."],
      ["Biểu đồ trung thực", "Khách hàng được import được tính từ ngày mua đầu tiên, không bị tính là khách hàng mới vào ngày import."],
      ["Ứng dụng vẫn chạy bình thường", "Trên gói miễn phí của Cloudflare, quá trình import dừng ở mức 90% giới hạn hằng ngày và tiếp tục vào ngày hôm sau."],
      ["Dừng và tiếp tục", "Tiến độ được lưu lại. Import một dòng hai lần không thay đổi gì, nên có thể chạy lại với bản xuất dữ liệu mới hơn."],
      ["Chạy thử trước", "Chế độ dry run hỏi các store và báo cáo những gì sẽ xảy ra, mà không ghi gì cả."],
    ] as [string, string][],
  },
  steps: {
    eyebrow: "Từng bước",
    title: "Cách chuyển đổi từ RevenueCat trong bảy bước",
    lede: "Cả hai backend tiếp tục chạy cho đến khi bạn sẵn sàng chuyển hẳn, nên khách hàng dùng phiên bản ứng dụng cũ vẫn giữ quyền truy cập.",
    items: [
      {
        title: "Cài đặt openpurr",
        body: "Triển khai openpurr Lite lên tài khoản Cloudflare của bạn, cấp quyền truy cập API của App Store và Google Play, rồi tạo lại sản phẩm, entitlement và offering với cùng các identifier. Bạn thậm chí có thể giữ nguyên public SDK key của RevenueCat.",
      },
      {
        title: "Giữ cả hai backend được cập nhật",
        body: "Đặt openpurr làm Apple Server Notification Forwarding URL trong RevenueCat, và thêm push subscription của openpurr vào topic thông báo Play của bạn.",
      },
      {
        title: "Lấy bản xuất dữ liệu",
        body: "Chỉ dùng App Store: Scheduled Data Export của RevenueCat đã có đủ những gì cần thiết. Với Google Play, hãy yêu cầu RevenueCat Support cung cấp bản xuất dữ liệu để chuyển đổi, vì chỉ bản đó có purchase token. Hướng dẫn có sẵn mẫu yêu cầu để bạn sao chép.",
      },
      { title: "Import", body: "Chạy <code>openpurr import</code>, chạy thử dry run trước. Lỗi ở từng dòng riêng lẻ được ghi vào báo cáo và không làm dừng quá trình import." },
      { title: "Phát hành bản cập nhật ứng dụng", body: "Thêm proxy URL và lệnh gọi <code>syncPurchases</code> một lần. Phát hành sau khi quá trình import đã hoàn tất." },
      {
        title: "Kiểm tra",
        body: "<code>openpurr doctor</code> kiểm tra cài đặt. Tra cứu những khách hàng bạn biết, và so sánh số gói đăng ký đang hoạt động với biểu đồ của RevenueCat.",
      },
      {
        title: "Hoàn tất việc chuyển đổi",
        body: "Khi phần lớn khách hàng đã cập nhật, hãy trỏ Apple và Google thẳng tới openpurr, bật webhook của openpurr và tắt webhook của RevenueCat.",
      },
    ],
    source: "Nguồn:",
    sourceNotifications: "RevenueCat: thông báo server của Apple (tiếng Anh)",
    sourceExports: "RevenueCat: xuất dữ liệu hoặc chuyển đi (tiếng Anh)",
    more: "Mọi lệnh và cài đặt đều có trong hướng dẫn đầy đủ (tiếng Anh) →",
  },
  moves: {
    eyebrow: "Những gì được chuyển",
    title: "Những gì được chuyển từ RevenueCat, và những gì không",
    rows: [
      ["Gói đăng ký và giao dịch mua, kèm gia hạn, hoàn tiền, thời gian ân hạn và hết hạn", "Có, lấy từ Apple và Google"],
      ["Ai sở hữu giao dịch mua nào", "Có, từ bản xuất dữ liệu của RevenueCat"],
      ["App user ID, kể cả ID ẩn danh", "Có, giữ nguyên"],
      ["Thuộc tính khách hàng ($email, $displayName và thuộc tính của riêng bạn)", "Có, từ Audience export"],
      ["Sản phẩm, entitlement và offering", "Bạn tạo lại, với cùng các identifier"],
      ["Lịch sử biểu đồ trước khi chuyển đổi", "Một phần: hãy lưu các file CSV biểu đồ của RevenueCat để tham khảo"],
      ["Thử nghiệm", "Bạn tạo lại: openpurr chạy thử nghiệm giá trên các offering của bạn"],
      ["Paywall, tích hợp, Customer Center", "Không: openpurr không có các tính năng này"],
    ] as [string, string][],
  },
  faq: {
    eyebrow: "Hỏi đáp",
    title: "Hỏi đáp về chuyển đổi từ RevenueCat",
    items: [
      {
        q: "Tôi có phải sửa code mua hàng không?",
        a: "Không. openpurr hoạt động với Purchases SDK chính thức của RevenueCat, không chỉnh sửa. Bản cập nhật ứng dụng chỉ thêm proxy URL trước khi gọi configure, và một lệnh gọi syncPurchases một lần. getOfferings, purchase, restorePurchases, logIn và các hàm khác vẫn giữ nguyên.",
      },
      {
        q: "Tôi có cần RevenueCat hỗ trợ để chuyển đổi không?",
        a: "Với ứng dụng trên App Store thì không: Scheduled Data Export của RevenueCat đã có các mã giao dịch mà openpurr cần. Với Google Play thì có: theo tài liệu của RevenueCat, chỉ bản xuất dữ liệu để chuyển đổi do RevenueCat Support chuẩn bị mới có purchase token mà Google yêu cầu.",
      },
      {
        q: "Còn những khách hàng không bao giờ cập nhật ứng dụng thì sao?",
        a: "Quá trình import bao gồm cả họ: giao dịch mua của họ được lấy từ Apple và Google và gán cho đúng các app user ID cũ. Trong lúc họ vẫn dùng phiên bản ứng dụng cũ, phiên bản đó giao tiếp với RevenueCat, vì vậy cả hai backend đều được cập nhật cho đến khi phần lớn người dùng đã cập nhật ứng dụng.",
      },
      {
        q: "Một lần import mất bao lâu?",
        a: "Mỗi khách hàng cần khoảng 30 lượt ghi dòng vào cơ sở dữ liệu. Trên gói miễn phí của Cloudflare, con số đó tương đương khoảng 2.500 khách hàng mỗi ngày, và quá trình import tự tạm dừng khi chạm giới hạn hằng ngày rồi tiếp tục vào ngày hôm sau. Trên Workers Paid ($5 mỗi tháng), một lần import lớn chỉ mất vài giờ.",
      },
      {
        q: "Dữ liệu của tôi có bị sao chép từ RevenueCat không?",
        a: "Chỉ có thông tin app user nào sở hữu giao dịch mua nào trên store được chuyển sang, cộng thêm các thuộc tính nếu bạn import chúng. Bản thân các giao dịch mua được lấy trực tiếp từ Apple và Google, nên openpurr ghi lại trạng thái hiện tại theo các store, bao gồm cả gia hạn và hoàn tiền.",
      },
    ],
  },
  cta: {
    title: "Sẵn sàng chuyển đổi?",
    body: "Hướng dẫn đi qua từng bước. Nếu có điều gì trong cài đặt của bạn không phù hợp, hãy mở một issue: các trường hợp chuyển đổi thực tế định hình những gì được xây dựng tiếp theo.",
    guide: "Đọc hướng dẫn (tiếng Anh)",
    github: "openpurr trên GitHub",
    issue: "Mở một issue",
  },
};
