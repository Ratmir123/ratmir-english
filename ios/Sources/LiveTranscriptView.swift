import SwiftUI

/// Recognition can replace a hypothesis, including its prefix. Identity is not
/// tied to text, so corrections never replay already-visible word entrances.
struct LiveTranscriptTokens {
    struct Word: Identifiable, Equatable {
        let id: Int
        let text: String
        let animateEntrance: Bool
    }
    private(set) var words: [Word] = []
    private(set) var revision = 0
    private var nextID = 0
    private var previousText = ""

    init(text: String = "") {
        previousText = text
        words = text.split(whereSeparator: \.isWhitespace).map { piece in
            let word = Word(id: nextID, text: String(piece), animateEntrance: false)
            nextID += 1
            return word
        }
    }

    mutating func update(_ text: String) {
        guard text != previousText else { return }
        previousText = text
        let fresh = text.split(whereSeparator: \.isWhitespace).map(String.init)
        let old = words
        var prefix = 0
        while prefix < min(old.count, fresh.count), old[prefix].text == fresh[prefix] { prefix += 1 }
        var suffix = 0
        while suffix < min(old.count - prefix, fresh.count - prefix),
              old[old.count - 1 - suffix].text == fresh[fresh.count - 1 - suffix] { suffix += 1 }
        let oldMiddleCount = old.count - prefix - suffix
        let newMiddleCount = fresh.count - prefix - suffix
        // A corrected final fragment can grow into a complete word and append a
        // new one. A rewritten prefix/middle must not be presented as new speech.
        let growingTail = suffix == 0 && (old.isEmpty || prefix == old.count
            || (prefix > 0 && prefix >= max(0, old.count - 2)))
        var result: [Word] = []
        result.reserveCapacity(fresh.count)
        for index in fresh.indices {
            let reused: Word?
            if index < prefix { reused = old[index] }
            else if index >= fresh.count - suffix { reused = old[old.count - (fresh.count - index)] }
            else if index - prefix < oldMiddleCount { reused = old[index] }
            else { reused = nil }
            if let reused {
                result.append(Word(id: reused.id, text: fresh[index], animateEntrance: false))
            } else {
                result.append(Word(id: nextID, text: fresh[index], animateEntrance: growingTail && newMiddleCount > oldMiddleCount))
                nextID += 1
            }
        }
        words = result
        revision += 1
    }
}

// MARK: - Caption model (MOTION-PASS 0.5.2 §5)

/// One word of the live caption line.
struct LiveCaption: Equatable, Identifiable {
    let id: Int
    var text: String
    /// When the word joins the line (its slot in the reveal queue), seconds since the reference date.
    var revealAt: Double
    /// Spoken words fade in with a small rise and blur; restored text and corrections appear in place.
    var entrance: Bool
    /// The text before the latest in-place revision; it cross-fades out from `revisedAt`.
    var formerText: String?
    var revisedAt: Double
}

/// The reveal queue: words land about 55 ms apart, faster when a backlog builds, so the line never trails
/// the recognizer by more than ~350 ms. Steady speech appears at once. Pure, so it is unit-tested.
enum LiveCaptionSchedule {
    static let wordInterval = 0.055
    static let maximumLag = 0.35
    /// A word extended this soon after it appeared simply completes (it is still fading in).
    static let silentRevision = 0.12
    static let revisionFade = 0.2
    /// The entrance (critically damped, response 0.26 s) and the line scroll (0.24 s) end within this time.
    static let settleTime = 0.34

