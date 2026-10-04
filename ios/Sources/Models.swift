import Foundation

// MARK: - Lenient decoding helpers

/// Decodes every element it can and counts the rest, so one record in a newer or
/// broken format never hides the others (or the whole state).
struct TolerantList<Element: Decodable>: Decodable {
    let values: [Element]
    let skipped: Int

    init(values: [Element] = [], skipped: Int = 0) {
        self.values = values
        self.skipped = skipped
    }

    init(from decoder: Decoder) throws {
        var container = try decoder.unkeyedContainer()
        var decoded: [Element] = []
        var failures = 0
        while !container.isAtEnd {
            let before = container.currentIndex
            if let value = try? container.decode(Element.self) {
                decoded.append(value)
                continue
            }
            failures += 1
            _ = try? container.decode(SkippedElement.self)
            // Never spin on an element the decoder refuses to step over.
            if container.currentIndex == before { break }
        }
        values = decoded
        skipped = failures
    }
}

/// Accepts any JSON value and keeps nothing; it only advances an unkeyed container.
private struct SkippedElement: Decodable {
    init(from decoder: Decoder) throws {}
}

/// JSON numbers may arrive as integers or decimals (the profile accepts 12.5 minutes).
/// Values are clamped before conversion so a huge number can never trap.
enum LenientNumber {
    static func int<K: CodingKey>(_ container: KeyedDecodingContainer<K>, _ key: K) -> Int? {
        if let value = try? container.decodeIfPresent(Int.self, forKey: key) { return value }
        guard let value = try? container.decodeIfPresent(Double.self, forKey: key), value.isFinite else { return nil }
        return Int(min(max(value, -1_000_000_000), 1_000_000_000).rounded())
    }
    static func double<K: CodingKey>(_ container: KeyedDecodingContainer<K>, _ key: K) -> Double? {
        guard let value = try? container.decodeIfPresent(Double.self, forKey: key), value.isFinite else { return nil }
        return value
    }
}

// MARK: - Profile and state

/// The learner profile as the server stores it. Every field is optional on the wire.
struct Learner: Decodable {
    let name: String
    let dailyMinutes: Int
    let goals: String
    let interests: [String]
    let professionalContext: String
    let relocation: String
    let feedback: String
    let audioRetentionDays: Int
    let budgetUsd: Double

    init(name: String, dailyMinutes: Int, goals: String = "", interests: [String] = [], professionalContext: String = "",
         relocation: String = "", feedback: String = "", audioRetentionDays: Int = 30, budgetUsd: Double = 35) {
        self.name = name
        self.dailyMinutes = dailyMinutes
        self.goals = goals
        self.interests = interests
        self.professionalContext = professionalContext
        self.relocation = relocation
        self.feedback = feedback
        self.audioRetentionDays = audioRetentionDays
        self.budgetUsd = budgetUsd
    }

    private enum CodingKeys: String, CodingKey {
        case name, dailyMinutes, goals, interests, professionalContext, relocation, feedback, audioRetentionDays, budgetUsd
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let decodedName = (try? c.decodeIfPresent(String.self, forKey: .name)) ?? nil
        name = decodedName.flatMap { $0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : $0 } ?? "ты"
        dailyMinutes = min(60, max(5, LenientNumber.int(c, .dailyMinutes) ?? 15))
        goals = ((try? c.decodeIfPresent(String.self, forKey: .goals)) ?? nil) ?? ""
        interests = ((try? c.decodeIfPresent(TolerantList<String>.self, forKey: .interests)) ?? nil)?.values ?? []
        professionalContext = ((try? c.decodeIfPresent(String.self, forKey: .professionalContext)) ?? nil) ?? ""
        relocation = ((try? c.decodeIfPresent(String.self, forKey: .relocation)) ?? nil) ?? ""
        feedback = ((try? c.decodeIfPresent(String.self, forKey: .feedback)) ?? nil) ?? ""
        audioRetentionDays = LenientNumber.int(c, .audioRetentionDays) ?? 30
        budgetUsd = LenientNumber.double(c, .budgetUsd) ?? 35
    }
}

/// Display identity of the backend (`AppState.app`).
struct AppInfo: Decodable {
    let name: String
    let version: String

    private enum CodingKeys: String, CodingKey { case name, version }

    init(name: String, version: String) {
        self.name = name
        self.version = version
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        name = ((try? c.decodeIfPresent(String.self, forKey: .name)) ?? nil) ?? "Smooth Talk"
        version = ((try? c.decodeIfPresent(String.self, forKey: .version)) ?? nil) ?? ""
    }
}

