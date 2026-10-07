import Foundation

// «Подготовка к созвону» (planning/v05/PASS-0.5.5.md §1–3): screenshots of a chat and a few words of context become a plan for
// one real call and a rehearsal with that counterpart. Field for field lib/preps/types.ts (the shared contract of the server, the
// web/PC client and this app); the words are PREP_COPY, the rules `prepTier`, `latestReminders` and `todayPrep`. Pure: no
// SwiftUI, no network. Russian coaching, English lines. Change both platforms together.

// MARK: - Open string values

/// `'reading' | 'ready' | 'failed'`. A value this build does not know (a newer server) still decodes; it reads as neither
/// reading nor ready, so nothing polls it forever.
struct PrepStatus: RawRepresentable, Hashable, Codable {
    let rawValue: String
    init(rawValue: String) { self.rawValue = rawValue }
    init(from decoder: Decoder) throws { rawValue = try decoder.singleValueContainer().decode(String.self) }
    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(rawValue)
    }
    static let reading = PrepStatus(rawValue: "reading")
    static let ready = PrepStatus(rawValue: "ready")
    static let failed = PrepStatus(rawValue: "failed")
}

/// `'web' | 'desktop' | 'ios'`: where the prep was made (this app always sends `ios`).
struct PrepOrigin: RawRepresentable, Hashable, Codable {
    let rawValue: String
    init(rawValue: String) { self.rawValue = rawValue }
    init(from decoder: Decoder) throws { rawValue = try decoder.singleValueContainer().decode(String.self) }
    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(rawValue)
    }
    static let web = PrepOrigin(rawValue: "web")
    static let desktop = PrepOrigin(rawValue: "desktop")
    static let ios = PrepOrigin(rawValue: "ios")
}

/// `'cost' | 'language' | 'pattern'`: what a rehearsal reminder is about.
struct PrepReminderKind: RawRepresentable, Hashable, Codable {
    let rawValue: String
    init(rawValue: String) { self.rawValue = rawValue }
    init(from decoder: Decoder) throws { rawValue = try decoder.singleValueContainer().decode(String.self) }
    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(rawValue)
    }
    static let cost = PrepReminderKind(rawValue: "cost")
    static let language = PrepReminderKind(rawValue: "language")
    static let pattern = PrepReminderKind(rawValue: "pattern")
}

/// Reads optional strings, arrays and numbers so that a missing, null or mistyped field never breaks a prep.
private enum PrepDecode {
    static func string<K: CodingKey>(_ c: KeyedDecodingContainer<K>, _ key: K) -> String? {
        guard let value = (try? c.decodeIfPresent(String.self, forKey: key)) ?? nil else { return nil }
        let text = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return text.isEmpty ? nil : text
    }
    static func text<K: CodingKey>(_ c: KeyedDecodingContainer<K>, _ key: K) -> String { string(c, key) ?? "" }
    static func strings<K: CodingKey>(_ c: KeyedDecodingContainer<K>, _ key: K) -> [String] {
        let values = ((try? c.decodeIfPresent(TolerantList<String>.self, forKey: key)) ?? nil)?.values ?? []
        return values.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
    }
    static func list<T: Decodable, K: CodingKey>(_ c: KeyedDecodingContainer<K>, _ key: K, _ type: T.Type) -> [T] {
        ((try? c.decodeIfPresent(TolerantList<T>.self, forKey: key)) ?? nil)?.values ?? []
    }
}

// MARK: - Parts

/// `PrepWatchout`: a past mistake likely in this call. Russian title and reason, the English line to say instead.
struct PrepWatchout: Codable, Equatable {
    var title: String
    var why: String
    var instead: String
    var patternId: String?

    init(title: String, why: String = "", instead: String = "", patternId: String? = nil) {
        self.title = title
        self.why = why
        self.instead = instead
        self.patternId = patternId
    }

