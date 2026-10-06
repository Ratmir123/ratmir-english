import Foundation

// «Мои фразы» (planning/v05/PASS-0.5.3.md §1): what the learner saved with «Запомнить» and how it comes back in practice.
// Field for field lib/phrases/types.ts; `PhraseSchedule` mirrors the readers of lib/phrases/schedule.ts and `PhraseLabels`
// the words of lib/phrases/labels.ts, so both clients show the same counts, lines and order. Pure: no SwiftUI, no network.
// Change both platforms together.

// MARK: - Open string values

/// `'new' | 'learning' | 'learned'`. A value this build does not know (a newer server) still decodes and simply matches
/// none of the known cases, so one phrase in a newer format never breaks the list.
struct PhraseStatus: RawRepresentable, Hashable, Codable {
    let rawValue: String
    init(rawValue: String) { self.rawValue = rawValue }
    init(from decoder: Decoder) throws { rawValue = try decoder.singleValueContainer().decode(String.self) }
    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(rawValue)
    }
    static let new = PhraseStatus(rawValue: "new")
    static let learning = PhraseStatus(rawValue: "learning")
    static let learned = PhraseStatus(rawValue: "learned")
}

/// `'desktop' | 'iphone' | 'web'`: where it was saved.
struct PhraseOrigin: RawRepresentable, Hashable, Codable {
    let rawValue: String
    init(rawValue: String) { self.rawValue = rawValue }
    init(from decoder: Decoder) throws { rawValue = try decoder.singleValueContainer().decode(String.self) }
    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(rawValue)
    }
    static let desktop = PhraseOrigin(rawValue: "desktop")
    static let iphone = PhraseOrigin(rawValue: "iphone")
    static let web = PhraseOrigin(rawValue: "web")
}

/// `'pending' | 'ready' | 'failed'`: Sol takes the phrase apart in the background.
struct PhraseEnrichment: RawRepresentable, Hashable, Codable {
    let rawValue: String
    init(rawValue: String) { self.rawValue = rawValue }
    init(from decoder: Decoder) throws { rawValue = try decoder.singleValueContainer().decode(String.self) }
    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(rawValue)
    }
    static let pending = PhraseEnrichment(rawValue: "pending")
    static let ready = PhraseEnrichment(rawValue: "ready")
    static let failed = PhraseEnrichment(rawValue: "failed")
}

/// `'used' | 'hinted' | 'missed' | 'offered'`: what one conversation meant for a phrase.
struct PhraseHistoryResult: RawRepresentable, Hashable, Codable {
    let rawValue: String
    init(rawValue: String) { self.rawValue = rawValue }
    init(from decoder: Decoder) throws { rawValue = try decoder.singleValueContainer().decode(String.self) }
    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(rawValue)
    }
    static let used = PhraseHistoryResult(rawValue: "used")
    static let hinted = PhraseHistoryResult(rawValue: "hinted")
    static let missed = PhraseHistoryResult(rawValue: "missed")
    static let offered = PhraseHistoryResult(rawValue: "offered")
}

// MARK: - Saved phrase

/// `SavedPhrase` (lib/phrases/types.ts). `id` and `text` are required; every other field falls back to the server's
/// default, so an older or newer record still shows.
struct SavedPhrase: Codable, Identifiable, Equatable {
    struct HistoryEntry: Codable, Equatable {
        var at: String
        var sessionId: String
        var result: PhraseHistoryResult

        init(at: String, sessionId: String, result: PhraseHistoryResult) {
            self.at = at
            self.sessionId = sessionId
            self.result = result
        }

