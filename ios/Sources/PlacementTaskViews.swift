import SwiftUI
import AVFoundation
import Combine
import UIKit

// Placement task screens. No right/wrong feedback during the test; answers go straight to the
// server and the next task replaces the current one.

enum PlacementVoiceStage: Equatable {
    case preparing
    case ready
    case starting
    case recording
    case interrupted
    case sending
    case failed(String)
    case denied
}

/// Actions of the shared voice panel (one struct instead of many closure parameters).
struct PlacementVoiceActions {
    let skipPreparation: () -> Void
    let start: () -> Void
    let stop: () -> Void
    let send: () -> Void
    let redo: () -> Void
    let skipSection: () -> Void

    static func interruptionBegan(_ note: Notification) -> Bool {
        guard let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt else { return false }
        return raw == AVAudioSession.InterruptionType.began.rawValue
    }

    @MainActor static func openSystemSettings() {
        guard let url = URL(string: UIApplication.openSettingsURLString) else { return }
        UIApplication.shared.open(url)
    }
}

struct PlacementTaskHeader: View {
    let index: Int
    let total: Int
    let instruction: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if total > 0 {
                Text("Задание \(min(index, total)) из \(total)")
                    .font(.caption.weight(.semibold))
                    .monospacedDigit()
                    .foregroundStyle(.secondary)
            }
            if let instruction, !instruction.isEmpty {
                Text(instruction)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Choice (listening, reading, language)

struct PlacementChoiceView: View {
    let task: PlacementChoiceTask
    @ObservedObject var store: PlacementStore
    @ObservedObject var player: FeatureAudioPlayer
    @State private var selected: Int?
    @State private var plays = 0
    @State private var appearedAt = Date()
    @State private var clipError: String?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var clipKey: String { "placement-clip-" + task.id }
    private var clipActive: Bool { player.activeKey == clipKey }
    private var clipPlaying: Bool { clipActive && player.isPlaying }

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            PlacementTaskHeader(index: task.index, total: task.total, instruction: task.instruction)
            if let passage = task.passage, !passage.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                passageCard(passage)
            }
            if let clip = task.audio {
                listeningCard(clip)
            }
            Text(task.prompt)
                .font(.title3.weight(.semibold))
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)
            options
            submitButton
        }
        .onAppear { appearedAt = Date() }
        .onChange(of: player.lastEnd) { _, end in
            guard let end, end.key == clipKey, end.completed else { return }
            plays += 1
        }
        .onReceive(NotificationCenter.default.publisher(for: AVAudioSession.interruptionNotification)) { note in
            // An interrupted listen is never counted and can be replayed.
            if PlacementVoiceActions.interruptionBegan(note), clipActive { player.stop() }
        }
        .onDisappear { if clipActive { player.stop() } }
        .sensoryFeedback(.selection, trigger: selected)
    }

    private func passageCard(_ passage: String) -> some View {
        Text(passage)
            .font(.body)
            .lineSpacing(3)
            .fixedSize(horizontal: false, vertical: true)
            .textSelection(.enabled)
            .featureSurface(radius: 24, padding: 18)
    }

    private func listeningCard(_ clip: PlacementClip) -> some View {
        let used = min(plays, clip.maxPlays)
        let exhausted = plays >= clip.maxPlays
        let loading = player.loadingKey == clipKey
        return VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 14) {
                MeasuredVoiceOrb(meter: player.meter, mode: clipPlaying ? .speaking : .ready, mood: .friendly,
                                 statusDescription: clipPlaying ? "Звучит запись" : "Запись готова", interactive: false)
                    .frame(width: 64, height: 68)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 4) {
                    Text(listeningTitle(exhausted: exhausted, loading: loading))
                        .font(.headline)
                        .fixedSize(horizontal: false, vertical: true)
                    Text("Прослушиваний: \(used) из \(clip.maxPlays)")
                        .font(.subheadline)
                        .monospacedDigit()
                        .foregroundStyle(.secondary)
                }
                Spacer(minLength: 0)
                FeaturePlayButton(isPlaying: clipPlaying, isLoading: loading, label: "Включить запись") { toggle(clip) }
                    .disabled(exhausted && !clipActive)
            }
            if clipPlaying {
                FeatureProgressBar(value: player.progress, tint: FeaturePalette.cyan, height: 6, accessibilityText: "Запись звучит")
            }
            if let clipError {
                Text(clipError).font(.footnote).foregroundStyle(FeaturePalette.error).fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(16)
        .featureGlass(radius: 26, tint: FeaturePalette.cyan.opacity(0.35))
    }

    private func listeningTitle(exhausted: Bool, loading: Bool) -> String {
        if loading { return "Загружаю запись…" }
        if clipPlaying { return "Слушай внимательно" }
        if exhausted { return "Прослушиваний больше нет" }
        return plays == 0 ? "Прочитай вопрос и включи запись" : "Можно послушать ещё раз"
    }

    private func toggle(_ clip: PlacementClip) {
        if clipActive {
            // A deliberate stop after most of the clip counts as a listen; a system interruption never does.
            if player.isPlaying && player.progress >= 0.5 { plays += 1 }
            player.stop()
            return
        }
        guard plays < clip.maxPlays, player.loadingKey != clipKey else { return }
        clipError = nil
        player.beginLoading(clipKey)
        Task {
            do {
                let data = try await store.clip(clip.url)
                guard player.loadingKey == clipKey else { return }
                await player.play(data: data, key: clipKey)
                if let message = player.error { clipError = message }
            } catch {
                player.cancelLoading(clipKey)
                if !FeatureErrorText.isCancellation(error) { clipError = FeatureErrorText.describe(error) }
            }
        }
    }

    private var options: some View {
        VStack(spacing: 10) {
            ForEach(FeatureIndexed.list(task.options)) { option in
                PlacementOptionTile(letter: Self.letter(option.id), text: option.value, selected: selected == option.id) {
                    withAnimation(reduceMotion ? nil : FeatureMotion.press) { selected = option.id }
                }
            }
        }
    }

    private var submitButton: some View {
        Button {
            Task { await answer() }
        } label: {
            HStack(spacing: 8) {
                if store.working { ProgressView() }
                Text(store.working ? "Сохраняю…" : "Дальше")
            }
        }
        .buttonStyle(PrimaryButton())
        .disabled(selected == nil || store.working)
        .padding(.top, 4)
    }

    private func answer() async {
        guard let choice = selected, !store.working else { return }
        if clipActive { player.stop() }
        let elapsed = FeatureNumber.int(Date().timeIntervalSince(appearedAt) * 1000) ?? 0
        await store.answer(taskId: task.id, choice: choice, plays: task.audio == nil ? nil : plays, elapsedMs: elapsed)
    }

    static func letter(_ index: Int) -> String {
        let letters = ["A", "B", "C", "D", "E", "F"]
        return index >= 0 && index < letters.count ? letters[index] : String(index + 1)
    }
}

