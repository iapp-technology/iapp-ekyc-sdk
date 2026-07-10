import Foundation
import UIKit

/// Result of a `documentCapture` flow: the full OCR response plus the
/// perspective-corrected JPEG the engine uploaded.
@objc(IappEkycDocumentResult)
public final class IappEkycDocumentResult: NSObject {
    /// Wire document type, e.g. `"thaiIdFront"`.
    @objc public let documentType: String
    /// Full parsed OCR response, untouched.
    @objc public let rawJSON: [String: Any]
    /// JPEG bytes of the captured document (nil when `returnSelfieImage=false`).
    @objc public let capturedImageData: Data?
    @objc public var capturedImage: UIImage? {
        capturedImageData.flatMap(UIImage.init(data:))
    }

    init(documentType: String, rawJSON: [String: Any], capturedImageData: Data?) {
        self.documentType = documentType
        self.rawJSON = rawJSON
        self.capturedImageData = capturedImageData
    }
}

/// Result of an `activeLiveness` flow. Only the server-signed `verdictJSON`
/// (verify `signature` on YOUR backend) proves liveness — never trust
/// `passed` alone on-device (docs/SECURITY.md).
@objc(IappEkycLivenessResult)
public final class IappEkycLivenessResult: NSObject {
    /// Full parsed finalize response, untouched.
    @objc public let rawJSON: [String: Any]
    /// The signed verdict object (session_id, selfie_sha256, nonce, ...).
    @objc public let verdictJSON: [String: Any]
    /// Convenience mirror of `verdictJSON["passed"]`.
    @objc public let passed: Bool
    /// hex(HMAC-SHA256(secret, canonicalJSON(verdict)))
    @objc public let signature: String
    @objc public let signatureAlg: String
    /// The selfie JPEG the engine uploaded (nil when `returnSelfieImage=false`).
    @objc public let selfieImageData: Data?
    @objc public var selfieImage: UIImage? {
        selfieImageData.flatMap(UIImage.init(data:))
    }

    init(
        rawJSON: [String: Any],
        verdictJSON: [String: Any],
        passed: Bool,
        signature: String,
        signatureAlg: String,
        selfieImageData: Data?
    ) {
        self.rawJSON = rawJSON
        self.verdictJSON = verdictJSON
        self.passed = passed
        self.signature = signature
        self.signatureAlg = signatureAlg
        self.selfieImageData = selfieImageData
    }
}

/// Result of a `faceCapture` flow (cropped frontal selfie, no liveness).
@objc(IappEkycFaceResult)
public final class IappEkycFaceResult: NSObject {
    @objc public let imageData: Data
    @objc public var image: UIImage? { UIImage(data: imageData) }

    init(imageData: Data) {
        self.imageData = imageData
    }
}

/// Union result: exactly one of `document` / `liveness` / `face` is non-nil,
/// matching `flow`.
@objc(IappEkycResult)
public final class IappEkycResult: NSObject {
    @objc public let flow: IappEkycFlowType
    @objc public let document: IappEkycDocumentResult?
    @objc public let liveness: IappEkycLivenessResult?
    @objc public let face: IappEkycFaceResult?

    init(
        flow: IappEkycFlowType,
        document: IappEkycDocumentResult? = nil,
        liveness: IappEkycLivenessResult? = nil,
        face: IappEkycFaceResult? = nil
    ) {
        self.flow = flow
        self.document = document
        self.liveness = liveness
        self.face = face
    }
}