        private enum CodingKeys: String, CodingKey { case at, sessionId, result }

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            result = try c.decode(PhraseHistoryResult.self, forKey: .result)
            at = ((try? c.decodeIfPresent(String.self, forKey: .at)) ?? nil) ?? ""
            sessionId = ((try? c.decodeIfPresent(String.self, forKey: .sessionId)) ?? nil) ?? ""
        }
    }

    var id: String
    /// What the learner saved, trimmed, 1–600 characters (an English expression or a Russian «как сказать …»).
    var text: String
    var origin: PhraseOrigin
    var createdAt: String
    var updatedAt: String
    var enrichment: PhraseEnrichment
    /// English target expression, e.g. "be on the same page".
    var phrase: String?
    /// Russian meaning.
    var meaning: String?
    /// Russian usage note (or, when enrichment failed, why).
    var note: String?
    /// English example sentence about the learner's own life or work.
    var example: String?
    var exampleRu: String?
    /// Russian recall cue that never contains the target words.
    var cue: String?
    /// English counterpart line that invites the expression without saying it.
    var situation: String?
    var status: PhraseStatus
    /// 0…5 on the 1-3-7-16-35-day ladder.
    var stage: Int
    /// A new phrase is due at once.
    var dueAt: String
    var lastPracticedAt: String?
    var lastOfferedAt: String?
    /// Newest first, at most 12.
    var history: [HistoryEntry]
    /// «Уже знаю»: kept in the list, never offered.
    var archived: Bool
    /// 0.5.4 «Послушать»: the line of the clip it was heard in (≤ 300 characters); nil for typed phrases and older servers.
    var heard: String?

    init(id: String, text: String, origin: PhraseOrigin = .iphone, createdAt: String = "", updatedAt: String = "",
         enrichment: PhraseEnrichment = .pending, phrase: String? = nil, meaning: String? = nil, note: String? = nil,
         example: String? = nil, exampleRu: String? = nil, cue: String? = nil, situation: String? = nil,
         status: PhraseStatus = .new, stage: Int = 0, dueAt: String = "", lastPracticedAt: String? = nil,
         lastOfferedAt: String? = nil, history: [HistoryEntry] = [], archived: Bool = false, heard: String? = nil) {
        self.id = id
        self.text = text
        self.origin = origin
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.enrichment = enrichment
        self.phrase = phrase
        self.meaning = meaning
        self.note = note
        self.example = example
        self.exampleRu = exampleRu
        self.cue = cue
        self.situation = situation
        self.status = status
        self.stage = stage
        self.dueAt = dueAt
        self.lastPracticedAt = lastPracticedAt
        self.lastOfferedAt = lastOfferedAt
        self.history = history
        self.archived = archived
        self.heard = heard
    }

    private enum CodingKeys: String, CodingKey {
        case id, text, origin, createdAt, updatedAt, enrichment, phrase, meaning, note, example, exampleRu, cue, situation
        case status, stage, dueAt, lastPracticedAt, lastOfferedAt, history, archived, heard
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        text = try c.decode(String.self, forKey: .text)
        origin = ((try? c.decodeIfPresent(PhraseOrigin.self, forKey: .origin)) ?? nil) ?? .web
        createdAt = SavedPhrase.string(c, .createdAt) ?? ""
        updatedAt = SavedPhrase.string(c, .updatedAt) ?? ""
        enrichment = ((try? c.decodeIfPresent(PhraseEnrichment.self, forKey: .enrichment)) ?? nil) ?? .pending
        phrase = SavedPhrase.string(c, .phrase)
        meaning = SavedPhrase.string(c, .meaning)
        note = SavedPhrase.string(c, .note)
        example = SavedPhrase.string(c, .example)
        exampleRu = SavedPhrase.string(c, .exampleRu)
        cue = SavedPhrase.string(c, .cue)
        situation = SavedPhrase.string(c, .situation)
        status = ((try? c.decodeIfPresent(PhraseStatus.self, forKey: .status)) ?? nil) ?? .new
        stage = min(5, max(0, LenientNumber.int(c, .stage) ?? 0))
        dueAt = SavedPhrase.string(c, .dueAt) ?? ""
        lastPracticedAt = SavedPhrase.string(c, .lastPracticedAt)
        lastOfferedAt = SavedPhrase.string(c, .lastOfferedAt)
        history = ((try? c.decodeIfPresent(TolerantList<HistoryEntry>.self, forKey: .history)) ?? nil)?.values ?? []
        archived = ((try? c.decodeIfPresent(Bool.self, forKey: .archived)) ?? nil) ?? false
        heard = SavedPhrase.string(c, .heard)
    }

    private static func string(_ c: KeyedDecodingContainer<CodingKeys>, _ key: CodingKeys) -> String? {
        (try? c.decodeIfPresent(String.self, forKey: key)) ?? nil
    }
}

/// Stored on a session when its conversation finishes (a phrase round, or a session the phrases were woven into).
struct PhraseResult: Codable, Equatable, Identifiable {
    var phraseId: String
    var phrase: String
    var meaning: String?
    var used: Bool
    /// Used, but after a hint in that turn: the schedule does not advance.
    var hinted: Bool
    /// The learner sentence that used it (≤160 characters).
    var quote: String?
    var id: String { phraseId }

    init(phraseId: String, phrase: String, meaning: String? = nil, used: Bool, hinted: Bool = false, quote: String? = nil) {
        self.phraseId = phraseId
        self.phrase = phrase
        self.meaning = meaning
        self.used = used
        self.hinted = hinted
        self.quote = quote
    }