struct Skill: Decodable, Identifiable {
    let id: String
    let state: String
    let independentSuccesses: Int
    let transfer: Bool
    let retention: Bool
    let examples: [SkillExample]?
    let lastChecked: String?

    private enum CodingKeys: String, CodingKey { case id, state, independentSuccesses, transfer, retention, examples, lastChecked }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        state = ((try? c.decodeIfPresent(String.self, forKey: .state)) ?? nil) ?? "unknown"
        independentSuccesses = max(0, LenientNumber.int(c, .independentSuccesses) ?? 0)
        transfer = ((try? c.decodeIfPresent(Bool.self, forKey: .transfer)) ?? nil) ?? false
        retention = ((try? c.decodeIfPresent(Bool.self, forKey: .retention)) ?? nil) ?? false
        examples = ((try? c.decodeIfPresent(TolerantList<SkillExample>.self, forKey: .examples)) ?? nil)?.values
        lastChecked = (try? c.decodeIfPresent(String.self, forKey: .lastChecked)) ?? nil
    }
}
struct SkillExample: Decodable { let sessionId: String; let quote: String; let reason: String }

/// `GET /api/state`. Core fields are required; every v0.5 feature field is decoded on
/// its own so a feature in a newer format can never break login or the Today screen.
struct TrainingState: Decodable {
    let profile: Learner
    let sessions: [Conversation]
    /// Sessions the client could not read (newer format). Shown as a footnote in History.
    let skippedSessions: Int
    let skills: [Skill]
    let xp: Int
    let completed: Int
    let audioUsage: AudioUsage?
    let progression: ProgressionState?
    let app: AppInfo?
    // v0.5 features (I3 models). Absent, null or unreadable → nil.
    let placement: PlacementView?
    let calls: [CallSummary]?
    let patterns: [CommunicationPattern]?
    let drills: [PersonalDrill]?
    let profileFacts: [ProfileFact]?
    // The shell's own small views of the same JSON, used for the Today decision order.
    let placementSignal: TodayPlacementSignal?
    let callSignals: [TodayCallSignal]
    let drillSignals: [TodayDrillSignal]
    let patternSignals: [TodayPatternSignal]

    private enum CodingKeys: String, CodingKey {
        case profile, sessions, skills, xp, completed, audioUsage, progression, app
        case placement, calls, patterns, drills, profileFacts
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        profile = try c.decode(Learner.self, forKey: .profile)
        let sessionList = (try? c.decodeIfPresent(TolerantList<Conversation>.self, forKey: .sessions)) ?? nil
        sessions = sessionList?.values ?? []
        skippedSessions = sessionList?.skipped ?? 0
        skills = ((try? c.decodeIfPresent(TolerantList<Skill>.self, forKey: .skills)) ?? nil)?.values ?? []
        xp = max(0, LenientNumber.int(c, .xp) ?? 0)
        completed = max(0, LenientNumber.int(c, .completed) ?? 0)
        audioUsage = (try? c.decodeIfPresent(AudioUsage.self, forKey: .audioUsage)) ?? nil
        progression = (try? c.decodeIfPresent(ProgressionState.self, forKey: .progression)) ?? nil
        app = (try? c.decodeIfPresent(AppInfo.self, forKey: .app)) ?? nil
        placement = (try? c.decodeIfPresent(PlacementView.self, forKey: .placement)) ?? nil
        calls = ((try? c.decodeIfPresent(TolerantList<CallSummary>.self, forKey: .calls)) ?? nil)?.values
        patterns = ((try? c.decodeIfPresent(TolerantList<CommunicationPattern>.self, forKey: .patterns)) ?? nil)?.values
        drills = ((try? c.decodeIfPresent(TolerantList<PersonalDrill>.self, forKey: .drills)) ?? nil)?.values
        profileFacts = ((try? c.decodeIfPresent(TolerantList<ProfileFact>.self, forKey: .profileFacts)) ?? nil)?.values
        placementSignal = (try? c.decodeIfPresent(TodayPlacementSignal.self, forKey: .placement)) ?? nil
        callSignals = ((try? c.decodeIfPresent(TolerantList<TodayCallSignal>.self, forKey: .calls)) ?? nil)?.values ?? []
        drillSignals = ((try? c.decodeIfPresent(TolerantList<TodayDrillSignal>.self, forKey: .drills)) ?? nil)?.values ?? []
        patternSignals = ((try? c.decodeIfPresent(TolerantList<TodayPatternSignal>.self, forKey: .patterns)) ?? nil)?.values ?? []
    }

