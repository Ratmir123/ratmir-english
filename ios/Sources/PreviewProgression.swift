#if DEBUG
import Foundation

/// Pure synthetic visual fixtures. They never write learner data or trigger provider calls.
enum PreviewProgression {
    static func make(sessionId: String, now: String, deferred: Bool, level: Int = 2) -> [String: Any] {
        let tracks: [[String: Any]] = [
            track("life", "Обычная жизнь", "Знакомства, друзья, интересы и понятные разговоры с людьми.", current: 3, target: 12),
            track("work", "Работа и созвоны", "Питч, цена, условия, брифы, интервью и обратная связь.", current: 2, target: 12),
            track("relocation", "Переезд", "Граница, жильё, бытовые дела и правдивые ответы в новой стране.", current: 0, target: 4),
            track("ielts-foundation", "Основа для IELTS", "Короткие задания на речь, понимание, чтение и письмо.", current: 1, target: 8)
        ]
        // `first-practice` deliberately reports 6/1: the UI must cap it and show «Открыто».
        let achievements: [[String: Any]] = [
            achievement("first-practice", "Первый разговор", "Завершить одну практику с разбором.", current: 6, target: 1, at: now),
            achievement("placement-complete", "Калибровка", "Пройти тест уровня.", current: 1, target: 1, at: now),
            achievement("ten-practices", "Уже вошёл в ритм", "Завершить десять занятий с разбором.", current: 6, target: 10, at: nil),
            achievement("own-improvement", "Своими словами", "Сделать улучшенную самостоятельную попытку после разбора.", current: 0, target: 1, at: nil),
            achievement("counter-offer", "Встречная цифра", "Назвать свою цифру в ответ на низкую на реальном созвоне.", current: 0, target: 1, at: nil),
            achievement("clean-pitch", "Чистый питч", "Питч до 45 секунд с цифрой и без оговорок.", current: 0, target: 1, at: nil)
        ]
        let quality: [String: Any] = ["observedTargets": 2, "targetCount": 3, "independentSuccesses": 1, "supportedObservations": 0, "partial": 1, "difficulty": 0]
        let result: [String: Any] = ["sessionId": sessionId, "xp": deferred ? 15 : 20, "completedAt": now, "track": "life", "activity": "speaking",
            "improvedRetry": !deferred, "quality": quality,
            "evidence": [["skill": "reciprocity", "result": "success", "supported": false, "turnId": "u1", "quote": "What got you into climbing?"],
                         ["skill": "coherence", "result": "partial", "supported": false, "turnId": "u1", "quote": "I, I think climbing sounds interesting."]]]
        let xp = level >= 3 ? 210 : 120
        let recommendation: [String: Any] = ["familyId": "strategy-price", "title": "Цена и встречное предложение", "track": "work",
            "activity": "speaking", "preferredMode": "call", "drillId": NSNull(), "source": "balance",
            "why": "На прошлой неделе было больше разговоров о жизни. Сегодня — рабочий момент: не соглашаться на первую цифру."]
        return ["version": 1, "xp": xp, "level": level, "levelTitle": "В деле", "levelFloorXP": (level - 1) * 100, "nextLevelXP": level * 100,
            "xpInLevel": xp - (level - 1) * 100, "xpToNextLevel": level * 100 - xp, "completedPractice": 6, "practiceDays": 4, "practiceDayTimezone": "UTC",
            "evidenceCoverage": ["observedSkills": 3, "observableSkills": 9, "independentSuccesses": 2, "supportedObservations": 1, "partial": 1, "difficulty": 1],
            "tracks": tracks, "achievements": achievements, "recentResults": [result],
            "notice": "XP отмечает практику, а не владение языком.", "recommendation": recommendation]
    }
    private static func track(_ id: String, _ title: String, _ description: String, current: Int, target: Int) -> [String: Any] {
        let activities: [[String: Any]] = id == "ielts-foundation" ? [
            ["id": "speaking", "title": "Говорить", "completedSessions": 1, "targetSessions": 2],
            ["id": "listening", "title": "Слушать", "completedSessions": 0, "targetSessions": 2],
            ["id": "reading", "title": "Читать", "completedSessions": 0, "targetSessions": 2],
            ["id": "writing", "title": "Писать", "completedSessions": 0, "targetSessions": 2]
        ] : [["id": "speaking", "title": "Говорить", "completedSessions": current, "targetSessions": target]]
        return ["id": id, "title": title, "description": description, "completedSessions": current, "targetSessions": target, "activities": activities]
    }
    private static func achievement(_ id: String, _ title: String, _ description: String, current: Int, target: Int, at: String?) -> [String: Any] {
        ["id": id, "title": title, "description": description, "current": current, "target": target, "unlocked": at != nil, "unlockedAt": at.map { $0 as Any } ?? NSNull()]
    }
}
#endif