    private enum CodingKeys: String, CodingKey { case phraseId, phrase, meaning, used, hinted, quote }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        phraseId = try c.decode(String.self, forKey: .phraseId)
        phrase = try c.decode(String.self, forKey: .phrase)
        meaning = (try? c.decodeIfPresent(String.self, forKey: .meaning)) ?? nil
        used = ((try? c.decodeIfPresent(Bool.self, forKey: .used)) ?? nil) ?? false
        hinted = ((try? c.decodeIfPresent(Bool.self, forKey: .hinted)) ?? nil) ?? false
        quote = (try? c.decodeIfPresent(String.self, forKey: .quote)) ?? nil
    }
}

extension TrainingState {
    /// «N фраз ждут повторения»: the launch motivation line, Today, Practice and the phrases sheet (web `duePhraseCount`).
    func duePhraseCount(now: Date = Date()) -> Int {
        PhraseSchedule.dueCount(phrases, now: now)
    }
}

// MARK: - Schedule readers (lib/phrases/schedule.ts)

/// ISO dates of the phrase records, parsed once: lists re-read the same strings on every render.
enum PhraseClock {
    /// What the web `time()` returns for a missing or unreadable date.
    static let epoch = Date(timeIntervalSince1970: 0)
    private static let lock = NSLock()
    nonisolated(unsafe) private static var cache: [String: Date] = [:]

    static func date(_ value: String?) -> Date {
        guard let value, !value.isEmpty else { return epoch }
        lock.lock()
        defer { lock.unlock() }
        if let known = cache[value] { return known }
        let parsed = NativeDate.parse(value) ?? epoch
        if cache.count > 4_096 { cache.removeAll(keepingCapacity: true) }
        cache[value] = parsed
        return parsed
    }
}

enum PhraseSchedule {
    /// A Unicode letter (`\p{L}` in the web rule).
    static func isLetter(_ scalar: Unicode.Scalar) -> Bool {
        switch scalar.properties.generalCategory {
        case .uppercaseLetter, .lowercaseLetter, .titlecaseLetter, .modifierLetter, .otherLetter: return true
        default: return false
        }
    }

    private static func isBasicLatin(_ scalar: Unicode.Scalar) -> Bool {
        (0x41...0x5A).contains(scalar.value) || (0x61...0x7A).contains(scalar.value)
    }

    /// Mostly Latin letters (≥ 80 %): an English text can be its own target when Sol could not enrich it.
    static func mostlyLatin(_ text: String) -> Bool {
        var letters = 0
        var latin = 0
        for scalar in text.unicodeScalars where isLetter(scalar) {
            letters += 1
            if isBasicLatin(scalar) { latin += 1 }
        }
        guard letters > 0 else { return false }
        return Double(latin) / Double(letters) >= 0.8
    }

    /// The English expression a round or a session practises, or nil when there is none yet.
    static func target(_ phrase: SavedPhrase) -> String? {
        if phrase.enrichment == .ready, let value = phrase.phrase?.trimmingCharacters(in: .whitespacesAndNewlines), !value.isEmpty {
            return value
        }
        if phrase.enrichment != .pending && mostlyLatin(phrase.text) {
            return phrase.text.trimmingCharacters(in: .whitespacesAndNewlines)
        }
        return nil
    }

    /// Can come back in practice at all: not archived, not learned, has an English target.
    static func isUsable(_ phrase: SavedPhrase) -> Bool {
        !phrase.archived && phrase.status != .learned && target(phrase) != nil
    }

    /// Waiting for practice now (new phrases are due at once).
    static func isDue(_ phrase: SavedPhrase, now: Date = Date()) -> Bool {
        isUsable(phrase) && PhraseClock.date(phrase.dueAt) <= now
    }

    /// «N ждут повторения» on Today, Practice, the phrases sheet and the launch line.
    static func dueCount(_ phrases: [SavedPhrase]?, now: Date = Date()) -> Int {
        (phrases ?? []).filter { isDue($0, now: now) }.count
    }

    /// What one round takes (server `phraseRoundCandidates`): due phrases only, the practised ones by due date first, then
    /// the new ones (ties: created, then id), at most `limit`. «Повторить · N» shows its count.
    static func roundCandidates(_ phrases: [SavedPhrase]?, now: Date = Date(), limit: Int = PhraseLabels.roundLimit) -> [SavedPhrase] {
        let due = (phrases ?? []).filter { isDue($0, now: now) }
        func ordered(_ list: [SavedPhrase]) -> [SavedPhrase] {
            list.map { (phrase: $0, due: PhraseClock.date($0.dueAt), created: PhraseClock.date($0.createdAt)) }
                .sorted { left, right in
                    if left.due != right.due { return left.due < right.due }
                    if left.created != right.created { return left.created < right.created }
                    return left.phrase.id < right.phrase.id
                }
                .map { $0.phrase }
        }
        let queue = ordered(due.filter { $0.status != .new }) + ordered(due.filter { $0.status == .new })
        return Array(queue.prefix(max(0, limit)))
    }
}

