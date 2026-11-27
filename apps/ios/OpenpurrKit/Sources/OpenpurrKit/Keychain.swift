import Foundation
import Security

/// Tokens in the Keychain, one item per deployment. "After first unlock, this device only": a
/// notification extension can read them while the phone is locked, and they never leave the device
/// in backups.
public struct KeychainStore: CredentialStore {
    let service: String

    public init(service: String = "openpurr.credentials") { self.service = service }

    private func query(_ deployment: Deployment) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: deployment.id]
    }

    public func load(_ deployment: Deployment) -> Credentials? {
        var q = query(deployment)
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let data = out as? Data else { return nil }
        return try? JSONDecoder().decode(Credentials.self, from: data)
    }

    public func save(_ credentials: Credentials, for deployment: Deployment) {
        guard let data = try? JSONEncoder().encode(credentials) else { return }
        let attributes: [String: Any] = [kSecValueData as String: data, kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly]
        if SecItemUpdate(query(deployment) as CFDictionary, attributes as CFDictionary) == errSecItemNotFound {
            SecItemAdd(query(deployment).merging(attributes) { $1 } as CFDictionary, nil)
        }
    }

    public func delete(_ deployment: Deployment) {
        SecItemDelete(query(deployment) as CFDictionary)
    }
}

/// Tokens in memory (tests and previews).
public final class MemoryStore: CredentialStore, @unchecked Sendable {
    private var items: [String: Credentials] = [:]
    private let lock = NSLock()

    public init() {}

    public func load(_ deployment: Deployment) -> Credentials? { lock.withLock { items[deployment.id] } }
    public func save(_ credentials: Credentials, for deployment: Deployment) { lock.withLock { items[deployment.id] = credentials } }
    public func delete(_ deployment: Deployment) { lock.withLock { _ = items.removeValue(forKey: deployment.id) } }
}
