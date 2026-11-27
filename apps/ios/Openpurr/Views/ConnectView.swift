import OpenpurrKit
import SwiftUI

/// Signing in to a deployment: its address, then the deployment's own sign-in and consent pages.
struct ConnectView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.webAuthenticationSession) private var webAuthenticationSession
    @Environment(\.dismiss) private var dismiss
    /// Shown as a sheet (adding a second deployment) rather than as the first screen.
    var isSheet = false

    @State private var address = ""
    @State private var busy = false
    @State private var error: Error?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("admin.example.com", text: $address)
                        .textContentType(.URL)
                        .keyboardType(.URL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .submitLabel(.go)
                        .onSubmit { Task { await signIn() } }
                } header: {
                    Text("Your openpurr deployment")
                } footer: {
                    Text("The address you open the openpurr dashboard at (on Lite, the back office's address, not the SDK's). You'll sign in on the dashboard's own page; the app only gets read access.")
                }

                if let error {
                    Section { Text(error.localizedDescription).foregroundStyle(.red) }
                }

                Section {
                    Button {
                        Task { await signIn() }
                    } label: {
                        HStack {
                            Text("Sign in")
                            if busy {
                                Spacer()
                                ProgressView()
                            }
                        }
                    }
                    .disabled(busy || Deployment.parse(address) == nil)
                }
            }
            .navigationTitle(isSheet ? "Add a deployment" : "openpurr")
            .toolbar {
                if isSheet {
                    ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                }
            }
        }
    }

    private func signIn() async {
        guard !busy, Deployment.parse(address) != nil else { return }
        busy = true
        defer { busy = false }
        do {
            try await model.signIn(address: address, authenticate: webAuthenticationSession.openpurr)
            error = nil
            if isSheet { dismiss() }
        } catch {
            if !error.isCancellation { self.error = error }
        }
    }
}
