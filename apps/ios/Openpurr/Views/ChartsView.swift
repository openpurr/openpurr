import Charts
import OpenpurrKit
import SwiftUI

/// The dashboard's charts.
struct ChartsView: View {
    @Environment(AppModel.self) private var model
    @State private var catalog: ChartCatalog?
    @State private var error: Error?
    @State private var path: [ChartCatalog.Chart] = []

    /// The charts, grouped as the dashboard groups them.
    private static let groups: [(title: String, ids: [String])] = [
        ("Revenue", ["revenue", "mrr", "arr", "mrr_movement"]),
        ("Subscriptions", ["active_subscriptions", "paid_subscriptions", "subscription_movement", "subscription_status", "churn"]),
        ("Trials", ["active_trials", "new_trials", "trial_movement"]),
        ("Customers and purchases", ["new_customers", "non_subscription_purchases", "refunds", "refund_rate"]),
    ]

    var body: some View {
        NavigationStack(path: $path) {
            List {
                if let catalog {
                    ForEach(sections(catalog), id: \.title) { section in
                        Section(section.title) {
                            ForEach(section.charts) { chart in
                                NavigationLink(value: chart) {
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(chart.label)
                                        Text(chart.description).font(.caption).foregroundStyle(.secondary).lineLimit(2)
                                    }
                                }
                            }
                        }
                    }
                } else if let error {
                    ErrorState(error: error) { await load() }
                } else {
                    ProgressView().frame(maxWidth: .infinity)
                }
            }
            .navigationTitle("Charts")
            .navigationDestination(for: ChartCatalog.Chart.self) { ChartDetailView(chart: $0) }
            .toolbar { ToolbarItem(placement: .topBarTrailing) { ScopeMenu() } }
            .task(id: model.selectedID) { await load() }
            .refreshable { await load() }
        }
    }

    private func sections(_ catalog: ChartCatalog) -> [(title: String, charts: [ChartCatalog.Chart])] {
        var placed = Set<String>()
        var out = Self.groups.map { group in
            (title: group.title, charts: group.ids.compactMap { id in catalog.charts.first { $0.id == id } }.map { placed.insert($0.id); return $0 })
        }
        // Charts a newer server added.
        let others = catalog.charts.filter { !placed.contains($0.id) }
        if !others.isEmpty { out.append((title: "More", charts: others)) }
        return out.filter { !$0.charts.isEmpty }
    }

    private func load() async {
        guard let client = model.client else { return }
        do {
            let loaded = try await client.chartCatalog()
            catalog = loaded
            error = nil
            // The launch argument `-OpenpurrDevChart mrr` opens that chart (screenshots).
            if path.isEmpty, let id = UserDefaults.standard.string(forKey: "OpenpurrDevChart"), let chart = loaded.charts.first(where: { $0.id == id }) {
                path = [chart]
            }
        } catch {
            model.handle(error)
            if !(error is CancellationError) { self.error = error }
        }
    }
}

/// One chart over a range: a line for levels, columns for per-period totals, bars for a breakdown.
struct ChartDetailView: View {
    @Environment(AppModel.self) private var model
    let chart: ChartCatalog.Chart
    @AppStorage("chart.range") private var range: ChartRange = .month
    @State private var result: ChartResult?
    @State private var error: Error?
    @State private var selectedDate: Date?

