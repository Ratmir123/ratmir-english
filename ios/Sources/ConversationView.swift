import SwiftUI

/// One lesson: live conversation → analysis → review with the retry loop.
struct ConversationView: View {
    let id: String
    @EnvironmentObject private var client: TrainingClient
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var showBrief = false
    @State private var briefInitialized = false
    @State private var showConversation = false
    @State private var showListeningCheck = false
    @State private var analysisStartedAt = Date()
    @State private var reviewComposerOpen = false
    @State private var pushbackComposerOpen = false
    /// Leaving a step asks only when an unsent draft would be lost (MOTION-PASS §8.5).
    @State private var unsentIntent: UnsentDraftIntent?
    @State private var showTiming = false
    @State private var freshRetry: Int? = nil
    @State private var celebrate = 0
    @State private var improvedTick = 0
    @State private var notImprovedTick = 0

    private var conversation: Conversation? { client.conversation }

    var body: some View {
        NavigationStack {
            ScrollViewReader { proxy in
                ScrollView {
                    content
                        .padding(.horizontal, 20).padding(.top, 8).padding(.bottom, 24)
                        .frame(maxWidth: 640).frame(maxWidth: .infinity)
                }
                .scrollDismissesKeyboard(.interactively)
                .onChange(of: conversation?.turns.count ?? 0) { _, _ in
                    if showConversation { proxy.scrollTo("end", anchor: .bottom) }
                }
                .onChange(of: conversation?.retries.count ?? 0) { old, new in
                    handleRetries(old: old, new: new, proxy: proxy)
                }
                .onChange(of: conversation?.retries.last?.pushback?.held) { _, held in
                    handlePushback(held)
                }
#if DEBUG
                .task { await previewScroll(proxy) }
#endif
            }
            .modifier(ConversationDock(showsBackdrop: dockHasContent) { bottomDock })
            .modifier(LiquidCanvas(intensity: 0.7))
            .navigationTitle(navigationTitle)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { toolbarContent }
            .task(id: pollingKey) {
                if conversation?.status == "analysing" { analysisStartedAt = processingStart ?? client.reviewStartedAt ?? Date() }
                await client.pollReview()
            }
            .onAppear { initializeBrief() }
            // MOTION-PASS §8.5: leaving a step asks only when an unsent draft would be lost (the web FinishDialog wording).
            .confirmationDialog(unsentTitle, isPresented: unsentDialogShown, titleVisibility: .visible, presenting: unsentIntent) { intent in
                if intent == .finish && canSendBeforeFinishing {
                    Button("Отправить и закончить") { Task { await sendThenFinish() } }
                }
                Button(intent.discardTitle, role: .destructive) { discardAndLeave(intent) }
                Button("Вернуться к занятию", role: .cancel) {}
            } message: { intent in
                Text(intent.detail(textActivity: conversation?.isTextActivity == true))
            }
            .sensoryFeedback(.success, trigger: improvedTick)
            .sensoryFeedback(.warning, trigger: notImprovedTick)
            .mascotConfetti(trigger: celebrate, origin: UnitPoint(x: 0.5, y: 0.25))
        }
    }

    // MARK: Derived state

    private var navigationTitle: String {
        guard let value = conversation else { return "Разговор" }
        if value.analysis != nil { return "Твой разбор" }
        if value.isTextActivity { return value.isReading ? "Чтение" : "Письмо" }
        return "Разговор"
    }

    private var pollingKey: String { (conversation?.status ?? "") + "|" + (conversation?.processing?.stage ?? "") }

    private var processingStart: Date? {
        guard let value = conversation?.processing?.startedAt else { return nil }
        return NativeDate.parse(value)
    }

    private var waiting: Bool {
        client.voiceLoading || client.busy || conversation?.processing != nil || conversation?.status == "analysing"
    }

    private var orbMode: VoiceOrbMode {
        if client.recording { return .listening }
        if client.playing && !client.playingLearnerRecording { return .speaking }
        if waiting { return .thinking }
        return .ready
    }

    /// MASCOT-SPEC §8: speaking (lip-sync), listening, thinking, sad on errors.
    private var orbMood: VoiceOrbMood {
        if client.recording { return .listening }
        if client.playingLearnerRecording { return .attentive }
        if client.error != nil || conversation?.analysisFailed == true { return .sad }
        if client.playing { return .speaking }
        if waiting { return .thinking }
        if (conversation?.userTurnCount ?? 0) == 0 { return .determined }
        return .calm
    }

    private var voiceLabel: String {
        if client.recording { return "Слушаю тебя" }
        if client.playing { return client.playingLearnerRecording ? "Слушаем твою запись" : "Собеседник говорит" }
        if client.voiceLoading { return "Готовлю голос" }
        if client.busy { return client.operationStage ?? "Готовлю ответ" }
        if conversation?.status == "analysing" { return "Разбираю разговор" }
        if conversation?.processing != nil { return "Собеседник готовит ответ" }
        return "Твой ход"
    }

    private func mayComplete(_ value: Conversation) -> Bool {
        guard let analysis = value.analysis else { return false }
        if let completion = value.completion { return completion.canComplete }
        return analysis.priorities.isEmpty || hasConfirmedImprovement(value)
    }

    private func hasConfirmedImprovement(_ value: Conversation) -> Bool {
        guard let analysis = value.analysis else { return false }
        if let completion = value.completion, !completion.canComplete || completion.needsRetry { return false }
        return value.retries.contains { $0.improved == true && ($0.analysisVersion == nil || $0.analysisVersion == analysis.version) }
    }

    /// «Завершить занятие» / «Отложить попытку»: an unsent draft no longer blocks them (the learner confirms what
    /// is lost, §8.5); a recording that is not text yet does.
    private var canLeaveReview: Bool {
        conversation?.id == id && !client.busy && !client.recording && !client.microphoneStarting
            && !client.hasUnuploadedRecording && conversation?.analysis != nil
    }

    private var leaveBlockReason: String? {
        client.hasUnuploadedRecording && !client.busy && !client.recording ? "Сначала распознай или удали запись." : nil
    }

    /// An unsent draft no longer blocks finishing: the learner confirms what is lost (§8.5). A recording that is not
    /// text yet, and a reply the server already holds, still come first.
    private func canRequestReview(_ value: Conversation) -> Bool {
        value.id == id && !client.busy && !client.recording && !client.microphoneStarting && value.isLive
            && value.processing == nil && value.userTurnCount > 0 && !client.hasUnuploadedRecording && !serverHoldsReply
    }

    private var serverHoldsReply: Bool { client.pendingMessageID != nil && !client.pendingIsLocalOnly }

    private var canSendBeforeFinishing: Bool {
        !client.draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !client.hasUnuploadedRecording
            && !client.busy && conversation?.processing == nil && !serverHoldsReply
    }

    private var unsentDialogShown: Binding<Bool> {
        Binding(get: { unsentIntent != nil }, set: { shown in if !shown { unsentIntent = nil } })
    }

    private var unsentTitle: String {
        guard unsentIntent == .finish else { return "Есть неотправленная попытка" }
        return conversation?.isTextActivity == true ? "Есть неотправленный текст" : "Есть неотправленный ответ"
    }

    private func finishBlockReason(_ value: Conversation) -> String? {
        if client.recording || client.busy { return nil }
        if client.hasUnuploadedRecording { return "Сначала распознай или удали запись." }
        if serverHoldsReply { return "Сначала дождись ответа собеседника на последнюю реплику." }
        if value.processing != nil { return "Собеседник ещё отвечает." }
        return nil
    }

    private var dockHasContent: Bool {
        guard let value = conversation else { return false }
        if client.error != nil { return true }
        return value.analysis != nil || value.isLive || value.status == "completed"
    }

    private var settingsAction: (() -> Void)? {
        guard client.microphoneDenied else { return nil }
        return { client.openSystemSettings() }
    }

    // MARK: Events

    private func initializeBrief() {
        guard !briefInitialized else { return }
        briefInitialized = true
        showBrief = (conversation?.userTurnCount ?? 0) == 0
    }

    private func handleRetries(old: Int, new: Int, proxy: ScrollViewProxy) {
        guard new > old, let latest = conversation?.retries.last else { return }
        reviewComposerOpen = false
        freshRetry = new
        if latest.improved == true {
            improvedTick += 1
            celebrate += 1
        } else {
            notImprovedTick += 1
        }
        withAnimation(reduceMotion ? nil : NativeMotion.standard) { proxy.scrollTo("retry-latest", anchor: .top) }
    }

    private func handlePushback(_ held: Bool?) {
        guard let held else { return }
        pushbackComposerOpen = false
        if held {
            improvedTick += 1
            celebrate += 1
        } else {
            notImprovedTick += 1
        }
    }