    func session(_ id: String) -> Conversation? { sessions.first { $0.id == id } }
}

struct AudioUsage: Decodable { let usedUsd: Double; let estimated: Bool; let budgetUsd: Double; let recordedMinutes: Double; let spokenCharacters: Int }

// MARK: - Shell signals (the Today decision order reads only these)

/// Placement status as Today needs it. `status` is required, so an unreadable
/// placement simply produces no signal instead of a wrong card.
struct TodayPlacementSignal: Decodable {
    let status: String
    let hasResult: Bool
    let overallLabel: String?
    let completedSections: Int
    let totalSections: Int
    let remainingMinutes: Int?
    let error: String?
    let audioAvailable: Bool

    init(status: String, hasResult: Bool, overallLabel: String? = nil, completedSections: Int = 0, totalSections: Int = 5,
         remainingMinutes: Int? = nil, error: String? = nil, audioAvailable: Bool = true) {
        self.status = status
        self.hasResult = hasResult
        self.overallLabel = overallLabel
        self.completedSections = completedSections
        self.totalSections = totalSections
        self.remainingMinutes = remainingMinutes
        self.error = error
        self.audioAvailable = audioAvailable
    }

    private enum CodingKeys: String, CodingKey { case status, result, sections, remainingMinutes, error, audioAvailable }
    /// Any result object counts as a result; its overall label is optional.
    private struct ResultHead: Decodable {
        private struct Overall: Decodable { let label: String? }
        private enum CodingKeys: String, CodingKey { case overall }
        let label: String?
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            label = ((try? c.decodeIfPresent(Overall.self, forKey: .overall)) ?? nil)?.label
        }
    }
    private struct SectionHead: Decodable { let status: String? }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        status = try c.decode(String.self, forKey: .status)
        let result = (try? c.decodeIfPresent(ResultHead.self, forKey: .result)) ?? nil
        hasResult = result != nil
        overallLabel = result?.label
        let sections = ((try? c.decodeIfPresent(TolerantList<SectionHead>.self, forKey: .sections)) ?? nil)?.values ?? []
        completedSections = sections.filter { $0.status == "completed" || $0.status == "skipped" }.count
        totalSections = sections.count
        remainingMinutes = LenientNumber.int(c, .remainingMinutes)
        error = (try? c.decodeIfPresent(String.self, forKey: .error)) ?? nil
        audioAvailable = ((try? c.decodeIfPresent(Bool.self, forKey: .audioAvailable)) ?? nil) ?? true
    }

    /// The test still needs the learner (not scoring, no result yet).
    var needsLearner: Bool { !hasResult && status != "scoring" }
    var started: Bool { status == "in-progress" || status == "error" || completedSections > 0 }
}

struct TodayCallSignal: Decodable, Identifiable {
    let id: String
    let title: String
    let status: String
    let counterpart: String?
    let progressPercent: Double?
    let progressStage: String?

    init(id: String, title: String, status: String, counterpart: String? = nil, progressPercent: Double? = nil, progressStage: String? = nil) {
        self.id = id
        self.title = title
        self.status = status
        self.counterpart = counterpart
        self.progressPercent = progressPercent
        self.progressStage = progressStage
    }

    private enum CodingKeys: String, CodingKey { case id, title, status, counterpart, progress }
    private struct Progress: Decodable { let stage: String?; let percent: Double? }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        status = try c.decode(String.self, forKey: .status)
        title = ((try? c.decodeIfPresent(String.self, forKey: .title)) ?? nil) ?? "Созвон"
        counterpart = (try? c.decodeIfPresent(String.self, forKey: .counterpart)) ?? nil
        let progress = (try? c.decodeIfPresent(Progress.self, forKey: .progress)) ?? nil
        progressPercent = progress?.percent.flatMap { $0.isFinite ? min(100, max(0, $0)) : nil }
        progressStage = progress?.stage
    }

    var isProcessing: Bool { ["awaiting-upload", "queued", "processing", "analysing"].contains(status) }
}

struct TodayDrillSignal: Decodable, Identifiable {
    let id: String
    let title: String
    let why: String
    let status: String
    let tier: Int
    let context: String
    let sessionId: String?
    let sourceCallId: String?

    init(id: String, title: String, why: String = "", status: String = "new", tier: Int = 1, context: String = "work",
         sessionId: String? = nil, sourceCallId: String? = nil) {
        self.id = id
        self.title = title
        self.why = why
        self.status = status
        self.tier = tier
        self.context = context
        self.sessionId = sessionId
        self.sourceCallId = sourceCallId
    }

