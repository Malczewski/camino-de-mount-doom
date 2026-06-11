import SwiftUI

struct MemberDetailView: View {
    let member: MemberModel
    let group: GroupModel
    @EnvironmentObject private var appState: AppState

    private var progressFraction: Double { min(member.groupSteps / appState.totalSteps, 1.0) }
    private var progressPct: Double { progressFraction * 100 }

    private var myGroupSteps: Double {
        group.members.first(where: \.isCurrentUser)?.groupSteps ?? 0
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .center, spacing: 5) {

                // ── Name ────────────────────────────────────────────────────
                let nameLabel = member.displayName + (member.isCurrentUser ? " (you)" : "")
                Text(nameLabel)
                    .font(.headline)
                    .lineLimit(2)
                    .multilineTextAlignment(.center)

                // ── Progress bar + XX.XX% ────────────────────────────────────
                HStack(spacing: 4) {
                    ProgressView(value: progressFraction)
                        .tint(.green)
                    Text(String(format: "%.2f%%", progressPct))
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .monospacedDigit()
                        .fixedSize()
                }
                .padding(.horizontal, 4)

                // ── +X.XX% last week ─────────────────────────────────────────
                let weekPct = member.lastWeekSteps / appState.totalSteps * 100
                let weekSign = weekPct >= 0 ? "+" : ""
                Text(String(format: "%@%.2f%% last week", weekSign, weekPct))
                    .font(.caption2)
                    .foregroundStyle(.green)

                // ── Steps ahead / behind (hidden for current user) ───────────
                if !member.isCurrentUser {
                    let diff = member.groupSteps - myGroupSteps
                    let label = diff >= 0 ? "steps ahead" : "steps behind"
                    Text("\(formatSteps(Int(abs(diff)))) \(label)")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }

                Divider().padding(.vertical, 2)

                // ── Next checkpoint ──────────────────────────────────────────
                if let cp = member.nextCheckpoint {
                    VStack(spacing: 2) {
                        Text("Next checkpoint:")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                        Text(cp.name)
                            .font(.caption)
                        Text("in \(formatSteps(cp.stepsAway)) steps")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                } else {
                    Text("Journey complete! 🌋")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }

                // ── Member counter X/N ───────────────────────────────────────
                if group.members.count > 1 {
                    let idx = (group.members.firstIndex(where: { $0.id == member.id }) ?? 0) + 1
                    Text("\(idx) / \(group.members.count)")
                        .font(.caption2)
                        .foregroundStyle(Color(white: 0.35))
                        .padding(.top, 4)
                }
            }
            .padding(.horizontal, 4)
        }
    }

    private func formatSteps(_ n: Int) -> String {
        let f = NumberFormatter()
        f.numberStyle = .decimal
        return f.string(from: NSNumber(value: n)) ?? "\(n)"
    }
}
