import SwiftUI

// «Мои фразы» on the iPhone (planning/v05/PASS-0.5.3.md §1.5–1.6): the one phrases sheet (capture first or the list), the
// Practice «Для тебя» card, the compact Today row and the review block «Фразы из копилки». Words and order come from
// PhraseLabels (lib/phrases/labels.ts); the web counterparts are components/phrases/*.tsx and components/capture/*.

// MARK: - Sheet

/// The phrases sheet presented over the shell (`PhraseSheetsHost`): the capture card at .medium (its «Мои фразы» pushes the
/// list and grows the sheet), or «Мои фразы» at .large.
struct PhrasesSheet: View {
    let route: PhraseSheetRoute
    @Environment(\.dismiss) private var dismiss
    @State private var detent: PresentationDetent
    @State private var showList = false

    init(route: PhraseSheetRoute) {
        self.route = route
        var start: PresentationDetent = route.isList ? .large : .medium
#if DEBUG
        // `listen-analysing` / `listen-ready` capture the sheet at full height, as the result grows it.
        if let listen = PhrasesStore.shared.previewListen, listen != "listen-recording" { start = .large }
#endif
        _detent = State(initialValue: start)
    }

    var body: some View {
        NavigationStack {
            root
                .navigationDestination(isPresented: $showList) {
                    PhrasesListScreen()
                }
        }
        .presentationDetents([.medium, .large], selection: $detent)
        .presentationDragIndicator(.visible)
        .presentationCornerRadius(Radius.sheet)
    }

    @ViewBuilder private var root: some View {
        switch route {
        case .capture(let prefill, _):
            CaptureScreen(prefill: prefill, close: { dismiss() }, openList: {
                detent = .large
                showList = true
            }, expand: {
                detent = .large
            })
        case .list:
            PhrasesListScreen(close: { dismiss() })
        }
    }
}

// MARK: - «Мои фразы»

/// The capture field on top, «К повторению · N» / «Все · M», rows that expand (note, example, history, actions), «Повторить · N»
/// at the bottom while something waits, and «Фраза удалена · Вернуть» for six seconds after «Удалить» (web phrases-sheet.tsx).
struct PhrasesListScreen: View {
    var close: (() -> Void)? = nil
    @EnvironmentObject private var client: TrainingClient
    @ObservedObject private var store: PhrasesStore
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    /// "due" | "all"; empty until chosen: the list opens on what waits, when anything does.
    @State private var segment = ""
    @State private var expanded: String?
    @State private var scrollTarget: String?

    init(close: (() -> Void)? = nil) {
        self.close = close
        _store = ObservedObject(wrappedValue: PhrasesStore.shared)
    }