    private enum CodingKeys: String, CodingKey { case id, title, why, status, tier, context, sessionId, source }
    private struct Source: Decodable { let type: String?; let callId: String? }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        title = try c.decode(String.self, forKey: .title)
        why = ((try? c.decodeIfPresent(String.self, forKey: .why)) ?? nil) ?? ""
        status = ((try? c.decodeIfPresent(String.self, forKey: .status)) ?? nil) ?? "new"
        tier = min(3, max(1, LenientNumber.int(c, .tier) ?? 1))
        context = ((try? c.decodeIfPresent(String.self, forKey: .context)) ?? nil) ?? "work"
        sessionId = (try? c.decodeIfPresent(String.self, forKey: .sessionId)) ?? nil
        let source = (try? c.decodeIfPresent(Source.self, forKey: .source)) ?? nil
        sourceCallId = source?.type == "call" ? source?.callId : nil
    }

    /// Pressure tier 1 is supported practice; tiers 2–3 run like a real call.
    var preferredMode: String { tier >= 2 ? "call" : "learning" }
}

struct TodayPatternSignal: Decodable, Identifiable {
    let id: String
    let title: String
    let kind: String
    let status: String
    let costRank: Int
    let dismissed: Bool
    /// Per-source outcomes, oldest first: repeated | avoided | no-opportunity | improved | new.
    let history: [String]

    init(id: String, title: String, kind: String = "weakness", status: String = "active", costRank: Int = 3,
         dismissed: Bool = false, history: [String] = []) {
        self.id = id
        self.title = title
        self.kind = kind
        self.status = status
        self.costRank = costRank
        self.dismissed = dismissed
        self.history = history
    }

    private enum CodingKeys: String, CodingKey { case id, title, kind, status, costRank, dismissed, history }
    private struct Entry: Decodable { let status: String? }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        title = try c.decode(String.self, forKey: .title)
        kind = ((try? c.decodeIfPresent(String.self, forKey: .kind)) ?? nil) ?? "weakness"
        status = ((try? c.decodeIfPresent(String.self, forKey: .status)) ?? nil) ?? "watch"
        costRank = min(5, max(1, LenientNumber.int(c, .costRank) ?? 3))
        dismissed = ((try? c.decodeIfPresent(Bool.self, forKey: .dismissed)) ?? nil) ?? false
        let entries = ((try? c.decodeIfPresent(TolerantList<Entry>.self, forKey: .history)) ?? nil)?.values ?? []
        history = entries.compactMap { $0.status }
    }

    var statusTitle: String {
        switch status {
        case "active": return "Активен"
        case "improving": return "Улучшается"
        case "resolved": return "Побеждён"
        default: return "Под наблюдением"
        }
    }
}

// MARK: - Lesson, turns and reviews

struct Lesson: Decodable {
    struct Material: Decodable { let type: String; let text: String; let instruction: String; let source: String? }
    let title: String
    let goal: String
    let why: String
    let minutes: Int
    let context: String?
    let track: String?
    let activity: String?
    let kind: String?
    let familyId: String?
    /// conversation | pitch | rapidfire | replay | cards | writing | reading | listening (v0.5).
    let format: String?
    let drillId: String?
    let targetSkills: [String]
    let material: Material?
    /// Exact counterpart line from a real call that opens a replay.
    let seed: String?
    let persona: String?
    let speechLevel: String?
    let pressureTier: Int?
    let situationalNorms: [String]
    let patternIds: [String]
    let moves: [String]
    let mustInclude: [String]
    let mustAvoid: [String]

    private enum CodingKeys: String, CodingKey {
        case title, goal, why, minutes, context, track, activity, kind, familyId, format, drillId, targetSkills, material
        case seed, persona, speechLevel, pressureTier, situationalNorms, patternIds, moves, mustInclude, mustAvoid
    }
}

