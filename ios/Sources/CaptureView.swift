import SwiftUI
import UIKit

// «Запомнить» capture card (planning/v05/PASS-0.5.3.md §1.6), one component for every place on the iPhone, mirroring the web
// components/capture/capture-card.tsx and use-capture.ts:
// - sheet: the capture sheet (Practice «Запомнить», the Home Screen quick action, the App Intent): the chubrik above his bubble
//   «Что запомним?»; saving is instant (optimistic): the text chip flies into him, a happy hop, «Запомнил!» + «Повторим в
//   разговорах», then Sol's take-apart («Разбираю…» while he thinks); «Ещё одну» and «Мои фразы»;
// - inline: the field on top of «Мои фразы», without a companion (the saved phrase shows up in the list underneath).

// MARK: - Model

/// One capture flow (web `useCapture`). The field clears at once on «Запомнить» and a failure brings the text back with the
/// reason; the request outlives the card, and a failure after the card is gone reaches the shell's «Не получилось» alert.
@MainActor final class CaptureModel: ObservableObject {
    /// The last save, on screen before the server answers.
    struct Saved: Equatable {
        let ticket: Int
        /// What he saved.
        let text: String
        /// The server's phrase once it answered.
        var phraseID: String?
        /// The same text was already in the bank (`phraseID` is that one).
        var duplicate = false
    }

    static let savedTitle = "Запомнил!"
    static let savedDetail = "Повторим в разговорах"
    static let duplicateTitle = "Эта фраза уже в копилке"
    /// Offline or a server failure (§1.6, web `SAVE_FAILED`).
    static let saveFailed = "Не получилось сохранить. Проверь связь."

    @Published var text: String
    @Published private(set) var saved: Saved?
    /// Why the last save failed (the text is back in the field).
    @Published private(set) var error: String?
    /// Clipboard notes («Вставил первые 600 знаков.»).
    @Published private(set) var notice: String?
    /// Grows with every save.
    @Published private(set) var serial = 0
    /// The chubrik's happy hop when the chip lands.
    @Published private(set) var celebrate = 0
    var onScreen = false
    private var ticket = 0
    /// The text the model itself put into the field (paste, a failed save): its own change never clears the error or notice.
    private var programmatic: String?

    init(prefill: String?, startsSaved: String? = nil) {
        text = prefill.map { PhraseLabels.insert("", $0).text } ?? ""
        if let startsSaved { saved = Saved(ticket: 0, text: "", phraseID: startsSaved) }
    }

    var canSave: Bool { PhraseLabels.captureText(text) != nil }

    /// The field changed: at most 600 characters (like the web `maxLength`); typing clears the error and the clipboard note.
    func textChanged() {
        if text.utf16.count > PhraseLabels.textLimit {
            text = PhraseLabels.prefix(text, utf16: PhraseLabels.textLimit)
            return
        }
        if let programmatic, programmatic == text { return }
        programmatic = nil
        if error != nil { error = nil }
        if notice != nil { notice = nil }
    }

    /// «Вставить»: the clipboard text joins the field at its end (only on tap: PasteButton never asks for permission).
    func paste(_ strings: [String]) {
        let result = PhraseLabels.insert(text, strings.joined(separator: " "))
        error = nil
        notice = result.truncated ? "Вставил первые \(PhraseLabels.textLimit) знаков." : nil
        guard result.text != text else { return }
        programmatic = result.text
        text = result.text
    }

