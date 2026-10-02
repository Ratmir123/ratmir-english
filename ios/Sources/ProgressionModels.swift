import Foundation

/// Activity counters are server observations, never a language proficiency score.
struct ProgressionState: Decodable {
    let version: Int
    let xp: Int
    let level: Int
    let levelTitle: String
    let levelFloorXP: Int
    let nextLevelXP: Int
    let xpInLevel: Int
    let xpToNextLevel: Int
    let completedPractice: Int
    let practiceDays: Int
    let practiceDayTimezone: String?
    let evidenceCoverage: EvidenceCoverage
    let tracks: [PracticeTrack]
    let achievements: [PracticeAchievement]
    let recentResults: [PracticeResult]
    let notice: String
    let recommendation: PracticeRecommendation?
}
struct PracticeRecommendation: Decodable {
    let familyId: String
    let title: String
    let track: String
    let activity: String
    let preferredMode: String
    let why: String
}
struct EvidenceCoverage: Decodable {
    let observedSkills: Int
    let observableSkills: Int
    let independentSuccesses: Int
    let supportedObservations: Int
    let partial: Int
    let difficulty: Int
}
struct PracticeTrack: Decodable, Identifiable {
    let id: String
    let title: String
    let description: String
    let completedSessions: Int
    let targetSessions: Int
    let activities: [PracticeActivity]
}
struct PracticeActivity: Decodable, Identifiable {
    let id: String
    let title: String
    let completedSessions: Int
    let targetSessions: Int
}
struct PracticeAchievement: Decodable, Identifiable {
    let id: String
    let title: String
    let description: String
    let current: Int
    let target: Int
    let unlocked: Bool
    let unlockedAt: String?
}
struct PracticeResult: Decodable, Identifiable {
    var id: String { sessionId }
    let sessionId: String
    let xp: Int
    let completedAt: String
    let track: String
    let activity: String
    let improvedRetry: Bool
    let quality: Quality
    let evidence: [Evidence]
    struct Quality: Decodable {
        let observedTargets: Int
        let targetCount: Int
        let independentSuccesses: Int
        let supportedObservations: Int
        let partial: Int
        let difficulty: Int
    }
    struct Evidence: Decodable {
        let skill: String
        let result: String
        let supported: Bool
        let turnId: String
        let quote: String
    }
}
struct CompletionMoment: Identifiable {
    var id: String { sessionId }
    let sessionId: String
    let deferred: Bool
    let baseline: Bool
    let unlockedBefore: [String]
}