    static func merge(_ previous: [LiveCaption], words: [LiveTranscriptTokens.Word], now: Double) -> [LiveCaption] {
        var known: [Int: LiveCaption] = [:]
        for caption in previous { known[caption.id] = caption }
        let lastShown = previous.lazy.map(\.revealAt).filter { $0 <= now }.max()
        var result: [LiveCaption] = []
        result.reserveCapacity(words.count)
        var waiting: [Int] = []
        for word in words {
            if var caption = known[word.id] {
                if caption.text != word.text {
                    if caption.revealAt <= now && now - caption.revealAt >= silentRevision {
                        caption.formerText = caption.text
                        caption.revisedAt = now
                    }
                    caption.text = word.text
                }
                if caption.revealAt > now { waiting.append(result.count) }
                result.append(caption)
            } else if word.animateEntrance || !waiting.isEmpty {
                waiting.append(result.count)
                result.append(LiveCaption(id: word.id, text: word.text, revealAt: now, entrance: true, formerText: nil, revisedAt: now))
            } else {
                // A recognizer correction inside the line: it fades in where it stands.
                result.append(LiveCaption(id: word.id, text: word.text, revealAt: now, entrance: false, formerText: "", revisedAt: now))
            }
        }
        guard !waiting.isEmpty else { return result }
        let step = min(wordInterval, maximumLag / Double(waiting.count))
        var slot = now
        if let lastShown { slot = max(now, lastShown + step) }
        for index in waiting {
            result[index].revealAt = slot
            slot += step
        }
        return result
    }
}

/// Live captions of the learner's own speech. TrainingClient owns it, but only LiveTranscriptView observes it,
/// so recognizer deltas never re-render the conversation screen.
@MainActor final class LiveTranscriptModel: ObservableObject {
    @Published private(set) var captions: [LiveCaption] = []
    @Published private(set) var status = ""
    /// True while words, revisions or the line scroll are in motion: only then does the caption canvas draw every frame.
    @Published private(set) var animating = false
    /// The latest full hypothesis: plain text for drafts and the accessibility label, never published on its own.
    private(set) var text = ""
    private var tokens = LiveTranscriptTokens()
    private var settleAt = 0.0
    private var settleTask: Task<Void, Never>?

    nonisolated static func clock() -> Double { Date().timeIntervalSinceReferenceDate }

    func setStatus(_ value: String) {
        if status != value { status = value }
    }

    /// Restored, cleared or preview text: on screen at once, without the reveal queue.
    func reset(to value: String = "") {
        settleTask?.cancel(); settleTask = nil
        settleAt = 0
        text = value
        tokens = LiveTranscriptTokens(text: value)
        let shown = LiveTranscriptModel.clock() - 1
        let fresh = tokens.words.map {
            LiveCaption(id: $0.id, text: $0.text, revealAt: shown, entrance: false, formerText: nil, revisedAt: shown)
        }
        if captions != fresh { captions = fresh }
        if animating { animating = false }
    }

    /// A recognizer hypothesis: appended words join the reveal queue, revised words cross-fade in place.
    func receive(_ hypothesis: String) {
        guard hypothesis != text else { return }
        let now = LiveTranscriptModel.clock()
        text = hypothesis
        tokens.update(hypothesis)
        captions = LiveCaptionSchedule.merge(captions, words: tokens.words, now: now)
        let lastReveal = captions.map(\.revealAt).max() ?? now
        settle(until: max(now, lastReveal) + LiveCaptionSchedule.settleTime)
    }

    /// Keeps the canvas drawing until the last scheduled motion has finished, then lets it rest.
    private func settle(until time: Double) {
        settleAt = max(settleAt, time)
        if !animating { animating = true }
        guard settleTask == nil else { return }
        settleTask = Task { @MainActor [weak self] in
            while !Task.isCancelled {
                guard let model = self else { return }
                let remaining = model.settleAt - LiveTranscriptModel.clock()
                if remaining <= 0 {
                    model.settleTask = nil
                    model.animating = false
                    return
                }
                try? await Task.sleep(for: .milliseconds(Int((remaining * 1000).rounded(.up)) + 8))
            }
        }
    }
}

// MARK: - Canvas renderer

