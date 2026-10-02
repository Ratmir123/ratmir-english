import Foundation

struct Learner: Decodable { let name: String; let dailyMinutes: Int }
struct Skill: Decodable, Identifiable {
    let id: String
    let state: String
    let independentSuccesses: Int
    let transfer: Bool
    let retention: Bool
    let examples: [SkillExample]?
    let lastChecked: String?
}
struct SkillExample: Decodable { let sessionId: String; let quote: String; let reason: String }
struct TrainingState: Decodable {
    let profile: Learner
    let sessions: [Conversation]
    let skills: [Skill]
    let xp: Int
    let completed: Int
    let audioUsage: AudioUsage?
    let onboarding: OnboardingState?
    let progression: ProgressionState?
}
struct OnboardingState: Decodable {
    let version: Int
    let status: String
    let introCompletedAt: String?
    let russianPrompt: String
    let russianControl: String?
    let completedStages: Int
    let steps: [BaselineStep]
    let report: BaselineReport?
}
struct BaselineStep: Decodable, Identifiable {
    let id: String
    let familyId: String
    let title: String
    let focus: String
    let minutes: Int
    let status: String
    let sessionId: String?
    let missingEvidence: String?
}
struct BaselineReport: Decodable {
    struct CEFR: Decodable { let from: String; let to: String; let confidence: String; let scope: String; let reason: String }
    struct Observation: Decodable, Identifiable {
        var id: String { skill }
        let skill: String
        let observation: String
        let confidence: String
        let evidence: [Quote]
    }
    struct Quote: Decodable { let sessionId: String; let turnId: String; let quote: String; let result: String }
    struct Communication: Decodable { let observation: String; let russianQuote: String; let limitation: String }
    let version: Int
    let model: String
    let createdAt: String
    let provisional: Bool
    let summary: String
    let cefr: CEFR?
    let skills: [Observation]
    let languageVsCommunication: Communication
    let priorities: [String]
    let limitations: [String]
    let nextFocus: String
}
struct AudioUsage: Decodable { let usedUsd: Double; let estimated: Bool; let budgetUsd: Double; let recordedMinutes: Double; let spokenCharacters: Int }
struct Lesson: Decodable {
    struct Material: Decodable { let type: String; let text: String; let instruction: String; let source: String }
    let title: String
    let goal: String
    let why: String
    let minutes: Int
    let context: String?
    let track: String?
    let activity: String?
    let material: Material?
}
struct Turn: Decodable, Identifiable {
    let id: String
    let role: String
    let text: String
    let audioFile: String?
    let source: String?
    let support: Int?
    let transcriptEdited: Bool?
    let disputed: Bool?
}
struct Priority: Decodable, Identifiable {
    var id: String { turnId + title }
    let title: String
    let turnId: String
    let quote: String
    let explanation: String
    let example: String
    let retryInstruction: String
}
struct Review: Decodable {
    let version: Int?
    let summary: String
    let strengths: [String]
    let priorities: [Priority]
    let limitations: [String]
}
struct Retry: Decodable { let text: String; let feedback: String; let improved: Bool?; let analysisVersion: Int? }
struct Conversation: Decodable, Identifiable {
    struct Baseline: Decodable { let version: Int; let stepId: String }
    let id: String
    let lesson: Lesson
    let mode: String
    let status: String
    let turns: [Turn]
    let analysis: Review?
    let retries: [Retry]
    let error: String?
    let createdAt: String?
    let updatedAt: String?
    let processing: Processing?
    let completion: Completion?
    let retryDeferred: Bool?
    let baseline: Baseline?
}
struct Processing: Decodable { let stage: String; let startedAt: String; let attempt: Int?; let nextAttemptAt: String? }
struct Completion: Decodable { let canComplete: Bool; let needsRetry: Bool; let reason: String? }
struct SubscriptionUsage: Decodable {
    struct Window: Decodable, Identifiable {
        let id: String
        let bucketName: String?
        let kind: String
        let usedPercent: Double?
        let remainingPercent: Double?
        let windowDurationMins: Int?
        let resetsAt: String?
    }
    struct Activity: Decodable {
        let periodDays: Int
        let requests: Int
        let successful: Int
        let failed: Int
        let lastRequestAt: String?
        let lastLimitAt: String?
        let retryAt: String?
        let averageLatencyMs: Double?
    }
    let available: Bool
    let source: String
    let scope: String
    let checkedAt: String?
    let stale: Bool
    let windows: [Window]
    let plan: String?
    let error: String?
    let manageUrl: String?
    let activity: Activity?
}
struct Transcription: Decodable { let text: String; let audioFile: String }
struct Speech: Decodable { let file: String }
struct Hint: Decodable { let text: String }
struct Confirmation: Decodable { let ok: Bool }
struct ServerStatus: Decodable {
    struct Brain: Decodable { let model: String; let verified: Bool; let error: String? }
    struct Audio: Decodable { let configured: Bool }
    let brain: Brain
    let audio: Audio
}
