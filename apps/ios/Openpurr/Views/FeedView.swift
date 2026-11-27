import OpenpurrKit
import SwiftUI

/// Every purchase event, newest first, a page at a time.
struct FeedView: View {
    @Environment(AppModel.self) private var model
    @State private var events: [PurchaseEvent] = []
    @State private var cursor: String?
    @State private var finished = false
    @State private var loading = false
    @State private var error: Error?

    /// Server-side filter: the event types to show (empty: every type).
    @AppStorage("feed.types") private var typesRaw = ""
    /// Client-side filters, the ones RevenueCat's app doesn't have.
    @AppStorage("feed.hideFamilySharing") private var hideFamilySharing = false
    @AppStorage("feed.hideFree") private var hideFree = false

    private var types: [String] { typesRaw.split(separator: ",").map(String.init) }

    private var visible: [PurchaseEvent] {
        events.filter { !(hideFamilySharing && $0.isFamilyShare == true) && !(hideFree && $0.isFree) }
    }

    private var days: [(day: Date, events: [PurchaseEvent])] {
        let calendar = Calendar.current
        return Dictionary(grouping: visible) { calendar.startOfDay(for: $0.date) }
            .map { ($0.key, $0.value) }
            .sorted { $0.day > $1.day }
    }

    var body: some View {
        NavigationStack {
            List {
                if let error, events.isEmpty {
                    ErrorState(error: error) { await reload() }
                } else if events.isEmpty, finished {
                    ContentUnavailableView("No events", systemImage: "tray", description: Text(model.environment == .sandbox ? "No sandbox purchases match these filters." : "No purchases match these filters yet."))
                }
                ForEach(days, id: \.day) { day in
                    Section(day.day.formatted(.dateTime.weekday(.wide).month().day())) {
                        ForEach(day.events) { event in
                            NavigationLink(value: event) { EventRow(event: event) }
                        }
                    }
                }
                if !finished, !events.isEmpty || loading {
                    HStack {
                        Spacer()
                        ProgressView()
                        Spacer()
                    }
                    .listRowBackground(Color.clear)
                    .task(id: cursor) { await loadMore() }
                }
                if let error, !events.isEmpty {
                    Button("Couldn't load more: \(error.localizedDescription). Try again") { Task { await loadMore() } }
                        .font(.footnote)
                }
            }
            .navigationTitle("Events")
            .navigationDestination(for: PurchaseEvent.self) { EventDetailView(event: $0) }
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { filterMenu }
                ToolbarItem(placement: .topBarTrailing) { ScopeMenu() }
            }
            .refreshable { await reload() }
            .task(id: "\(model.scope)|\(typesRaw)") { await reload() }
        }
    }

    private var filterMenu: some View {
        Menu {
            Section("Show") {
                Button {
                    typesRaw = ""
                } label: {
                    if types.isEmpty { Label("Every event", systemImage: "checkmark") } else { Text("Every event") }
                }
                ForEach(eventTypeFilters, id: \.type) { filter in
                    Button {
                        toggle(filter.type)
                    } label: {
                        if types.contains(filter.type) { Label(filter.label, systemImage: "checkmark") } else { Text(filter.label) }
                    }
                }
            }
            Section("Hide") {
                Toggle("Family Sharing purchases", isOn: $hideFamilySharing)
                Toggle("$0 events (trials, offer codes)", isOn: $hideFree)
            }
        } label: {
            Image(systemName: types.isEmpty && !hideFamilySharing && !hideFree ? "slider.horizontal.3" : "slider.horizontal.3.circle.fill")
                .accessibilityLabel("Filter events")
        }
    }

    private func toggle(_ type: String) {
        var set = types
        if let i = set.firstIndex(of: type) { set.remove(at: i) } else { set.append(type) }
        typesRaw = set.joined(separator: ",")
    }

    private func reload() async {
        cursor = nil
        finished = false
        await load(replace: true)
    }

    private func loadMore() async {
        guard !finished, !loading, cursor != nil || events.isEmpty else { return }
        await load(replace: false)
    }

    private func load(replace: Bool) async {
        guard let client = model.client else { return }
        loading = true
        defer { loading = false }
        do {
            let page = try await client.events(environment: model.environment, project: model.projectID, types: types, cursor: replace ? nil : cursor)
            events = replace ? page.events : events + page.events
            cursor = page.nextCursor
            finished = page.nextCursor == nil
            error = nil
        } catch {
            model.handle(error)
            if !(error is CancellationError) { self.error = error }
        }
    }
}

/// One event in a list: what happened, which app, how much, when.
struct EventRow: View {
    let event: PurchaseEvent

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: icon)
                .font(.title3)
                .foregroundStyle(Palette.tone(event.tone))
                .frame(width: 28)
            VStack(alignment: .leading, spacing: 2) {
                HStack(alignment: .firstTextBaseline) {
                    Text(event.title).font(.subheadline.weight(.semibold))
                    Spacer()
                    Text(event.date, format: .relative(presentation: .numeric)).font(.caption).foregroundStyle(.secondary)
                }
                Text(event.summary).font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
                HStack(spacing: 6) {
                    Text(event.appId)
                    if event.isFamilyShare == true { Text("· Family Sharing") }
                    if event.environment == "sandbox" { Text("· Sandbox") }
                }
                .font(.caption)
                .foregroundStyle(.tertiary)
            }
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine)
    }

    private var icon: String {
        switch event.type {
        case "INITIAL_PURCHASE": event.periodType == "TRIAL" ? "gift" : "star.circle.fill"
        case "RENEWAL": "arrow.triangle.2.circlepath"
        case "NON_RENEWING_PURCHASE": "bag.fill"
        case "CANCELLATION": event.title == "Refund" ? "arrow.uturn.backward.circle" : "xmark.circle"
        case "UNCANCELLATION": "arrow.uturn.forward.circle"
        case "EXPIRATION": "clock.badge.xmark"
        case "BILLING_ISSUE": "creditcard.trianglebadge.exclamationmark"
        case "PRODUCT_CHANGE": "arrow.left.arrow.right"
        case "TRANSFER": "person.2"
        default: "circle"
        }
    }
}
