import SwiftUI

struct SettingsView: View {
    @AppStorage(Constants.apiKeyStorageKey) private var apiKey = ""
    @AppStorage(Constants.shareStepsKey) private var shareSteps = false
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Paste API key", text: $apiKey)
                        .font(.system(.caption2, design: .monospaced))
                        .autocorrectionDisabled()
                        .textInputAutocapitalization(.never)
                } header: {
                    Text("API Key")
                } footer: {
                    // Universal Clipboard (Handoff) lets users copy on iPhone and paste here
                    Text("Copy from your web app profile, then paste here using Digital Crown → paste.")
                        .font(.caption2)
                }

                Section("Sharing") {
                    Toggle("Share my steps", isOn: $shareSteps)
                    if shareSteps {
                        Text("Daily step count uploads to your groups once per hour.")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                }

                Section {
                    Button("Open Web App") {
                        openURL(URL(string: Constants.webAppURL)!)
                    }
                    .font(.caption)
                }
            }
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }
}
