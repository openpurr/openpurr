// Vietnamese copy. Follows en.ts; see the notes there. Addresses the reader as "bạn"; keeps common dev terms (backend, webhook, entitlement, dashboard, paywall, store, server) in English, as Vietnamese developers do.
import type { Dict } from "./en";

export const vi: Dict = {
  meta: {
    title: "openpurr: giải pháp thay thế RevenueCat mã nguồn mở, tự host",
    description:
      "openpurr là giải pháp thay thế RevenueCat mã nguồn mở, tự host. Giữ nguyên Purchases SDK bạn đang dùng, trỏ nó về server của bạn và không chia doanh thu cho ai.",
    ogImageAlt: "openpurr: giải pháp thay thế RevenueCat mã nguồn mở, tự host, bên cạnh dashboard biểu đồ gói đăng ký",
  },
  header: {
    home: "Trang chủ openpurr",
    nav: { features: "Tính năng", editions: "Phiên bản", roadmap: "Lộ trình", faq: "Hỏi đáp", migrate: "Chuyển đổi" },
    language: "Ngôn ngữ",
  },
  footer: {
    tagline: "Hạ tầng mua hàng mã nguồn mở do bạn tự vận hành.",
    roadmap: "Lộ trình",
    contributing: "Đóng góp",
    sponsor: "Tài trợ",
    privacy: "Quyền riêng tư (tiếng Anh)",
    disclaimer:
      "openpurr là một dự án độc lập, không liên kết với RevenueCat, Inc. và không được RevenueCat, Inc. bảo trợ. App Store là nhãn hiệu của Apple Inc. Google Play là nhãn hiệu của Google LLC.",
    copyright: "Bản quyền {year} thuộc những người đóng góp cho openpurr.",
    cookieSettings: "Cài đặt cookie",
  },
  consent: {
    label: "Đồng ý sử dụng cookie",
    text: "Chúng tôi muốn dùng cookie của Google Analytics để đếm lượt truy cập và xem trang nào hữu ích. Không có cookie nào được đặt nếu bạn không đồng ý, và bạn có thể đổi ý bất cứ lúc nào trong mục Cài đặt cookie.",
    privacy: "Quyền riêng tư (tiếng Anh)",
    decline: "Từ chối",
    accept: "Đồng ý",
  },
  snippet: {
    tabs: "Nền tảng SDK",
    note: "Một dòng. Cùng SDK, cùng code mua hàng.",
  },
  home: {
    hero: {
      title:
        '<span class="accent">Giải pháp thay thế RevenueCat</span> mã nguồn mở, <span class="nowrap">tự host</span>',
      lede: "Tự kiểm soát hạ tầng mua hàng, không chia doanh thu cho ai và không phụ thuộc vào dịch vụ thương mại nào. Giữ nguyên Purchases SDK bạn đang dùng: chỉ đổi một URL, không phải sửa code mua hàng.",
      star: "Gắn sao trên GitHub",
      how: "Cách hoạt động",
      shotAlt:
        "Dashboard của openpurr Lite, hiển thị biến động MRR trong 12 tháng, số gói đăng ký đang hoạt động, churn, khách hàng mới, lượt dùng thử mới và lượt dùng thử đang diễn ra",
    },
    why: {
      eyebrow: "Dành cho ai",
      title: "Dành cho lập trình viên ứng dụng muốn tự vận hành",
      lede: "openpurr hoạt động với các SDK chính thức, không chỉnh sửa. Việc chuyển đổi bắt đầu bằng việc đổi một URL, không phải viết lại code mua hàng.",
      reasons: [
        {
          title: "Dữ liệu của bạn, server của bạn",
          body: "Lịch sử mua hàng, entitlement và thông tin xác thực store nằm trong cơ sở dữ liệu do bạn vận hành, truy vấn, sao lưu và xuất ra. Không có dịch vụ bên ngoài nào đứng giữa ứng dụng của bạn và khách hàng.",
        },
        {
          title: "Không chia doanh thu",
          body: "Không thu phần trăm doanh thu, không tính phí trên mỗi giao dịch. Phiên bản Lite được thiết kế để vừa với gói miễn phí của Cloudflare, nên một ứng dụng nhỏ có thể chạy nó mà không tốn đồng nào.",
        },
        {
          title: "Không phụ thuộc nhà cung cấp",
          body: "Mã nguồn mở theo giấy phép Apache 2.0. Bạn có thể đọc code, sửa code và chuyển nó qua lại giữa Cloudflare và cloud của riêng bạn.",
        },
      ],
    },
    how: {
      eyebrow: "Cách hoạt động",
      title: "Server của bạn thay vào chỗ của nhà cung cấp",
      lede: "Ứng dụng của bạn giữ nguyên Purchases SDK mã nguồn mở đang được tích hợp sẵn. SDK giao tiếp với openpurr. openpurr giao tiếp với các store, lưu trạng thái gói đăng ký và báo cho backend của bạn biết những gì đã thay đổi.",
      flowLabel: "Luồng request",
      app: "Ứng dụng của bạn",
      sdkLicense: "Chính thức, không chỉnh sửa, giấy phép MIT",
      sdkPlatforms: "iOS, Android, Flutter hoặc React Native",
      coreWhere: "Trên Cloudflare Workers hoặc cloud của riêng bạn",
      appStoreApi: "Server API và thông báo",
      playApi: "Developer API và RTDN",
      backend: "Backend của bạn",
      backendHooks: "Webhook có chữ ký",
      steps: [
        {
          title: "Triển khai",
          /** HTML */
          body: "Chạy openpurr Lite trên tài khoản Cloudflare của riêng bạn. Trình cài đặt có hướng dẫn, <code>pnpm run setup</code>, sẽ tạo cơ sở dữ liệu, triển khai cả hai Worker và tạo tài khoản chủ sở hữu cho bạn.",
        },
        {
          title: "Trỏ SDK",
          /** HTML */
          body: "Đặt proxy URL trước khi gọi <code>configure</code>. Hãy dùng tên miền riêng của bạn để sau này có thể chuyển server.",
        },
        {
          title: "Kết nối store",
          /** HTML */
          body: "Thêm thông tin xác thực store và URL nhận thông báo. Lệnh kiểm tra cài đặt, <code>openpurr doctor</code>, sẽ xác minh chúng và chỉ cách khắc phục những gì còn thiếu.",
        },
      ],
    },
    features: {
      eyebrow: "openpurr làm gì",
      title: "Backend cho gói đăng ký, không kèm những thứ bạn không dùng",
      items: [
        {
          title: "Mua hàng",
          body: "Xác thực giao dịch StoreKit 2 và giao dịch mua trên Google Play, đồng thời trả về CustomerInfo và entitlement mà SDK cần.",
        },
        {
          title: "Thông báo từ store",
          body: "Nhận App Store Server Notifications V2 và Google Play Real-time Developer Notifications, để việc gia hạn, hoàn tiền và thời gian ân hạn luôn được cập nhật.",
        },
        {
          title: "Webhook",
          body: "Gửi sự kiện theo định dạng của RevenueCat tới backend của bạn, ký bằng HMAC-SHA256 và tự gửi lại trong khoảng 72 giờ.",
        },
        {
          title: "Biểu đồ",
          body: "16 biểu đồ: doanh thu, MRR và ARR, biến động MRR và gói đăng ký, gói đăng ký đang hoạt động và trả phí, trạng thái gói đăng ký, churn, dùng thử và tỷ lệ chuyển đổi từ dùng thử, khách hàng mới, hoàn tiền và tỷ lệ hoàn tiền, và giao dịch mua một lần. Lọc theo ứng dụng, store, sản phẩm và môi trường, doanh thu được quy đổi sang USD.",
        },
        {
          title: "Xác thực và nhật ký kiểm tra",
          body: "SDK key và secret key, đăng nhập cho người vận hành với mã xác thực hai bước tùy chọn, vai trò, access token và nhật ký kiểm tra (audit log).",
        },
        {
          title: "MCP server và Claude skill",
          body: "Hỏi trợ lý AI vì sao một khách hàng có hoặc không có entitlement, tra cứu giao dịch mua, hoặc được hướng dẫn từng bước thiết lập App Store Connect và Play Console.",
        },
      ],
    },
    editions: {
      eyebrow: "Hai phiên bản",
      title: "Bắt đầu nhỏ, nâng cấp mà không cần cập nhật ứng dụng",
      lede: "Cả hai phiên bản đều vượt qua cùng một bộ kiểm thử tương thích. Nếu ứng dụng của bạn trỏ tới tên miền riêng, việc chuyển từ Lite sang Standard không cần phát hành bản ứng dụng mới.",
      lite: {
        badge: "Cho ứng dụng indie",
        price: "$0",
        priceNote: "trên gói miễn phí của Cloudflare",
        items: [
          "TypeScript trên Cloudflare Workers và D1",
          "Gọn nhẹ và rẻ khi vận hành",
          "Cảnh báo mức sử dụng trước khi chạm giới hạn gói miễn phí",
        ],
      },
      standard: {
        badge: "Sắp ra mắt",
        price: "Hóa đơn cloud của bạn",
        priceNote: "không thêm gì khác",
        items: ["Go và Postgres trong container", "GCP hoặc AWS", "Cho danh mục nhiều ứng dụng lớn hơn"],
      },
    },
    fit: {
      eyebrow: "Nói thẳng",
      title: "Có thể nó chưa phù hợp với bạn",
      lede: "Nếu bạn cần công cụ dựng paywall, thử nghiệm A/B, tích hợp analytics bên thứ ba hoặc hợp đồng hỗ trợ, các nền tảng thương mại hiện đã có sẵn những thứ đó.",
      outTitle: "Tạm thời ngoài phạm vi",
      tags: ["Paywall", "Sự kiện quảng cáo", "Customer Center", "Tiền tệ ảo", "Thanh toán trên web", "Amazon", "Tích hợp analytics"],
    },
    roadmap: {
      eyebrow: "Lộ trình",
      title: "Hướng đi sắp tới",
      lede: "Thứ tự đã được chốt, nhưng không có mốc thời gian. Nếu bạn quan tâm đến điều gì, hãy nói trong một issue.",
      status: { done: "Đã xong", wip: "Đang làm", planned: "Đã lên kế hoạch", later: "Bạn quyết định" },
      phases: [
        {
          phase: "Lite",
          items: [
            "Bản phát hành mới nhất: {version}",
            "Thiết kế cho gói miễn phí của Cloudflare",
            "App Store và Google Play",
            "Webhook, dashboard và trang quản trị",
            "Nhiều ứng dụng trong một lần triển khai",
            "MCP server, CLI và Claude skill",
            "Tiếp theo: kiểm thử trên thiết bị, rồi đến 1.0",
          ],
        },
        {
          phase: "Standard",
          items: [
            "Go và Postgres trong container",
            "GCP trước, sau đó là AWS",
            "Cùng bộ kiểm thử tương thích với Lite",
            "Chuyển từ Lite mà không cần cập nhật ứng dụng",
          ],
        },
        {
          phase: "Do cộng đồng định hướng",
          items: ["Xác minh danh tính người dùng cuối", "Tính năng bổ sung của Standard cho các team lớn hơn", "Bất cứ điều gì bạn đề xuất trong issue"],
        },
      ],
      more: "Xem toàn bộ lộ trình (tiếng Anh) →",
    },
    cta: {
      title: "Cùng định hình openpurr",
      body: "Hiện tại, điều giúp ích nhất là phản hồi: những giả định sai về SDK hoặc về các store, và các trường hợp đặc biệt thực tế khi gia hạn, hoàn tiền và trong thời gian ân hạn.",
      star: "Gắn sao trên GitHub",
      issue: "Mở một issue",
      coffee: "Mời chúng tôi một ly cà phê",
    },
  },
  faq: {
    eyebrow: "Hỏi đáp",
    title: "openpurr, giải pháp thay thế RevenueCat",
    lede: "Những gì thay đổi khi bạn tự vận hành backend cho gói đăng ký, và những gì giữ nguyên.",
    items: [
      {
        q: "openpurr là gì?",
        a: "openpurr là giải pháp thay thế RevenueCat mã nguồn mở, tự host. Đây là một backend cho mua hàng trong ứng dụng và gói đăng ký, hoạt động với Purchases SDK chính thức của RevenueCat. openpurr xác thực giao dịch mua trên App Store và Google Play, theo dõi entitlement, nhận thông báo từ store, gửi webhook tới backend của bạn và vẽ biểu đồ các chỉ số gói đăng ký cốt lõi, tất cả trên hạ tầng do bạn kiểm soát.",
      },
      {
        q: "openpurr khác RevenueCat như thế nào?",
        a: "RevenueCat là dịch vụ thương mại được host sẵn, thu một phần doanh thu khi bạn vượt quá mức miễn phí. openpurr là phần mềm bạn tự vận hành: lịch sử mua hàng, entitlement và thông tin xác thực store nằm trong cơ sở dữ liệu của riêng bạn, và không có khoản chia doanh thu hay phí trên mỗi giao dịch. Hiện tại RevenueCat có nhiều tính năng hơn, chẳng hạn paywall, thử nghiệm và tích hợp analytics. openpurr tập trung vào phần backend cốt lõi cho gói đăng ký.",
      },
      {
        q: "Tôi có phải viết lại code mua hàng để chuyển từ RevenueCat sang không?",
        a: "Không. openpurr hoạt động với Purchases SDK chính thức, không chỉnh sửa. Bạn đặt proxy URL của SDK thành server openpurr của mình trước khi gọi configure, còn lại code mua hàng giữ nguyên. Hãy trỏ tới một tên miền riêng của bạn để sau này có thể chuyển server mà không cần cập nhật ứng dụng.",
      },
      {
        q: "Làm sao để chuyển khách hàng hiện có từ RevenueCat sang?",
        a: "Bạn import họ vào. Hãy yêu cầu RevenueCat cung cấp bản xuất dữ liệu để chuyển đổi, rồi lệnh openpurr import sẽ lấy giao dịch mua của từng khách hàng từ Apple và Google và gán chúng cho đúng các app user ID cũ. Phiên bản mới của ứng dụng cũng gửi giao dịch mua của từng khách hàng một lần, và cả hai backend đều được cập nhật trong lúc mọi người nâng cấp ứng dụng, nên không ai bị mất quyền truy cập.",
        link: "Cách chuyển đổi",
      },
      {
        q: "openpurr hỗ trợ những nền tảng và store nào?",
        a: "openpurr hỗ trợ Purchases SDK cho iOS, Android, Flutter và React Native, với giao dịch mua từ App Store và Google Play. Amazon và thanh toán trên web hiện nằm ngoài phạm vi.",
      },
      {
        q: "openpurr có giá bao nhiêu?",
        a: "openpurr miễn phí và mã nguồn mở theo giấy phép Apache 2.0. Bạn chỉ trả tiền cho hạ tầng mà nó chạy trên đó. Phiên bản Lite được thiết kế để chạy trên gói miễn phí của Cloudflare, nên một ứng dụng nhỏ có thể chạy nó mà không tốn đồng nào. Phiên bản Standard chạy trong container trên cloud của riêng bạn, nên chi phí chính là hóa đơn cloud của bạn.",
      },
      {
        q: "Dữ liệu của tôi được lưu ở đâu?",
        a: "Dữ liệu nằm trong cơ sở dữ liệu của riêng bạn. Phiên bản Lite dùng Cloudflare D1 trong tài khoản Cloudflare của bạn. Phiên bản Standard dùng Postgres trên GCP hoặc AWS. Bạn có thể truy vấn, sao lưu và xuất dữ liệu, và không có dịch vụ bên ngoài nào đứng giữa ứng dụng của bạn và khách hàng.",
      },
      {
        q: "openpurr có gửi webhook giống RevenueCat không?",
        a: "Có. openpurr gửi sự kiện theo định dạng của RevenueCat tới backend của bạn, ký bằng HMAC-SHA256 và tự gửi lại trong khoảng 72 giờ, nên các webhook handler hiện có cần sửa rất ít hoặc không cần sửa gì.",
      },
      {
        q: "RevenueCat có những gì mà openpurr không có?",
        a: "Paywall, tích hợp analytics bên thứ ba, Customer Center, tiền tệ ảo, thanh toán trên web, Amazon, sự kiện quảng cáo và hợp đồng hỗ trợ thương mại hiện nằm ngoài phạm vi. Thử nghiệm giá đã có trong lộ trình. Nếu bạn cần những thứ đó ngay bây giờ, một nền tảng thương mại sẽ phù hợp hơn.",
      },
      {
        q: "openpurr đã sẵn sàng cho môi trường production chưa?",
        a: "Chưa. openpurr vẫn đang ở giai đoạn đầu: phiên bản Lite đang được phát triển và phiên bản Standard sẽ ra mắt sau. Hãy theo dõi lộ trình trên GitHub, và mở một issue nếu có điều gì quan trọng với bạn.",
      },
      {
        q: "openpurr có liên kết với RevenueCat không?",
        a: "Không. openpurr là một dự án mã nguồn mở độc lập, không liên kết với RevenueCat, Inc. và không được RevenueCat, Inc. bảo trợ. openpurr hoạt động với Purchases SDK chính thức của RevenueCat, vốn được cấp phép theo giấy phép MIT.",
      },
    ],
  },
  structured: {
    description:
      "Giải pháp thay thế RevenueCat mã nguồn mở, tự host: một backend cho mua hàng trong ứng dụng và gói đăng ký trên App Store và Google Play, hoạt động với Purchases SDK chính thức, không chỉnh sửa. openpurr xác thực giao dịch mua, theo dõi entitlement, nhận thông báo từ store, gửi webhook và vẽ biểu đồ các chỉ số gói đăng ký.",
    subCategory: "Backend cho mua hàng trong ứng dụng và gói đăng ký",
    features: [
      "Hoạt động với Purchases SDK chính thức của RevenueCat cho iOS, Android, Flutter và React Native",
      "Xác thực giao dịch mua StoreKit 2 và Google Play",
      "App Store Server Notifications V2 và Google Play Real-time Developer Notifications",
      "Webhook theo định dạng của RevenueCat, ký bằng HMAC-SHA256",
      "16 biểu đồ gói đăng ký, gồm MRR, churn và tỷ lệ chuyển đổi từ dùng thử",
      "MCP server, CLI và Claude skill",
    ],
  },
};
