// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "keychain-probe",
    platforms: [.macOS(.v13)],
    targets: [
        .executableTarget(
            name: "keychain-probe",
            path: "Sources/KeychainProbe"
        ),
    ]
)
