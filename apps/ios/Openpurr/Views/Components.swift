import AuthenticationServices
import OpenpurrKit
import SwiftUI

/// Series colors, the dashboard's (lite/office-ui/app.css --chart-*), light and dark.
enum Palette {
    static let series: [Color] = [
        Color(light: 0x7050E8, dark: 0x9179FF),
        Color(light: 0xEB6834, dark: 0xD95926),
        Color(light: 0x2A78D6, dark: 0x3987E5),
        Color(light: 0x1BAF7A, dark: 0x199E70),
        Color(light: 0xEDA100, dark: 0xC98500),
        Color(light: 0xE87BA4, dark: 0xD55181),
    ]

    static func series(_ i: Int) -> Color { series[i % series.count] }

    static func tone(_ tone: EventTone) -> Color {
        switch tone {
        case .good: Color(light: 0x1BAF7A, dark: 0x199E70)
        case .bad: Color(light: 0xEB6834, dark: 0xD95926)
        case .neutral: .secondary
        }
    }
}

extension Color {
    init(light: UInt32, dark: UInt32) {
        self.init(uiColor: UIColor { traits in
            let hex = traits.userInterfaceStyle == .dark ? dark : light
            return UIColor(red: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255, blue: CGFloat(hex & 0xFF) / 255, alpha: 1)
        })
    }
}

/// The toolbar menu every data screen has: which project, and production or sandbox.
struct ScopeMenu: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        @Bindable var model = model
        Menu {
            if model.projects.count > 1 {
                Picker("Project", selection: $model.projectID) {
                    Text("All projects").tag(String?.none)
                    ForEach(model.projects) { Text($0.name).tag(Optional($0.id)) }
                }
            }
            Picker("Environment", selection: $model.environment) {
                Text("Production").tag(StoreEnvironment.production)
                Text("Sandbox").tag(StoreEnvironment.sandbox)
            }
        } label: {
            Label(label, systemImage: "line.3.horizontal.decrease.circle")
                .labelStyle(.titleAndIcon)
                .font(.subheadline)
        }
        .task(id: model.selectedID) { if model.projects.isEmpty { await model.loadProjects() } }
    }

    private var label: String {
        let parts = [model.selectedProject?.name, model.environment == .sandbox ? "Sandbox" : nil].compactMap { $0 }
        return parts.isEmpty ? "All" : parts.joined(separator: " · ")
    }
}

/// What a screen shows when loading failed.
struct ErrorState: View {
    let error: Error
    let retry: () async -> Void

    var body: some View {
        ContentUnavailableView {
            Label("Couldn't load this", systemImage: "exclamationmark.triangle")
        } description: {
            Text(error.localizedDescription)
        } actions: {
            Button("Try again") { Task { await retry() } }
        }
    }
}

/// Shown instead of a screen when the deployment's session ended.
struct SignInAgainView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.webAuthenticationSession) private var webAuthenticationSession
    @State private var error: Error?
    @State private var busy = false

    var body: some View {
        ContentUnavailableView {
            Label("Signed out", systemImage: "person.crop.circle.badge.exclamationmark")
        } description: {
            Text("Your session with \(model.selected?.host ?? "this deployment") ended. Sign in again to see its data.")
            if let error { Text(error.localizedDescription).foregroundStyle(.red) }
        } actions: {
            Button {
                Task { await signIn() }
            } label: {
                if busy { ProgressView() } else { Text("Sign in") }
            }
            .buttonStyle(.borderedProminent)
            .disabled(busy)
        }
    }

    private func signIn() async {
        guard let deployment = model.selected else { return }
        busy = true
        defer { busy = false }
        do {
            try await model.signIn(address: deployment.origin.absoluteString, authenticate: webAuthenticationSession.openpurr)
            error = nil
        } catch {
            if !error.isCancellation { self.error = error }
        }
    }
}

extension WebAuthenticationSession {
    /// Opens the sign-in page; returns the callback URL (https://<host>/app/oauth-callback?...).
    func openpurr(_ url: URL, host: String) async throws -> URL {
        try await authenticate(using: url, callback: .https(host: host, path: Deployment.callbackPath), preferredBrowserSession: .shared, additionalHeaderFields: [:])
    }
}

extension Error {
    /// The operator closed the sign-in sheet.
    var isCancellation: Bool {
        (self as? ASWebAuthenticationSessionError)?.code == .canceledLogin || self is CancellationError
    }
}

/// "Updated 12 minutes ago" for a rollup time in epoch milliseconds.
func updatedText(_ ms: Int64?) -> String? {
    guard let ms else { return nil }
    let date = Date(timeIntervalSince1970: Double(ms) / 1000)
    return "Updated " + date.formatted(.relative(presentation: .named))
}