    var body: some View {
        List {
            Section {
                if chart.kind != .breakdown {
                    Picker("Range", selection: $range) {
                        ForEach(ChartRange.allCases) { Text($0.rawValue).tag($0) }
                    }
                    .pickerStyle(.segmented)
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets())
                }
            }
            Section {
                if let result {
                    headline(result)
                    plot(result)
                        .frame(height: 240)
                        .padding(.vertical, 8)
                    if result.series.count > 1, result.kind != .breakdown { legend(result) }
                } else if let error {
                    ErrorState(error: error) { await load() }
                } else {
                    ProgressView().frame(maxWidth: .infinity, minHeight: 280)
                }
            } footer: {
                VStack(alignment: .leading, spacing: 6) {
                    Text(chart.description)
                    ForEach(result?.notes ?? [], id: \.self) { Text($0) }
                    if let text = updatedText(result?.updatedAt) { Text(text) }
                }
            }
        }
        .navigationTitle(chart.label)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { ToolbarItem(placement: .topBarTrailing) { ScopeMenu() } }
        .task(id: "\(model.scope)|\(range.rawValue)") { await load() }
        .refreshable { await load() }
    }

    private func load() async {
        guard let client = model.client else { return }
        let bounds = range.bounds()
        do {
            result = try await client.chart(chart.id, environment: model.environment, project: model.projectID, from: bounds.from, to: bounds.to, interval: range.interval)
            error = nil
        } catch {
            model.handle(error)
            if !(error is CancellationError) { self.error = error }
        }
    }

    // MARK: Pieces

    /// The number at the top: the selected period's, else the latest level or the range's total.
    @ViewBuilder
    private func headline(_ r: ChartResult) -> some View {
        let key = r.series.first?.key ?? ""
        let point = selectedDate.flatMap { d in r.points.last { DayFormat.date($0.date).map { $0 <= d } ?? false } }
        VStack(alignment: .leading, spacing: 2) {
            switch r.kind {
            case .breakdown:
                Text(r.unit.format(r.categories?.reduce(0) { $0 + $1.value } ?? 0)).font(.largeTitle.weight(.semibold)).monospacedDigit()
                Text("Right now").font(.footnote).foregroundStyle(.secondary)
            case .running:
                Text(r.unit.format(point.map { r.value($0, key) } ?? r.latest(key) ?? 0)).font(.largeTitle.weight(.semibold)).monospacedDigit()
                Text(point.map { periodLabel($0.date, r.interval) } ?? "Now").font(.footnote).foregroundStyle(.secondary)
            case .flow:
                if r.unit == .percent {
                    // Rates don't add up: show the selected or latest period's.
                    Text(r.unit.format(point.map { r.value($0, key) } ?? r.latest(key) ?? 0)).font(.largeTitle.weight(.semibold)).monospacedDigit()
                    Text(point.map { periodLabel($0.date, r.interval) } ?? "Latest period").font(.footnote).foregroundStyle(.secondary)
                } else {
                    Text(r.unit.format(point.map { r.value($0, key) } ?? r.total(key))).font(.largeTitle.weight(.semibold)).monospacedDigit()
                    // With several series the number is the first one's: say which.
                    let period = point.map { periodLabel($0.date, r.interval) } ?? "last \(range.rawValue.replacingOccurrences(of: "D", with: " days").replacingOccurrences(of: "M", with: " months"))"
                    Text(r.series.count > 1 ? "\(r.series[0].label), \(period)" : period.prefix(1).uppercased() + period.dropFirst())
                        .font(.footnote).foregroundStyle(.secondary)
                }
            }
        }
    }

    @ViewBuilder
    private func plot(_ r: ChartResult) -> some View {
        switch r.kind {
        case .breakdown:
            Chart(r.categories ?? [], id: \.key) { c in
                BarMark(x: .value("Count", c.value), y: .value("Status", c.label))
                    .foregroundStyle(Palette.series(0))
                    .annotation(position: .trailing) { Text(r.unit.format(c.value)).font(.caption).foregroundStyle(.secondary) }
            }
            .chartXAxis(.hidden)
        case .running, .flow:
            let rows = r.points.flatMap { p in
                r.series.enumerated().compactMap { i, s in DayFormat.date(p.date).map { PlotRow(date: $0, series: s.label, index: i, value: r.value(p, s.key)) } }
            }
            Chart(rows) { row in
                if r.kind == .running {
                    LineMark(x: .value("Date", row.date, unit: calendarUnit(r.interval)), y: .value(row.series, row.value))
                        .foregroundStyle(by: .value("Series", row.series))
                        .interpolationMethod(.monotone)
                    if r.series.count == 1 {
                        AreaMark(x: .value("Date", row.date, unit: calendarUnit(r.interval)), y: .value(row.series, row.value))
                            .foregroundStyle(Palette.series(0).opacity(0.12))
                            .interpolationMethod(.monotone)
                    }
                } else {
                    BarMark(x: .value("Date", row.date, unit: calendarUnit(r.interval)), y: .value(row.series, row.value))
                        .foregroundStyle(by: .value("Series", row.series))
                }
                if let selectedDate, Calendar.current.isDate(selectedDate, equalTo: row.date, toGranularity: calendarUnit(r.interval)), row.index == 0 {
                    RuleMark(x: .value("Selected", row.date, unit: calendarUnit(r.interval))).foregroundStyle(.secondary.opacity(0.4))
                }
            }
            .chartForegroundStyleScale(domain: r.series.map(\.label), range: r.series.indices.map { Palette.series($0) })
            .chartLegend(.hidden)
            .chartYAxis {
                AxisMarks(position: .leading) { value in
                    AxisGridLine()
                    AxisValueLabel { if let v = value.as(Double.self) { Text(r.unit.format(v, compact: true)) } }
                }
            }
            .chartXSelection(value: $selectedDate)
        }
    }

    private func legend(_ r: ChartResult) -> some View {
        FlowLayout(spacing: 14, lineSpacing: 6) {
            ForEach(Array(r.series.enumerated()), id: \.offset) { i, s in
                HStack(spacing: 6) {
                    Circle().fill(Palette.series(i)).frame(width: 8, height: 8)
                    Text(s.label).font(.caption).fixedSize()
                    if let selectedDate, let p = r.points.last(where: { DayFormat.date($0.date).map { $0 <= selectedDate } ?? false }) {
                        Text(r.unit.format(r.value(p, s.key), compact: true)).font(.caption.weight(.semibold)).monospacedDigit()
                    }
                }
            }
        }
    }

    private func calendarUnit(_ interval: ChartInterval) -> Calendar.Component {
        switch interval {
        case .day: .day
        case .week: .weekOfYear
        case .month: .month
        }
    }

    private func periodLabel(_ day: String, _ interval: ChartInterval) -> String {
        guard let date = DayFormat.date(day) else { return day }
        switch interval {
        case .day: return date.formatted(.dateTime.month().day().year())
        case .week: return "Week of " + date.formatted(.dateTime.month().day())
        case .month: return date.formatted(.dateTime.month(.wide).year())
        }
    }
}

