#if DEBUG
import Foundation
import SwiftUI

struct PreviewAccessibility: ViewModifier {
    @ViewBuilder func body(content: Content) -> some View {
        if ProcessInfo.processInfo.arguments.contains("--large-type") { content.dynamicTypeSize(.accessibility3) }
        else { content }
    }
}

/// Synthetic screenshots only (`--preview=<screen>`). Compiled in Debug; the Release IPA has no sample data.
/// Feature screens (placement, calls, patterns) also read `FeaturePreviewFixtures`.
@MainActor enum PreviewFixtures {
    static var screen: String? { ProcessInfo.processInfo.arguments.first(where: { $0.hasPrefix("--preview=") }).map { String($0.dropFirst(10)) } }

    static let sessionID = "00000000-0000-4000-8000-000000000001"

    /// Screens that open the conversation sheet.
    static let conversationScreens: Set<String> = ["conversation", "listening", "dictation-preview", "analysing", "analysis-error",
        "review", "review-retry", "pushback", "celebrate", "saved-deferred", "preview-timing", "ielts-reading", "ielts-writing"]

    static func tab(for screen: String) -> ShellTab? {
        switch screen {
        case "practice-catalog", "practice-detail": return .practice
        case "calls", "call-review", "call-transcript", "call-speakers", "patterns", "facts": return .calls
        case "progress", "skills", "history", "achievements", "ranks", "ranks-bottom", "placement-result": return .progress
        case "profile", "settings", "reminder-editor", "reminder-denied": return .profile
        default: return nil
        }
    }

    static func install(_ client: TrainingClient) -> Bool {
        guard let screen else { return false }
        let now = ISO8601DateFormatter().string(from: Date().addingTimeInterval(-24))
        let conversation = conversationFixture(screen, now: now)
        let state = stateFixture(screen, now: now, conversation: conversation)
        client.previewMode = true
        client.state = decode(state, as: TrainingState.self)
        client.status = decode(["app": ["name": "Smooth Talk", "version": "0.5.2", "channel": "alpha"],
                                "brain": ["model": "gpt-6.1-sol", "verified": true], "audio": ["configured": true]], as: ServerStatus.self)
        client.subscriptionUsage = decode(usageFixture(), as: SubscriptionUsage.self)
        client.catalog = decode(["catalog": catalogFixture()], as: FamiliesResponse.self)?.catalog ?? []
        client.signedIn = true
        client.notificationState = "authorized"
        client.reminderEnabled = true
        if conversationScreens.contains(screen) {
            client.conversation = decode(conversation, as: Conversation.self)
            client.conversationPresented = true
            client.reviewStartedAt = Date().addingTimeInterval(-24)
        }
        if screen == "completed" || screen == "rank-up" {
            client.completionMoment = CompletionMoment(sessionId: sessionID, deferred: false, unlockedBefore: ["three-days"],
                                                       xpBefore: 100, levelBefore: 2)
        }
        if screen == "pending-recording" {
            client.hasUnuploadedRecording = true
            client.orphanedRecording = true
        }
        if screen == "conversation" {
            client.hint = "Сначала коротко отреагируй, потом спроси, что его зацепило в скалолазании."
        }
        if screen == "listening" {
            client.recording = true
            client.audioLevel = 0.48
            client.liveTranscript = "Yeah, um, I like sport too. I, I think climbing sounds really fun, and I would like to try it with you one weekend if the gym is not too busy."
            client.liveTranscriptStatus = LiveCaptionCopy.listening
        }
        if screen == "dictation-preview" { startDictation(client) }
        return true
    }

    private static func decode<T: Decodable>(_ value: [String: Any], as type: T.Type) -> T? {
        guard let data = try? JSONSerialization.data(withJSONObject: value) else { return nil }
        return try? JSONDecoder().decode(type, from: data)
    }

