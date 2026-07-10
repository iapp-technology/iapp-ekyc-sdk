import Foundation

/// Wrapper version, reported in the active-liveness challenge log
/// (`sdk.version = "<wrapper>+engine.<engine>"`, docs/ACTIVE_LIVENESS.md).
public let iappEkycWrapperVersion = "0.2.0"

/// Engine (web SDK) version this wrapper release was tested against.
let iappEkycEngineVersion = "0.2.0"

/// Default hosted page speaking bridge protocol v1 (docs/WEBVIEW_BRIDGE.md).
public let iappEkycDefaultHostPageURL = URL(string: "https://iapp.co.th/sdk/webview.html")!

/// The single host-page version this wrapper understands; a `ready` event
/// with any other version fails the flow with `.protocolMismatch`.
let iappEkycSupportedHostPageVersion = 1

let iappEkycProtocolVersion = 1
