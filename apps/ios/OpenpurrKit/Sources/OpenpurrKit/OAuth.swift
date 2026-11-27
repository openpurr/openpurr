import CryptoKit
import Foundation

// Signing in to a deployment: OAuth 2.1 with PKCE against the deployment's own authorization server
// (lite/src/office/oauth.ts, standard/internal/server/oauth.go).
//
// - The client is the deployment's own description of this app, /app/ios-client.json, so nothing
//   needs registering. Each operator builds the app under their own Apple team, and the deployment
//   serves the matching apple-app-site-association (the ios_app_id setting).
// - Sign-in returns to https://<deployment>/app/oauth-callback, a Universal Link that
//   ASWebAuthenticationSession catches.
// - Tokens are issued for resource=<deployment>/admin/v1 with the read scope: they work at the
//   admin API and nowhere else, limited by the operator's role.

/// An openpurr deployment, identified by its origin (https://purchases.example.com).
public struct Deployment: Codable, Sendable, Hashable, Identifiable {
    public let origin: URL
    public var operatorEmail: String?
    public var operatorName: String?

    public var id: String { origin.absoluteString }
    public var host: String { origin.host() ?? origin.absoluteString }

    public init(origin: URL, operatorEmail: String? = nil, operatorName: String? = nil) {
        self.origin = origin
        self.operatorEmail = operatorEmail
        self.operatorName = operatorName
    }

    public var clientId: String { origin.absoluteString + "/app/ios-client.json" }
    public var redirectURI: String { origin.absoluteString + Self.callbackPath }
    public var resource: String { origin.absoluteString + "/admin/v1" }
    public static let callbackPath = "/app/oauth-callback"

    /// The deployment for what someone typed: "purchases.example.com", "https://purchases.example.com/admin", ...
    /// HTTPS only (sign-in returns through an HTTPS Universal Link); nil when it isn't an address.
    public static func parse(_ input: String) -> Deployment? {
        var text = input.trimmingCharacters(in: .whitespacesAndNewlines)
        if text.isEmpty { return nil }
        if !text.contains("://") { text = "https://" + text }
        guard let url = URL(string: text), url.scheme?.lowercased() == "https", let host = url.host(), !host.isEmpty, url.user == nil else { return nil }
        guard host.contains(".") || host == "localhost" else { return nil }
        var parts = URLComponents()
        parts.scheme = "https"
        parts.host = host.lowercased()
        if let port = url.port, port != 443 { parts.port = port }
        return parts.url.map { Deployment(origin: $0) }
    }
}

/// An access token and the refresh token that renews it.
public struct Credentials: Codable, Sendable, Equatable {
    public let accessToken: String
    public let refreshToken: String
    public let expiresAt: Date

    public init(accessToken: String, refreshToken: String, expiresAt: Date) {
        self.accessToken = accessToken
        self.refreshToken = refreshToken
        self.expiresAt = expiresAt
    }

    /// Refresh a minute early, so a request doesn't race the expiry.
    public func isExpired(now: Date = Date()) -> Bool { now.addingTimeInterval(60) >= expiresAt }
}

/// A PKCE verifier and its S256 challenge.
public struct PKCE: Sendable {
    public let verifier: String
    public let challenge: String

    public init() {
        var rng = SystemRandomNumberGenerator()
        self.init(verifier: Data((0..<32).map { _ in UInt8.random(in: 0...255, using: &rng) }).base64URL)
    }

    public init(verifier: String) {
        self.verifier = verifier
        challenge = Data(SHA256.hash(data: Data(verifier.utf8))).base64URL
    }
}

extension Data {
    var base64URL: String {
        base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    }
}

public enum SignInError: LocalizedError, Equatable {
    case notOpenpurr(String)
    case unsupported(String)
    case denied
    case badCallback(String)
    case server(String)

    public var errorDescription: String? {
        switch self {
        case .notOpenpurr(let host): "\(host) doesn't look like an openpurr deployment."
        case .unsupported(let host): "\(host) runs an openpurr version without the iOS app's sign-in. Update the deployment and try again."
        case .denied: "Sign-in was denied on the consent screen."
        case .badCallback(let why): "Sign-in didn't finish: \(why)"
        case .server(let message): message
        }
    }
}

/// One sign-in attempt: the authorize URL to open, then the code exchange.
public struct SignIn: Sendable {
    public let deployment: Deployment
    public let authorizationEndpoint: URL
    public let tokenEndpoint: URL
    public let pkce: PKCE
    public let state: String

    /// The URL to open in ASWebAuthenticationSession.
    public var authorizeURL: URL {
        var parts = URLComponents(url: authorizationEndpoint, resolvingAgainstBaseURL: false)!
        parts.queryItems = [
            URLQueryItem(name: "response_type", value: "code"),
            URLQueryItem(name: "client_id", value: deployment.clientId),
            URLQueryItem(name: "redirect_uri", value: deployment.redirectURI),
            URLQueryItem(name: "code_challenge", value: pkce.challenge),
            URLQueryItem(name: "code_challenge_method", value: "S256"),
            URLQueryItem(name: "scope", value: "read"),
            URLQueryItem(name: "resource", value: deployment.resource),
            URLQueryItem(name: "state", value: state),
        ]
        return parts.url!
    }