    private static func startDictation(_ client: TrainingClient) {
        client.recording = true
        client.audioLevel = 0.48
        let prefix = Array(repeating: "I, um, enjoy meeting people and asking about the things they care about. Sometimes I stop, think, and try again because I want to explain my idea clearly.", count: 5).joined(separator: " ")
        client.liveTranscript = prefix
        client.liveTranscriptStatus = "Синтетический предпросмотр. Микрофон и API выключены."
        Task { @MainActor [weak client] in
            let words = ["And", "right", "now", "I", "am", "watching", "the", "newest", "words", "stay", "visible", "while", "the", "older", "lines", "move", "up.", "Um,", "I", "I", "can", "pause", "and", "continue", "at", "my", "own", "pace."]
            var hypothesis = prefix
            for (index, word) in words.enumerated() {
                hypothesis += " " + word
                // Recognizer-like rhythm: mostly one word at a time, now and then a burst of three for the reveal queue.
                if index % 6 == 4 || index % 6 == 5 { continue }
                do { try await Task.sleep(for: .milliseconds(240)) } catch { return }
                guard let client, client.previewMode, client.recording else { return }
                client.liveCaptions.receive(hypothesis)
                if index == 12 {
                    // A final recognition can revise an earlier word while
                    // preserving the tail. It cross-fades in place, never replays the text.
                    hypothesis = hypothesis.replacingOccurrences(of: "the newest words", with: "the latest words")
                    client.liveCaptions.receive(hypothesis)
                }
            }
        }
    }

    // MARK: Conversation

    private static func conversationFixture(_ screen: String, now: String) -> [String: Any] {
        var value: [String: Any] = [
            "id": sessionID, "mode": "learning", "status": "active", "createdAt": now, "updatedAt": now,
            "lesson": ["title": "Планы на выходные", "goal": "Подхвати деталь ответа и задай вопрос по ней.",
                       "why": "Ты умеешь рассказывать. Сейчас учимся развивать ответ собеседника.", "minutes": 15, "context": "life",
                       "targetSkills": ["reciprocity", "initiative"]],
            "turns": [["id": "a1", "role": "assistant", "text": "I've been getting into climbing lately. There's a new gym near my place, so I might go this weekend."]],
            "retries": []
        ]
        if screen == "analysing" {
            value["status"] = "analysing"
            value["turns"] = reviewTurns()
            value["processing"] = ["stage": "evaluating", "startedAt": now, "attempt": 1]
        }
        if screen == "analysis-error" {
            value["status"] = "error"
            value["turns"] = reviewTurns()
            value["error"] = "Сервис разбора не ответил вовремя. Ответы сохранены."
        }
        if ["review", "review-retry", "pushback", "celebrate", "saved-deferred", "preview-timing"].contains(screen) {
            value["status"] = "review"
            value["turns"] = reviewTurns()
            value["analysis"] = reviewFixture()
            value["completion"] = ["canComplete": false, "needsRetry": true, "reason": "Сделай улучшенную попытку или отложи её."]
        }
        if screen == "review-retry" {
            value["retries"] = [["id": "r1", "text": "Yeah, I like sports too. I play games on weekends.", "createdAt": now,
                                 "feedback": "Вопрос о скалолазании снова потерялся. Начни с реакции на его новость.", "improved": false, "analysisVersion": 1]]
        }
        if screen == "pushback" || screen == "celebrate" {
            var improved: [String: Any] = ["id": "r1", "text": "Oh, nice. What got you into climbing?", "createdAt": now,
                                           "feedback": "Теперь ты подхватил тему и оставил собеседнику место ответить.", "improved": true, "analysisVersion": 1]
            if screen == "pushback" {
                improved["pushback"] = ["npcLine": "Honestly, I'm not sure it's for you — it's pretty intense for beginners.",
                                        "reply": NSNull(), "held": NSNull(), "feedback": NSNull(), "createdAt": now]
            }
            value["retries"] = [improved]
            value["completion"] = ["canComplete": true, "needsRetry": false]
        }
        if screen == "saved-deferred" {
            value["status"] = "completed"
            value["retryDeferred"] = true
            value["completedAt"] = now
        }
        if screen == "preview-timing" { addTiming(&value) }
        if screen == "ielts-reading" || screen == "ielts-writing" { makeTextActivity(&value, reading: screen == "ielts-reading") }
        return value
    }

