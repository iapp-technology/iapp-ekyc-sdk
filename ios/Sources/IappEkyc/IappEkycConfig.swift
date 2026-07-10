import Foundation

/// Theme token overrides, mapped 1:1 to the engine's `--iapp-ekyc-*` CSS
/// custom properties (docs/THEMING.md). `nil` keeps the engine default.
@objc(IappEkycTheme)
public final class IappEkycTheme: NSObject {
    @objc public var primary: String?
    @objc public var primaryDark: String?
    @objc public var primaryLight: String?
    @objc public var surface: String?
    @objc public var onPrimary: String?
    @objc public var success: String?
    @objc public var warning: String?
    @objc public var error: String?
    @objc public var overlayScrim: String?
    @objc public var brandDeep: String?
    @objc public var fontFamily: String?
    /// Corner radius in px.
    @objc public var borderRadius: NSNumber?
    /// Guide stroke width in px.
    @objc public var guideStrokeWidth: NSNumber?

    @objc public override init() {
        super.init()
    }

    var asDictionary: [String: Any] {
        var dict: [String: Any] = [:]
        dict["primary"] = primary
        dict["primaryDark"] = primaryDark
        dict["primaryLight"] = primaryLight
        dict["surface"] = surface
        dict["onPrimary"] = onPrimary
        dict["success"] = success
        dict["warning"] = warning
        dict["error"] = error
        dict["overlayScrim"] = overlayScrim
        dict["brandDeep"] = brandDeep
        dict["fontFamily"] = fontFamily
        dict["borderRadius"] = borderRadius
        dict["guideStrokeWidth"] = guideStrokeWidth
        return dict.compactMapValues { $0 }
    }
}

/// Configuration for one eKYC flow (docs/WEBVIEW_BRIDGE.md config schema).
@objc(IappEkycConfig)
public final class IappEkycConfig: NSObject {
    /// iApp API key. Pass `""` for proxy mode and point `baseUrl` at your
    /// backend, which injects the real key (docs/SECURITY.md).
    @objc public var apiKey: String
    /// Which flow to run.
    @objc public var flow: IappEkycFlowType
    /// Required when `flow == .documentCapture`.
    @objc public var documentType: IappEkycDocumentType = .thaiIdFront
    /// Override the API origin (proxy mode). Default: https://api.iapp.co.th
    @objc public var baseUrl: String?
    /// Per-request timeout in milliseconds (engine default: 60000).
    @objc public var timeoutMs: NSNumber?
    /// UI language. Default: English.
    @objc public var locale: IappEkycLocale = .en
    /// Theme token overrides.
    @objc public var theme: IappEkycTheme?
    /// Camera for `documentCapture` (liveness always uses the front camera).
    @objc public var cameraFacing: IappEkycCameraFacing = .back
    /// Include captured/selfie JPEGs in the result. Default: true.
    @objc public var returnSelfieImage: Bool = true
    /// Hosted bridge page. Override only for self-hosted deployments; must
    /// be HTTPS (camera requires a secure context).
    @objc public var hostPageURL: URL = iappEkycDefaultHostPageURL

    @objc public init(apiKey: String, flow: IappEkycFlowType) {
        self.apiKey = apiKey
        self.flow = flow
        super.init()
    }
}