    var body: some View {
        let now = Date()
        let all = store.phrases(in: client.state, lastRefresh: client.lastRefresh)
        let queue = PhraseLabels.toRepeat(all, now: now)
        let selected = segment.isEmpty ? (queue.isEmpty ? "all" : "due") : segment
        let rows = selected == "due" ? queue : all
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    Text("Возвращаются в разговорах, пока не станут твоими.")
                        .font(.subheadline)
                        .foregroundStyle(Theme.inkSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                    CaptureCard(style: .inline, onSaved: { segment = "all" }, onDuplicate: { id in show(id) })
                    if let notice = store.notice {
                        InlineBanner(tone: .error, title: "Не получилось", message: notice, dismiss: { store.notice = nil })
                    }
                    if !all.isEmpty {
                        SelectionRow(selection: Binding(get: { selected }, set: { segment = $0 }), options: [
                            SelectionOption(id: "due", title: "К повторению · \(queue.count)", icon: "clock.arrow.circlepath"),
                            SelectionOption(id: "all", title: "Все · \(all.count)", icon: "tray.full")])
                    }
                    if all.isEmpty {
                        emptyLine("Пока пусто. Запомни первую фразу — она вернётся в разговорах.")
                    } else if rows.isEmpty {
                        emptyLine(nothingDue(all, now: now))
                    } else {
                        rowsSurface(rows, now: now)
                    }
                }
                .padding(.horizontal, 20)
                .padding(.top, 8)
                .padding(.bottom, 24)
                .frame(maxWidth: 680)
                .frame(maxWidth: .infinity)
                .animation(reduceMotion ? NativeMotion.crossFade : NativeMotion.standard, value: rows.map(\.id))
            }
            .scrollDismissesKeyboard(.interactively)
            .onChange(of: scrollTarget) { _, id in
                guard let id else { return }
                withAnimation(reduceMotion ? nil : NativeMotion.standard) { proxy.scrollTo(id, anchor: .center) }
                scrollTarget = nil
            }
        }
        .modifier(LiquidCanvas(intensity: 0.6))
        .safeAreaInset(edge: .bottom, spacing: 0) { footer(round: PhraseSchedule.roundCandidates(all, now: now).count) }
        .navigationTitle("Мои фразы")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if let close {
                ToolbarItem(placement: .cancellationAction) { SheetCloseButton(title: "Закрыть", action: close) }
            }
        }
        .onAppear(perform: opened)
    }

    private func emptyLine(_ text: String) -> some View {
        Text(text)
            .font(.subheadline)
            .foregroundStyle(Theme.inkSecondary)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.vertical, 6)
    }

    private func nothingDue(_ all: [SavedPhrase], now: Date) -> String {
        guard let next = PhraseLabels.overview(all, now: now).next else { return "Сейчас нечего повторять." }
        return "Сейчас нечего повторять — следующая " + next + "."
    }

    private func rowsSurface(_ rows: [SavedPhrase], now: Date) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(rows.enumerated()), id: \.element.id) { index, phrase in
                if index > 0 { RowDivider() }
                PhraseRow(phrase: phrase, now: now, expanded: expanded == phrase.id) { toggle(phrase.id) }
                    .id(phrase.id)
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: Radius.card, style: .continuous))
        .contentSurface()
    }

    @ViewBuilder private func footer(round: Int) -> some View {
        if store.undo.undoable != nil || round > 0 {
            VStack(spacing: 10) {
                if store.undo.undoable != nil {
                    PhraseRemovedCapsule { store.undoRemoval() }
                        .transition(reduceMotion ? AnyTransition.opacity : AnyTransition.move(edge: .bottom).combined(with: .opacity))
                }
                if round > 0 {
                    Button { store.requestRound() } label: {
                        PrimaryActionLabel(title: "Повторить · \(round)", icon: "waveform")
                    }
                    .buttonStyle(PrimaryButton())
                    .disabled(client.busy || client.startingIntent != nil || client.recording || store.roundStarting)
                    .accessibilityHint("Короткий разговор, где ты говоришь эти фразы вслух. " + ModeCopy.title("learning") + ".")
                    .contextMenu {
                        Button { store.requestRound(mode: "learning") } label: { Label(ModeCopy.title("learning"), systemImage: "lightbulb") }
                        Button { store.requestRound(mode: "call") } label: { Label(ModeCopy.title("call"), systemImage: "phone") }
                    }
                }
            }
            .padding(.horizontal, 20)
            .padding(.top, 6)
            .padding(.bottom, 8)
            .frame(maxWidth: 680)
            .frame(maxWidth: .infinity)
            .animation(reduceMotion ? NativeMotion.crossFade : NativeMotion.standard, value: store.undo.undoable)
        }
    }

    private func toggle(_ id: String) {
        withAnimation(reduceMotion ? NativeMotion.crossFade : NativeMotion.standard) {
            expanded = expanded == id ? nil : id
        }
    }

    /// Opens one phrase in place: on «К повторению» when it waits, otherwise on «Все».
    private func show(_ id: String) {
        let all = store.phrases(in: client.state, lastRefresh: client.lastRefresh)
        guard all.contains(where: { $0.id == id }) else { return }
        segment = PhraseLabels.toRepeat(all).contains(where: { $0.id == id }) ? "due" : "all"
        withAnimation(reduceMotion ? NativeMotion.crossFade : NativeMotion.standard) { expanded = id }
        scrollTarget = id
    }

    /// Each opening: a phrase asked for (a chip on Practice) opens in place; phrases saved elsewhere that Sol still works on
    /// are followed while the list is open.
    private func opened() {
#if DEBUG
        let focus = store.takeFocus() ?? (expanded == nil ? store.previewExpanded : nil)
#else
        let focus = store.takeFocus()
#endif
        if let focus { show(focus) }
        let pending = store.phrases(in: client.state, lastRefresh: client.lastRefresh).filter { $0.enrichment == .pending }
        for phrase in pending.prefix(5) { store.poll(phrase.id, client: client) }
    }
}

/// One saved phrase: the expression (or the raw text while Sol works), its meaning and when it comes back; a tap opens the
/// note, the example, how it sounded and the actions.
private struct PhraseRow: View {
    let phrase: SavedPhrase
    let now: Date
    let expanded: Bool
    let toggle: () -> Void
    @EnvironmentObject private var client: TrainingClient
    @ObservedObject private var store: PhrasesStore
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    init(phrase: SavedPhrase, now: Date, expanded: Bool, toggle: @escaping () -> Void) {
        self.phrase = phrase
        self.now = now
        self.expanded = expanded
        self.toggle = toggle
        _store = ObservedObject(wrappedValue: PhrasesStore.shared)
    }