    private static func reviewTurns() -> [[String: Any]] {
        [["id": "a1", "role": "assistant", "text": "There's a new climbing gym near my place."],
         ["id": "u1", "role": "user", "text": "Yeah, um, I like sport too. I play games on weekends."]]
    }

    private static func reviewFixture() -> [String: Any] {
        [
            "version": 1,
            "summary": "Ты поддержал тему, но сразу перевёл разговор на себя. Зацепись за новую деталь: собеседник только начал заниматься скалолазанием.",
            "strengths": ["Ответ понятный. Ты связал тему спорта со своим опытом."],
            "priorities": [["title": "Подхвати деталь собеседника", "turnId": "u1", "quote": "I play games on weekends.",
                            "explanation": "Собеседник рассказал о новом увлечении. Вопрос поможет узнать его лучше и продолжить тему.",
                            "example": "Oh, nice. What got you into climbing?",
                            "retryInstruction": "Ответь заново: коротко отреагируй и спроси о скалолазании."]],
            "limitations": [],
            "nextFocus": "Дальше — вопросы по деталям в рабочих разговорах.",
            "outcome": ["achieved": "partly", "what": "Разговор продолжился, но интерес к собеседнику не прозвучал."],
            "languageErrors": [["turnId": "u1", "quote": "I like sport too", "correction": "I'm into sports too", "tag": "collocation", "impact": "minor"]],
            "minorErrorsIgnored": 1,
            "patternHits": [["patternId": "talks-over-detail", "outcome": "repeated", "turnId": "u1", "quote": "I play games on weekends."]],
            "strategyMoves": [["id": "discovery", "score": 0, "quote": NSNull()], ["id": "answer-first", "score": 2, "quote": "Yeah, I like sport too."]]
        ]
    }

    private static func addTiming(_ value: inout [String: Any]) {
        let timing: [String: Any] = ["version": 1, "method": "webrtc-vad", "source": "server-audio", "audioFile": "00000000-0000-4000-8000-000000000099.wav",
            "durationSeconds": 20.0, "detectedSpeechSeconds": 14.6, "speechSpanSeconds": 18.0, "leadingSilenceSeconds": 1.0, "trailingSilenceSeconds": 1.0,
            "internalPauseSeconds": 3.0, "longestPauseSeconds": 3.0, "internalPauseCount": 1, "pauseThresholdSeconds": 0.6, "quality": "usable",
            "recognizedWords": 24, "approximateWordsPerMinute": 80.0, "transcriptEdited": false,
            "segments": [["startSeconds": 0.0, "endSeconds": 1.0, "kind": "leading-silence"], ["startSeconds": 1.0, "endSeconds": 5.0, "kind": "speech"], ["startSeconds": 5.0, "endSeconds": 8.0, "kind": "pause"], ["startSeconds": 8.0, "endSeconds": 15.0, "kind": "speech"], ["startSeconds": 15.0, "endSeconds": 15.4, "kind": "gap"], ["startSeconds": 15.4, "endSeconds": 19.0, "kind": "speech"], ["startSeconds": 19.0, "endSeconds": 20.0, "kind": "trailing-silence"]],
            "limitations": ["Синтетическая запись для проверки интерфейса. Она не попадает в профиль пользователя."]]
        var turns = (value["turns"] as? [[String: Any]]) ?? []
        if turns.count > 1 {
            turns[1]["source"] = "audio"
            turns[1]["audioFile"] = timing["audioFile"]
            turns[1]["speechTiming"] = timing
        }
        value["turns"] = turns
        var review = (value["analysis"] as? [String: Any]) ?? [:]
        review["timingFeedback"] = [["turnId": "u1", "startSeconds": 5.0, "endSeconds": 8.0, "durationSeconds": 3.0,
            "observation": "С 5,0 до 8,0 с детектор не обнаружил речь. Причина паузы неизвестна.",
            "practice": "Выдели три мысли и запиши ответ снова. Смысл важнее скорости."]]
        value["analysis"] = review
    }