// MARK: - Words and lists (lib/phrases/labels.ts)

/// What the Practice card, the Today row and the sheet footer show (web `PhrasesOverview`).
struct PhrasesOverview: Equatable {
    struct Chip: Equatable, Identifiable {
        let id: String
        let text: String
    }
    /// Everything saved (archived included).
    var total: Int
    /// Waiting now (new ones included).
    var due: Int
    /// How many one round takes («Повторить · N»).
    var round: Int
    /// Up to three of the waiting ones, in round order.
    var chips: [Chip]
    /// When nothing waits: the nearest next practice («завтра», «через 3 дня»).
    var next: String?
}

/// A newer copy of a phrase this iPhone received (create, polling, an action) before `/api/state` caught up.
struct FreshPhrase: Equatable {
    let phrase: SavedPhrase
    let receivedAt: Date
}

enum PhraseLabels {
    /// Hidden lesson family of a phrase round (lib/server/teacher.ts `phraseLessonPlan`).
    static let roundFamily = "my-phrases"
    /// Chips on the Practice card.
    static let chipLimit = 3
    /// Phrases in one round (PHRASE_ROUND_LIMIT).
    static let roundLimit = 5
    /// PHRASE_TEXT_LIMIT, counted in UTF-16 units like the server.
    static let textLimit = 600

    // Russian plural forms (web `ruPlural`; the same rule as `RuFormat.plural`).

    /// «1 фраза», «3 фразы», «5 фраз».
    static func phraseCount(_ value: Int) -> String {
        "\(value) " + RuFormat.plural(value, "фраза", "фразы", "фраз")
    }

    /// Practice card and Today row: «3 ждут повторения», «1 ждёт повторения».
    static func waiting(_ value: Int) -> String {
        "\(value) " + RuFormat.plural(value, "ждёт", "ждут", "ждут") + " повторения"
    }

    /// With the noun (the launch line): «1 фраза ждёт повторения», «5 фраз ждут повторения».
    static func phrasesWaiting(_ value: Int) -> String {
        phraseCount(value) + " " + RuFormat.plural(value, "ждёт", "ждут", "ждут") + " повторения"
    }

    // Days.

    /// «сегодня», «завтра», «через 3 дня» by calendar days; a moment that has already come reads «сегодня».
    static func dueIn(_ at: Date, now: Date, calendar: Calendar = .current) -> String {
        if at <= now { return "сегодня" }
        let days = calendar.dateComponents([.day], from: calendar.startOfDay(for: now), to: calendar.startOfDay(for: at)).day ?? 0
        if days <= 0 { return "сегодня" }
        if days == 1 { return "завтра" }
        return "через \(days) " + RuFormat.plural(days, "день", "дня", "дней")
    }

    /// «06.10» in the calendar's time zone.
    static func shortDay(_ value: String, calendar: Calendar = .current) -> String {
        let date = PhraseClock.date(value)
        guard date != PhraseClock.epoch else { return "" }
        let formatter = DateFormatter()
        formatter.locale = RuFormat.locale
        formatter.calendar = calendar
        formatter.timeZone = calendar.timeZone
        formatter.dateFormat = "dd.MM"
        return formatter.string(from: date)
    }

    // One phrase.

