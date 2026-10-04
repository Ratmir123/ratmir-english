import Foundation

// Smooth Talk 0.5 feature models (workstream I3): placement test v2, real calls, patterns,
// personal drills and the playbook. Mirrors lib/placement/types.ts, lib/calls/types.ts and
// lib/strategy-moves.ts. Every model decodes leniently: missing fields fall back to defaults,
// numbers may arrive as integers or fractions, and one malformed list element is skipped
// instead of failing the whole response.

// MARK: - Lenient decoding

private struct LossySkippedElement: Decodable {
    init(from decoder: Decoder) throws {}
}

/// Decodes every element it can and skips the rest, so one malformed item never hides a whole list.
/// Usable directly (`LossyArray<CallSummary>`) or as a property wrapper (`@LossyArray var calls: [CallSummary]`).
/// A missing, null or non-array value decodes as an empty list.
@propertyWrapper
struct LossyArray<T: Decodable>: Decodable {
    var wrappedValue: [T]
    /// Number of elements that could not be decoded and were skipped.
    private(set) var skipped: Int = 0
    var elements: [T] { wrappedValue }

    init() { wrappedValue = [] }
    init(wrappedValue: [T]) { self.wrappedValue = wrappedValue }
    init(_ elements: [T]) { wrappedValue = elements }

    init(from decoder: Decoder) throws {
        var values: [T] = []
        var skippedCount = 0
        if var container = try? decoder.unkeyedContainer() {
            while !container.isAtEnd {
                if let value = try? container.decode(T.self) {
                    values.append(value)
                } else if (try? container.decode(LossySkippedElement.self)) != nil {
                    skippedCount += 1
                } else {
                    break
                }
            }
        }
        wrappedValue = values
        skipped = skippedCount
    }
}

extension KeyedDecodingContainer {
    /// `@LossyArray` properties: a missing or null key is an empty list, never a decoding error.
    func decode<T: Decodable>(_ type: LossyArray<T>.Type, forKey key: Key) throws -> LossyArray<T> {
        try decodeIfPresent(type, forKey: key) ?? LossyArray<T>()
    }

    func featureValue<V: Decodable>(_ type: V.Type, _ key: Key) -> V? {
        try? decodeIfPresent(type, forKey: key)
    }

    func featureString(_ key: Key) -> String? {
        if let value = featureValue(String.self, key) { return value }
        if let number = featureValue(Double.self, key), number.isFinite { return FeatureNumber.plain(number) }
        return nil
    }

    func featureNumber(_ key: Key) -> Double? {
        if let value = featureValue(Double.self, key), value.isFinite { return value }
        if let text = featureValue(String.self, key),
           let value = Double(text.trimmingCharacters(in: .whitespacesAndNewlines)), value.isFinite { return value }
        return nil
    }

    func featureInt(_ key: Key) -> Int? { FeatureNumber.int(featureNumber(key)) }

    func featureBool(_ key: Key) -> Bool? {
        if let value = featureValue(Bool.self, key) { return value }
        if let value = featureValue(Double.self, key) { return value != 0 }
        if let text = featureValue(String.self, key) { return ["true", "1", "yes"].contains(text.lowercased()) }
        return nil
    }

    func featureList<V: Decodable>(_ type: V.Type, _ key: Key) -> [V] {
        featureValue(LossyArray<V>.self, key)?.elements ?? []
    }

    func featureStrings(_ key: Key) -> [String] {
        featureList(String.self, key).filter { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
    }

    func featureNumbers(_ key: Key) -> [Double] { featureList(Double.self, key).filter { $0.isFinite } }
}

enum FeatureNumber {
    /// Safe Double → Int (never traps on huge or non-finite values).
    static func int(_ value: Double?) -> Int? {
        guard let value, value.isFinite, abs(value) < 1_000_000_000_000 else { return nil }
        return Int(value.rounded())
    }
    static func plain(_ value: Double) -> String {
        if let whole = int(value), Double(whole) == value { return String(whole) }
        return String(value)
    }
}

/// Stable identity for rows that have no id of their own.
struct FeatureIndexed<T>: Identifiable {
    let id: Int
    let value: T
    static func list(_ items: [T]) -> [FeatureIndexed<T>] {
        items.enumerated().map { FeatureIndexed(id: $0.offset, value: $0.element) }
    }
}

// MARK: - CEFR and strategy moves

enum PlacementCEFR {
    static let levels = ["A1", "A2", "B1", "B2", "C1", "C2"]
    /// A1 = 1 … C2 = 6 (CEFR_VALUE). Accepts labels like "B1+".
    static func value(_ level: String?) -> Int? {
        guard let level else { return nil }
        let base = String(level.trimmingCharacters(in: .whitespaces).prefix(2)).uppercased()
        guard let index = levels.firstIndex(of: base) else { return nil }
        return index + 1
    }
    /// Continuous position on the 1–6 scale: "B1+" → 3.5.
    static func position(_ label: String?) -> Double? {
        guard let label, let band = Self.value(label) else { return nil }
        return Double(band) + (label.hasSuffix("+") ? 0.5 : 0)
    }
}

struct StrategyMoveInfo: Identifiable {
    let id: String
    let title: String
    let good: String
    let bad: String
}

/// Mirror of lib/strategy-moves.ts. Moves are counts, never folded into a CEFR band.
enum StrategyMoveCatalog {
    static let all: [StrategyMoveInfo] = [
        StrategyMoveInfo(id: "answer-first", title: "Ответ первым", good: "Первое предложение отвечает на вопрос", bad: "Сначала предыстория, потом ответ"),
        StrategyMoveInfo(id: "positioning", title: "Самоподача", good: "Роль, жанр и текущий клиент без оговорок", bad: "Возраст, «нет образования», «только начал»"),
        StrategyMoveInfo(id: "proof", title: "Факты вместо ярлыков", good: "Цифра, имя или результат", bad: "Ярлыки вроде «AI native», «очень креативный»"),
        StrategyMoveInfo(id: "discovery", title: "Вопросы по делу", good: "Вопрос про объём, бюджет, сроки, решение или права", bad: "Ни одного вопроса или только small talk"),
        StrategyMoveInfo(id: "anchor-hold", title: "Якорь и цена", good: "Своя цифра, встречное предложение или обмен", bad: "Мгновенное согласие с первой цифрой"),
        StrategyMoveInfo(id: "confidential", title: "Чужие условия", good: "Вежливо отказал и назвал свой диапазон", bad: "Назвал гонорар или сроки другого клиента"),
        StrategyMoveInfo(id: "recap", title: "Резюме условий", good: "Гонорар, доплаты, процент, база, срок лицензии, сроки", bad: "Резюме, где пропали свои доплаты"),
        StrategyMoveInfo(id: "close", title: "Следующий шаг", good: "Кто, что и когда", bad: "«Будем на связи»")
    ]
    static func info(_ id: String) -> StrategyMoveInfo? { all.first { $0.id == id } }
    static func title(_ id: String) -> String { info(id)?.title ?? id }
}

/// One scored move: 2 = done, 1 = partly, 0 = missed, nil = no opportunity.
struct StrategyMoveScore: Decodable, Identifiable {
    let id: String
    let score: Int?
    let quote: String?
    let at: Double?

    private enum CodingKeys: String, CodingKey { case id, score, quote, at }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        guard let id = c.featureString(.id), !id.isEmpty else {
            throw DecodingError.dataCorruptedError(forKey: .id, in: c, debugDescription: "Strategy move without id")
        }
        self.id = id
        if let value = c.featureInt(.score) { score = min(2, max(0, value)) } else { score = nil }
        quote = c.featureString(.quote)
        at = c.featureNumber(.at)
    }
}

// MARK: - Placement test v2

enum PlacementStatus: String {
    case notStarted = "not-started"
    case inProgress = "in-progress"
    case scoring
    case completed
    case error
    case unknown
}