    private enum CodingKeys: String, CodingKey { case title, why, instead, patternId }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        guard let title = PrepDecode.string(c, .title) else {
            throw DecodingError.dataCorruptedError(forKey: .title, in: c, debugDescription: "A watchout needs a title.")
        }
        self.title = title
        why = PrepDecode.text(c, .why)
        instead = PrepDecode.text(c, .instead)
        patternId = PrepDecode.string(c, .patternId)
    }
}

/// `PrepQuestion`: a question to ask them (English) and why it matters here (Russian).
struct PrepQuestion: Codable, Equatable {
    var en: String
    var why: String

    init(en: String, why: String = "") {
        self.en = en
        self.why = why
    }

    private enum CodingKeys: String, CodingKey { case en, why }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        guard let en = PrepDecode.string(c, .en) else {
            throw DecodingError.dataCorruptedError(forKey: .en, in: c, debugDescription: "A question needs its English line.")
        }
        self.en = en
        why = PrepDecode.text(c, .why)
    }
}

/// `PrepLines`: English key lines for this call. Empty lines are simply not shown.
struct PrepLines: Codable, Equatable {
    var opening: String
    var pitch: String
    var close: String

    init(opening: String = "", pitch: String = "", close: String = "") {
        self.opening = opening
        self.pitch = pitch
        self.close = close
    }

    private enum CodingKeys: String, CodingKey { case opening, pitch, close }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        opening = PrepDecode.text(c, .opening)
        pitch = PrepDecode.text(c, .pitch)
        close = PrepDecode.text(c, .close)
    }

    var isEmpty: Bool { opening.isEmpty && pitch.isEmpty && close.isEmpty }
}

/// `PrepPrice`: Russian anchor and floor with numbers, English lines to say them and to answer a low offer, a Russian note.
struct PrepPrice: Codable, Equatable {
    var anchor: String
    var floor: String
    var say: String
    var ifLow: String
    var notes: String?

    init(anchor: String = "", floor: String = "", say: String = "", ifLow: String = "", notes: String? = nil) {
        self.anchor = anchor
        self.floor = floor
        self.say = say
        self.ifLow = ifLow
        self.notes = notes
    }

    private enum CodingKeys: String, CodingKey { case anchor, floor, say, ifLow, notes }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        anchor = PrepDecode.text(c, .anchor)
        floor = PrepDecode.text(c, .floor)
        say = PrepDecode.text(c, .say)
        ifLow = PrepDecode.text(c, .ifLow)
        notes = PrepDecode.string(c, .notes)
    }

    var isEmpty: Bool { anchor.isEmpty && floor.isEmpty && say.isEmpty && ifLow.isEmpty && notes == nil }
}

/// `PrepReminder`: one thing the rehearsal showed: what he said and what to say in the real call.
struct PrepReminder: Codable, Equatable {
    var kind: PrepReminderKind
    var title: String
    var said: String?
    var better: String?

    init(kind: PrepReminderKind, title: String, said: String? = nil, better: String? = nil) {
        self.kind = kind
        self.title = title
        self.said = said
        self.better = better
    }

    private enum CodingKeys: String, CodingKey { case kind, title, said, better }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        guard let title = PrepDecode.string(c, .title) else {
            throw DecodingError.dataCorruptedError(forKey: .title, in: c, debugDescription: "A reminder needs a title.")
        }
        self.title = title
        kind = ((try? c.decodeIfPresent(PrepReminderKind.self, forKey: .kind)) ?? nil) ?? .pattern
        said = PrepDecode.string(c, .said)
        better = PrepDecode.string(c, .better)
    }
}

/// `PrepRehearsal`: one rehearsal session of the prep (oldest first in `CallPrep.rehearsals`).
struct PrepRehearsal: Codable, Equatable, Identifiable {
    var sessionId: String
    var createdAt: String
    /// Pressure 1–3: the first rehearsal is firm (2), every next one tough (3).
    var tier: Int
    /// `'learning' | 'call'`.
    var mode: String
    /// The session's status: `active | analysing | review | completed | error | deleted`.
    var status: String
    /// Filled once the rehearsal has a review: at most `PrepLimits.reminderLimit`, most expensive first.
    var remember: [PrepReminder]
    var id: String { sessionId }