    /// «Закончить и получить разбор», «Завершить занятие» and «Отложить попытку» (which parks the attempt: the
    /// lesson stays unfinished on Today) happen at once unless an unsent draft would be lost (§8.5).
    private func leave(_ intent: UnsentDraftIntent) {
        if client.hasUnsentAnswer {
            unsentIntent = intent
        } else {
            proceed(intent)
        }
    }

    private func proceed(_ intent: UnsentDraftIntent) {
        switch intent {
        case .finish: Task { await client.action("finish") }
        case .complete: Task { await client.action("complete", returnHome: true) }
        case .deferRetry: Task { await client.action("complete", deferRetry: true, returnHome: true) }
        }
    }

    private func discardAndLeave(_ intent: UnsentDraftIntent) {
        client.discardUnsentAnswer()
        proceed(intent)
    }

    private func sendThenFinish() async {
        await client.submit(.message)
        guard !client.hasUnsentAnswer, !client.hasUnuploadedRecording, client.error == nil else { return }
        await client.action("finish")
    }

#if DEBUG
    private func previewScroll(_ proxy: ScrollViewProxy) async {
        guard let screen = PreviewFixtures.screen else { return }
        if screen == "preview-timing" {
            showTiming = true
            try? await Task.sleep(for: .milliseconds(200))
            proxy.scrollTo("speech-timing", anchor: .top)
        } else if screen == "review-retry" || screen == "pushback" {
            try? await Task.sleep(for: .milliseconds(200))
            proxy.scrollTo("retry-latest", anchor: .top)
            if screen == "pushback" { pushbackComposerOpen = true }
        }
    }
#endif

    // MARK: Toolbar

    @ToolbarContentBuilder private var toolbarContent: some ToolbarContent {
        ToolbarItem(placement: .topBarTrailing) {
            Button { client.minimizeConversation() } label: {
                Image(systemName: "chevron.down").font(.subheadline.weight(.semibold))
            }
            .accessibilityLabel("Свернуть занятие")
            .disabled(client.recording || client.microphoneStarting)
        }
    }

    // MARK: Content

    @ViewBuilder private var content: some View {
        if let value = conversation {
            VStack(alignment: .leading, spacing: 18) {
                if value.analysis != nil {
                    reviewContent(value)
                } else if value.status == "analysing" {
                    analysisWaiting(value)
                } else {
                    liveContent(value)
                }
                Color.clear.frame(height: 1).id("end")
            }
            .animation(reduceMotion ? nil : NativeMotion.standard, value: value.status)
        }
    }

    // MARK: Live

    private func liveContent(_ value: Conversation) -> some View {
        VStack(alignment: .leading, spacing: 18) {
            liveHeader(value)
            if value.analysisFailed { analysisFailedCard(value) }
            if let material = value.lesson.material { LessonMaterialCard(material: material) }
            if !value.isTextActivity { partnerStage(value) }
            if let turn = value.turns.last(where: { $0.role == "assistant" }) { partnerCard(value, turn) }
            if !client.recording, let last = value.turns.last(where: { $0.role == "user" }) { TranscriptCard(turn: last) }
            if value.turns.count > 2 { wholeConversation(value) }
            if client.playing, client.audioOutput != "Звук пока не запущен" {
                Text("Звук: " + client.audioOutput).font(.caption).foregroundStyle(Theme.inkSecondary).frame(maxWidth: .infinity)
            }
            if let routeMessage = client.audioRouteMessage {
                Text(routeMessage).font(.footnote).foregroundStyle(Theme.inkSecondary)
            }
        }
    }