extension Lesson {
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        title = try c.decode(String.self, forKey: .title)
        goal = ((try? c.decodeIfPresent(String.self, forKey: .goal)) ?? nil) ?? ""
        why = ((try? c.decodeIfPresent(String.self, forKey: .why)) ?? nil) ?? ""
        minutes = LenientNumber.int(c, .minutes) ?? 10
        context = (try? c.decodeIfPresent(String.self, forKey: .context)) ?? nil
        track = (try? c.decodeIfPresent(String.self, forKey: .track)) ?? nil
        activity = (try? c.decodeIfPresent(String.self, forKey: .activity)) ?? nil
        kind = (try? c.decodeIfPresent(String.self, forKey: .kind)) ?? nil
        familyId = (try? c.decodeIfPresent(String.self, forKey: .familyId)) ?? nil
        format = (try? c.decodeIfPresent(String.self, forKey: .format)) ?? nil
        drillId = (try? c.decodeIfPresent(String.self, forKey: .drillId)) ?? nil
        targetSkills = ((try? c.decodeIfPresent(TolerantList<String>.self, forKey: .targetSkills)) ?? nil)?.values ?? []
        material = (try? c.decodeIfPresent(Material.self, forKey: .material)) ?? nil
        seed = (try? c.decodeIfPresent(String.self, forKey: .seed)) ?? nil
        persona = (try? c.decodeIfPresent(String.self, forKey: .persona)) ?? nil
        speechLevel = (try? c.decodeIfPresent(String.self, forKey: .speechLevel)) ?? nil
        pressureTier = LenientNumber.int(c, .pressureTier)
        situationalNorms = Lesson.strings(c, .situationalNorms)
        patternIds = Lesson.strings(c, .patternIds)
        moves = Lesson.strings(c, .moves)
        mustInclude = Lesson.strings(c, .mustInclude)
        mustAvoid = Lesson.strings(c, .mustAvoid)
    }

    private static func strings(_ c: KeyedDecodingContainer<CodingKeys>, _ key: CodingKeys) -> [String] {
        let values = ((try? c.decodeIfPresent(TolerantList<String>.self, forKey: key)) ?? nil)?.values ?? []
        return values.filter { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
    }
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
    let speechTiming: SpeechTiming?

    private enum CodingKeys: String, CodingKey { case id, role, text, audioFile, source, support, transcriptEdited, disputed, speechTiming }
}

extension Turn {
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        role = try c.decode(String.self, forKey: .role)
        text = try c.decode(String.self, forKey: .text)
        audioFile = (try? c.decodeIfPresent(String.self, forKey: .audioFile)) ?? nil
        source = (try? c.decodeIfPresent(String.self, forKey: .source)) ?? nil
        support = LenientNumber.int(c, .support)
        transcriptEdited = (try? c.decodeIfPresent(Bool.self, forKey: .transcriptEdited)) ?? nil
        disputed = (try? c.decodeIfPresent(Bool.self, forKey: .disputed)) ?? nil
        speechTiming = (try? c.decodeIfPresent(SpeechTiming.self, forKey: .speechTiming)) ?? nil
    }
}

struct Priority: Decodable {
    let title: String
    let turnId: String
    let quote: String
    let explanation: String
    let example: String
    let retryInstruction: String
    /// language | dialogue (v0.4), plus v0.5 cost kinds.
    let type: String?
    let costKind: String?
    let patternId: String?

    private enum CodingKeys: String, CodingKey { case title, turnId, quote, explanation, example, retryInstruction, type, costKind, patternId }
}

extension Priority {
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        title = try c.decode(String.self, forKey: .title)
        turnId = ((try? c.decodeIfPresent(String.self, forKey: .turnId)) ?? nil) ?? ""
        quote = ((try? c.decodeIfPresent(String.self, forKey: .quote)) ?? nil) ?? ""
        explanation = ((try? c.decodeIfPresent(String.self, forKey: .explanation)) ?? nil) ?? ""
        example = ((try? c.decodeIfPresent(String.self, forKey: .example)) ?? nil) ?? ""
        retryInstruction = ((try? c.decodeIfPresent(String.self, forKey: .retryInstruction)) ?? nil) ?? ""
        type = (try? c.decodeIfPresent(String.self, forKey: .type)) ?? nil
        costKind = (try? c.decodeIfPresent(String.self, forKey: .costKind)) ?? nil
        patternId = (try? c.decodeIfPresent(String.self, forKey: .patternId)) ?? nil
    }
}

