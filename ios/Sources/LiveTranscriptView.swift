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

/// Mounted only during microphone capture. The editable draft stays a separate
/// TextField, with its own cursor and scroll position after capture stops.
struct LiveTranscriptView: View {
    let text: String
    let status: String
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @ScaledMetric(relativeTo: .subheadline) private var maximumHeight = 88.0
    @ScaledMetric(relativeTo: .subheadline) private var minimumHeight = 24.0
    @ScaledMetric(relativeTo: .subheadline) private var wordSpacing = 4.0
    @State private var tokens: LiveTranscriptTokens
    @State private var contentSize = CGSize.zero
    private let bottomID = "live-transcript-current-word"

    init(text: String, status: String) {
        self.text = text
        self.status = status
        _tokens = State(initialValue: LiveTranscriptTokens(text: text))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label("Сейчас говоришь ты", systemImage: "waveform")
                .font(.caption.weight(.medium)).foregroundStyle(Theme.secondary)
            ScrollViewReader { proxy in
                ScrollView(.vertical) {
                    VStack(alignment: .leading, spacing: 0) {
                        Group {
                            if tokens.words.isEmpty {
                                Text("Текст появится, когда начнёшь говорить…")
                                    .font(.subheadline).foregroundStyle(Theme.secondary)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                            } else {
                                TranscriptWordFlow(spacing: wordSpacing) {
                                    ForEach(tokens.words) { word in
                                        LiveTranscriptWord(word: word, reduceMotion: reduceMotion)
                                    }
                                }
                            }
                        }.padding(.vertical, 3)
                        Color.clear.frame(height: 1).id(bottomID)
                    }
                    .background {
                        GeometryReader { geometry in
                            Color.clear.preference(key: TranscriptSizePreference.self, value: geometry.size)
                        }
                    }
                }
                .scrollIndicators(.hidden).scrollBounceBehavior(.basedOnSize)
                .frame(height: min(min(maximumHeight, 160), max(minimumHeight, contentSize.height)))
                .onPreferenceChange(TranscriptSizePreference.self) { contentSize = $0 }
                .onChange(of: text) { _, fresh in
                    // Keep reflow and hypothesis corrections immediate. Only the
                    // genuinely appended word views own a decorative spring.
                    var transaction = Transaction(animation: nil)
                    transaction.disablesAnimations = reduceMotion
                    withTransaction(transaction) { tokens.update(fresh) }
                }
                .task(id: TranscriptFollowLayout(revision: tokens.revision, size: contentSize, height: maximumHeight)) {
                    // A geometry update follows a line wrap, a width change or
                    // Dynamic Type change. Wait for placement before following.
                    await Task.yield()
                    guard !Task.isCancelled else { return }
                    var transaction = Transaction(animation: nil)
                    transaction.disablesAnimations = true
                    withTransaction(transaction) { proxy.scrollTo(bottomID, anchor: .bottom) }
                }
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(text.isEmpty ? "Живая расшифровка. Ожидаем речь." : "Живая расшифровка: " + text)
            }
            if !status.isEmpty {
                Text(status).font(.caption2).foregroundStyle(Theme.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }.padding(14).background(.white, in: RoundedRectangle(cornerRadius: 18))
            .foregroundStyle(Theme.charcoal)
    }
}

private struct TranscriptFollowLayout: Equatable {
    let revision: Int
    let size: CGSize
    let height: Double
}

private struct TranscriptSizePreference: PreferenceKey {
    static var defaultValue: CGSize = .zero
    static func reduce(value: inout CGSize, nextValue: () -> CGSize) { value = nextValue() }
}

private struct LiveTranscriptWord: View {
    let word: LiveTranscriptTokens.Word
    let reduceMotion: Bool
    @State private var settled = false
    private var entering: Bool { word.animateEntrance && !reduceMotion && !settled }
    var body: some View {
        Text(word.text).font(.subheadline).fixedSize(horizontal: false, vertical: true)
            .scaleEffect(x: entering ? 1.035 : 1, y: entering ? 0.79 : 1, anchor: .bottom)
            .offset(y: entering ? 2 : 0)
            .onAppear {
                guard word.animateEntrance, !reduceMotion else { settled = true; return }
                withAnimation(.spring(response: 0.29, dampingFraction: 0.69, blendDuration: 0.04)) { settled = true }
            }
            .accessibilityHidden(true)
    }
}

/// Measure actual text sizes rather than assuming a number of characters per
/// line. Long words are proposed the full available width and may wrap too.
private struct TranscriptWordFlow: Layout {
    let spacing: Double
    private struct Placement { let point: CGPoint; let size: CGSize }
    private func arrange(width: CGFloat, subviews: Subviews) -> ([Placement], CGFloat) {
        var placements: [Placement] = []
        var x: CGFloat = 0
        var y: CGFloat = 0
        var rowHeight: CGFloat = 0
        for subview in subviews {
            let size = subview.sizeThatFits(ProposedViewSize(width: width, height: nil))
            if x > 0 && x + size.width > width {
                x = 0; y += rowHeight + spacing; rowHeight = 0
            }
            placements.append(Placement(point: CGPoint(x: x, y: y), size: size))
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
        return (placements, y + rowHeight)
    }
    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = max(1, proposal.width ?? 300)
        return CGSize(width: width, height: arrange(width: width, subviews: subviews).1)
    }
    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let placements = arrange(width: max(1, bounds.width), subviews: subviews).0
        for (index, placement) in placements.enumerated() {
            subviews[index].place(at: CGPoint(x: bounds.minX + placement.point.x, y: bounds.minY + placement.point.y),
                anchor: .topLeading, proposal: ProposedViewSize(placement.size))
        }
    }
}
