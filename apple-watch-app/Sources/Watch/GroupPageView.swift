import SwiftUI

// One page in the group pager: group name, days on the road, top-4 member list.
// Tapping navigates to the member detail pager (matches Garmin SELECT → MemberDetailView).
struct GroupPageView: View {
    let group: GroupModel
    @EnvironmentObject private var appState: AppState

    var body: some View {
        NavigationLink(destination: MemberDetailContainerView(group: group)) {
            VStack(alignment: .center, spacing: 0) {
                Text(group.name)
                    .font(.headline)
                    .lineLimit(1)
                    .padding(.bottom, 2)

                Text("\(group.daysInGroup) days on the road")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .padding(.bottom, 8)

                if group.members.isEmpty {
                    Text("No members")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                } else {
                    VStack(spacing: 3) {
                        ForEach(group.members.prefix(4)) { member in
                            MemberSummaryRow(member: member, totalSteps: appState.totalSteps)
                        }
                    }
                }

                Spacer(minLength: 4)

                Text("Tap for details")
                    .font(.caption2)
                    .foregroundStyle(.blue)
                    .padding(.top, 4)
            }
            .padding(.horizontal, 6)
        }
        .buttonStyle(.plain)
    }
}

private struct MemberSummaryRow: View {
    let member: MemberModel
    let totalSteps: Double

    private var pct: Double {
        min(member.groupSteps / totalSteps * 100, 100)
    }

    var body: some View {
        HStack {
            Text(member.displayName)
                .font(.caption2)
                .lineLimit(1)
            Spacer()
            Text(String(format: "%.1f%%", pct))
                .font(.caption2)
                .foregroundStyle(.secondary)
                .monospacedDigit()
        }
    }
}