    private func liveHeader(_ value: Conversation) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(value.lesson.title).font(TypeScale.title2).fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)
            Text(modeTitle(value) + (value.lesson.format == "pitch" ? " · 30–45 секунд" : ""))
                .font(.footnote.weight(.semibold)).foregroundStyle(Theme.inkSecondary)
            DisclosureGroup(isExpanded: $showBrief) {
                VStack(alignment: .leading, spacing: 10) {
                    Text(value.lesson.goal).font(.subheadline.weight(.medium)).fixedSize(horizontal: false, vertical: true)
                    if !value.lesson.why.isEmpty {
                        Text(value.lesson.why).font(.footnote).foregroundStyle(Theme.inkSecondary).fixedSize(horizontal: false, vertical: true)
                    }
                    if !value.lesson.targetSkills.isEmpty {
                        Text("Навыки: " + value.lesson.targetSkills.map(SkillCopy.title).joined(separator: ", "))
                            .font(.caption).foregroundStyle(Theme.inkSecondary)
                    }
                }.padding(.top, 8)
            } label: { Text("Твоя задача").font(.subheadline.weight(.semibold)) }
            if !value.lesson.mustAvoid.isEmpty { AvoidChips(phrases: value.lesson.mustAvoid) }
            if let recall = PhraseLabels.supportLine(familyId: value.lesson.familyId, languageFocus: value.lesson.languageFocus,
                                                     phraseIds: value.lesson.phraseIds, mode: value.mode) {
                RecallLine(label: recall.label, text: recall.text)
            }
        }
    }

    /// In a replay the opening is the counterpart's real line from the uploaded call.
    private func partnerLabel(_ value: Conversation, _ turn: Turn) -> String? {
        guard value.lesson.format == "replay", value.turns.first?.id == turn.id else { return nil }
        return "Реплика из твоего созвона"
    }

    private func modeTitle(_ value: Conversation) -> String {
        if value.isTextActivity { return value.isReading ? "Чтение" : "Письмо" }
        return ModeCopy.title(value.mode)
    }

    /// The partner's latest line, heard first (MOTION-PASS §6): hidden until opened, «Скрыть текст» hides it again,
    /// the next line arrives hidden. Reading/writing prompts and lines without voice are always shown.
    private func partnerCard(_ value: Conversation, _ turn: Turn) -> some View {
        let forced = client.partnerTextForced(turn, in: value)
        return VStack(alignment: .leading, spacing: 8) {
            Text(partnerLabel(value, turn) ?? "Собеседник")
                .font(.caption.weight(.semibold)).foregroundStyle(Theme.inkSecondary)
            PartnerLineReveal(text: turn.text, shown: forced || client.revealedPartnerTurn == turn.id, canHide: !forced,
                              disabled: client.recording || client.microphoneStarting,
                              reveal: { client.revealPartnerText() }, hide: { client.hidePartnerText() })
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(18)
        .background(Theme.solid, in: RoundedRectangle(cornerRadius: Radius.tile, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: Radius.tile, style: .continuous).strokeBorder(Theme.hairline, lineWidth: 1)
        }
    }

    private func analysisFailedCard(_ value: Conversation) -> some View {
        LiquidCard(tint: Theme.danger.opacity(0.12)) {
            VStack(alignment: .leading, spacing: 12) {
                Label("Разбор не получился", systemImage: "exclamationmark.triangle.fill")
                    .font(.headline).foregroundStyle(Theme.ink)
                Text(value.error ?? "Сервис не смог закончить разбор. Ответы сохранены — можно повторить.")
                    .font(.subheadline).foregroundStyle(Theme.inkSecondary).fixedSize(horizontal: false, vertical: true)
                Button { Task { await client.retryAnalysis() } } label: {
                    HStack {
                        Text(client.busy ? "Повторяю…" : "Повторить разбор")
                        Spacer()
                        if client.busy { ProgressView().tint(Theme.ctaLabel) } else { Image(systemName: "arrow.clockwise") }
                    }
                }
                .buttonStyle(PrimaryButton())
                .disabled(client.busy || client.recording || client.hasUnsentAnswer || client.hasUnuploadedRecording)
            }
        }
    }

    private func partnerStage(_ value: Conversation) -> some View {
        VStack(spacing: 8) {
            MeasuredVoiceOrb(meter: client.voiceMeter, mode: orbMode, mood: orbMood, statusDescription: voiceLabel, celebrate: celebrate)
                .frame(width: 214, height: 214)
            HStack(spacing: 7) {
                Circle().fill(client.recording ? Theme.cyan : client.playing ? Theme.violet : Theme.inkTertiary).frame(width: 7, height: 7)
                Text(voiceLabel).font(.footnote.weight(.medium)).foregroundStyle(Theme.inkSecondary)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 2)
    }

    /// Partner turns show only once the learner opens the list: opening it counts as opening the line he is about
    /// to answer (`show-text`). A line that arrives while the list stays open is held back here too (§6).
    private func wholeConversation(_ value: Conversation) -> some View {
        let current: String? = value.turns.last.flatMap { last -> String? in
            last.role == "assistant" && !value.isTextActivity ? last.id : nil
        }
        let expanded = Binding(get: { showConversation }, set: { open in
            if open && !showConversation && current != nil { client.revealPartnerText() }
            showConversation = open
        })
        return DisclosureGroup(isExpanded: expanded) {
            VStack(spacing: 12) {
                ForEach(value.turns) { turn in
                    if turn.id == current {
                        partnerCard(value, turn)
                    } else {
                        TranscriptCard(turn: turn)
                    }
                }
            }.padding(.top, 10)
        } label: {
            Text(value.isTextActivity ? "Все ответы" : "Весь разговор").font(.subheadline.weight(.semibold))
        }
    }

    // MARK: Waiting for the review

    private func analysisWaiting(_ value: Conversation) -> some View {
        VStack(spacing: 20) {
            MeasuredVoiceOrb(meter: client.voiceMeter, mode: .thinking, mood: .thinking, statusDescription: "Разбираю разговор")
                .frame(width: 200, height: 200)
            ActivityPanel(title: value.processing?.stage == "waiting-retry" ? "Сервис задержал разбор" : value.isTextActivity ? "Разбираю задание" : "Разбираю разговор",
                          detail: value.isTextActivity ? "Проверяю смысл, структуру и английский в твоём ответе." : "Смотрю на смысл, английский и то, как ты использовал ответы собеседника.",
                          startedAt: analysisStartedAt)
            selfCheck(value)
            Text("Можно свернуть занятие — готовый разбор будет ждать на вкладке «Сегодня».")
                .font(.subheadline).foregroundStyle(Theme.inkSecondary).multilineTextAlignment(.center)
            Button { client.minimizeConversation() } label: {
                HStack { Text("Вернусь чуть позже"); Spacer(); Image(systemName: "chevron.down") }
            }
            .buttonStyle(SecondaryButton())
            Button("Проверить сейчас") { Task { await client.reloadConversation() } }
                .buttonStyle(QuietButton())
                .disabled(client.busy)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 12)
    }

    @ViewBuilder private func selfCheck(_ value: Conversation) -> some View {
        if let turn = value.turns.last(where: { $0.role == "assistant" }) {
            SurfaceCard {
                VStack(alignment: .leading, spacing: 12) {
                    InputLabel(title: "Пока ждём")
                    Text(value.isTextActivity ? "Какую мысль ты хотел донести? Найди её в своём ответе." : "Что было важно собеседнику? Вспомни одну конкретную деталь.")
                        .font(.subheadline.weight(.medium)).fixedSize(horizontal: false, vertical: true)
                    Button { showListeningCheck.toggle() } label: {
                        Label(showListeningCheck ? "Скрыть" : "Проверить себя", systemImage: "text.alignleft")
                    }
                    .buttonStyle(QuietButton())
                    if showListeningCheck {
                        Text(value.isTextActivity ? (value.turns.last(where: { $0.role == "user" })?.text ?? turn.text) : turn.text)
                            .font(.subheadline).foregroundStyle(Theme.inkSecondary).textSelection(.enabled)
                    }
                }
            }
        }
    }

    // MARK: Review

    private func reviewContent(_ value: Conversation) -> some View {
        VStack(alignment: .leading, spacing: 18) {
            // PASS-0.5.5 §3: a rehearsal names its call and leads back to the prep (fresh «Перед звонком помни»).
            PrepRehearsalLine(conversation: value)
            reviewHeader(value)
            if value.status == "completed", let result = client.state?.progression?.recentResults.first(where: { $0.sessionId == value.id }) {
                PracticeOutcomeView(result: result)
            }
            if let analysis = value.analysis { reviewBody(analysis, value) }
        }
    }

    private func reviewMood(_ value: Conversation) -> VoiceOrbMood {
        if hasConfirmedImprovement(value) || value.status == "completed" && !value.awaitsRetry { return .proud }
        if value.retryDeferred == true { return .calm }
        if value.analysis?.priorities.isEmpty == false { return .curious }
        return .happy
    }

    private func reviewHeader(_ value: Conversation) -> some View {
        let improved = hasConfirmedImprovement(value)
        let priorities = value.analysis?.priorities.count ?? 0
        let headline: String
        if value.awaitsRetry && value.status == "completed" { headline = "Улучшенная попытка ждёт." }
        else if improved { headline = "Вот, уже сильнее." }
        else if value.status == "completed" { headline = "Практика сохранена." }
        else if priorities == 0 { headline = "Хороший разговор." }
        else if priorities == 1 { headline = "Сделаем ответ сильнее." }
        else { headline = "\(priorities) шага к ответу сильнее." }
        return HStack(alignment: .center, spacing: 14) {
            VStack(alignment: .leading, spacing: 8) {
                Text(headline).font(TypeScale.title).tracking(-0.4).fixedSize(horizontal: false, vertical: true)
                    .accessibilityAddTraits(.isHeader)
                Text(value.lesson.title).font(.subheadline).foregroundStyle(Theme.inkSecondary).fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
            VoiceOrb(mode: .ready, level: 0, mood: reviewMood(value), statusDescription: headline, celebrate: celebrate)
                .frame(width: 96, height: 96)
        }
    }

    /// Review order: outcome → summary → what to change → the latest attempt → strengths → details (L-19).
    private func reviewBody(_ analysis: Review, _ value: Conversation) -> some View {
        VStack(alignment: .leading, spacing: 18) {
            reviewEssentials(analysis, value)
            reviewDetails(analysis, value)
        }
    }

    private func reviewEssentials(_ analysis: Review, _ value: Conversation) -> some View {
        VStack(alignment: .leading, spacing: 18) {
            if let outcome = analysis.outcome, !outcome.what.isEmpty { outcomeCard(outcome) }
            ReviewSummaryCard(summary: analysis.summary, nextFocus: analysis.nextFocus)
            // PASS-0.5.3 §1.5: «Фразы из копилки» right after the summary (sessions without phrase results show nothing).
            PhraseResultsBlock(conversation: value)
            if !analysis.priorities.isEmpty {
                LiquidSectionHeader(title: "Что меняем в следующей попытке", systemImage: "scope")
                ForEach(Array(analysis.priorities.enumerated()), id: \.offset) { index, priority in
                    ReviewPriorityCard(priority: priority, number: index + 1)
                }
            }
            retriesSection(value)
            strengthsSection(analysis)
        }
    }

    private func reviewDetails(_ analysis: Review, _ value: Conversation) -> some View {
        VStack(alignment: .leading, spacing: 18) {
            if let hits = analysis.patternHits?.filter({ $0.outcome != "no-opportunity" }), !hits.isEmpty { patternSection(hits) }
            if let errors = analysis.languageErrors, !errors.isEmpty { languageSection(errors, ignored: analysis.minorErrorsIgnored ?? 0) }
            if let moves = analysis.strategyMoves, !moves.isEmpty { movesSection(moves) }
            if let debatable = analysis.debatable, !debatable.isEmpty { debatableSection(debatable) }
            timingSection(value)
            limitationsSection(analysis)
            transcriptSection(value)
            Text("Произношение и акцент по тексту не оцениваются.")
                .font(.caption).foregroundStyle(Theme.inkTertiary)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func outcomeCard(_ outcome: Review.Outcome) -> some View {
        let label: String
        switch outcome.achieved {
        case "yes": label = "Цель сцены достигнута"
        case "partly": label = "Цель сцены — частично"
        case "no": label = "Цель сцены пока не достигнута"
        default: label = "Итог сцены"
        }
        return VStack(alignment: .leading, spacing: 6) {
            Text(label).font(.subheadline.weight(.semibold))
            Text(outcome.what).font(.subheadline).foregroundStyle(Theme.inkSecondary).fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .contentSurface(radius: Radius.tile, tint: outcome.achieved == "yes" ? Theme.lime.opacity(0.25) : nil)
    }

    @ViewBuilder private func retriesSection(_ value: Conversation) -> some View {
        if let latest = value.retries.last {
            VStack(alignment: .leading, spacing: 12) {
                RetryResultCard(retry: latest, number: value.retries.count, highlight: freshRetry == value.retries.count)
                    .id("retry-latest")
                if latest.pushback != nil, let retryID = latest.id {
                    PushbackCard(retry: latest, retryID: retryID, composerOpen: pushbackComposerOpen) {
                        pushbackComposerOpen = true
                    }
                }
                if value.retries.count > 1 {
                    DisclosureGroup {
                        VStack(spacing: 10) {
                            ForEach(Array(value.retries.dropLast().enumerated()), id: \.offset) { index, retry in
                                RetryResultCard(retry: retry, number: index + 1, highlight: false)
                            }
                        }.padding(.top, 8)
                    } label: { Text("Прошлые попытки: \(value.retries.count - 1)").font(.subheadline.weight(.semibold)) }
                }
            }
        }
    }

    @ViewBuilder private func strengthsSection(_ analysis: Review) -> some View {
        if !analysis.strengths.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                LiquidSectionHeader(title: "Что получилось", systemImage: "checkmark.seal")
                ForEach(Array(analysis.strengths.enumerated()), id: \.offset) { _, item in
                    HStack(alignment: .top, spacing: 10) {
                        Image(systemName: "checkmark.circle.fill").foregroundStyle(Theme.limeInk).padding(.top, 2)
                        Text(item).font(.subheadline).fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
        }
    }

    private func languageSection(_ errors: [Review.LanguageError], ignored: Int) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            LiquidSectionHeader(title: "Английский: что поправить", systemImage: "textformat.abc")
            VStack(alignment: .leading, spacing: 0) {
                ForEach(Array(errors.prefix(8).enumerated()), id: \.offset) { index, item in
                    LanguageFixRow(item: item)
                    if index < min(errors.count, 8) - 1 { Divider().opacity(0.5) }
                }
            }
            .padding(.horizontal, 14).padding(.vertical, 4)
            .contentSurface(radius: Radius.tile)
            if ignored > 0 {
                Text("Ещё \(RuFormat.count(ignored, "мелкая ошибка", "мелкие ошибки", "мелких ошибок")) не мешали смыслу — их не разбираем.")
                    .font(.caption).foregroundStyle(Theme.inkSecondary)
            }
        }
    }

    private func movesSection(_ moves: [Review.StrategyMove]) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            LiquidSectionHeader(title: "Ходы разговора", systemImage: "arrow.triangle.branch")
            VStack(spacing: 0) {
                ForEach(Array(moves.enumerated()), id: \.offset) { index, move in
                    ReviewMoveRow(move: move)
                    if index < moves.count - 1 { Divider().opacity(0.5) }
                }
            }
            .padding(.horizontal, 14).padding(.vertical, 6)
            .contentSurface(radius: Radius.tile)
        }
    }

    private func patternSection(_ hits: [Review.PatternHit]) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            LiquidSectionHeader(title: "Твои паттерны в этом разговоре", systemImage: "repeat")
            ChipFlow(spacing: 8) {
                ForEach(Array(hits.enumerated()), id: \.offset) { _, hit in
                    ReviewPatternChip(title: patternTitle(hit), outcome: hit.outcome, label: patternOutcome(hit.outcome))
                }
            }
        }
    }

    private func debatableSection(_ items: [Review.Debatable]) -> some View {
        DisclosureGroup {
            VStack(alignment: .leading, spacing: 14) {
                ForEach(Array(items.prefix(3).enumerated()), id: \.offset) { _, item in
                    VStack(alignment: .leading, spacing: 6) {
                        Text(item.title).font(.subheadline.weight(.semibold))
                        if let quote = item.quote, !quote.isEmpty {
                            Text("«\(quote)»").font(.footnote).foregroundStyle(Theme.inkSecondary)
                        }
                        if !item.forSide.isEmpty { Label(item.forSide, systemImage: "plus.circle").font(.footnote) }
                        if !item.againstSide.isEmpty { Label(item.againstSide, systemImage: "minus.circle").font(.footnote) }
                        if !item.verdict.isEmpty { Text(item.verdict).font(.footnote.weight(.semibold)).fixedSize(horizontal: false, vertical: true) }
                    }
                }
            }.padding(.top, 8)
        } label: { Text("Спорные моменты").font(.subheadline.weight(.semibold)) }
    }

    private func patternTitle(_ hit: Review.PatternHit) -> String {
        if let title = hit.title, !title.isEmpty { return title }
        return client.state?.patternSignals.first { $0.id == hit.patternId }?.title ?? hit.patternId
    }

    private func patternOutcome(_ outcome: String) -> String {
        switch outcome {
        case "avoided": return "Удалось избежать"
        case "improved": return "Лучше, чем раньше"
        case "new": return "Новое наблюдение"
        default: return "Повторилось"
        }
    }

    @ViewBuilder private func timingSection(_ value: Conversation) -> some View {
        let hasTiming = value.turns.contains { $0.speechTiming?.canDisplay(for: $0.audioFile) == true }
            || value.retries.contains { $0.speechTiming?.canDisplay(for: $0.audioFile) == true }
        if hasTiming {
            DisclosureGroup(isExpanded: $showTiming) {
                SpeechTimingView(conversation: value).padding(.top, 8)
            } label: {
                Label("Твоя речь в записи", systemImage: "waveform").font(.subheadline.weight(.semibold))
            }
            .id("speech-timing")
        }
    }

    @ViewBuilder private func limitationsSection(_ analysis: Review) -> some View {
        if !analysis.limitations.isEmpty {
            DisclosureGroup {
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(Array(analysis.limitations.enumerated()), id: \.offset) { _, item in
                        Text(item).font(.footnote).foregroundStyle(Theme.inkSecondary).fixedSize(horizontal: false, vertical: true)
                    }
                }.padding(.top, 8)
            } label: { Text("Что пока нельзя оценить").font(.subheadline.weight(.semibold)) }
        }
    }

    private func transcriptSection(_ value: Conversation) -> some View {
        DisclosureGroup {
            VStack(spacing: 12) {
                if let material = value.lesson.material { LessonMaterialCard(material: material) }
                ForEach(value.turns) { TranscriptCard(turn: $0) }
            }.padding(.top, 10)
        } label: {
            Text(value.isTextActivity ? "Задание и твои ответы" : "Текст разговора").font(.subheadline.weight(.semibold))
        }
    }

    // MARK: Dock

    @ViewBuilder private var bottomDock: some View {
        if let value = conversation {
            VStack(spacing: 12) {
                if let message = client.error {
                    InlineBanner(tone: .error, title: "Не получилось", message: message,
                                 actionTitle: client.microphoneDenied ? "Открыть настройки" : nil,
                                 action: settingsAction, dismiss: { client.error = nil })
                }
                dockBody(value)
            }
            .padding(.horizontal, 16).padding(.top, 14).padding(.bottom, 8)
            .frame(maxWidth: 640)
            .animation(reduceMotion ? nil : NativeMotion.standard, value: reviewComposerOpen)
            .animation(reduceMotion ? nil : NativeMotion.standard, value: pushbackComposerOpen)
        }
    }

    @ViewBuilder private func dockBody(_ value: Conversation) -> some View {
        if value.analysis != nil {
            reviewDock(value)
        } else if value.isLive {
            liveDock(value)
        } else if value.status == "completed" {
            closeButton
        }
    }

    @ViewBuilder private func liveDock(_ value: Conversation) -> some View {
        if let turn = client.unansweredTurn {
            unansweredCard(turn)
        } else {
            ComposerPanel(target: .message, conversation: value)
            finishRow(value)
        }
    }

    private func unansweredCard(_ turn: Turn) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Label("Собеседник не ответил на твою реплику", systemImage: "exclamationmark.bubble")
                .font(.subheadline.weight(.semibold))
            Text("«\(turn.text)»").font(.footnote).foregroundStyle(Theme.inkSecondary).lineLimit(3)
            Button { Task { await client.resendUnanswered() } } label: {
                HStack {
                    Text(client.busy ? "Отправляю…" : "Повторить отправку")
                    Spacer()
                    if client.busy { ProgressView().tint(Theme.ctaLabel) } else { Image(systemName: "arrow.clockwise") }
                }
            }
            .buttonStyle(PrimaryButton())
            .disabled(client.busy)
        }
    }

    @ViewBuilder private func finishRow(_ value: Conversation) -> some View {
        if value.userTurnCount > 0 && !client.recording {
            VStack(spacing: 4) {
                Button { leave(.finish) } label: {
                    Label("Закончить и получить разбор", systemImage: "checkmark.circle")
                }
                .buttonStyle(QuietButton())
                .disabled(!canRequestReview(value))
                if let reason = finishBlockReason(value) {
                    Text(reason).font(.caption).foregroundStyle(Theme.inkSecondary)
                }
            }
            .frame(maxWidth: .infinity)
        }
    }

    @ViewBuilder private func reviewDock(_ value: Conversation) -> some View {
        if pushbackComposerOpen, let retry = value.retries.last, let retryID = retry.id, retry.pendingPushback != nil {
            pushbackComposer(value, retryID: retryID)
        } else if value.status == "completed" && !value.awaitsRetry {
            closeButton
        } else if mayComplete(value) && value.retryDeferred != true {
            completeBlock(value)
        } else if reviewComposerOpen {
            retryComposer(value)
        } else {
            retryPrompt(value)
        }
    }

    /// A finished lesson opened later is simply left for Today (§8.5); right after finishing, iOS already returns to
    /// Today, where the next step waits. The toolbar chevron still just closes the sheet.
    private var closeButton: some View {
        Button { client.returnToHome() } label: {
            HStack { Text("На главную"); Spacer(); Image(systemName: "house") }
        }
        .buttonStyle(SecondaryButton())
        .disabled(client.recording || client.microphoneStarting)
    }

    private func completeBlock(_ value: Conversation) -> some View {
        VStack(spacing: 10) {
            // PASS-0.5.3 §2: the optional comfort rating travels with «Завершить занятие» (status `review` only).
            ComfortRatingRow(conversation: value)
            Label("Всё сохранено. Можно завершать.", systemImage: "checkmark.circle.fill")
                .font(.footnote).foregroundStyle(Theme.inkSecondary)
            Button { leave(.complete) } label: {
                HStack {
                    Text(client.busy ? "Сохраняю…" : "Завершить занятие")
                    Spacer()
                    if client.busy { ProgressView().tint(Theme.ctaLabel) } else { Image(systemName: "checkmark") }
                }
            }
            .buttonStyle(PrimaryButton())
            .disabled(!canLeaveReview)
            if let reason = leaveBlockReason {
                Text(reason).font(.caption).foregroundStyle(Theme.inkSecondary)
            }
        }
    }

    private func retryPrompt(_ value: Conversation) -> some View {
        VStack(spacing: 10) {
            // PASS-0.5.3 §2: the rating also travels with «Отложить попытку» (shown only while the status is `review`).
            ComfortRatingRow(conversation: value)
            Button { reviewComposerOpen = true } label: {
                HStack { Text("Ответить ещё раз"); Spacer(); Image(systemName: "mic.fill") }
            }
            .buttonStyle(PrimaryButton())
            .disabled(client.busy || client.recording)
            if value.status == "completed" {
                // The lesson is finished and its attempt is parked: leave it (§8.5).
                Button("На главную") { client.returnToHome() }
                    .buttonStyle(QuietButton())
                    .disabled(client.recording || client.microphoneStarting)
            } else {
                // Parks the attempt; the lesson stays unfinished on Today.
                Button("Отложить попытку") { leave(.deferRetry) }
                    .buttonStyle(QuietButton())
                    .disabled(!canLeaveReview)
                if let reason = leaveBlockReason {
                    Text(reason).font(.caption).foregroundStyle(Theme.inkSecondary)
                }
            }
        }
    }

    private func retryComposer(_ value: Conversation) -> some View {
        VStack(spacing: 8) {
            ComposerPanel(target: .retry, conversation: value,
                          caption: value.analysis?.priorities.first?.retryInstruction ?? "Ответь ещё раз своими словами. Проверим, что стало лучше.")
            Button("Свернуть") { reviewComposerOpen = false }
                .buttonStyle(QuietButton())
                .disabled(client.recording || client.busy)
        }
    }

    private func pushbackComposer(_ value: Conversation, retryID: String) -> some View {
        VStack(spacing: 8) {
            ComposerPanel(target: .pushback(retryID: retryID), conversation: value,
                          caption: "Удержи позицию: спокойно, по делу и без лишних уступок.")
            Button("Свернуть") { pushbackComposerOpen = false }
                .buttonStyle(QuietButton())
                .disabled(client.recording || client.busy)
        }
    }
}

