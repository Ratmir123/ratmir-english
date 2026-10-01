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
}
struct Lesson: Decodable {
    let title: String
    let goal: String
    let why: String
    let minutes: Int
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
    let summary: String
    let strengths: [String]
    let priorities: [Priority]
    let limitations: [String]
}
struct Retry: Decodable { let text: String; let feedback: String; let improved: Bool? }
struct Conversation: Decodable, Identifiable {
    let id: String
    let lesson: Lesson
    let mode: String
    let status: String
    let turns: [Turn]
    let analysis: Review?
    let retries: [Retry]
    let error: String?
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
