import Foundation
import Testing
@testable import OpenpurrKit

let deployment = Deployment.parse("purchases.example.com")!

/// Answers requests from a closure, and records them.
final class FakeTransport: HTTPTransport, @unchecked Sendable {
    private let lock = NSLock()
    private var log: [URLRequest] = []
    let answer: @Sendable (URLRequest) -> (Int, String)

    init(_ answer: @escaping @Sendable (URLRequest) -> (Int, String)) { self.answer = answer }

    var requests: [URLRequest] { lock.withLock { log } }

    func send(_ request: URLRequest) async throws -> (Data, Int) {
        lock.withLock { log.append(request) }
        let (status, body) = answer(request)
        return (Data(body.utf8), status)
    }
}

func formBody(_ r: URLRequest) -> [String: String] {
    let text = String(data: r.httpBody ?? Data(), encoding: .utf8) ?? ""
    return Dictionary(uniqueKeysWithValues: text.split(separator: "&").map {
        let kv = $0.split(separator: "=", maxSplits: 1).map { String($0).removingPercentEncoding! }
        return (kv[0], kv.count > 1 ? kv[1] : "")
    })
}

@Suite struct Addresses {
    @Test func parsesWhatPeopleType() {
        #expect(Deployment.parse("purchases.example.com")?.origin.absoluteString == "https://purchases.example.com")
        #expect(Deployment.parse(" https://Purchases.Example.com/admin/ ")?.origin.absoluteString == "https://purchases.example.com")
        #expect(Deployment.parse("https://purchases.example.com:8443")?.origin.absoluteString == "https://purchases.example.com:8443")
        #expect(Deployment.parse("https://purchases.example.com:443")?.origin.absoluteString == "https://purchases.example.com")
    }

    @Test func refusesWhatSignInCantUse() {
        #expect(Deployment.parse("") == nil)
        #expect(Deployment.parse("http://purchases.example.com") == nil)
        #expect(Deployment.parse("not a host") == nil)
        #expect(Deployment.parse("https://user@purchases.example.com") == nil)
    }

    @Test func derivesTheClientAndResource() {
        #expect(deployment.clientId == "https://purchases.example.com/app/ios-client.json")
        #expect(deployment.redirectURI == "https://purchases.example.com/app/oauth-callback")
        #expect(deployment.resource == "https://purchases.example.com/admin/v1")
    }
}

@Suite struct SigningIn {
    @Test func pkceChallengeIsS256() {
        // BASE64URL(SHA256(verifier)), as `printf %s <verifier> | openssl dgst -sha256 -binary | base64` (URL-safe, unpadded) gives.
        #expect(PKCE(verifier: "dBjftJeZ4CVP-mJ92K9qcSBpE7FqE5ODiCzvBE6uxQY").challenge == "PGmgCG9xpD3GNRyBydE_Km7gOk91BExfKT5ghNFmvbo")
        let fresh = PKCE()
        #expect(fresh.verifier.count == 43)
        #expect(fresh.verifier != PKCE().verifier)
    }

    func signIn() -> SignIn {
        SignIn(deployment: deployment, authorizationEndpoint: URL(string: "https://purchases.example.com/oauth/authorize")!,
               tokenEndpoint: URL(string: "https://purchases.example.com/oauth/token")!, pkce: PKCE(verifier: "v".padding(toLength: 43, withPad: "v", startingAt: 0)), state: "st")
    }

    @Test func authorizeURLAsksForTheAdminAPI() {
        let items = URLComponents(url: signIn().authorizeURL, resolvingAgainstBaseURL: false)!.queryItems!
        let q = Dictionary(uniqueKeysWithValues: items.map { ($0.name, $0.value!) })
        #expect(q["resource"] == "https://purchases.example.com/admin/v1")
        #expect(q["client_id"] == "https://purchases.example.com/app/ios-client.json")
        #expect(q["redirect_uri"] == "https://purchases.example.com/app/oauth-callback")
        #expect(q["scope"] == "read")
        #expect(q["code_challenge_method"] == "S256")
        #expect(q["state"] == "st")
    }

    @Test func checksTheCallback() throws {
        let s = signIn()
        let base = "https://purchases.example.com/app/oauth-callback"
        #expect(try s.code(from: URL(string: "\(base)?code=abc&state=st&iss=https%3A%2F%2Fpurchases.example.com")!) == "abc")
        #expect(throws: SignInError.self) { try s.code(from: URL(string: "\(base)?code=abc&state=other")!) }
        #expect(throws: SignInError.self) { try s.code(from: URL(string: "\(base)?code=abc&state=st&iss=https%3A%2F%2Fevil.example")!) }
        #expect(throws: SignInError.self) { try s.code(from: URL(string: "https://evil.example/app/oauth-callback?code=abc&state=st")!) }
        #expect(throws: SignInError.denied) { try s.code(from: URL(string: "\(base)?error=access_denied&state=st")!) }
    }