// MARK: - Composer

/// The floating dock: input (or live captions), recording actions and the control cluster
/// (replay · text | mic | hint · send). Controls live here, never under the dock (L-18).
private struct ComposerPanel: View {
    let target: ComposerTarget
    let conversation: Conversation
    var caption: String? = nil
    @EnvironmentObject private var client: TrainingClient
    @FocusState private var focused: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var writing: Bool { conversation.isWriting }
    private var draftText: String { client.draft.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var fieldLocked: Bool { client.busy || conversation.processing != nil || client.pendingMessageID != nil }
    private var canSend: Bool {
        !client.busy && conversation.processing == nil && !client.recording && !client.hasUnuploadedRecording && !draftText.isEmpty
    }
    private var micBlocked: Bool {
        client.busy || conversation.processing != nil || client.pendingMessageID != nil || client.hasUnuploadedRecording
            || client.microphoneStarting || !draftText.isEmpty || client.recordedFile != nil
    }
    private var placeholder: String {
        switch target {
        case .message: return writing ? "Напиши ответ на английском" : "Ответ на английском"
        case .retry: return "Новая попытка на английском"
        case .pushback: return "Ответ на возражение"
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if let caption, !client.recording {
                Text(caption).font(.footnote).foregroundStyle(Theme.inkSecondary).fixedSize(horizontal: false, vertical: true)
            }
            // PASS-0.5.3 §2: three hint levels in «С опорами» speaking lessons (hidden in reading and writing).
            if target == .message && conversation.offersHints { ComposerHintsPanel(conversation: conversation) }
            inputArea
            if client.pendingIsLocalOnly && !client.busy { pendingNote }
            if !client.showsLiveCaptions && (client.recordedFile != nil || client.hasUnuploadedRecording) { recordingActions }
            controls
            if conversation.lesson.format == "pitch" && target == .message {
                PitchTarget(start: client.recording ? client.recordingStartedAt : nil)
            }
            if client.recording, let start = client.recordingStartedAt { RecordingLimitNote(start: start) }
        }
        .animation(reduceMotion ? nil : NativeMotion.standard, value: client.recording)
        .animation(reduceMotion ? nil : NativeMotion.standard, value: client.showsLiveCaptions)
    }

    /// While speaking (and while the answer is saved right after Stop) the live words; then the editable draft.
    /// The caption box has a fixed height, so the dock never grows while the learner speaks (§5).
    @ViewBuilder private var inputArea: some View {
        if client.showsLiveCaptions {
            LiveTranscriptView(model: client.liveCaptions, live: client.recording)
                .transition(.opacity)
        } else {
            TextField(placeholder, text: $client.draft, axis: .vertical)
                .lineLimit(writing ? 4...10 : 1...4)
                .focused($focused)
                .font(.body)
                .padding(14)
                .background(Theme.solid, in: RoundedRectangle(cornerRadius: Radius.input, style: .continuous))
                .overlay {
                    RoundedRectangle(cornerRadius: Radius.input, style: .continuous)
                        .strokeBorder(focused ? Theme.violet : Theme.hairline, lineWidth: focused ? 2 : 1)
                        .allowsHitTesting(false)
                }
                .disabled(fieldLocked)
                .onChange(of: client.draft) { _, value in
                    if value.count > 7000 { client.draft = String(value.prefix(7000)) }
                }
            if writing {
                Text("Слов: \(draftText.split(whereSeparator: \.isWhitespace).count) · символов: \(client.draft.count) из 7000")
                    .font(.caption).monospacedDigit().foregroundStyle(Theme.inkSecondary)
            }
        }
    }

    private var pendingNote: some View {
        HStack(spacing: 10) {
            Text("Ответ не отправился. Повтори отправку или измени текст.")
                .font(.footnote).foregroundStyle(Theme.inkSecondary).fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
            Button("Изменить ответ") {
                client.editPendingAnswer()
                focused = true
            }
            .buttonStyle(QuietButton())
        }
    }

    private var recordingActions: some View {
        VStack(alignment: .leading, spacing: 8) {
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 8) { recordingButtons }
                VStack(alignment: .leading, spacing: 8) { recordingButtons }
            }
            Text(client.hasUnuploadedRecording ? "Запись осталась на iPhone. Повтори распознавание или удали её." : "Проверь текст по оригинальной записи перед отправкой.")
                .font(.caption).foregroundStyle(Theme.inkSecondary)
        }
    }

    @ViewBuilder private var recordingButtons: some View {
        Button { Task { await client.playRecording() } } label: { Label("Моя запись", systemImage: "play.circle") }
            .buttonStyle(QuietButton())
            .disabled(client.busy || client.voiceLoading)
        if client.hasUnuploadedRecording {
            Button("Повторить распознавание") { Task { await client.transcribeRecording() } }
                .buttonStyle(QuietButton())
                .disabled(client.busy)
        }
        if client.pendingMessageID == nil {
            Button("Удалить") { client.discardRecording() }
                .buttonStyle(DestructiveQuietButton())
                .disabled(client.busy)
        }
    }

    @ViewBuilder private var controls: some View {
        if writing {
            Button { send() } label: {
                HStack {
                    Text(client.pendingMessageID != nil ? "Повторить отправку" : "Отправить")
                    Spacer()
                    if client.busy { ProgressView().tint(Theme.ctaLabel) } else { Image(systemName: "arrow.up") }
                }
            }
            .buttonStyle(PrimaryButton())
            .disabled(!canSend)
        } else {
            ZStack {
                HStack(spacing: 10) {
                    if !client.recording { leftCluster }
                    Spacer(minLength: 0)
                    if !client.recording { rightCluster }
                }
                micButton
            }
            .frame(maxWidth: .infinity, minHeight: 76)
        }
    }

    /// The partner's line: listen again and show/hide its text (both modes, §6).
    @ViewBuilder private var leftCluster: some View {
        HStack(spacing: 8) {
            switch target {
            case .message:
                if !conversation.isTextActivity {
                    replayCircle
                    textCircle
                }
            case .retry:
                EmptyView()
            case .pushback(let retryID):
                objectionCircle(retryID)
            }
        }
    }

    /// The learner's answer: send (hints live in the panel above the field, PASS-0.5.3 §2).
    @ViewBuilder private var rightCluster: some View {
        HStack(spacing: 8) {
            sendCircle
        }
    }

    private var playbackLabel: String {
        if client.playing { return "Стоп" }
        if client.needsPlaybackAcknowledgement { return "Сохранить прослушивание" }
        return client.latestPartnerLineHeard ? "Ещё раз" : "Слушать"
    }

    private var playbackIcon: String {
        if client.playing { return "stop.fill" }
        if client.needsPlaybackAcknowledgement { return "checkmark" }
        return client.latestPartnerLineHeard ? "arrow.counterclockwise" : "speaker.wave.2.fill"
    }

    private var replayCircle: some View {
        Button {
            if client.playing {
                client.stopSpeaking()
            } else {
                Task {
                    if client.needsPlaybackAcknowledgement { await client.retryPlaybackAcknowledgement() } else { await client.speak() }
                }
            }
        } label: { Image(systemName: playbackIcon) }
        .buttonStyle(LiquidIconButton(size: 48))
        .disabled(!client.playing && (client.busy || client.voiceLoading || client.recording))
        .accessibilityLabel(playbackLabel)
    }

    /// Opens or hides the latest partner line. Absent when the line cannot be heard (its text is always shown then).
    @ViewBuilder private var textCircle: some View {
        if let turn = conversation.turns.last(where: { $0.role == "assistant" }), !client.partnerTextForced(turn, in: conversation) {
            let shown = client.revealedPartnerTurn == turn.id
            Button {
                if shown { client.hidePartnerText() } else { client.revealPartnerText() }
            } label: { Image(systemName: shown ? "eye.slash" : "text.bubble") }
            .buttonStyle(LiquidIconButton(size: 48, tint: shown ? Theme.lavender.opacity(0.55) : nil))
            .disabled(client.recording || client.microphoneStarting)
            .accessibilityLabel(shown ? "Скрыть текст реплики" : "Показать текст реплики")
        }
    }

    private func objectionCircle(_ retryID: String) -> some View {
        let key = TrainingClient.pushbackLineKey(retryID)
        let active = client.playingModelLine == key || client.loadingModelLine == key
        return Button { Task { await client.pushbackSpeech(retryId: retryID) } } label: {
            Image(systemName: active ? "stop.fill" : "speaker.wave.2.fill")
        }
        .buttonStyle(LiquidIconButton(size: 48))
        .disabled(client.recording)
        .accessibilityLabel(active ? "Остановить" : "Послушать возражение")
    }

    private var sendCircle: some View {
        Button { send() } label: {
            Image(systemName: client.pendingMessageID != nil ? "arrow.clockwise" : "arrow.up").font(.body.weight(.bold))
        }
        .buttonStyle(LiquidIconButton(size: 52, tint: canSend ? Theme.ctaFill : nil, foreground: canSend ? Theme.ctaLabel : Theme.ink))
        .disabled(!canSend)
        .accessibilityLabel(client.pendingMessageID != nil ? "Повторить отправку" : "Отправить")
    }

    private var micButton: some View {
        Button {
            focused = false
            Task { if client.recording { await client.stopRecording() } else { await client.beginRecording() } }
        } label: { micLabel }
        .buttonStyle(PressButton())
        .disabled(!client.recording && micBlocked)
        .accessibilityLabel(client.recording ? "Остановить запись" : "Говорить")
        .accessibilityHint(micBlocked && !client.recording ? "Сначала отправь или удали текущий ответ." : "")
    }

    @ViewBuilder private var micLabel: some View {
        if client.recording {
            HStack(spacing: 12) {
                Image(systemName: "stop.fill").font(.title3.weight(.bold))
                MicLevelBars(meter: client.voiceMeter)
                RecordingClock(start: client.recordingStartedAt ?? Date())
            }
            .foregroundStyle(Theme.onAccent)
            .padding(.horizontal, 22)
            .frame(height: 64)
            // The glow sits on the static capsule, so the moving level bars never re-render a shadow (§5).
            .background { Capsule().fill(Theme.cyan).shadow(color: Theme.cyan.opacity(0.45), radius: 16, x: 0, y: 6) }
        } else {
            ZStack {
                if client.microphoneStarting {
                    ProgressView().tint(Theme.ctaLabel)
                } else {
                    Image(systemName: "mic.fill").font(.title2.weight(.semibold))
                }
            }
            .foregroundStyle(micBlocked ? Theme.inkTertiary : Theme.ctaLabel)
            .frame(width: 72, height: 72)
            .background(micBlocked ? Theme.ctaDisabled : Theme.ctaFill, in: Circle())
            .shadow(color: micBlocked ? Color.clear : Theme.shadow, radius: 14, x: 0, y: 8)
        }
    }

    private func send() {
        focused = false
        Task { await client.submit(target) }
    }
}