/// Lays children out in rows, wrapping to the next line when a row is full (the legend).
private struct FlowLayout: Layout {
    var spacing: CGFloat
    var lineSpacing: CGFloat

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        rows(proposal.width ?? .infinity, subviews).size
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        for (index, origin) in rows(bounds.width, subviews).origins {
            subviews[index].place(at: CGPoint(x: bounds.minX + origin.x, y: bounds.minY + origin.y), proposal: .unspecified)
        }
    }

    private func rows(_ width: CGFloat, _ subviews: Subviews) -> (size: CGSize, origins: [(Int, CGPoint)]) {
        var origins: [(Int, CGPoint)] = []
        var x: CGFloat = 0, y: CGFloat = 0, rowHeight: CGFloat = 0, widest: CGFloat = 0
        for (i, view) in subviews.enumerated() {
            let size = view.sizeThatFits(.unspecified)
            if x > 0, x + size.width > width {
                x = 0
                y += rowHeight + lineSpacing
                rowHeight = 0
            }
            origins.append((i, CGPoint(x: x, y: y)))
            x += size.width + spacing
            widest = max(widest, x - spacing)
            rowHeight = max(rowHeight, size.height)
        }
        return (CGSize(width: widest, height: y + rowHeight), origins)
    }
}

/// One series' value in one period.
private struct PlotRow: Identifiable {
    let date: Date
    let series: String
    let index: Int
    let value: Double
    var id: String { "\(date.timeIntervalSince1970)|\(index)" }
}