    init(sessionId: String, createdAt: String = "", tier: Int = 2, mode: String = "call", status: String = "active",
         remember: [PrepReminder] = []) {
        self.sessionId = sessionId
        self.createdAt = createdAt
        self.tier = tier
        self.mode = mode
        self.status = status
        self.remember = remember
    }

    private enum CodingKeys: String, CodingKey { case sessionId, createdAt, tier, mode, status, remember }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        sessionId = try c.decode(String.self, forKey: .sessionId)
        createdAt = PrepDecode.text(c, .createdAt)
        tier = min(3, max(1, LenientNumber.int(c, .tier) ?? 2))
        mode = PrepDecode.string(c, .mode) ?? "call"
        status = PrepDecode.string(c, .status) ?? "active"
        remember = PrepDecode.list(c, .remember, PrepReminder.self)
    }
}

/// `CallPrep.input`: what the learner sent. Screenshots themselves are never returned.
struct PrepInput: Codable, Equatable {
    var images: Int
    var text: String?
    var goal: String?
    var callAt: String?
    var origin: PrepOrigin

    init(images: Int = 0, text: String? = nil, goal: String? = nil, callAt: String? = nil, origin: PrepOrigin = .ios) {
        self.images = images
        self.text = text
        self.goal = goal
        self.callAt = callAt
        self.origin = origin
    }

    private enum CodingKeys: String, CodingKey { case images, text, goal, callAt, origin }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        images = max(0, LenientNumber.int(c, .images) ?? 0)
        text = PrepDecode.string(c, .text)
        goal = PrepDecode.string(c, .goal)
        callAt = PrepDecode.string(c, .callAt)
        origin = ((try? c.decodeIfPresent(PrepOrigin.self, forKey: .origin)) ?? nil) ?? .web
    }
}

// MARK: - Prep

/// `CallPrep` (lib/preps/types.ts). `id` is required; every other field falls back, so an older, newer or partial answer
/// (a prep still `reading` has no plan yet) always shows.
struct CallPrep: Codable, Equatable, Identifiable {
    var id: String
    var createdAt: String
    var updatedAt: String
    var status: PrepStatus
    var input: PrepInput
    /// Russian short title, e.g. «Фильм к запуску приложения».
    var title: String?
    /// Who will be on the call, e.g. «Alex, co-founder, Northwind».
    var counterpart: String?
    /// Russian: the call time in the learner's local time when it is known.
    var when: String?
    /// Russian: who they are and what they want (2–3 sentences).
    var situation: String?
    /// Russian: what success on this call means, with the minimum.
    var goal: String?
    var watchouts: [PrepWatchout]
    var questions: [PrepQuestion]
    var lines: PrepLines?
    var price: PrepPrice?
    /// Russian: what not to say on this call.
    var avoid: [String]
    /// Russian: risks to close before working (payment, rights, claims).
    var risks: [String]
    /// Russian: what could not be read or is unknown.
    var limitations: [String]
    /// Russian status note (why reading failed).
    var note: String?
    /// Oldest first.
    var rehearsals: [PrepRehearsal]

    init(id: String, createdAt: String = "", updatedAt: String = "", status: PrepStatus = .reading, input: PrepInput = PrepInput(),
         title: String? = nil, counterpart: String? = nil, when: String? = nil, situation: String? = nil, goal: String? = nil,
         watchouts: [PrepWatchout] = [], questions: [PrepQuestion] = [], lines: PrepLines? = nil, price: PrepPrice? = nil,
         avoid: [String] = [], risks: [String] = [], limitations: [String] = [], note: String? = nil,
         rehearsals: [PrepRehearsal] = []) {
        self.id = id
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.status = status
        self.input = input
        self.title = title
        self.counterpart = counterpart
        self.when = when
        self.situation = situation
        self.goal = goal
        self.watchouts = watchouts
        self.questions = questions
        self.lines = lines
        self.price = price
        self.avoid = avoid
        self.risks = risks
        self.limitations = limitations
        self.note = note
        self.rehearsals = rehearsals
    }