/// Five bars driven by the microphone level; only this leaf re-renders with audio.
private struct MicLevelBars: View {
    @ObservedObject var meter: VoiceMeter
    private let weights: [Double] = [0.55, 0.85, 1.0, 0.8, 0.6]
    var body: some View {
        HStack(spacing: 3) {
            ForEach(0..<5, id: \.self) { index in
                Capsule().fill(Theme.onAccent).frame(width: 3, height: barHeight(index))
            }
        }
        .frame(height: 24)
        .animation(.spring(response: 0.18, dampingFraction: 0.7), value: meter.level)
        .accessibilityHidden(true)
    }
    private func barHeight(_ index: Int) -> CGFloat {
        let level = meter.level.isFinite ? min(1, max(0, meter.level)) : 0
        return CGFloat(4 + 20 * level * weights[index])
    }
}

private struct RecordingClock: View {
    let start: Date
    var body: some View {
        TimelineView(.periodic(from: start, by: 1)) { context in
            let seconds = max(0, Int(context.date.timeIntervalSince(start)))
            Text(String(format: "%d:%02d", seconds / 60, seconds % 60))
                .font(.subheadline.weight(.semibold)).monospacedDigit()
        }
    }
}

/// The 8-minute limit is visible from 7:30 instead of stopping silently.
private struct RecordingLimitNote: View {
    let start: Date
    var body: some View {
        TimelineView(.periodic(from: start, by: 1)) { context in
            let elapsed = context.date.timeIntervalSince(start)
            if elapsed >= 450 {
                Text("Запись остановится через \(max(0, Int(480 - elapsed))) с — ответ сохранится.")
                    .font(.caption.weight(.semibold)).foregroundStyle(Theme.warning)
                    .frame(maxWidth: .infinity)
            }
        }
    }
}