struct Review: Decodable {
    /// Errors that change meaning or sound junior (v0.5 analysis).
    struct LanguageError: Decodable {
        let turnId: String?
        let quote: String
        let correction: String
        let tag: String?
        let impact: String?
        let why: String?
    }
    /// How a known communication pattern went in this session.
    struct PatternHit: Decodable {
        let patternId: String
        let outcome: String
        let turnId: String?
        let quote: String?
        let title: String?
        private enum CodingKeys: String, CodingKey { case patternId, outcome, status, turnId, quote, title }
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            patternId = try c.decode(String.self, forKey: .patternId)
            let outcomeValue = (try? c.decodeIfPresent(String.self, forKey: .outcome)) ?? nil
            let statusValue = (try? c.decodeIfPresent(String.self, forKey: .status)) ?? nil
            outcome = outcomeValue ?? statusValue ?? "no-opportunity"
            turnId = (try? c.decodeIfPresent(String.self, forKey: .turnId)) ?? nil
            quote = (try? c.decodeIfPresent(String.self, forKey: .quote)) ?? nil
            title = (try? c.decodeIfPresent(String.self, forKey: .title)) ?? nil
        }
    }
    /// One of the eight strategy moves (lib/strategy-moves.ts), 0–2 or nil without an opportunity.
    struct StrategyMove: Decodable {
        let id: String
        let score: Int?
        let quote: String?
        private enum CodingKeys: String, CodingKey { case id, score, quote }
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            id = try c.decode(String.self, forKey: .id)
            score = LenientNumber.int(c, .score)
            quote = (try? c.decodeIfPresent(String.self, forKey: .quote)) ?? nil
        }
        var title: String {
            switch id {
            case "answer-first": return "Ответ первым"
            case "positioning": return "Самоподача"
            case "proof": return "Факты вместо ярлыков"
            case "discovery": return "Вопросы по делу"
            case "anchor-hold": return "Якорь и цена"
            case "confidential": return "Чужие условия"
            case "recap": return "Резюме условий"
            case "close": return "Следующий шаг"
            default: return id
            }
        }
    }
    /// A judgement call with both sides (v0.5 analysis).
    struct Debatable: Decodable {
        let title: String
        let turnId: String?
        let quote: String?
        let forSide: String
        let againstSide: String
        let verdict: String
        private enum CodingKeys: String, CodingKey { case title, turnId, quote, forSide, againstSide, verdict }
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            title = try c.decode(String.self, forKey: .title)
            turnId = (try? c.decodeIfPresent(String.self, forKey: .turnId)) ?? nil
            quote = (try? c.decodeIfPresent(String.self, forKey: .quote)) ?? nil
            forSide = ((try? c.decodeIfPresent(String.self, forKey: .forSide)) ?? nil) ?? ""
            againstSide = ((try? c.decodeIfPresent(String.self, forKey: .againstSide)) ?? nil) ?? ""
            verdict = ((try? c.decodeIfPresent(String.self, forKey: .verdict)) ?? nil) ?? ""
        }
    }
    /// Whether the scene's goal was reached: yes | partly | no | n/a.
    struct Outcome: Decodable {
        let achieved: String
        let what: String
        init(achieved: String, what: String) {
            self.achieved = achieved
            self.what = what
        }
        private enum CodingKeys: String, CodingKey { case achieved, what }
        init(from decoder: Decoder) throws {
            if let text = try? decoder.singleValueContainer().decode(String.self) {
                achieved = "n/a"
                what = text
                return
            }
            let c = try decoder.container(keyedBy: CodingKeys.self)
            achieved = ((try? c.decodeIfPresent(String.self, forKey: .achieved)) ?? nil) ?? "n/a"
            what = ((try? c.decodeIfPresent(String.self, forKey: .what)) ?? nil) ?? ""
        }
    }

    let version: Int?
    let createdAt: String?
    let summary: String
    let strengths: [String]
    let priorities: [Priority]
    let limitations: [String]
    let nextFocus: String?
    let timingFeedback: [TimingFeedback]?
    let languageErrors: [LanguageError]?
    let patternHits: [PatternHit]?
    let strategyMoves: [StrategyMove]?
    let outcome: Outcome?
    let minorErrorsIgnored: Int?
    let debatable: [Debatable]?
    let dropped: Int?

    private enum CodingKeys: String, CodingKey {
        case version, createdAt, summary, strengths, priorities, limitations, nextFocus, timingFeedback
        case languageErrors, patternHits, strategyMoves, outcome, minorErrorsIgnored, debatable, dropped
    }
}

