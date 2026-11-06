import AVFoundation
import Capacitor
import UIKit

/// Reads a QR code with the camera (Send → Scan). Used through QR_SCANNER
/// (src/native/platform-providers.ts). Resolves `{ text }` — null when the user closes the
/// camera; rejects with code "denied" when the app may not use the camera.
@objc(QrScannerPlugin)
public class QrScannerPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "QrScannerPlugin"
    public let jsName = "QrScanner"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "scan", returnType: CAPPluginReturnPromise),
    ]

    @objc func scan(_ call: CAPPluginCall) {
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            present(call)
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .video) { granted in
                if granted {
                    self.present(call)
                } else {
                    call.reject("Camera access is off", "denied")
                }
            }
        default:
            call.reject("Camera access is off", "denied")
        }
    }

    private func present(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let presenter = self.bridge?.viewController else {
                call.reject("No screen to show the camera on", "unavailable")
                return
            }
            let scanner = QrScannerViewController { text in
                call.resolve(["text": text ?? NSNull()])
            }
            scanner.modalPresentationStyle = .fullScreen
            presenter.present(scanner, animated: true)
        }
    }
}

/// The camera full screen, a frame hint and a Cancel button; closes on the first QR code.
final class QrScannerViewController: UIViewController, AVCaptureMetadataOutputObjectsDelegate {
    private let session = AVCaptureSession()
    private let onFinish: (String?) -> Void
    private var preview: AVCaptureVideoPreviewLayer?
    private var finished = false

    init(onFinish: @escaping (String?) -> Void) {
        self.onFinish = onFinish
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) { fatalError("not used") }

    override var preferredStatusBarStyle: UIStatusBarStyle { .lightContent }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black

        if let device = AVCaptureDevice.default(for: .video),
           let input = try? AVCaptureDeviceInput(device: device),
           session.canAddInput(input) {
            session.addInput(input)
            let output = AVCaptureMetadataOutput()
            if session.canAddOutput(output) {
                session.addOutput(output)
                output.setMetadataObjectsDelegate(self, queue: .main)
                output.metadataObjectTypes = [.qr]
            }
            let layer = AVCaptureVideoPreviewLayer(session: session)
            layer.videoGravity = .resizeAspectFill
            view.layer.addSublayer(layer)
            preview = layer
        }

        let frame = UIView()
        frame.translatesAutoresizingMaskIntoConstraints = false
        frame.layer.borderColor = UIColor.white.withAlphaComponent(0.85).cgColor
        frame.layer.borderWidth = 2
        frame.layer.cornerRadius = 18
        view.addSubview(frame)

        let hint = UILabel()
        hint.translatesAutoresizingMaskIntoConstraints = false
        hint.text = "Point the camera at a Massa address QR code"
        hint.textColor = .white
        hint.font = .systemFont(ofSize: 15, weight: .medium)
        hint.textAlignment = .center
        hint.numberOfLines = 0
        view.addSubview(hint)

        let cancel = UIButton(type: .system)
        cancel.translatesAutoresizingMaskIntoConstraints = false
        cancel.setTitle("Cancel", for: .normal)
        cancel.setTitleColor(.white, for: .normal)
        cancel.titleLabel?.font = .systemFont(ofSize: 17, weight: .semibold)
        cancel.backgroundColor = UIColor.white.withAlphaComponent(0.16)
        cancel.layer.cornerRadius = 14
        cancel.addTarget(self, action: #selector(close), for: .touchUpInside)
        view.addSubview(cancel)

        let guide = view.safeAreaLayoutGuide
        NSLayoutConstraint.activate([
            frame.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            frame.centerYAnchor.constraint(equalTo: view.centerYAnchor, constant: -30),
            frame.widthAnchor.constraint(equalTo: view.widthAnchor, multiplier: 0.7),
            frame.heightAnchor.constraint(equalTo: frame.widthAnchor),
            hint.topAnchor.constraint(equalTo: frame.bottomAnchor, constant: 24),
            hint.leadingAnchor.constraint(equalTo: guide.leadingAnchor, constant: 24),
            hint.trailingAnchor.constraint(equalTo: guide.trailingAnchor, constant: -24),
            cancel.bottomAnchor.constraint(equalTo: guide.bottomAnchor, constant: -20),
            cancel.leadingAnchor.constraint(equalTo: guide.leadingAnchor, constant: 24),
            cancel.trailingAnchor.constraint(equalTo: guide.trailingAnchor, constant: -24),
            cancel.heightAnchor.constraint(equalToConstant: 52),
        ])
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        preview?.frame = view.bounds
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        let session = self.session
        DispatchQueue.global(qos: .userInitiated).async { session.startRunning() }
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        let session = self.session
        DispatchQueue.global(qos: .userInitiated).async { session.stopRunning() }
    }

    func metadataOutput(
        _ output: AVCaptureMetadataOutput, didOutput objects: [AVMetadataObject],
        from connection: AVCaptureConnection
    ) {
        guard let code = objects.first as? AVMetadataMachineReadableCodeObject,
              let text = code.stringValue
        else { return }
        UINotificationFeedbackGenerator().notificationOccurred(.success)
        finish(text)
    }

    @objc private func close() { finish(nil) }

    private func finish(_ text: String?) {
        guard !finished else { return }
        finished = true
        dismiss(animated: true) { self.onFinish(text) }
    }
}