    private enum CodingKeys: String, CodingKey {
        case id, createdAt, updatedAt, status, input, title, counterpart, when, situation, goal, watchouts, questions, lines, price
        case avoid, risks, limitations, note, rehearsals
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        createdAt = PrepDecode.text(c, .createdAt)
        updatedAt = PrepDecode.text(c, .updatedAt)
        // A missing status is as unreadable as an unknown one: never polled forever.
        status = ((try? c.decodeIfPresent(PrepStatus.self, forKey: .status)) ?? nil) ?? .failed
        input = ((try? c.decodeIfPresent(PrepInput.self, forKey: .input)) ?? nil) ?? PrepInput(origin: .web)
        title = PrepDecode.string(c, .title)
        counterpart = PrepDecode.string(c, .counterpart)
        when = PrepDecode.string(c, .when)
        situation = PrepDecode.string(c, .situation)
        goal = PrepDecode.string(c, .goal)
        watchouts = PrepDecode.list(c, .watchouts, PrepWatchout.self)
        questions = PrepDecode.list(c, .questions, PrepQuestion.self)
        lines = ((try? c.decodeIfPresent(PrepLines.self, forKey: .lines)) ?? nil).flatMap { $0.isEmpty ? nil : $0 }
        price = ((try? c.decodeIfPresent(PrepPrice.self, forKey: .price)) ?? nil).flatMap { $0.isEmpty ? nil : $0 }
        avoid = PrepDecode.strings(c, .avoid)
        risks = PrepDecode.strings(c, .risks)
        limitations = PrepDecode.strings(c, .limitations)
        note = PrepDecode.string(c, .note)
        rehearsals = PrepDecode.list(c, .rehearsals, PrepRehearsal.self)
    }

    /// Sol is still reading the chat: keep polling.
    var isReading: Bool { status == .reading }
    var isReady: Bool { status == .ready }
    /// Failed, or a status this build does not know.
    var isFailed: Bool { !isReading && !isReady }
}

// MARK: - Constants (PREP_* of lib/preps/types.ts)

enum PrepLimits {
    /// PREP_MAX_IMAGES.
    static let maxImages = 8
    /// PREP_MAX_IMAGE_BYTES / PREP_MAX_TOTAL_BYTES.
    static let maxImageBytes = 8 * 1024 * 1024
    static let maxTotalBytes = 32 * 1024 * 1024
    /// PREP_IMAGE_LONG_SIDE: the long side of a screenshot is scaled down to this before upload.
    static let imageLongSide = 2048
    /// JPEG quality of an uploaded screenshot (or PNG when that is smaller).
    static let jpegQuality = 0.86
    /// PREP_TEXT_LIMIT / PREP_GOAL_LIMIT, counted in UTF-16 units like the server.
    static let textLimit = 6000
    static let goalLimit = 600
    /// PREP_MIN_TEXT: without screenshots the text must say at least this much.
    static let minText = 20
    /// PREP_POLL_MS / PREP_POLL_LIMIT_MS, in seconds.
    static let pollInterval = 2.0
    static let pollLimit = 240.0
    /// PREP_DAILY_LIMIT.
    static let dailyLimit = 20
    /// PREP_REMINDER_LIMIT.
    static let reminderLimit = 5
    /// PREP_TODAY_WINDOW_MS, in seconds.
    static let todayWindow: TimeInterval = 24 * 60 * 60
    /// A call that started less than an hour ago still counts as «today» (`todayPrep`).
    static let callGrace: TimeInterval = 60 * 60
    /// PREP_FAMILY_ID: the hidden family of rehearsal sessions.
    static let familyId = "call-prep"
    /// «Ещё немного…» replaces «Читаю переписку…» after this long.
    static let slowAfter = 25.0
}

