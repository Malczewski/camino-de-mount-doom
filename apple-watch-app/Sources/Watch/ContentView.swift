import SwiftUI

struct ContentView: View {
    @EnvironmentObject var appState: AppState
    @State private var showSettings = false

    var body: some View {
        NavigationStack {
            mainContent
                .toolbar {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button(action: { showSettings = true }) {
                            Image(systemName: "gear")
                        }
                    }
                }
        }
        .sheet(isPresented: $showSettings, onDismiss: {
            Task { await appState.refresh() }
        }) {
            SettingsView()
        }
        .task {
            _ = await StepSyncManager.shared.requestAuthorization()
            scheduleNextSync()
            await appState.refresh()
        }
    }

    @ViewBuilder
    private var mainContent: some View {
        if !appState.hasApiKey {
            ErrorView(systemImage: "key.slash", message: "No API key\nConfigure in Settings →")
        } else if !appState.shareSteps {
            ErrorView(systemImage: "xmark.shield", message: "Enable step sharing in Settings →")
        } else if appState.isLoading && appState.groups.isEmpty {
            VStack(spacing: 6) {
                ProgressView()
                Text("Loading…").font(.footnote).foregroundStyle(.secondary)
            }
        } else if let err = appState.errorMessage, appState.groups.isEmpty {
            ErrorView(systemImage: "wifi.slash", message: err)
        } else if appState.groups.isEmpty {
            ErrorView(systemImage: "person.3", message: "No groups yet\nJoin one in the web app")
        } else {
            GroupPagerView()
        }
    }
}
