import AVFoundation
import Foundation
import UIKit
import WebKit

/// Delegate surface (Objective-C compatible). Exactly one of
/// `didFinishWithResult:` / `didFailWithError:` / `didCancel` fires per flow.
@objc(IappEkycViewControllerDelegate)
public protocol IappEkycViewControllerDelegate: AnyObject {
    @objc(ekycController:didFinishWithResult:)
    func ekycController(_ controller: IappEkycViewController, didFinishWith result: IappEkycResult)

    @objc(ekycController:didFailWithError:)
    func ekycController(_ controller: IappEkycViewController, didFailWith error: NSError)

    @objc(ekycControllerDidCancel:)
    func ekycControllerDidCancel(_ controller: IappEkycViewController)

    /// Optional UX/analytics hook mirroring the engine state events.
    @objc(ekycController:didChangeState:info:)
    optional func ekycController(
        _ controller: IappEkycViewController, didChangeState state: String, info: [String: Any])
}

/// Breaks the WKUserContentController → handler retain cycle.
private final class WeakScriptMessageProxy: NSObject, WKScriptMessageHandler {
    weak var target: WKScriptMessageHandler?

    init(target: WKScriptMessageHandler) {
        self.target = target
    }

    func userContentController(
        _ userContentController: WKUserContentController, didReceive message: WKScriptMessage
    ) {
        target?.userContentController(userContentController, didReceive: message)
    }
}

/// Full-screen WKWebView shell running one eKYC flow via the hosted bridge
/// page (docs/WEBVIEW_BRIDGE.md). Present it modally (or use
/// ``IappEkycSdk``); results arrive on the delegate and/or `completion`.
@objc(IappEkycViewController)
public final class IappEkycViewController: UIViewController {
    private static let messageHandlerName = "iappEkyc"

    @objc public weak var delegate: IappEkycViewControllerDelegate?
    /// Swift-friendly alternative to the delegate; both are called.
    public var completion: ((Result<IappEkycResult, Error>) -> Void)?
    /// Dismiss automatically when the flow ends (default true). Turn off if
    /// you push the controller yourself and handle dismissal in the delegate.
    @objc public var automaticallyDismissesOnFinish = true

    private let config: IappEkycConfig
    private var webView: WKWebView?
    private var finished = false

    @objc public init(config: IappEkycConfig) {
        self.config = config
        super.init(nibName: nil, bundle: nil)
        modalPresentationStyle = .fullScreen
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("IappEkycViewController must be created with init(config:)")
    }

    public override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black

        guard config.hostPageURL.scheme?.lowercased() == "https" else {
            fail(
                IappEkycErrorFactory.make(
                    code: .invalidConfig,
                    message: "hostPageURL must be HTTPS (camera requires a secure context)"))
            return
        }
        guard Bundle.main.object(forInfoDictionaryKey: "NSCameraUsageDescription") != nil else {
            fail(
                IappEkycErrorFactory.make(
                    code: .invalidConfig,
                    message: "Add NSCameraUsageDescription to your app's Info.plist"))
            return
        }