// MARK: - Leaving a step

/// A lesson step that would drop an unsent draft (MOTION-PASS §8.5). Wording equals the web FinishDialog.
enum UnsentDraftIntent: Equatable {
    case finish, complete, deferRetry

    var discardTitle: String {
        switch self {
        case .finish: return "Удалить черновик и закончить"
        case .complete: return "Удалить черновик и завершить"
        case .deferRetry: return "Удалить черновик и отложить"
        }
    }

    func detail(textActivity: Bool) -> String {
        switch self {
        case .finish:
            return "Отправь его и получи разбор — или удали черновик. После этого "
                + (textActivity ? "добавить ответы в это задание" : "добавить реплики в этот разговор") + " уже не получится."
        case .complete:
            return "Черновик попытки не будет проверен. Удали его, чтобы завершить занятие, или вернись и проверь попытку."
        case .deferRetry:
            return "Черновик попытки не будет проверен. Удали его, чтобы отложить попытку, или вернись и проверь её."
        }
    }
}

// MARK: - Partner line

/// A partner line that is heard before it is read (MOTION-PASS §6): it arrives hidden behind «Показать текст»,
/// «Скрыть текст» hides it again. A line that cannot be heard (`canHide == false`) is simply shown.
/// Shared by the conversation, the pushback objection and the placement roleplay.
struct PartnerLineReveal: View {
    let text: String
    var font: Font = .body
    let shown: Bool
    let canHide: Bool
    var note = "Реплика собеседника звучит голосом. Текст можно открыть — это учтётся как опора."
    var disabled = false
    let reveal: () -> Void
    let hide: () -> Void
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if shown {
                Text(text).font(font).textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
                    .transition(reduceMotion ? .opacity : NativeMotion.insertion)
                if canHide {
                    Button(action: hide) {
                        Label("Скрыть текст", systemImage: "eye.slash")
                            .font(.footnote.weight(.semibold)).foregroundStyle(Theme.inkSecondary)
                            .frame(minHeight: 44).contentShape(Rectangle())
                    }
                    .buttonStyle(PressButton())
                    .disabled(disabled)
                }
            } else {
                Text(note).font(.subheadline).foregroundStyle(Theme.inkSecondary).fixedSize(horizontal: false, vertical: true)
                    .transition(.opacity)
                Button(action: reveal) { Label("Показать текст", systemImage: "text.bubble") }
                    .buttonStyle(QuietButton())
                    .disabled(disabled)
                    .padding(.top, 4)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .animation(reduceMotion ? nil : NativeMotion.standard, value: shown)
    }
}

