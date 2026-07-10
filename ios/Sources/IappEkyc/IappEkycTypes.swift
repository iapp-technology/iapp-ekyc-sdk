import Foundation

/// Which interactive flow the WebView runs (docs/WEBVIEW_BRIDGE.md `flow`).
@objc public enum IappEkycFlowType: Int {
    case documentCapture
    case activeLiveness
    case faceCapture

    var wireName: String {
        switch self {
        case .documentCapture: return "documentCapture"
        case .activeLiveness: return "activeLiveness"
        case .faceCapture: return "faceCapture"
        }
    }

    static func from(wireName: String) -> IappEkycFlowType? {
        switch wireName {
        case "documentCapture": return .documentCapture
        case "activeLiveness": return .activeLiveness
        case "faceCapture": return .faceCapture
        default: return nil
        }
    }
}

/// Document types accepted by `documentCapture` (docs/API_CONTRACTS.md).
@objc public enum IappEkycDocumentType: Int {
    case thaiIdFront
    case thaiIdBack
    case thaiIdWithSignature
    case thaiDriverLicense
    case bookBank
    case passport

    var wireName: String {
        switch self {
        case .thaiIdFront: return "thaiIdFront"
        case .thaiIdBack: return "thaiIdBack"
        case .thaiIdWithSignature: return "thaiIdWithSignature"
        case .thaiDriverLicense: return "thaiDriverLicense"
        case .bookBank: return "bookBank"
        case .passport: return "passport"
        }
    }
}

/// UI language of the flow (engine i18n tables).
@objc public enum IappEkycLocale: Int {
    case en
    case th
    case zh

    var wireName: String {
        switch self {
        case .en: return "en"
        case .th: return "th"
        case .zh: return "zh"
        }
    }
}

/// Which camera `documentCapture` opens (liveness always uses the front camera).
@objc public enum IappEkycCameraFacing: Int {
    /// Rear camera (`environment`) — the default for documents.
    case back
    /// Front camera (`user`).
    case front

    var wireName: String {
        switch self {
        case .back: return "environment"
        case .front: return "user"
        }
    }
}