    /// «Запомнить»: false when there is nothing to save.
    @discardableResult func save(client: TrainingClient, store: PhrasesStore) -> Bool {
        guard let value = PhraseLabels.captureText(text) else { return false }
        ticket += 1
        let mine = ticket
        programmatic = ""
        text = ""
        error = nil
        notice = nil
        saved = Saved(ticket: mine, text: value)
        serial += 1
        announce(Self.savedTitle + ". " + Self.savedDetail)
        Task {
            do {
                let result = try await store.create(value, client: client)
                if saved?.ticket == mine {
                    saved?.phraseID = result.phrase.id
                    saved?.duplicate = result.duplicate
                }
                if result.duplicate { announce(Self.duplicateTitle) }
            } catch {
                let reason = CaptureModel.problem(error)
                if saved?.ticket == mine { saved = nil }
                guard onScreen else {
                    client.error = "Фраза «" + String(value.prefix(80)) + "» не сохранилась. " + reason
                    return
                }
                // Unless he already started a new one, the text comes back into the field with the reason next to it.
                if text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    programmatic = value
                    text = value
                }
                self.error = reason
                announce(reason)
            }
        }
        return true
    }

    /// «Ещё одну»: back to an empty field.
    func reset() {
        ticket += 1
        saved = nil
        error = nil
        notice = nil
    }

    func hop() { celebrate += 1 }

    /// The server's own Russian answer for a refused text (validation, the daily limit, sign-in); no connection or a failing
    /// server get «Не получилось сохранить. Проверь связь.» (web `saveProblem`).
    static func problem(_ error: Error) -> String {
        if let refusal = error as? TrainingHTTPError, (400..<500).contains(refusal.status), refusal.status != 404,
           !refusal.message.isEmpty {
            return refusal.message
        }
        if case ClientError.message(let text)? = error as? ClientError, !text.isEmpty { return text }
        return saveFailed
    }

    func announce(_ message: String) {
        guard UIAccessibility.isVoiceOverRunning else { return }
        UIAccessibility.post(notification: .announcement, argument: message)
    }
}

// MARK: - Card

struct CaptureCard: View {
    enum Style { case sheet, inline }

    let style: Style
    var autofocus = false
    /// «Мои фразы» after a save (sheet).
    var openList: (() -> Void)? = nil
    /// Every save (the list shows «Все», where the new phrase is on top).
    var onSaved: (() -> Void)? = nil
    /// The text was already saved: the list opens that phrase.
    var onDuplicate: ((String) -> Void)? = nil

    @EnvironmentObject private var client: TrainingClient
    @ObservedObject private var store: PhrasesStore
    @StateObject private var model: CaptureModel
    @FocusState private var focused: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var flight: ChipFlight?
    @State private var mascotFrame: CGRect = .zero
    @State private var fieldFrame: CGRect = .zero
    /// The hop as the chip lands: happy for a moment, then the mood follows Sol.
    @State private var cheering = false

    init(style: Style, prefill: String? = nil, autofocus: Bool = false, openList: (() -> Void)? = nil,
         onSaved: (() -> Void)? = nil, onDuplicate: ((String) -> Void)? = nil) {
        self.style = style
        self.autofocus = autofocus
        self.openList = openList
        self.onSaved = onSaved
        self.onDuplicate = onDuplicate
        _store = ObservedObject(wrappedValue: PhrasesStore.shared)
#if DEBUG
        let startsSaved = style == .sheet ? PhrasesStore.shared.previewSavedID : nil
#else
        let startsSaved: String? = nil
#endif
        _model = StateObject(wrappedValue: CaptureModel(prefill: prefill, startsSaved: startsSaved))
    }

    /// The server's phrase of the last save, followed while Sol works on it.
    private var phrase: SavedPhrase? { model.saved?.phraseID.flatMap { store.latest($0, in: client.state) } }
    /// Sol is still at it after 30 s: the card stops waiting («Мои фразы» shows it later).
    private var slow: Bool {
        guard let phrase else { return false }
        return phrase.enrichment == .pending && !store.polling.contains(phrase.id)
    }

    /// Web `captureEmotion`: curious idle, listening while he types, sad after a failed save, thinking while it saves and Sol
    /// works, happy when done, wink when it was already saved; the hop of the landing chip is happy.
    private var mood: VoiceOrbMood {
        if cheering { return .happy }
        guard let saved = model.saved else {
            if model.error != nil { return .sad }
            return model.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? .curious : .listening
        }
        guard let phrase else { return saved.phraseID == nil ? .thinking : .happy }
        if saved.duplicate { return .wink }
        if phrase.enrichment == .pending { return slow ? .happy : .thinking }
        return phrase.enrichment == .failed ? .curious : .happy
    }

    /// «Готово: be on the same page — одинаково понимать задачу» for VoiceOver once Sol is done.
    private var readyLine: String? {
        guard style == .sheet, let phrase, phrase.enrichment == .ready, let target = clean(phrase.phrase) else { return nil }
        return "Готово: " + target + (clean(phrase.meaning).map { " — " + $0 } ?? "")
    }

    private var duplicateID: String? { model.saved?.duplicate == true ? model.saved?.phraseID : nil }
    /// The card's own success tap where no hop carries one (the field on «Мои фразы», Reduce Motion).
    private var hapticKey: Int { style == .inline || reduceMotion ? model.serial : 0 }