struct PlacementView: Decodable {
    let version: Int
    let status: String
    let attemptId: String?
    let startedAt: String?
    let completedAt: String?
    let remainingMinutes: Int
    let sections: [PlacementSectionView]
    let task: PlacementTask?
    /// Latest completed result (also present while a retake is in progress).
    let result: PlacementResult?
    let history: [PlacementHistoryEntry]
    let error: String?
    let retakeAvailableAt: String?
    let audioAvailable: Bool

    private enum CodingKeys: String, CodingKey {
        case version, status, attemptId, startedAt, completedAt, remainingMinutes, sections, task, result, history, error
        case retakeAvailableAt, audioAvailable
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        version = c.featureInt(.version) ?? 2
        status = c.featureString(.status) ?? PlacementStatus.notStarted.rawValue
        attemptId = c.featureString(.attemptId)
        startedAt = c.featureString(.startedAt)
        completedAt = c.featureString(.completedAt)
        remainingMinutes = max(0, c.featureInt(.remainingMinutes) ?? 0)
        sections = c.featureList(PlacementSectionView.self, .sections)
        task = c.featureValue(PlacementTask.self, .task)
        result = c.featureValue(PlacementResult.self, .result)
        history = c.featureList(PlacementHistoryEntry.self, .history)
        error = c.featureString(.error)
        retakeAvailableAt = c.featureString(.retakeAvailableAt)
        audioAvailable = c.featureBool(.audioAvailable) ?? true
    }

    var phase: PlacementStatus { PlacementStatus(rawValue: status) ?? .unknown }
    var currentSection: PlacementSectionView? {
        if let active = sections.first(where: { $0.status == "active" }) { return active }
        if let id = task?.sectionId { return sections.first { $0.id == id } }
        return nil
    }
    var finishedSections: Int { sections.filter { $0.isFinished }.count }
    var answeredItems: Int { sections.reduce(0) { $0 + $1.answered } }
    /// Sitting 1 is done and nothing of sitting 2 has been answered yet.
    var isAtSittingBreak: Bool {
        guard phase == .inProgress, let current = currentSection, current.sitting == 2, current.answered == 0 else { return false }
        let first = sections.filter { $0.sitting == 1 }
        let second = sections.filter { $0.sitting == 2 }
        return !first.isEmpty && first.allSatisfy { $0.isFinished } && !second.contains { $0.answered > 0 && $0.id != current.id }
    }
}

struct PlacementSectionView: Decodable, Identifiable {
    let id: String
    let title: String
    let description: String
    /// 'pending' | 'active' | 'completed' | 'skipped'
    let status: String
    let answered: Int
    let planned: Int
    let minutes: Int
    let sitting: Int
    let note: String?

    private enum CodingKeys: String, CodingKey { case id, title, description, status, answered, planned, minutes, sitting, note }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        guard let id = c.featureString(.id), !id.isEmpty else {
            throw DecodingError.dataCorruptedError(forKey: .id, in: c, debugDescription: "Section without id")
        }
        self.id = id
        title = c.featureString(.title) ?? FeatureLabels.section(id)
        description = c.featureString(.description) ?? ""
        status = c.featureString(.status) ?? "pending"
        answered = max(0, c.featureInt(.answered) ?? 0)
        planned = max(0, c.featureInt(.planned) ?? 0)
        minutes = max(0, c.featureInt(.minutes) ?? 0)
        sitting = c.featureInt(.sitting) == 2 ? 2 : (["speaking", "interaction"].contains(id) && c.featureInt(.sitting) == nil ? 2 : 1)
        note = c.featureString(.note)
    }

    var isFinished: Bool { status == "completed" || status == "skipped" }
    var isVoice: Bool { ["listening", "speaking", "interaction"].contains(id) }
    /// Answered never shown above planned (planned can be adaptive).
    var displayAnswered: Int { planned > 0 ? min(answered, planned) : answered }
}

struct PlacementHistoryEntry: Decodable, Identifiable {
    let attemptId: String
    let completedAt: String
    let overall: String
    let score: Double?
    var id: String { attemptId }

    private enum CodingKeys: String, CodingKey { case attemptId, completedAt, overall, score }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        attemptId = c.featureString(.attemptId) ?? UUID().uuidString
        completedAt = c.featureString(.completedAt) ?? ""
        overall = c.featureString(.overall) ?? "—"
        score = c.featureNumber(.score)
    }
}

/// Listening clip of a choice task (relative API path, e.g. 'placement/audio/ls-b1-02').
struct PlacementClip: Decodable {
    let url: String
    let maxPlays: Int

    private enum CodingKeys: String, CodingKey { case url, maxPlays }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        guard let url = c.featureString(.url), !url.isEmpty else {
            throw DecodingError.dataCorruptedError(forKey: .url, in: c, debugDescription: "Clip without url")
        }
        self.url = url
        maxPlays = max(1, c.featureInt(.maxPlays) ?? 1)
    }
}

struct PlacementChoiceTask: Decodable {
    let id: String
    let section: String
    let skill: String
    let index: Int
    let total: Int
    let instruction: String
    let passage: String?
    let audio: PlacementClip?
    let prompt: String
    let options: [String]

    private enum CodingKeys: String, CodingKey { case id, section, skill, index, total, instruction, passage, audio, prompt, options }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        guard let id = c.featureString(.id), !id.isEmpty else {
            throw DecodingError.dataCorruptedError(forKey: .id, in: c, debugDescription: "Task without id")
        }
        self.id = id
        let sectionValue = c.featureString(.section) ?? "language"
        section = sectionValue
        skill = c.featureString(.skill) ?? sectionValue
        index = max(1, c.featureInt(.index) ?? 1)
        total = max(0, c.featureInt(.total) ?? 0)
        instruction = c.featureString(.instruction) ?? ""
        passage = c.featureString(.passage)
        audio = c.featureValue(PlacementClip.self, .audio)
        prompt = c.featureString(.prompt) ?? ""
        options = c.featureList(String.self, .options)
    }
}

struct PlacementSpeakingTask: Decodable {
    let id: String
    let section: String
    let index: Int
    let total: Int
    let instruction: String
    let prompt: String
    let prepSeconds: Int
    let minSeconds: Int
    let maxSeconds: Int
    let autoStart: Bool
    let followUp: Bool
    let readAloud: Bool

    private enum CodingKeys: String, CodingKey {
        case id, section, index, total, instruction, prompt, prepSeconds, minSeconds, maxSeconds, autoStart, followUp, readAloud
    }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        guard let id = c.featureString(.id), !id.isEmpty else {
            throw DecodingError.dataCorruptedError(forKey: .id, in: c, debugDescription: "Task without id")
        }
        self.id = id
        section = c.featureString(.section) ?? "speaking"
        index = max(1, c.featureInt(.index) ?? 1)
        total = max(0, c.featureInt(.total) ?? 0)
        instruction = c.featureString(.instruction) ?? ""
        prompt = c.featureString(.prompt) ?? ""
        prepSeconds = min(300, max(0, c.featureInt(.prepSeconds) ?? 0))
        let maximum = min(600, max(10, c.featureInt(.maxSeconds) ?? 60))
        maxSeconds = maximum
        minSeconds = min(maximum, max(0, c.featureInt(.minSeconds) ?? 15))
        autoStart = c.featureBool(.autoStart) ?? true
        followUp = c.featureBool(.followUp) ?? false
        readAloud = c.featureBool(.readAloud) ?? false
    }
}

struct PlacementPartnerLine: Decodable {
    let text: String
    let audioUrl: String?

    private enum CodingKeys: String, CodingKey { case text, audioUrl }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        text = c.featureString(.text) ?? ""
        audioUrl = c.featureString(.audioUrl)
    }
}

struct PlacementRoleplayTask: Decodable {
    let id: String
    let section: String
    let index: Int
    let total: Int
    let instruction: String
    let partnerRole: String
    let partnerLine: PlacementPartnerLine?
    let maxSeconds: Int