    private var enriching: Bool { phrase.enrichment == .pending }
    private var headline: String { PhraseLabels.headline(phrase) }
    private var dueLabel: String? { PhraseLabels.dueLabel(phrase, now: now) }
    private var resting: Bool { phrase.archived || phrase.status == .learned }
    private var busy: Bool { store.working.contains(phrase.id) }

    /// Under the headline: «Разбираю…», why Sol could not take it apart, or the meaning.
    private var sub: String? {
        if enriching { return "Разбираю…" }
        if phrase.enrichment == .failed { return PhraseLabels.enrichmentProblem(phrase) }
        return clean(phrase.meaning)
    }

    /// What he saved, when Sol turned it into a different expression.
    private var original: String? {
        guard phrase.enrichment == .ready, let target = clean(phrase.phrase) else { return nil }
        let text = phrase.text.trimmingCharacters(in: .whitespacesAndNewlines)
        return text.lowercased() == target.lowercased() ? nil : text
    }

    private var dueColor: Color {
        if resting { return Theme.limeInk }
        return dueLabel == "сегодня" ? Theme.violet : Theme.inkSecondary
    }

    /// 0.5.4: the clip line a «Послушать» phrase was heard in.
    private var heard: String? { PhraseLabels.heard(phrase) }

    private var spoken: String {
        [headline, sub, heard.map { "услышал: " + $0 }, dueLabel].compactMap { $0 }.joined(separator: ", ")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button(action: toggle) { header }
                .buttonStyle(RowButtonStyle())
                .accessibilityLabel(spoken)
                .accessibilityValue(expanded ? "Развёрнуто" : "Свёрнуто")
                .accessibilityHint(expanded ? "Сворачивает подробности" : "Показывает пример, историю и действия")
            if expanded {
                details
                    .padding(.horizontal, 16)
                    .padding(.bottom, 14)
                    .transition(reduceMotion ? AnyTransition.opacity : NativeMotion.insertion)
            }
        }
    }

    private var header: some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                Group {
                    if PhraseLabels.headlineIsEnglish(phrase) { Text(PhraseLabels.english(headline)) } else { Text(headline) }
                }
                .font(.subheadline.weight(.semibold))
                .multilineTextAlignment(.leading)
                .lineLimit(expanded ? nil : 3)
                .fixedSize(horizontal: false, vertical: true)
                if let sub {
                    HStack(spacing: 6) {
                        if enriching { ProgressView().controlSize(.mini).tint(Theme.violet) }
                        Text(sub).multilineTextAlignment(.leading).lineLimit(expanded ? nil : 2)
                    }
                    .font(.footnote)
                    .foregroundStyle(Theme.inkSecondary)
                }
                if let heard {
                    HeardLine(text: heard, lineLimit: expanded ? nil : 2)
                }
            }
            Spacer(minLength: 8)
            if let dueLabel {
                Text(dueLabel).font(.caption.weight(.semibold)).foregroundStyle(dueColor)
            }
            Image(systemName: "chevron.down")
                .font(.caption.weight(.semibold))
                .foregroundStyle(Theme.inkTertiary)
                .rotationEffect(.degrees(expanded ? 180 : 0))
                .accessibilityHidden(true)
        }
        .foregroundStyle(Theme.ink)
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .frame(maxWidth: .infinity, minHeight: 56, alignment: .leading)
        .contentShape(Rectangle())
    }

    private var details: some View {
        VStack(alignment: .leading, spacing: 12) {
            if let original {
                Text("Сохранено: «" + original + "»")
                    .font(.footnote).foregroundStyle(Theme.inkSecondary).fixedSize(horizontal: false, vertical: true)
            }
            if phrase.enrichment == .ready, let note = clean(phrase.note) {
                Text(note).font(.footnote).fixedSize(horizontal: false, vertical: true)
            }
            if let example = clean(phrase.example) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(PhraseLabels.english(example)).font(.subheadline).italic().fixedSize(horizontal: false, vertical: true)
                    if let translation = clean(phrase.exampleRu) {
                        Text(translation).font(.footnote).foregroundStyle(Theme.inkSecondary).fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
            if !phrase.history.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    ForEach(Array(phrase.history.enumerated()), id: \.offset) { _, entry in
                        Text(PhraseLabels.historyLine(entry)).font(.footnote).foregroundStyle(Theme.inkSecondary)
                    }
                }
                .accessibilityElement(children: .combine)
                .accessibilityLabel("Как она звучала: " + phrase.history.map { PhraseLabels.historyLine($0) }.joined(separator: "; "))
            }
            actions
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var actions: some View {
        ChipFlow(spacing: 8) {
            if phrase.enrichment == .failed {
                Button { retry() } label: { Label("Повторить разбор", systemImage: "arrow.clockwise") }
                    .buttonStyle(QuietButton())
            }
            if resting {
                Button("Вернуть в повторение") { restore() }
                    .buttonStyle(QuietButton())
                    .accessibilityHint("Фраза снова будет возвращаться в разговорах")
            } else {
                Button("Уже знаю") { archive() }
                    .buttonStyle(QuietButton())
                    .accessibilityHint("Фраза останется в списке, но в разговорах больше не появится")
            }
            Button("Удалить") { store.remove(phrase, client: client) }
                .buttonStyle(DestructiveQuietButton())
                .accessibilityLabel("Удалить фразу «" + headline + "»")
                .accessibilityHint("Шесть секунд её можно вернуть")
        }
        .disabled(busy)
    }

    private func archive() {
        Task { await store.update(phrase, archived: true, failure: "Не удалось отметить фразу.", client: client) }
    }

    /// Not archived (so learned) → relearn; archived and learned → both; archived only → back into the schedule as it was.
    private func restore() {
        Task {
            await store.update(phrase, archived: phrase.archived ? false : nil, relearn: phrase.status == .learned,
                               failure: "Не удалось вернуть фразу в повторение.", client: client)
        }
    }

    private func retry() {
        Task { await store.update(phrase, retryEnrichment: true, failure: "Не удалось повторить разбор.", client: client) }
    }

    private func clean(_ value: String?) -> String? {
        guard let text = value?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty else { return nil }
        return text
    }
}

