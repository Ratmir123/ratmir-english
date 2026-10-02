import Foundation

struct Learner: Decodable { let name: String; let dailyMinutes: Int }
struct Skill: Decodable, Identifiable {
    let id: String
    let state: String
    let independentSuccesses: Int
    let transfer: Bool
    let retention: Bool
}
struct TrainingState: Decodable {
    let profile: Learner
    let sessions: [Conversation]
    let skills: [Skill]
    let xp: Int
    let completed: Int
    let audioUsage: AudioUsage?
}
struct AudioUsage: Decodable { let usedUsd: Double; let estimated: Bool; let budgetUsd: Double; let recordedMinutes: Double; let spokenCharacters: Int }
struct Lesson: Decodable {
    let title: String
    let goal: String
    let why: String
    let minutes: Int
    let context: String?
}
struct Turn: Decodable, Identifiable {
    let id: String
    let role: String
    let text: String
    let audioFile: String?
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
