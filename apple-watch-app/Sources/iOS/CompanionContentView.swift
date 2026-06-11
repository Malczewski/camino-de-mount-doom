import SwiftUI

struct CompanionContentView: View {
    @StateObject private var bridge = WatchBridge.shared
    @State private var apiKey = ""
    @State private var shareSteps = true

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("1. Open the web app and sign in")
                        Text("2. Go to your Profile")
                        Text("3. Copy the API key shown there")
                        Link("Open Web App →",
                             destination: URL(string: "https://camino-de-mount-doom.netlify.app")!)
                            .font(.footnote)
                    }
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                } header: {
                    Text("Setup")
                }

                Section("API Key") {
                    TextField("Paste API key here", text: $apiKey)
                        .textContentType(.password)
                        .autocorrectionDisabled()
                        .textInputAutocapitalization(.never)
                        .font(.system(.body, design: .monospaced))
                }

                Section("Sharing") {
                    Toggle("Share my steps", isOn: $shareSteps)
                    Text("Allows the watch app to upload your step count to your groups once per hour.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                Section {
                    Button(action: sendToWatch) {
                        HStack {
                            Image(systemName: "applewatch")
                            Text("Send to Apple Watch")
                        }
                    }
                    .disabled(apiKey.trimmingCharacters(in: .whitespaces).isEmpty)

                    if bridge.didSend {
                        Label("Sent — watch will update shortly", systemImage: "checkmark.circle.fill")
                            .foregroundStyle(.green)
                            .font(.footnote)
                    }
                }
            }
            .navigationTitle("Camino de Mount Doom")
        }
    }

    private func sendToWatch() {
        bridge.sendToWatch(apiKey: apiKey.trimmingCharacters(in: .whitespaces), shareSteps: shareSteps)
    }
}
