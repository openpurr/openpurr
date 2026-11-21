<!-- translated-from: README.md sha256:7fe66f74f9217d9d -->
<h1 align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/assets/openpurr-logo-dark.png">
    <img src=".github/assets/openpurr-logo.png" alt="openpurr" width="400">
  </picture>
</h1>

<!-- languages -->
<p align="center"><a href="README.md">English</a> · <a href="README.de.md">Deutsch</a> · <a href="README.es.md">Español</a> · <a href="README.fr.md">Français</a> · <a href="README.it.md">Italiano</a> · <a href="README.nl.md">Nederlands</a> · <a href="README.pl.md">Polski</a> · <a href="README.pt-BR.md">Português (Brasil)</a> · <a href="README.tr.md">Türkçe</a> · <a href="README.id.md">Bahasa Indonesia</a> · <b>Tiếng Việt</b> · <a href="README.ar.md">العربية</a> · <a href="README.hi.md">हिन्दी</a> · <a href="README.ja.md">日本語</a> · <a href="README.ko.md">한국어</a> · <a href="README.zh-CN.md">简体中文</a> · <a href="README.zh-TW.md">繁體中文</a></p>
<!-- /languages -->

Backend thay thế RevenueCat mã nguồn mở, tự host.

Dùng Purchases SDK mã nguồn mở của RevenueCat, trỏ `Purchases.proxyURL` của ứng dụng về server của riêng bạn. openpurr xác thực giao dịch mua trên App Store và Google Play, theo dõi entitlement, nhận thông báo từ store, gửi webhook tới backend của bạn và vẽ biểu đồ các chỉ số gói đăng ký cốt lõi. Tất cả chạy trên hạ tầng do bạn kiểm soát.

openpurr là một dự án độc lập, không liên kết với RevenueCat, Inc. và không được RevenueCat, Inc. bảo trợ.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset=".github/assets/openpurr-dashboard-demo-dark.webp">
  <img src=".github/assets/openpurr-dashboard-demo.webp" alt="Các biểu đồ trong dashboard của openpurr Lite, lần lượt kèm chú thích: MRR, Biến động MRR, Doanh thu, Gói đăng ký đang hoạt động, Churn">
</picture>

## Dành cho ai

Lập trình viên ứng dụng muốn:

- **Tự kiểm soát hạ tầng mua hàng.** Lịch sử mua hàng, entitlement và thông tin xác thực store nằm trên server do bạn vận hành, trong cơ sở dữ liệu mà bạn có thể truy vấn, sao lưu và xuất ra. Không có dịch vụ bên ngoài nào đứng giữa ứng dụng của bạn và khách hàng.
- **Không chia phần trăm doanh thu.** openpurr không chia doanh thu và không tính phí trên mỗi giao dịch. Phiên bản Lite được thiết kế để vừa với gói miễn phí của Cloudflare, nên một ứng dụng nhỏ có thể chạy nó mà không tốn đồng nào.
- **Không phụ thuộc vào dịch vụ thương mại.** Đây là mã nguồn mở: bạn có thể đọc code, sửa code và chuyển nó qua lại giữa Cloudflare và cloud của riêng bạn.

