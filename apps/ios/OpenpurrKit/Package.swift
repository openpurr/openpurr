// swift-tools-version: 6.0
// The app's code that isn't UI: the admin API client, sign-in (OAuth with PKCE), token storage,
// models and formatting. A package so it builds and tests on macOS with `swift test`, and so a
// widget or notification extension can share it later.
import PackageDescription

let package = Package(
    name: "OpenpurrKit",
    platforms: [.iOS("17.4"), .macOS(.v14)],
    products: [.library(name: "OpenpurrKit", targets: ["OpenpurrKit"])],
    targets: [
        .target(name: "OpenpurrKit"),
        .testTarget(name: "OpenpurrKitTests", dependencies: ["OpenpurrKit"]),
    ]
)