    private static func makeTextActivity(_ value: inout [String: Any], reading: Bool) {
        value["lesson"] = ["title": reading ? "Прочитать и проверить" : "Небольшой аргумент",
            "goal": reading ? "Найди детали, которыми можно обосновать ответ." : "Напиши мысль, причину и пример.",
            "why": "Короткая практика одного из четырёх навыков.", "minutes": 10, "context": "life", "track": "ielts-foundation",
            "activity": reading ? "reading" : "writing",
            "material": ["type": reading ? "reading-passage" : "writing-prompt", "source": "generated",
                "text": reading ? "A neighbourhood library recently started a tool-sharing programme. Members can borrow simple equipment for home repairs. The organisers expected the service to appeal mainly to homeowners, but students have used it most often." : "Some people prefer to work alone, while others enjoy working in a team. Describe your preference and explain it with a specific example.",
                "instruction": reading ? "Explain what surprised the organisers. Which detail supports your answer?" : "Write a short paragraph with your view, a reason and a real example."]]
        value["turns"] = [["id": "a1", "role": "assistant", "text": reading ? "Read the short passage, then explain what surprised the organisers." : "Write your paragraph below."]]
    }

    // MARK: State

    private static func stateFixture(_ screen: String, now: String, conversation: [String: Any]) -> [String: Any] {
        var sessions: [[String: Any]] = []
        if conversationScreens.contains(screen) {
            sessions.append(conversation)
        } else if screen != "opening" && screen != "pending-recording" {
            var done = conversation
            done["status"] = "completed"
            done["turns"] = reviewTurns()
            done["analysis"] = reviewFixture()
            done["completedAt"] = now
            done["completion"] = ["canComplete": true, "needsRetry": false]
            sessions.append(done)
        }
        var state: [String: Any] = [
            "app": ["name": "Smooth Talk", "version": "0.5.2"],
            "profile": ["name": "Alex", "dailyMinutes": 15, "goals": "Уверенно вести созвоны с клиентами на английском.",
                        "interests": ["AI", "игры", "спорт"], "professionalContext": "CG-художник, работает с брендами.",
                        "relocation": "Переезд через месяц.", "feedback": "Прямо и по делу.", "audioRetentionDays": 30, "budgetUsd": 35],
            "sessions": sessions,
            "skills": skillsFixture(now: now),
            "xp": 120, "completed": 6,
            "audioUsage": ["usedUsd": 1.28, "estimated": true, "budgetUsd": 35, "recordedMinutes": 42.5, "spokenCharacters": 6200],
            "calls": callsFixture(now: now),
            "patterns": patternsFixture(now: now),
            "drills": screen == "today-plan" ? [] : drillsFixture(now: now),
            "profileFacts": factsFixture(now: now)
        ]
        state["progression"] = PreviewProgression.make(sessionId: sessionID, now: now, deferred: screen == "saved-deferred",
                                                       level: screen == "rank-up" ? 3 : 2)
        state["placement"] = screen == "placement" ? placementNotStarted() : placementCompleted(now: now)
        mergeFeatureFields(into: &state, screen: screen)
        return state
    }

    /// Placement and Созвоны screens show the feature fixtures, so Today signals and the feature
    /// stores read the same data.
    private static func mergeFeatureFields(into state: inout [String: Any], screen: String) {
        let placementScreen = FeaturePreviewFixtures.isPlacementScreen(screen)
        let callsScreen = FeaturePreviewFixtures.isCallsScreen(screen)
        guard placementScreen || callsScreen else { return }
        let fields = FeaturePreviewFixtures.stateFields(for: screen)
        let keys = placementScreen ? ["placement"] : ["calls", "patterns", "drills", "profileFacts"]
        for key in keys {
            if let value = fields[key] { state[key] = value }
        }
    }