    private enum CodingKeys: String, CodingKey { case id, section, index, total, instruction, partnerRole, partnerLine, maxSeconds }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        guard let id = c.featureString(.id), !id.isEmpty else {
            throw DecodingError.dataCorruptedError(forKey: .id, in: c, debugDescription: "Task without id")
        }
        self.id = id
        section = c.featureString(.section) ?? "interaction"
        index = max(1, c.featureInt(.index) ?? 1)
        total = max(0, c.featureInt(.total) ?? 0)
        instruction = c.featureString(.instruction) ?? ""
        partnerRole = c.featureString(.partnerRole) ?? ""
        partnerLine = c.featureValue(PlacementPartnerLine.self, .partnerLine)
        maxSeconds = min(600, max(10, c.featureInt(.maxSeconds) ?? 45))
    }
}

/// Task currently shown to the learner, decoded by `kind`. Unknown or malformed kinds become `.unsupported`.
enum PlacementTask: Decodable {
    case choice(PlacementChoiceTask)
    case speaking(PlacementSpeakingTask)
    case roleplay(PlacementRoleplayTask)
    case unsupported

    private enum KindKey: String, CodingKey { case kind }

    init(from decoder: Decoder) throws {
        let kind: String
        if let container = try? decoder.container(keyedBy: KindKey.self) {
            kind = container.featureString(.kind) ?? ""
        } else {
            kind = ""
        }
        switch kind {
        case "choice":
            if let value = try? PlacementChoiceTask(from: decoder) { self = .choice(value) } else { self = .unsupported }
        case "speaking":
            if let value = try? PlacementSpeakingTask(from: decoder) { self = .speaking(value) } else { self = .unsupported }
        case "roleplay":
            if let value = try? PlacementRoleplayTask(from: decoder) { self = .roleplay(value) } else { self = .unsupported }
        default:
            self = .unsupported
        }
    }

    var id: String? {
        switch self {
        case .choice(let task): return task.id
        case .speaking(let task): return task.id
        case .roleplay(let task): return task.id
        case .unsupported: return nil
        }
    }
    var sectionId: String? {
        switch self {
        case .choice(let task): return task.section
        case .speaking(let task): return task.section
        case .roleplay(let task): return task.section
        case .unsupported: return nil
        }
    }
    var position: (index: Int, total: Int)? {
        switch self {
        case .choice(let task): return (task.index, task.total)
        case .speaking(let task): return (task.index, task.total)
        case .roleplay(let task): return (task.index, task.total)
        case .unsupported: return nil
        }
    }
}

struct PlacementRange: Decodable {
    let from: String
    let to: String

    private enum CodingKeys: String, CodingKey { case from, to }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        guard let from = c.featureString(.from), let to = c.featureString(.to) else {
            throw DecodingError.dataCorruptedError(forKey: .from, in: c, debugDescription: "Incomplete range")
        }
        self.from = from
        self.to = to
    }
    var text: String { from == to ? from : from + "–" + to }
}

struct PlacementSkillResult: Decodable, Identifiable {
    let id: String
    /// nil when the section was skipped («не измерено»).
    let level: String?
    let label: String?
    let score: Double?
    let confidence: String
    let basis: String
    let note: String
    let range: PlacementRange?
    let answered: Int?
    let correct: Int?

    private enum CodingKeys: String, CodingKey { case id, level, label, score, confidence, basis, note, range, answered, correct }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        guard let id = c.featureString(.id), !id.isEmpty else {
            throw DecodingError.dataCorruptedError(forKey: .id, in: c, debugDescription: "Skill without id")
        }
        self.id = id
        level = c.featureString(.level)
        label = c.featureString(.label) ?? c.featureString(.level)
        score = c.featureNumber(.score)
        confidence = c.featureString(.confidence) ?? "low"
        basis = c.featureString(.basis) ?? ""
        note = c.featureString(.note) ?? ""
        range = c.featureValue(PlacementRange.self, .range)
        answered = c.featureInt(.answered)
        correct = c.featureInt(.correct)
    }

    var measured: Bool { label != nil && level != nil }
}

struct PlacementOverall: Decodable {
    let level: String
    let label: String
    let score: Double?
    let confidence: String
    let summary: String

    private enum CodingKeys: String, CodingKey { case level, label, score, confidence, summary }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        level = c.featureString(.level) ?? "—"
        label = c.featureString(.label) ?? c.featureString(.level) ?? "—"
        score = c.featureNumber(.score)
        confidence = c.featureString(.confidence) ?? "low"
        summary = c.featureString(.summary) ?? ""
    }
}

struct PlacementSpeakingLabels: Decodable {
    let range: String?
    let accuracy: String?
    let fluency: String?
    let coherence: String?

    private enum CodingKeys: String, CodingKey { case range, accuracy, fluency, coherence }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        range = c.featureString(.range)
        accuracy = c.featureString(.accuracy)
        fluency = c.featureString(.fluency)
        coherence = c.featureString(.coherence)
    }
    init() { range = nil; accuracy = nil; fluency = nil; coherence = nil }
}

struct PlacementTiming: Decodable {
    let wordsPerMinute: Double?
    let pausesPerMinute: Double?
    let longestPauseSeconds: Double?
    let meanLengthOfRun: Double?
    let fillersPerMinute: Double?
    let latencySeconds: Double?

    private enum CodingKeys: String, CodingKey {
        case wordsPerMinute, pausesPerMinute, longestPauseSeconds, meanLengthOfRun, fillersPerMinute, latencySeconds
    }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        wordsPerMinute = c.featureNumber(.wordsPerMinute)
        pausesPerMinute = c.featureNumber(.pausesPerMinute)
        longestPauseSeconds = c.featureNumber(.longestPauseSeconds)
        meanLengthOfRun = c.featureNumber(.meanLengthOfRun)
        fillersPerMinute = c.featureNumber(.fillersPerMinute)
        latencySeconds = c.featureNumber(.latencySeconds)
    }
    var isEmpty: Bool {
        [wordsPerMinute, pausesPerMinute, longestPauseSeconds, meanLengthOfRun, fillersPerMinute, latencySeconds].allSatisfy { $0 == nil }
    }
}

struct PlacementSpeakingExample: Decodable {
    let quote: String
    let comment: String
    let better: String

    private enum CodingKeys: String, CodingKey { case quote, comment, better }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        quote = c.featureString(.quote) ?? ""
        comment = c.featureString(.comment) ?? ""
        better = c.featureString(.better) ?? ""
    }
}

/// Language error that matters: impact 'meaning' | 'seniority' | 'minor'.
struct PlacementLanguageError: Decodable {
    let quote: String
    let correction: String
    let tag: String
    let impact: String

    private enum CodingKeys: String, CodingKey { case quote, correction, tag, impact }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        quote = c.featureString(.quote) ?? ""
        correction = c.featureString(.correction) ?? ""
        tag = c.featureString(.tag) ?? ""
        impact = c.featureString(.impact) ?? "minor"
    }
}

struct PlacementCriterion: Identifiable {
    let id: String
    let title: String
    let label: String?
}

struct PlacementSpeakingResult: Decodable {
    let range: String?
    let accuracy: String?
    let fluency: String?
    let coherence: String?
    let labels: PlacementSpeakingLabels
    let timing: PlacementTiming?
    let examples: [PlacementSpeakingExample]
    let errors: [PlacementLanguageError]
    let notes: [String]

    private enum CodingKeys: String, CodingKey { case range, accuracy, fluency, coherence, labels, timing, examples, errors, notes }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        range = c.featureString(.range)
        accuracy = c.featureString(.accuracy)
        fluency = c.featureString(.fluency)
        coherence = c.featureString(.coherence)
        labels = c.featureValue(PlacementSpeakingLabels.self, .labels) ?? PlacementSpeakingLabels()
        timing = c.featureValue(PlacementTiming.self, .timing)
        examples = c.featureList(PlacementSpeakingExample.self, .examples).filter { !$0.quote.isEmpty }
        errors = c.featureList(PlacementLanguageError.self, .errors).filter { !$0.quote.isEmpty }
        notes = c.featureStrings(.notes)
    }
    init() {
        range = nil; accuracy = nil; fluency = nil; coherence = nil
        labels = PlacementSpeakingLabels(); timing = nil; examples = []; errors = []; notes = []
    }
    /// The four criteria in display order with their labels ('+' kept), falling back to the plain band.
    var criteria: [PlacementCriterion] {
        [PlacementCriterion(id: "accuracy", title: "Точность", label: labels.accuracy ?? accuracy),
         PlacementCriterion(id: "fluency", title: "Беглость", label: labels.fluency ?? fluency),
         PlacementCriterion(id: "coherence", title: "Связность", label: labels.coherence ?? coherence),
         PlacementCriterion(id: "range", title: "Запас", label: labels.range ?? range)]
    }
}

