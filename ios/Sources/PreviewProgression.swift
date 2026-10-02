#if DEBUG
import Foundation

/// Pure synthetic visual fixtures. They never write learner data or trigger provider calls.
enum PreviewProgression {
    static func make(sessionId: String, now: String, deferred: Bool) -> [String: Any] {
        let tracks: [[String: Any]] = [
            track("life", "Обычная жизнь", "Знакомства, игры и понятные разговоры с людьми.", current: 3, target: 12),
            track("work", "Работа и интервью", "Проекты, решения и разговоры о своём опыте.", current: 2, target: 12),
            track("relocation", "Переезд", "Бытовые ситуации и уточнения в новой стране.", current: 0, target: 4),
            track("ielts-foundation", "Основа для IELTS", "Короткие задания на речь, понимание, чтение и письмо. Без прогноза band.", current: 1, target: 8)
        ]
        let achievements: [[String: Any]] = [
            achievement("first-practice", "Первый разговор", "Завершить одну практику с разбором.", current: 6, target: 1, at: now),
            achievement("ten-practices", "Уже вошёл в ритм", "Завершить десять занятий с разбором.", current: 6, target: 10, at: nil),
            achievement("own-improvement", "Своими словами", "Сделать улучшенную самостоятельную попытку после разбора.", current: 0, target: 1, at: nil),
            achievement("ielts-four-sides", "Попробовать четыре навыка", "По одному заданию на речь, слушание, чтение и письмо.", current: 1, target: 4, at: nil)
        ]
        let quality: [String: Any] = ["observedTargets": 2, "targetCount": 3, "independentSuccesses": 1, "supportedObservations": 0, "partial": 1, "difficulty": 0]
        let result: [String: Any] = ["sessionId": sessionId, "xp": deferred ? 15 : 20, "completedAt": now, "track": "life", "activity": "speaking", "improvedRetry": !deferred, "quality": quality,
            "evidence": [["skill": "reciprocity", "result": "success", "supported": false, "turnId": "u1", "quote": "What got you into climbing?"], ["skill": "coherence", "result": "partial", "supported": false, "turnId": "u1", "quote": "I, I think climbing sounds interesting."]]]
        return ["version": 1, "xp": 120, "level": 2, "levelTitle": "В деле", "levelFloorXP": 100, "nextLevelXP": 200, "xpInLevel": 20, "xpToNextLevel": 80, "completedPractice": 6, "practiceDays": 4, "practiceDayTimezone": "UTC",
            "evidenceCoverage": ["observedSkills": 3, "observableSkills": 7, "independentSuccesses": 2, "supportedObservations": 1, "partial": 1, "difficulty": 1], "tracks": tracks, "achievements": achievements, "recentResults": [result],
            "notice": "XP отмечает практику, а не владение языком.", "recommendation": ["familyId": "ielts-listening", "title": "IELTS: услышать детали", "track": "ielts-foundation", "activity": "listening", "preferredMode": "call", "why": "После нескольких разговоров попробуем короткое задание на понимание. Затем можно вернуться к жизни и работе."]]
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
