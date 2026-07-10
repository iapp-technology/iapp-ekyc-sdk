# iOS example

The SDK ships as a Swift package, so there is no committed `.xcodeproj` —
add the two example view controllers to any iOS app:

1. In Xcode: **File → Add Package Dependencies…** →
   `https://github.com/iapp-technology/iapp-ekyc-sdk` (product **IappEkyc**).
2. Add `NSCameraUsageDescription` to the app's Info.plist, e.g.
   *"Camera access is required to capture your ID document and verify liveness."*
3. Copy `SwiftExampleViewController.swift` (Swift) and/or
   `ObjCExampleViewController.m` (Objective-C) into the app target and wire
   the actions to buttons.
4. Replace `YOUR_API_KEY` with a key from https://iapp.co.th/control/api-keys
   (or pass `""` and set `config.baseUrl` to your own proxy — docs/SECURITY.md).

Minimum deployment target: **iOS 15**. Internet access to
`https://iapp.co.th/sdk/webview.html` is required at runtime
(docs/WEBVIEW_BRIDGE.md).