/// PREP_COPY, word for word (the web shows the same strings).
enum PrepCopy {
    static let entryTitle = "Скоро созвон?"
    static let entryText = "Закинь переписку — соберу план и репетицию под этот проект за 15 минут."
    static let entryAction = "Подготовиться"
    static let sheetTitle = "Подготовка к созвону"
    static let images = "Скриншоты переписки"
    static let imagesHint = "Перетащи, вставь или выбери до 8 скриншотов."
    static let text = "Что ещё важно"
    static let textPlaceholder = "Их сайт, кто будет на звонке, что уже обсуждали, в чём сомневаешься"
    static let goal = "Чего хочешь от звонка"
    static let goalPlaceholder = "Например: рекламный фильм, не ниже $1 500"
    static let callAt = "Когда созвон"
    static let submit = "Подготовить"
    static let reading = "Читаю переписку…"
    static let readingSlow = "Ещё немного: собираю план под твои прошлые созвоны."
    static let failed = "Не получилось подготовиться. Попробуй ещё раз."
    static let empty = "Добавь скриншоты переписки или пару фраз о созвоне."
    static let remember = "Перед звонком помни"
    static let situation = "О чём звонок"
    static let goalTitle = "Цель"
    static let watchouts = "Твои ловушки"
    static let instead = "Скажи вместо:"
    static let questions = "Спроси их"
    static let lines = "Ключевые фразы"
    static let opening = "Начало"
    static let pitch = "Питч"
    static let close = "Закрытие"
    static let price = "Цена"
    static let anchor = "Называешь"
    static let floor = "Пол"
    static let say = "Как сказать"
    static let ifLow = "Если давят"
    static let avoid = "Не говори"
    static let risks = "Риски"
    static let rehearse = "Репетиция · ~10 мин"
    static let rehearseAgain = "Ещё раз, жёстче"
    static let delete = "Удалить подготовку"
    static let list = "Подготовки"
    static let todayTitle = "Созвон"
    static let backToPrep = "К подготовке"
    static let rehearsalOf = "Репетиция созвона"
}

// MARK: - Rules (lib/preps/types.ts)

enum PrepRules {
    /// `prepTier`: the first rehearsal is firm (2), every next one tough (3).
    static func tier(rehearsals: Int) -> Int { rehearsals > 0 ? 3 : 2 }

    /// `latestReminders`: the latest rehearsal that already has reminders, or nil.
    static func latestReminders(_ prep: CallPrep) -> PrepRehearsal? {
        prep.rehearsals.last { !$0.remember.isEmpty }
    }

    /// `todayPrep`: the newest ready prep created within a day or whose call time is still ahead (a call that began less than
    /// an hour ago counts too). `preps` come newest first, as the server sends them.
    static func todayPrep(_ preps: [CallPrep]?, now: Date = Date()) -> CallPrep? {
        for prep in preps ?? [] where prep.status == .ready {
            if let call = prep.input.callAt.flatMap(NativeDate.parse) {
                if call > now.addingTimeInterval(-PrepLimits.callGrace) { return prep }
            } else if let created = NativeDate.parse(prep.createdAt), now.timeIntervalSince(created) < PrepLimits.todayWindow {
                return prep
            }
        }
        return nil
    }
}

// MARK: - Words

/// What the screens say about a prep, pure and unit-tested.
enum PrepLabels {
    /// The prep's own title, or «Подготовка к созвону» while Sol is still reading.
    static func title(_ prep: CallPrep) -> String { prep.title ?? PrepCopy.sheetTitle }

    /// The server's «when», or the call time he entered («9 окт., 18:00») when Sol could not word it.
    static func when(_ prep: CallPrep) -> String? {
        if let when = prep.when { return when }
        guard let call = prep.input.callAt.flatMap(NativeDate.parse) else { return nil }
        return RuFormat.dayTime(call)
    }

    /// «Alex Moreno, co-founder · завтра в 18:00»: the row and Today line under the title.
    static func subtitle(_ prep: CallPrep) -> String {
        [prep.counterpart, when(prep)].compactMap { $0 }.joined(separator: " · ")
    }

    /// «Созвон · Фильм к запуску приложения» (Today, web `TodayPrep`).
    static func todayTitle(_ prep: CallPrep) -> String {
        PrepCopy.todayTitle + " · " + title(prep)
    }