struct PlacementObservation: Decodable {
    let title: String
    let detail: String
    let quote: String?

    private enum CodingKeys: String, CodingKey { case title, detail, quote }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        title = c.featureString(.title) ?? ""
        detail = c.featureString(.detail) ?? ""
        quote = c.featureString(.quote)
    }
}

struct PlacementCommunication: Decodable {
    let strengths: [String]
    let risks: [String]
    let observations: [PlacementObservation]
    let moves: [StrategyMoveScore]

    private enum CodingKeys: String, CodingKey { case strengths, risks, observations, moves }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        strengths = c.featureStrings(.strengths)
        risks = c.featureStrings(.risks)
        observations = c.featureList(PlacementObservation.self, .observations).filter { !$0.title.isEmpty || !$0.detail.isEmpty }
        moves = c.featureList(StrategyMoveScore.self, .moves)
    }
    init() { strengths = []; risks = []; observations = []; moves = [] }
}

struct PlacementLanguageTarget: Decodable {
    let tag: String
    let title: String
    let quote: String?
    let correction: String?

    private enum CodingKeys: String, CodingKey { case tag, title, quote, correction }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        tag = c.featureString(.tag) ?? ""
        title = c.featureString(.title) ?? ""
        quote = c.featureString(.quote)
        correction = c.featureString(.correction)
    }
}

struct PlacementPriority: Decodable {
    let title: String
    let why: String
    let action: String

    private enum CodingKeys: String, CodingKey { case title, why, action }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        title = c.featureString(.title) ?? ""
        why = c.featureString(.why) ?? ""
        action = c.featureString(.action) ?? ""
    }
}

/// Objective item review shown after the test (answer keys arrive only in the result).
struct PlacementReviewItem: Decodable, Identifiable {
    let itemId: String
    let section: String
    let prompt: String
    let options: [String]
    let chosen: Int?
    let answer: Int?
    let correct: Bool
    let explanation: String
    let passage: String?
    var id: String { itemId }

    private enum CodingKeys: String, CodingKey { case itemId, section, prompt, options, chosen, answer, correct, explanation, passage }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        guard let itemId = c.featureString(.itemId), !itemId.isEmpty else {
            throw DecodingError.dataCorruptedError(forKey: .itemId, in: c, debugDescription: "Review item without id")
        }
        self.itemId = itemId
        section = c.featureString(.section) ?? "language"
        prompt = c.featureString(.prompt) ?? ""
        options = c.featureList(String.self, .options)
        chosen = c.featureInt(.chosen)
        answer = c.featureInt(.answer)
        correct = c.featureBool(.correct) ?? false
        explanation = c.featureString(.explanation) ?? ""
        passage = c.featureString(.passage)
    }
}

struct PlacementResult: Decodable {
    let version: Int
    let attemptId: String
    let completedAt: String
    let model: String
    let procedureVersion: String
    /// Shape first, e.g. «Понимаешь лучше, чем говоришь — примерно на уровень».
    let headline: String
    let overall: PlacementOverall?
    /// Fixed order: listening, reading, grammar, vocabulary, speaking, interaction.
    let skills: [PlacementSkillResult]
    let speaking: PlacementSpeakingResult
    let communication: PlacementCommunication
    let languageTargets: [PlacementLanguageTarget]
    let partnerLevel: String?
    let priorities: [PlacementPriority]
    let review: [PlacementReviewItem]
    let limitations: [String]

    private enum CodingKeys: String, CodingKey {
        case version, attemptId, completedAt, model, procedureVersion, headline, overall, skills, speaking, communication
        case languageTargets, partnerLevel, priorities, review, limitations
    }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        version = c.featureInt(.version) ?? 2
        attemptId = c.featureString(.attemptId) ?? ""
        completedAt = c.featureString(.completedAt) ?? ""
        model = c.featureString(.model) ?? ""
        procedureVersion = c.featureString(.procedureVersion) ?? "v2"
        headline = c.featureString(.headline) ?? ""
        overall = c.featureValue(PlacementOverall.self, .overall)
        skills = c.featureList(PlacementSkillResult.self, .skills)
        speaking = c.featureValue(PlacementSpeakingResult.self, .speaking) ?? PlacementSpeakingResult()
        communication = c.featureValue(PlacementCommunication.self, .communication) ?? PlacementCommunication()
        languageTargets = c.featureList(PlacementLanguageTarget.self, .languageTargets).filter { !$0.title.isEmpty }
        partnerLevel = c.featureString(.partnerLevel)
        priorities = c.featureList(PlacementPriority.self, .priorities).filter { !$0.title.isEmpty }
        review = c.featureList(PlacementReviewItem.self, .review)
        limitations = c.featureStrings(.limitations)
    }

    func skill(_ id: String) -> PlacementSkillResult? { skills.first { $0.id == id } }
}

// MARK: - Calls

enum CallStatusKind: String {
    case awaitingUpload = "awaiting-upload"
    case queued
    case processing
    case needsSpeaker = "needs-speaker"
    case analysing
    case ready
    case error
    case unknown
}

struct CallProgress: Decodable {
    let stage: String
    let percent: Double

    private enum CodingKeys: String, CodingKey { case stage, percent }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        stage = c.featureString(.stage) ?? ""
        percent = min(100, max(0, c.featureNumber(.percent) ?? 0))
    }
}

struct CallSummary: Decodable, Identifiable {
    let id: String
    let title: String
    let counterpart: String?
    let context: String
    let occurredAt: String?
    let createdAt: String
    let updatedAt: String
    /// 'audio' | 'transcript' | 'debrief' | 'memory'
    let source: String
    let status: String
    let progress: CallProgress?
    let durationSeconds: Double?
    let outcome: String?
    let topCost: String?
    let drillsTotal: Int
    let drillsDone: Int
    let uploadedBytes: Double?
    let error: String?

    private enum CodingKeys: String, CodingKey {
        case id, title, counterpart, context, occurredAt, createdAt, updatedAt, source, status, progress, durationSeconds
        case outcome, topCost, drillsTotal, drillsDone, uploadedBytes, error
    }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        guard let id = c.featureString(.id), !id.isEmpty else {
            throw DecodingError.dataCorruptedError(forKey: .id, in: c, debugDescription: "Call without id")
        }
        self.id = id
        let rawTitle = c.featureString(.title)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        title = rawTitle.isEmpty ? "Созвон" : rawTitle
        counterpart = c.featureString(.counterpart)
        context = c.featureString(.context) ?? "work"
        occurredAt = c.featureString(.occurredAt)
        let created = c.featureString(.createdAt) ?? ""
        createdAt = created
        updatedAt = c.featureString(.updatedAt) ?? created
        source = c.featureString(.source) ?? "audio"
        status = c.featureString(.status) ?? CallStatusKind.unknown.rawValue
        progress = c.featureValue(CallProgress.self, .progress)
        durationSeconds = c.featureNumber(.durationSeconds)
        outcome = c.featureString(.outcome)
        topCost = c.featureString(.topCost)
        let total = max(0, c.featureInt(.drillsTotal) ?? 0)
        drillsTotal = total
        drillsDone = min(total, max(0, c.featureInt(.drillsDone) ?? 0))
        uploadedBytes = c.featureNumber(.uploadedBytes)
        error = c.featureString(.error)
    }

    var kind: CallStatusKind { CallStatusKind(rawValue: status) ?? .unknown }
    /// Server-side work in progress: the list polls while any call is in one of these states.
    var isProcessing: Bool { kind == .queued || kind == .processing || kind == .analysing }
    var signature: String {
        [id, status, updatedAt, progress.map { $0.stage + FeatureNumber.plain($0.percent) } ?? "", String(drillsDone)].joined(separator: "|")
    }
}

