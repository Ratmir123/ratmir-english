import SwiftUI
import AVFoundation
import Combine

/// Placement test v2, full screen (present with `.fullScreenCover`). Reads and writes through
/// `PlacementStore`; progress is saved by the server after every answer, so «Продолжу позже»
/// simply closes the flow. `startRetake` opens the retake intro when a result already exists.
struct PlacementFlowView: View {
    var startRetake: Bool = false
    @EnvironmentObject private var client: TrainingClient

    var body: some View {
        PlacementFlowContainer(client: client, startRetake: startRetake)
            .environmentObject(client)
    }
}

enum PlacementFlowStage {
    case loading
    case unavailable(String)
    case intro(retake: Bool)
    case sittingBreak
    case sectionIntro(PlacementSectionView)
    case task(PlacementTask)
    case waiting
    case scoring
    case scoringError(String?)
    case result
}

private struct PlacementFlowContainer: View {
    @StateObject private var store: PlacementStore
    @StateObject private var recorder = TaskRecorder()
    @StateObject private var player: FeatureAudioPlayer
    @State private var wantsRetake: Bool
    @State private var confirmAbandon = false
    @State private var confirmClose = false
    @State private var roundToast = false
    @State private var roundTick = 0
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    private let client: TrainingClient

    init(client: TrainingClient, startRetake: Bool) {
        self.client = client
        _store = StateObject(wrappedValue: PlacementStore(client: client))
        _player = StateObject(wrappedValue: FeatureAudioPlayer(client: client))
        _wantsRetake = State(initialValue: startRetake)
    }

    var body: some View {
        NavigationStack {
            ZStack(alignment: .top) {
                FeatureBackdrop()
                mainContent
                if roundToast { toast.transition(.move(edge: .top).combined(with: .opacity)) }
            }
            .navigationTitle(navigationTitle)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { toolbarContent }
        }
        .task { await store.load() }
        .task(id: store.view?.status ?? "") {
            if store.view?.phase == .scoring { await store.pollWhileScoring() }
        }
        .onChange(of: store.view?.status ?? "") { _, status in
            if status == PlacementStatus.inProgress.rawValue { wantsRetake = false }
        }
        .onChange(of: store.view?.finishedSections ?? 0) { old, new in
            guard new > old, store.view?.phase == .inProgress else { return }
            celebrateRound()
        }
        .onDisappear {
            player.stop()
            recorder.reset()
            Task { await store.refreshClientState() }
        }
        .sensoryFeedback(.success, trigger: roundTick)
        .confirmationDialog("Сбросить текущую попытку?", isPresented: $confirmAbandon, titleVisibility: .visible) {
            Button("Сбросить попытку", role: .destructive) { Task { await store.abandon() } }
            Button("Отмена", role: .cancel) {}
        } message: {
            Text("Ответы этой попытки удалятся. Прошлый результат останется.")
        }
        .confirmationDialog("Ответ ещё не сохранён", isPresented: $confirmClose, titleVisibility: .visible) {
            Button("Закрыть без ответа", role: .destructive) { recorder.reset(); dismiss() }
            Button("Остаться", role: .cancel) {}
        } message: {
            Text("Текущая запись не отправится. Задание откроется снова, когда вернёшься.")
        }
    }

    // MARK: Stage

    private var stage: PlacementFlowStage {
        guard let view = store.view else {
            if let error = store.error { return .unavailable(error) }
            return .loading
        }
        switch view.phase {
        case .notStarted:
            return .intro(retake: false)
        case .completed:
            return wantsRetake || view.result == nil ? .intro(retake: view.result != nil) : .result
        case .scoring:
            return .scoring
        case .error:
            return .scoringError(view.error)
        case .inProgress:
            if view.isAtSittingBreak, !store.acknowledgedBreaks.contains(view.attemptId ?? "attempt") { return .sittingBreak }
            if let section = view.currentSection, section.answered == 0, !section.isFinished,
               !store.seenIntros.contains(store.introKey(section)) {
                return .sectionIntro(section)
            }
            if let task = view.task { return .task(task) }
            return .waiting
        case .unknown:
            return .unavailable("Сервер вернул незнакомое состояние теста. Обнови приложение.")
        }
    }

    private var stageIdentity: String {
        switch stage {
        case .loading: return "loading"
        case .unavailable: return "unavailable"
        case .intro(let retake): return retake ? "retake" : "intro"
        case .sittingBreak: return "break"
        case .sectionIntro(let section): return "section-" + section.id
        case .task(let task): return "task-" + (task.id ?? "unsupported")
        case .waiting: return "waiting"
        case .scoring: return "scoring"
        case .scoringError: return "scoring-error"
        case .result: return "result"
        }
    }