/// Lays out and draws the caption words in one Canvas: widths are measured once per word and text size,
/// only the visible lines are drawn, the newest line is followed by a ~0.24 s scroll and any reflow glides.
/// New words fade in with a 3 pt rise and a 3 pt blur, critically damped (no squash). Reduce Motion: plain fades.
final class LiveCaptionRenderer {
    private struct Glide { var from: CGPoint; var to: CGPoint; var start: Double }
    private struct Placed { let caption: LiveCaption; let line: Int; let origin: CGPoint }

    static let visibleLines = 3
    static let glideDuration = 0.24
    static let entranceResponse = 0.26
    static let reducedFade = 0.2
    private static let measureBox = CGSize(width: 10_000, height: 10_000)

    private var fontKey = ""
    private var widths: [String: CGFloat] = [:]
    private var space: CGFloat = 4
    private var lineHeight: CGFloat = 18
    private var scrollFrom: CGFloat = 0
    private var scrollTarget: CGFloat = 0
    private var scrollStart = -Double.infinity
    private var glides: [Int: Glide] = [:]
    private var placedOnce = false

    func draw(_ context: inout GraphicsContext, size: CGSize, captions: [LiveCaption], placeholder: String,
              time: Double, settled: Bool, reduceMotion: Bool) {
        guard size.width > 1, size.height > 1 else { return }
        prepareMetrics(context)
        let pitch = max(lineHeight, (size.height - lineHeight) / CGFloat(LiveCaptionRenderer.visibleLines - 1))
        // Words join the line only when their queue slot comes: appending never moves earlier words.
        var placed: [Placed] = []
        placed.reserveCapacity(captions.count)
        var x: CGFloat = 0
        var line = 0
        for caption in captions where settled || caption.revealAt <= time {
            let width = measure(caption.text, context)
            if x > 0 && x + width > size.width { line += 1; x = 0 }
            placed.append(Placed(caption: caption, line: line, origin: CGPoint(x: x, y: CGFloat(line) * pitch)))
            x += width + space
        }
        let lines = placed.isEmpty ? 0 : line + 1
        let target = CGFloat(max(0, lines - LiveCaptionRenderer.visibleLines)) * pitch
        let still = settled || reduceMotion
        if !placedOnce {
            // A freshly mounted caption box starts where the text already is.
            placedOnce = true
            scrollFrom = target; scrollTarget = target; scrollStart = -.infinity
        } else if target != scrollTarget {
            scrollFrom = still ? target : scrollOffset(at: time)
            scrollTarget = target
            scrollStart = time
        }
        let offset = still ? target : scrollOffset(at: time)
        drawPlaceholder(&context, size: size, text: placeholder, first: placed.first?.caption, time: time,
                        settled: settled, reduceMotion: reduceMotion)
        let topLine = Int((offset / pitch).rounded(.down)) - 1
        for item in placed where item.line >= topLine {
            let origin = position(of: item, time: time, still: still)
            let y = origin.y - offset
            guard y + lineHeight > 0, y < size.height else { continue }
            var alpha = edgeVisibility(y, height: size.height)
            var rise: CGFloat = 0
            var blur: CGFloat = 0
            if item.caption.entrance && !settled {
                let age = time - item.caption.revealAt
                if reduceMotion {
                    alpha *= min(1, max(0, age / LiveCaptionRenderer.reducedFade))
                } else {
                    let progress = LiveCaptionRenderer.spring(age, response: LiveCaptionRenderer.entranceResponse)
                    alpha *= progress
                    rise = CGFloat(1 - progress) * 3
                    blur = CGFloat(1 - progress) * 3
                }
            }
            let point = CGPoint(x: origin.x, y: y + rise)
            if !settled, let former = item.caption.formerText {
                let crossing = LiveCaptionRenderer.smooth((time - item.caption.revisedAt) / LiveCaptionSchedule.revisionFade)
                if crossing < 1 {
                    if !former.isEmpty { drawWord(former, at: point, alpha: alpha * (1 - crossing), blur: blur, context) }
                    alpha *= crossing
                }
            }
            drawWord(item.caption.text, at: point, alpha: alpha, blur: blur, context)
        }
        if glides.count > captions.count + 48 {
            let alive = Set(captions.map(\.id))
            glides = glides.filter { alive.contains($0.key) }
        }
    }

