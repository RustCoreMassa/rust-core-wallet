import Capacitor
import UIKit

/// The iOS share menu for a piece of text (Receive → Share: the wallet's address). Used through
/// SHARE_SHEET (src/native/platform-providers.ts); resolves when the menu closes.
@objc(ShareSheetPlugin)
public class ShareSheetPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ShareSheetPlugin"
    public let jsName = "ShareSheet"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "share", returnType: CAPPluginReturnPromise),
    ]

    @objc func share(_ call: CAPPluginCall) {
        guard let text = call.getString("text"), !text.isEmpty else {
            call.reject("text is required")
            return
        }
        DispatchQueue.main.async {
            guard let presenter = self.bridge?.viewController else {
                call.reject("No screen to show the share menu on")
                return
            }
            let sheet = UIActivityViewController(activityItems: [text], applicationActivities: nil)
            sheet.popoverPresentationController?.sourceView = presenter.view
            sheet.completionWithItemsHandler = { _, completed, _, _ in
                call.resolve(["completed": completed])
            }
            presenter.present(sheet, animated: true)
        }
    }
}