struct CallSpeaker: Decodable, Identifiable {
    let id: String
    let label: String
    let isMe: Bool
    let talkSeconds: Double?
    let sample: [String]

    private enum CodingKeys: String, CodingKey { case id, label, isMe, talkSeconds, sample }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        guard let id = c.featureString(.id), !id.isEmpty else {
            throw DecodingError.dataCorruptedError(forKey: .id, in: c, debugDescription: "Speaker without id")
        }
        self.id = id
        label = c.featureString(.label) ?? "Собеседник"
        isMe = c.featureBool(.isMe) ?? false
        talkSeconds = c.featureNumber(.talkSeconds)
        sample = c.featureStrings(.sample)
    }
}

struct CallSegment: Decodable, Identifiable {
    let id: String
    let speaker: String?
    let start: Double?
    let end: Double?
    let text: String
    let verbatim: String?
    let disputed: Bool

    private enum CodingKeys: String, CodingKey { case id, speaker, start, end, text, verbatim, disputed }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        guard let id = c.featureString(.id), !id.isEmpty else {
            throw DecodingError.dataCorruptedError(forKey: .id, in: c, debugDescription: "Segment without id")
        }
        self.id = id
        speaker = c.featureString(.speaker)
        start = c.featureNumber(.start)
        end = c.featureNumber(.end)
        text = c.featureString(.text) ?? ""
        verbatim = c.featureString(.verbatim)
        disputed = c.featureBool(.disputed) ?? false
    }
}

struct CallMetrics: Decodable {
    let myTalkShare: Double?
    let myWordsPerMinute: Double?
    let longestMonologueSeconds: Double?
    let myTurns: Int
    let otherTurns: Int
    let myQuestions: Int
    let responseLatencyMedianSeconds: Double?
    let fillersPerMinute: Double?
    let clarifyRequests: Int

    private enum CodingKeys: String, CodingKey {
        case myTalkShare, myWordsPerMinute, longestMonologueSeconds, myTurns, otherTurns, myQuestions
        case responseLatencyMedianSeconds, fillersPerMinute, clarifyRequests
    }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        if let share = c.featureNumber(.myTalkShare) { myTalkShare = min(1, max(0, share)) } else { myTalkShare = nil }
        myWordsPerMinute = c.featureNumber(.myWordsPerMinute)
        longestMonologueSeconds = c.featureNumber(.longestMonologueSeconds)
        myTurns = max(0, c.featureInt(.myTurns) ?? 0)
        otherTurns = max(0, c.featureInt(.otherTurns) ?? 0)
        myQuestions = max(0, c.featureInt(.myQuestions) ?? 0)
        responseLatencyMedianSeconds = c.featureNumber(.responseLatencyMedianSeconds)
        fillersPerMinute = c.featureNumber(.fillersPerMinute)
        clarifyRequests = max(0, c.featureInt(.clarifyRequests) ?? 0)
    }
}

struct CallTimelineItem: Decodable {
    let at: Double?
    let title: String
    let detail: String

    private enum CodingKeys: String, CodingKey { case at, title, detail }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        at = c.featureNumber(.at)
        title = c.featureString(.title) ?? ""
        detail = c.featureString(.detail) ?? ""
    }
}

struct CallAgreedTerm: Decodable {
    let term: String
    let value: String
    let quote: String?
    let at: Double?
    /// 'explicit' | 'implied' | 'unclear'
    let clarity: String

    private enum CodingKeys: String, CodingKey { case term, value, quote, at, clarity }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        term = c.featureString(.term) ?? ""
        value = c.featureString(.value) ?? ""
        quote = c.featureString(.quote)
        at = c.featureNumber(.at)
        clarity = c.featureString(.clarity) ?? "explicit"
    }
}

struct CallNextStep: Decodable {
    let who: String
    let what: String
    let when: String?
    let explicit: Bool

    private enum CodingKeys: String, CodingKey { case who, what, when, explicit }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        who = c.featureString(.who) ?? ""
        what = c.featureString(.what) ?? ""
        when = c.featureString(.when)
        explicit = c.featureBool(.explicit) ?? false
    }
}

struct DealModel: Decodable {
    /// 'USD' | 'EUR'
    let currency: String
    let fixedFee: Double
    let percent: Double?
    let base: String?
    let floor: Double?
    let scenarios: [Double]

    private enum CodingKeys: String, CodingKey { case currency, fixedFee, percent, base, floor, scenarios }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        currency = c.featureString(.currency) ?? "USD"
        fixedFee = c.featureNumber(.fixedFee) ?? 0
        percent = c.featureNumber(.percent)
        base = c.featureString(.base)
        floor = c.featureNumber(.floor)
        scenarios = c.featureNumbers(.scenarios)
    }
}

struct CallDealRow: Decodable {
    let base: Double
    let percentFee: Double
    let total: Double

    private enum CodingKeys: String, CodingKey { case base, percentFee, total }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        base = c.featureNumber(.base) ?? 0
        percentFee = c.featureNumber(.percentFee) ?? 0
        total = c.featureNumber(.total) ?? 0
    }
}

struct CallWin: Decodable {
    let title: String
    let detail: String
    let quote: String?
    let at: Double?

    private enum CodingKeys: String, CodingKey { case title, detail, quote, at }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        title = c.featureString(.title) ?? ""
        detail = c.featureString(.detail) ?? ""
        quote = c.featureString(.quote)
        at = c.featureNumber(.at)
    }
}

struct CallCost: Decodable {
    let rank: Int
    let title: String
    let detail: String
    let quote: String?
    let at: Double?
    let segmentId: String?
    let category: String
    /// 'high' | 'medium' | 'low'
    let impact: String
    let patternId: String?
    let impactUsd: Double?
    let impactBasis: String?
    /// English line in his voice.
    let better: String

    private enum CodingKeys: String, CodingKey {
        case rank, title, detail, quote, at, segmentId, category, impact, patternId, impactUsd, impactBasis, better
    }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        rank = max(1, c.featureInt(.rank) ?? 99)
        title = c.featureString(.title) ?? ""
        detail = c.featureString(.detail) ?? ""
        quote = c.featureString(.quote)
        at = c.featureNumber(.at)
        segmentId = c.featureString(.segmentId)
        category = c.featureString(.category) ?? "other"
        impact = c.featureString(.impact) ?? "medium"
        patternId = c.featureString(.patternId)
        impactUsd = c.featureNumber(.impactUsd)
        impactBasis = c.featureString(.impactBasis)
        better = c.featureString(.better) ?? ""
    }
}

struct CallDebatable: Decodable {
    let title: String
    let quote: String?
    let at: Double?
    let forSide: String
    let againstSide: String
    let verdict: String

    private enum CodingKeys: String, CodingKey { case title, quote, at, forSide, againstSide, verdict }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        title = c.featureString(.title) ?? ""
        quote = c.featureString(.quote)
        at = c.featureNumber(.at)
        forSide = c.featureString(.forSide) ?? ""
        againstSide = c.featureString(.againstSide) ?? ""
        verdict = c.featureString(.verdict) ?? ""
    }
}

struct CallLanguageIssue: Decodable {
    let quote: String
    let correction: String
    let why: String
    let at: Double?
    let tag: String
    /// 'meaning' | 'seniority' | 'minor'
    let impact: String
    /// Possibly mis-heard by speech recognition: never taught from.
    let asrSuspect: Bool

    private enum CodingKeys: String, CodingKey { case quote, correction, why, at, tag, impact, asrSuspect }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        quote = c.featureString(.quote) ?? ""
        correction = c.featureString(.correction) ?? ""
        why = c.featureString(.why) ?? ""
        at = c.featureNumber(.at)
        tag = c.featureString(.tag) ?? ""
        impact = c.featureString(.impact) ?? "minor"
        asrSuspect = c.featureBool(.asrSuspect) ?? false
    }
}

