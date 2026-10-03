#if DEBUG
import Foundation
import SwiftUI

struct PreviewAccessibility: ViewModifier {
    @ViewBuilder func body(content: Content) -> some View {
        if ProcessInfo.processInfo.arguments.contains("--large-type") { content.dynamicTypeSize(.accessibility3) }
        else { content }
    }
}

/// Synthetic screenshots only. This code is excluded from the device Release IPA.
@MainActor enum PreviewFixtures {
    static var screen: String? { ProcessInfo.processInfo.arguments.first(where: { $0.hasPrefix("--preview=") }).map { String($0.dropFirst(10)) } }
    static func install(_ client: TrainingClient) -> Bool {
        guard let screen else { return false }
        let now = ISO8601DateFormatter().string(from: Date().addingTimeInterval(-24))
        var conversation: [String: Any] = [
            "id": "00000000-0000-4000-8000-000000000001", "mode": "learning", "status": "active",
            "createdAt": now, "updatedAt": now,
            "lesson": ["title": "Планы на выходные", "goal": "Подхвати деталь ответа и задай вопрос по ней.", "why": "Ты умеешь рассказывать. Сейчас учимся развивать ответ собеседника.", "minutes": 15, "context": "life"],
            "turns": [["id": "a1", "role": "assistant", "text": "I've been getting into climbing lately. There's a new gym near my place, so I might go this weekend."]],
            "retries": []
        ]
        if screen == "analysing" {
            conversation["status"] = "analysing"
            conversation["processing"] = ["stage": "evaluating", "startedAt": now, "attempt": 1]
        }
        if ["review", "celebrate", "completed", "saved-deferred", "preview-timing"].contains(screen) {
            conversation["status"] = "review"
            conversation["turns"] = [["id": "a1", "role": "assistant", "text": "There's a new climbing gym near my place."], ["id": "u1", "role": "user", "text": "Yeah, um, I like sport too. I play games on weekends."]]
            conversation["analysis"] = ["version": 1, "summary": "Ты поддержал тему, но сразу перевёл разговор на себя. Зацепись за новую деталь: собеседник только начал заниматься скалолазанием.", "strengths": ["Ответ понятный. Ты связал тему спорта со своим опытом."], "priorities": [["title": "Подхвати деталь собеседника", "turnId": "u1", "quote": "I play games on weekends.", "explanation": "Собеседник рассказал о новом увлечении. Вопрос поможет узнать его лучше и продолжить тему.", "example": "Oh, nice. What got you into climbing?", "retryInstruction": "Ответь заново: коротко отреагируй и спроси о скалолазании."]], "limitations": ["По одному ответу пока рано оценивать устойчивость навыка."]]
            conversation["completion"] = ["canComplete": false, "needsRetry": true, "reason": "Сделай улучшенную попытку или сохрани задание на потом."]
        }
        if screen == "preview-timing" {
            let timing: [String: Any] = ["version": 1, "method": "webrtc-vad", "source": "server-audio", "audioFile": "00000000-0000-4000-8000-000000000099.wav",
                "durationSeconds": 20.0, "detectedSpeechSeconds": 14.6, "speechSpanSeconds": 18.0, "leadingSilenceSeconds": 1.0, "trailingSilenceSeconds": 1.0,
                "internalPauseSeconds": 3.0, "longestPauseSeconds": 3.0, "internalPauseCount": 1, "pauseThresholdSeconds": 0.6, "quality": "usable",
                "recognizedWords": 24, "approximateWordsPerMinute": 80.0, "transcriptEdited": false,
                "segments": [["startSeconds": 0.0, "endSeconds": 1.0, "kind": "leading-silence"], ["startSeconds": 1.0, "endSeconds": 5.0, "kind": "speech"], ["startSeconds": 5.0, "endSeconds": 8.0, "kind": "pause"], ["startSeconds": 8.0, "endSeconds": 15.0, "kind": "speech"], ["startSeconds": 15.0, "endSeconds": 15.4, "kind": "gap"], ["startSeconds": 15.4, "endSeconds": 19.0, "kind": "speech"], ["startSeconds": 19.0, "endSeconds": 20.0, "kind": "trailing-silence"]],
                "limitations": ["Синтетическая запись для проверки интерфейса. Она не попадает в профиль пользователя.", "Шум и тихая речь могут изменить автоматическую разметку."]]
            var turns = conversation["turns"] as! [[String: Any]]
            turns[1]["source"] = "audio"
            turns[1]["audioFile"] = timing["audioFile"]
            turns[1]["speechTiming"] = timing
            conversation["turns"] = turns
            var review = conversation["analysis"] as! [String: Any]
            review["timingFeedback"] = [["turnId": "u1", "startSeconds": 5.0, "endSeconds": 8.0, "durationSeconds": 3.0,
                "observation": "С 5,0 до 8,0 с детектор не обнаружил речь. Причина паузы неизвестна.",
                "practice": "Выдели три мысли и запиши ответ снова. Сравни паузы и полноту ответа; смысл важнее скорости."]]
            conversation["analysis"] = review
        }
        if screen == "celebrate" || screen == "completed" {
            conversation["retries"] = [
                ["text": "Oh, nice. What got you into climbing?", "feedback": "Теперь ты подхватил тему и оставил собеседнику место ответить.", "improved": true, "analysisVersion": 1],
                ["text": "Yeah, I like sports too. I play games on weekends.", "feedback": "В этой попытке вопрос снова потерялся. Предыдущая улучшенная попытка остаётся подтверждённой.", "improved": false, "analysisVersion": 1]
            ]
            conversation["completion"] = ["canComplete": true, "needsRetry": false]
        }
        if screen == "completed" || screen == "saved-deferred" {
            conversation["status"] = "completed"
            if screen == "saved-deferred" { conversation["retryDeferred"] = true }
        }
        if screen == "ielts-reading" || screen == "ielts-writing" {
            let reading = screen == "ielts-reading"
            conversation["lesson"] = ["title": reading ? "Прочитать и проверить" : "Небольшой аргумент", "goal": reading ? "Найди детали, которыми можно обосновать ответ." : "Напиши мысль, причину и пример.", "why": "Короткая практика одного из четырёх навыков.", "minutes": 10, "context": "life", "track": "ielts-foundation", "activity": reading ? "reading" : "writing", "material": ["type": reading ? "reading-passage" : "writing-prompt", "source": "generated", "text": reading ? "A neighbourhood library recently started a tool-sharing programme. Members can borrow simple equipment for home repairs. The organisers expected the service to appeal mainly to homeowners, but students have used it most often. Volunteers now offer short demonstrations on Saturday mornings." : "Some people prefer to work alone, while others enjoy working in a team. Describe your preference and explain it with a specific example.", "instruction": reading ? "Explain what surprised the organisers. Which detail supports your answer?" : "Write a short paragraph with your view, a reason and a real example."]]
            conversation["turns"] = [["id": "a1", "role": "assistant", "text": reading ? "Read the short passage, then explain what surprised the organisers." : "Write your paragraph below. Take a moment to decide what example you want to use."]]
        }
        var state: [String: Any] = ["profile": ["name": "Alex", "dailyMinutes": 15], "sessions": [conversation], "skills": [["id": "reciprocity", "state": "provisional", "independentSuccesses": 2, "transfer": false, "retention": false, "lastChecked": now, "examples": [["sessionId": conversation["id"]!, "quote": "What got you into climbing?", "reason": "Вопрос продолжил тему собеседника."]]], ["id": "clarity", "state": "unknown", "independentSuccesses": 0, "transfer": false, "retention": false]], "xp": 120, "completed": 6, "audioUsage": ["usedUsd": 1.28, "estimated": true, "budgetUsd": 35, "recordedMinutes": 42.5, "spokenCharacters": 6200]]
        if screen == "opening" || screen == "selector-rapid" { state["sessions"] = [] }
        state["progression"] = PreviewProgression.make(sessionId: conversation["id"] as! String, now: now, deferred: screen == "saved-deferred")
        if ["intro", "baseline", "baseline-report"].contains(screen) {
            let ready = screen == "baseline-report"
            let steps: [[String: Any]] = [
                ["id": "expression", "familyId": "baseline-expression", "title": "Рассказать о себе", "focus": "Содержание, словарь и построение фраз", "minutes": 5, "status": ready || screen == "baseline" ? "ready" : "pending", "sessionId": NSNull(), "missingEvidence": NSNull()],
                ["id": "listening", "familyId": "baseline-listening", "title": "Услышать и подхватить", "focus": "Детали на слух и вопросы по ответу", "minutes": 5, "status": ready ? "ready" : "pending", "sessionId": NSNull(), "missingEvidence": NSNull()],
                ["id": "interaction", "familyId": "baseline-interaction", "title": "Разобраться вместе", "focus": "Объяснение, уточнение и логика разговора", "minutes": 7, "status": ready ? "ready" : "pending", "sessionId": NSNull(), "missingEvidence": NSNull()]
            ]
            var onboarding: [String: Any] = ["version": 1, "status": screen == "intro" ? "intro" : ready ? "ready" : "baseline", "introCompletedAt": screen == "intro" ? NSNull() : now as Any, "russianPrompt": "Друг рассказал: «Я начал заниматься скалолазанием. Попробовал новый зал рядом с домом». Как ты ответишь?", "russianControl": screen == "intro" ? NSNull() : "Звучит интересно. А что тебя в этом зацепило?" as Any, "completedStages": ready ? 3 : screen == "baseline" ? 1 : 0, "steps": steps, "report": NSNull()]
            if ready {
                onboarding["report"] = ["version": 1, "model": "gpt-6.1-sol", "createdAt": now, "provisional": true, "summary": "Ты можешь поддержать простую беседу и объяснить идею. На сложной теме мысль иногда обрывается, а детали ответа теряются.", "cefr": ["from": "B1", "to": "B2", "confidence": "low", "scope": "Короткие разговорные пробы", "reason": "Есть самостоятельное объяснение и вопрос, но мало примеров сложной аргументации."], "skills": [["skill": "reciprocity", "observation": "Ты подхватил новое увлечение собеседника и спросил о нём.", "confidence": "limited", "evidence": [["sessionId": conversation["id"]!, "turnId": "u1", "quote": "What got you into climbing?", "result": "success"]]], ["skill": "clarity", "observation": "Нужна отдельная проверка звучания речи.", "confidence": "unobserved", "evidence": []]], "languageVsCommunication": ["observation": "В русской пробе ты тоже задал вопрос по детали. В английской части он появляется реже.", "russianQuote": "А что тебя в этом зацепило?", "limitation": "Одна короткая русская проба не показывает устойчивую привычку."], "priorities": ["Уточнять одну деталь перед своей историей", "Объяснять идею с конкретным примером"], "limitations": ["Предварительный профиль по коротким пробам. Это не экзамен.", "По тексту не оцениваем произношение и темп."], "nextFocus": "Потренируем вопросы по конкретным деталям."]
            }
            state["onboarding"] = onboarding
        }
        let status: [String: Any] = ["brain": ["model": "gpt-6.1-sol", "verified": true], "audio": ["configured": true]]
        let usage: [String: Any] = ["available": false, "source": "siwc", "scope": "unknown", "stale": false, "windows": [], "manageUrl": "https://chatgpt.com/codex/settings/usage", "error": "Сервис не передаёт остаток лимита.", "activity": ["periodDays": 30, "requests": 18, "successful": 17, "failed": 1, "averageLatencyMs": 7400]]
        func decode<T: Decodable>(_ value: [String: Any], as type: T.Type) -> T? {
            guard let data = try? JSONSerialization.data(withJSONObject: value) else { return nil }
            return try? JSONDecoder().decode(type, from: data)
        }
        client.previewMode = true
        client.state = decode(state, as: TrainingState.self)
        client.status = decode(status, as: ServerStatus.self)
        client.subscriptionUsage = decode(usage, as: SubscriptionUsage.self)
        client.signedIn = true
        client.notificationState = "authorized"
        client.reminderEnabled = true
        if ["practice", "listening", "dictation-preview", "analysing", "review", "celebrate", "completed", "saved-deferred", "ielts-reading", "ielts-writing", "preview-timing"].contains(screen) {
            client.conversation = decode(conversation, as: Conversation.self)
            client.conversationPresented = true
            client.reviewStartedAt = Date().addingTimeInterval(-24)
        }
        if screen == "completed" || screen == "saved-deferred" {
            client.completionMoment = CompletionMoment(sessionId: conversation["id"] as! String, deferred: screen == "saved-deferred", baseline: false, unlockedBefore: [])
        }
        if screen == "listening" {
            client.recording = true; client.audioLevel = 0.48
            client.liveTranscript = "Yeah, um, I like sport too. I, I think climbing sounds"
            client.liveTranscriptStatus = "Живые субтитры"
        }
        if screen == "dictation-preview" {
            client.recording = true; client.audioLevel = 0.48
            let prefix = Array(repeating: "I, um, enjoy meeting people and asking about the things they care about. Sometimes I stop, think, and try again because I want to explain my idea clearly.", count: 5).joined(separator: " ")
            client.liveTranscript = prefix
            client.liveTranscriptStatus = "Синтетический предпросмотр. Микрофон и API выключены."
            Task { @MainActor [weak client] in
                let words = ["And", "right", "now", "I", "am", "watching", "the", "newest", "words", "stay", "visible", "while", "the", "older", "lines", "move", "up.", "Um,", "I", "I", "can", "pause", "and", "continue", "at", "my", "own", "pace."]
                var hypothesis = prefix
                for (index, word) in words.enumerated() {
                    do { try await Task.sleep(for: .milliseconds(240)) } catch { return }
                    guard let client, client.previewMode, client.recording else { return }
                    hypothesis += " " + word
                    client.liveTranscript = hypothesis
                    if index == 12 {
                        // A final recognition can revise an earlier word while
                        // preserving the tail. It must not replay the whole text.
                        hypothesis = hypothesis.replacingOccurrences(of: "Sometimes I stop,", with: "Sometimes I pause,")
                        client.liveTranscript = hypothesis
                    }
                }
            }
        }
        return true
    }
}
#endif