/// «Фраза удалена · Вернуть»: floating chrome while the delete can still be undone (as «Занятие убрано» on Today).
private struct PhraseRemovedCapsule: View {
    let undo: () -> Void
    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: "checkmark.circle").font(.body.weight(.semibold)).foregroundStyle(Theme.inkSecondary)
                .accessibilityHidden(true)
            Text("Фраза удалена").font(.footnote.weight(.semibold))
            Spacer(minLength: 8)
            Button("Вернуть", action: undo)
                .buttonStyle(QuietButton())
                .accessibilityHint("Возвращает фразу в список")
        }
        .foregroundStyle(Theme.ink)
        .padding(.leading, 18).padding(.trailing, 6).padding(.vertical, 6)
        .frame(maxWidth: 560)
        .modifier(LiquidChrome(radius: 28, tint: nil, interactive: false))
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Practice «Для тебя»

/// «Мои фразы» on Practice, between the drills and the patterns (web phrases-card.tsx): how many are saved; when some wait,
/// «N ждут повторения», up to three of them (a tap opens that one) and «Повторить» (a phrase round «С опорами»); always
/// «Запомнить» (the capture sheet) and «Все» (the phrases sheet).
struct PracticePhrasesCard: View {
    @EnvironmentObject private var client: TrainingClient
    @ObservedObject private var store: PhrasesStore

    init() {
        _store = ObservedObject(wrappedValue: PhrasesStore.shared)
    }

    private var blocked: Bool { client.busy || client.startingIntent != nil || client.recording || store.roundStarting }