struct CallBetterAnswer: Decodable {
    let situation: String
    let answer: String
    let trigger: String?
    let at: Double?

    private enum CodingKeys: String, CodingKey { case situation, answer, trigger, at }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        situation = c.featureString(.situation) ?? ""
        answer = c.featureString(.answer) ?? ""
        trigger = c.featureString(.trigger)
        at = c.featureNumber(.at)
    }
}

struct CallFollowUp: Decodable {
    /// 'email' | 'message'
    let channel: String
    let subject: String?
    /// English text with [[placeholders]].
    let text: String
    let notes: [String]

    private enum CodingKeys: String, CodingKey { case channel, subject, text, notes }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        channel = c.featureString(.channel) ?? "message"
        subject = c.featureString(.subject)
        text = c.featureString(.text) ?? ""
        notes = c.featureStrings(.notes)
    }
}

struct CallRisk: Decodable {
    let title: String
    let detail: String

    private enum CodingKeys: String, CodingKey { case title, detail }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        title = c.featureString(.title) ?? ""
        detail = c.featureString(.detail) ?? ""
    }
}

struct CallPatternOutcome: Decodable {
    let patternId: String
    /// 'repeated' | 'avoided' | 'no-opportunity' | 'improved' | 'new'
    let status: String
    let evidence: String

    private enum CodingKeys: String, CodingKey { case patternId, status, evidence }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        guard let patternId = c.featureString(.patternId), !patternId.isEmpty else {
            throw DecodingError.dataCorruptedError(forKey: .patternId, in: c, debugDescription: "Outcome without pattern")
        }
        self.patternId = patternId
        status = c.featureString(.status) ?? "no-opportunity"
        evidence = c.featureString(.evidence) ?? ""
    }
}

struct CallReview: Decodable {
    let version: Int
    let model: String
    let createdAt: String
    /// 'memory' source: strategy only, no quotes, no language or timing analysis.
    let fromMemory: Bool
    let kind: String
    let outcome: String
    let summary: String
    let timeline: [CallTimelineItem]
    let agreedTerms: [CallAgreedTerm]
    let nextStep: CallNextStep?
    let dealModel: DealModel?
    let dealTable: [CallDealRow]
    let breakEven: Double?
    let wins: [CallWin]
    let costs: [CallCost]
    let debatable: [CallDebatable]
    let language: [CallLanguageIssue]
    let minorErrorsIgnored: Int
    let betterAnswers: [CallBetterAnswer]
    let followUp: CallFollowUp?
    let risks: [CallRisk]
    let patterns: [CallPatternOutcome]
    let strategyMoves: [StrategyMoveScore]
    let limitations: [String]
    let dropped: Int

    private enum CodingKeys: String, CodingKey {
        case version, model, createdAt, fromMemory, kind, outcome, summary, timeline, agreedTerms, nextStep, dealModel
        case dealTable, breakEven, wins, costs, debatable, language, minorErrorsIgnored, betterAnswers, followUp, risks
        case patterns, strategyMoves, limitations, dropped
    }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        version = c.featureInt(.version) ?? 1
        model = c.featureString(.model) ?? ""
        createdAt = c.featureString(.createdAt) ?? ""
        fromMemory = c.featureBool(.fromMemory) ?? false
        kind = c.featureString(.kind) ?? ""
        outcome = c.featureString(.outcome) ?? ""
        summary = c.featureString(.summary) ?? ""
        timeline = c.featureList(CallTimelineItem.self, .timeline).filter { !$0.title.isEmpty || !$0.detail.isEmpty }
        agreedTerms = c.featureList(CallAgreedTerm.self, .agreedTerms).filter { !$0.term.isEmpty }
        nextStep = c.featureValue(CallNextStep.self, .nextStep)
        dealModel = c.featureValue(DealModel.self, .dealModel)
        dealTable = c.featureList(CallDealRow.self, .dealTable)
        breakEven = c.featureNumber(.breakEven)
        wins = c.featureList(CallWin.self, .wins).filter { !$0.title.isEmpty }
        costs = c.featureList(CallCost.self, .costs).filter { !$0.title.isEmpty }.sorted { $0.rank < $1.rank }
        debatable = c.featureList(CallDebatable.self, .debatable).filter { !$0.title.isEmpty }
        language = c.featureList(CallLanguageIssue.self, .language).filter { !$0.quote.isEmpty }
        minorErrorsIgnored = max(0, c.featureInt(.minorErrorsIgnored) ?? 0)
        betterAnswers = c.featureList(CallBetterAnswer.self, .betterAnswers).filter { !$0.answer.isEmpty }
        followUp = c.featureValue(CallFollowUp.self, .followUp)
        risks = c.featureList(CallRisk.self, .risks).filter { !$0.title.isEmpty }
        patterns = c.featureList(CallPatternOutcome.self, .patterns)
        strategyMoves = c.featureList(StrategyMoveScore.self, .strategyMoves)
        limitations = c.featureStrings(.limitations)
        dropped = max(0, c.featureInt(.dropped) ?? 0)
    }
}

struct CallDetail: Decodable, Identifiable {
    let summary: CallSummary
    let notes: String?
    let speakers: [CallSpeaker]
    let segments: [CallSegment]
    let metrics: CallMetrics?
    let review: CallReview?
    /// Facts suggested by this call.
    let facts: [ProfileFact]
    /// Drills generated from this call.
    let drills: [PersonalDrill]
    /// Relative API path to the processed audio, e.g. 'calls/<id>/audio'.
    let audioUrl: String?
    let audioExpiresAt: String?

    private enum CodingKeys: String, CodingKey { case notes, speakers, segments, metrics, review, facts, drills, audioUrl, audioExpiresAt }
    init(from decoder: Decoder) throws {
        summary = try CallSummary(from: decoder)
        let c = try decoder.container(keyedBy: CodingKeys.self)
        notes = c.featureString(.notes)
        speakers = c.featureList(CallSpeaker.self, .speakers)
        segments = c.featureList(CallSegment.self, .segments)
        metrics = c.featureValue(CallMetrics.self, .metrics)
        review = c.featureValue(CallReview.self, .review)
        facts = c.featureList(ProfileFact.self, .facts)
        drills = c.featureList(PersonalDrill.self, .drills)
        audioUrl = c.featureString(.audioUrl)
        audioExpiresAt = c.featureString(.audioExpiresAt)
    }

    var id: String { summary.id }
    var title: String { summary.title }
    var status: String { summary.status }
    var kind: CallStatusKind { summary.kind }
    var source: String { summary.source }
    func speaker(_ id: String?) -> CallSpeaker? {
        guard let id else { return nil }
        return speakers.first { $0.id == id }
    }
    var meSpeakerId: String? { speakers.first { $0.isMe }?.id }
}

// MARK: - Playbook facts, patterns, drills

struct ProfileFactSource: Decodable {
    /// 'call' | 'manual' | 'seed'
    let type: String
    let callId: String?

    private enum CodingKeys: String, CodingKey { case type, callId }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        type = c.featureString(.type) ?? "manual"
        callId = c.featureString(.callId)
    }
    init(type: String) { self.type = type; callId = nil }
}

struct ProfileFact: Decodable, Identifiable {
    let id: String
    /// 'rate' | 'floor' | 'case' | 'metric' | 'confidential' | 'relocation' | 'counterpart' | 'positioning' | 'preference' | 'other'
    let kind: String
    let text: String
    let quote: String?
    let at: Double?
    let source: ProfileFactSource
    /// 'suggested' | 'accepted' | 'rejected'
    let status: String
    let createdAt: String

    private enum CodingKeys: String, CodingKey { case id, kind, text, quote, at, source, status, createdAt }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        guard let id = c.featureString(.id), !id.isEmpty else {
            throw DecodingError.dataCorruptedError(forKey: .id, in: c, debugDescription: "Fact without id")
        }
        self.id = id
        kind = c.featureString(.kind) ?? "other"
        text = c.featureString(.text) ?? ""
        quote = c.featureString(.quote)
        at = c.featureNumber(.at)
        source = c.featureValue(ProfileFactSource.self, .source) ?? ProfileFactSource(type: "manual")
        status = c.featureString(.status) ?? "suggested"
        createdAt = c.featureString(.createdAt) ?? ""
    }
}