    private static func skillsFixture(now: String) -> [[String: Any]] {
        [["id": "reciprocity", "state": "provisional", "independentSuccesses": 2, "transfer": false, "retention": false, "lastChecked": now,
          "examples": [["sessionId": sessionID, "quote": "What got you into climbing?", "reason": "Вопрос продолжил тему собеседника."]]],
         ["id": "coherence", "state": "supported", "independentSuccesses": 1, "transfer": true, "retention": false, "lastChecked": now, "examples": []],
         ["id": "positioning", "state": "unknown", "independentSuccesses": 0, "transfer": false, "retention": false, "lastChecked": NSNull(), "examples": []],
         ["id": "clarity", "state": "unknown", "independentSuccesses": 0, "transfer": false, "retention": false, "lastChecked": NSNull(), "examples": []]]
    }

    private static func callsFixture(now: String) -> [[String: Any]] {
        [["id": "call-1", "title": "Скрининг с агентством", "counterpart": "Nova Studio", "context": "work", "occurredAt": now,
          "createdAt": now, "updatedAt": now, "source": "audio", "status": "ready", "progress": NSNull(), "durationSeconds": 1260,
          "outcome": "Скрининг пройден, ставку назвал ниже своего пола.", "topCost": "Назвал чужой гонорар", "drillsTotal": 3, "drillsDone": 1,
          "uploadedBytes": NSNull(), "error": NSNull()],
         ["id": "call-2", "title": "Бриф с клиентом", "counterpart": "Jamie", "context": "work", "occurredAt": now,
          "createdAt": now, "updatedAt": now, "source": "audio", "status": "processing", "progress": ["stage": "Расшифровываю", "percent": 45],
          "durationSeconds": 900, "outcome": NSNull(), "topCost": NSNull(), "drillsTotal": 0, "drillsDone": 0,
          "uploadedBytes": NSNull(), "error": NSNull()]]
    }

    private static func patternsFixture(now: String) -> [[String: Any]] {
        func pattern(_ id: String, _ title: String, _ status: String, _ rank: Int, _ history: [String]) -> [String: Any] {
            ["id": id, "title": title, "kind": "weakness", "category": "positioning", "description": "Описание паттерна для предпросмотра.",
             "status": status, "costRank": rank, "contexts": ["work"], "occurrences": history.count, "firstSeenAt": now, "lastSeenAt": now,
             "real": ["opportunities": 2, "avoided": 1, "repeated": 1], "practice": ["attempts": 3, "independentSuccesses": 2, "lastAt": now],
             "history": history.map { ["source": "call", "sourceId": "call-1", "date": now, "status": $0] },
             "evidence": [], "drillHint": "Отвечай своей ставкой.", "userConfirmed": true, "dismissed": false, "userNote": NSNull()]
        }
        return [pattern("fee-disclosure", "Называешь чужой гонорар", "active", 1, ["repeated", "repeated", "avoided"]),
                pattern("beginner-framing", "Подаёшь себя новичком", "improving", 2, ["repeated", "avoided", "no-opportunity", "avoided"]),
                pattern("talks-over-detail", "Не подхватываешь деталь собеседника", "watch", 4, ["new"])]
    }