    var body: some View {
        let overview = store.overview(in: client.state, lastRefresh: client.lastRefresh)
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .firstTextBaseline, spacing: 12) {
                Text(overview.total > 0 ? "Мои фразы · \(overview.total)" : "Мои фразы")
                    .font(TypeScale.headline.weight(.semibold))
                    .accessibilityAddTraits(.isHeader)
                Spacer(minLength: 8)
                Button { store.openList() } label: {
                    HStack(spacing: 4) {
                        Text("Все")
                        Image(systemName: "chevron.right").imageScale(.small).accessibilityHidden(true)
                    }
                    .font(.subheadline.weight(.semibold))
                    .frame(minHeight: 44)
                    .contentShape(Rectangle())
                }
                .buttonStyle(PressButton())
                .foregroundStyle(Theme.violet)
                .accessibilityLabel("Все фразы")
                .accessibilityHint("Открывает «Мои фразы»")
            }
            if overview.due > 0 {
                Text(PhraseLabels.waiting(overview.due)).font(.subheadline.weight(.semibold))
                ChipFlow(spacing: 8) {
                    ForEach(overview.chips) { chip in
                        Button { store.openList(focus: chip.id) } label: {
                            Text(PhraseLabels.english(chip.text))
                                .font(.footnote.weight(.medium))
                                .lineLimit(1)
                                .padding(.horizontal, 12).padding(.vertical, 8)
                                .frame(minHeight: 36)
                                .background(Theme.fill, in: Capsule())
                                .contentShape(Capsule())
                        }
                        .buttonStyle(PressButton())
                        .foregroundStyle(Theme.ink)
                        .accessibilityHint("Открывает эту фразу в «Мои фразы»")
                    }
                }
            } else if overview.total > 0 {
                Text("Сейчас повторять нечего" + (overview.next.map { " · следующая " + $0 } ?? "") + ".")
                    .font(.subheadline).foregroundStyle(Theme.inkSecondary).fixedSize(horizontal: false, vertical: true)
            } else {
                Text("Запоминай фразы, которые встретил: они вернутся в разговорах.")
                    .font(.subheadline).foregroundStyle(Theme.inkSecondary).fixedSize(horizontal: false, vertical: true)
            }
            HStack(spacing: 10) {
                if overview.due > 0 {
                    Button { Task { await client.startPhraseRound() } } label: {
                        HStack(spacing: 8) {
                            if store.roundStarting { ProgressView().tint(Theme.ctaLabel) }
                            Text(store.roundStarting ? "Готовлю…" : "Повторить")
                        }
                    }
                    .buttonStyle(PrimaryButton(compact: true))
                    .disabled(blocked)
                    .accessibilityHint("Короткий разговор, где ты говоришь эти фразы вслух. " + ModeCopy.title("learning") + ".")
                    .contextMenu {
                        Button { Task { await client.startPhraseRound(mode: "call") } } label: {
                            Label(ModeCopy.title("call"), systemImage: "phone")
                        }
                    }
                }
                Button { store.openCapture() } label: {
                    Label("Запомнить", systemImage: "plus")
                }
                .buttonStyle(SecondaryButton(compact: true))
                .accessibilityHint("Открывает поле, чтобы сохранить фразу")
                Spacer(minLength: 0)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentSurface(radius: Radius.tile)
    }
}

// MARK: - Today

/// One compact row under Today's primary card while phrases wait: «Мои фразы · N ждут повторения» (the row opens the sheet)
/// → «Повторить». Never the primary card; hidden otherwise (web today-phrases.tsx).
struct TodayPhrasesRow: View {
    @EnvironmentObject private var client: TrainingClient
    @ObservedObject private var store: PhrasesStore

    init() {
        _store = ObservedObject(wrappedValue: PhrasesStore.shared)
    }

    var body: some View {
        let due = store.overview(in: client.state, lastRefresh: client.lastRefresh).due
        if due > 0 {
            HStack(spacing: 8) {
                Button { store.openList() } label: {
                    HStack(spacing: 14) {
                        Image(systemName: "text.bubble").font(.body.weight(.medium)).foregroundStyle(Theme.violet)
                            .frame(width: 26).accessibilityHidden(true)
                        (Text("Мои фразы").fontWeight(.semibold) + Text(" · " + PhraseLabels.waiting(due)))
                            .font(.subheadline)
                            .multilineTextAlignment(.leading)
                            .fixedSize(horizontal: false, vertical: true)
                        Spacer(minLength: 0)
                    }
                    .padding(.leading, 16)
                    .padding(.vertical, 12)
                    .frame(maxWidth: .infinity, minHeight: 60, alignment: .leading)
                    .contentShape(Rectangle())
                }
                .buttonStyle(RowButtonStyle())
                .accessibilityHint("Открывает «Мои фразы»")
                Button {
                    Task { await client.startPhraseRound() }
                } label: {
                    HStack(spacing: 6) {
                        if store.roundStarting { ProgressView().controlSize(.small) }
                        Text("Повторить")
                    }
                }
                .buttonStyle(SecondaryButton(compact: true))
                .disabled(client.busy || client.startingIntent != nil || client.recording || store.roundStarting)
                .accessibilityLabel("Повторить фразы")
                .accessibilityHint("Короткий разговор, где ты говоришь их вслух. " + ModeCopy.title("learning") + ".")
                .padding(.trailing, 10)
            }
            .foregroundStyle(Theme.ink)
            .clipShape(RoundedRectangle(cornerRadius: Radius.tile, style: .continuous))
            .contentSurface(radius: Radius.tile)
            .accessibilityElement(children: .contain)
        }
    }
}