openpurr cũng phù hợp nếu bạn đang dùng SDK của RevenueCat và muốn giữ nguyên. openpurr hoạt động với các SDK chính thức, không chỉnh sửa, nên việc chuyển đổi bắt đầu bằng việc đổi một URL, không phải viết lại code mua hàng. Để chuyển khách hàng hiện có sang, xem [Chuyển từ RevenueCat sang](https://openpurr.org/vi/migrate-from-revenuecat/).

**Có thể nó chưa phù hợp với bạn** nếu bạn cần công cụ dựng paywall, thử nghiệm A/B, tích hợp analytics bên thứ ba hoặc hợp đồng hỗ trợ. Các nền tảng thương mại hiện đã có sẵn những thứ đó. Xem [lộ trình](ROADMAP.md) (tiếng Anh) để biết những gì sắp có.

## openpurr làm gì

- **Mua hàng:** xác thực giao dịch StoreKit 2 và giao dịch mua trên Google Play, đồng thời trả về `CustomerInfo` và entitlement mà SDK cần.
- **Thông báo từ store:** nhận App Store Server Notifications V2 và Google Play Real-time Developer Notifications.
- **Webhook:** gửi sự kiện theo định dạng của RevenueCat tới backend của bạn, ký bằng HMAC-SHA256 và tự gửi lại trong khoảng 72 giờ.
- **Biểu đồ:** 16 biểu đồ trong dashboard, lọc được theo dự án, ứng dụng, store, sản phẩm và môi trường, và tải về dạng CSV:
  - **Doanh thu:** doanh thu, hoàn tiền, tỷ lệ hoàn tiền và giao dịch mua không phải gói đăng ký.
  - **Doanh thu định kỳ:** MRR, ARR và biến động MRR.
  - **Gói đăng ký:** gói đăng ký đang hoạt động, gói đăng ký trả phí, biến động gói đăng ký, trạng thái gói đăng ký và churn.
  - **Dùng thử:** lượt dùng thử đang diễn ra, lượt dùng thử mới và biến động dùng thử.
  - **Khách hàng:** khách hàng mới.
- **Xác thực:** SDK key và secret key, đăng nhập cho người vận hành (mật khẩu kèm mã xác thực hai bước tùy chọn; Cloudflare Access đang được lên kế hoạch), vai trò và nhật ký kiểm tra (audit log).
- **MCP server và Claude skill:** trợ lý AI có thể tra cứu khách hàng, giải thích vì sao một người có hoặc không có entitlement, và hướng dẫn bạn từng bước thiết lập App Store và Play Console.

**Tạm thời ngoài phạm vi:** paywall, sự kiện quảng cáo, Customer Center, tiền tệ ảo, thanh toán trên web, Amazon và tích hợp analytics bên thứ ba. Thử nghiệm giá đã có trong [lộ trình](ROADMAP.md#later-) (tiếng Anh).

## Hai phiên bản

| | Lite | Standard |
|---|---|---|
| Ngôn ngữ | TypeScript | Go |
| Chạy trên | Cloudflare Workers + D1 | Container + Postgres trên GCP hoặc AWS |
| Chi phí | Thiết kế để vừa với gói miễn phí của Cloudflare | Hóa đơn cloud của bạn |
| Dành cho | Ứng dụng indie: gọn nhẹ và rẻ khi vận hành | Danh mục nhiều ứng dụng lớn hơn (sắp ra mắt) |

Cả hai phiên bản đều vượt qua cùng một bộ kiểm thử tương thích trong `spec/`. Bạn có thể chuyển từ Lite sang Standard mà không cần phát hành bản cập nhật ứng dụng, miễn là ứng dụng của bạn trỏ tới một tên miền riêng mà bạn sở hữu.

## Số tiền bạn giữ lại so với RevenueCat

Gói Pro của RevenueCat miễn phí khi doanh thu được theo dõi dưới 2.500 $ mỗi tháng, sau đó thu 1% trên toàn bộ doanh thu. Lite chạy trên gói miễn phí của Cloudflare, và trên Workers Paid, từ 5 $ mỗi tháng, khi ứng dụng của bạn vượt quá gói đó.

<a href="https://openpurr.org/vi/#savings">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/assets/openpurr-savings-dark.webp">
    <img src=".github/assets/openpurr-savings.webp" alt="Công cụ tính tiết kiệm: khi doanh thu hằng tháng tăng lên 250.000 $, chi phí hằng tháng của RevenueCat tăng theo còn của openpurr Lite gần như bằng không">
  </picture>
</a>

| Doanh thu hằng tháng | RevenueCat, mỗi tháng | openpurr Lite, mỗi tháng | Tiết kiệm mỗi năm |
|---|--:|--:|--:|
| 2.000 US$ | 0 US$ | 0 US$ | **0 US$** |
| 5.000 US$ | 50 US$ | 0 US$ | **600 US$** |
| 10.000 US$ | 100 US$ | 0 US$ | **1.200 US$** |
| 25.000 US$ | 250 US$ | 5 US$ | **2.940 US$** |
| 50.000 US$ | 500 US$ | 5 US$ | **5.939 US$** |
| 100.000 US$ | 1.000 US$ | 9 US$ | **11.896 US$** |
| 250.000 US$ | 2.500 US$ | 20 US$ | **29.764 US$** |

Số liệu ước tính, giá được kiểm tra vào 21 tháng 11, 2026. Giả định khoảng 1,50 $ doanh thu hằng tháng và 10 yêu cầu SDK mỗi ngày cho mỗi người dùng hoạt động hằng ngày, nên mức chuyển sang Workers Paid là khoảng 11.250 US$ mỗi tháng. [Thử với số liệu của bạn](https://openpurr.org/vi/#savings).

## Tương thích SDK

Ngay từ đầu, openpurr dùng các SDK chính thức, không chỉnh sửa (tất cả đều theo giấy phép MIT):

| SDK | Cách trỏ SDK tới openpurr |
|---|---|
| iOS | `Purchases.proxyURL = URL(string: "https://purchases.example.com")` |
| Android | `Purchases.proxyURL = URL("https://purchases.example.com")` |
| Flutter, React Native | `Purchases.setProxyURL("https://purchases.example.com")` |

Đặt proxy URL trước khi gọi `configure`. Để xác minh entitlement ở giá trị mặc định (tắt), vì các phản hồi có chữ ký dựa vào khóa riêng của RevenueCat.

**Hạn chế đã biết trên Android:** SDK gửi lưu lượng chẩn đoán, paywall và quảng cáo thẳng tới ba host của RevenueCat, ngay cả khi đã đặt proxy URL. openpurr tắt chẩn đoán thông qua remote config. Đừng dùng paywall hoặc quảng cáo của RevenueCatUI trên Android cùng với openpurr.

## Cấu trúc repo dự kiến

```
spec/       language-neutral contract: OpenAPI, JSON schemas, fixtures, conformance suite
lite/       Lite edition: lightweight, for indie apps on Cloudflare Workers (TypeScript)
standard/   Standard edition: for larger app portfolios on AWS or GCP (Go, coming soon)
cli/        `npx @openpurr/cli` (works with either edition)
skills/     Claude Code plugin
examples/   sample apps
infra/      Terraform/OpenTofu modules for GCP, AWS and DigitalOcean
```

## Bắt đầu

Lite đang ở phiên bản 0.1.0, bản phát hành đầu tiên, nên sẽ còn thay đổi trước bản 1.0. Để dùng thử trên tài khoản Cloudflare của riêng bạn (gói miễn phí là đủ), với Node 22.12 trở lên:

```sh
git clone https://github.com/openpurr/openpurr && cd openpurr
npx pnpm install
cd lite && npx wrangler login
npx pnpm run setup      # database, both Workers, operator secret and your owner account
```

Có thể chạy lại bước cài đặt một cách an toàn nếu nó dừng giữa chừng. Khi kết thúc, nó đưa ra một liên kết tới dashboard, nơi mở sẵn bước thêm ứng dụng đầu tiên: bundle ID và package name, sau đó là sản phẩm, entitlement và offering. Một lần triển khai có thể chạy nhiều ứng dụng dưới dạng các project riêng, mỗi project có khách hàng riêng. Sau đó:

- **Kiểm tra cài đặt:** chạy `npx @openpurr/cli login`, rồi `npx @openpurr/cli doctor`. Lệnh này báo cáo những gì còn thiếu và cách khắc phục từng mục.
- **Nhận cảnh báo mức sử dụng:** thêm một API token của Cloudflare có quyền Account Analytics: Read làm secret `CLOUDFLARE_ANALYTICS_TOKEN`, và dashboard sẽ cảnh báo bạn trước khi giới hạn hằng ngày của gói miễn phí chặn các request.
- **Sao lưu dữ liệu:** `npx pnpm db:backup` xuất cơ sở dữ liệu ra một file. D1 cũng lưu lịch sử 7 ngày trên gói miễn phí (30 ngày trên Workers Paid).
- **Triển khai mỗi lần push:** fork repo và thêm thông tin Cloudflare của bạn dưới dạng repository secret. [`lite-deploy.yml`](.github/workflows/lite-deploy.yml) liệt kê các secret cần có.

Bạn dùng Claude Code? [Plugin openpurr](plugin/) (tiếng Anh) hướng dẫn các bước tương tự, cùng với thiết lập App Store Connect và Play Console.

## Đóng góp

Xem [CONTRIBUTING.md](CONTRIBUTING.md) (tiếng Anh). Hiện tại, điều giúp ích nhất là phản hồi trong các issue: những giả định sai về SDK hoặc về các store, và các trường hợp đặc biệt trong thực tế.

Với mọi vấn đề khác, hãy gửi email đến [hello@openpurr.org](mailto:hello@openpurr.org).

## Lịch sử gắn sao

<a href="https://www.star-history.com/?repos=openpurr%2Fopenpurr&type=timeline&legend=bottom-right">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=openpurr/openpurr&type=date&theme=dark&legend=bottom-right" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=openpurr/openpurr&type=date&legend=bottom-right" />
   <img alt="Biểu đồ lịch sử gắn sao" src="https://api.star-history.com/chart?repos=openpurr/openpurr&type=date&legend=bottom-right" />
 </picture>
</a>

## Giấy phép

[Apache License 2.0](LICENSE). Bản quyền 2026 thuộc những người đóng góp cho openpurr.
