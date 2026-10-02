#if DEBUG
import Foundation

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
        if screen == "review" || screen == "celebrate" {
            conversation["status"] = "review"
            conversation["turns"] = [["id": "a1", "role": "assistant", "text": "There's a new climbing gym near my place."], ["id": "u1", "role": "user", "text": "Yeah, um, I like sport too. I play games on weekends."]]
            conversation["analysis"] = ["version": 1, "summary": "Ты поддержал тему, но сразу перевёл разговор на себя. Зацепись за новую деталь: собеседник только начал заниматься скалолазанием.", "strengths": ["Ответ понятный. Ты связал тему спорта со своим опытом."], "priorities": [["title": "Подхвати деталь собеседника", "turnId": "u1", "quote": "I play games on weekends.", "explanation": "Собеседник рассказал о новом увлечении. Вопрос поможет узнать его лучше и продолжить тему.", "example": "Oh, nice. What got you into climbing?", "retryInstruction": "Ответь заново: коротко отреагируй и спроси о скалолазании."]], "limitations": ["По одному ответу пока рано оценивать устойчивость навыка."]]
            conversation["completion"] = ["canComplete": false, "needsRetry": true, "reason": "Сделай улучшенную попытку или сохрани задание на потом."]
        }
        if screen == "celebrate" {
            conversation["retries"] = [
                ["text": "Oh, nice. What got you into climbing?", "feedback": "Теперь ты подхватил тему и оставил собеседнику место ответить.", "improved": true, "analysisVersion": 1],
                ["text": "Yeah, I like sports too. I play games on weekends.", "feedback": "В этой попытке вопрос снова потерялся. Предыдущая улучшенная попытка остаётся подтверждённой.", "improved": false, "analysisVersion": 1]
            ]
            conversation["completion"] = ["canComplete": true, "needsRetry": false]
        }
        var state: [String: Any] = ["profile": ["name": "Alex", "dailyMinutes": 15], "sessions": [conversation], "skills": [["id": "reciprocity", "state": "provisional", "independentSuccesses": 2, "transfer": false, "retention": false, "lastChecked": now, "examples": [["sessionId": conversation["id"]!, "quote": "What got you into climbing?", "reason": "Вопрос продолжил тему собеседника."]]], ["id": "clarity", "state": "unknown", "independentSuccesses": 0, "transfer": false, "retention": false]], "xp": 120, "completed": 6, "audioUsage": ["usedUsd": 1.28, "estimated": true, "budgetUsd": 35, "recordedMinutes": 42.5, "spokenCharacters": 6200]]
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
        if ["practice", "listening", "analysing", "review", "celebrate"].contains(screen) {
            client.conversation = decode(conversation, as: Conversation.self)
            client.conversationPresented = true
            client.reviewStartedAt = Date().addingTimeInterval(-24)
        }
        if screen == "listening" {
            client.recording = true; client.audioLevel = 0.48
            client.liveTranscript = "Yeah, um, I like sport too. I, I think climbing sounds"
            client.liveTranscriptStatus = "Живые субтитры"
        }
        return true
    }
}
#endif