// MARK: - Review

/// «Фразы из копилки» right after the review summary (web phrase-results.tsx): ✓ «phrase» · meaning · «his sentence» for the
/// ones he used; ○ for the rest — «Не прозвучала — вернётся завтра» in a phrase round, «Повода не было» when they were only
/// woven into an ordinary lesson. Sessions without phrase results (all older ones) show nothing.
struct PhraseResultsBlock: View {
    let conversation: Conversation

    var body: some View {
        if let results = conversation.phraseResults, !results.isEmpty {
            let round = PhraseLabels.isRound(familyId: conversation.lesson.familyId)
            VStack(alignment: .leading, spacing: 10) {
                LiquidSectionHeader(title: "Фразы из копилки", systemImage: "text.badge.checkmark")
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(Array(results.enumerated()), id: \.offset) { index, result in
                        if index > 0 { RowDivider(inset: 0) }
                        PhraseResultRow(result: result, round: round)
                    }
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 4)
                .contentSurface(radius: Radius.tile)
            }
        }
    }
}

private struct PhraseResultRow: View {
    let result: PhraseResult
    let round: Bool

    private var meaning: String? {
        guard let text = result.meaning?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty else { return nil }
        return text
    }
    private var quote: String? {
        guard result.used, let text = result.quote?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty else { return nil }
        return text
    }
    private var note: String? { PhraseLabels.resultNote(used: result.used, hinted: result.hinted, round: round) }
    private var spoken: String {
        var parts = [(result.used ? "Прозвучала: «" : "«") + result.phrase + "»"]
        if let meaning { parts.append(meaning) }
        if let quote { parts.append("«" + quote + "»") }
        if let note { parts.append(note) }
        return parts.joined(separator: ". ")
    }

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            Image(systemName: result.used ? "checkmark.circle.fill" : "circle")
                .font(.body.weight(.semibold))
                .foregroundStyle(result.used ? Theme.limeInk : Theme.inkTertiary)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 4) {
                (Text("«") + Text(PhraseLabels.english(result.phrase)) + Text("»")
                    + Text(meaning.map { " · " + $0 } ?? "").foregroundStyle(Theme.inkSecondary).fontWeight(.regular))
                    .font(.subheadline.weight(.semibold))
                    .fixedSize(horizontal: false, vertical: true)
                if let quote {
                    (Text("«") + Text(PhraseLabels.english(quote)) + Text("»"))
                        .font(.footnote).italic()
                        .foregroundStyle(Theme.inkSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if let note {
                    Text(note).font(.footnote).foregroundStyle(Theme.inkSecondary).fixedSize(horizontal: false, vertical: true)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(spoken)
    }
}

// MARK: - Previews

#if DEBUG
/// Synthetic «Мои фразы» for CI screenshots: `--preview=phrases` (the sheet over Practice, one row open), `capture` (the
/// capture sheet over Today with a shared text), `capture-saved` (the same card after a save), `phrase-review` (a finished
/// phrase round) and the «Послушать» states of the capture sheet (PASS-0.5.4 §1.5): `listen-recording` (the pill),
/// `listen-analysing` (the transcript with «Разбираю…») and `listen-ready` (the result). Generic, fictional English only.
@MainActor enum PhrasesPreview {
    static let screens: Set<String> = ["phrases", "capture", "capture-saved", "phrase-review",
                                       "listen-recording", "listen-analysing", "listen-ready"]

    /// Opens the sheet a preview screen shows, through the same gate as a quick action (after the launch layer).
    static func install(_ client: TrainingClient, screen: String) {
        let store = PhrasesStore.shared
        switch screen {
        case "capture":
            AppEntryInbox.shared.requestCapture(text: "be on the same page")
        case "capture-saved":
            store.previewSavedID = "preview-phrase-circle"
            AppEntryInbox.shared.requestCapture(text: nil)
        case "listen-recording", "listen-analysing", "listen-ready":
            store.previewListen = screen
            AppEntryInbox.shared.requestCapture(text: nil)
        case "phrases":
            store.previewExpanded = "preview-phrase-ballpark"
            AppEntryInbox.shared.request(.list)
        default:
            break
        }
    }

    /// `TrainingState.phrases` for every preview: two waiting, one scheduled, one being taken apart, learned, archived, failed.
    static func phrases() -> [[String: Any]] {
        let iso = ISO8601DateFormatter()
        func at(_ hours: Double) -> String { iso.string(from: Date().addingTimeInterval(hours * 3_600)) }
        func value(_ text: String?) -> Any {
            if let text { return text }
            return NSNull()
        }
        func item(_ id: String, _ text: String, enrichment: String = "ready", phrase: String?, meaning: String?, note: String? = nil,
                  example: String? = nil, exampleRu: String? = nil, status: String = "learning", stage: Int = 1, due: Double = -2,
                  created: Double = -48, history: [[String: Any]] = [], archived: Bool = false, heard: String? = nil) -> [String: Any] {
            ["id": id, "text": text, "origin": "iphone", "createdAt": at(created), "updatedAt": at(created), "enrichment": enrichment,
             "phrase": value(phrase), "meaning": value(meaning), "note": value(note), "example": value(example),
             "exampleRu": value(exampleRu), "cue": NSNull(), "situation": NSNull(), "status": status, "stage": stage,
             "dueAt": at(due), "lastPracticedAt": NSNull(), "lastOfferedAt": NSNull(), "history": history, "archived": archived,
             "heard": value(heard)]
        }
        func entry(_ hours: Double, _ result: String) -> [String: Any] {
            ["at": at(hours), "sessionId": "preview-session-" + result, "result": result]
        }
        return [
            item("preview-phrase-week", "как сказать «давай созвонимся на неделе»", enrichment: "pending", phrase: nil, meaning: nil,
                 status: "new", stage: 0, due: -0.05, created: -0.05),
            item("preview-phrase-circle", "circle back", phrase: "circle back", meaning: "вернуться к вопросу позже",
                 note: "Нейтрально и вежливо: так откладывают тему, не закрывая её.",
                 example: "Let's circle back to the budget once we've seen the first draft.",
                 exampleRu: "Давай вернёмся к бюджету, когда увидим первый черновик.", status: "new", stage: 0, due: -1, created: -1),
            item("preview-phrase-ballpark", "ballpark figure", phrase: "a ballpark figure", meaning: "примерная цифра",
                 note: "Просят или дают оценку без точного расчёта.",
                 example: "Could you give me a ballpark figure for the whole project?",
                 exampleRu: "Можешь назвать примерную цифру за весь проект?", due: -5, created: -72,
                 history: [entry(-26, "hinted"), entry(-70, "missed")],
                 heard: "Just give me a ballpark figure and we'll take it from there."),
            item("preview-phrase-page", "be on the same page", phrase: "be on the same page", meaning: "одинаково понимать задачу",
                 example: "Let's do a quick call so we're on the same page.",
                 exampleRu: "Давай быстро созвонимся, чтобы одинаково понимать задачу.", stage: 2, due: 72, created: -120,
                 history: [entry(-24, "used")]),
            item("preview-phrase-hurry", "как сказать «это не горит»", enrichment: "failed", phrase: nil, meaning: nil,
                 note: "Не понял, что запомнить. Попробуй сформулировать иначе.", status: "new", stage: 0, due: -3, created: -3),
            item("preview-phrase-touch", "touch base", phrase: "touch base", meaning: "коротко связаться", status: "learned", stage: 5,
                 due: 24 * 30, created: -24 * 40, history: [entry(-30, "used")]),
            item("preview-phrase-posted", "keep me posted", phrase: "keep me posted", meaning: "держи меня в курсе", stage: 2,
                 due: -10, created: -24 * 12, archived: true),
        ]
    }

    /// `--preview=phrase-review`: a finished «Мои фразы» round (said, said after a hint, not said).
    static func makeReview(_ value: inout [String: Any]) {
        let lesson: [String: Any] = [
            "title": "Мои фразы · 3", "goal": "Сказать свои фразы к месту, своими словами вокруг них.",
            "why": "Фраза становится твоей, когда ты сам говоришь её в разговоре.", "minutes": 5, "context": "work",
            "kind": "practice", "activity": "speaking", "format": "conversation", "familyId": PhraseLabels.roundFamily,
            "phraseIds": ["preview-phrase-circle", "preview-phrase-ballpark", "preview-phrase-page"],
            "mustInclude": ["circle back", "a ballpark figure", "be on the same page"]]
        let turns: [[String: Any]] = [
            ["id": "a1", "role": "assistant", "text": "We're almost out of time, and the budget question is still open."],
            ["id": "u1", "role": "user", "text": "No problem, let's circle back to the budget after the demo."],
            ["id": "a2", "role": "assistant", "text": "Sure. Before we plan anything, what would the whole thing cost, roughly?"],
            ["id": "u2", "role": "user", "text": "I can give you a ballpark figure by Friday.", "support": 1],
            ["id": "a3", "role": "assistant", "text": "Great. And the video length, is that settled on your side?"],
            ["id": "u3", "role": "user", "text": "Yes, about thirty seconds, like we said."]]
        let analysis: [String: Any] = [
            "version": 1,
            "summary": "Две фразы из трёх прозвучали к месту и своими словами. Третья не понадобилась — вернётся завтра.",
            "strengths": ["«Circle back» прозвучала естественно и вежливо закрыла тему."],
            "priorities": [] as [[String: Any]], "limitations": [] as [String]]
        let results: [[String: Any]] = [
            ["phraseId": "preview-phrase-circle", "phrase": "circle back", "meaning": "вернуться к вопросу позже", "used": true,
             "hinted": false, "quote": "No problem, let's circle back to the budget after the demo."],
            ["phraseId": "preview-phrase-ballpark", "phrase": "a ballpark figure", "meaning": "примерная цифра", "used": true,
             "hinted": true, "quote": "I can give you a ballpark figure by Friday."],
            ["phraseId": "preview-phrase-page", "phrase": "be on the same page", "meaning": "одинаково понимать задачу",
             "used": false, "hinted": false, "quote": NSNull()]]
        value["status"] = "review"
        value["lesson"] = lesson
        value["turns"] = turns
        value["analysis"] = analysis
        value["completion"] = ["canComplete": true, "needsRetry": false] as [String: Any]
        value["phraseResults"] = results
    }

    /// `listen-analysing` / `listen-ready`: a short clip of a fictional cooking video, transcribed; ready, it carries the gist,
    /// two new expressions, one that was already saved and three points.
    static func listenClip(ready: Bool) -> ListenClip {
        let iso = ISO8601DateFormatter()
        let now = iso.string(from: Date().addingTimeInterval(-20))
        let transcript = "Okay, so the sauce is a bit too thick. No worries, we'll just thin it out with some pasta water. "
            + "I've never tried it with lemon before, but let's give it a shot. See? It comes together in no time. "
            + "And if it tastes a little flat, don't be shy with the salt."
        guard ready else {
            return ListenClip(id: "preview-listen", createdAt: now, updatedAt: now, seconds: 24, transcript: transcript,
                              status: .analyzing)
        }
        func saved(_ id: String, _ phrase: String, _ meaning: String, note: String, example: String, exampleRu: String,
                   heard: String) -> SavedPhrase {
            SavedPhrase(id: id, text: phrase, origin: .iphone, createdAt: now, updatedAt: now, enrichment: .ready, phrase: phrase,
                        meaning: meaning, note: note, example: example, exampleRu: exampleRu, status: .new, stage: 0, dueAt: now,
                        heard: heard)
        }
        let phrases = [
            ListenPhrase(phrase: saved("preview-listen-shot", "give it a shot", "попробовать, рискнуть",
                                       note: "Легко и по-дружески: так соглашаются попробовать что-то новое.",
                                       example: "I've never edited a vertical video before, but I'll give it a shot.",
                                       exampleRu: "Я ещё не монтировал вертикальное видео, но попробую.",
                                       heard: "I've never tried it with lemon before, but let's give it a shot.")),
            ListenPhrase(phrase: saved("preview-listen-time", "in no time", "очень быстро, моментально",
                                       note: "Разговорное: обещают, что займёт совсем немного времени.",
                                       example: "Send me the notes and I'll fix it in no time.",
                                       exampleRu: "Пришли заметки — исправлю моментально.",
                                       heard: "See? It comes together in no time.")),
            ListenPhrase(phrase: saved("preview-listen-worries", "no worries", "ничего страшного",
                                       note: "Спокойный ответ на мелкую проблему или извинение.",
                                       example: "No worries, we can move the call to Friday.",
                                       exampleRu: "Ничего страшного, перенесём созвон на пятницу.",
                                       heard: "No worries, we'll just thin it out with some pasta water."), duplicate: true),
        ]
        return ListenClip(id: "preview-listen", createdAt: now, updatedAt: now, seconds: 24, transcript: transcript,
                          status: .ready,
                          gist: "Повар показывает соус к пасте: разбавляет его водой от пасты, добавляет лимон и советует не жалеть соли.",
                          points: ["«Thin it out» — фразовый глагол «разбавить, сделать жиже»; обратное — «thicken».",
                                   "«Don't be shy with the salt» — разговорное «не жалей соли»: так советуют не скупиться.",
                                   "В быстрой речи «give it a» сливается почти в одно слово: «гивитэ»."],
                          phrases: phrases)
    }
}
#endif