    /// What a row shows first: the English expression once Sol found it, otherwise what he saved.
    static func headline(_ phrase: SavedPhrase) -> String {
        if phrase.enrichment == .ready, let value = phrase.phrase?.trimmingCharacters(in: .whitespacesAndNewlines), !value.isEmpty {
            return value
        }
        return phrase.text.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// The headline is English (bold, read with an English voice).
    static func headlineIsEnglish(_ phrase: SavedPhrase) -> Bool {
        let ready = phrase.enrichment == .ready && !(phrase.phrase?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "").isEmpty
        return ready || PhraseSchedule.mostlyLatin(phrase.text)
    }

    /// Right side of a row: «сегодня» / «завтра» / «через 3 дня» / «выучена» / «уже знаю»; nil while Sol is still working
    /// on it, or when it has no English target yet (a Russian text whose enrichment failed).
    static func dueLabel(_ phrase: SavedPhrase, now: Date = Date(), calendar: Calendar = .current) -> String? {
        if phrase.archived { return "уже знаю" }
        if phrase.status == .learned { return "выучена" }
        guard PhraseSchedule.target(phrase) != nil else { return nil }
        return dueIn(PhraseClock.date(phrase.dueAt), now: now, calendar: calendar)
    }

    /// Why Sol could not take it apart (its own note when it gave one).
    static func enrichmentProblem(_ phrase: SavedPhrase) -> String {
        let note = phrase.note?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return note.isEmpty ? "Разбор не получился." : note
    }

    static func historyLabel(_ result: PhraseHistoryResult) -> String {
        switch result {
        case .used: return "сказал в разговоре"
        case .hinted: return "сказал с подсказкой"
        case .missed: return "не прозвучала"
        case .offered: return "повода не было"
        default: return ""
        }
    }

    /// «06.10 · сказал в разговоре», «05.10 · не прозвучала».
    static func historyLine(_ entry: SavedPhrase.HistoryEntry, calendar: Calendar = .current) -> String {
        let day = shortDay(entry.at, calendar: calendar)
        let label = historyLabel(entry.result)
        if day.isEmpty { return label }
        return label.isEmpty ? day : day + " · " + label
    }

    /// English text for VoiceOver: read with an English voice inside the Russian interface.
    static func english(_ text: String) -> AttributedString {
        var value = AttributedString(text)
        value.languageIdentifier = "en"
        return value
    }

    /// 0.5.4: the clip line a «Послушать» phrase was heard in, trimmed; nil for typed phrases.
    static func heard(_ phrase: SavedPhrase) -> String? {
        guard let text = phrase.heard?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty else { return nil }
        return text
    }

    // Lists.

    /// Phrases waiting now, in the order a round takes them: practised ones by `dueAt`, then the new ones, oldest first.
    static func toRepeat(_ phrases: [SavedPhrase]?, now: Date = Date()) -> [SavedPhrase] {
        let due = (phrases ?? []).filter { PhraseSchedule.isDue($0, now: now) }
        let practised = sorted(due.filter { $0.status != .new }, descending: false) { PhraseClock.date($0.dueAt) }
        let fresh = sorted(due.filter { $0.status == .new }, descending: false) { PhraseClock.date($0.createdAt) }
        return practised + fresh
    }

    /// «Все»: everything saved, archived included, newest first.
    static func all(_ phrases: [SavedPhrase]?) -> [SavedPhrase] {
        sorted(phrases ?? [], descending: true) { PhraseClock.date($0.createdAt) }
    }

    static func overview(_ phrases: [SavedPhrase]?, now: Date = Date(), calendar: Calendar = .current) -> PhrasesOverview {
        let list = phrases ?? []
        let queue = toRepeat(list, now: now)
        var next: String?
        if queue.isEmpty {
            let upcoming = list.filter(PhraseSchedule.isUsable).map { PhraseClock.date($0.dueAt) }.filter { $0 > now }.min()
            if let upcoming { next = dueIn(upcoming, now: now, calendar: calendar) }
        }
        let chips = queue.prefix(chipLimit).map { PhrasesOverview.Chip(id: $0.id, text: PhraseSchedule.target($0) ?? headline($0)) }
        let round = PhraseSchedule.roundCandidates(list, now: now).count
        return PhrasesOverview(total: list.count, due: queue.count, round: round, chips: chips, next: next)
    }

    /// A phrase the server returned goes into the list: replaced in place (never by an older copy) or added on top.
    static func upsert(_ list: [SavedPhrase], _ phrase: SavedPhrase) -> [SavedPhrase] {
        guard let index = list.firstIndex(where: { $0.id == phrase.id }) else { return [phrase] + list }
        if PhraseClock.date(list[index].updatedAt) > PhraseClock.date(phrase.updatedAt) { return list }
        var next = list
        next[index] = phrase
        return next
    }

    /// The list the screens show: the server's phrases with the newer copies this iPhone received on top of them, minus
    /// removals. A copy the server list lacks stays until a refresh well after it arrived (then it was deleted elsewhere).
    static func merge(server: [SavedPhrase], fresh: [FreshPhrase], lastRefresh: Date?, hidden: Set<String>) -> [SavedPhrase] {
        var list = server
        for copy in fresh.sorted(by: { $0.receivedAt < $1.receivedAt }) {
            let known = list.contains { $0.id == copy.phrase.id }
            if !known, let lastRefresh, lastRefresh > copy.receivedAt.addingTimeInterval(PhraseLabels.catchUpSeconds) { continue }
            list = upsert(list, copy.phrase)
        }
        return all(list.filter { !hidden.contains($0.id) })
    }

    /// A copy the server list lacks is trusted until a refresh at least this long after it arrived.
    static let catchUpSeconds: Double = 5

    // Review block «Фразы из копилки».

    static func isRound(familyId: String?) -> Bool { familyId == roundFamily }

    /// The supports line of a live lesson in «С опорами» (lib/phrases/labels.ts `phraseSupportLine`): a round shows its Russian cues
    /// («Вспомни: …»), an ordinary session the cues of the phrases woven into it («Из твоих фраз: …»); «Как на созвоне» nothing.
    static func supportLine(familyId: String?, languageFocus: String, phraseIds: [String], mode: String) -> (label: String, text: String)? {
        guard mode == "learning", !phraseIds.isEmpty else { return nil }
        let focus = languageFocus.trimmingCharacters(in: .whitespacesAndNewlines)
        if isRound(familyId: familyId) {
            var cues = focus
            if cues.hasPrefix("Вспомни") {
                cues = String(cues.dropFirst("Вспомни".count))
                if cues.hasPrefix(":") { cues = String(cues.dropFirst()) }
            }
            cues = cues.trimmingCharacters(in: .whitespacesAndNewlines)
            if cues.hasSuffix(".") { cues = String(cues.dropLast()) }
            return cues.isEmpty ? nil : (label: "Вспомни", text: cues)
        }
        guard let marker = focus.range(of: "Из твоих фраз:", options: .backwards) else { return nil }
        let cues = focus[marker.upperBound...].trimmingCharacters(in: .whitespacesAndNewlines)
        return cues.isEmpty ? nil : (label: "Из твоих фраз", text: cues)
    }

    /// The quiet line under a phrase in the review; nil when the learner's own sentence speaks for itself.
    static func resultNote(used: Bool, hinted: Bool, round: Bool) -> String? {
        if used { return hinted ? "С подсказкой — вернётся завтра" : nil }
        return round ? "Не прозвучала — вернётся завтра" : "Повода не было"
    }

    // Capture.

    /// The text «Запомнить» sends: trimmed, 1–600 characters with at least one letter; nil when there is nothing to save.
    static func captureText(_ value: String) -> String? {
        captureProblem(value) == nil ? value.trimmingCharacters(in: .whitespacesAndNewlines) : nil
    }

    /// Why the server would refuse this text, in its own words (lib/server/phrases/service.ts `validPhraseText`), or nil.
    static func captureProblem(_ value: String) -> String? {
        let text = value.trimmingCharacters(in: .whitespacesAndNewlines)
        if text.isEmpty { return "Напиши, что запомнить." }
        if text.utf16.count > textLimit { return "Слишком длинно: до 600 символов." }
        if !text.unicodeScalars.contains(where: PhraseSchedule.isLetter) { return "Нужны слова, а не только знаки." }
        return nil
    }

    /// «Вставить» (the iPhone pastes at the end): the clipboard text joins the field with a space and is clipped so the field
    /// never exceeds `limit`. `truncated` when part of it did not fit.
    static func insert(_ current: String, _ inserted: String, limit: Int = textLimit) -> (text: String, truncated: Bool) {
        let clean = inserted.replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\r", with: "\n")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let lead = !current.isEmpty && current.last?.isWhitespace == false && !clean.isEmpty ? " " : ""
        let room = max(0, limit - current.utf16.count - lead.utf16.count)
        let piece = prefix(clean, utf16: room)
        guard !piece.isEmpty else { return (current, !clean.isEmpty) }
        return (current + lead + piece, piece.utf16.count < clean.utf16.count)
    }

    /// The longest prefix within `limit` UTF-16 units that never splits a character.
    static func prefix(_ text: String, utf16 limit: Int) -> String {
        guard text.utf16.count > limit else { return text }
        var result = ""
        var used = 0
        for character in text {
            let size = character.utf16.count
            if used + size > limit { break }
            result.append(character)
            used += size
        }
        return result
    }

    /// A stable sort on a date key (equal keys keep the incoming order, as `Array.prototype.sort` does).
    private static func sorted(_ list: [SavedPhrase], descending: Bool, by key: (SavedPhrase) -> Date) -> [SavedPhrase] {
        let keyed = list.enumerated().map { (offset: $0.offset, phrase: $0.element, key: key($0.element)) }
        return keyed.sorted { left, right in
            if left.key != right.key { return descending ? left.key > right.key : left.key < right.key }
            return left.offset < right.offset
        }.map { $0.phrase }
    }
}

// MARK: - «Послушать» (planning/v05/PASS-0.5.4.md §1)

/// `'system' | 'microphone'`: what a clip was recorded from (the iPhone always sends `microphone`).
struct ListenSource: RawRepresentable, Hashable, Codable {
    let rawValue: String
    init(rawValue: String) { self.rawValue = rawValue }
    init(from decoder: Decoder) throws { rawValue = try decoder.singleValueContainer().decode(String.self) }
    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(rawValue)
    }
    static let system = ListenSource(rawValue: "system")
    static let microphone = ListenSource(rawValue: "microphone")
}

