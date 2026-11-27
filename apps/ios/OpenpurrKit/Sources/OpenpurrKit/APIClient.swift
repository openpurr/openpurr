import Foundation

/// Sends HTTP requests. A protocol so tests can answer without a network.
public protocol HTTPTransport: Sendable {
    func send(_ request: URLRequest) async throws -> (Data, Int)
}

public struct URLSessionTransport: HTTPTransport {
    let session: URLSession

    public init(session: URLSession = .shared) { self.session = session }

    public func send(_ request: URLRequest) async throws -> (Data, Int) {
        let (data, response) = try await session.data(for: request)
        return (data, (response as? HTTPURLResponse)?.statusCode ?? 0)
    }
}

public enum APIError: LocalizedError, Equatable {
    /// The session ended (refresh token expired or revoked): sign in again.
    case signedOut
    /// The admin API answered an error.
    case http(Int, APIErrorBody?)

    public var errorDescription: String? {
        switch self {
        case .signedOut: "Your session ended. Sign in again."
        case let .http(status, body): body?.message ?? "The server answered HTTP \(status)."
        }
    }

    public static func == (a: APIError, b: APIError) -> Bool {
        switch (a, b) {
        case (.signedOut, .signedOut): true
        case let (.http(x, _), .http(y, _)): x == y
        default: false
        }
    }
}

/// Where a deployment's tokens are kept.
public protocol CredentialStore: Sendable {
    func load(_ deployment: Deployment) -> Credentials?
    func save(_ credentials: Credentials, for deployment: Deployment)
    func delete(_ deployment: Deployment)
}

/// The admin API of one deployment, as the signed-in operator. Access tokens are refreshed when
/// they expire, or once when a request gets a 401; one refresh at a time, since refresh tokens
/// rotate and a second refresh with the old one would fail.
public actor APIClient {
    public let deployment: Deployment
    let http: HTTPTransport
    let store: CredentialStore
    let oauth: OAuthClient
    let now: @Sendable () -> Date
    private var refreshing: Task<Credentials, Error>?

    public init(deployment: Deployment, store: CredentialStore, http: HTTPTransport = URLSessionTransport(), now: @escaping @Sendable () -> Date = Date.init) {
        self.deployment = deployment
        self.http = http
        self.store = store
        self.oauth = OAuthClient(deployment: deployment, http: http)
        self.now = now
    }

    // MARK: Endpoints

    public func me() async throws -> MeResponse { try await get("/me") }

    public func projects() async throws -> [Project] { (try await get("/projects") as ProjectsResponse).projects }

    public func events(environment: StoreEnvironment, project: String? = nil, types: [String] = [], cursor: String? = nil, limit: Int = 50) async throws -> EventPage {
        var query = [URLQueryItem(name: "environment", value: environment.rawValue), URLQueryItem(name: "limit", value: String(limit))]
        if let project { query.append(URLQueryItem(name: "project", value: project)) }
        if !types.isEmpty { query.append(URLQueryItem(name: "type", value: types.joined(separator: ","))) }
        if let cursor { query.append(URLQueryItem(name: "cursor", value: cursor)) }
        return try await get("/events", query)
    }

    public func event(_ id: String) async throws -> EventDetail { try await get("/events/" + Self.pathSegment(id)) }

    public func chartCatalog() async throws -> ChartCatalog { try await get("/metrics") }

    public func chart(_ id: String, environment: StoreEnvironment, project: String? = nil, from: String, to: String, interval: ChartInterval) async throws -> ChartResult {
        var query = [
            URLQueryItem(name: "environment", value: environment.rawValue),
            URLQueryItem(name: "from", value: from),
            URLQueryItem(name: "to", value: to),
            URLQueryItem(name: "interval", value: interval.rawValue),
        ]
        if let project { query.append(URLQueryItem(name: "project", value: project)) }
        return try await get("/metrics/" + Self.pathSegment(id), query)
    }

    /// Revokes the tokens and forgets them.
    public func signOut() async {
        if let credentials = store.load(deployment) { await oauth.revoke(credentials) }
        store.delete(deployment)
    }

    // MARK: Plumbing

    static func pathSegment(_ s: String) -> String {
        s.addingPercentEncoding(withAllowedCharacters: .alphanumerics.union(CharacterSet(charactersIn: "-._~"))) ?? s
    }

    func get<T: Decodable>(_ path: String, _ query: [URLQueryItem] = []) async throws -> T {
        var parts = URLComponents(url: deployment.origin.appending(path: "admin/v1"), resolvingAgainstBaseURL: false)!
        parts.percentEncodedPath += path
        if !query.isEmpty { parts.queryItems = query }
        var request = URLRequest(url: parts.url!)
        request.setValue("application/json", forHTTPHeaderField: "Accept")

        var credentials = try await current()
        var (data, status) = try await send(request, credentials)
        if status == 401 {
            credentials = try await refresh(after: credentials)
            (data, status) = try await send(request, credentials)
            if status == 401 { throw APIError.signedOut }
        }
        guard (200..<300).contains(status) else { throw APIError.http(status, try? JSONDecoder().decode(APIErrorBody.self, from: data)) }
        return try JSONDecoder().decode(T.self, from: data)
    }

    private func send(_ request: URLRequest, _ credentials: Credentials) async throws -> (Data, Int) {
        var r = request
        r.setValue("Bearer \(credentials.accessToken)", forHTTPHeaderField: "Authorization")
        return try await http.send(r)
    }

    /// Valid credentials: the stored ones, refreshed first if they've expired.
    private func current() async throws -> Credentials {
        guard let stored = store.load(deployment) else { throw APIError.signedOut }
        return stored.isExpired(now: now()) ? try await refresh(after: stored) : stored
    }

    /// Refreshes `stale`, unless another request already did.
    private func refresh(after stale: Credentials) async throws -> Credentials {
        if let task = refreshing { return try await task.value }
        if let stored = store.load(deployment), stored != stale, !stored.isExpired(now: now()) { return stored }
        let task = Task { [oauth, store, deployment, now] in
            do {
                let fresh = try await oauth.refresh(stale, now: now())
                store.save(fresh, for: deployment)
                return fresh
            } catch APIError.signedOut {
                store.delete(deployment)
                throw APIError.signedOut
            }
        }
        refreshing = task
        defer { refreshing = nil }
        return try await task.value
    }
}
