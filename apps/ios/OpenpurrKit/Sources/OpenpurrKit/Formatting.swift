import Foundation

// Words and numbers as the app shows them.

public extension PurchaseEvent {
    /// A short title: "New subscription", "Trial started", "Refund"...
    var title: String {
        switch type {
        case "INITIAL_PURCHASE": periodType == "TRIAL" ? "Trial started" : periodType == "INTRO" ? "New subscription (intro offer)" : "New subscription"
        case "RENEWAL": "Renewal"
        case "CANCELLATION": cancelReason == "CUSTOMER_SUPPORT" ? "Refund" : "Cancellation"
        case "UNCANCELLATION": "Uncancellation"
        case "NON_RENEWING_PURCHASE": "Purchase"
        case "EXPIRATION": "Expiration"
        case "BILLING_ISSUE": "Billing issue"
        case "PRODUCT_CHANGE": "Product change"
        case "SUBSCRIPTION_EXTENDED": "Subscription extended"
        case "SUBSCRIPTION_PAUSED": "Subscription paused"
        case "REFUND_REVERSED": "Refund reversed"
        case "TRANSFER": "Transfer"
        case "PRICE_INCREASE_CONSENT_REQUIRED": "Price increase consent required"
        case "PRICE_INCREASE_CONSENT_APPROVED": "Price increase approved"
        default: type.replacingOccurrences(of: "_", with: " ").capitalized
        }
    }

    /// What kind of news it is, for an icon and color.
    var tone: EventTone {
        switch type {
        case "INITIAL_PURCHASE", "NON_RENEWING_PURCHASE", "RENEWAL", "UNCANCELLATION", "REFUND_REVERSED":
            (price ?? priceInPurchasedCurrency ?? 0) < 0 ? .bad : .good
        case "CANCELLATION", "EXPIRATION", "BILLING_ISSUE": .bad
        default: .neutral
        }
    }

    /// The price in the purchase's own currency ("€9.99"), or nil without one.
    var localPrice: String? {
        guard let amount = priceInPurchasedCurrency, let currency else { return nil }
        return amount.formatted(.currency(code: currency))
    }

    /// The price in USD, when the purchase was in another currency.
    var usdPrice: String? {
        guard let price, currency != "USD" else { return nil }
        return price.formatted(.currency(code: "USD"))
    }

    /// Store, as a short word.
    var storeName: String? {
        switch store {
        case "APP_STORE": "App Store"
        case "PLAY_STORE": "Google Play"
        default: store
        }
    }

    /// The country's flag, from its ISO code.
    var flag: String? {
        guard let code = countryCode?.uppercased(), code.count == 2 else { return nil }
        return String(String.UnicodeScalarView(code.unicodeScalars.compactMap { UnicodeScalar(127_397 + $0.value) }))
    }

    /// One line under the title: "pro_annual · €59.99 · 🇩🇪".
    var summary: String {
        [productId ?? newProductId, localPrice, flag].compactMap { $0 }.joined(separator: " · ")
    }

    /// $0 events (free trials, offer codes): the feed can hide these.
    var isFree: Bool { (priceInPurchasedCurrency ?? price ?? 0) == 0 }
}

public enum EventTone: Sendable { case good, bad, neutral }

/// The event types a feed filter offers, in a sensible order.
public let eventTypeFilters: [(type: String, label: String)] = [
    ("INITIAL_PURCHASE", "New subscriptions and trials"),
    ("RENEWAL", "Renewals"),
    ("NON_RENEWING_PURCHASE", "One-time purchases"),
    ("CANCELLATION", "Cancellations and refunds"),
    ("UNCANCELLATION", "Uncancellations"),
    ("EXPIRATION", "Expirations"),
    ("BILLING_ISSUE", "Billing issues"),
    ("PRODUCT_CHANGE", "Product changes"),
    ("TRANSFER", "Transfers"),
]

public extension ChartUnit {
    /// A value in this unit: "$1,234", "1,234", "4.2%".
    func format(_ value: Double, compact: Bool = false) -> String {
        switch self {
        case .usd:
            if compact, abs(value) >= 10_000 { return "$" + value.formatted(.number.notation(.compactName).precision(.fractionLength(0...1))) }
            // Compact (axis labels, tiles): no cents on whole or large amounts.
            if compact, abs(value) >= 100 || value == value.rounded() {
                return value.formatted(.currency(code: "USD").precision(.fractionLength(0)).rounded(rule: .toNearestOrAwayFromZero))
            }
            return value.formatted(.currency(code: "USD").precision(.fractionLength(abs(value) >= 1000 ? 0 : 2)).rounded(rule: .toNearestOrAwayFromZero))
        case .count:
            if compact, abs(value) >= 10_000 { return value.formatted(.number.notation(.compactName).precision(.fractionLength(0...1))) }
            return value.formatted(.number.precision(.fractionLength(0)).rounded(rule: .toNearestOrAwayFromZero))
        case .percent:
            return (value / 100).formatted(.percent.precision(.fractionLength(0...1)))
        }
    }
}

/// Dates as the metrics API takes them (YYYY-MM-DD, UTC: rollups are by UTC day).
public enum DayFormat {
    static let calendar: Calendar = {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = TimeZone(identifier: "UTC")!
        return c
    }()

    public static func string(_ date: Date) -> String {
        let c = calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", c.year!, c.month!, c.day!)
    }

    public static func date(_ day: String) -> Date? {
        let parts = day.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return nil }
        return calendar.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2]))
    }

    /// The day `days` days before `date`'s day.
    public static func daysBefore(_ days: Int, _ date: Date) -> String {
        string(calendar.date(byAdding: .day, value: -days, to: date)!)
    }
}

/// A chart's date range, as the app's range picker offers them.
public enum ChartRange: String, CaseIterable, Identifiable, Sendable {
    case week = "7D"
    case month = "28D"
    case quarter = "90D"
    case year = "12M"

    public var id: String { rawValue }

    public var days: Int {
        switch self {
        case .week: 7
        case .month: 28
        case .quarter: 90
        case .year: 365
        }
    }

    public var interval: ChartInterval {
        switch self {
        case .week, .month: .day
        case .quarter: .week
        case .year: .month
        }
    }

    /// From and to (inclusive), ending today.
    public func bounds(now: Date = Date()) -> (from: String, to: String) {
        (DayFormat.daysBefore(days - 1, now), DayFormat.string(now))
    }
}
