import Foundation

// The admin API's answers (/admin/v1), as the app reads them. Field names follow the API's JSON
// (snake_case) through explicit coding keys: chart values are dictionaries whose keys must not be
// converted.

public struct Operator: Codable, Sendable, Equatable {
    public let id: String
    public let email: String
    public let name: String
    public let role: String
    /// The apps this operator may see; nil means every app.
    public let appIds: [String]?

    enum CodingKeys: String, CodingKey {
        case id, email, name, role
        case appIds = "app_ids"
    }

    public init(id: String, email: String, name: String, role: String, appIds: [String]?) {
        self.id = id
        self.email = email
        self.name = name
        self.role = role
        self.appIds = appIds
    }
}

public struct MeResponse: Codable, Sendable {
    public let `operator`: Operator
    public let permissions: [String]
}

public struct Project: Codable, Sendable, Identifiable, Hashable {
    public struct App: Codable, Sendable, Hashable {
        public let id: String
        public let store: String
    }

    public let id: String
    public let name: String
    public let apps: [App]
}

public struct ProjectsResponse: Codable, Sendable {
    public let projects: [Project]
}

/// The environment events and charts are read for.
public enum StoreEnvironment: String, Codable, Sendable, CaseIterable, Identifiable {
    case production, sandbox
    public var id: String { rawValue }
}

// MARK: - Events

/// One purchase event as the event list shows it (GET /admin/v1/events).
public struct PurchaseEvent: Codable, Sendable, Identifiable, Hashable {
    public let id: String
    public let type: String
    public let appId: String
    public let projectId: String?
    public let environment: String
    /// When openpurr recorded it, epoch milliseconds.
    public let createdAt: Double
    public let appUserId: String?
    /// APP_STORE or PLAY_STORE.
    public let store: String?
    public let productId: String?
    /// NORMAL, TRIAL or INTRO.
    public let periodType: String?
    /// In USD, at the purchase date's exchange rate; nil when the currency has no rate.
    public let price: Double?
    public let priceInPurchasedCurrency: Double?
    public let currency: String?
    /// ISO 3166-1 alpha-2.
    public let countryCode: String?
    public let newProductId: String?
    public let cancelReason: String?
    public let expirationReason: String?
    public let isFamilyShare: Bool?

    enum CodingKeys: String, CodingKey {
        case id, type, environment, store, price, currency
        case appId = "app_id"
        case projectId = "project_id"
        case createdAt = "created_at"
        case appUserId = "app_user_id"
        case productId = "product_id"
        case periodType = "period_type"
        case priceInPurchasedCurrency = "price_in_purchased_currency"
        case countryCode = "country_code"
        case newProductId = "new_product_id"
        case cancelReason = "cancel_reason"
        case expirationReason = "expiration_reason"
        case isFamilyShare = "is_family_share"
    }

    public var date: Date { Date(timeIntervalSince1970: createdAt / 1000) }
}

public struct EventPage: Codable, Sendable {
    public let events: [PurchaseEvent]
    public let nextCursor: String?

    enum CodingKeys: String, CodingKey {
        case events
        case nextCursor = "next_cursor"
    }
}

/// GET /admin/v1/events/:id: the listed fields plus the full RevenueCat-shaped body.
public struct EventDetail: Decodable, Sendable {
    public let event: PurchaseEvent
    public let body: JSONValue

    enum CodingKeys: String, CodingKey { case body }

    public init(from decoder: Decoder) throws {
        event = try PurchaseEvent(from: decoder)
        body = try decoder.container(keyedBy: CodingKeys.self).decode(JSONValue.self, forKey: .body)
    }
}

/// Any JSON value, for showing an event's raw body.
public enum JSONValue: Codable, Sendable, Hashable {
    case null
    case bool(Bool)
    case number(Double)
    case string(String)
    case array([JSONValue])
    case object([(String, JSONValue)])

    public init(from decoder: Decoder) throws {
        if let keyed = try? decoder.container(keyedBy: AnyKey.self) {
            // Keys in the order the server sent them aren't available from Codable; sort for a stable view.
            self = .object(try keyed.allKeys.map { ($0.stringValue, try keyed.decode(JSONValue.self, forKey: $0)) }.sorted { $0.0 < $1.0 })
            return
        }
        if var list = try? decoder.unkeyedContainer() {
            var items: [JSONValue] = []
            while !list.isAtEnd { items.append(try list.decode(JSONValue.self)) }
            self = .array(items)
            return
        }
        let single = try decoder.singleValueContainer()
        if single.decodeNil() { self = .null }
        else if let b = try? single.decode(Bool.self) { self = .bool(b) }
        else if let n = try? single.decode(Double.self) { self = .number(n) }
        else { self = .string(try single.decode(String.self)) }
    }

