import UIKit
import Capacitor

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?
    /// The launch screen laid over the wallet while the app isn't active.
    private var privacyCover: UIView?

    /// Leaving the foreground (app switcher, Control Center, another app): iOS takes the app
    /// switcher's snapshot after this, so balances and addresses never end up in it.
    func sceneWillResignActive(_ scene: UIScene) {
        guard privacyCover == nil, let window = window,
              let cover = UIStoryboard(name: "LaunchScreen", bundle: nil)
                .instantiateInitialViewController()?.view
        else { return }
        cover.frame = window.bounds
        cover.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        window.addSubview(cover)
        privacyCover = cover
    }

    /// Back in front. A wallet left too long has already been locked by then (the web side
    /// listens to Capacitor's `resume`, sent as the app starts coming back).
    func sceneDidBecomeActive(_ scene: UIScene) {
        guard let cover = privacyCover else { return }
        privacyCover = nil
        UIView.animate(withDuration: 0.2, animations: { cover.alpha = 0 }) { _ in
            cover.removeFromSuperview()
        }
    }

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = MainViewController()
        window?.makeKeyAndVisible()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}
