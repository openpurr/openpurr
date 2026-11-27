import AuthenticationServices
import Foundation
import Observation
import OpenpurrKit

/// The app's state: the deployments signed in to, which one is showing, and the filters every
/// screen shares (project and environment).
@MainActor @Observable
final class AppModel {
    private(set) var deployments: [Deployment] = []
    private(set) var selectedID: String?
    /// Deployments whose session ended; they stay listed so the operator can sign in again.
    private(set) var signedOut: Set<String> = []
    private(set) var projects: [Project] = []

    var environment: StoreEnvironment {
        didSet { defaults.set(environment.rawValue, forKey: "environment") }
    }

    /// nil: every project.
    var projectID: String? {
        didSet { defaults.set(projectID, forKey: "project.\(selectedID ?? "")") }
    }

    private let store: CredentialStore
    private let defaults: UserDefaults
    private var clients: [String: APIClient] = [:]

    init(store: CredentialStore = KeychainStore(), defaults: UserDefaults = .standard) {
        #if DEBUG
        // Development against a local back office (wrangler dev, or Standard on localhost), which
        // can't do the HTTPS sign-in: launch with
        //   -OpenpurrDevServer http://127.0.0.1:8787 -OpenpurrDevToken pat_...
        // (a personal access token). Nothing is saved; Debug builds only.
        if let server = defaults.string(forKey: "OpenpurrDevServer").flatMap(URL.init(string:)), let token = defaults.string(forKey: "OpenpurrDevToken") {
            let dev = Deployment(origin: server, operatorEmail: "personal access token", operatorName: nil)
            let memory = MemoryStore()
            memory.save(Credentials(accessToken: token, refreshToken: "", expiresAt: .distantFuture), for: dev)
            self.store = memory
            self.defaults = UserDefaults(suiteName: "openpurr.dev") ?? defaults
            environment = .production
            deployments = [dev]
            selectedID = dev.id
            return
        }
        #endif
        self.store = store
        self.defaults = defaults
        environment = defaults.string(forKey: "environment").flatMap(StoreEnvironment.init(rawValue:)) ?? .production
        if let data = defaults.data(forKey: "deployments"), let saved = try? JSONDecoder().decode([Deployment].self, from: data) {
            deployments = saved
        }
        selectedID = defaults.string(forKey: "selected").flatMap { id in deployments.contains { $0.id == id } ? id : nil } ?? deployments.first?.id
        signedOut = Set(deployments.filter { store.load($0) == nil }.map(\.id))
        projectID = defaults.string(forKey: "project.\(selectedID ?? "")")
    }

    var selected: Deployment? { deployments.first { $0.id == selectedID } }

    /// The admin API of the deployment showing; nil when none is.
    var client: APIClient? {
        guard let selected else { return nil }
        if let client = clients[selected.id] { return client }
        let client = APIClient(deployment: selected, store: store)
        clients[selected.id] = client
        return client
    }

    var isSignedOut: Bool { selectedID.map { signedOut.contains($0) } ?? true }

    /// Changes whenever what screens show should reload.
    var scope: String { "\(selectedID ?? "")|\(environment.rawValue)|\(projectID ?? "*")|\(isSignedOut)" }

    var selectedProject: Project? { projects.first { $0.id == projectID } }

    // MARK: Signing in and out

    /// Signs in to the deployment at `address` (new, or one whose session ended) and shows it.
    /// `authenticate` opens the sign-in page and returns the callback URL.
    func signIn(address: String, authenticate: (URL, String) async throws -> URL) async throws {
        guard var deployment = Deployment.parse(address) else { throw SignInError.notOpenpurr(address) }
        let oauth = OAuthClient(deployment: deployment)
        let attempt = try await oauth.begin()
        let callback = try await authenticate(attempt.authorizeURL, deployment.host)
        let credentials = try await oauth.exchange(attempt, code: attempt.code(from: callback))
        store.save(credentials, for: deployment)

        let client = APIClient(deployment: deployment, store: store)
        let me = try await client.me()
        deployment.operatorEmail = me.operator.email
        deployment.operatorName = me.operator.name
        clients[deployment.id] = client
        if let i = deployments.firstIndex(where: { $0.id == deployment.id }) { deployments[i] = deployment } else { deployments.append(deployment) }
        signedOut.remove(deployment.id)
        select(deployment)
        save()
    }

    func select(_ deployment: Deployment) {
        guard selectedID != deployment.id else { return }
        selectedID = deployment.id
        defaults.set(deployment.id, forKey: "selected")
        projects = []
        projectID = defaults.string(forKey: "project.\(deployment.id)")
    }

    /// Ends the session (revoking its tokens) and forgets the deployment.
    func remove(_ deployment: Deployment) async {
        await (clients[deployment.id] ?? APIClient(deployment: deployment, store: store)).signOut()
        clients[deployment.id] = nil
        deployments.removeAll { $0.id == deployment.id }
        signedOut.remove(deployment.id)
        if selectedID == deployment.id {
            selectedID = nil
            if let next = deployments.first { select(next) }
        }
        save()
    }

    /// Call with any error a request threw: a session that ended marks the deployment signed out.
    func handle(_ error: Error) {
        if let api = error as? APIError, api == .signedOut, let id = selectedID { signedOut.insert(id) }
    }

    func loadProjects() async {
        guard let client else { return }
        do {
            projects = try await client.projects()
            if let id = projectID, !projects.contains(where: { $0.id == id }) { projectID = nil }
        } catch {
            handle(error)
        }
    }

    private func save() {
        #if DEBUG
        if defaults.string(forKey: "OpenpurrDevToken") != nil { return }
        #endif
        defaults.set(try? JSONEncoder().encode(deployments), forKey: "deployments")
    }
}
