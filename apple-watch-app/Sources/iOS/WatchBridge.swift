import WatchConnectivity
import Foundation

final class WatchBridge: NSObject, WCSessionDelegate, ObservableObject {
    static let shared = WatchBridge()

    @Published var isWatchReachable = false
    @Published var didSend = false

    override init() {
        super.init()
        guard WCSession.isSupported() else { return }
        WCSession.default.delegate = self
        WCSession.default.activate()
    }

    func sendToWatch(apiKey: String, shareSteps: Bool) {
        let payload: [String: Any] = [
            "api_key": apiKey,
            "share_steps": shareSteps
        ]
        // transferUserInfo queues delivery even when watch is not reachable
        WCSession.default.transferUserInfo(payload)
        DispatchQueue.main.async { self.didSend = true }
    }

    // MARK: WCSessionDelegate

    func session(
        _ session: WCSession,
        activationDidCompleteWith activationState: WCSessionActivationState,
        error: Error?
    ) {
        DispatchQueue.main.async {
            self.isWatchReachable = session.isReachable
        }
    }

    func sessionReachabilityDidChange(_ session: WCSession) {
        DispatchQueue.main.async {
            self.isWatchReachable = session.isReachable
        }
    }

    func sessionDidBecomeInactive(_ session: WCSession) {}
    func sessionDidDeactivate(_ session: WCSession) { WCSession.default.activate() }
}
