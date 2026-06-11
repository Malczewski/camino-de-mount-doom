import SwiftUI

// Wraps member details in a horizontal pager — matches Garmin UP/DOWN cycling.
// The current user's card is shown first; swipe to move between members.
struct MemberDetailContainerView: View {
    let group: GroupModel

    // Start on the current user, fall back to 0
    private var initialIndex: Int {
        group.members.firstIndex(where: \.isCurrentUser) ?? 0
    }

    @State private var selectedIndex: Int

    init(group: GroupModel) {
        self.group = group
        _selectedIndex = State(initialValue: group.members.firstIndex(where: \.isCurrentUser) ?? 0)
    }

    var body: some View {
        TabView(selection: $selectedIndex) {
            ForEach(Array(group.members.enumerated()), id: \.element.id) { index, member in
                MemberDetailView(member: member, group: group)
                    .tag(index)
            }
        }
        .tabViewStyle(.page)
        .navigationTitle(group.name)
        .navigationBarTitleDisplayMode(.inline)
    }
}