    var body: some View {
        Group {
            switch style {
            case .sheet: sheetLayout
            case .inline: inlineLayout
            }
        }
        .coordinateSpace(.named("capture-card"))
        .overlay(alignment: .topLeading) { flightLayer }
        .onAppear {
            model.onScreen = true
            focusOnOpen()
        }
        .onDisappear { model.onScreen = false }
        .onChange(of: model.text) { _, _ in model.textChanged() }
        .onChange(of: model.serial) { _, _ in onSaved?() }
        .onChange(of: duplicateID) { _, id in if let id { onDuplicate?(id) } }
        .onChange(of: readyLine) { _, line in if let line { model.announce(line) } }
        .sensoryFeedback(.success, trigger: hapticKey)
        .animation(reduceMotion ? NativeMotion.crossFade : NativeMotion.standard, value: model.saved == nil)
    }

    // MARK: Layouts

    private var sheetLayout: some View {
        VStack(spacing: 16) {
            VoiceOrb(mode: .ready, level: 0, mood: mood, celebrate: model.celebrate, interactive: true)
                .frame(width: 84, height: 84 * 1.045)
                .accessibilityHidden(true)
                .onGeometryChange(for: CGRect.self) { proxy in
                    proxy.frame(in: .named("capture-card"))
                } action: { frame in
                    mascotFrame = frame
                }
            if let saved = model.saved {
                SpeechBubble(title: saved.duplicate ? CaptureModel.duplicateTitle : CaptureModel.savedTitle,
                             detail: saved.duplicate ? nil : CaptureModel.savedDetail)
                VStack(spacing: 12) {
                    found(saved)
                    savedActions
                }
                .transition(reduceMotion ? AnyTransition.opacity : NativeMotion.insertion)
            } else {
                SpeechBubble(title: "Что запомним?")
                VStack(spacing: 10) {
                    field(lines: 3...6)
                    editingActions(compact: false)
                    statusLines
                }
                .transition(.opacity)
            }
        }
        .frame(maxWidth: .infinity)
    }

    private var inlineLayout: some View {
        VStack(alignment: .leading, spacing: 10) {
            field(lines: 2...5)
            editingActions(compact: true)
            statusLines
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // MARK: Parts

    private func field(lines: ClosedRange<Int>) -> some View {
        TextField("Фраза из видео или «как сказать …»", text: $model.text, axis: .vertical)
            .lineLimit(lines)
            .font(.body)
            .textInputAutocapitalization(.never)
            .focused($focused)
            .padding(14)
            .background(Theme.well, in: RoundedRectangle(cornerRadius: Radius.input, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: Radius.input, style: .continuous)
                    .strokeBorder(model.error != nil ? Theme.warning.opacity(0.7) : Theme.hairline, lineWidth: 1)
                    .allowsHitTesting(false)
            }
            .accessibilityLabel("Что запомним?")
            .accessibilityHint("Фраза из видео или «как сказать …»")
            .onGeometryChange(for: CGRect.self) { proxy in
                proxy.frame(in: .named("capture-card"))
            } action: { frame in
                fieldFrame = frame
            }
    }

    private func editingActions(compact: Bool) -> some View {
        HStack(spacing: 10) {
            PasteButton(payloadType: String.self) { strings in
                Task { @MainActor in model.paste(strings) }
            }
            .labelStyle(.titleAndIcon)
            .buttonBorderShape(.capsule)
            .controlSize(compact ? .regular : .large)
            .tint(Theme.violet)
            if compact { Spacer(minLength: 0) }
            Button(action: save) { Text("Запомнить") }
                .buttonStyle(PrimaryButton(compact: compact))
                .disabled(!model.canSave)
                .accessibilityHint("Сохраняет в «Мои фразы». Фраза вернётся в разговорах.")
        }
    }

    /// The reason of a failed save, a clipboard note, or (in the field on «Мои фразы») what just happened.
    @ViewBuilder private var statusLines: some View {
        if let error = model.error {
            statusLine(error, symbol: "exclamationmark.circle.fill", tint: Theme.warning)
        } else if let notice = model.notice {
            Text(notice).font(.footnote).foregroundStyle(Theme.inkSecondary)
                .frame(maxWidth: .infinity, alignment: .leading)
                .fixedSize(horizontal: false, vertical: true)
        } else if style == .inline, let saved = model.saved, model.text.isEmpty {
            statusLine(saved.duplicate ? CaptureModel.duplicateTitle : CaptureModel.savedTitle + " " + CaptureModel.savedDetail,
                       symbol: "checkmark.circle.fill", tint: Theme.limeInk)
        }
    }

    private func statusLine(_ text: String, symbol: String, tint: Color) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            Image(systemName: symbol).foregroundStyle(tint).accessibilityHidden(true)
            Text(text).foregroundStyle(Theme.ink).fixedSize(horizontal: false, vertical: true)
        }
        .font(.footnote.weight(.semibold))
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }

