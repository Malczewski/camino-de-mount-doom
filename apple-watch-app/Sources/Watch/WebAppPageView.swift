import SwiftUI

// Last page in the group pager — mirrors Garmin's "Web App / Press to open" page.
// openURL on watchOS routes through the paired iPhone browser.
struct WebAppPageView: View {
    @Environment(\.openURL) private var openURL

    var body: some View {
        VStack(spacing: 8) {
            Image(systemName: "globe")
                .font(.title2)
                .foregroundStyle(.secondary)

            Text("Web App")
                .font(.headline)

            Text("camino-de-mount-doom\n.netlify.app")
                .font(.caption2)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)

            Button("Open on iPhone") {
                openURL(URL(string: Constants.webAppURL)!)
            }
            .font(.caption2)
            .buttonStyle(.borderedProminent)
            .tint(.blue)
        }
        .padding(.horizontal, 8)
    }
}
