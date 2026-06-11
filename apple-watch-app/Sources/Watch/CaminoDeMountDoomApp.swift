import SwiftUI
import WatchKit

@main
struct CaminoDeMountDoomApp: App {
    @StateObject private var appState = AppState()
    // Initialising the receiver registers the WCSession delegate on launch
    @StateObject private var connectivityReceiver = WatchConnectivityReceiver.shared

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(appState)
                .onReceive(connectivityReceiver.$lastReceivedKey.compactMap { $0 }) { _ in
                    // Refresh after receiving a new API key from the iOS companion
                    Task { await appState.refresh() }
                }
        }
        // Background refresh fires ~hourly; system decides exact timing to preserve battery
        .backgroundTask(.appRefresh(Constants.backgroundTaskIdentifier)) {
            await performBackgroundSync()
        }
    }

    private func performBackgroundSync() async {
        let apiKey = UserDefaults.standard.string(forKey: Constants.apiKeyStorageKey) ?? ""
        let shareSteps = UserDefaults.standard.bool(forKey: Constants.shareStepsKey)
        guard !apiKey.isEmpty, shareSteps else { return }

        // Request HealthKit auth if not yet granted (no-op if already authorized)
        _ = await StepSyncManager.shared.requestAuthorization()
        await StepSyncManager.shared.sync(apiKey: apiKey)

        scheduleNextSync()
    }
}

func scheduleNextSync() {
    WKApplication.shared().scheduleBackgroundRefresh(
        withPreferredDate: Date().addingTimeInterval(Constants.syncInterval),
        userInfo: nil
    ) { _ in }
}
