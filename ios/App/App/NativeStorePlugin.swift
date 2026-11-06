import Capacitor
import Foundation
import Security

/// The app's lasting key–value store (LOCAL_STORE: the encrypted vault, device preferences) in
/// the iOS Keychain instead of the web view's localStorage, which iOS may clear when the phone
/// runs low on space. Used by src/native/native-storage-area.ts.
///
/// Items can be read only while the phone is unlocked, never leave this device (no iCloud
/// Keychain, not restored onto another phone from a backup), and are deleted with the app: the
/// Keychain itself outlives an uninstall, so a fresh install clears what an earlier one left.
@objc(NativeStorePlugin)
public class NativeStorePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "NativeStorePlugin"
    public let jsName = "NativeStore"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getAll", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "set", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "remove", returnType: CAPPluginReturnPromise),
    ]

    private static let service = "\(Bundle.main.bundleIdentifier ?? "com.rustcoremassa.wallet").store"
    /// In UserDefaults, which (unlike the Keychain) is deleted with the app.
    private static let installedFlag = "rustcore.store.installed"

    override public func load() {
        let defaults = UserDefaults.standard
        if !defaults.bool(forKey: Self.installedFlag) {
            // First launch of this install: whatever is left belongs to an uninstalled copy.
            let status = SecItemDelete(Self.baseQuery() as CFDictionary)
            if status != errSecSuccess && status != errSecItemNotFound {
                CAPLog.print("⚡️  NativeStore: clearing an earlier install's items failed (\(status))")
            }
            // Set even after a failure: retrying at the next launch could delete a wallet created
            // in this one — a leftover from the old install is the lesser harm.
            defaults.set(true, forKey: Self.installedFlag)
        }
    }

    @objc func getAll(_ call: CAPPluginCall) {
        var query = Self.baseQuery()
        query[kSecMatchLimit as String] = kSecMatchLimitAll
        query[kSecReturnAttributes as String] = true
        query[kSecReturnData as String] = true
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound {
            call.resolve(["items": [String: String]()])
            return
        }
        guard status == errSecSuccess, let rows = result as? [[String: Any]] else {
            call.reject("Reading the keychain failed", String(status))
            return
        }
        var items: [String: String] = [:]
        for row in rows {
            if let key = row[kSecAttrAccount as String] as? String,
               let data = row[kSecValueData as String] as? Data,
               let value = String(data: data, encoding: .utf8) {
                items[key] = value
            }
        }
        call.resolve(["items": items])
    }

    @objc func set(_ call: CAPPluginCall) {
        guard let key = call.getString("key"), let value = call.getString("value") else {
            call.reject("key and value are required")
            return
        }
        let data = Data(value.utf8)
        var query = Self.baseQuery()
        query[kSecAttrAccount as String] = key
        var status = SecItemUpdate(
            query as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        if status == errSecItemNotFound {
            query[kSecValueData as String] = data
            query[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
            status = SecItemAdd(query as CFDictionary, nil)
        }
        if status == errSecSuccess {
            call.resolve()
        } else {
            call.reject("Saving to the keychain failed", String(status))
        }
    }

    @objc func remove(_ call: CAPPluginCall) {
        guard let key = call.getString("key") else {
            call.reject("key is required")
            return
        }
        var query = Self.baseQuery()
        query[kSecAttrAccount as String] = key
        let status = SecItemDelete(query as CFDictionary)
        if status == errSecSuccess || status == errSecItemNotFound {
            call.resolve()
        } else {
            call.reject("Removing from the keychain failed", String(status))
        }
    }

    private static func baseQuery() -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
        ]
    }
}