    @Test func beginRefusesServersThatArentOpenpurr() async {
        let http = FakeTransport { _ in (404, "") }
        await #expect(throws: SignInError.notOpenpurr("purchases.example.com")) { try await OAuthClient(deployment: deployment, http: http).begin() }
    }

    @Test func beginRefusesOpenpurrWithoutTheIOSClient() async {
        let http = FakeTransport { r in
            r.url!.path() == "/.well-known/oauth-authorization-server"
                ? (200, #"{"issuer":"https://purchases.example.com","authorization_endpoint":"https://purchases.example.com/oauth/authorize","token_endpoint":"https://purchases.example.com/oauth/token"}"#)
                : (404, "")
        }
        await #expect(throws: SignInError.unsupported("purchases.example.com")) { try await OAuthClient(deployment: deployment, http: http).begin() }
    }

    @Test func exchangesTheCodeWithTheVerifier() async throws {
        let http = FakeTransport { _ in (200, #"{"access_token":"oat_1","token_type":"Bearer","expires_in":3600,"refresh_token":"ort_1","scope":"read"}"#) }
        let now = Date(timeIntervalSince1970: 1000)
        let creds = try await OAuthClient(deployment: deployment, http: http).exchange(signIn(), code: "abc", now: now)
        #expect(creds == Credentials(accessToken: "oat_1", refreshToken: "ort_1", expiresAt: now.addingTimeInterval(3600)))
        let body = formBody(http.requests[0])
        #expect(body["grant_type"] == "authorization_code")
        #expect(body["code_verifier"] == signIn().pkce.verifier)
        #expect(body["resource"] == "https://purchases.example.com/admin/v1")
    }
}

@Suite struct TheAPIClient {
    let me = #"{"operator":{"id":"o1","email":"a@example.com","name":"A","role":"owner","app_ids":null},"via":"token","permissions":["read"]}"#
    let fresh = Credentials(accessToken: "oat_old", refreshToken: "ort_old", expiresAt: Date().addingTimeInterval(3600))

    @Test func sendsTheAccessToken() async throws {
        let store = MemoryStore()
        store.save(fresh, for: deployment)
        let http = FakeTransport { [me] _ in (200, me) }
        let result = try await APIClient(deployment: deployment, store: store, http: http).me()
        #expect(result.operator.email == "a@example.com")
        #expect(http.requests[0].url!.absoluteString == "https://purchases.example.com/admin/v1/me")
        #expect(http.requests[0].value(forHTTPHeaderField: "Authorization") == "Bearer oat_old")
    }

    @Test func refreshesOnceAfterA401AndKeepsTheRotatedTokens() async throws {
        let store = MemoryStore()
        store.save(fresh, for: deployment)
        let http = FakeTransport { [me] r in
            if r.url!.path() == "/oauth/token" { return (200, #"{"access_token":"oat_new","expires_in":3600,"refresh_token":"ort_new"}"#) }
            return r.value(forHTTPHeaderField: "Authorization") == "Bearer oat_new" ? (200, me) : (401, #"{"code":"invalid_token"}"#)
        }
        let client = APIClient(deployment: deployment, store: store, http: http)
        async let a = client.me()
        async let b = client.me()
        _ = try await (a, b)
        #expect(http.requests.filter { $0.url!.path() == "/oauth/token" }.count == 1)
        #expect(store.load(deployment)?.refreshToken == "ort_new")
    }

    @Test func refreshesExpiredTokensBeforeTheRequest() async throws {
        let store = MemoryStore()
        store.save(Credentials(accessToken: "oat_old", refreshToken: "ort_old", expiresAt: Date().addingTimeInterval(-1)), for: deployment)
        let http = FakeTransport { [me] r in
            r.url!.path() == "/oauth/token" ? (200, #"{"access_token":"oat_new","expires_in":3600,"refresh_token":"ort_new"}"#) : (200, me)
        }
        _ = try await APIClient(deployment: deployment, store: store, http: http).me()
        #expect(http.requests.map { $0.url!.path() } == ["/oauth/token", "/admin/v1/me"])
    }

    @Test func aRevokedSessionSignsOut() async {
        let store = MemoryStore()
        store.save(fresh, for: deployment)
        let http = FakeTransport { r in
            r.url!.path() == "/oauth/token" ? (400, #"{"error":"invalid_grant","error_description":"Unknown, expired or revoked refresh token."}"#) : (401, "{}")
        }
        await #expect(throws: APIError.signedOut) { try await APIClient(deployment: deployment, store: store, http: http).me() }
        #expect(store.load(deployment) == nil)
    }

    @Test func passesTheAPIsErrorMessage() async {
        let store = MemoryStore()
        store.save(fresh, for: deployment)
        let http = FakeTransport { _ in (403, #"{"code":"forbidden","message":"This needs the read permission."}"#) }
        do {
            _ = try await APIClient(deployment: deployment, store: store, http: http).me()
            Issue.record("expected an error")
        } catch {
            #expect(error.localizedDescription == "This needs the read permission.")
        }
    }

    @Test func buildsEventQueries() async throws {
        let store = MemoryStore()
        store.save(fresh, for: deployment)
        let http = FakeTransport { _ in (200, #"{"events":[],"next_cursor":null}"#) }
        _ = try await APIClient(deployment: deployment, store: store, http: http).events(environment: .sandbox, project: "rose", types: ["INITIAL_PURCHASE", "RENEWAL"], cursor: "abc+/", limit: 20)
        let q = URLComponents(url: http.requests[0].url!, resolvingAgainstBaseURL: false)!.queryItems!
        #expect(Dictionary(uniqueKeysWithValues: q.map { ($0.name, $0.value!) }) == ["environment": "sandbox", "limit": "20", "project": "rose", "type": "INITIAL_PURCHASE,RENEWAL", "cursor": "abc+/"])
    }
}

@Suite struct Decoding {
    // Shaped like the admin API's answers (lite/test/admin-api.test.ts, spec/conformance/tests/events.test.ts).
    @Test func eventList() throws {
        let json = #"""
        {"events":[{"id":"e1","type":"INITIAL_PURCHASE","app_id":"ios","environment":"sandbox","created_at":1764000000000,
          "app_user_id":"u1","store":"APP_STORE","product_id":"pro_monthly","period_type":"NORMAL","price":9.99,
          "price_in_purchased_currency":9.99,"currency":"USD","country_code":"US","new_product_id":null,"cancel_reason":null,
          "expiration_reason":null,"project_id":"default","is_family_share":false}],"next_cursor":"MTc2NDAwMDAwMDAwMDplMQ"}
        """#
        let page = try JSONDecoder().decode(EventPage.self, from: Data(json.utf8))
        let e = try #require(page.events.first)
        #expect(e.title == "New subscription")
        #expect(e.localPrice == "$9.99")
        #expect(e.usdPrice == nil)
        #expect(e.flag == "🇺🇸")
        #expect(e.summary == "pro_monthly · $9.99 · 🇺🇸")
        #expect(e.isFamilyShare == false)
        #expect(page.nextCursor == "MTc2NDAwMDAwMDAwMDplMQ")
    }

    @Test func eventDetailKeepsTheBody() throws {
        let json = #"{"id":"e1","type":"CANCELLATION","app_id":"ios","environment":"production","created_at":1,"cancel_reason":"CUSTOMER_SUPPORT","price":-9.99,"price_in_purchased_currency":-9.99,"currency":"USD","project_id":"default","is_family_share":null,"body":{"api_version":"1.0","event":{"id":"e1","aliases":["u1"]}}}"#
        let detail = try JSONDecoder().decode(EventDetail.self, from: Data(json.utf8))
        #expect(detail.event.title == "Refund")
        #expect(detail.event.tone == .bad)
        #expect(detail.body.pretty().contains("\"aliases\": [\n"))
    }

    @Test func chartsKeepTheirSeriesKeys() throws {
        let json = #"""
        {"chart":"mrr_movement","label":"MRR movement","description":"d","unit":"usd","kind":"flow","interval":"day","from":"2026-11-01","to":"2026-11-02",
         "series":[{"key":"new","label":"New"},{"key":"churned","label":"Churned"}],
         "points":[{"date":"2026-11-01","values":{"new":10,"churned":-2.5}},{"date":"2026-11-02","values":{"new":null,"churned":-1}}],
         "notes":[],"updated_at":null}
        """#
        let chart = try JSONDecoder().decode(ChartResult.self, from: Data(json.utf8))
        #expect(chart.total("new") == 10)
        #expect(chart.total("churned") == -3.5)
        #expect(chart.latest("churned") == -1)
    }

    @Test func formatsUnits() {
        #expect(ChartUnit.usd.format(1234.5) == "$1,235")
        #expect(ChartUnit.usd.format(9.99) == "$9.99")
        #expect(ChartUnit.count.format(1234) == "1,234")
        #expect(ChartUnit.usd.format(200, compact: true) == "$200")
        #expect(ChartUnit.usd.format(4.5, compact: true) == "$4.50")
        #expect(ChartUnit.usd.format(11_234, compact: true) == "$11.2K")
        #expect(ChartUnit.percent.format(4.25) == "4.3%" || ChartUnit.percent.format(4.25) == "4.2%")
    }

    @Test func chartRangesEndToday() {
        let now = DayFormat.date("2026-11-27")!
        #expect(ChartRange.month.bounds(now: now) == ("2026-10-31", "2026-11-27"))
        #expect(ChartRange.week.bounds(now: now) == ("2026-11-21", "2026-11-27"))
        #expect(ChartRange.year.interval == .month)
    }
}