// MARK: - Review components

private struct ReviewSummaryCard: View {
    let summary: String
    let nextFocus: String?
    @State private var expanded = false
    var body: some View {
        SurfaceCard {
            VStack(alignment: .leading, spacing: 10) {
                Text(summary).font(.body).lineLimit(expanded ? nil : 4).fixedSize(horizontal: false, vertical: true)
                if summary.count > 220 {
                    Button(expanded ? "Свернуть" : "Показать полностью") { expanded.toggle() }
                        .font(.footnote.weight(.semibold)).foregroundStyle(Theme.violet)
                }
                if let nextFocus, !nextFocus.isEmpty {
                    Divider().opacity(0.5)
                    Label(nextFocus, systemImage: "arrow.forward.circle").font(.footnote).foregroundStyle(Theme.inkSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
    }
}

/// Priority: his words, a stronger example (▶︎ to hear it) and the instruction for the next attempt.
private struct ReviewPriorityCard: View {
    let priority: Priority
    let number: Int
    @EnvironmentObject private var client: TrainingClient
    @State private var showExplanation = false
    private var lineKey: String { "example:\(number):" + priority.title }
    private var active: Bool { client.playingModelLine == lineKey || client.loadingModelLine == lineKey }
    var body: some View {
        SurfaceCard {
            VStack(alignment: .leading, spacing: 14) {
                HStack(alignment: .top, spacing: 12) {
                    Text(String(number)).font(.caption.weight(.bold)).foregroundStyle(Theme.onAccent)
                        .frame(width: 26, height: 26).background(Theme.lavender, in: Circle())
                    Text(priority.title).font(.headline).fixedSize(horizontal: false, vertical: true)
                }
                if !priority.quote.isEmpty {
                    FeatureQuote(text: priority.quote)
                }
                if !priority.example.isEmpty { example }
                VStack(alignment: .leading, spacing: 6) {
                    InputLabel(title: "Твоя следующая попытка")
                    Text(priority.retryInstruction).font(.subheadline).fixedSize(horizontal: false, vertical: true)
                }
                if !priority.explanation.isEmpty {
                    DisclosureGroup(isExpanded: $showExplanation) {
                        Text(priority.explanation).font(.subheadline).foregroundStyle(Theme.inkSecondary).padding(.top, 6)
                            .fixedSize(horizontal: false, vertical: true)
                    } label: { Text("Почему это важно").font(.footnote.weight(.semibold)) }
                }
            }
        }
    }
    private var example: some View {
        HStack(alignment: .top, spacing: 10) {
            VStack(alignment: .leading, spacing: 6) {
                InputLabel(title: "Пример сильнее")
                Text(priority.example).font(.subheadline.weight(.semibold)).textSelection(.enabled)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
            Button { Task { await client.speakModelLine(priority.example, key: lineKey) } } label: {
                if client.loadingModelLine == lineKey {
                    ProgressView()
                } else {
                    Image(systemName: active ? "stop.fill" : "play.fill")
                }
            }
            .buttonStyle(SoftIconButton(size: 40, tint: Theme.cyan.opacity(0.32)))
            .disabled(client.recording)
            .accessibilityLabel(active ? "Остановить пример" : "Прослушать пример")
        }
        .padding(12)
        .background(Theme.lime.opacity(0.16), in: RoundedRectangle(cornerRadius: Radius.input, style: .continuous))
    }
}

/// The latest attempt is right under the priorities, with a visible verdict (L-20).
private struct RetryResultCard: View {
    let retry: Retry
    let number: Int
    let highlight: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var glow = false
    private var improved: Bool { retry.improved == true }
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label(improved ? "Стало лучше" : "Попытка \(number): пока не сильнее", systemImage: improved ? "checkmark.seal.fill" : "arrow.clockwise")
                .font(.subheadline.weight(.bold))
                .foregroundStyle(improved ? Theme.limeInk : Theme.ink)
            Text("«\(retry.text)»").font(.subheadline).foregroundStyle(Theme.inkSecondary).fixedSize(horizontal: false, vertical: true)
            if !retry.feedback.isEmpty {
                Text(retry.feedback).font(.subheadline).fixedSize(horizontal: false, vertical: true)
            }
            if !improved {
                Text("Сверься с примером выше и попробуй ещё раз — разбор никуда не денется.")
                    .font(.footnote).foregroundStyle(Theme.inkSecondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(18)
        .background(improved ? Theme.lime.opacity(0.24) : Theme.solid, in: RoundedRectangle(cornerRadius: Radius.card, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: Radius.card, style: .continuous)
                .strokeBorder(improved ? Theme.limeInk.opacity(0.35) : Theme.hairline, lineWidth: 1)
        }
        .shadow(color: Theme.lime.opacity(glow ? 0.85 : 0), radius: glow ? 22 : 0)
        .task(id: highlight) {
            guard highlight, improved, !reduceMotion else { return }
            withAnimation(.easeInOut(duration: 0.5)) { glow = true }
            do { try await Task.sleep(for: .milliseconds(1100)) } catch { return }
            withAnimation(.easeInOut(duration: 0.7)) { glow = false }
        }
        .accessibilityElement(children: .combine)
    }
}

/// Optional stress test after an improved attempt: the partner objects once.
private struct PushbackCard: View {
    let retry: Retry
    let retryID: String
    let composerOpen: Bool
    let onAnswer: () -> Void
    @EnvironmentObject private var client: TrainingClient
    /// The objection the learner opened (keyed by attempt, so the next objection arrives hidden).
    @State private var revealedRetry: String?
    private var key: String { TrainingClient.pushbackLineKey(retryID) }
    private var active: Bool { client.playingModelLine == key || client.loadingModelLine == key }
    var body: some View {
        if let pushback = retry.pushback {
            // Heard first (§6); after the stress test it is part of the review and stays visible.
            let forced = pushback.held != nil || client.voiceUnavailable || client.voiceFailed(key)
            VStack(alignment: .leading, spacing: 12) {
                VStack(alignment: .leading, spacing: 3) {
                    Text("Собеседник возражает").font(.headline).accessibilityAddTraits(.isHeader)
                    Text(pushback.held == nil ? "Стресс-тест, необязательно" : "Стресс-тест")
                        .font(.footnote).foregroundStyle(Theme.inkSecondary)
                }
                HStack(alignment: .top, spacing: 10) {
                    PartnerLineReveal(text: pushback.npcLine, font: .subheadline.weight(.medium),
                                      shown: forced || revealedRetry == retryID, canHide: !forced,
                                      note: "Возражение звучит голосом — послушай его. Текст можно открыть.",
                                      reveal: { revealedRetry = retryID }, hide: { revealedRetry = nil })
                    Spacer(minLength: 0)
                    Button { Task { await client.pushbackSpeech(retryId: retryID) } } label: {
                        Image(systemName: active ? "stop.fill" : "play.fill")
                    }
                    .buttonStyle(SoftIconButton(size: 40, tint: Theme.cyan.opacity(0.32)))
                    .disabled(client.recording)
                    .accessibilityLabel(active ? "Остановить" : "Послушать возражение")
                }
                result(pushback)
            }
            .padding(18)
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentSurface()
        }
    }
    @ViewBuilder private func result(_ pushback: Retry.Pushback) -> some View {
        if let held = pushback.held {
            Label(held ? "Позиция удержана — стресс-тест пройден" : "Позицию пока не удержал", systemImage: held ? "checkmark.shield.fill" : "shield.slash")
                .font(.subheadline.weight(.semibold)).foregroundStyle(held ? Theme.limeInk : Theme.ink)
            if let reply = pushback.reply, !reply.isEmpty {
                Text("«\(reply)»").font(.footnote).foregroundStyle(Theme.inkSecondary)
            }
            if let feedback = pushback.feedback, !feedback.isEmpty {
                Text(feedback).font(.subheadline).fixedSize(horizontal: false, vertical: true)
            }
        } else if !composerOpen {
            Text("Удержишь позицию — получишь отметку «стресс-тест». На завершение не влияет.")
                .font(.footnote).foregroundStyle(Theme.inkSecondary).fixedSize(horizontal: false, vertical: true)
            Button(action: onAnswer) {
                HStack { Text("Ответить на возражение"); Spacer(); Image(systemName: "mic.fill") }
            }
            .buttonStyle(SecondaryButton())
            .disabled(client.busy || client.recording)
        }
    }
}

private struct ReviewMoveRow: View {
    let move: Review.StrategyMove
    private var icon: String {
        switch move.score {
        case .some(2): return "checkmark.circle.fill"
        case .some(1): return "circle.lefthalf.filled"
        case .some(0): return "xmark.circle"
        default: return "minus.circle"
        }
    }
    private var color: Color {
        switch move.score {
        case .some(2): return Theme.limeInk
        case .some(1): return Theme.violet
        case .some(0): return Theme.pink
        default: return Theme.inkTertiary
        }
    }
    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: icon).foregroundStyle(color).padding(.top, 2)
            VStack(alignment: .leading, spacing: 3) {
                Text(move.title).font(.subheadline.weight(.semibold))
                if let quote = move.quote, !quote.isEmpty {
                    Text("«\(quote)»").font(.caption).foregroundStyle(Theme.inkSecondary).fixedSize(horizontal: false, vertical: true)
                } else if move.score == nil {
                    Text("Не было повода").font(.caption).foregroundStyle(Theme.inkTertiary)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, 10)
        .accessibilityElement(children: .combine)
    }
}

/// Reading passage or writing prompt (solid surface, selectable).
struct LessonMaterialCard: View {
    let material: Lesson.Material
    var body: some View {
        SurfaceCard {
            VStack(alignment: .leading, spacing: 14) {
                Label(material.type == "reading-passage" ? "Текст для чтения" : "Задание для письма",
                      systemImage: material.type == "reading-passage" ? "text.book.closed" : "square.and.pencil")
                    .font(.caption.weight(.semibold)).foregroundStyle(Theme.inkSecondary)
                Text(material.text).font(.body).fixedSize(horizontal: false, vertical: true).textSelection(.enabled)
                Divider().opacity(0.5)
                Text(material.instruction).font(.subheadline.weight(.medium)).fixedSize(horizontal: false, vertical: true)
                Text("Оригинальный учебный материал, не задание официального экзамена.").font(.caption).foregroundStyle(Theme.inkSecondary)
            }
        }
    }
}

/// «Не говори: …» — phrases this scene checks for (mustAvoid).
private struct AvoidChips: View {
    let phrases: [String]
    var body: some View {
        // A plain line, not a row of pills: these phrases never change state.
        Label {
            Text("Не говори: " + phrases.prefix(6).map { "«" + $0 + "»" }.joined(separator: ", "))
                .fixedSize(horizontal: false, vertical: true)
        } icon: {
            Image(systemName: "nosign").foregroundStyle(Theme.danger)
        }
        .font(.footnote)
        .accessibilityElement(children: .combine)
    }
}

/// «Вспомни: …» / «Из твоих фраз: …» — the Russian cues of saved phrases in «С опорами» (PASS-0.5.3 §1.5), never the English.
private struct RecallLine: View {
    let label: String
    let text: String
    var body: some View {
        Label {
            (Text(label + ": ").fontWeight(.semibold).foregroundStyle(Theme.violet) + Text(text))
                .fixedSize(horizontal: false, vertical: true)
        } icon: {
            Image(systemName: "text.bubble").foregroundStyle(Theme.violet)
        }
        .font(.footnote)
        .accessibilityElement(children: .combine)
    }
}

/// A 30–45 s pitch target: neutral before 25 s, lime inside the window, warning after 45 s.
private struct PitchTarget: View {
    let start: Date?
    var body: some View {
        if let start {
            TimelineView(.periodic(from: start, by: 1)) { context in
                let seconds = max(0, Int(context.date.timeIntervalSince(start)))
                label(seconds: seconds)
            }
        } else {
            Label("Цель — 30–45 секунд: роль, доказательство с цифрой, текущий проект", systemImage: "timer")
                .font(.footnote).foregroundStyle(Theme.inkSecondary).fixedSize(horizontal: false, vertical: true)
        }
    }
    private func label(seconds: Int) -> some View {
        let color: Color = seconds > 45 ? Theme.warning : seconds >= 25 ? Theme.limeInk : Theme.inkSecondary
        let text = seconds > 45 ? "Уже \(seconds) с — пора закругляться" : seconds >= 25 ? "\(seconds) с — в окне 30–45 с" : "\(seconds) с из 30–45"
        return Label(text, systemImage: "timer")
            .font(.footnote.weight(.semibold)).monospacedDigit().foregroundStyle(color)
            .frame(maxWidth: .infinity)
    }
}

private struct LanguageFixRow: View {
    let item: Review.LanguageError
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text(item.quote).font(.subheadline).foregroundStyle(Theme.inkSecondary)
                    .strikethrough(true, color: Theme.danger.opacity(0.6))
                Image(systemName: "arrow.right").font(.caption2).foregroundStyle(Theme.inkTertiary)
                Text(item.correction).font(.subheadline.weight(.semibold)).textSelection(.enabled)
            }
            if let why = item.why, !why.isEmpty {
                Text(why).font(.caption).foregroundStyle(Theme.inkSecondary).fixedSize(horizontal: false, vertical: true)
            } else if item.impact == "meaning" || item.impact == "seniority" {
                Text(item.impact == "meaning" ? "Меняет смысл" : "Звучит менее уверенно").font(.caption).foregroundStyle(Theme.inkSecondary)
            }
        }
        .padding(.vertical, 10)
        .accessibilityElement(children: .combine)
    }
}

private struct ReviewPatternChip: View {
    let title: String
    let outcome: String
    let label: String
    private var good: Bool { outcome == "avoided" || outcome == "improved" }
    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: good ? "checkmark.circle.fill" : "exclamationmark.circle.fill")
                .foregroundStyle(good ? Theme.limeInk : Theme.pink)
            Text(title).font(.caption.weight(.semibold)).lineLimit(2)
            Text("· " + label).font(.caption).foregroundStyle(Theme.inkSecondary).lineLimit(1)
        }
        .padding(.horizontal, 10).padding(.vertical, 7)
        .background((good ? Theme.lime : Theme.pink).opacity(0.16), in: Capsule())
        .overlay { Capsule().strokeBorder(Theme.hairline, lineWidth: 1) }
        .accessibilityElement(children: .combine)
    }
}

