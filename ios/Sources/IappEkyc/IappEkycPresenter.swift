import Foundation
import UIKit

/// Convenience entry points. Named `IappEkycSdk` (not `IappEkyc`) to avoid
/// clashing with the Swift module name.
@objc(IappEkycSdk)
public final class IappEkycSdk: NSObject {
    private override init() {}

    /// Present a full-screen flow and report through the delegate.
    @objc(presentFrom:config:delegate:)
    @discardableResult
    public static func present(
        from presenter: UIViewController,
        config: IappEkycConfig,
        delegate: IappEkycViewControllerDelegate
    ) -> IappEkycViewController {
        let controller = IappEkycViewController(config: config)
        controller.delegate = delegate
        presenter.present(controller, animated: true)
        return controller
    }

    /// Present a full-screen flow and report through a Swift closure.
    /// Cancellation surfaces as `.failure` with code `.cancelled`.
    @discardableResult
    public static func present(
        from presenter: UIViewController,
        config: IappEkycConfig,
        completion: @escaping (Result<IappEkycResult, Error>) -> Void
    ) -> IappEkycViewController {
        let controller = IappEkycViewController(config: config)
        controller.completion = completion
        presenter.present(controller, animated: true)
        return controller
    }
}
