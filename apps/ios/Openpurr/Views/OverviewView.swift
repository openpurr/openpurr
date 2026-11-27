import OpenpurrKit
import SwiftUI

/// The home screen: headline numbers against the 28 days before, and the latest events.
struct OverviewView: View {
    @Environment(AppModel.self) private var model
    @State private var tiles: [Tile] = []
    @State private var latest: [PurchaseEvent] = []
    @State private var updatedAt: Int64?
    @State private var error: Error?
    @State private var loading = false

    struct Tile: Identifiable {
        let id: String
        let label: String
        let value: Double
        let previous: Double?
        let unit: ChartUnit
        let footnote: String
    }

    /// The headline charts: running ones compare their level 28 days ago, flow ones the 28 days before.
    private static let headlines: [(chart: String, label: String, keys: [String], footnote: String)] = [
        ("mrr", "MRR", ["mrr"], "vs 28 days ago"),
        ("active_subscriptions", "Active subscriptions", ["paid", "trials"], "vs 28 days ago"),
        ("active_trials", "Active trials", ["trials"], "vs 28 days ago"),
        ("revenue", "Revenue, 28 days", ["net"], "vs the 28 days before"),
        ("new_customers", "New customers, 28 days", ["customers"], "vs the 28 days before"),
    ]

    var body: some View {
        NavigationStack {
            List {
                if let error, tiles.isEmpty {
                    ErrorState(error: error) { await load() }
                } else {
                    Section {
                        // Five fixed tiles: a plain Grid (a LazyVGrid in a List row didn't redraw its cells).
                        let shown = tiles.isEmpty && loading
                            ? Self.headlines.map { Tile(id: "placeholder:" + $0.chart, label: $0.label, value: 0, previous: nil, unit: .count, footnote: "") }
                            : tiles
                        Grid(horizontalSpacing: 12, verticalSpacing: 12) {
                            ForEach(Array(stride(from: 0, to: shown.count, by: 2)), id: \.self) { i in
                                GridRow {
                                    TileView(tile: shown[i])
                                    if i + 1 < shown.count { TileView(tile: shown[i + 1]) } else { Color.clear }
                                }
                            }
                        }
                        .redacted(reason: tiles.isEmpty ? .placeholder : [])
                        .listRowInsets(EdgeInsets())
                        .listRowBackground(Color.clear)
                    } footer: {
                        if let text = updatedText(updatedAt) { Text("Charts update hourly. \(text).") }
                    }

                    Section("Latest events") {
                        if latest.isEmpty, !loading {
                            Text("No events yet.").foregroundStyle(.secondary)
                        }
                        ForEach(latest) { event in
                            NavigationLink(value: event) { EventRow(event: event) }
                        }
                    }
                }
            }
            .navigationTitle(model.selected?.host ?? "Overview")
            .navigationBarTitleDisplayMode(.inline)
            .navigationDestination(for: PurchaseEvent.self) { EventDetailView(event: $0) }
            .toolbar { ToolbarItem(placement: .topBarTrailing) { ScopeMenu() } }
            .refreshable { await load() }
            .task(id: model.scope) { await load() }
        }
    }

    private func load() async {
        guard let client = model.client else { return }
        loading = true
        defer { loading = false }
        let environment = model.environment
        let project = model.projectID
        let now = Date()
        // 56 days: this period and the one before it.
        let from = DayFormat.daysBefore(55, now)
        let to = DayFormat.string(now)
        do {
            async let events = client.events(environment: environment, project: project, limit: 8)
            var results: [Tile] = []
            var updated: Int64?
            try await withThrowingTaskGroup(of: (Int, ChartResult).self) { group in
                for (i, h) in Self.headlines.enumerated() {
                    group.addTask { (i, try await client.chart(h.chart, environment: environment, project: project, from: from, to: to, interval: .day)) }
                }
                var charts: [(Int, ChartResult)] = []
                for try await item in group { charts.append(item) }
                for (i, chart) in charts.sorted(by: { $0.0 < $1.0 }) {
                    results.append(Self.tile(Self.headlines[i], chart))
                    updated = updated ?? chart.updatedAt
                }
            }
            tiles = results
            updatedAt = updated
            latest = try await events.events
            error = nil
        } catch {
            model.handle(error)
            if !(error is CancellationError) { self.error = error }
        }
    }

    private static func tile(_ h: (chart: String, label: String, keys: [String], footnote: String), _ chart: ChartResult) -> Tile {
        let sum = { (p: ChartResult.Point) in h.keys.reduce(0) { $0 + chart.value(p, $1) } }
        let points = chart.points
        let half = points.count / 2
        let value: Double
        let previous: Double?
        if chart.kind == .running {
            value = points.last.map(sum) ?? 0
            previous = points.count > 28 ? sum(points[points.count - 29]) : nil
        } else {
            value = points.suffix(28).reduce(0) { $0 + sum($1) }
            previous = points.count >= 56 ? points.prefix(half).reduce(0) { $0 + sum($1) } : nil
        }
        return Tile(id: h.chart, label: h.label, value: value, previous: previous, unit: chart.unit, footnote: h.footnote)
    }
}

private struct TileView: View {
    let tile: OverviewView.Tile

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(tile.label).font(.footnote).foregroundStyle(.secondary).lineLimit(1)
            Text(tile.unit.format(tile.value, compact: true)).font(.title2.weight(.semibold)).monospacedDigit().lineLimit(1).minimumScaleFactor(0.7)
            if let change {
                Text(change.text)
                    .font(.caption.weight(.medium))
                    .foregroundStyle(change.color)
                    .accessibilityLabel("\(change.text) \(tile.footnote)")
            } else {
                Text(" ").font(.caption)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(.background.secondary, in: RoundedRectangle(cornerRadius: 12))
    }

    private var change: (text: String, color: Color)? {
        guard let previous = tile.previous else { return nil }
        let diff = tile.value - previous
        if previous == 0 { return diff == 0 ? ("No change", .secondary) : nil }
        let pct = diff / abs(previous)
        let text = (pct >= 0 ? "▲ " : "▼ ") + abs(pct).formatted(.percent.precision(.fractionLength(0...1)))
        return (text, pct > 0 ? Palette.tone(.good) : pct < 0 ? Palette.tone(.bad) : .secondary)
    }
}