    // MARK: Motion

    private func scrollOffset(at time: Double) -> CGFloat {
        let progress = LiveCaptionRenderer.easeOut((time - scrollStart) / LiveCaptionRenderer.glideDuration)
        return scrollFrom + (scrollTarget - scrollFrom) * CGFloat(progress)
    }

    /// A word whose place changes (a revision reflowed the line, the width changed) glides there.
    private func position(of item: Placed, time: Double, still: Bool) -> CGPoint {
        let id = item.caption.id
        let target = item.origin
        guard var glide = glides[id] else {
            glides[id] = Glide(from: target, to: target, start: -.infinity)
            return target
        }
        if glide.to != target {
            glide = Glide(from: still ? target : glidePoint(glide, time), to: target, start: time)
            glides[id] = glide
        }
        return still ? target : glidePoint(glide, time)
    }

    private func glidePoint(_ glide: Glide, _ time: Double) -> CGPoint {
        let progress = CGFloat(LiveCaptionRenderer.easeOut((time - glide.start) / LiveCaptionRenderer.glideDuration))
        return CGPoint(x: glide.from.x + (glide.to.x - glide.from.x) * progress,
                       y: glide.from.y + (glide.to.y - glide.from.y) * progress)
    }

    /// Lines sliding past the top or bottom edge fade with the part of them still inside.
    private func edgeVisibility(_ y: CGFloat, height: CGFloat) -> Double {
        var visible: CGFloat = 1
        if y < 0 { visible = min(visible, (y + lineHeight) / lineHeight) }
        if y + lineHeight > height + 0.5 { visible = min(visible, (height - y) / lineHeight) }
        return Double(max(0, min(1, visible)))
    }

    /// Critically damped spring step response (no overshoot), 1 once it is visually done.
    static func spring(_ elapsed: Double, response: Double) -> Double {
        guard elapsed > 0 else { return 0 }
        let x = 2 * Double.pi * elapsed / response
        let value = 1 - (1 + x) * exp(-x)
        return value >= 0.995 ? 1 : value
    }

    static func easeOut(_ value: Double) -> Double {
        guard value > 0 else { return 0 }
        guard value < 1 else { return 1 }
        return 1 - pow(1 - value, 4)
    }

    static func smooth(_ value: Double) -> Double {
        let clamped = min(1, max(0, value))
        return clamped * clamped * (3 - 2 * clamped)
    }

    // MARK: Text

    private func prepareMetrics(_ context: GraphicsContext) {
        let environment = context.environment
        let key = "\(environment.dynamicTypeSize)|\(environment.legibilityWeight == .bold)"
        guard key != fontKey else { return }
        fontKey = key
        widths.removeAll(keepingCapacity: true)
        let box = LiveCaptionRenderer.measureBox
        lineHeight = max(8, context.resolve(Text(verbatim: "Ag").font(.subheadline)).measure(in: box).height)
        let spaced = context.resolve(Text(verbatim: "a a").font(.subheadline)).measure(in: box).width
        let tight = context.resolve(Text(verbatim: "aa").font(.subheadline)).measure(in: box).width
        space = min(12, max(2, spaced - tight))
    }

    private func measure(_ word: String, _ context: GraphicsContext) -> CGFloat {
        if let known = widths[word] { return known }
        let width = context.resolve(Text(verbatim: word).font(.subheadline)).measure(in: LiveCaptionRenderer.measureBox).width
        if widths.count > 4_000 { widths.removeAll(keepingCapacity: true) }
        widths[word] = width
        return width
    }

