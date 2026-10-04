import Foundation
import UIKit

/// `GET /api/families` → `{ families, calibration, catalog }`. Only `catalog` drives the Practice tab.
struct FamiliesResponse: Decodable {
    let catalog: [CatalogSection]

    init(catalog: [CatalogSection]) { self.catalog = catalog }

    private enum CodingKeys: String, CodingKey { case catalog }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        catalog = ((try? c.decodeIfPresent(TolerantList<CatalogSection>.self, forKey: .catalog)) ?? nil)?.values
            .filter { !$0.families.isEmpty } ?? []
    }
}

/// One catalog group (strategy, work, life, relocation, ielts) — lib/training.ts `CatalogSection`.
struct CatalogSection: Decodable, Identifiable {
    let id: String
    let title: String
    let description: String
    let families: [CatalogFamily]

    init(id: String, title: String, description: String, families: [CatalogFamily]) {
        self.id = id
        self.title = title
        self.description = description
        self.families = families
    }

    private enum CodingKeys: String, CodingKey { case id, title, description, families }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        title = ((try? c.decodeIfPresent(String.self, forKey: .title)) ?? nil) ?? id
        description = ((try? c.decodeIfPresent(String.self, forKey: .description)) ?? nil) ?? ""
        families = ((try? c.decodeIfPresent(TolerantList<CatalogFamily>.self, forKey: .families)) ?? nil)?.values ?? []
    }
}

/// One scenario family as a Practice tile — lib/training.ts `CatalogFamily`.
struct CatalogFamily: Decodable, Identifiable {
    let id: String
    let title: String
    let description: String
    let category: String
    let context: String
    let activity: String
    let preferredMode: String
    let skills: [String]
    let minutes: Int
    /// A valid SF Symbol (the server's `icon.sf`, or a category fallback).
    let symbol: String
    let isNew: Bool
    let format: String?
    let patternIds: [String]
    /// Optional observable goal; the description is the fallback.
    let goal: String?

    init(id: String, title: String, description: String, category: String, context: String, activity: String = "speaking",
         preferredMode: String = "learning", skills: [String] = [], minutes: Int = 10, symbol: String = "bubble.left.and.bubble.right",
         isNew: Bool = false, format: String? = nil, patternIds: [String] = [], goal: String? = nil) {
        self.id = id
        self.title = title
        self.description = description
        self.category = category
        self.context = context
        self.activity = activity
        self.preferredMode = preferredMode
        self.skills = skills
        self.minutes = minutes
        self.symbol = symbol
        self.isNew = isNew
        self.format = format
        self.patternIds = patternIds
        self.goal = goal
    }

    private enum CodingKeys: String, CodingKey {
        case id, title, description, category, context, activity, preferredMode, skills, minutes, icon, isNew, format, patternIds, goal
    }
    private struct Icon: Decodable { let sf: String? }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        title = try c.decode(String.self, forKey: .title)
        description = ((try? c.decodeIfPresent(String.self, forKey: .description)) ?? nil) ?? ""
        let decodedCategory = ((try? c.decodeIfPresent(String.self, forKey: .category)) ?? nil) ?? "life"
        category = decodedCategory
        context = ((try? c.decodeIfPresent(String.self, forKey: .context)) ?? nil) ?? "life"
        activity = ((try? c.decodeIfPresent(String.self, forKey: .activity)) ?? nil) ?? "speaking"
        let mode = ((try? c.decodeIfPresent(String.self, forKey: .preferredMode)) ?? nil) ?? "learning"
        preferredMode = mode == "call" ? "call" : "learning"
        skills = ((try? c.decodeIfPresent(TolerantList<String>.self, forKey: .skills)) ?? nil)?.values ?? []
        minutes = min(60, max(1, LenientNumber.int(c, .minutes) ?? 10))
        let icon = (try? c.decodeIfPresent(Icon.self, forKey: .icon)) ?? nil
        symbol = CatalogFamily.validSymbol(icon?.sf, category: decodedCategory)
        isNew = ((try? c.decodeIfPresent(Bool.self, forKey: .isNew)) ?? nil) ?? false
        format = (try? c.decodeIfPresent(String.self, forKey: .format)) ?? nil
        patternIds = ((try? c.decodeIfPresent(TolerantList<String>.self, forKey: .patternIds)) ?? nil)?.values ?? []
        goal = (try? c.decodeIfPresent(String.self, forKey: .goal)) ?? nil
    }

    /// Reading and writing tasks always run with text supports on the server.
    var fixedLearningMode: Bool { activity == "reading" || activity == "writing" }

    static func validSymbol(_ name: String?, category: String) -> String {
        if let name, !name.isEmpty, UIImage(systemName: name) != nil { return name }
        return categorySymbol(category)
    }

    static func categorySymbol(_ category: String) -> String {
        switch category {
        case "strategy": return "target"
        case "work": return "briefcase"
        case "relocation": return "airplane"
        case "ielts": return "book.closed"
        default: return "bubble.left.and.bubble.right"
        }
    }
}