extension Review {
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        summary = try c.decode(String.self, forKey: .summary)
        version = LenientNumber.int(c, .version)
        createdAt = (try? c.decodeIfPresent(String.self, forKey: .createdAt)) ?? nil
        strengths = ((try? c.decodeIfPresent(TolerantList<String>.self, forKey: .strengths)) ?? nil)?.values ?? []
        priorities = ((try? c.decodeIfPresent(TolerantList<Priority>.self, forKey: .priorities)) ?? nil)?.values ?? []
        limitations = ((try? c.decodeIfPresent(TolerantList<String>.self, forKey: .limitations)) ?? nil)?.values ?? []
        nextFocus = (try? c.decodeIfPresent(String.self, forKey: .nextFocus)) ?? nil
        timingFeedback = ((try? c.decodeIfPresent(TolerantList<TimingFeedback>.self, forKey: .timingFeedback)) ?? nil)?.values
        languageErrors = ((try? c.decodeIfPresent(TolerantList<LanguageError>.self, forKey: .languageErrors)) ?? nil)?.values
        patternHits = ((try? c.decodeIfPresent(TolerantList<PatternHit>.self, forKey: .patternHits)) ?? nil)?.values
        strategyMoves = ((try? c.decodeIfPresent(TolerantList<StrategyMove>.self, forKey: .strategyMoves)) ?? nil)?.values
        outcome = (try? c.decodeIfPresent(Outcome.self, forKey: .outcome)) ?? nil
        minorErrorsIgnored = LenientNumber.int(c, .minorErrorsIgnored)
        debatable = ((try? c.decodeIfPresent(TolerantList<Debatable>.self, forKey: .debatable)) ?? nil)?.values
        dropped = LenientNumber.int(c, .dropped)
    }
}

struct Retry: Decodable {
    /// Optional round after an improved retry: the partner objects once (badge only).
    struct Pushback: Decodable {
        let npcLine: String
        let audioFile: String?
        let reply: String?
        let held: Bool?
        let feedback: String?
        let createdAt: String?
    }
    let id: String?
    let text: String
    let feedback: String
    let improved: Bool?
    let analysisVersion: Int?
    let audioFile: String?
    let transcriptEdited: Bool?
    let speechTiming: SpeechTiming?
    let createdAt: String?
    let pushback: Pushback?

    private enum CodingKeys: String, CodingKey {
        case id, text, feedback, improved, analysisVersion, audioFile, transcriptEdited, speechTiming, createdAt, pushback
    }
}

extension Retry {
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        text = try c.decode(String.self, forKey: .text)
        feedback = ((try? c.decodeIfPresent(String.self, forKey: .feedback)) ?? nil) ?? ""
        id = (try? c.decodeIfPresent(String.self, forKey: .id)) ?? nil
        improved = (try? c.decodeIfPresent(Bool.self, forKey: .improved)) ?? nil
        analysisVersion = LenientNumber.int(c, .analysisVersion)
        audioFile = (try? c.decodeIfPresent(String.self, forKey: .audioFile)) ?? nil
        transcriptEdited = (try? c.decodeIfPresent(Bool.self, forKey: .transcriptEdited)) ?? nil
        speechTiming = (try? c.decodeIfPresent(SpeechTiming.self, forKey: .speechTiming)) ?? nil
        createdAt = (try? c.decodeIfPresent(String.self, forKey: .createdAt)) ?? nil
        pushback = (try? c.decodeIfPresent(Pushback.self, forKey: .pushback)) ?? nil
    }

    /// An improved retry whose partner objection still waits for an answer.
    var pendingPushback: Pushback? {
        guard improved == true, id != nil, let pushback, pushback.held == nil else { return nil }
        return pushback
    }
}

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
    let completedAt: String?
    let processing: Processing?
    let completion: Completion?
    let retryDeferred: Bool?

    private enum CodingKeys: String, CodingKey {
        case id, lesson, mode, status, turns, analysis, retries, error, createdAt, updatedAt, completedAt, processing, completion, retryDeferred
    }
}