    /// A row of «Подготовки»: the prep's title, «Читаю переписку…» while Sol reads, otherwise «Подготовка к созвону».
    static func rowTitle(_ prep: CallPrep) -> String {
        prep.title ?? (prep.isReading ? PrepCopy.reading : PrepCopy.sheetTitle)
    }

    /// Under a row: «Alex Moreno, co-founder · завтра в 18:00», the day it was made when the call time is unknown.
    static func rowMeta(_ prep: CallPrep) -> String {
        [prep.counterpart, prep.when ?? day(prep.createdAt)].compactMap { $0 }.joined(separator: " · ")
    }

    /// The status chip of a row (it changes, so it is a chip, DESIGN-PASS 0.5.1): «Читаю», «Не вышло», «Репетиция была»
    /// once a rehearsal left reminders, otherwise «Готово».
    static func status(_ prep: CallPrep) -> String {
        if prep.isReading { return "Читаю" }
        if prep.isFailed { return "Не вышло" }
        return PrepRules.latestReminders(prep) == nil ? "Готово" : "Репетиция была"
    }

    /// Why reading failed: the server's note (the panel shows PREP_COPY.failed over it).
    static func failure(_ prep: CallPrep) -> String? { prep.note }

    /// «Репетиция · ~10 мин» before the first rehearsal, «Ещё раз, жёстче» after it.
    static func rehearseTitle(_ prep: CallPrep) -> String {
        prep.rehearsals.isEmpty ? PrepCopy.rehearse : PrepCopy.rehearseAgain
    }

    /// What the partner will do at this pressure (under the rehearsal button, web `TIER_NOTE`).
    static func tierNote(_ tier: Int) -> String {
        tier >= 3 ? "Собеседник жёсткий: давит до конкретного довода." : "Собеседник один раз упрётся в цене или условиях."
    }

    /// The small note under the rehearsal button: the mode hint, then what the partner will do (web `MODE_HINT` + `TIER_NOTE`).
    static func rehearseNote(mode: String, rehearsals: Int) -> String {
        let hint = mode == "learning"
            ? "Подсказки под рукой, собеседник говорит проще — удобно пробовать новое."
            : "Без подсказок и поблажек, в темпе настоящего созвона."
        return hint + " " + tierNote(PrepRules.tier(rehearsals: rehearsals))
    }

    /// Under «Читаю переписку…»: what Sol has to read (web reading state).
    static func readingDetail(images: Int) -> String {
        (images > 0 ? "Скриншотов: \(images). " : "Читаю твою заметку. ") + "Сверяю с твоими прошлыми созвонами, ставками и ошибками."
    }

    /// The line over a rehearsal review, after «Репетиция созвона» (web `review-prep`).
    static let reviewNote = "главное на звонок собрано в подготовке, сверху."

    /// Under «Перед звонком помни»: «Репетиция 7 окт.».
    static func rememberHint(_ rehearsal: PrepRehearsal) -> String? {
        day(rehearsal.createdAt).map { "Репетиция " + $0 }
    }

    /// «Ключевые фразы» in their order (Начало, Питч, Закрытие), the empty ones left out.
    static func keyLines(_ lines: PrepLines) -> [(label: String, line: String, slot: String)] {
        [(label: PrepCopy.opening, line: lines.opening, slot: "opening"), (label: PrepCopy.pitch, line: lines.pitch, slot: "pitch"),
         (label: PrepCopy.close, line: lines.close, slot: "close")].filter { !$0.line.isEmpty }
    }

    /// One rehearsal row: «1. 7 окт. · Как на созвоне · давление 2 из 3».
    static func rehearsalTitle(_ rehearsal: PrepRehearsal, number: Int) -> String {
        let mode = rehearsal.mode == "learning" ? "С опорами" : "Как на созвоне"
        let parts = [day(rehearsal.createdAt), mode, "давление \(rehearsal.tier) из 3"].compactMap { $0 }
        return "\(number). " + parts.joined(separator: " · ")
    }

