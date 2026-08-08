import AVFoundation
import SwiftUI

struct ScannerView: UIViewControllerRepresentable {
    let onPayload: (String) -> Void
    let onFailure: (String) -> Void

    /// Side of the reticle SwiftUI draws over this preview, in points.
    ///
    /// The controller turns it into `rectOfInterest`, so the frame the user
    /// aims through is the frame the decoder reads. Keep it in step with the
    /// reticle in `scannerSheet` — the two describe the same square.
    var reticleSide: CGFloat = 260

    var isTorchOn: Bool = false

    /// Reports whether this device can light the scene at all, so the caller
    /// can leave the torch control out rather than ship a dead button.
    var onTorchAvailabilityChange: (Bool) -> Void = { _ in }

    func makeUIViewController(context: Context) -> ScannerViewController {
        let controller = ScannerViewController()
        controller.onPayload = onPayload
        controller.onFailure = onFailure
        controller.onTorchAvailabilityChange = onTorchAvailabilityChange
        controller.reticleSide = reticleSide
        controller.isTorchOn = isTorchOn
        return controller
    }

    func updateUIViewController(_ uiViewController: ScannerViewController, context: Context) {
        uiViewController.onPayload = onPayload
        uiViewController.onFailure = onFailure
        uiViewController.onTorchAvailabilityChange = onTorchAvailabilityChange
        uiViewController.reticleSide = reticleSide
        uiViewController.isTorchOn = isTorchOn
    }
}

final class ScannerViewController: UIViewController, AVCaptureMetadataOutputObjectsDelegate {
    var onPayload: ((String) -> Void)?
    var onFailure: ((String) -> Void)?
    var onTorchAvailabilityChange: ((Bool) -> Void)?

    var reticleSide: CGFloat = 260 {
        didSet { updateRectOfInterest() }
    }

    var isTorchOn = false {
        didSet {
            guard isTorchOn != oldValue else { return }
            applyTorch()
        }
    }

    private let session = AVCaptureSession()
    private let sessionQueue = DispatchQueue(label: "qr-trust.verifier-lab.scanner-session")
    private var previewLayer: AVCaptureVideoPreviewLayer?

    /// Both are retained now. `setUpSession` used to let them go out of scope
    /// the moment configuration finished, which is why there was no way to
    /// reach the torch or to narrow the scan window after startup.
    private var captureDevice: AVCaptureDevice?
    private var metadataOutput: AVCaptureMetadataOutput?

    private var isSessionConfigured = false
    private var shouldRunSession = false
    private var didEmitPayload = false

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = AppTheme.cameraBackdropUI
        configureCapture()
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        previewLayer?.frame = view.bounds
        // The scan window is defined against these bounds, so it has to be
        // recomputed whenever they change — first layout, rotation, resize.
        updateRectOfInterest()
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
        // The torch is hardware state that outlives this view. Leaving it lit
        // after the sheet closes reads as the app still holding the camera.
        isTorchOn = false
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
            self.captureDevice = device

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
                self.metadataOutput = output
            } else {
                self.session.commitConfiguration()
                self.reportFailure("Unable to configure QR metadata output.")
                return
            }

            self.session.commitConfiguration()
            self.isSessionConfigured = true

            let torchAvailable = device.hasTorch && device.isTorchAvailable
            DispatchQueue.main.async { [weak self] in
                guard let self else { return }
                self.onTorchAvailabilityChange?(torchAvailable)

                if self.previewLayer == nil {
                    let previewLayer = AVCaptureVideoPreviewLayer(session: self.session)
                    previewLayer.videoGravity = .resizeAspectFill
                    previewLayer.frame = self.view.bounds
                    self.view.layer.addSublayer(previewLayer)
                    self.previewLayer = previewLayer
                }

                // The preview layer is what converts screen geometry into
                // sensor geometry, so the scan window can only be set once it
                // exists — `viewDidLayoutSubviews` has usually already run.
                self.updateRectOfInterest()
                self.applyTorch()
            }

            self.startSessionIfReady()
        }
    }

    /// Narrows metadata detection to the reticle.
    ///
    /// Without this the frame is decoration: `AVCaptureMetadataOutput` reads
    /// the entire preview, so a second code the user deliberately kept outside
    /// the frame scans anyway — and the sheet's own copy promises otherwise.
    ///
    /// The conversion has to go through the preview layer. `videoGravity` is
    /// `.resizeAspectFill`, so what's on screen is a crop of the sensor buffer;
    /// the map from layer points to the output's normalised, rotated coordinate
    /// space is neither the identity nor a plain scale.
    private func updateRectOfInterest() {
        guard let previewLayer else { return }
        let bounds = previewLayer.bounds
        guard bounds.width > 0, bounds.height > 0 else { return }

        let side = min(reticleSide, min(bounds.width, bounds.height))
        let reticle = CGRect(
            x: bounds.midX - side / 2,
            y: bounds.midY - side / 2,
            width: side,
            height: side
        )
        let converted = previewLayer.metadataOutputRectConverted(fromLayerRect: reticle)
        // A degenerate rect would silently disable scanning entirely, which is
        // a far worse failure than reading the full frame.
        guard converted.width > 0, converted.height > 0 else { return }

        sessionQueue.async { [weak self] in
            self?.metadataOutput?.rectOfInterest = converted
        }
    }

    /// Best-effort torch toggle.
    ///
    /// The failure is swallowed deliberately. A torch we cannot lock is a
    /// missing convenience, not a scan failure, and routing it to `onFailure`
    /// would put a camera error on screen while the camera is working fine.
    private func applyTorch() {
        let wanted = isTorchOn
        sessionQueue.async { [weak self] in
            guard
                let device = self?.captureDevice,
                device.hasTorch,
                device.isTorchAvailable
            else { return }

            do {
                try device.lockForConfiguration()
                device.torchMode = wanted ? .on : .off
                device.unlockForConfiguration()
            } catch {
                // Nothing here is actionable for the user.
            }
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