/// `'analyzing' | 'ready' | 'failed'`. A value this build does not know (a newer server) reads as failed: the card stops
/// waiting and offers «Попробовать ещё раз» instead of polling forever.
struct ListenStatus: RawRepresentable, Hashable, Codable {
    let rawValue: String
    init(rawValue: String) { self.rawValue = rawValue }
    init(from decoder: Decoder) throws { rawValue = try decoder.singleValueContainer().decode(String.self) }
    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(rawValue)
    }
    static let analyzing = ListenStatus(rawValue: "analyzing")
    static let ready = ListenStatus(rawValue: "ready")
    static let failed = ListenStatus(rawValue: "failed")
}

/// `ListenPhrase`: an expression saved from the clip (enrichment ready at once), or the one already in the bank.
struct ListenPhrase: Codable, Equatable {
    var phrase: SavedPhrase
    /// It was already in «Мои фразы»: nothing new was saved.
    var duplicate: Bool

    init(phrase: SavedPhrase, duplicate: Bool = false) {
        self.phrase = phrase
        self.duplicate = duplicate
    }

    private enum CodingKeys: String, CodingKey { case phrase, duplicate }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        phrase = try c.decode(SavedPhrase.self, forKey: .phrase)
        duplicate = ((try? c.decodeIfPresent(Bool.self, forKey: .duplicate)) ?? nil) ?? false
    }
}

