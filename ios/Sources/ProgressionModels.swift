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
    let evidenceCoverage: EvidenceCoverage?
    let tracks: [PracticeTrack]
    let achievements: [PracticeAchievement]
    let recentResults: [PracticeResult]
    let notice: String
    let recommendation: PracticeRecommendation?

    private enum CodingKeys: String, CodingKey {
        case version, xp, level, levelTitle, levelFloorXP, nextLevelXP, xpInLevel, xpToNextLevel, completedPractice, practiceDays
        case practiceDayTimezone, evidenceCoverage, tracks, achievements, recentResults, notice, recommendation
    }
}

extension ProgressionState {
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let decodedXP = try c.decode(Int.self, forKey: .xp)
        let decodedLevel = try c.decode(Int.self, forKey: .level)
        xp = max(0, decodedXP)
        level = max(1, decodedLevel)
        version = LenientNumber.int(c, .version) ?? 1
        levelTitle = ((try? c.decodeIfPresent(String.self, forKey: .levelTitle)) ?? nil) ?? ""
        levelFloorXP = LenientNumber.int(c, .levelFloorXP) ?? 0
        nextLevelXP = LenientNumber.int(c, .nextLevelXP) ?? 0
        xpInLevel = LenientNumber.int(c, .xpInLevel) ?? 0
        xpToNextLevel = LenientNumber.int(c, .xpToNextLevel) ?? 0
        completedPractice = max(0, LenientNumber.int(c, .completedPractice) ?? 0)
        practiceDays = max(0, LenientNumber.int(c, .practiceDays) ?? 0)
        practiceDayTimezone = (try? c.decodeIfPresent(String.self, forKey: .practiceDayTimezone)) ?? nil
        evidenceCoverage = (try? c.decodeIfPresent(EvidenceCoverage.self, forKey: .evidenceCoverage)) ?? nil
        tracks = ((try? c.decodeIfPresent(TolerantList<PracticeTrack>.self, forKey: .tracks)) ?? nil)?.values ?? []
        achievements = ((try? c.decodeIfPresent(TolerantList<PracticeAchievement>.self, forKey: .achievements)) ?? nil)?.values ?? []
        recentResults = ((try? c.decodeIfPresent(TolerantList<PracticeResult>.self, forKey: .recentResults)) ?? nil)?.values ?? []
        notice = ((try? c.decodeIfPresent(String.self, forKey: .notice)) ?? nil) ?? ""
        recommendation = (try? c.decodeIfPresent(PracticeRecommendation.self, forKey: .recommendation)) ?? nil
    }
}

struct PracticeRecommendation: Decodable {
    let familyId: String
    let title: String
    let track: String
    let activity: String
    let preferredMode: String
    let why: String
    /// v0.5: when set, the session starts from this personal drill.
    let drillId: String?
    /// drill | review | pattern | balance — chooses the Today card copy.
    let source: String?
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

/// A completion this device confirmed. It survives the return to Today so the
/// reward can be shown there (C-02); XP and rank are compared with the values before.
struct CompletionMoment: Identifiable, Equatable {
    var id: String { sessionId }
    let sessionId: String
    let deferred: Bool
    let unlockedBefore: [String]
    let xpBefore: Int
    let levelBefore: Int?
}

/// Counters never claim more than their target (L-28 "6/1").
enum ProgressCopy {
    static func capped(_ current: Int, _ target: Int) -> Int { min(max(0, current), max(0, target)) }
    static func fraction(_ current: Int, _ target: Int) -> String { "\(capped(current, target))/\(max(0, target))" }
    static func achievementStatus(_ achievement: PracticeAchievement) -> String {
        guard achievement.unlocked else { return fraction(achievement.current, achievement.target) }
        if let date = achievement.unlockedAt.flatMap(NativeDate.parse) { return "Открыто · " + RuFormat.day(date) }
        return "Открыто"
    }
    static func ratio(_ current: Int, _ target: Int) -> Double {
        guard target > 0 else { return 1 }
        return Double(capped(current, target)) / Double(target)
    }
}
