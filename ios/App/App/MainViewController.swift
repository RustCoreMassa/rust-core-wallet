import Capacitor
import UIKit

/// Capacitor's web view controller, plus the plugins that live in this app (not in npm packages).
class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        // First: on a fresh install it clears the Keychain items an earlier install left.
        bridge?.registerPluginInstance(NativeStorePlugin())
        bridge?.registerPluginInstance(SecretClipboardPlugin())
        bridge?.registerPluginInstance(BiometricUnlockPlugin())
    }
}
