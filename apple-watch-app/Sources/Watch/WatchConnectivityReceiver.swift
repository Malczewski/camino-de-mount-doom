import WatchConnectivity
import Foundation

// Receives API key pushed from the iOS companion app via WCSession.transferUserInfo.
// This is optional — the watch app works standalone; this just makes setup easier.
final class WatchConnectivityReceiver: NSObject, WCSessionDelegate, ObservableObject {
    static let shared = WatchConnectivityReceiver()

    @Published var lastReceivedKey: String?

    override init() {
        super.init()
        guard WCSession.isSupported() else { return }
        WCSession.default.delegate = self
        WCSession.default.activate()
    }

    // MARK: WCSessionDelegate

    func session(
        _ session: WCSession,
        activationDidCompleteWith activationState: WCSessionActivationState,
        error: Error?
    ) {}

    func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any]) {
        if let key = userInfo[Constants.apiKeyStorageKey] as? String, !key.isEmpty {
            UserDefaults.standard.set(key, forKey: Constants.apiKeyStorageKey)
            DispatchQueue.main.async { self.lastReceivedKey = key }
        }
        if let share = userInfo[Constants.shareStepsKey] as? Bool {
            UserDefaults.standard.set(share, forKey: Constants.shareStepsKey)
        }
    }

    func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
        session(session, didReceiveUserInfo: applicationContext)
    }
}