        // Resolve the native camera permission before loading the page so a
        // denial fails fast and the in-page prompt can be silently granted.
        AVCaptureDevice.requestAccess(for: .video) { [weak self] granted in
            DispatchQueue.main.async {
                guard let self else { return }
                if granted {
                    self.loadHostPage()
                } else {
                    self.fail(
                        IappEkycErrorFactory.make(
                            code: .cameraPermissionDenied,
                            message: "Camera permission denied",
                            messageKey: "error_camera_permission"))
                }
            }
        }
    }

    public override func viewDidDisappear(_ animated: Bool) {
        super.viewDidDisappear(animated)
        // Swipe-down / external dismissal before any outcome = user cancel.
        if !finished {
            finished = true
            teardownWebView()
            delegate?.ekycControllerDidCancel(self)
            completion?(.failure(IappEkycErrorFactory.make(
                code: .cancelled, message: "Flow cancelled by the user",
                messageKey: "error_cancelled")))
        }
    }

    // MARK: - WebView lifecycle

    private func loadHostPage() {
        let configuration = WKWebViewConfiguration()
        configuration.allowsInlineMediaPlayback = true
        configuration.mediaTypesRequiringUserActionForPlayback = []
        configuration.userContentController.add(
            WeakScriptMessageProxy(target: self), name: Self.messageHandlerName)

        let webView = WKWebView(frame: view.bounds, configuration: configuration)
        webView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.isOpaque = false
        webView.backgroundColor = .black
        webView.scrollView.isScrollEnabled = false
        view.addSubview(webView)
        self.webView = webView

        webView.load(URLRequest(url: config.hostPageURL))
    }

    /// Destroying the WebView is the abort mechanism: it stops the camera
    /// and the in-page flow (the engine has no abort API).
    private func teardownWebView() {
        guard let webView else { return }
        webView.configuration.userContentController.removeScriptMessageHandler(
            forName: Self.messageHandlerName)
        webView.stopLoading()
        webView.navigationDelegate = nil
        webView.uiDelegate = nil
        webView.removeFromSuperview()
        self.webView = nil
    }

    // MARK: - Outcomes

    private func finish(with result: IappEkycResult) {
        guard !finished else { return }
        finished = true
        teardownWebView()
        dismissIfNeeded()
        delegate?.ekycController(self, didFinishWith: result)
        completion?(.success(result))
    }

    private func fail(_ error: NSError) {
        guard !finished else { return }
        finished = true
        teardownWebView()
        dismissIfNeeded()
        delegate?.ekycController(self, didFailWith: error)
        completion?(.failure(error))
    }

    private func cancel() {
        guard !finished else { return }
        finished = true
        teardownWebView()
        dismissIfNeeded()
        delegate?.ekycControllerDidCancel(self)
        completion?(.failure(IappEkycErrorFactory.make(
            code: .cancelled, message: "Flow cancelled by the user",
            messageKey: "error_cancelled")))
    }

    private func dismissIfNeeded() {
        if automaticallyDismissesOnFinish, presentingViewController != nil {
            dismiss(animated: true)
        }
    }

    // MARK: - Bridge events

    private func handle(event: BridgeEvent) {
        switch event {
        case let .ready(hostPageVersion, _, _):
            guard hostPageVersion == iappEkycSupportedHostPageVersion else {
                fail(
                    IappEkycErrorFactory.make(
                        code: .protocolMismatch,
                        message:
                            "Host page version \(hostPageVersion) is not supported by this SDK — update the iApp eKYC SDK"
                    ))
                return
            }
            do {
                let script = try IappEkycBridge.startScript(for: config)
                webView?.evaluateJavaScript(script)
            } catch {
                fail(
                    IappEkycErrorFactory.make(
                        code: .invalidConfig,
                        message: "Failed to encode flow config: \(error.localizedDescription)"))
            }

        case let .state(_, state, messageKey, detail):
            var info = detail
            info["messageKey"] = messageKey
            delegate?.ekycController?(self, didChangeState: state, info: info)

        case let .result(flow, result):
            if let typed = IappEkycBridge.makeResult(flow: flow, result: result) {
                finish(with: typed)
            } else {
                fail(
                    IappEkycErrorFactory.make(
                        code: .unknown, message: "Malformed result payload for flow '\(flow)'"))
            }

        case let .error(payload):
            fail(IappEkycErrorFactory.from(bridgeError: payload))

        case .cancelled:
            cancel()
        }
    }
}

// MARK: - WKScriptMessageHandler

extension IappEkycViewController: WKScriptMessageHandler {
    public func userContentController(
        _ userContentController: WKUserContentController, didReceive message: WKScriptMessage
    ) {
        guard message.name == Self.messageHandlerName,
            let event = IappEkycBridge.parseEvent(message.body)
        else { return }
        handle(event: event)
    }
}

// MARK: - WKUIDelegate

extension IappEkycViewController: WKUIDelegate {
    /// The native permission was already granted in `viewDidLoad`, so grant
    /// the in-page camera request for our host origin (no second prompt).
    public func webView(
        _ webView: WKWebView,
        requestMediaCapturePermissionFor origin: WKSecurityOrigin,
        initiatedByFrame frame: WKFrameInfo,
        type: WKMediaCaptureType,
        decisionHandler: @escaping (WKPermissionDecision) -> Void
    ) {
        if type == .camera, origin.host == config.hostPageURL.host {
            decisionHandler(.grant)
        } else {
            decisionHandler(.deny)
        }
    }
}

// MARK: - WKNavigationDelegate

extension IappEkycViewController: WKNavigationDelegate {
    public func webView(
        _ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!,
        withError error: Error
    ) {
        fail(
            IappEkycErrorFactory.make(
                code: .hostPageLoadFailed,
                message: "Could not load \(config.hostPageURL.absoluteString): \(error.localizedDescription)"
            ))
    }

    public func webView(
        _ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error
    ) {
        fail(
            IappEkycErrorFactory.make(
                code: .hostPageLoadFailed,
                message: "Host page failed: \(error.localizedDescription)"))
    }
}