    private var showsProgress: Bool {
        switch stage {
        case .sittingBreak, .sectionIntro, .task, .waiting: return true
        default: return false
        }
    }

    private var navigationTitle: String {
        switch stage {
        case .result: return "Твой профиль"
        case .intro(let retake): return retake ? "Пересдача" : "Тест уровня"
        default:
            if let section = store.view?.currentSection, showsProgress { return section.title }
            return "Тест уровня"
        }
    }

    // MARK: Layout

    @ViewBuilder private var mainContent: some View {
        if case .result = stage, let view = store.view {
            // «Начать практику» leads to Сегодня, where the plan built from this result waits (as on the web).
            PlacementResultView(view: view, onRetake: { wantsRetake = true }, onStartPractice: {
                client.requestedTab = .today
                dismiss()
            })
        } else {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    if showsProgress, let view = store.view { PlacementProgressHeader(view: view) }
                    stageContent
                        .id(stageIdentity)
                        .transition(stageTransition)
                    if let error = store.error, showsInlineError {
                        FeatureBanner(message: error, onDismiss: { store.error = nil })
                    }
                }
                .padding(.horizontal, 20)
                .padding(.top, 8)
                .padding(.bottom, 32)
                .frame(maxWidth: 640)
                .frame(maxWidth: .infinity)
                .animation(reduceMotion ? nil : FeatureMotion.standard, value: stageIdentity)
            }
            .scrollDismissesKeyboard(.interactively)
        }
    }

    private var stageTransition: AnyTransition {
        if reduceMotion { return .opacity }
        return .asymmetric(insertion: .move(edge: .trailing).combined(with: .opacity), removal: .opacity)
    }

    private var showsInlineError: Bool {
        switch stage {
        case .unavailable, .scoringError: return false
        default: return true
        }
    }

    @ViewBuilder private var stageContent: some View {
        switch stage {
        case .loading:
            PlacementWaitingView(text: "Загружаю тест…", retry: nil)
        case .unavailable(let message):
            PlacementUnavailableView(message: message, retry: { Task { await store.load() } }, close: { dismiss() })
        case .intro(let retake):
            PlacementIntroView(view: store.view, retake: retake, working: store.working,
                               start: { Task { await store.start(retake: retake) } },
                               later: { dismiss() },
                               back: retake ? { wantsRetake = false } : nil,
                               recheck: { Task { await store.load() } })
        case .sittingBreak:
            PlacementSittingBreakView(view: store.view, proceed: { store.acknowledgeBreak() }, later: { dismiss() })
        case .sectionIntro(let section):
            PlacementSectionIntroView(section: section, audioAvailable: store.view?.audioAvailable ?? true, working: store.working,
                                      begin: { store.markIntroSeen(section) },
                                      skip: { reason in Task { await store.skip(section: section.id, reason: reason) } })
        case .task(let task):
            taskContent(task)
        case .waiting:
            PlacementWaitingView(text: "Загружаю задание…", retry: { Task { await store.load() } })
        case .scoring:
            PlacementScoringView(failures: store.pollFailures, close: { dismiss() })
        case .scoringError(let message):
            PlacementScoringErrorView(message: message ?? store.error, working: store.working,
                                      rescore: { Task { await store.rescore() } }, close: { dismiss() })
        case .result:
            EmptyView()
        }
    }

    @ViewBuilder private func taskContent(_ task: PlacementTask) -> some View {
        switch task {
        case .choice(let value):
            PlacementChoiceView(task: value, store: store, player: player)
        case .speaking(let value):
            PlacementSpeakingView(task: value, store: store, recorder: recorder)
        case .roleplay(let value):
            PlacementRoleplayView(task: value, store: store, recorder: recorder, player: player)
        case .unsupported:
            PlacementUnavailableView(message: "Это задание не поддерживается этой версией приложения. Обнови приложение или пройди тест на компьютере.",
                                     retry: { Task { await store.load() } }, close: { dismiss() })
        }
    }

    private var toast: some View {
        Label("Раунд пройден", systemImage: "checkmark.seal.fill")
            .font(.subheadline.weight(.semibold))
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .featureGlass(radius: 22, tint: FeaturePalette.lime, chrome: true)
            .padding(.top, 8)
            .accessibilityAddTraits(.isStaticText)
    }

    @ToolbarContentBuilder private var toolbarContent: some ToolbarContent {
        ToolbarItem(placement: .cancellationAction) {
            Button(closeTitle) { requestClose() }
                .disabled(store.working && !recorder.isBusy)
        }
        if store.view?.phase == .inProgress {
            ToolbarItem(placement: .primaryAction) {
                Menu {
                    Button("Обновить", systemImage: "arrow.clockwise") { Task { await store.load() } }
                    Button("Сбросить попытку", systemImage: "arrow.counterclockwise", role: .destructive) { confirmAbandon = true }
                } label: {
                    Image(systemName: "ellipsis.circle")
                }
                .accessibilityLabel("Ещё")
            }
        }
    }

    private var closeTitle: String {
        store.view?.phase == .inProgress ? "Продолжу позже" : "Закрыть"
    }

    private func requestClose() {
        if recorder.isBusy { confirmClose = true; return }
        dismiss()
    }

    private func celebrateRound() {
        roundTick += 1
        withAnimation(reduceMotion ? nil : FeatureMotion.bouncy) { roundToast = true }
        Task {
            do { try await Task.sleep(for: .seconds(1.8)) } catch { return }
            withAnimation(reduceMotion ? nil : FeatureMotion.standard) { roundToast = false }
        }
    }
}

