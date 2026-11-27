import OpenpurrKit
import SwiftUI

struct SettingsView: View {
    @Environment(AppModel.self) private var model
    @State private var adding = false
    @State private var removing: Deployment?

    var body: some View {
        NavigationStack {
            List {
                Section {
                    ForEach(model.deployments) { deployment in
                        Button {
                            model.select(deployment)
                        } label: {
                            HStack {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(deployment.host).foregroundStyle(.primary)
                                    Text(model.signedOut.contains(deployment.id) ? "Signed out" : deployment.operatorEmail ?? "")
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                                Spacer()
                                if deployment.id == model.selectedID { Image(systemName: "checkmark").foregroundStyle(.tint) }
                            }
                        }
                        .tint(.primary)
                        .swipeActions {
                            Button("Sign out", role: .destructive) { removing = deployment }
                        }
                    }
                    Button("Add a deployment") { adding = true }
                } header: {
                    Text("Deployments")
                } footer: {
                    Text("Swipe a deployment to sign out of it. The app has read-only access; you can also disconnect it on the dashboard, under Access tokens.")
                }

                Section {
                    Label {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Purchase alerts")
                            Text("Push notifications for new purchases aren't available yet. Your deployment will send them itself, to your own build of this app, once push is set up.")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    } icon: {
                        Image(systemName: "bell.badge")
                    }
                } header: {
                    Text("Notifications")
                }

                Section {
                    LabeledContent("Version", value: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "")
                    Link("openpurr on GitHub", destination: URL(string: "https://github.com/openpurr/openpurr")!)
                }
            }
            .navigationTitle("Settings")
            .sheet(isPresented: $adding) { ConnectView(isSheet: true) }
            .confirmationDialog("Sign out of \(removing?.host ?? "")?", isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }), titleVisibility: .visible) {
                Button("Sign out", role: .destructive) {
                    if let removing { Task { await model.remove(removing) } }
                }
            } message: {
                Text("This ends the app's session with the deployment and removes it from the app.")
            }
        }
    }
}
