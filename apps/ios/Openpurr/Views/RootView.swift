import OpenpurrKit
import SwiftUI

struct RootView: View {
    @Environment(AppModel.self) private var model
    /// The launch argument `-OpenpurrDevTab 2` starts on that tab (screenshots).
    @State private var tab = UserDefaults.standard.integer(forKey: "OpenpurrDevTab")

    var body: some View {
        if model.deployments.isEmpty {
            ConnectView()
        } else {
            TabView(selection: $tab) {
                signedIn { OverviewView() }.tabItem { Label("Overview", systemImage: "chart.bar.xaxis") }.tag(0)
                signedIn { FeedView() }.tabItem { Label("Events", systemImage: "list.bullet.rectangle") }.tag(1)
                signedIn { ChartsView() }.tabItem { Label("Charts", systemImage: "chart.xyaxis.line") }.tag(2)
                SettingsView().tabItem { Label("Settings", systemImage: "gearshape") }.tag(3)
            }
        }
    }

    @ViewBuilder
    private func signedIn(@ViewBuilder _ content: () -> some View) -> some View {
        if model.isSignedOut {
            NavigationStack { SignInAgainView() }
        } else {
            content()
        }
    }
}
