import SwiftUI
import UIKit

/// PASS 0.5.3 §5–6: reward (rank medal and achievement) and scenario art is decoded off the main thread while the launch
/// layer plays, so the first Today, Progress or Practice frame never decodes a 512 px PNG on the main thread.
/// A small purgeable cache: `image(_:)` hands out the decoded copy and falls back to the asset catalog whenever an entry
/// is missing (not decoded yet, purged under memory pressure, or an unknown name).
enum ImagePrewarm {
    /// The 13 reward imagesets (6 ranks + 7 achievement arts, `RewardArt`). Ranks first: Today shows one at once.
    static let rewardNames: [String] = ["rank-pearl", "rank-mint", "rank-sky", "rank-violet", "rank-rose", "rank-gold",
                                        "first-practice", "three-days", "ten-practices", "own-improvement", "balanced-worlds",
                                        "independent-listening", "four-sides"].map { "reward-" + $0 + "-v041" }
    /// Read-only copy of SCENARIO_ARTWORK_IDS (lib/scenario-artwork.ts) for `ScenarioArtwork`'s `scenario-<id>-v1` sets;
    /// a newer id that is not listed here simply loads the usual way.
    static let scenarioIDs: [String] = [
        "strategy-pitch-30", "strategy-agency-screening", "strategy-price", "strategy-recap-close",
        "strategy-follow-up", "strategy-confidential", "strategy-say-no", "strategy-scope-creep", "strategy-rights",
        "work-call-opening", "work-brief-call", "work-project", "work-interview", "work-revisions",
        "life-new-city", "life-friends", "life-debate", "life-games", "life-sport", "life-group", "life-travel",
        "relocation-arrival", "relocation-housing", "relocation-errands", "relocation-interview",
        "ielts-speaking", "ielts-listening", "ielts-reading", "ielts-writing",
    ]
    static var scenarioNames: [String] { scenarioIDs.map { "scenario-" + $0 + "-v1" } }
    /// Every decoded image together stays well under this (13 × 1 MB rewards + 29 × 0.15 MB scenarios).
    static let costLimit = 24 * 1024 * 1024

    // NSCache and NSLock are thread-safe; `started` is only touched under `lock`.
    nonisolated(unsafe) private static let cache: NSCache<NSString, UIImage> = {
        let cache = NSCache<NSString, UIImage>()
        cache.name = "app.ratmirenglish.image-prewarm"
        cache.totalCostLimit = ImagePrewarm.costLimit
        return cache
    }()
    /// Asset-catalog originals stay referenced too, so `UIImage(named:)` elsewhere (scenario art) hits a warm entry.
    nonisolated(unsafe) private static let originals: NSCache<NSString, UIImage> = {
        let cache = NSCache<NSString, UIImage>()
        cache.name = "app.ratmirenglish.image-prewarm.originals"
        return cache
    }()
    private static let lock = NSLock()
    nonisolated(unsafe) private static var started = false

    /// Starts the background decode once per process (any thread; later calls do nothing).
    static func start() {
        lock.lock()
        let first = !started
        started = true
        lock.unlock()
        guard first else { return }
        let names = rewardNames + scenarioNames
        Task.detached(priority: .utility) {
            for name in names { ImagePrewarm.decode(name) }
        }
    }

    /// The decoded art for an asset name, or nil before (or without) the prewarm.
    static func uiImage(named name: String) -> UIImage? {
        cache.object(forKey: name as NSString)
    }

    /// The decoded art as a SwiftUI image; the asset catalog otherwise.
    static func image(_ name: String) -> Image {
        if let decoded = uiImage(named: name) { return Image(uiImage: decoded) }
        return Image(name)
    }

    /// Decodes one asset into the cache (thread-safe; already cached → true at once).
    @discardableResult
    static func decode(_ name: String) -> Bool {
        let key = name as NSString
        if cache.object(forKey: key) != nil { return true }
        guard let original = UIImage(named: name) else { return false }
        originals.setObject(original, forKey: key)
        let ready = original.preparingForDisplay() ?? original
        cache.setObject(ready, forKey: key, cost: cost(of: ready))
        return true
    }

    private static func cost(of image: UIImage) -> Int {
        guard let bitmap = image.cgImage else { return 1 }
        return max(1, bitmap.bytesPerRow * bitmap.height)
    }
}
