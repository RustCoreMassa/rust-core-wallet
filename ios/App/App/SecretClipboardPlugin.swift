import Capacitor
import UIKit
import UniformTypeIdentifiers

/// Copies a private key the way a secret should be: the system removes it from the clipboard
/// after `seconds` — even with the app in the background, where the web side's own timer
/// doesn't run — and it stays on this device (no Universal Clipboard to the user's Mac or iPad).
/// Used through SECRET_CLIPBOARD (src/native/platform-providers.ts).
@objc(SecretClipboardPlugin)
public class SecretClipboardPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "SecretClipboardPlugin"
    public let jsName = "SecretClipboard"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "copy", returnType: CAPPluginReturnPromise),
    ]

    @objc func copy(_ call: CAPPluginCall) {
        guard let text = call.getString("text"), let seconds = call.getDouble("seconds"),
              seconds > 0
        else {
            call.reject("text and a positive seconds are required")
            return
        }
        DispatchQueue.main.async {
            UIPasteboard.general.setItems(
                [[UTType.utf8PlainText.identifier: text]],
                options: [
                    .localOnly: true,
                    .expirationDate: Date().addingTimeInterval(seconds),
                ])
            call.resolve()
        }
    }
}
