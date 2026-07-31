import AVFoundation
import SwiftUI

struct ScannerView: UIViewControllerRepresentable {
    let onPayload: (String) -> Void
    let onFailure: (String) -> Void

    func makeUIViewController(context: Context) -> ScannerViewController {
        let controller = ScannerViewController()
        controller.onPayload = onPayload
        controller.onFailure = onFailure
        return controller
    }

    func updateUIViewController(_ uiViewController: ScannerViewController, context: Context) {
        uiViewController.onPayload = onPayload
        uiViewController.onFailure = onFailure
    }
}

final class ScannerViewController: UIViewController, AVCaptureMetadataOutputObjectsDelegate {
    var onPayload: ((String) -> Void)?
    var onFailure: ((String) -> Void)?

    private let session = AVCaptureSession()
    private let sessionQueue = DispatchQueue(label: "qr-trust.verifier-lab.scanner-session")
    private var previewLayer: AVCaptureVideoPreviewLayer?
    private var isSessionConfigured = false
    private var shouldRunSession = false
    private var didEmitPayload = false

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        configureCapture()
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        previewLayer?.frame = view.bounds
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        didEmitPayload = false
        sessionQueue.async { [weak self] in
            guard let self else { return }
            self.shouldRunSession = true
            self.startSessionIfReady()
        }
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        sessionQueue.async { [weak self] in
            guard let self else { return }
            self.shouldRunSession = false
            self.stopSessionIfNeeded()
        }
    }

    private func configureCapture() {
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            setUpSession()
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .video) { [weak self] granted in
                DispatchQueue.main.async {
                    guard let self else { return }
                    if granted {
                        self.setUpSession()
                    } else {
                        self.onFailure?("Camera access was denied.")
                    }
                }
            }
        case .denied, .restricted:
            onFailure?("Camera access is unavailable. Enable camera permission for this app.")
        @unknown default:
            onFailure?("Camera access failed with an unknown authorization state.")
        }
    }

    private func setUpSession() {
        sessionQueue.async { [weak self] in
            guard let self, !self.isSessionConfigured else { return }

            self.session.beginConfiguration()

            guard let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back)
                    ?? AVCaptureDevice.default(for: .video) else {
                self.session.commitConfiguration()
                self.reportFailure("No camera device is available.")
                return
            }

            do {
                let input = try AVCaptureDeviceInput(device: device)
                if self.session.canAddInput(input) {
                    self.session.addInput(input)
                } else {
                    self.session.commitConfiguration()
                    self.reportFailure("Unable to add the camera input.")
                    return
                }
            } catch {
                self.session.commitConfiguration()
                self.reportFailure("Unable to configure the camera input.")
                return
            }

            let output = AVCaptureMetadataOutput()
            if self.session.canAddOutput(output) {
                self.session.addOutput(output)
                output.setMetadataObjectsDelegate(self, queue: .main)
                output.metadataObjectTypes = [.qr]
            } else {
                self.session.commitConfiguration()
                self.reportFailure("Unable to configure QR metadata output.")
                return
            }

            self.session.commitConfiguration()
            self.isSessionConfigured = true

            DispatchQueue.main.async { [weak self] in
                guard let self, self.previewLayer == nil else { return }
                let previewLayer = AVCaptureVideoPreviewLayer(session: self.session)
                previewLayer.videoGravity = .resizeAspectFill
                previewLayer.frame = self.view.bounds
                self.view.layer.addSublayer(previewLayer)
                self.previewLayer = previewLayer
            }

            self.startSessionIfReady()
        }
    }

    private func startSessionIfReady() {
        guard shouldRunSession, isSessionConfigured, !session.isRunning else {
            return
        }
        session.startRunning()
    }

    private func stopSessionIfNeeded() {
        guard session.isRunning else { return }
        session.stopRunning()
    }

    private func reportFailure(_ reason: String) {
        DispatchQueue.main.async { [weak self] in
            self?.onFailure?(reason)
        }
    }

    func metadataOutput(
        _ output: AVCaptureMetadataOutput,
        didOutput metadataObjects: [AVMetadataObject],
        from connection: AVCaptureConnection
    ) {
        guard !didEmitPayload else { return }
        guard
            let object = metadataObjects.first as? AVMetadataMachineReadableCodeObject,
            object.type == .qr,
            let payload = object.stringValue,
            !payload.isEmpty
        else {
            return
        }

        didEmitPayload = true
        sessionQueue.async { [weak self] in
            guard let self else { return }
            self.shouldRunSession = false
            self.stopSessionIfNeeded()
        }
        onPayload?(payload)
    }
}