    public func encode(to encoder: Encoder) throws {
        switch self {
        case .null:
            var c = encoder.singleValueContainer()
            try c.encodeNil()
        case .bool(let b):
            var c = encoder.singleValueContainer()
            try c.encode(b)
        case .number(let n):
            var c = encoder.singleValueContainer()
            try c.encode(n)
        case .string(let s):
            var c = encoder.singleValueContainer()
            try c.encode(s)
        case .array(let items):
            var c = encoder.unkeyedContainer()
            for item in items { try c.encode(item) }
        case .object(let pairs):
            var c = encoder.container(keyedBy: AnyKey.self)
            for (k, v) in pairs { try c.encode(v, forKey: AnyKey(stringValue: k)) }
        }
    }

    public static func == (a: JSONValue, b: JSONValue) -> Bool {
        switch (a, b) {
        case (.null, .null): true
        case let (.bool(x), .bool(y)): x == y
        case let (.number(x), .number(y)): x == y
        case let (.string(x), .string(y)): x == y
        case let (.array(x), .array(y)): x == y
        case let (.object(x), .object(y)): x.count == y.count && zip(x, y).allSatisfy { $0.0 == $1.0 && $0.1 == $1.1 }
        default: false
        }
    }

    public func hash(into hasher: inout Hasher) {
        switch self {
        case .null: hasher.combine(0)
        case .bool(let b): hasher.combine(b)
        case .number(let n): hasher.combine(n)
        case .string(let s): hasher.combine(s)
        case .array(let items): hasher.combine(items)
        case .object(let pairs):
            for (k, v) in pairs {
                hasher.combine(k)
                hasher.combine(v)
            }
        }
    }

    /// Indented, human-readable text.
    public func pretty(indent: String = "") -> String {
        let next = indent + "  "
        switch self {
        case .null: return "null"
        case .bool(let b): return b ? "true" : "false"
        case .number(let n): return n == n.rounded() && abs(n) < 1e15 ? String(Int64(n)) : String(n)
        case .string(let s): return "\"\(s)\""
        case .array(let items):
            if items.isEmpty { return "[]" }
            return "[\n" + items.map { next + $0.pretty(indent: next) }.joined(separator: ",\n") + "\n\(indent)]"
        case .object(let pairs):
            if pairs.isEmpty { return "{}" }
            return "{\n" + pairs.map { "\(next)\"\($0.0)\": \($0.1.pretty(indent: next))" }.joined(separator: ",\n") + "\n\(indent)}"
        }
    }
}

struct AnyKey: CodingKey {
    let stringValue: String
    var intValue: Int? { nil }
    init(stringValue: String) { self.stringValue = stringValue }
    init?(intValue: Int) { nil }
}

// MARK: - Charts

public struct ChartSeries: Codable, Sendable, Hashable {
    public let key: String
    public let label: String
}

/// usd, count or percent.
public enum ChartUnit: String, Codable, Sendable {
    case usd, count, percent
}

/// running: a level at the end of each period (MRR, active subscriptions). flow: a total per
/// period (revenue, new trials). breakdown: categories right now (subscription status).
public enum ChartKind: String, Codable, Sendable {
    case running, flow, breakdown
}

public enum ChartInterval: String, Codable, Sendable, CaseIterable {
    case day, week, month
}

/// GET /admin/v1/metrics: the chart catalog.
public struct ChartCatalog: Codable, Sendable {
    public struct Chart: Codable, Sendable, Identifiable, Hashable {
        public let id: String
        public let label: String
        public let description: String
        public let unit: ChartUnit
        public let kind: ChartKind
        public let series: [ChartSeries]
    }

    public let charts: [Chart]
    /// When the hourly rollup last ran (epoch ms).
    public let updatedAt: Int64?

    enum CodingKeys: String, CodingKey {
        case charts
        case updatedAt = "updated_at"
    }
}

/// GET /admin/v1/metrics/:chart.
public struct ChartResult: Codable, Sendable {
    public struct Point: Codable, Sendable, Hashable {
        /// The period's first day, YYYY-MM-DD.
        public let date: String
        public let values: [String: Double?]
    }

    public struct Category: Codable, Sendable, Hashable {
        public let key: String
        public let label: String
        public let value: Double
    }

    public let chart: String
    public let label: String
    public let description: String
    public let unit: ChartUnit
    public let kind: ChartKind
    public let interval: ChartInterval
    public let from: String
    public let to: String
    public let series: [ChartSeries]
    public let points: [Point]
    public let categories: [Category]?
    public let notes: [String]
    public let updatedAt: Int64?

    enum CodingKeys: String, CodingKey {
        case chart, label, description, unit, kind, interval, from, to, series, points, categories, notes
        case updatedAt = "updated_at"
    }

    /// A series' value at a point (0 when missing or null).
    public func value(_ point: Point, _ key: String) -> Double {
        (point.values[key] ?? nil) ?? 0
    }

    /// The last point's value, for running charts.
    public func latest(_ key: String) -> Double? {
        points.last.map { value($0, key) }
    }

    /// The sum over every point, for flow charts.
    public func total(_ key: String) -> Double {
        points.reduce(0) { $0 + value($1, key) }
    }
}

/// The admin API's error body: {"code": ..., "message": ...}.
public struct APIErrorBody: Codable, Sendable {
    public let code: String?
    public let message: String?
}
