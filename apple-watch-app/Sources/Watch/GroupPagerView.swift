import SwiftUI

// Horizontal page-swipe between groups (matching Garmin's swipe-left/right navigation).
// Last page is the web app shortcut.
struct GroupPagerView: View {
    @EnvironmentObject var appState: AppState
    @State private var selectedPage = 0

    var totalPages: Int { appState.groups.count + 1 }

    var body: some View {
        TabView(selection: $selectedPage) {
            ForEach(Array(appState.groups.enumerated()), id: \.element.id) { index, group in
                GroupPageView(group: group)
                    .tag(index)
            }
            WebAppPageView()
                .tag(appState.groups.count)
        }
        .tabViewStyle(.page)
        // Sync in background while viewing — matches Garmin onShow behaviour
        .onAppear {
            Task { await appState.refresh() }
        }
    }
}
