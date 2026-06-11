import SwiftUI
import Combine

@MainActor
final class AppState: ObservableObject {
    @Published var groups: [GroupModel] = []
    @Published var totalSteps: Double = 0
    @Published var isLoading = false
    @Published var errorMessage: String?

    // Persisted via UserDefaults / AppStorage — shared key names with WatchConnectivity
    @AppStorage(Constants.apiKeyStorageKey) var apiKey: String = ""
    @AppStorage(Constants.shareStepsKey) var shareSteps: Bool = false

    var hasApiKey: Bool { !apiKey.trimmingCharacters(in: .whitespaces).isEmpty }

    func refresh() async {
        guard hasApiKey, shareSteps else { return }
        isLoading = true
        errorMessage = nil
        do {
            let response = try await GroupDataService.fetchGroups(apiKey: apiKey)
            groups = response.groups
            totalSteps = response.totalSteps
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }
}