struct PlacementOptionTile: View {
    let letter: String
    let text: String
    let selected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(alignment: .firstTextBaseline, spacing: 14) {
                Text(letter)
                    .font(.subheadline.weight(.bold))
                    .fontDesign(.rounded)
                    .foregroundStyle(selected ? Color.white : Color.primary)
                    .frame(width: 30, height: 30)
                    .background(Circle().fill(selected ? FeaturePalette.violet : FeaturePalette.track))
                Text(text)
                    .font(.body)
                    .multilineTextAlignment(.leading)
                    .fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 0)
                if selected {
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundStyle(FeaturePalette.violet)
                        .transition(.scale.combined(with: .opacity))
                }
            }
            .foregroundStyle(Color.primary)
            .padding(.horizontal, 16)
            .padding(.vertical, 14)
            .frame(maxWidth: .infinity, minHeight: 56, alignment: .leading)
            .contentShape(Rectangle())
            .featureGlass(radius: 22, tint: selected ? FeaturePalette.lavender : nil, interactive: true)
        }
        .buttonStyle(FeatureTileButtonStyle())
        .accessibilityLabel("Вариант " + letter + ": " + text)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

// MARK: - Speaking

struct PlacementSpeakingView: View {
    let task: PlacementSpeakingTask
    @ObservedObject var store: PlacementStore
    @ObservedObject var recorder: TaskRecorder
    @EnvironmentObject private var client: TrainingClient
    @Environment(\.scenePhase) private var scenePhase
    @State private var stage: PlacementVoiceStage = .preparing
    @State private var prepRemaining = 0
    @State private var notice: String?
    @State private var confirmShortStop = false
    @State private var confirmSkip = false

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            PlacementTaskHeader(index: task.index, total: task.total, instruction: nil)
            promptCard
            PlacementVoicePanel(stage: stage, prepRemaining: prepRemaining, prepTotal: task.prepSeconds,
                                elapsed: recorder.elapsed, minSeconds: task.minSeconds, maxSeconds: task.maxSeconds,
                                meter: recorder.meter, notice: notice, startTitle: "Начать запись", actions: actions)
        }
        .task(id: task.id) { await runPreparation() }
        .onChange(of: recorder.autoStops) { _, _ in handleAutoStop() }
        .onReceive(NotificationCenter.default.publisher(for: AVAudioSession.interruptionNotification)) { note in
            if PlacementVoiceActions.interruptionBegan(note) { interrupt() }
        }
        .onChange(of: scenePhase) { _, phase in
            if phase != .active { interrupt() }
        }
        .onDisappear {
            if stage == .recording || stage == .starting { recorder.reset() }
        }
        .confirmationDialog("Ответ короче \(task.minSeconds) секунд", isPresented: $confirmShortStop, titleVisibility: .visible) {
            Button("Закончить и отправить") { Task { await stopAndSend() } }
            Button("Продолжить говорить", role: .cancel) {}
        } message: {
            Text("Такой короткий ответ может не засчитаться. Если можешь, добавь ещё пару предложений.")
        }
        .confirmationDialog("Пропустить раздел «Речь»?", isPresented: $confirmSkip, titleVisibility: .visible) {
            Button("Пропустить раздел", role: .destructive) {
                Task { await store.skip(section: task.section, reason: "Микрофон недоступен") }
            }
            Button("Отмена", role: .cancel) {}
        } message: {
            Text("Навык будет «не измерено», а не низкий уровень.")
        }
    }

    private var promptCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            if task.followUp || task.readAloud {
                Text([task.followUp ? "Без подготовки" : "", task.readAloud ? "Прочитай вслух" : ""].filter { !$0.isEmpty }.joined(separator: " · "))
                    .font(.footnote.weight(.semibold)).foregroundStyle(.secondary)
            }
            if !task.instruction.isEmpty {
                Text(task.instruction)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Text(task.prompt)
                .font(task.readAloud ? Font.body : Font.title3.weight(.semibold))
                .lineSpacing(task.readAloud ? 4 : 1)
                .fixedSize(horizontal: false, vertical: true)
        }
        .featureSurface(radius: 26, padding: 18)
    }

    private var actions: PlacementVoiceActions {
        PlacementVoiceActions(
            skipPreparation: { Task { await beginRecording() } },
            start: { Task { await beginRecording() } },
            stop: { requestStop() },
            send: { Task { await send() } },
            redo: {
                recorder.discardTake()
                Task { await beginRecording() }
            },
            skipSection: { confirmSkip = true })
    }

    private func runPreparation() async {
        notice = nil
        recorder.reset()
        if task.prepSeconds > 0 {
            stage = .preparing
            prepRemaining = task.prepSeconds
            while prepRemaining > 0 {
                do { try await Task.sleep(for: .seconds(1)) } catch { return }
                guard stage == .preparing else { return }
                prepRemaining -= 1
            }
        }
        guard stage == .preparing else { return }
        // Previews never touch the microphone.
        if store.isPreview { stage = .ready; return }
        // Recording starts by itself when preparation ends: leading silence measures real latency.
        if task.autoStart { await beginRecording() } else { stage = .ready }
    }

    private func beginRecording() async {
        switch stage {
        case .starting, .recording, .sending: return
        default: break
        }
        notice = nil
        stage = .starting
        let started = await recorder.start(maxSeconds: task.maxSeconds, client: client)
        guard stage == .starting else {
            if started { recorder.reset() }
            return
        }
        if started {
            stage = .recording
        } else if recorder.permissionDenied {
            stage = .denied
        } else {
            notice = recorder.message ?? "Не получилось включить микрофон. Попробуй ещё раз."
            stage = .ready
        }
    }

    private func requestStop() {
        guard stage == .recording else { return }
        if recorder.elapsed < Double(task.minSeconds) {
            confirmShortStop = true
        } else {
            Task { await stopAndSend() }
        }
    }

    private func stopAndSend() async {
        guard stage == .recording else { return }
        recorder.stop()
        await send()
    }

    private func send() async {
        guard recorder.take != nil else {
            notice = "Запись не сохранилась. Запиши ответ ещё раз."
            stage = .ready
            return
        }
        stage = .sending
        do {
            let transcription = try await recorder.upload(client: client)
            let accepted = await store.speak(taskId: task.id, transcription: transcription)
            if accepted {
                recorder.discardTake()
                if store.view?.task?.id == task.id {
                    notice = "Ответ получен, но задание осталось тем же. Запиши ответ ещё раз."
                    stage = .ready
                }
            } else {
                stage = .failed(store.error ?? "Ответ не сохранился.")
                store.error = nil
            }
        } catch {
            stage = .failed(FeatureErrorText.describe(error))
        }
    }

    private func handleAutoStop() {
        guard stage == .recording else { return }
        if recorder.message == nil {
            Task { await send() }
        } else {
            stage = .interrupted
        }
    }

    private func interrupt() {
        guard stage == .recording else { return }
        recorder.stop()
        stage = .interrupted
    }
}