// MARK: - Progress header

/// Five rounds grouped Часть 1 / Часть 2: completed ✓, skipped —, active stretched, pending hollow.
struct PlacementSittingGroup: Identifiable {
    let id: Int
    let sections: [PlacementSectionView]
}

struct PlacementProgressHeader: View {
    let view: PlacementView
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var groups: [PlacementSittingGroup] {
        let first = PlacementSittingGroup(id: 1, sections: view.sections.filter { $0.sitting == 1 })
        let second = PlacementSittingGroup(id: 2, sections: view.sections.filter { $0.sitting != 1 })
        return [first, second].filter { !$0.sections.isEmpty }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 18) {
                ForEach(groups) { group in
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Часть \(group.id)").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                        HStack(spacing: 6) {
                            ForEach(group.sections) { section in dot(section) }
                        }
                    }
                }
                Spacer(minLength: 0)
                if view.remainingMinutes > 0 {
                    Text("≈ \(view.remainingMinutes) мин")
                        .font(.caption.weight(.semibold)).monospacedDigit()
                        .foregroundStyle(.secondary)
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .featureGlass(radius: 22)
        .animation(reduceMotion ? nil : FeatureMotion.standard, value: view.sections.map { $0.status + String($0.answered) }.joined())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityText)
    }

    @ViewBuilder private func dot(_ section: PlacementSectionView) -> some View {
        let active = section.status == "active" || (section.id == view.currentSection?.id && !section.isFinished)
        ZStack {
            if section.status == "completed" {
                Capsule().fill(FeaturePalette.violet)
                Image(systemName: "checkmark").font(.system(size: 8, weight: .heavy)).foregroundStyle(.white)
            } else if section.status == "skipped" {
                Capsule().strokeBorder(Color.secondary, style: StrokeStyle(lineWidth: 1.5, dash: [3, 2]))
            } else if active {
                Capsule().fill(FeaturePalette.lime)
                Capsule().strokeBorder(FeaturePalette.violet.opacity(0.6), lineWidth: 1.5)
            } else {
                Capsule().strokeBorder(FeaturePalette.track, lineWidth: 2)
            }
        }
        .frame(width: active ? 34 : 16, height: 16)
    }

    private var accessibilityText: String {
        let done = view.finishedSections
        var text = "Пройдено \(done) из \(view.sections.count) разделов"
        if let current = view.currentSection { text += ". Сейчас: " + current.title }
        if view.remainingMinutes > 0 { text += ". Осталось около \(view.remainingMinutes) минут" }
        return text
    }
}

// MARK: - Intro, break and section intros

struct PlacementIntroView: View {
    let view: PlacementView?
    let retake: Bool
    let working: Bool
    let start: () -> Void
    let later: () -> Void
    let back: (() -> Void)?
    let recheck: () -> Void