    private static func drillsFixture(now: String) -> [[String: Any]] {
        [["id": "drill-1", "type": "price", "title": "Назвать свою ставку, а не чужую",
          "why": "В созвоне с агентством ты назвал гонорар другого клиента. Сегодня — та же реплика, но с твоим диапазоном.",
          "goal": "Назвать свой диапазон и вежливо закрыть вопрос о чужих условиях.", "seedLine": "So what did your last client pay you for that?",
          "counterpartRole": "agency producer, friendly, fast", "context": "work", "source": ["type": "call", "callId": "call-1", "at": 412],
          "patternIds": ["fee-disclosure"], "tier": 2, "successCriteria": ["Назван свой диапазон", "Нет чужих цифр"],
          "pushback": ["Come on, just a ballpark?"], "mustInclude": [], "mustAvoid": ["my other client paid"], "dueAt": now, "attempts": 0,
          "status": "new", "sessionId": NSNull(), "createdAt": now, "completedAt": NSNull()],
         ["id": "drill-2", "type": "pitch", "title": "Питч без оговорок", "why": "Подаёшь себя новичком в первой минуте.",
          "goal": "30–45 секунд: роль, доказательство, текущий проект.", "seedLine": "Tell me a bit about yourself?",
          "counterpartRole": "brand manager", "context": "work", "source": ["type": "pattern", "patternId": "beginner-framing"],
          "patternIds": ["beginner-framing"], "tier": 1, "successCriteria": ["До 45 секунд", "Есть цифра или имя"], "pushback": [],
          "mustInclude": [], "mustAvoid": ["just started"], "dueAt": NSNull(), "attempts": 1, "status": "new", "sessionId": NSNull(),
          "createdAt": now, "completedAt": NSNull()]]
    }

    private static func factsFixture(now: String) -> [[String: Any]] {
        [["id": "fact-1", "kind": "rate", "text": "Агентства: от €600 в день", "quote": NSNull(), "at": NSNull(),
          "source": ["type": "manual"], "status": "accepted", "createdAt": now],
         ["id": "fact-2", "kind": "case", "text": "Свежий кейс: кампания для крупного AI-видео бренда", "quote": NSNull(), "at": NSNull(),
          "source": ["type": "call", "callId": "call-1"], "status": "suggested", "createdAt": now]]
    }

    private static func placementSections(completed: Bool) -> [[String: Any]] {
        let ids = ["listening", "reading", "language", "speaking", "interaction"]
        let titles = ["Аудио", "Чтение", "Грамматика и слова", "Речь", "Рабочая сцена"]
        var sections: [[String: Any]] = []
        for index in ids.indices {
            var section: [String: Any] = ["id": ids[index], "title": titles[index], "description": "", "planned": 6, "minutes": 5]
            section["status"] = completed ? "completed" : "pending"
            section["answered"] = completed ? 6 : 0
            section["sitting"] = index < 3 ? 1 : 2
            section["note"] = NSNull()
            sections.append(section)
        }
        return sections
    }

    private static func placementNotStarted() -> [String: Any] {
        ["version": 2, "status": "not-started", "attemptId": NSNull(), "startedAt": NSNull(), "completedAt": NSNull(),
         "remainingMinutes": 25, "sections": placementSections(completed: false), "task": NSNull(), "result": NSNull(),
         "history": [], "error": NSNull(), "retakeAvailableAt": NSNull(), "audioAvailable": true]
    }