    private func drawWord(_ word: String, at point: CGPoint, alpha: Double, blur: CGFloat, _ context: GraphicsContext) {
        guard alpha > 0.01 else { return }
        var layer = context
        layer.opacity = alpha
        if blur > 0.05 { layer.addFilter(.blur(radius: blur)) }
        layer.draw(Text(verbatim: word).font(.subheadline), at: point, anchor: .topLeading)
    }

    /// The hint before the first word; it cross-fades out while that word fades in.
    private func drawPlaceholder(_ context: inout GraphicsContext, size: CGSize, text: String, first: LiveCaption?,
                                 time: Double, settled: Bool, reduceMotion: Bool) {
        var visibility = 1.0
        if let first {
            guard !settled, first.entrance else { return }
            let age = time - first.revealAt
            visibility = 1 - (reduceMotion ? min(1, max(0, age / LiveCaptionRenderer.reducedFade))
                              : LiveCaptionRenderer.spring(age, response: LiveCaptionRenderer.entranceResponse))
        }
        guard visibility > 0.01 else { return }
        var layer = context
        layer.opacity = 0.62 * visibility
        layer.draw(Text(verbatim: text).font(.subheadline), in: CGRect(origin: .zero, size: size))
    }
}

// MARK: - View

/// The learner's own words while recording (and while the answer is being saved right after Stop). A fixed
/// three-line box from the first frame, so the dock never grows while speaking; the editable draft stays a
/// separate TextField once the checked text arrives.
struct LiveTranscriptView: View {
    @ObservedObject var model: LiveTranscriptModel
    /// False after Stop: the words stay on screen until the checked draft replaces them.
    var live = true
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @ScaledMetric(relativeTo: .subheadline) private var lineGap = 3.0
    @State private var renderer = LiveCaptionRenderer()
    private static let placeholder = "Текст появится, когда начнёшь говорить…"

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label(live ? "Сейчас говоришь ты" : "Сохраняю ответ", systemImage: live ? "waveform" : "hourglass")
                .font(.caption.weight(.semibold)).foregroundStyle(Theme.inkSecondary)
            captionBox
            Text(live ? model.status : "Сверяю живой текст с записью")
                .font(.caption2).foregroundStyle(Theme.inkSecondary)
                .lineLimit(1, reservesSpace: true)
                .minimumScaleFactor(0.8)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.solid, in: RoundedRectangle(cornerRadius: Radius.input, style: .continuous))
        .overlay { RoundedRectangle(cornerRadius: Radius.input, style: .continuous).strokeBorder(Theme.cyan.opacity(0.55), lineWidth: 1.5) }
        .foregroundStyle(Theme.ink)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityText)
        .accessibilityAddTraits(.updatesFrequently)
    }

    /// Three lines of the caption font, whatever the text size; the canvas draws inside it.
    private var captionBox: some View {
        let words = model.captions
        let settled = !model.animating
        let reduced = reduceMotion
        let canvasRenderer = renderer
        let hint = LiveTranscriptView.placeholder
        return Text(verbatim: "Ag\nAg\nAg")
            .font(.subheadline)
            .lineSpacing(lineGap)
            .frame(maxWidth: .infinity, alignment: .leading)
            .hidden()
            .overlay {
                TimelineView(.animation(minimumInterval: 1.0 / 60.0, paused: settled)) { timeline in
                    Canvas { context, size in
                        canvasRenderer.draw(&context, size: size, captions: words, placeholder: hint,
                                            time: timeline.date.timeIntervalSinceReferenceDate, settled: settled, reduceMotion: reduced)
                    }
                }
            }
            .clipped()
    }

    private var accessibilityText: String {
        let words = model.text.trimmingCharacters(in: .whitespacesAndNewlines)
        let spoken = words.isEmpty ? "Живая расшифровка. Ожидаем речь." : "Живая расшифровка: " + words
        let note = live ? model.status : ""
        return note.isEmpty ? spoken : spoken + ". " + note
    }
}