// MARK: - Roleplay

struct PlacementRoleplayView: View {
    let task: PlacementRoleplayTask
    @ObservedObject var store: PlacementStore
    @ObservedObject var recorder: TaskRecorder
    @ObservedObject var player: FeatureAudioPlayer
    @EnvironmentObject private var client: TrainingClient
    @Environment(\.scenePhase) private var scenePhase
    @State private var stage: PlacementVoiceStage = .ready
    @State private var notice: String?
    @State private var lineError: String?
    /// The task whose line could not be played: its text is shown instead (MOTION-PASS §6 fallback).
    @State private var unvoicedTask: String?
    /// The task whose line the learner opened; the next line arrives hidden.
    @State private var revealedTask: String?
    @State private var confirmSkip = false

    private var lineKey: String { "placement-line-" + task.id }
    private var lineActive: Bool { player.activeKey == lineKey }
    private var linePlaying: Bool { lineActive && player.isPlaying }
    /// The line has no voice (no clip, voice off, or playback failed): it is read, not hidden.
    private var lineForced: Bool {
        task.partnerLine?.audioUrl?.isEmpty != false || store.view?.audioAvailable == false || unvoicedTask == task.id
    }
    private var partnerName: String {
        let first = task.partnerRole.split(separator: ",").first.map { String($0).trimmingCharacters(in: .whitespaces) } ?? ""
        return first.isEmpty ? "Собеседник" : first
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            PlacementTaskHeader(index: task.index, total: task.total, instruction: nil)
            setupCard
            partnerCard
            PlacementVoicePanel(stage: stage, prepRemaining: 0, prepTotal: 0, elapsed: recorder.elapsed, minSeconds: 0,
                                maxSeconds: task.maxSeconds, meter: recorder.meter, notice: notice,
                                startTitle: "Ответить голосом", actions: actions)
        }
        .task(id: task.id) {
            recorder.reset()
            await playLine()
        }
        .onChange(of: recorder.autoStops) { _, _ in handleAutoStop() }
        .onReceive(NotificationCenter.default.publisher(for: AVAudioSession.interruptionNotification)) { note in
            guard PlacementVoiceActions.interruptionBegan(note) else { return }
            if lineActive { player.stop() }
            interrupt()
        }
        .onChange(of: scenePhase) { _, phase in
            if phase != .active { interrupt() }
        }
        .onDisappear {
            if lineActive { player.stop() }
            if stage == .recording || stage == .starting { recorder.reset() }
        }
        .confirmationDialog("Пропустить рабочую сцену?", isPresented: $confirmSkip, titleVisibility: .visible) {
            Button("Пропустить раздел", role: .destructive) {
                Task { await store.skip(section: task.section, reason: "Микрофон недоступен") }
            }
            Button("Отмена", role: .cancel) {}
        } message: {
            Text("Разговорный навык и ходы разговора будут «не измерено».")
        }
    }

    private var setupCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            if !task.instruction.isEmpty {
                Text(task.instruction).font(.subheadline).fixedSize(horizontal: false, vertical: true)
            }
            if !task.partnerRole.isEmpty {
                Label(task.partnerRole, systemImage: "person.crop.circle")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Text("Ответ — до " + FeatureFormat.count(task.maxSeconds, "секунды", "секунд", "секунд"))
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var partnerCard: some View {
        HStack(alignment: .top, spacing: 14) {
            MeasuredVoiceOrb(meter: player.meter, mode: linePlaying ? .speaking : .ready, mood: .friendly,
                             statusDescription: partnerName, interactive: false)
                .frame(width: 72, height: 76)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 8) {
                Text(partnerName).font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                // Heard first, like every partner line (§6); «Показать текст» opens this line only.
                PartnerLineReveal(text: task.partnerLine?.text ?? "", font: .title3.weight(.semibold),
                                  shown: lineForced || revealedTask == task.id, canHide: !lineForced,
                                  note: "Реплика звучит голосом. Текст можно открыть, если не расслышал.",
                                  reveal: { revealedTask = task.id }, hide: { revealedTask = nil })
                if task.partnerLine?.audioUrl != nil {
                    Button {
                        replay()
                    } label: {
                        Label(linePlaying ? "Остановить" : "Послушать ещё раз", systemImage: linePlaying ? "stop.fill" : "speaker.wave.2.fill")
                    }
                    .buttonStyle(QuietButton())
                    .disabled(stage == .recording || stage == .starting || stage == .sending)
                }
                if let lineError {
                    Text(lineError).font(.footnote).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                }
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .featureGlass(radius: 26, tint: FeaturePalette.lavender.opacity(0.5))
        .accessibilityElement(children: .contain)
    }

    private var actions: PlacementVoiceActions {
        PlacementVoiceActions(
            skipPreparation: { Task { await beginRecording() } },
            start: { Task { await beginRecording() } },
            stop: { Task { await stopAndSend() } },
            send: { Task { await send() } },
            redo: {
                recorder.discardTake()
                Task { await beginRecording() }
            },
            skipSection: { confirmSkip = true })
    }

    private func playLine() async {
        guard let path = task.partnerLine?.audioUrl, !path.isEmpty, !store.isPreview else { return }
        lineError = nil
        player.beginLoading(lineKey)
        do {
            let data = try await store.clip(path)
            guard player.loadingKey == lineKey, stage != .recording, stage != .starting else {
                player.cancelLoading(lineKey)
                return
            }
            await player.play(data: data, key: lineKey)
            if player.error != nil && player.activeKey != lineKey {
                unvoicedTask = task.id
                lineError = "Звук реплики не включился — прочитай её текст."
            }
        } catch {
            player.cancelLoading(lineKey)
            if !FeatureErrorText.isCancellation(error) {
                unvoicedTask = task.id
                lineError = "Звук реплики не загрузился — прочитай её текст."
            }
        }
    }

    private func replay() {
        if lineActive {
            player.stop()
        } else {
            Task { await playLine() }
        }
    }

    private func beginRecording() async {
        switch stage {
        case .starting, .recording, .sending: return
        default: break
        }
        if lineActive || player.loadingKey == lineKey { player.stop() }
        notice = nil
        stage = .starting
        let started = await recorder.start(maxSeconds: task.maxSeconds, client: client)
        guard stage == .starting else {
            if started { recorder.reset() }
            return
        }
        if started {
            stage = .recording
        } else if recorder.permissionDenied {
            stage = .denied
        } else {
            notice = recorder.message ?? "Не получилось включить микрофон. Попробуй ещё раз."
            stage = .ready
        }
    }

    private func stopAndSend() async {
        guard stage == .recording else { return }
        recorder.stop()
        await send()
    }

    private func send() async {
        guard recorder.take != nil else {
            notice = "Запись не сохранилась. Ответь ещё раз."
            stage = .ready
            return
        }
        stage = .sending
        do {
            let transcription = try await recorder.upload(client: client)
            let accepted = await store.speak(taskId: task.id, transcription: transcription)
            if accepted {
                recorder.discardTake()
                if store.view?.task?.id == task.id {
                    notice = "Ответ получен, но реплика осталась той же. Ответь ещё раз."
                    stage = .ready
                }
            } else {
                stage = .failed(store.error ?? "Ответ не сохранился.")
                store.error = nil
            }
        } catch {
            stage = .failed(FeatureErrorText.describe(error))
        }
    }

    private func handleAutoStop() {
        guard stage == .recording else { return }
        if recorder.message == nil {
            Task { await send() }
        } else {
            stage = .interrupted
        }
    }

    private func interrupt() {
        guard stage == .recording else { return }
        recorder.stop()
        stage = .interrupted
    }
}

// MARK: - Voice panel

struct PlacementVoicePanel: View {
    let stage: PlacementVoiceStage
    let prepRemaining: Int
    let prepTotal: Int
    let elapsed: Double
    let minSeconds: Int
    let maxSeconds: Int
    let meter: VoiceMeter
    let notice: String?
    let startTitle: String
    let actions: PlacementVoiceActions
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        VStack(spacing: 16) {
            content
            if let notice, !notice.isEmpty {
                Text(notice)
                    .font(.footnote)
                    .foregroundStyle(FeaturePalette.error)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(18)
        .featureGlass(radius: 28)
        .animation(reduceMotion ? nil : FeatureMotion.standard, value: stage)
    }

    @ViewBuilder private var content: some View {
        switch stage {
        case .preparing: preparing
        case .ready: ready
        case .starting: waiting("Включаю микрофон…")
        case .recording: recording
        case .interrupted: interrupted
        case .sending: waiting("Сохраняю ответ…")
        case .failed(let message): failed(message)
        case .denied: denied
        }
    }

    private var preparing: some View {
        VStack(spacing: 14) {
            PlacementCountdownRing(remaining: prepRemaining, total: prepTotal)
            Text("Подготовка").font(.headline)
            Text("Запись включится сама, когда время выйдет.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
            Button("Я готов — начать запись", action: actions.skipPreparation)
                .buttonStyle(QuietButton())
        }
    }

    private var ready: some View {
        VStack(spacing: 14) {
            Image(systemName: "mic.fill")
                .font(.system(size: 30, weight: .semibold))
                .foregroundStyle(FeaturePalette.violet)
                .frame(width: 76, height: 76)
                .background(FeaturePalette.lavender.opacity(0.35), in: Circle())
                .accessibilityHidden(true)
            Button(startTitle, action: actions.start)
                .buttonStyle(PrimaryButton())
        }
    }

    private var recording: some View {
        VStack(spacing: 12) {
            MeasuredVoiceOrb(meter: meter, mode: .listening, mood: .attentive, statusDescription: "Слушаю твой ответ", interactive: false)
                .frame(width: 120, height: 126)
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text(FeatureFormat.clock(elapsed))
                    .font(.system(.largeTitle, design: .rounded).weight(.bold))
                    .monospacedDigit()
                Text("из " + FeatureFormat.clock(Double(maxSeconds)))
                    .font(.subheadline)
                    .monospacedDigit()
                    .foregroundStyle(.secondary)
            }
            .accessibilityElement(children: .combine)
            timeBar
            Button(action: actions.stop) {
                Label("Закончить ответ", systemImage: "stop.fill")
            }
            .buttonStyle(PrimaryButton())
        }
    }

    private var timeBar: some View {
        let reached = elapsed >= Double(minSeconds)
        let left = max(0, minSeconds - (FeatureNumber.int(elapsed.rounded(.down)) ?? 0))
        return VStack(alignment: .leading, spacing: 6) {
            FeatureProgressBar(value: maxSeconds > 0 ? elapsed / Double(maxSeconds) : 0,
                               tint: reached ? FeaturePalette.lime : FeaturePalette.violet, height: 6,
                               accessibilityText: "Время ответа")
            Text(reached ? "Можно заканчивать, когда мысль завершена" : "Говори ещё хотя бы \(left) с")
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
    }

    private var interrupted: some View {
        VStack(spacing: 12) {
            Label("Запись прервалась", systemImage: "pause.circle").font(.headline)
            Text("Записано " + FeatureFormat.clock(elapsed) + ". Отправь как есть или запиши ответ заново.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
            Button("Отправить как есть", action: actions.send).buttonStyle(PrimaryButton())
            Button("Записать заново", action: actions.redo).buttonStyle(SecondaryButton())
        }
    }

    private func failed(_ message: String) -> some View {
        VStack(spacing: 12) {
            Label("Ответ не отправился", systemImage: "exclamationmark.triangle")
                .font(.headline)
                .foregroundStyle(FeaturePalette.error)
            Text(message + " Запись сохранена на iPhone.")
                .font(.subheadline)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
            Button("Отправить ещё раз", action: actions.send).buttonStyle(PrimaryButton())
        }
    }

    private var denied: some View {
        VStack(spacing: 12) {
            Image(systemName: "mic.slash")
                .font(.system(size: 30, weight: .semibold))
                .foregroundStyle(FeaturePalette.error)
                .accessibilityHidden(true)
            Text("Микрофон выключен").font(.headline)
            Text("Разреши доступ к микрофону в настройках iPhone. Или пропусти раздел — навык будет «не измерено».")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
            Button("Открыть настройки") { PlacementVoiceActions.openSystemSettings() }
                .buttonStyle(PrimaryButton())
            Button("Пропустить раздел", action: actions.skipSection)
                .buttonStyle(QuietButton())
        }
    }

    private func waiting(_ text: String) -> some View {
        VStack(spacing: 12) {
            ProgressView()
            Text(text).font(.subheadline).foregroundStyle(.secondary)
        }
        .padding(.vertical, 20)
    }
}

struct PlacementCountdownRing: View {
    let remaining: Int
    let total: Int
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var fraction: CGFloat {
        guard total > 0 else { return 0 }
        return CGFloat(min(max(remaining, 0), total)) / CGFloat(total)
    }

    var body: some View {
        ZStack {
            Circle().stroke(FeaturePalette.track, lineWidth: 10)
            Circle()
                .trim(from: 0, to: fraction)
                .stroke(FeaturePalette.violet, style: StrokeStyle(lineWidth: 10, lineCap: .round))
                .rotationEffect(.degrees(-90))
                .animation(reduceMotion ? nil : .linear(duration: 1), value: remaining)
            Text("\(max(0, remaining))")
                .font(.system(size: 40, weight: .bold, design: .rounded))
                .monospacedDigit()
                .contentTransition(reduceMotion ? .identity : .numericText(countsDown: true))
        }
        .frame(width: 132, height: 132)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Подготовка: осталось " + FeatureFormat.count(max(0, remaining), "секунда", "секунды", "секунд"))
    }
}