    private var sections: [PlacementSectionView] { view?.sections ?? [] }
    private var earlyRetakeDate: String? {
        guard retake, let iso = view?.retakeAvailableAt, let date = FeatureFormat.date(iso), date > Date() else { return nil }
        return FeatureFormat.longDate(iso)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 22) {
            HStack(alignment: .center, spacing: 16) {
                VoiceOrb(mode: .ready, level: 0, mood: .determined, statusDescription: "Готов к тесту", interactive: false)
                    .frame(width: 92, height: 96)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 6) {
                    Text(retake ? "Пересдать тест" : "Тест уровня")
                        .font(.largeTitle.weight(.bold)).fontDesign(.rounded)
                    Text(retake ? "Новые задания, тот же формат. Сравним честно." : "Узнаем твой настоящий уровень · ~25 мин")
                        .font(.subheadline).foregroundStyle(.secondary)
                }
            }
            .featureReveal(0)

            Text("Пять калибровочных раундов: как ты понимаешь живую речь, читаешь, строишь фразы, говоришь и ведёшь рабочий разговор. В итоге — уровень по каждому навыку с диапазоном и тем, что это значит для твоих звонков.")
                .font(.body)
                .fixedSize(horizontal: false, vertical: true)
                .featureReveal(1)

            sittingsCard.featureReveal(2)
            rulesCard.featureReveal(3)

            if let date = earlyRetakeDate {
                FeatureBanner(message: "Рекомендуем пересдавать после \(date): за пару недель изменения обычно в пределах погрешности. Пересдать можно и сейчас.", tone: .info)
            }
            if view?.audioAvailable == false {
                FeatureBanner(message: "Голос пока не подключён: аудио, речь и рабочая сцена будут пропущены, а результат — неполным. Голос подключается на компьютере: Профиль → Голос.",
                              tone: .info, actionTitle: "Проверить снова", action: recheck)
            }

            VStack(spacing: 12) {
                Button(action: start) {
                    HStack(spacing: 8) {
                        if working { ProgressView() }
                        Text(working ? "Готовлю тест…" : retake ? "Начать пересдачу" : "Начать тест")
                    }
                }
                .buttonStyle(PrimaryButton())
                .disabled(working)
                if let back {
                    Button("Назад к результату", action: back).buttonStyle(QuietButton())
                } else {
                    Button("Продолжу позже", action: later).buttonStyle(QuietButton())
                }
            }
            .featureReveal(4)
        }
    }

    private var sittingsCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            ForEach([1, 2], id: \.self) { sitting in
                VStack(alignment: .leading, spacing: 10) {
                    HStack {
                        Text("Часть \(sitting)").font(.headline)
                        Spacer()
                        Text("≈ \(minutes(for: sitting)) мин").font(.subheadline.weight(.semibold)).monospacedDigit().foregroundStyle(.secondary)
                    }
                    ForEach(rows(for: sitting), id: \.id) { row in
                        HStack(alignment: .top, spacing: 12) {
                            Image(systemName: FeatureLabels.sectionIcon(row.id))
                                .frame(width: 24)
                                .foregroundStyle(Color.primary)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(row.title).font(.subheadline.weight(.semibold))
                                Text(row.detail).font(.footnote).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                            }
                        }
                        .accessibilityElement(children: .combine)
                    }
                }
            }
        }
        .padding(18)
        .featureGlass(radius: 28)
    }

    private var rulesCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            rule("checkmark.circle", "Прогресс сохраняется после каждого ответа. Можно прерваться и вернуться в другой день.")
            rule("eye.slash", "Во время теста оценок нет. Разбор ответов — в конце.")
            rule("headphones", "Для частей с аудио и речью нужны тишина, наушники или громкий звук и микрофон.")
            rule("rosette", "Это ориентир, не сертификат: каждый навык — с диапазоном и уверенностью.")
        }
        .padding(18)
        .featureSurface(radius: 28, padding: 0)
    }

    private func rule(_ icon: String, _ text: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: icon).foregroundStyle(.secondary).frame(width: 22).accessibilityHidden(true)
            Text(text).font(.subheadline).fixedSize(horizontal: false, vertical: true)
        }
    }

    private struct Row { let id: String; let title: String; let detail: String }

    private func rows(for sitting: Int) -> [Row] {
        let fromServer = sections.filter { $0.sitting == sitting }
        if !fromServer.isEmpty {
            return fromServer.map { Row(id: $0.id, title: $0.title, detail: $0.description.isEmpty ? Self.defaultDetail($0.id) : $0.description) }
        }
        let ids = sitting == 1 ? ["listening", "reading", "language"] : ["speaking", "interaction"]
        return ids.map { Row(id: $0, title: FeatureLabels.section($0), detail: Self.defaultDetail($0)) }
    }

    private func minutes(for sitting: Int) -> Int {
        let total = sections.filter { $0.sitting == sitting }.reduce(0) { $0 + $1.minutes }
        return total > 0 ? total : 12
    }

    static func defaultDetail(_ id: String) -> String {
        switch id {
        case "listening": return "Короткие записи живой речи. Вопросы видны до прослушивания."
        case "reading": return "Короткие тексты о работе и жизни, по два вопроса."
        case "language": return "Грамматика и слова: что держишь без подсказок."
        case "speaking": return "Три коротких монолога и один неожиданный вопрос."
        case "interaction": return "Короткая рабочая сцена с продюсером агентства."
        default: return ""
        }
    }
}