struct PatternRealRounds: Decodable {
    let opportunities: Int
    let avoided: Int
    let repeated: Int

    private enum CodingKeys: String, CodingKey { case opportunities, avoided, repeated }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        opportunities = max(0, c.featureInt(.opportunities) ?? 0)
        avoided = max(0, c.featureInt(.avoided) ?? 0)
        repeated = max(0, c.featureInt(.repeated) ?? 0)
    }
    init() { opportunities = 0; avoided = 0; repeated = 0 }
}

struct PatternPracticeRounds: Decodable {
    let attempts: Int
    let independentSuccesses: Int
    let lastAt: String?

    private enum CodingKeys: String, CodingKey { case attempts, independentSuccesses, lastAt }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let total = max(0, c.featureInt(.attempts) ?? 0)
        attempts = total
        independentSuccesses = min(total, max(0, c.featureInt(.independentSuccesses) ?? 0))
        lastAt = c.featureString(.lastAt)
    }
    init() { attempts = 0; independentSuccesses = 0; lastAt = nil }
}

struct PatternHistoryEntry: Decodable {
    /// 'call' | 'practice' | 'placement'
    let source: String
    let sourceId: String
    let date: String
    /// PatternOutcome: 'repeated' | 'avoided' | 'no-opportunity' | 'improved' | 'new'
    let status: String

    private enum CodingKeys: String, CodingKey { case source, sourceId, date, status }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        source = c.featureString(.source) ?? "call"
        sourceId = c.featureString(.sourceId) ?? ""
        date = c.featureString(.date) ?? ""
        status = c.featureString(.status) ?? "no-opportunity"
    }
}

struct PatternEvidence: Decodable {
    let source: String
    let sourceId: String
    let quote: String
    let at: Double?
    let date: String
    let status: String

    private enum CodingKeys: String, CodingKey { case source, sourceId, quote, at, date, status }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        source = c.featureString(.source) ?? "call"
        sourceId = c.featureString(.sourceId) ?? ""
        quote = c.featureString(.quote) ?? ""
        at = c.featureNumber(.at)
        date = c.featureString(.date) ?? ""
        status = c.featureString(.status) ?? "repeated"
    }
}

struct CommunicationPattern: Decodable, Identifiable {
    let id: String
    let title: String
    /// 'weakness' | 'strength'
    let kind: String
    let category: String
    let description: String
    /// 'watch' | 'active' | 'improving' | 'resolved'
    let status: String
    /// 1 = most expensive.
    let costRank: Int
    let contexts: [String]
    let occurrences: Int
    let firstSeenAt: String
    let lastSeenAt: String
    let real: PatternRealRounds
    let practice: PatternPracticeRounds
    /// Oldest first.
    let history: [PatternHistoryEntry]
    /// Latest first, max 5.
    let evidence: [PatternEvidence]
    let drillHint: String
    let userConfirmed: Bool
    let dismissed: Bool
    let userNote: String?

    private enum CodingKeys: String, CodingKey {
        case id, title, kind, category, description, status, costRank, contexts, occurrences, firstSeenAt, lastSeenAt
        case real, practice, history, evidence, drillHint, userConfirmed, dismissed, userNote
    }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        guard let id = c.featureString(.id), !id.isEmpty else {
            throw DecodingError.dataCorruptedError(forKey: .id, in: c, debugDescription: "Pattern without id")
        }
        self.id = id
        title = c.featureString(.title) ?? id
        kind = c.featureString(.kind) ?? "weakness"
        category = c.featureString(.category) ?? "other"
        description = c.featureString(.description) ?? ""
        status = c.featureString(.status) ?? "watch"
        costRank = min(5, max(1, c.featureInt(.costRank) ?? 3))
        contexts = c.featureStrings(.contexts)
        occurrences = max(0, c.featureInt(.occurrences) ?? 0)
        let firstSeen = c.featureString(.firstSeenAt) ?? ""
        firstSeenAt = firstSeen
        lastSeenAt = c.featureString(.lastSeenAt) ?? firstSeen
        real = c.featureValue(PatternRealRounds.self, .real) ?? PatternRealRounds()
        practice = c.featureValue(PatternPracticeRounds.self, .practice) ?? PatternPracticeRounds()
        history = c.featureList(PatternHistoryEntry.self, .history)
        evidence = c.featureList(PatternEvidence.self, .evidence).filter { !$0.quote.isEmpty }
        drillHint = c.featureString(.drillHint) ?? ""
        userConfirmed = c.featureBool(.userConfirmed) ?? false
        dismissed = c.featureBool(.dismissed) ?? false
        userNote = c.featureString(.userNote)
    }

    var isWeakness: Bool { kind != "strength" }
}

struct PersonalDrillSource: Decodable {
    /// 'call' | 'pattern' | 'placement'
    let type: String
    let callId: String?
    let at: Double?
    let patternId: String?

    private enum CodingKeys: String, CodingKey { case type, callId, at, patternId }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        type = c.featureString(.type) ?? "pattern"
        callId = c.featureString(.callId)
        at = c.featureNumber(.at)
        patternId = c.featureString(.patternId)
    }
    init(type: String) { self.type = type; callId = nil; at = nil; patternId = nil }
}

struct PersonalDrill: Decodable, Identifiable {
    let id: String
    let type: String
    let title: String
    let why: String
    let goal: String
    let seedLine: String?
    let counterpartRole: String?
    let context: String
    let source: PersonalDrillSource
    let patternIds: [String]
    /// Pressure tier 1–3.
    let tier: Int
    let successCriteria: [String]
    let pushback: [String]
    let mustInclude: [String]
    let mustAvoid: [String]
    let dueAt: String?
    let attempts: Int
    /// 'new' | 'started' | 'done'
    let status: String
    let sessionId: String?
    let createdAt: String
    let completedAt: String?

    private enum CodingKeys: String, CodingKey {
        case id, type, title, why, goal, seedLine, counterpartRole, context, source, patternIds, tier, successCriteria
        case pushback, mustInclude, mustAvoid, dueAt, attempts, status, sessionId, createdAt, completedAt
    }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        guard let id = c.featureString(.id), !id.isEmpty else {
            throw DecodingError.dataCorruptedError(forKey: .id, in: c, debugDescription: "Drill without id")
        }
        self.id = id
        type = c.featureString(.type) ?? "replay"
        title = c.featureString(.title) ?? "Тренировка"
        why = c.featureString(.why) ?? ""
        goal = c.featureString(.goal) ?? ""
        seedLine = c.featureString(.seedLine)
        counterpartRole = c.featureString(.counterpartRole)
        context = c.featureString(.context) ?? "work"
        source = c.featureValue(PersonalDrillSource.self, .source) ?? PersonalDrillSource(type: "pattern")
        patternIds = c.featureStrings(.patternIds)
        tier = min(3, max(1, c.featureInt(.tier) ?? 1))
        successCriteria = c.featureStrings(.successCriteria)
        pushback = c.featureStrings(.pushback)
        mustInclude = c.featureStrings(.mustInclude)
        mustAvoid = c.featureStrings(.mustAvoid)
        dueAt = c.featureString(.dueAt)
        attempts = max(0, c.featureInt(.attempts) ?? 0)
        status = c.featureString(.status) ?? "new"
        sessionId = c.featureString(.sessionId)
        createdAt = c.featureString(.createdAt) ?? ""
        completedAt = c.featureString(.completedAt)
    }

    var isDone: Bool { status == "done" }
}

// MARK: - Response envelopes

struct CallsEnvelope: Decodable {
    let calls: [CallSummary]
    private enum CodingKeys: String, CodingKey { case calls }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        calls = c.featureList(CallSummary.self, .calls)
    }
}

struct PatternsEnvelope: Decodable {
    let patterns: [CommunicationPattern]
    private enum CodingKeys: String, CodingKey { case patterns }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        patterns = c.featureList(CommunicationPattern.self, .patterns)
    }
}

