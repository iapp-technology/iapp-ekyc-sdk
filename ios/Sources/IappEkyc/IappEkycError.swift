import Foundation

/// NSError domain for all wrapper errors.
public let IappEkycErrorDomain = "th.co.iapp.ekyc"

/// userInfo key: engine i18n key (resolvable via the engine message tables).
public let IappEkycErrorMessageKeyKey = "IappEkycErrorMessageKey"
/// userInfo key: HTTP status code (NSNumber), when the error came from the API.
public let IappEkycErrorStatusCodeKey = "IappEkycErrorStatusCode"
/// userInfo key: Retry-After seconds (NSNumber) for `.rateLimited`.
public let IappEkycErrorRetryAfterKey = "IappEkycErrorRetryAfter"
/// userInfo key: liveness fail reason string for `.livenessFailed`.
public let IappEkycErrorReasonKey = "IappEkycErrorReason"

/// Stable error codes (docs/WEBVIEW_BRIDGE.md). HTTP-mapped codes reuse the
/// status number; wrapper/host conditions live in the 1000 range.
@objc public enum IappEkycErrorCode: Int {
    case unknown = 0
    case badRequest = 400
    case invalidApiKey = 401
    case insufficientCredit = 402
    case fileTooLarge = 413
    case rateLimited = 429
    case serverError = 500
    case networkError = 1000
    case timeout = 1001
    case cancelled = 1002
    case livenessFailed = 1003
    case cameraPermissionDenied = 1004
    case cameraNotFound = 1005
    case insecureContext = 1006
    case engineLoadFailed = 1007
    case invalidConfig = 1008
    case hostPageLoadFailed = 1009
    case protocolMismatch = 1010
}

enum IappEkycErrorFactory {
    static let codeByBridgeCode: [String: IappEkycErrorCode] = [
        "BAD_REQUEST": .badRequest,
        "INVALID_API_KEY": .invalidApiKey,
        "INSUFFICIENT_CREDIT": .insufficientCredit,
        "FILE_TOO_LARGE": .fileTooLarge,
        "RATE_LIMITED": .rateLimited,
        "SERVER_ERROR": .serverError,
        "NETWORK_ERROR": .networkError,
        "TIMEOUT": .timeout,
        "LIVENESS_FAILED": .livenessFailed,
        "CAMERA_PERMISSION_DENIED": .cameraPermissionDenied,
        "CAMERA_NOT_FOUND": .cameraNotFound,
        "INSECURE_CONTEXT": .insecureContext,
        "ENGINE_LOAD_FAILED": .engineLoadFailed,
        "INVALID_CONFIG": .invalidConfig,
        "INVALID_STATE": .invalidConfig,
        "UNKNOWN": .unknown,
    ]

    static func make(
        code: IappEkycErrorCode,
        message: String,
        messageKey: String = "error_generic",
        statusCode: Int? = nil,
        retryAfterSeconds: Int? = nil,
        reason: String? = nil
    ) -> NSError {
        var userInfo: [String: Any] = [
            NSLocalizedDescriptionKey: message,
            IappEkycErrorMessageKeyKey: messageKey,
        ]
        if let statusCode { userInfo[IappEkycErrorStatusCodeKey] = NSNumber(value: statusCode) }
        if let retryAfterSeconds {
            userInfo[IappEkycErrorRetryAfterKey] = NSNumber(value: retryAfterSeconds)
        }
        if let reason { userInfo[IappEkycErrorReasonKey] = reason }
        return NSError(domain: IappEkycErrorDomain, code: code.rawValue, userInfo: userInfo)
    }

    static func from(bridgeError: BridgeErrorPayload) -> NSError {
        make(
            code: codeByBridgeCode[bridgeError.code] ?? .unknown,
            message: bridgeError.message,
            messageKey: bridgeError.messageKey,
            statusCode: bridgeError.statusCode,
            retryAfterSeconds: bridgeError.retryAfterSeconds,
            reason: bridgeError.reason
        )
    }
}