/// `ListenClip` (lib/phrases/types.ts): one «Послушать» clip, transcribed by the server and explained by Sol. `id` is
/// required; every other field falls back, so a newer or partial answer still shows.
struct ListenClip: Codable, Equatable, Identifiable {
    var id: String
    var createdAt: String
    var updatedAt: String
    var origin: PhraseOrigin
    var source: ListenSource
    /// Recording length, 1–180 s (whole seconds).
    var seconds: Int
    /// What was heard, ≤ 4000 characters (present from the first answer on).
    var transcript: String
    /// 'analyzing' while Sol explains it (poll GET /api/phrases/listen/:id), then 'ready' or 'failed'.
    var status: ListenStatus
    /// Russian: what the clip is about (≤ 300 characters).
    var gist: String?
    /// Russian points worth noticing: idioms, slang, grammar, pronunciation (≤ 4).
    var points: [String]
    /// Up to 3 expressions from the clip, in the order they were heard.
    var phrases: [ListenPhrase]
    /// Russian reason when it failed, or why nothing was saved.
    var note: String?

    init(id: String, createdAt: String = "", updatedAt: String = "", origin: PhraseOrigin = .iphone,
         source: ListenSource = .microphone, seconds: Int = 0, transcript: String = "", status: ListenStatus = .analyzing,
         gist: String? = nil, points: [String] = [], phrases: [ListenPhrase] = [], note: String? = nil) {
        self.id = id
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.origin = origin
        self.source = source
        self.seconds = seconds
        self.transcript = transcript
        self.status = status
        self.gist = gist
        self.points = points
        self.phrases = phrases
        self.note = note
    }

    private enum CodingKeys: String, CodingKey {
        case id, createdAt, updatedAt, origin, source, seconds, transcript, status, gist, points, phrases, note
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        createdAt = ListenClip.string(c, .createdAt) ?? ""
        updatedAt = ListenClip.string(c, .updatedAt) ?? ""
        origin = ((try? c.decodeIfPresent(PhraseOrigin.self, forKey: .origin)) ?? nil) ?? .iphone
        source = ((try? c.decodeIfPresent(ListenSource.self, forKey: .source)) ?? nil) ?? .microphone
        seconds = max(0, LenientNumber.int(c, .seconds) ?? 0)
        transcript = ListenClip.string(c, .transcript) ?? ""
        // A missing status is as unreadable as an unknown one: failed-safe, never polled forever.
        status = ((try? c.decodeIfPresent(ListenStatus.self, forKey: .status)) ?? nil) ?? .failed
        gist = ListenClip.string(c, .gist)
        let notes = ((try? c.decodeIfPresent(TolerantList<String>.self, forKey: .points)) ?? nil)?.values ?? []
        points = notes.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
        phrases = ((try? c.decodeIfPresent(TolerantList<ListenPhrase>.self, forKey: .phrases)) ?? nil)?.values ?? []
        note = ListenClip.string(c, .note)
    }

