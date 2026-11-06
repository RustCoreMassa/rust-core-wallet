import Capacitor
import Foundation
import LocalAuthentication
import Security
import UIKit

/// Unlocking with Face ID / Touch ID: keeps the user's PIN in the Keychain behind the
/// biometrics, used by src/native/native-biometric-unlock.ts. The item can be read only after a
/// successful Face ID / Touch ID check, only on this device, only while the phone has a passcode
/// — and stops working for good when a face or finger is added (`biometryCurrentSet`), so someone
/// who learns the phone's passcode can't enrol their own face and open the wallet.
@objc(BiometricUnlockPlugin)
public class BiometricUnlockPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "BiometricUnlockPlugin"
    public let jsName = "BiometricUnlock"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "availability", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "save", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "read", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "remove", returnType: CAPPluginReturnPromise),
    ]

    private static let service =
        "\(Bundle.main.bundleIdentifier ?? "com.rustcoremassa.wallet").biometric"
    private static let account = "unlock-secret"

    /// "face", "touch" or "none" (no hardware, nothing enrolled, no passcode, or not allowed).
    @objc func availability(_ call: CAPPluginCall) {
        let context = LAContext()
        var error: NSError?
        guard context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error)
        else {
            call.resolve(["kind": "none"])
            return
        }
        switch context.biometryType {
        case .faceID: call.resolve(["kind": "face"])
        case .touchID: call.resolve(["kind": "touch"])
        default: call.resolve(["kind": "none"])
        }
    }

    @objc func save(_ call: CAPPluginCall) {
        guard let secret = call.getString("secret"), !secret.isEmpty else {
            call.reject("secret is required", "failed")
            return
        }
        var error: Unmanaged<CFError>?
        guard let access = SecAccessControlCreateWithFlags(
            nil, kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly, .biometryCurrentSet, &error)
        else {
            call.reject("Biometric protection isn't available", "failed")
            return
        }
        SecItemDelete(Self.query() as CFDictionary)
        var query = Self.query()
        query[kSecValueData as String] = Data(secret.utf8)
        query[kSecAttrAccessControl as String] = access
        let status = SecItemAdd(query as CFDictionary, nil)
        if status == errSecSuccess {
            call.resolve()
        } else {
            call.reject("Saving failed (\(status))", "failed")
        }
    }

    /// Shows the Face ID / Touch ID prompt (once the app is in front) and returns the secret.
    /// Rejects with code "canceled", "unavailable" (gone: biometrics changed, never saved) or
    /// "failed".
    @objc func read(_ call: CAPPluginCall) {
        let reason = call.getString("reason") ?? "Unlock your wallet"
        Self.whenActive {
            DispatchQueue.global(qos: .userInitiated).async {
                let context = LAContext()
                context.localizedReason = reason
                // No "Enter Password" button: the PIN pad under the prompt is the fallback.
                context.localizedFallbackTitle = ""
                var query = Self.query()
                query[kSecReturnData as String] = true
                query[kSecMatchLimit as String] = kSecMatchLimitOne
                query[kSecUseAuthenticationContext as String] = context
                var result: CFTypeRef?
                let status = SecItemCopyMatching(query as CFDictionary, &result)
                switch status {
                case errSecSuccess:
                    if let data = result as? Data, let secret = String(data: data, encoding: .utf8) {
                        call.resolve(["secret": secret])
                    } else {
                        call.reject("Unreadable item", "failed")
                    }
                case errSecUserCanceled:
                    call.reject("Cancelled", "canceled")
                case errSecItemNotFound:
                    call.reject("Not available any more", "unavailable")
                default:
                    call.reject("Biometric check failed (\(status))", "failed")
                }
            }
        }
    }

    @objc func remove(_ call: CAPPluginCall) {
        let status = SecItemDelete(Self.query() as CFDictionary)
        if status == errSecSuccess || status == errSecItemNotFound {
            call.resolve()
        } else {
            call.reject("Removing failed (\(status))", "failed")
        }
    }

    private static func query() -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
    }

    /// The prompt can only show over an active app: the lock screen may ask while the app is
    /// still coming back from the background.
    private static func whenActive(_ run: @escaping () -> Void) {
        DispatchQueue.main.async {
            if UIApplication.shared.applicationState == .active {
                run()
                return
            }
            // Called on the main queue, after this block: the token is set by then.
            let box = ObserverBox()
            box.token = NotificationCenter.default.addObserver(
                forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main
            ) { _ in
                if let token = box.token { NotificationCenter.default.removeObserver(token) }
                box.token = nil
                run()
            }
        }
    }
}

/// Holds a one-shot observer's token, which only its own (main-queue) callback reads.
private final class ObserverBox: @unchecked Sendable {
    var token: NSObjectProtocol?
}
