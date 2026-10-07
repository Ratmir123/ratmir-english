#if DEBUG
import Foundation
import UIKit

/// Synthetic, fully fictional data for the «Подготовка к созвону» screenshots (PASS-0.5.5 §4): an invented startup and an invented
/// yoga studio; every name, line and number is made up. Compiled only in Debug; the Release IPA has no sample data.
@MainActor enum PrepPreview {
    /// `--preview=<name>` screens that carry preps in their state.
    static let screens: Set<String> = ["calls-prep", "prep-sheet", "prep-sheet-images", "prep-reading", "prep-detail",
                                       "prep-detail-fresh", "prep-detail-bottom", "today-prep", "prep-review"]
    /// The ones on «Созвоны» (its fixture calls, patterns and playbook load too).
    static let callsScreens: Set<String> = ["calls-prep", "prep-sheet", "prep-sheet-images", "prep-reading", "prep-detail",
                                            "prep-detail-fresh", "prep-detail-bottom"]

    static let launchID = "preview-prep-launch"
    static let studioID = "preview-prep-studio"
    static let readingID = "preview-prep-reading"

    static func opensSheet(_ screen: String?) -> Bool { screen == "prep-sheet" || screen == "prep-sheet-images" }

    /// Where «Созвоны» navigates on launch for a prep screen.
    static func initialRoute(_ screen: String?) -> CallsRoute? {
        switch screen ?? "" {
        case "prep-detail", "prep-detail-bottom": return .prep(launchID)
        case "prep-detail-fresh": return .prep(studioID)
        case "prep-reading": return .prep(readingID)
        default: return nil
        }
    }

    /// `prep-sheet-images`: two chat screenshots, a note, the goal and a call time.
    static func fill(_ draft: PrepDraft, screen: String?) {
        guard screen == "prep-sheet-images" else { return }
        draft.preview(shots: [shot(1), shot(2)],
                      text: "Их сайт northwind.example. На звонке будет Алекс, сооснователь. Бюджет пока не называли.",
                      goal: "Фильм к запуску и три коротких версии, не ниже $2 600",
                      callAt: PrepDraft.nextHour(Date().addingTimeInterval(20 * 3_600)))
    }

    // MARK: State