/// Wrapping row for chips (lays children left to right, then onto new lines).
struct ChipFlow: Layout {
    var spacing: CGFloat = 8
    private func rows(width: CGFloat, subviews: Subviews) -> [(range: Range<Int>, height: CGFloat)] {
        var result: [(range: Range<Int>, height: CGFloat)] = []
        var start = 0
        var x: CGFloat = 0
        var rowHeight: CGFloat = 0
        for index in subviews.indices {
            let size = subviews[index].sizeThatFits(ProposedViewSize(width: width, height: nil))
            if x > 0 && x + size.width > width {
                result.append((range: start..<index, height: rowHeight))
                start = index
                x = 0
                rowHeight = 0
            }
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
        if start < subviews.count { result.append((range: start..<subviews.count, height: rowHeight)) }
        return result
    }
    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = max(1, proposal.width ?? 320)
        let lines = rows(width: width, subviews: subviews)
        let height = lines.reduce(CGFloat(0)) { $0 + $1.height } + CGFloat(max(0, lines.count - 1)) * spacing
        return CGSize(width: width, height: height)
    }
    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var y = bounds.minY
        for line in rows(width: max(1, bounds.width), subviews: subviews) {
            var x = bounds.minX
            for index in line.range {
                let size = subviews[index].sizeThatFits(ProposedViewSize(width: bounds.width, height: nil))
                subviews[index].place(at: CGPoint(x: x, y: y), anchor: .topLeading, proposal: ProposedViewSize(size))
                x += size.width + spacing
            }
            y += line.height + spacing
        }
    }
}
