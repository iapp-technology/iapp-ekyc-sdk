// Example: Swift usage of the iApp eKYC SDK (see ios/Example/README.md).
// Requires NSCameraUsageDescription in the app's Info.plist.
import IappEkyc
import UIKit

final class SwiftExampleViewController: UIViewController {
    @IBAction func captureThaiIdTapped(_ sender: Any) {
        let config = IappEkycConfig(apiKey: "YOUR_API_KEY", flow: .documentCapture)
        config.documentType = .thaiIdFront
        config.locale = .th

        IappEkycSdk.present(from: self, config: config) { result in
            switch result {
            case .success(let outcome):
                print("OCR fields:", outcome.document?.rawJSON ?? [:])
            case .failure(let error as NSError)
            where error.code == IappEkycErrorCode.cancelled.rawValue:
                print("User cancelled")
            case .failure(let error as NSError)
            where error.code == IappEkycErrorCode.insufficientCredit.rawValue:
                print("Top up at https://iapp.co.th/control/credits")
            case .failure(let error):
                print("eKYC failed:", error.localizedDescription)
            }
        }
    }

    @IBAction func livenessTapped(_ sender: Any) {
        let config = IappEkycConfig(apiKey: "YOUR_API_KEY", flow: .activeLiveness)

        IappEkycSdk.present(from: self, config: config) { result in
            if case .success(let outcome) = result, let liveness = outcome.liveness {
                // Send verdictJSON + signature to YOUR backend for HMAC
                // verification — never trust `passed` alone on-device.
                print("passed:", liveness.passed, "signature:", liveness.signature)
            }
        }
    }
}