    /// The authorization code from the callback URL, after checking state and issuer (RFC 9207).
    public func code(from callback: URL) throws -> String {
        let items = URLComponents(url: callback, resolvingAgainstBaseURL: false)?.queryItems ?? []
        let value = { (name: String) in items.first { $0.name == name }?.value }
        guard callback.path() == Deployment.callbackPath, callback.host()?.lowercased() == deployment.origin.host()?.lowercased() else {
            throw SignInError.badCallback("it returned to an unexpected address.")
        }
        guard value("state") == state else { throw SignInError.badCallback("the state didn't match (start again).") }
        if let iss = value("iss"), iss != deployment.origin.absoluteString { throw SignInError.badCallback("another server answered (\(iss)).") }
        if let error = value("error") {
            if error == "access_denied" { throw SignInError.denied }
            throw SignInError.server(value("error_description") ?? error)
        }
        guard let code = value("code"), !code.isEmpty else { throw SignInError.badCallback("no authorization code came back.") }
        return code
    }
}

/// The deployment's authorization server: discovery, code exchange, refresh and revocation.
public struct OAuthClient: Sendable {
    public let deployment: Deployment
    let http: HTTPTransport

    public init(deployment: Deployment, http: HTTPTransport = URLSessionTransport()) {
        self.deployment = deployment
        self.http = http
    }

    struct ServerMetadata: Decodable {
        let issuer: String
        let authorization_endpoint: URL
        let token_endpoint: URL
        let revocation_endpoint: URL?
    }

    func metadata() async throws -> ServerMetadata {
        let origin = deployment.origin.absoluteString
        let url = URL(string: origin + "/.well-known/oauth-authorization-server")!
        let response: (Data, Int)
        do {
            response = try await http.send(URLRequest(url: url))
        } catch {
            throw SignInError.notOpenpurr(deployment.host)
        }
        guard response.1 == 200, let meta = try? JSONDecoder().decode(ServerMetadata.self, from: response.0), meta.issuer == origin else {
            throw SignInError.notOpenpurr(deployment.host)
        }
        return meta
    }

    /// Checks the deployment and prepares a sign-in.
    public func begin() async throws -> SignIn {
        let meta = try await metadata()
        // Deployments from before the iOS app don't serve its client document.
        let client = try await http.send(URLRequest(url: URL(string: deployment.clientId)!))
        guard client.1 == 200 else { throw SignInError.unsupported(deployment.host) }
        return SignIn(deployment: deployment, authorizationEndpoint: meta.authorization_endpoint, tokenEndpoint: meta.token_endpoint, pkce: PKCE(), state: PKCE().verifier)
    }

    struct TokenResponse: Decodable {
        let access_token: String
        let refresh_token: String
        let expires_in: Double
    }

    struct TokenError: Decodable {
        let error: String
        let error_description: String?
    }

    /// Exchanges the authorization code for tokens.
    public func exchange(_ signIn: SignIn, code: String, now: Date = Date()) async throws -> Credentials {
        try await token(signIn.tokenEndpoint, [
            "grant_type": "authorization_code",
            "code": code,
            "client_id": deployment.clientId,
            "redirect_uri": deployment.redirectURI,
            "code_verifier": signIn.pkce.verifier,
            "resource": deployment.resource,
        ], now: now)
    }

    /// New tokens for a refresh token (which stops working: refresh tokens rotate).
    public func refresh(_ credentials: Credentials, now: Date = Date()) async throws -> Credentials {
        let endpoint = URL(string: deployment.origin.absoluteString + "/oauth/token")!
        return try await token(endpoint, ["grant_type": "refresh_token", "refresh_token": credentials.refreshToken, "client_id": deployment.clientId], now: now)
    }

    /// Ends the grant (RFC 7009). Errors are ignored: signing out locally works regardless.
    public func revoke(_ credentials: Credentials) async {
        var request = URLRequest(url: URL(string: deployment.origin.absoluteString + "/oauth/revoke")!)
        request.httpMethod = "POST"
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        request.httpBody = Self.form(["token": credentials.refreshToken])
        _ = try? await http.send(request)
    }

    private func token(_ endpoint: URL, _ params: [String: String], now: Date) async throws -> Credentials {
        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        request.httpBody = Self.form(params)
        let (data, status) = try await http.send(request)
        if status == 200, let t = try? JSONDecoder().decode(TokenResponse.self, from: data) {
            return Credentials(accessToken: t.access_token, refreshToken: t.refresh_token, expiresAt: now.addingTimeInterval(t.expires_in))
        }
        if let e = try? JSONDecoder().decode(TokenError.self, from: data) {
            if e.error == "invalid_grant" { throw APIError.signedOut }
            throw SignInError.server(e.error_description ?? e.error)
        }
        throw APIError.http(status, nil)
    }

    static func form(_ params: [String: String]) -> Data {
        var allowed = CharacterSet.alphanumerics
        allowed.insert(charactersIn: "-._~")
        return Data(params.sorted { $0.key < $1.key }.map { "\($0.key)=\($0.value.addingPercentEncoding(withAllowedCharacters: allowed)!)" }.joined(separator: "&").utf8)
    }
}