    private static func placementCompleted(now: String) -> [String: Any] {
        func skill(_ id: String, _ label: String, _ score: Double) -> [String: Any] {
            ["id": id, "level": String(label.prefix(2)), "label": label, "score": score, "confidence": "medium",
             "basis": "8 вопросов", "note": "Хватает для рабочих созвонов.", "range": ["from": "B1", "to": "B2"],
             "answered": 8, "correct": 6]
        }
        let result: [String: Any] = [
            "version": 2, "attemptId": "attempt-1", "completedAt": now, "model": "gpt-6.1-sol", "procedureVersion": "v2.0",
            "headline": "Понимаешь лучше, чем говоришь — примерно на уровень.",
            "overall": ["level": "B1", "label": "B1+", "score": 3.5, "confidence": "medium", "summary": "Уверенный B1 с запасом в понимании."],
            "skills": [skill("listening", "B2", 4.0), skill("reading", "B1+", 3.5), skill("grammar", "B1", 3.0),
                       skill("vocabulary", "B1+", 3.5), skill("speaking", "B1", 3.0), skill("interaction", "B1+", 3.5)],
            "speaking": ["range": "B1", "accuracy": "A2", "fluency": "B1", "coherence": "B1",
                         "labels": ["range": "B1", "accuracy": "A2+", "fluency": "B1", "coherence": "B1+"],
                         "timing": NSNull(), "examples": [], "errors": [], "notes": []],
            "communication": ["strengths": ["Отвечаешь по делу"], "risks": ["Не называешь свою цифру первым"], "observations": [], "moves": []],
            "languageTargets": [], "partnerLevel": "B2",
            "priorities": [["title": "Вопросы с do/does", "why": "Звучат увереннее", "action": "Тренируй в коротких ответах"]],
            "review": [], "limitations": ["Речь оценена моделью по описаниям CEFR, не живым экзаменатором."]
        ]
        return ["version": 2, "status": "completed", "attemptId": "attempt-1", "startedAt": now, "completedAt": now,
                "remainingMinutes": 0, "sections": placementSections(completed: true), "task": NSNull(), "result": result,
                "history": [["attemptId": "attempt-1", "completedAt": now, "overall": "B1+", "score": 3.5]],
                "error": NSNull(), "retakeAvailableAt": NSNull(), "audioAvailable": true]
    }

    private static func usageFixture() -> [String: Any] {
        ["available": true, "source": "codex", "scope": "account", "checkedAt": NSNull(), "stale": false, "plan": "plus",
         "windows": [["id": "w1", "bucketId": "codex", "bucketName": "Codex", "kind": "primary", "usedPercent": 22, "remainingPercent": 78,
                      "windowDurationMins": 300, "resetsAt": NSNull()],
                     ["id": "w2", "bucketId": "codex", "bucketName": "Codex", "kind": "secondary", "usedPercent": 40, "remainingPercent": 60,
                      "windowDurationMins": 10080, "resetsAt": NSNull()]],
         "manageUrl": "https://chatgpt.com/codex/settings/usage",
         "activity": ["periodDays": 30, "requests": 18, "successful": 17, "failed": 1, "averageLatencyMs": 7400]]
    }

    private static func catalogFixture() -> [[String: Any]] {
        func family(_ id: String, _ title: String, _ description: String, _ category: String, _ context: String,
                    _ mode: String, _ sf: String, _ minutes: Int, _ isNew: Bool, _ format: String) -> [String: Any] {
            ["id": id, "title": title, "description": description, "category": category, "context": context,
             "activity": "speaking", "preferredMode": mode, "skills": ["positioning", "coherence"], "minutes": minutes,
             "icon": ["sf": sf, "phosphor": "Microphone"], "isNew": isNew, "format": format, "patternIds": []]
        }
        return [
            ["id": "strategy", "title": "Стратегия разговора", "description": "Питч, цена, границы и следующий шаг.", "families": [
                family("strategy-pitch-30", "Питч за 30 секунд", "Ответить на «расскажи о себе» за 30–45 секунд.", "strategy", "work", "call", "mic", 5, true, "pitch"),
                family("strategy-agency-screening", "Скрининг агентства", "Пройти семь стандартных вопросов агентства.", "strategy", "work", "call", "checklist", 10, true, "rapidfire"),
                family("strategy-price", "Цена и встречное предложение", "Не соглашаться сразу и торговать объёмом.", "strategy", "work", "call", "dollarsign.circle", 10, true, "conversation")]],
            ["id": "work", "title": "Работа", "description": "Проекты, интервью, правки и договорённости.", "families": [
                family("work-project", "Обсудить проект", "Понять результат, аудиторию и ограничения клиента.", "work", "work", "learning", "briefcase", 10, false, "conversation")]],
            ["id": "life", "title": "Жизнь", "description": "Знакомства, друзья, интересы и споры.", "families": [
                family("life-people", "Познакомиться", "Найти общую тему и развить мысль собеседника.", "life", "life", "learning", "person.2", 10, false, "conversation")]]
        ]
    }
}
#endif