    private static func at(_ hours: Double) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: Date().addingTimeInterval(hours * 3_600))
    }

    /// `TrainingState.preps`, newest first: one Sol is reading, a launch film with a reviewed rehearsal and a call tomorrow,
    /// and a yoga studio made yesterday without a rehearsal.
    static func preps() -> [[String: Any]] {
        [reading(), launch(), studio()]
    }

    private static func reading() -> [String: Any] {
        ["id": readingID, "createdAt": at(-0.01), "updatedAt": at(-0.01), "status": "reading",
         "input": ["images": 2, "text": NSNull(), "goal": "Понять бюджет и сроки", "callAt": NSNull(), "origin": "ios"],
         "title": NSNull(), "counterpart": NSNull(), "when": NSNull(), "situation": NSNull(), "goal": NSNull(),
         "watchouts": [Any](), "questions": [Any](), "lines": NSNull(), "price": NSNull(), "avoid": [Any](), "risks": [Any](),
         "limitations": [Any](), "note": NSNull(), "rehearsals": [Any]()]
    }

    private static func launch() -> [String: Any] {
        let watchouts: [[String: Any]] = [
            ["title": "Называешь цену раньше, чем понял объём",
             "why": "В прошлых созвонах ты отвечал цифрой на первый же вопрос о бюджете, а объём потом рос.",
             "instead": "Before I give you a number, can I ask how many versions you need and where they'll run?",
             "patternId": "price-too-early"],
            ["title": "Подаёшь себя новичком",
             "why": "«I just started doing this» звучит как просьба о скидке. Здесь сильнее свежий запуск, который ты уже сделал.",
             "instead": "Last month I made the launch film for a fitness app — it's very close to what you need.",
             "patternId": "beginner-framing"],
            ["title": "Соглашаешься на правки без лимита",
             "why": "Стартапы часто просят «ещё чуть-чуть». Договорись о двух кругах правок заранее.",
             "instead": "The price includes two rounds of revisions; anything beyond that I'd quote separately.",
             "patternId": NSNull()],
        ]
        let questions: [[String: Any]] = [
            ["en": "Who will sign off on the final cut?", "why": "Если решает не Алекс, правок будет больше — заложи это в цену."],
            ["en": "Where will the film run first: the store page, social or ads?", "why": "От площадок зависят форматы и права на использование."],
            ["en": "When do you need the first draft?", "why": "Сроки решают, нужна ли наценка за срочность."],
        ]
        let reminders: [[String: Any]] = [
            ["kind": "cost", "title": "Назвал цену до вопросов об объёме", "said": "It's about fifteen hundred, I think.",
             "better": "Before I give you a number — how many versions do you need?"],
            ["kind": "language", "title": "Английский", "said": "Yes, I am agree with the timeline.",
             "better": "Yes, I agree with the timeline."],
            ["kind": "pattern", "title": "Снова подал себя новичком", "said": "I only started doing films recently.", "better": NSNull()],
        ]
        return [
            "id": launchID, "createdAt": at(-1), "updatedAt": at(-0.4), "status": "ready",
            "input": ["images": 3, "text": "На звонке будет Алекс, сооснователь.", "goal": "Фильм к запуску, не ниже $2 600",
                      "callAt": at(20), "origin": "ios"],
            "title": "Фильм к запуску приложения",
            "counterpart": "Alex Moreno, co-founder, Northwind Labs",
            "when": "завтра в 18:00",
            "situation": "Northwind Labs — стартап из пяти человек, через три недели запускает приложение для совместных поездок. Алекс хочет 60-секундный фильм к запуску и пару коротких версий для соцсетей; бюджет пока не назвал.",
            "goal": "фильм и три короткие версии не ниже $2 600, предоплата 50%.",
            "watchouts": watchouts,
            "questions": questions,
            "lines": ["opening": "Thanks for making the time, Alex. I went through your beta — the trip-splitting idea is great.",
                      "pitch": "I make short launch films for apps: one clear story in sixty seconds, plus cut-downs for social.",
                      "close": "So, a sixty-second film and three cut-downs by the 28th. I'll send a short proposal today — does that work?"],
            "price": ["anchor": "$3 200 за фильм и три короткие версии", "floor": "$2 600, ниже — только с меньшим объёмом",
                      "say": "For the film plus three cut-downs, it's thirty-two hundred dollars, with half up front.",
                      "ifLow": "I can get closer to your budget if we drop one cut-down — the film itself stays the same.",
                      "notes": "Цифры — из твоего плейбука и цели. Условия других клиентов не называй."],
            "avoid": ["Не обещай «сделаю за выходные»: срок ещё не обсуждали.", "Не называй, сколько тебе платили другие клиенты."],
            "risks": ["Договора нет: попроси письмо с объёмом, сроками и оплатой.", "Музыка: уточни, кто покупает лицензию."],
            "limitations": ["Один скриншот обрезан: не видно, что Алекс написал про сроки."],
            "note": NSNull(),
            "rehearsals": [["sessionId": PreviewFixtures.sessionID, "createdAt": at(-0.6), "tier": 2, "mode": "call", "status": "review",
                            "remember": reminders]],
        ]
    }

    private static func studio() -> [String: Any] {
        [
            "id": studioID, "createdAt": at(-30), "updatedAt": at(-30), "status": "ready",
            "input": ["images": 1, "text": "Хотят серию роликов к открытию.", "goal": NSNull(), "callAt": NSNull(), "origin": "web"],
            "title": "Серия роликов для студии йоги",
            "counterpart": "Maya Lind, маркетинг, Stillpoint Studio",
            "when": NSNull(),
            "situation": "Stillpoint — три студии йоги в одном городе. Майя ищет автора на серию из шести коротких роликов к открытию четвёртой студии.",
            "goal": "понять объём и сроки и договориться о втором созвоне с бюджетом.",
            "watchouts": [["title": "Говоришь дольше, чем спрашиваешь",
                           "why": "В прошлых созвонах ты рассказывал о себе по две минуты. Здесь важнее узнать, что им нужно.",
                           "instead": "Before I tell you about my work, what would make this series a success for you?",
                           "patternId": "long-intro"]],
            "questions": [["en": "How many videos do you need, and how long should each be?", "why": "Объём решает цену и сроки."]],
            "lines": ["opening": "Hi Maya, thanks for reaching out — congrats on the new studio.",
                      "pitch": "I make calm, cinematic short videos for brands; a series of six is a good fit for a launch.",
                      "close": "Let's set a second call once you have a budget range — does Thursday work?"],
            "price": ["anchor": "Цену на этом звонке не называй", "floor": "Сначала объём и бюджет", "say": "", "ifLow": "",
                      "notes": NSNull()],
            "avoid": ["Не соглашайся на тестовый ролик бесплатно."],
            "risks": ["Права на съёмку в студии: уточни, кто договаривается с учениками."],
            "limitations": [String](), "note": NSNull(), "rehearsals": [Any](),
        ]
    }

    // MARK: Rehearsal review

    /// `--preview=prep-review`: the review of the launch-film rehearsal, with the line back to the prep.
    static func makeReview(_ value: inout [String: Any]) {
        value["mode"] = "call"
        value["status"] = "review"
        value["lesson"] = ["title": "Репетиция: Фильм к запуску приложения",
                           "goal": "Узнать объём до цены, назвать свою цифру и договориться о следующем шаге.",
                           "why": "Завтра реальный созвон с этим собеседником.", "minutes": 10, "context": "work",
                           "kind": "practice", "activity": "speaking", "format": "conversation", "familyId": PrepLimits.familyId,
                           "prepId": launchID, "pressureTier": 2, "targetSkills": ["negotiation", "positioning"]] as [String: Any]
        value["turns"] = [
            ["id": "a1", "role": "assistant", "text": "So, roughly what would a launch film like that cost us?"],
            ["id": "u1", "role": "user", "text": "It's about fifteen hundred, I think."],
            ["id": "a2", "role": "assistant", "text": "Okay. And could you do a couple of extra versions for social too?"],
            ["id": "u2", "role": "user", "text": "Yes, I am agree, no problem."],
        ] as [[String: Any]]
        value["analysis"] = [
            "version": 1,
            "summary": "Цену ты назвал раньше, чем узнал объём, и потом согласился на дополнительные версии без доплаты.",
            "strengths": ["Ответ был коротким и по делу."],
            "priorities": [["title": "Сначала объём, потом цифра", "turnId": "u1", "quote": "It's about fifteen hundred, I think.",
                            "explanation": "Цифра до вопросов становится потолком: дальше объём растёт, а цена — нет.",
                            "example": "Before I give you a number — how many versions do you need?",
                            "retryInstruction": "Ответь заново: задай вопрос об объёме и только потом назови диапазон."]],
            "limitations": [String](),
            "outcome": ["achieved": "partly", "what": "Договорились о следующем шаге, но цена ниже твоего минимума."],
        ] as [String: Any]
        value["completion"] = ["canComplete": false, "needsRetry": true, "reason": "Сделай улучшенную попытку или отложи её."]
    }

    // MARK: Screenshots

    /// A made-up chat screenshot: grey and violet bubbles drawn as text-free bars (no real conversation).
    static func shot(_ index: Int) -> PrepDraft.Shot {
        let size = CGSize(width: 300, height: 400)
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = true
        let image = UIGraphicsImageRenderer(size: size, format: format).image { context in
            UIColor(red: 0.96, green: 0.96, blue: 0.97, alpha: 1).setFill()
            context.fill(CGRect(origin: .zero, size: size))
            UIColor.white.setFill()
            context.fill(CGRect(x: 0, y: 0, width: size.width, height: 46))
            UIColor(red: 0.74, green: 0.70, blue: 0.96, alpha: 1).setFill()
            UIBezierPath(ovalIn: CGRect(x: 14, y: 9, width: 28, height: 28)).fill()
            UIColor(white: 0.25, alpha: 1).setFill()
            UIBezierPath(roundedRect: CGRect(x: 52, y: 15, width: 110, height: 8), cornerRadius: 4).fill()
            UIColor(white: 0.6, alpha: 1).setFill()
            UIBezierPath(roundedRect: CGRect(x: 52, y: 28, width: 64, height: 6), cornerRadius: 3).fill()
            var y: CGFloat = 62
            let pattern: [(mine: Bool, lines: Int)] = index % 2 == 1
                ? [(false, 2), (true, 1), (false, 3), (true, 2), (false, 1), (true, 3)]
                : [(true, 2), (false, 2), (true, 1), (false, 3), (true, 2), (false, 1)]
            for bubble in pattern {
                let height = CGFloat(bubble.lines) * 14 + 16
                guard y + height < size.height - 10 else { break }
                let width: CGFloat = bubble.lines > 1 ? 196 : 132
                let x: CGFloat = bubble.mine ? size.width - width - 14 : 14
                let fill = bubble.mine ? UIColor(red: 0.44, green: 0.36, blue: 0.95, alpha: 1) : UIColor.white
                fill.setFill()
                UIBezierPath(roundedRect: CGRect(x: x, y: y, width: width, height: height), cornerRadius: 14).fill()
                let ink = bubble.mine ? UIColor(white: 1, alpha: 0.75) : UIColor(white: 0.55, alpha: 1)
                ink.setFill()
                for line in 0..<bubble.lines {
                    let lineWidth = line == bubble.lines - 1 ? width * 0.55 : width - 28
                    UIBezierPath(roundedRect: CGRect(x: x + 14, y: y + 10 + CGFloat(line) * 14, width: lineWidth, height: 6),
                                 cornerRadius: 3).fill()
                }
                y += height + 12
            }
        }
        let data = image.jpegData(compressionQuality: 0.86) ?? Data()
        let upload = PrepUpload(data: data, mime: "image/jpeg", pixelWidth: Int(size.width), pixelHeight: Int(size.height))
        return PrepDraft.Shot(upload: upload, thumbnail: image)
    }
}
#endif
