import Foundation

/// Parsed `error` payload of a bridge `error` event.
struct BridgeErrorPayload {
    let code: String
    let statusCode: Int?
    let messageKey: String
    let message: String
    let retryAfterSeconds: Int?
    let reason: String?
}

/// One host-page → native event (docs/WEBVIEW_BRIDGE.md).
enum BridgeEvent {
    case ready(hostPageVersion: Int, engineVersion: String?, secureContext: Bool)
    case state(flow: String, state: String, messageKey: String, detail: [String: Any])
    case result(flow: String, result: [String: Any])
    case error(BridgeErrorPayload)
    case cancelled
}

/// Foundation-only bridge codec: parses host-page events and builds the
/// `IappEkycHost.start(...)` injection. No WebKit/UIKit imports so it is
/// fully unit-testable.
enum IappEkycBridge {
    // MARK: Native → host

    /// Bridge config JSON (docs/WEBVIEW_BRIDGE.md). The API key travels only
    /// here — never in the page URL.
    static func configDictionary(for config: IappEkycConfig) -> [String: Any] {
        var dict: [String: Any] = [
            "protocolVersion": iappEkycProtocolVersion,
            "flow": config.flow.wireName,
            "apiKey": config.apiKey,
            "locale": config.locale.wireName,
            "returnSelfieImage": config.returnSelfieImage,
            "integration": [
                "name": "iapp-ekyc-sdk-ios",
                "platform": "ios",
                "version": "\(iappEkycWrapperVersion)+engine.\(iappEkycEngineVersion)",
            ],
        ]
        if config.flow == .documentCapture {
            dict["documentType"] = config.documentType.wireName
            dict["cameraFacing"] = config.cameraFacing.wireName
        }
        if let baseUrl = config.baseUrl { dict["baseUrl"] = baseUrl }
        if let timeoutMs = config.timeoutMs { dict["timeoutMs"] = timeoutMs.intValue }
        if let theme = config.theme?.asDictionary, !theme.isEmpty { dict["theme"] = theme }
        return dict
    }

    /// JavaScript that hands the config to the host page, with the JSON
    /// passed as a properly escaped string literal.
    static func startScript(for config: IappEkycConfig) throws -> String {
        let json = try JSONSerialization.data(
            withJSONObject: configDictionary(for: config), options: [.sortedKeys])
        let jsonString = String(decoding: json, as: UTF8.self)
        let literal = try JSONSerialization.data(
            withJSONObject: jsonString, options: [.fragmentsAllowed])
        return "window.IappEkycHost.start(\(String(decoding: literal, as: UTF8.self))); true;"
    }

    // MARK: Host → native

    /// Parse a `WKScriptMessage.body` (JSON string per the protocol; a
    /// pre-parsed dictionary is tolerated). Returns nil for foreign messages.
    static func parseEvent(_ body: Any) -> BridgeEvent? {
        let dict: [String: Any]
        if let string = body as? String {
            guard let data = string.data(using: .utf8),
                let parsed = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
            else { return nil }
            dict = parsed
        } else if let parsed = body as? [String: Any] {
            dict = parsed
        } else {
            return nil
        }

        switch dict["type"] as? String {
        case "ready":
            return .ready(
                hostPageVersion: dict["hostPageVersion"] as? Int ?? -1,
                engineVersion: dict["engineVersion"] as? String,
                secureContext: dict["secureContext"] as? Bool ?? false
            )
        case "state":
            return .state(
                flow: dict["flow"] as? String ?? "",
                state: dict["state"] as? String ?? "",
                messageKey: dict["messageKey"] as? String ?? "",
                detail: dict["detail"] as? [String: Any] ?? [:]
            )
        case "result":
            guard let result = dict["result"] as? [String: Any] else { return nil }
            return .result(flow: dict["flow"] as? String ?? "", result: result)
        case "error":
            let error = dict["error"] as? [String: Any] ?? [:]
            return .error(
                BridgeErrorPayload(
                    code: error["code"] as? String ?? "UNKNOWN",
                    statusCode: error["statusCode"] as? Int,
                    messageKey: error["messageKey"] as? String ?? "error_generic",
                    message: error["message"] as? String ?? "Unknown error",
                    retryAfterSeconds: error["retryAfterSeconds"] as? Int,
                    reason: error["reason"] as? String
                ))
        case "cancelled":
            return .cancelled
        default:
            return nil
        }
    }

    /// Decode an image payload `{base64, mimeType, byteLength}` field.
    static func imageData(from result: [String: Any], key: String) -> Data? {
        guard let payload = result[key] as? [String: Any],
            let base64 = payload["base64"] as? String
        else { return nil }
        return Data(base64Encoded: base64)
    }

    /// Build the typed result from a bridge `result` event.
    static func makeResult(flow flowName: String, result: [String: Any]) -> IappEkycResult? {
        guard let flow = IappEkycFlowType.from(wireName: flowName) else { return nil }
        switch flow {
        case .documentCapture:
            return IappEkycResult(
                flow: flow,
                document: IappEkycDocumentResult(
                    documentType: result["documentType"] as? String ?? "",
                    rawJSON: result["raw"] as? [String: Any] ?? [:],
                    capturedImageData: imageData(from: result, key: "capturedImage")
                ))
        case .activeLiveness:
            return IappEkycResult(
                flow: flow,
                liveness: IappEkycLivenessResult(
                    rawJSON: result["raw"] as? [String: Any] ?? [:],
                    verdictJSON: result["verdict"] as? [String: Any] ?? [:],
                    passed: result["passed"] as? Bool ?? false,
                    signature: result["signature"] as? String ?? "",
                    signatureAlg: result["signatureAlg"] as? String ?? "",
                    selfieImageData: imageData(from: result, key: "selfieImage")
                ))
        case .faceCapture:
            guard let imageData = imageData(from: result, key: "image") else { return nil }
            return IappEkycResult(flow: flow, face: IappEkycFaceResult(imageData: imageData))
        }
    }
}
