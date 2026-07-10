import XCTest

@testable import IappEkyc

final class BridgeMessageTests: XCTestCase {
    // MARK: - Event parsing (host → native)

    func testParsesReady() throws {
        let event = IappEkycBridge.parseEvent(
            #"{"protocolVersion":1,"type":"ready","hostPageVersion":1,"engineVersion":"0.2.0","secureContext":true}"#
        )
        guard case let .ready(hostPageVersion, engineVersion, secureContext) = event else {
            return XCTFail("expected .ready, got \(String(describing: event))")
        }
        XCTAssertEqual(hostPageVersion, 1)
        XCTAssertEqual(engineVersion, "0.2.0")
        XCTAssertTrue(secureContext)
    }

    func testParsesLivenessState() throws {
        let event = IappEkycBridge.parseEvent(
            #"{"protocolVersion":1,"type":"state","flow":"activeLiveness","state":"challenge","messageKey":"blink_now","detail":{"challenge":"blink","challengeIndex":1,"challengeCount":3}}"#
        )
        guard case let .state(flow, state, messageKey, detail) = event else {
            return XCTFail("expected .state")
        }
        XCTAssertEqual(flow, "activeLiveness")
        XCTAssertEqual(state, "challenge")
        XCTAssertEqual(messageKey, "blink_now")
        XCTAssertEqual(detail["challenge"] as? String, "blink")
        XCTAssertEqual(detail["challengeCount"] as? Int, 3)
    }

    func testParsesDocumentResultWithImage() throws {
        let jpegBase64 = Data([0xFF, 0xD8, 0xFF, 0xE0]).base64EncodedString()
        let event = IappEkycBridge.parseEvent(
            """
            {"protocolVersion":1,"type":"result","flow":"documentCapture","result":{
              "flow":"documentCapture","documentType":"thaiIdFront",
              "raw":{"id_number":"1234567890123"},
              "capturedImage":{"base64":"\(jpegBase64)","mimeType":"image/jpeg","byteLength":4}}}
            """)
        guard case let .result(flow, result) = event else { return XCTFail("expected .result") }
        let typed = IappEkycBridge.makeResult(flow: flow, result: result)
        XCTAssertEqual(typed?.flow, .documentCapture)
        XCTAssertEqual(typed?.document?.documentType, "thaiIdFront")
        XCTAssertEqual(typed?.document?.rawJSON["id_number"] as? String, "1234567890123")
        XCTAssertEqual(typed?.document?.capturedImageData?.count, 4)
        XCTAssertNil(typed?.liveness)
        XCTAssertNil(typed?.face)
    }

    func testParsesLivenessResult() throws {
        let event = IappEkycBridge.parseEvent(
            #"{"type":"result","flow":"activeLiveness","result":{"flow":"activeLiveness","raw":{},"verdict":{"passed":true,"session_id":"s1"},"passed":true,"signature":"abc123","signatureAlg":"HMAC-SHA256","selfieImage":null}}"#
        )
        guard case let .result(flow, result) = event else { return XCTFail("expected .result") }
        let typed = IappEkycBridge.makeResult(flow: flow, result: result)
        XCTAssertEqual(typed?.flow, .activeLiveness)
        XCTAssertEqual(typed?.liveness?.passed, true)
        XCTAssertEqual(typed?.liveness?.signature, "abc123")
        XCTAssertEqual(typed?.liveness?.verdictJSON["session_id"] as? String, "s1")
        XCTAssertNil(typed?.liveness?.selfieImageData)
    }

    func testParsesErrorWithRetryAfter() throws {
        let event = IappEkycBridge.parseEvent(
            #"{"type":"error","error":{"code":"RATE_LIMITED","statusCode":429,"messageKey":"error_rate_limited","message":"Rate limited","retryAfterSeconds":30}}"#
        )
        guard case let .error(payload) = event else { return XCTFail("expected .error") }
        let nsError = IappEkycErrorFactory.from(bridgeError: payload)
        XCTAssertEqual(nsError.domain, IappEkycErrorDomain)
        XCTAssertEqual(nsError.code, IappEkycErrorCode.rateLimited.rawValue)
        XCTAssertEqual(nsError.userInfo[IappEkycErrorStatusCodeKey] as? Int, 429)
        XCTAssertEqual(nsError.userInfo[IappEkycErrorRetryAfterKey] as? Int, 30)
    }

    func testUnknownBridgeCodeMapsToUnknown() throws {
        let payload = BridgeErrorPayload(
            code: "SOMETHING_NEW", statusCode: nil, messageKey: "error_generic",
            message: "x", retryAfterSeconds: nil, reason: nil)
        XCTAssertEqual(
            IappEkycErrorFactory.from(bridgeError: payload).code,
            IappEkycErrorCode.unknown.rawValue)
    }

    func testParsesCancelledAndIgnoresForeignMessages() throws {
        guard case .cancelled = IappEkycBridge.parseEvent(#"{"type":"cancelled"}"#) else {
            return XCTFail("expected .cancelled")
        }
        XCTAssertNil(IappEkycBridge.parseEvent(#"{"type":"telemetry"}"#))
        XCTAssertNil(IappEkycBridge.parseEvent("not json"))
        XCTAssertNil(IappEkycBridge.parseEvent(42))
    }

    // MARK: - Config encoding (native → host)

    func testConfigDictionaryCarriesIdentityAndDocumentFields() throws {
        let config = IappEkycConfig(apiKey: "sk-test", flow: .documentCapture)
        config.documentType = .passport
        config.locale = .th
        config.cameraFacing = .front
        let dict = IappEkycBridge.configDictionary(for: config)

        XCTAssertEqual(dict["protocolVersion"] as? Int, 1)
        XCTAssertEqual(dict["flow"] as? String, "documentCapture")
        XCTAssertEqual(dict["documentType"] as? String, "passport")
        XCTAssertEqual(dict["cameraFacing"] as? String, "user")
        XCTAssertEqual(dict["locale"] as? String, "th")
        let integration = dict["integration"] as? [String: Any]
        XCTAssertEqual(integration?["name"] as? String, "iapp-ekyc-sdk-ios")
        XCTAssertEqual(integration?["platform"] as? String, "ios")
    }

    func testLivenessConfigOmitsDocumentFields() throws {
        let config = IappEkycConfig(apiKey: "", flow: .activeLiveness)
        let dict = IappEkycBridge.configDictionary(for: config)
        XCTAssertNil(dict["documentType"])
        XCTAssertNil(dict["cameraFacing"])
        XCTAssertEqual(dict["apiKey"] as? String, "")
    }

    func testStartScriptEscapesHostileStrings() throws {
        let config = IappEkycConfig(apiKey: #"k"1'\n</script>"#, flow: .faceCapture)
        let script = try IappEkycBridge.startScript(for: config)
        XCTAssertTrue(script.hasPrefix("window.IappEkycHost.start(\""))
        XCTAssertTrue(script.hasSuffix("); true;"))
        // The raw quote/backslash must not survive unescaped inside the literal.
        XCTAssertFalse(script.contains(#"k"1"#))
    }
}
