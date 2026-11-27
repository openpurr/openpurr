import OpenpurrKit
import SwiftUI

/// One event: its fields, and the full RevenueCat-shaped body your webhooks get.
struct EventDetailView: View {
    @Environment(AppModel.self) private var model
    let event: PurchaseEvent
    @State private var body_: JSONValue?
    @State private var error: Error?

    var body: some View {
        List {
            Section {
                row("Product", event.productId)
                if let newProduct = event.newProductId { row("New product", newProduct) }
                row("Price", event.localPrice)
                if let usd = event.usdPrice { row("In USD", usd) }
                row("Period", event.periodType?.capitalized)
                row("Store", event.storeName)
                row("Country", [event.flag, event.countryCode].compactMap { $0 }.joined(separator: " "))
                if event.isFamilyShare == true { row("Family Sharing", "Yes") }
                if let reason = event.cancelReason { row("Reason", reason.replacingOccurrences(of: "_", with: " ").capitalized) }
                if let reason = event.expirationReason { row("Reason", reason.replacingOccurrences(of: "_", with: " ").capitalized) }
            }
            Section {
                if let user = event.appUserId {
                    LabeledContent("Customer") {
                        Text(user).textSelection(.enabled).lineLimit(1).truncationMode(.middle)
                    }
                }
                row("App", event.appId)
                row("Project", model.projects.first { $0.id == event.projectId }?.name ?? event.projectId)
                row("Environment", event.environment.capitalized)
                LabeledContent("Recorded", value: event.date.formatted(date: .abbreviated, time: .standard))
            }
            Section {
                if let body_ {
                    DisclosureGroup("Webhook body") {
                        ScrollView(.horizontal) {
                            Text(body_.pretty())
                                .font(.caption.monospaced())
                                .textSelection(.enabled)
                                .padding(.vertical, 4)
                        }
                    }
                } else if let error {
                    Text(error.localizedDescription).foregroundStyle(.secondary)
                } else {
                    ProgressView()
                }
            } footer: {
                Text("Event \(event.id). Your webhooks get the same body.")
            }
        }
        .navigationTitle(event.title)
        .navigationBarTitleDisplayMode(.inline)
        .task {
            guard body_ == nil, let client = model.client else { return }
            do {
                body_ = try await client.event(event.id).body
            } catch {
                model.handle(error)
                self.error = error
            }
        }
    }

    @ViewBuilder
    private func row(_ label: String, _ value: String?) -> some View {
        if let value, !value.isEmpty { LabeledContent(label, value: value) }
    }
}