struct PlacementSittingBreakView: View {
    let view: PlacementView?
    let proceed: () -> Void
    let later: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            HStack(spacing: 16) {
                VoiceOrb(mode: .ready, level: 0, mood: .proud, statusDescription: "Часть 1 готова", interactive: false)
                    .frame(width: 88, height: 92)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 6) {
                    Text("Часть 1 готова").font(.title.weight(.bold)).fontDesign(.rounded)
                    Text("Аудио, чтение и грамматика позади.").font(.subheadline).foregroundStyle(.secondary)
                }
            }
            .featureReveal(0)
            VStack(alignment: .leading, spacing: 10) {
                Text("Дальше — речь и короткая рабочая сцена, около 12 минут. Понадобятся тихое место и микрофон.")
                    .font(.body).fixedSize(horizontal: false, vertical: true)
                Text("Прогресс сохранён. Можно сделать перерыв и вернуться в другой день — лучше в течение двух недель.")
                    .font(.subheadline).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
            .padding(18)
            .featureGlass(radius: 28)
            .featureReveal(1)
            VStack(spacing: 12) {
                Button("Продолжить сейчас", action: proceed).buttonStyle(PrimaryButton())
                Button("Продолжу позже", action: later).buttonStyle(QuietButton())
            }
            .featureReveal(2)
        }
    }
}

struct PlacementSectionIntroView: View {
    let section: PlacementSectionView
    let audioAvailable: Bool
    let working: Bool
    let begin: () -> Void
    let skip: (String) -> Void
    @State private var confirmSkip = false

    private var voiceUnavailable: Bool { section.isVoice && !audioAvailable }

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            VStack(alignment: .leading, spacing: 12) {
                Text(section.title).font(.largeTitle.weight(.bold)).fontDesign(.rounded)
                    .accessibilityAddTraits(.isHeader)
                if !section.description.isEmpty {
                    Text(section.description).font(.body).fixedSize(horizontal: false, vertical: true)
                }
                let facts = [section.minutes > 0 ? "≈ \(section.minutes) мин" : "",
                             section.planned > 0 ? "до \(section.planned) " + FeatureFormat.plural(section.planned, "задания", "заданий", "заданий") : ""]
                    .filter { !$0.isEmpty }
                if !facts.isEmpty {
                    Text(facts.joined(separator: " · ")).font(.subheadline.weight(.semibold)).foregroundStyle(.secondary)
                }
            }
            .featureReveal(0)

