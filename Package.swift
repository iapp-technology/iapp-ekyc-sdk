// swift-tools-version:5.9
// iApp eKYC SDK — native iOS wrapper (WebView shell over the web engine).
// Lives at the repo root so `.package(url: "https://github.com/iapp-technology/iapp-ekyc-sdk", ...)`
// resolves directly; sources are under ios/. See ios/README.md.
import PackageDescription

let package = Package(
    name: "IappEkyc",
    platforms: [.iOS(.v15)],
    products: [
        .library(name: "IappEkyc", targets: ["IappEkyc"])
    ],
    targets: [
        .target(
            name: "IappEkyc",
            path: "ios/Sources/IappEkyc"
        ),
        .testTarget(
            name: "IappEkycTests",
            dependencies: ["IappEkyc"],
            path: "ios/Tests/IappEkycTests"
        ),
    ]
)