    private static func string(_ c: KeyedDecodingContainer<CodingKeys>, _ key: CodingKeys) -> String? {
        (try? c.decodeIfPresent(String.self, forKey: key)) ?? nil
    }

    /// Sol is still explaining it: keep polling.
    var isAnalyzing: Bool { status == .analyzing }
    var isReady: Bool { status == .ready }
    /// Failed, or a status this build does not know.
    var isFailed: Bool { !isAnalyzing && !isReady }
}

/// LISTEN_* constants of lib/phrases/types.ts plus the iPhone's own timing.
enum ListenTiming {
    /// LISTEN_MAX_SECONDS: the recorder stops by itself here.
    static let maxSeconds = 180
    /// LISTEN_MIN_SECONDS: a shorter clip is not sent.
    static let minSeconds = 2.0
    /// The pill warns ten seconds before the end (2:50).
    static let warnSeconds = 170.0
    /// LISTEN_PHRASE_LIMIT.
    static let phraseLimit = 3
    /// LISTEN_POLL_MS / LISTEN_POLL_LIMIT_MS, in seconds.
    static let pollInterval = 1.5
    static let pollLimit = 90.0
}

/// The words of the listen flow (the web capture card says the same), pure and unit-tested.
enum ListenLabels {
    static let hint = "Поднеси iPhone к звуку: видео, подкаст, разговор"
    static let tooShort = "Слишком коротко — запиши хотя бы пару секунд."
    /// TaskRecorder's own hint without the placement-only «или пропусти раздел».
    static let microphoneDenied = "Микрофон выключен для Smooth Talk. Разреши доступ в настройках iPhone."
    static let microphoneFailed = "Не получилось включить микрофон. Попробуй ещё раз."
    static let slow = "Разбираю дольше обычного — фразы появятся в «Моих фразах»."
    static let failedNote = "Не получилось разобрать. Попробуй ещё раз."
    static let nothing = "Тут нечего запомнить — попробуй кусок с речью."
    static let lost = "Запись не сохранилась. Попробуй ещё раз."

    /// The pill's time: «0:12», «2:50», «3:00» (whole seconds, never negative).
    static func clock(_ seconds: Double) -> String {
        let whole = seconds.isFinite ? max(0, Int(seconds.rounded(.down))) : 0
        let rest = whole % 60
        return "\(whole / 60):" + (rest < 10 ? "0" : "") + "\(rest)"
    }

    /// VoiceOver: «12 секунд», «1 минута 5 секунд», «3 минуты».
    static func spoken(_ seconds: Double) -> String {
        let whole = seconds.isFinite ? max(0, Int(seconds.rounded(.down))) : 0
        let minutes = whole / 60
        let rest = whole % 60
        let minutePart = "\(minutes) " + RuFormat.plural(minutes, "минута", "минуты", "минут")
        let secondPart = "\(rest) " + RuFormat.plural(rest, "секунда", "секунды", "секунд")
        if minutes == 0 { return secondPart }
        return rest == 0 ? minutePart : minutePart + " " + secondPart
    }

    /// From 2:50 the pill says it is about to stop.
    static func warns(_ elapsed: Double) -> Bool { elapsed >= ListenTiming.warnSeconds }

    /// «Через 10 с запись остановится сама.» (the seconds left to 3:00, as on the web).
    static func warning(_ elapsed: Double) -> String {
        let whole = elapsed.isFinite ? max(0, Int(elapsed.rounded(.down))) : 0
        return "Через \(max(0, ListenTiming.maxSeconds - whole)) с запись остановится сама."
    }

    /// Why a take is not sent: shorter than two seconds (nothing to transcribe).
    static func durationProblem(_ seconds: Double) -> String? {
        seconds.isFinite && seconds >= ListenTiming.minSeconds ? nil : tooShort
    }

    /// Why a failed clip has no result: the server's own note, or the default line.
    static func failure(_ clip: ListenClip) -> String {
        let note = clip.note?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return note.isEmpty ? failedNote : note
    }

    /// The line under «Послушал!» (web `listenSummary`): «Запомнил 2 фразы. Повторим в разговорах», «Эти фразы уже в
    /// копилке» when all were saved before, otherwise the server's note («Тут нечего запомнить …»).
    static func summary(_ clip: ListenClip) -> String {
        let fresh = clip.phrases.filter { !$0.duplicate }.count
        if fresh > 0 { return "Запомнил \(fresh) " + RuFormat.plural(fresh, "фразу", "фразы", "фраз") + ". Повторим в разговорах" }
        if !clip.phrases.isEmpty { return "Эти фразы уже в копилке" }
        let note = clip.note?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return note.isEmpty ? nothing : note
    }
}
