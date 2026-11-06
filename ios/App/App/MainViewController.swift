import Capacitor
import UIKit

/// Capacitor's web view controller, plus the plugins that live in this app (not in npm packages).
class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(NativeStorePlugin())
    }
}