    /// A rehearsal opens its session (and review) unless it was deleted or is still being analysed.
    static func canOpen(_ rehearsal: PrepRehearsal) -> Bool { rehearsal.status != "deleted" && rehearsal.status != "analysing" }

    /// The session status of a rehearsal (web: «удалена», «разбираю…», otherwise the lesson words).
    static func rehearsalStatus(_ status: String) -> String {
        switch status {
        case "deleted": return "удалена"
        case "analysing": return "разбираю…"
        case "active": return "Можно продолжить"
        case "review": return "Разбор готов"
        case "completed": return "Завершено"
        case "error": return "Разбор не получился"
        default: return ""
        }
    }

    /// «7 окт.» in the learner's zone; nil for a missing or unreadable date.
    static func day(_ iso: String?) -> String? {
        guard let iso, let date = NativeDate.parse(iso) else { return nil }
        return RuFormat.day(date)
    }

    /// A stroke symbol per reminder kind.
    static func reminderSymbol(_ kind: PrepReminderKind) -> String {
        switch kind {
        case .cost: return "dollarsign.circle"
        case .language: return "textformat"
        case .pattern: return "arrow.counterclockwise"
        default: return "lightbulb"
        }
    }

    /// «Подготовить» is possible with at least one screenshot or 20 characters of text (PREP_MIN_TEXT, UTF-16 like the server).
    static func canSubmit(images: Int, text: String) -> Bool {
        images > 0 || text.trimmingCharacters(in: .whitespacesAndNewlines).utf16.count >= PrepLimits.minText
    }

    /// PREP_COPY.empty while there is nothing to prepare from, otherwise nil.
    static func submitProblem(images: Int, text: String) -> String? {
        canSubmit(images: images, text: text) ? nil : PrepCopy.empty
    }

    /// «3 скриншота».
    static func screenshots(_ count: Int) -> String {
        "\(count) " + RuFormat.plural(count, "скриншот", "скриншота", "скриншотов")
    }

    /// English text for VoiceOver: read with an English voice inside the Russian interface.
    static func english(_ text: String) -> AttributedString {
        var value = AttributedString(text)
        value.languageIdentifier = "en"
        return value
    }

    // Lists.

    /// The list the screens show: the server's preps with the newer copies this iPhone received on top of them, minus removals,
    /// newest first. A copy the server list lacks stays until a refresh well after it arrived (the same rule as «Мои фразы»).
    static func merge(server: [CallPrep], fresh: [FreshPrep], lastRefresh: Date?, hidden: Set<String>) -> [CallPrep] {
        var list = server
        for copy in fresh.sorted(by: { $0.receivedAt < $1.receivedAt }) {
            let known = list.contains { $0.id == copy.prep.id }
            if !known, let lastRefresh, lastRefresh > copy.receivedAt.addingTimeInterval(catchUpSeconds) { continue }
            list = upsert(list, copy.prep)
        }
        let visible = list.filter { !hidden.contains($0.id) }
        let keyed = visible.enumerated().map { (offset: $0.offset, prep: $0.element, created: PhraseClock.date($0.element.createdAt)) }
        return keyed.sorted { left, right in
            if left.created != right.created { return left.created > right.created }
            return left.offset < right.offset
        }.map { $0.prep }
    }

    /// A prep the server returned replaces the listed one in place (never by an older copy) or joins the list.
    static func upsert(_ list: [CallPrep], _ prep: CallPrep) -> [CallPrep] {
        guard let index = list.firstIndex(where: { $0.id == prep.id }) else { return [prep] + list }
        if PhraseClock.date(list[index].updatedAt) > PhraseClock.date(prep.updatedAt) { return list }
        var next = list
        next[index] = prep
        return next
    }

    /// A copy the server list lacks is trusted until a refresh at least this long after it arrived.
    static let catchUpSeconds: Double = 5
}

/// A newer copy of a prep this iPhone received (create, polling, retry, the list) before `/api/state` caught up.
struct FreshPrep: Equatable {
    let prep: CallPrep
    let receivedAt: Date
}