struct FactsEnvelope: Decodable {
    let profileFacts: [ProfileFact]
    private enum CodingKeys: String, CodingKey { case profileFacts }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        profileFacts = c.featureList(ProfileFact.self, .profileFacts)
    }
}

/// `PUT calls/:id/upload` → `{ received }`; also the 409 body `{ error, received }`.
struct CallUploadReceipt: Decodable {
    let received: Double?
    let error: String?
    private enum CodingKeys: String, CodingKey { case received, error }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        received = c.featureNumber(.received)
        error = c.featureString(.error)
    }
}

/// `POST tts` → `{ file }`.
struct FeatureSpeechFile: Decodable {
    let file: String
    private enum CodingKeys: String, CodingKey { case file }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        guard let file = c.featureString(.file), !file.isEmpty else {
            throw DecodingError.dataCorruptedError(forKey: .file, in: c, debugDescription: "Speech without file")
        }
        self.file = file
    }
}

/// `POST audio/transcribe` → `{ text, audioFile }` (other fields ignored).
struct FeatureTranscription: Decodable {
    let text: String
    let audioFile: String
    private enum CodingKeys: String, CodingKey { case text, audioFile }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        guard let audioFile = c.featureString(.audioFile), !audioFile.isEmpty else {
            throw DecodingError.dataCorruptedError(forKey: .audioFile, in: c, debugDescription: "Transcription without file")
        }
        self.audioFile = audioFile
        text = c.featureString(.text) ?? ""
    }
}

struct FeatureConfirmation: Decodable {
    let ok: Bool
    private enum CodingKeys: String, CodingKey { case ok }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        ok = c.featureBool(.ok) ?? false
    }
}

// MARK: - Russian labels shared by the feature screens

enum FeatureLabels {
    /// Verb-style skill names, mirroring SKILLS in lib/types.ts where the skill exists there.
    static func skill(_ id: String) -> String {
        switch id {
        case "listening": return "Понимать на слух"
        case "reading": return "Читать"
        case "grammar": return "Строить фразы"
        case "vocabulary": return "Находить слова"
        case "speaking": return "Говорить"
        case "interaction": return "Вести диалог"
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
    static func skillIcon(_ id: String) -> String {
        switch id {
        case "listening": return "ear"
        case "reading": return "text.book.closed"
        case "grammar": return "textformat.abc"
        case "vocabulary": return "character.book.closed"
        case "speaking": return "waveform"
        case "interaction": return "bubble.left.and.bubble.right"
        default: return "circle"
        }
    }
    static func section(_ id: String) -> String {
        switch id {
        case "listening": return "Аудио"
        case "reading": return "Чтение"
        case "language": return "Грамматика и слова"
        case "speaking": return "Речь"
        case "interaction": return "Рабочая сцена"
        default: return id
        }
    }
    static func sectionIcon(_ id: String) -> String {
        switch id {
        case "listening": return "headphones"
        case "reading": return "doc.text"
        case "language": return "textformat"
        case "speaking": return "mic"
        case "interaction": return "person.2.wave.2"
        default: return "circle"
        }
    }
    static func confidence(_ value: String?) -> String {
        switch value ?? "" {
        case "high": return "высокая"
        case "medium": return "средняя"
        default: return "низкая"
        }
    }
    static func callStatus(_ value: String) -> String {
        switch value {
        case "awaiting-upload": return "Загрузка не закончена"
        case "queued": return "В очереди"
        case "processing": return "Расшифровываю"
        case "needs-speaker": return "Кто есть кто?"
        case "analysing": return "Пишу разбор"
        case "ready": return "Разбор готов"
        case "error": return "Не получилось"
        default: return "Обновляется"
        }
    }
    static func callSource(_ value: String) -> String {
        switch value {
        case "audio": return "Запись"
        case "transcript": return "Транскрипт"
        case "debrief": return "Готовый разбор"
        case "memory": return "По памяти"
        default: return "Созвон"
        }
    }
    static func callSourceIcon(_ value: String) -> String {
        switch value {
        case "audio": return "waveform"
        case "transcript": return "text.alignleft"
        case "debrief": return "doc.richtext"
        case "memory": return "brain.head.profile"
        default: return "phone"
        }
    }
    static func context(_ value: String) -> String {
        switch value {
        case "work": return "Работа"
        case "life": return "Жизнь"
        case "relocation": return "Переезд"
        default: return "Другое"
        }
    }
    static func costCategory(_ value: String) -> String {
        switch value {
        case "positioning": return "Самоподача"
        case "negotiation": return "Переговоры"
        case "confidentiality": return "Конфиденциальность"
        case "structure": return "Структура"
        case "questions": return "Вопросы"
        case "closing": return "Закрытие"
        case "listening": return "Понимание"
        case "language": return "Язык"
        case "fluency": return "Беглость"
        default: return "Другое"
        }
    }
    static func costImpact(_ value: String) -> String {
        switch value {
        case "high": return "Дорого"
        case "low": return "Мелочь"
        default: return "Заметно"
        }
    }
    static func languageImpact(_ value: String) -> String {
        switch value {
        case "meaning": return "Меняет смысл"
        case "seniority": return "Звучит младше"
        default: return "Мелочь"
        }
    }
    static func patternStatus(_ value: String) -> String {
        switch value {
        case "watch": return "Наблюдаю"
        case "active": return "В работе"
        case "improving": return "Улучшается"
        case "resolved": return "Решён"
        default: return "Наблюдаю"
        }
    }
    static func patternOutcome(_ value: String) -> String {
        switch value {
        case "repeated": return "повторилось"
        case "avoided": return "удержал"
        case "improved": return "лучше, чем было"
        case "new": return "замечено впервые"
        default: return "не было повода"
        }
    }
    static func patternOutcomeSymbol(_ value: String) -> String {
        switch value {
        case "repeated", "new": return "●"
        case "avoided": return "○"
        case "improved": return "◐"
        default: return "·"
        }
    }
    static func drillType(_ value: String) -> String {
        switch value {
        case "replay": return "Переиграть момент"
        case "pitch": return "Питч"
        case "price": return "Цена"
        case "questions": return "Вопросы"
        case "closing": return "Закрытие"
        case "language": return "Язык"
        case "story": return "История"
        case "followup": return "Письмо после звонка"
        case "rapidfire": return "Быстрые вопросы"
        case "cards": return "Карточки"
        default: return "Тренировка"
        }
    }
    static func drillTypeIcon(_ value: String) -> String {
        switch value {
        case "replay": return "arrow.counterclockwise"
        case "pitch": return "megaphone"
        case "price": return "dollarsign.circle"
        case "questions": return "questionmark.bubble"
        case "closing": return "flag.checkered"
        case "language": return "textformat.abc"
        case "story": return "book"
        case "followup": return "envelope"
        case "rapidfire": return "bolt"
        case "cards": return "rectangle.on.rectangle"
        default: return "figure.run"
        }
    }
    static func factKind(_ value: String) -> String {
        switch value {
        case "rate": return "Ставки"
        case "floor": return "Минимальная цена"
        case "case": return "Кейсы"
        case "metric": return "Цифры и результаты"
        case "confidential": return "Конфиденциально"
        case "relocation": return "Переезд"
        case "counterpart": return "Собеседники"
        case "positioning": return "Самоподача"
        case "preference": return "Предпочтения"
        default: return "Другое"
        }
    }
    static func factKindIcon(_ value: String) -> String {
        switch value {
        case "rate": return "dollarsign.circle"
        case "floor": return "arrow.down.to.line"
        case "case": return "star"
        case "metric": return "chart.bar"
        case "confidential": return "lock"
        case "relocation": return "airplane"
        case "counterpart": return "person.crop.circle"
        case "positioning": return "person.text.rectangle"
        case "preference": return "heart"
        default: return "doc.text"
        }
    }
    static let factKindOrder = ["rate", "floor", "case", "metric", "positioning", "confidential", "counterpart", "relocation", "preference", "other"]
}
