import SwiftUI
import UIKit
import SampleApp

// PayCraft sample-app iOS wrapper (E6 device-verify, sub-plan 06, AC8).
//
// Minimal SwiftUI host that embeds the Compose Multiplatform UI produced by the
// `SampleApp.framework` Kotlin/Native static framework. The single Kotlin entry point
// `IosAppKt.SampleAppViewController()` starts Koin + PayCraft.initialize(Mock) + mirrors the
// Android launch-arg seeding harness, then returns the Compose `UIViewController` presenting App().
//
// Bundle id is `com.mobilebytelabs.paycraft.sample` — the appId the maestro flows target.

@main
struct PayCraftSampleApp: App {
    var body: some Scene {
        WindowGroup {
            ComposeRootView()
                .ignoresSafeArea(.all)
                .ignoresSafeArea(.keyboard)
        }
    }
}

struct ComposeRootView: UIViewControllerRepresentable {
    func makeUIViewController(context: Context) -> UIViewController {
        // Starts Koin, PayCraft.initialize(Mock), seeds the reconciled Premium from launch args.
        return IosAppKt.SampleAppViewController()
    }

    func updateUIViewController(_ uiViewController: UIViewController, context: Context) {}
}