            VStack(alignment: .leading, spacing: 10) {
                ForEach(hints, id: \.self) { hint in
                    HStack(alignment: .top, spacing: 10) {
                        Image(systemName: "checkmark.circle").font(.footnote).foregroundStyle(.secondary).padding(.top, 2)
                            .accessibilityHidden(true)
                        Text(hint).font(.subheadline).fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
            .padding(18)
            .featureGlass(radius: 28)
            .featureReveal(1)

            if voiceUnavailable {
                FeatureBanner(message: "Голос не подключён, поэтому этот раздел пройти не получится. Его можно пропустить: навык будет «не измерено». Голос подключается на компьютере: Профиль → Голос.", tone: .info)
            }

            VStack(spacing: 12) {
                if voiceUnavailable {
                    Button("Пропустить раздел") { skip("Голос не подключён") }
                        .buttonStyle(PrimaryButton())
                        .disabled(working)
                } else {
                    Button("Начать раздел", action: begin).buttonStyle(PrimaryButton())
                    if section.isVoice {
                        Button("Пропустить раздел") { confirmSkip = true }
                            .buttonStyle(QuietButton())
                            .disabled(working)
                    }
                }
            }
            .featureReveal(2)
        }
        .confirmationDialog("Пропустить «\(section.title)»?", isPresented: $confirmSkip, titleVisibility: .visible) {
            Button("Пропустить раздел", role: .destructive) { skip("Пропущено по выбору") }
            Button("Отмена", role: .cancel) {}
        } message: {
            Text("В результате этот навык будет «не измерено», а не низкий уровень. Пройти раздел можно при пересдаче.")
        }
    }

    private var hints: [String] {
        switch section.id {
        case "listening":
            return ["Вопросы видны до прослушивания — прочитай их сначала.",
                    "Число прослушиваний ограничено, счётчик рядом с кнопкой.",
                    "Надень наушники или сделай звук погромче."]
        case "reading":
            return ["Текст и вопросы на одном экране.", "Время не ограничено, но не застревай на одном вопросе."]
        case "language":
            return ["Выбирай вариант, который звучит естественно.", "Не знаешь — выбери наугад: это тоже честный ответ."]
        case "speaking":
            return ["Сначала время на подготовку, потом запись включится сама.",
                    "Говори хотя бы 15 секунд. Текст ответа не показываем и не редактируем.",
                    "Один вопрос будет без подготовки — как на настоящем звонке."]
        case "interaction":
            return ["Собеседник — продюсер агентства. Сначала прозвучит его реплика.",
                    "Отвечай голосом, как на настоящем звонке. Можно задавать вопросы и называть цифры."]
        default:
            return ["Отвечай так, как ответил бы в жизни."]
        }
    }
}

// MARK: - Waiting, scoring, errors

struct PlacementWaitingView: View {
    let text: String
    let retry: (() -> Void)?
    var body: some View {
        VStack(spacing: 16) {
            ProgressView()
            Text(text).font(.subheadline).foregroundStyle(.secondary)
            if let retry { Button("Обновить", action: retry).buttonStyle(QuietButton()) }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 60)
    }
}

struct PlacementUnavailableView: View {
    let message: String
    let retry: () -> Void
    let close: () -> Void
    var body: some View {
        VStack(spacing: 18) {
            VoiceOrb(mode: .ready, level: 0, mood: .sad, statusDescription: "Что-то пошло не так", interactive: false)
                .frame(width: 96, height: 100)
                .accessibilityHidden(true)
            Text("Тест сейчас не открылся").font(.title2.weight(.bold)).fontDesign(.rounded).multilineTextAlignment(.center)
            Text(message).font(.subheadline).foregroundStyle(.secondary).multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
            Button("Повторить", action: retry).buttonStyle(PrimaryButton())
            Button("Закрыть", action: close).buttonStyle(QuietButton())
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 40)
    }
}

struct PlacementScoringView: View {
    let failures: Int
    let close: () -> Void
    var body: some View {
        VStack(spacing: 18) {
            VoiceOrb(mode: .thinking, level: 0, mood: .thinking, statusDescription: "Считаю результат")
                .frame(width: 150, height: 158)
            Text("Считаю результат").font(.title.weight(.bold)).fontDesign(.rounded)
            Text("Оцениваю речь и рабочую сцену по описаниям уровней CEFR. Обычно это около двух минут.")
                .font(.body).foregroundStyle(.secondary).multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
            if failures > 0 {
                Label("Связь нестабильна, пробую ещё раз…", systemImage: "wifi.exclamationmark")
                    .font(.footnote).foregroundStyle(.secondary)
            }
            Button("Закрыть — результат появится в приложении", action: close)
                .buttonStyle(QuietButton())
                .padding(.top, 8)
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 32)
        .accessibilityElement(children: .contain)
    }
}

struct PlacementScoringErrorView: View {
    let message: String?
    let working: Bool
    let rescore: () -> Void
    let close: () -> Void
    private var detailText: String {
        let prefix = (message ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        return (prefix.isEmpty ? "" : prefix + " ") + "Ответы сохранены — подсчёт можно запустить ещё раз."
    }
    var body: some View {
        VStack(spacing: 18) {
            VoiceOrb(mode: .ready, level: 0, mood: .sad, statusDescription: "Подсчёт не удался", interactive: false)
                .frame(width: 110, height: 116)
                .accessibilityHidden(true)
            Text("Не получилось посчитать результат").font(.title2.weight(.bold)).fontDesign(.rounded).multilineTextAlignment(.center)
            Text(detailText)
                .font(.subheadline).foregroundStyle(.secondary).multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
            Button(action: rescore) {
                HStack(spacing: 8) {
                    if working { ProgressView() }
                    Text("Повторить подсчёт")
                }
            }
            .buttonStyle(PrimaryButton())
            .disabled(working)
            Button("Закрыть", action: close).buttonStyle(QuietButton())
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 32)
    }
}