    /// What Sol found (or is still looking for), web `Found`.
    private func found(_ saved: CaptureModel.Saved) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            if let phrase, phrase.enrichment == .ready, let target = clean(phrase.phrase) {
                Text(PhraseLabels.english(target)).font(TypeScale.title3).fixedSize(horizontal: false, vertical: true)
                if let meaning = clean(phrase.meaning) {
                    Text(meaning).font(.subheadline).foregroundStyle(Theme.inkSecondary).fixedSize(horizontal: false, vertical: true)
                }
                if let example = clean(phrase.example) {
                    Text(PhraseLabels.english(example)).font(.subheadline).italic().fixedSize(horizontal: false, vertical: true)
                        .padding(.top, 4)
                }
                if let translation = clean(phrase.exampleRu) {
                    Text(translation).font(.footnote).foregroundStyle(Theme.inkSecondary).fixedSize(horizontal: false, vertical: true)
                }
            } else if let phrase, phrase.enrichment == .pending, slow {
                headline(phrase)
                Text("Разбор появится в «Моих фразах».").font(.footnote).foregroundStyle(Theme.inkSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            } else if let phrase, phrase.enrichment != .pending {
                headline(phrase)
                Text(clean(phrase.note) ?? "Разбор не получился. Повторить его можно в «Моих фразах».")
                    .font(.footnote).foregroundStyle(Theme.inkSecondary).fixedSize(horizontal: false, vertical: true)
            } else {
                Text(phrase.map(PhraseLabels.headline) ?? saved.text)
                    .font(.headline).lineLimit(4).fixedSize(horizontal: false, vertical: true)
                HStack(spacing: 8) {
                    ProgressView().controlSize(.small).tint(Theme.violet)
                    Text("Разбираю…").font(.footnote.weight(.semibold)).foregroundStyle(Theme.inkSecondary)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .contentSurface(radius: Radius.tile)
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder private func headline(_ phrase: SavedPhrase) -> some View {
        Group {
            if PhraseLabels.headlineIsEnglish(phrase) {
                Text(PhraseLabels.english(PhraseLabels.headline(phrase)))
            } else {
                Text(PhraseLabels.headline(phrase))
            }
        }
        .font(.headline)
        .lineLimit(4)
        .fixedSize(horizontal: false, vertical: true)
    }

    private var savedActions: some View {
        HStack(spacing: 14) {
            Button(action: again) {
                Label("Ещё одну", systemImage: "plus")
            }
            .buttonStyle(SecondaryButton(compact: true))
            .accessibilityHint("Очищает поле для следующей фразы")
            if let openList {
                Button(action: openList) {
                    HStack(spacing: 4) {
                        Text("Мои фразы")
                        Image(systemName: "arrow.right").imageScale(.small).accessibilityHidden(true)
                    }
                    .font(.subheadline.weight(.semibold))
                    .frame(minHeight: 44)
                    .contentShape(Rectangle())
                }
                .buttonStyle(PressButton())
                .foregroundStyle(Theme.violet)
                .accessibilityHint("Открывает все сохранённые фразы")
            }
        }
    }

    /// The text chip that flies from the field into the chubrik (sheet only, never with Reduce Motion).
    @ViewBuilder private var flightLayer: some View {
        if let flight {
            Text(flight.text)
                .font(.subheadline.weight(.semibold))
                .lineLimit(1)
                .padding(.horizontal, 14)
                .padding(.vertical, 8)
                .foregroundStyle(Theme.onAccent)
                .background(Theme.lavender, in: Capsule())
                .frame(maxWidth: 260)
                .scaleEffect(flight.landed ? 0.22 : 1)
                .opacity(flight.landed ? 0 : 1)
                .position(flight.landed ? CGPoint(x: mascotFrame.midX, y: mascotFrame.minY + mascotFrame.height * 0.46)
                                        : CGPoint(x: flight.from.midX, y: flight.from.minY + min(flight.from.height / 2, 34)))
                .allowsHitTesting(false)
                .accessibilityHidden(true)
        }
    }

    // MARK: Actions

    private func save() {
        guard let text = PhraseLabels.captureText(model.text) else { return }
        let line = text.split(whereSeparator: \.isNewline).first.map(String.init) ?? text
        let from = fieldFrame
        focused = false
        guard model.save(client: client, store: store), style == .sheet,
              !reduceMotion, from != .zero, mascotFrame != .zero else { return }
        flight = ChipFlight(text: line, from: from, landed: false)
        cheering = true
        Task { @MainActor in
            // One frame at the start, otherwise SwiftUI merges both states and nothing moves.
            do { try await Task.sleep(for: .milliseconds(30)) } catch { return }
            withAnimation(.timingCurve(0.45, 0, 0.25, 1, duration: 0.6)) { flight?.landed = true }
            do { try await Task.sleep(for: .milliseconds(400)) } catch { return }
            model.hop()
            do { try await Task.sleep(for: .milliseconds(240)) } catch { return }
            flight = nil
            do { try await Task.sleep(for: .milliseconds(1_100)) } catch { return }
            cheering = false
        }
    }

    private func again() {
        model.reset()
        Task { @MainActor in
            do { try await Task.sleep(for: .milliseconds(120)) } catch { return }
            focused = true
        }
    }

    private func focusOnOpen() {
        guard autofocus, model.saved == nil else { return }
#if DEBUG
        if PreviewFixtures.screen != nil { return }
#endif
        Task { @MainActor in
            // After the sheet has risen: the keyboard never fights the presentation.
            do { try await Task.sleep(for: .milliseconds(380)) } catch { return }
            focused = true
        }
    }

    private func clean(_ value: String?) -> String? {
        guard let text = value?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty else { return nil }
        return text
    }
}

/// The saved text on its way into the chubrik.
private struct ChipFlight: Equatable {
    let text: String
    let from: CGRect
    var landed: Bool
}

// MARK: - Bubble

/// The chubrik's speech bubble: a solid surface with a small tail towards him (content, never glass).
struct SpeechBubble: View {
    let title: String
    var detail: String? = nil
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        VStack(spacing: 2) {
            Text(title)
                .font(.headline)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)
            if let detail {
                Text(detail)
                    .font(.subheadline)
                    .foregroundStyle(Theme.inkSecondary)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .foregroundStyle(Theme.ink)
        .padding(.horizontal, 18)
        .padding(.vertical, 10)
        .background {
            BubbleShape()
                .fill(Theme.solid)
                .shadow(color: Theme.cardShadow, radius: 8, x: 0, y: 3)
        }
        .padding(.top, 7)
        .contentTransition(.opacity)
        .animation(reduceMotion ? NativeMotion.crossFade : NativeMotion.standard, value: title)
        .accessibilityElement(children: .combine)
    }
}

/// A rounded rectangle with a small triangle above its top centre, pointing at the chubrik.
private struct BubbleShape: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path(roundedRect: rect, cornerRadius: 16, style: .continuous)
        let x = rect.midX
        path.move(to: CGPoint(x: x - 9, y: rect.minY + 1))
        path.addLine(to: CGPoint(x: x, y: rect.minY - 7))
        path.addLine(to: CGPoint(x: x + 9, y: rect.minY + 1))
        path.closeSubpath()
        return path
    }
}

// MARK: - Capture sheet root

/// The capture sheet (.medium / .large): the card, «Закрыть», and «Мои фразы» pushes the list in the same sheet.
struct CaptureScreen: View {
    let prefill: String?
    let close: () -> Void
    let openList: () -> Void

    var body: some View {
        ScrollView {
            CaptureCard(style: .sheet, prefill: prefill, autofocus: true, openList: openList)
                .padding(.horizontal, 20)
                .padding(.top, 12)
                .padding(.bottom, 24)
                .frame(maxWidth: 560)
                .frame(maxWidth: .infinity)
        }
        .scrollDismissesKeyboard(.interactively)
        .scrollBounceBehavior(.basedOnSize)
        .modifier(LiquidCanvas(intensity: 0.6))
        .navigationTitle("Запомнить фразу")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) { SheetCloseButton(title: "Закрыть", action: close) }
        }
    }
}
