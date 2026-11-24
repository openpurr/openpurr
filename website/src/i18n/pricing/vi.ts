// The RevenueCat pricing page in this language (see en.ts for the notes).
import type { PricingDict } from "./en";

export const pricingVi: PricingDict = {
  meta: {
    title: "Giá RevenueCat: 1% của bạn thực ra đi đâu - openpurr",
    description:
      "RevenueCat thu 1% doanh thu của bạn. Server đằng sau ứng dụng gần như chẳng tốn gì. Xem phần còn lại trả cho gì: lương, đội sales và nhà đầu tư mạo hiểm.",
    ogImageAlt: "RevenueCat lấy 1% doanh thu của bạn; server gần như chẳng tốn gì. Phần còn lại trả cho những gì.",
  },
  hero: {
    crumb: "Giá RevenueCat",
    eyebrow: "1% của bạn đi đâu",
    headline: "Bạn không trả tiền cho server.",
    /** The headline's second, highlighted sentence. {valuation} is "$500 million". */
    headlineAccent: "Bạn đang nuôi một công ty trị giá {valuation}.",
    /** {threshold} is "$2,500". */
    lede: "RevenueCat lấy 1% trên toàn bộ doanh thu được theo dõi của bạn khi vượt {threshold} mỗi tháng, và hóa đơn tăng theo mỗi bước bạn lớn lên. Server đằng sau ứng dụng gần như chẳng tốn gì. Phần còn lại trả cho chính công ty: quỹ lương, đội sales và lợi nhuận của nhà đầu tư.",
    updated: "Cập nhật {date} - Ước tính từ số liệu công khai",
  },
  answer: {
    title: "Giá RevenueCat trong một câu",
    /** HTML. {threshold} is "$2,500". */
    text: "Miễn phí khi doanh thu được theo dõi dưới {threshold} mỗi tháng, sau đó <strong>1% trên toàn bộ</strong>. Một năm số tiền đó là bao nhiêu, đặt cạnh chi phí server cho cùng ứng dụng:",
    colRevenue: "Doanh thu hằng tháng",
    colFee: "RevenueCat, mỗi năm",
    colServers: "Server, mỗi năm",
  },
  calc: {
    revenue: "Doanh thu hằng tháng của ứng dụng",
    fee: "RevenueCat lấy",
    servers: "Server thực tế tốn",
    perYear: "mỗi năm",
    stackLabel: "Phí hằng năm của bạn, chia giữa server và các đội của RevenueCat",
    /** HTML. {servers} and {rest} are percentages. */
    stackNote: "Server: {servers}. Toàn bộ phần còn lại, {rest}, trả cho các đội của họ:",
    /** {people} is a number, {salary} is like "$210K". */
    teamMeta: "Khoảng {people} người - lương phổ biến {salary}",
    swag: "Trong hóa đơn còn có: ván trượt RevenueCat phát sáng cho cả đội. 1% của bạn cũng trả cho những thứ đó.",
    swagPostAlt: "Bài đăng của một nhân viên RevenueCat trên X: “Ván trượt RevenueCat của tôi đã đến hôm qua! Đây là liên kết để nhận ván trượt RevenueCat miễn phí của riêng bạn”, dẫn tới trang tuyển dụng của RevenueCat",
    swagPhotoAlt: "Một ván trượt RevenueCat phát sáng",
    swagCaption: "Đăng trên X ngày {date}. Liên kết “nhận ván của riêng bạn” dẫn tới trang tuyển dụng của họ. {link}",
    swagLink: "Xem bài đăng",
    ceoLink: "CEO của RevenueCat đăng bài trên X khoảng {perDay} lần mỗi ngày, ngày nào cũng vậy.",
    ceoLinkLabel: "Xem số liệu →",
    ownersTitle: "1% của bạn đang xây thương vụ exit cho người khác",
    /** {pct} is like "55%". */
    ownersInvestors: "Nhà đầu tư mạo hiểm - khoảng {pct}",
    ownersRest: "Nhà sáng lập và nhân viên",
    ownersBarLabel: "Nhà đầu tư mạo hiểm sở hữu khoảng {pct} RevenueCat, theo ước tính của chúng tôi",
    /** HTML. {funding} is "$100 million"; {vc} is an amount that moves with the slider. */
    ownersText:
      "Các nhà đầu tư mạo hiểm đã rót khoảng {funding} vào RevenueCat qua năm vòng gọi vốn, và theo các mức định giá được báo cáo, họ sở hữu hơn một nửa công ty. Họ không cần cắt phần từ mỗi khoản thanh toán. Mỗi khoản phí bạn trả làm công ty của họ đáng giá hơn, và họ thu về khi công ty được bán. Xét theo tỷ lệ sở hữu, khoảng {vc} trong số bạn trả mỗi năm đang xây lợi nhuận cho họ.",
    investorsLabel: "Nhà đầu tư của RevenueCat",
    /** HTML. {days} is a number, {infra} an amount; both move with the slider. */
    punch: "1% của bạn mua được khoảng {days} ngày công kỹ sư mỗi năm tại RevenueCat. Tự chạy cùng công việc đó chỉ tốn {infra}.",
    /** HTML. {keep} is an amount that moves with the slider. */
    keep: "Giữ lại {keep} còn lại.",
    ctaKeep: "Giữ lại 1% của bạn →",
    ctaGithub: "openpurr trên GitHub",
  },
  teams: {
    eng: { name: "Kỹ thuật", basis: "Tin tuyển senior SDK engineer, 212K $" },
    product: { name: "Sản phẩm, thiết kế và dữ liệu", basis: "Tin tuyển senior product manager, 230K $; senior data scientist, 220K $" },
    sales: { name: "Sales", basis: "Tin tuyển Head of Sales, 363K $; senior sales engineer, 200K $; product expert, 133K $" },
    growth: { name: "Marketing và tăng trưởng", basis: "Tin tuyển Head of Customer Growth, 259K $; CRO designer, 205K $; product marketing, 168K $" },
    support: { name: "Customer success và hỗ trợ", basis: "Tin tuyển developer support engineer, 118K $" },
    community: { name: "Developer relations và cộng đồng", basis: "Trung vị chung của các tin tuyển, khoảng 215K $, giảm bớt vì có nhiều cấp bậc khác nhau" },
    ops: { name: "Vận hành, tài chính và nhân sự", basis: "Tin tuyển sales and operations specialist, 167K $; Head of People, 280K $" },
    exec: { name: "Ban điều hành", basis: "Cao hơn tin tuyển Head of Sales (363K $) với một số người, thấp hơn với những người khác" },
  },
  faq: {
    title: "Những câu hỏi thường gặp",
    /** Each answer is also the page's FAQ structured data. Amounts are filled in by the page. */
    items: {
      cost: {
        q: "RevenueCat giá bao nhiêu?",
        /** {threshold} "$2,500"; {at10k} the yearly fee at $10,000 a month, {at100k} at $100,000 a month; {m10k} "$10,000", {m100k} "$100,000". */
        a: "Gói Pro của RevenueCat miễn phí khi doanh thu được theo dõi dưới {threshold} mỗi tháng. Từ mức đó, phí là 1% trên toàn bộ doanh thu, không chỉ phần vượt {threshold}: {at10k} mỗi năm cho ứng dụng có doanh thu {m10k} mỗi tháng, {at100k} mỗi năm ở mức {m100k} mỗi tháng. Tài khoản lớn có thể thương lượng giá Enterprise.",
      },
      pays: {
        q: "Phí 1% của RevenueCat trả cho những gì?",
        /** {servers} and {fee} are yearly amounts for an app making {m25k} ("$25,000") a month; {people} is a number. */
        a: "Phần lớn là cho công ty. Server cho một ứng dụng thông thường chỉ tốn vài đô la mỗi tháng: {servers} mỗi năm cho ứng dụng có doanh thu {m25k} mỗi tháng, so với {fee} tiền phí. Phần còn lại trả cho đội ngũ khoảng {people} người, gồm kỹ thuật, sales, marketing và ban điều hành, đồng thời tạo giá trị cho các nhà đầu tư của công ty.",
      },
      owns: {
        q: "Ai sở hữu RevenueCat?",
        /** {funding} "$100 million"; {investors} the list of firms, already joined; {pct} like "55%". */
        a: "RevenueCat đã gọi được khoảng {funding} từ các nhà đầu tư mạo hiểm qua năm vòng, trong đó có {investors}. Cộng dồn theo các mức định giá được báo cáo của từng vòng, nhà đầu tư ước tính sở hữu khoảng {pct} công ty. Phần còn lại thuộc về nhà sáng lập và nhân viên.",
      },
      worth: {
        q: "RevenueCat trị giá bao nhiêu?",
        /** {valuation} "$500 million", {round} "$50 million", {revenue} "$30 million". */
        a: "RevenueCat được báo cáo định giá {valuation} khi gọi vòng Series C {round} vào năm 2025, với doanh thu hằng năm khoảng {revenue} vào thời điểm đó. Đây là số liệu từ báo chí và giới phân tích, không phải công bố của công ty.",
      },
      alternative: {
        q: "Có giải pháp thay thế RevenueCat nào không chia doanh thu không?",
        a: "Có. openpurr là backend miễn phí, mã nguồn mở, tự host, hoạt động với Purchases SDK chính thức của RevenueCat. Bạn đặt proxy URL của SDK thành server của mình và giữ nguyên code mua hàng. Với ứng dụng nhỏ, nó chạy trên gói miễn phí của Cloudflare, không chia doanh thu và không có phí trên mỗi giao dịch.",
      },
    },
  },
  more: {
    title: "Đúng, họ làm nhiều hơn thế",
    text: "RevenueCat làm nhiều hơn một backend mua hàng: paywall, thử nghiệm, tích hợp, đường dây hỗ trợ. Nếu bạn dùng hết những thứ đó, có lẽ nó đáng tiền với bạn. Còn nếu thứ bạn cần chỉ là xác thực giao dịch mua và giữ trạng thái gói đăng ký luôn cập nhật, bạn đang giao một phần của mọi đồng bạn sẽ kiếm được cho một việc chỉ cần vài đô la server mỗi tháng.",
  },
  method: {
    title: "Cách chúng tôi ước tính",
    /** HTML. Each item starts with a bold label. */
    fee: "<b>Phí của bạn:</b> giá niêm yết gói Pro của RevenueCat, 1% doanh thu được theo dõi hằng tháng từ {threshold}. Tài khoản lớn có thể thương lượng giá khác.",
    /** HTML. {calculator} becomes a link labelled with `calculatorLink`. */
    servers:
      "<b>Server:</b> chi phí openpurr Lite trên Cloudflare cho một ứng dụng có mức doanh thu đó, cùng mô hình với {calculator} của chúng tôi. Chi phí hosting của chính RevenueCat không được công bố; đây là chi phí của công việc đó khi bạn tự vận hành.",
    calculatorLink: "công cụ tính tiền tiết kiệm",
    /** HTML. {used}, {low}, {high} are headcounts; {loaded} is "1.3". */
    teams:
      "<b>Các đội:</b> là chức năng công việc, không phải từng người. Chúng tôi giả định {used} người (các ước tính công khai từ {low} đến {high}) và tự phân bổ họ vào các chức năng. Mức lương lấy từ các tin tuyển dụng công khai của RevenueCat, có ghi mức lương; chi phí mỗi đội là số người × lương × {loaded} cho thuế, phúc lợi và thiết bị, chưa tính cổ phần. Phần phí của bạn không dành cho server được chia theo tỷ lệ các chi phí đó.",
    split:
      "<b>Vì sao bán hàng và tăng trưởng đông hơn kỹ thuật:</b> vào {date}, trang tuyển dụng của RevenueCat có {open} vị trí đang tuyển: {gtm} ở bán hàng, marketing và tăng trưởng, và {eng} ở kỹ thuật lõi. Một công ty ở giai đoạn này đang xây dựng bộ máy go-to-market, và tin tuyển Head of Sales mới là vị trí lương cao nhất trên trang.",
    /** HTML. {funding} "$100 million", {pct} like "55%", {revenue} "$30 million". */
    investors:
      "<b>Nhà đầu tư:</b> năm vòng từ 2018 đến 2025, tổng cộng khoảng {funding}. Tỷ lệ sở hữu không được công bố, nên chúng tôi cộng dồn từ các mức định giá được báo cáo: nhà đầu tư mỗi vòng nhận phần bằng số tiền chia cho định giá post-money, và mọi người trước đó bị pha loãng theo cùng tỷ lệ. Kết quả là khoảng {pct}. Chưa tính quỹ quyền chọn cổ phiếu (option pool) và phần cổ phần của chương trình tăng tốc Y Combinator. Phần của họ là một phần giá trị công ty, không phải một khoản chi phí, nên được hiển thị riêng. Ở vòng 2025, công ty được báo cáo có doanh thu hằng năm khoảng {revenue}, gần hòa vốn.",
    colRound: "Vòng",
    colRaised: "Số vốn",
    colValuation: "Định giá",
    colLead: "Dẫn dắt bởi",
    notReported: "không công bố",
    /** HTML. */
    affiliation: "<b>Không liên kết:</b> openpurr không liên kết với RevenueCat. Đây là ước tính của chúng tôi, không phải số liệu của RevenueCat.",
    assumptions: "Các giả định, theo từng đội",
    colTeam: "Đội",
    colPeople: "Số người",
    colSalary: "Lương",
    colCost: "Chi phí hằng năm",
    colBasis: "Nguồn mức lương",
  },
  sources: {
    title: "Nguồn",
    /** One label per source, in this order. The links themselves are in English. */
    items: [
      "Giá RevenueCat: 1% doanh thu được theo dõi hằng tháng từ 2.500 $",
      "Trang tuyển dụng của RevenueCat, có khoảng lương (Ashby)",
      "Các tin tuyển trước đây của RevenueCat có ghi lương (Greenhouse)",
      "TechCrunch: RevenueCat gọi 50 triệu $, nâng tổng vốn lên 100 triệu $ (tháng 5/2025)",
      "TechCrunch: vòng Series B 40 triệu $, do Continuity Fund của Y Combinator dẫn dắt, định giá 300 triệu $ (2021)",
      "TechCrunch: vòng Series C 12 triệu $ do Adjacent dẫn dắt (2024)",
      "SaaStr: vòng seed năm 2018 với định giá 7 triệu $, và các vòng sau đó",
      "Multiples.vc: doanh thu khoảng 30 triệu $ và định giá 500 triệu $ ở vòng 2025 (ước tính)",
      "Ước tính số nhân viên: TipRanks (185)",
      "Ước tính số nhân viên: TrueUp (130)",
    ],
    /** HTML. {date} is the date; {issue} becomes a link labelled with `issueLink`. */
    checked: "Kiểm tra vào {date}. Thấy thông tin đã cũ? {issue}.",
    issueLink: "Mở issue",
  },
};
