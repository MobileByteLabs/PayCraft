import SwiftUI
import shared // Your KMP shared module

@main
struct PayCraftDemoApp: App {
    init() {
        AppInitKt.initPayCraft()
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}

struct ContentView: View {
    @State private var showPaywall = false

    var body: some View {
        NavigationStack {
            VStack(spacing: 24) {
                Text("PayCraft Demo")
                    .font(.largeTitle)

                Button("Show Paywall") {
                    showPaywall = true
                }
                .buttonStyle(.borderedProminent)
            }
            .sheet(isPresented: $showPaywall) {
                PaywallView()
            }
        }
    }
}
