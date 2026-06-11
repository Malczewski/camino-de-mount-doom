import Foundation

struct GroupDataResponse: Decodable {
    let groups: [GroupModel]
    let totalSteps: Double
}

struct GroupModel: Decodable, Identifiable {
    let id: String
    let name: String
    let daysInGroup: Int
    let members: [MemberModel]
}

struct MemberModel: Decodable, Identifiable {
    // Not in JSON — generated locally for stable ForEach identity
    let id: UUID
    let displayName: String
    let groupSteps: Double
    let lastWeekSteps: Double
    let isCurrentUser: Bool
    let nextCheckpoint: CheckpointModel?

    init(from decoder: Decoder) throws {
        id = UUID()
        let c = try decoder.container(keyedBy: CodingKeys.self)
        displayName = try c.decode(String.self, forKey: .displayName)
        groupSteps = try c.decode(Double.self, forKey: .groupSteps)
        lastWeekSteps = (try? c.decode(Double.self, forKey: .lastWeekSteps)) ?? 0
        isCurrentUser = try c.decode(Bool.self, forKey: .isCurrentUser)
        nextCheckpoint = try? c.decode(CheckpointModel.self, forKey: .nextCheckpoint)
    }

    private enum CodingKeys: String, CodingKey {
        case displayName, groupSteps, lastWeekSteps, isCurrentUser, nextCheckpoint
    }
}

struct CheckpointModel: Decodable {
    let name: String
    let stepsAway: Int
}

// MARK: - Sync payloads

struct StepEntry: Encodable {
    let date: String
    let steps: Int
}

struct StepSyncPayload: Encodable {
    let dates: [StepEntry]
    let api_key: String
}