extension Conversation {
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        lesson = try c.decode(Lesson.self, forKey: .lesson)
        mode = ((try? c.decodeIfPresent(String.self, forKey: .mode)) ?? nil) ?? "learning"
        status = try c.decode(String.self, forKey: .status)
        turns = ((try? c.decodeIfPresent(TolerantList<Turn>.self, forKey: .turns)) ?? nil)?.values ?? []
        analysis = (try? c.decodeIfPresent(Review.self, forKey: .analysis)) ?? nil
        retries = ((try? c.decodeIfPresent(TolerantList<Retry>.self, forKey: .retries)) ?? nil)?.values ?? []
        error = (try? c.decodeIfPresent(String.self, forKey: .error)) ?? nil
        createdAt = (try? c.decodeIfPresent(String.self, forKey: .createdAt)) ?? nil
        updatedAt = (try? c.decodeIfPresent(String.self, forKey: .updatedAt)) ?? nil
        completedAt = (try? c.decodeIfPresent(String.self, forKey: .completedAt)) ?? nil
        processing = (try? c.decodeIfPresent(Processing.self, forKey: .processing)) ?? nil
        completion = (try? c.decodeIfPresent(Completion.self, forKey: .completion)) ?? nil
        retryDeferred = (try? c.decodeIfPresent(Bool.self, forKey: .retryDeferred)) ?? nil
    }

    var userTurnCount: Int { turns.filter { $0.role == "user" }.count }
    var isTextActivity: Bool { lesson.material != nil }
    var isReading: Bool { lesson.material?.type == "reading-passage" }
    var isWriting: Bool { lesson.activity == "writing" || lesson.material?.type == "writing-prompt" }
    /// Live composer states (`error` = the analysis failed; the conversation stays usable).
    var isLive: Bool { status == "active" || status == "error" }
    /// The analysis failed and no review exists yet.
    var analysisFailed: Bool { status == "error" && analysis == nil && processing == nil }
    /// A reviewed session still waiting for its improved attempt, whatever its status (L-03).
    var awaitsRetry: Bool {
        guard analysis != nil else { return false }
        if status == "completed" { return retryDeferred == true || completion?.needsRetry == true }
        return status == "review"
    }
    /// Sessions that belong on Today's "Продолжить" card.
    var isResumable: Bool { isLive || status == "review" || awaitsRetry }
    var latestDate: Date? {
        (completedAt ?? updatedAt ?? createdAt).flatMap(NativeDate.parse)
    }
}

struct Processing: Decodable { let stage: String; let startedAt: String; let attempt: Int?; let nextAttemptAt: String? }
struct Completion: Decodable { let canComplete: Bool; let needsRetry: Bool; let reason: String? }

struct SubscriptionUsage: Decodable {
    struct Window: Decodable, Identifiable {
        let id: String
        let bucketName: String?
        /// `primary` (short rolling window) or `secondary` (weekly) from the server.
        let kind: String
        let usedPercent: Double?
        let remainingPercent: Double?
        let windowDurationMins: Double?
        let resetsAt: String?

        /// Names by duration first: two windows of one bucket must never read the same (L-29).
        var title: String {
            if let minutes = windowDurationMins, minutes.isFinite, minutes > 0 {
                if minutes >= 10_080 { return "Неделя" }
                if minutes >= 1_440 {
                    let days = Int((minutes / 1_440).rounded())
                    return "\(days) " + RuFormat.plural(days, "день", "дня", "дней")
                }
                let hours = max(1, Int((minutes / 60).rounded()))
                return "\(hours) ч"
            }
            return kind == "secondary" ? "Неделя" : "Короткое окно"
        }
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
    struct Identity: Decodable { let name: String?; let version: String?; let channel: String? }
    struct Brain: Decodable { let model: String; let verified: Bool; let error: String? }
    struct Audio: Decodable { let configured: Bool }
    let app: Identity?
    let brain: Brain
    let audio: Audio
}

// MARK: - Skill names (one set, equal to lib/types.ts SKILLS)

enum SkillArea: String, CaseIterable, Identifiable {
    case language, dialogue, strategy
    var id: String { rawValue }
    var title: String {
        switch self {
        case .language: return "Английский"
        case .dialogue: return "Разговор"
        case .strategy: return "Стратегия"
        }
    }
}

enum SkillCopy {
    static let order = ["listening", "vocabulary", "grammar", "clarity", "coherence", "reciprocity", "initiative", "repair", "positioning", "negotiation"]
    /// Canonical names shared with the PC client.
    static func title(_ id: String) -> String {
        switch id {
        case "listening": return "Понимать на слух"
        case "vocabulary": return "Находить слова"
        case "grammar": return "Строить фразы"
        case "clarity": return "Говорить понятно"
        case "coherence": return "Держать мысль"
        case "reciprocity": return "Учитывать собеседника"
        case "initiative": return "Вести разговор"
        case "repair": return "Уточнять и исправляться"
        case "positioning": return "Подавать себя"
        case "negotiation": return "Держать цену и условия"
        default: return id
        }
    }
    static func area(_ id: String) -> SkillArea {
        switch id {
        case "listening", "vocabulary", "grammar", "clarity": return .language
        case "positioning", "negotiation": return .strategy
        default: return .dialogue
        }
    }
    static func state(_ value: String) -> String {
        switch value {
        case "supported": return "Получается с опорой"
        case "provisional": return "Первые самостоятельные успехи"
        case "independent": return "Получается самостоятельно"
        case "recheck": return "Пора проверить снова"
        default: return "Ещё не проверено"
        }
    }
}
