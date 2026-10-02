import SwiftUI

struct OnboardingView: View {
    let onboarding: OnboardingState
    @EnvironmentObject private var client: TrainingClient
    @State private var russianControl = ""
    @FocusState private var answerFocused: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    private var nextStep: String? { onboarding.steps.first { $0.status != "ready" }?.id }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    HStack {
                        BrandMark(size: 42)
                        Spacer()
                        StatusPill(title: onboarding.status == "intro" ? "Знакомство" : "\(onboarding.completedStages) из 3 проб", color: Theme.lavender.opacity(0.55))
                    }.padding(.top, 8)
                    if onboarding.status == "intro" { introduction.transition(reduceMotion ? .identity : NativeMotion.insertion) }
                    else { baseline.transition(reduceMotion ? .identity : NativeMotion.insertion) }
                    if client.hasUnuploadedRecording && client.orphanedRecording { oldRecording }
                    if client.busy {
                        ActivityPanel(title: client.operationStage ?? "Сохраняю результат", detail: "Можно остановиться после любого этапа. Мы сохраним место.", startedAt: client.operationStartedAt)
                    }
                }.padding(20).frame(maxWidth: 640).frame(maxWidth: .infinity)
                    .animation(reduceMotion ? nil : NativeMotion.reveal, value: onboarding.status)
            }.background(Theme.surface).navigationBarHidden(true)
                .scrollDismissesKeyboard(.interactively)
                .refreshable { await client.perform { try await client.refresh() } }
        }
    }

    private var introduction: some View {
        VStack(alignment: .leading, spacing: 22) {
            ScreenHeading(title: "Давай сначала\nпознакомимся.", subtitle: "Не надо звучать идеально. Мне нужно услышать, как ты говоришь сейчас.")
            SurfaceCard {
                VStack(alignment: .leading, spacing: 18) {
                    Label("Три короткие пробы", systemImage: "waveform").font(.headline)
                    Text("Расскажешь о себе, послушаешь собеседника и разберёшь ситуацию посложнее. Это займёт примерно 15–25 минут. Можно пройти за несколько дней.")
                        .font(.subheadline).foregroundStyle(Theme.secondary)
                    Divider().opacity(0.5)
                    Text("Первый ответ давай сам, без переводчика. Если застрял, попроси повторить или объяснить: это тоже часть разговора. После каждой пробы получишь разбор и шанс ответить лучше.")
                        .font(.subheadline).fixedSize(horizontal: false, vertical: true)
                    Text("В стартовый уровень идут самостоятельные ответы. Исправленный текст и повторы с подсказками помогут учиться, но не сделают оценку выше.")
                        .font(.footnote).foregroundStyle(Theme.secondary)
                }
            }
            SurfaceCard(color: Theme.lavender.opacity(0.38)) {
                VStack(alignment: .leading, spacing: 14) {
                    Text("Сначала по-русски").font(.headline)
                    Text(onboarding.russianPrompt).font(.subheadline).fixedSize(horizontal: false, vertical: true)
                    Text("Ответь в 2–4 предложениях, как в живом разговоре. Это поможет отделить английский от привычек общения.")
                        .font(.footnote).foregroundStyle(Theme.secondary)
                    TextField("Твой ответ", text: $russianControl, axis: .vertical)
                        .lineLimit(4...9).focused($answerFocused).padding(15)
                        .background(Color.white.opacity(0.85), in: RoundedRectangle(cornerRadius: 16))
                        .accessibilityLabel("Короткий ответ по-русски")
                        .onChange(of: russianControl) { _, value in
                            if value.count > 2000 { russianControl = String(value.prefix(2000)) }
                        }
                }
            }
            Button {
                answerFocused = false
                Task { await client.completeIntroduction(russianControl: russianControl.trimmingCharacters(in: .whitespacesAndNewlines)) }
            } label: {
                HStack { Text("Познакомились. Начнём"); Spacer(); Image(systemName: "arrow.right") }
            }.buttonStyle(PrimaryButton()).disabled(client.busy || russianControl.trimmingCharacters(in: .whitespacesAndNewlines).count < 20)
            Text("Микрофон и звук понадобятся на следующем этапе. Их можно настроить во вкладке «Настройки».")
                .font(.footnote).foregroundStyle(Theme.secondary)
        }
    }

    private var baseline: some View {
        VStack(alignment: .leading, spacing: 22) {
            ScreenHeading(title: "Твоя точка старта.", subtitle: "Три разные ситуации. Начнём с простого и посмотрим, где тебе легко, а где нужна практика.")
            if client.status?.audio.configured != true {
                Label("Сначала подключи голос во вкладке «Настройки». Для пробы на слух нужен звук.", systemImage: "speaker.wave.2")
                    .font(.subheadline).padding(18).background(Theme.lime.opacity(0.45), in: RoundedRectangle(cornerRadius: 22))
            }
            ForEach(Array(onboarding.steps.enumerated()), id: \.element.id) { index, step in
                stepCard(step, index: index)
            }
            Text("Это предварительная оценка, а не экзаменационный сертификат. Произношение и темп нельзя честно оценить только по распознанному тексту.")
                .font(.footnote).foregroundStyle(Theme.secondary)
        }
    }

    private func stepCard(_ step: BaselineStep, index: Int) -> some View {
        SurfaceCard(color: step.status == "ready" ? Theme.lime.opacity(0.38) : .white) {
            VStack(alignment: .leading, spacing: 16) {
                HStack(alignment: .top, spacing: 14) {
                    Text(String(format: "%02d", index + 1)).font(.system(.title, design: .rounded).weight(.semibold)).monospacedDigit()
                        .foregroundStyle(Theme.secondary)
                    VStack(alignment: .leading, spacing: 6) {
                        Text(step.title).font(.title3.weight(.semibold))
                        Text(step.focus).font(.subheadline).foregroundStyle(Theme.secondary)
                    }
                }
                HStack {
                    Label("Около \(step.minutes) мин", systemImage: "clock").font(.caption).foregroundStyle(Theme.secondary)
                    Spacer()
                    if step.status == "ready" { Label("Проба получена", systemImage: "checkmark.circle.fill").font(.caption.weight(.medium)) }
                }
                if let missing = step.missingEvidence { Text(missing).font(.footnote).foregroundStyle(Theme.secondary) }
                if step.id == nextStep || step.sessionId != nil {
                    Button { Task { await client.startBaseline(step) } } label: {
                        HStack {
                            Text(step.status == "ready" ? "Посмотреть разбор" : step.status == "analysing" ? "Открыть подготовку разбора" : step.sessionId != nil ? "Продолжить пробу" : "Начать пробу")
                            Spacer(); Image(systemName: "arrow.up.right")
                        }
                    }.buttonStyle(SecondaryButton()).disabled(client.busy || client.hasUnuploadedRecording || (step.sessionId == nil && client.status?.audio.configured != true))
                    if let id = step.sessionId, step.status != "ready", let attempt = client.state?.sessions.first(where: { $0.id == id }), ["review", "completed"].contains(attempt.status) {
                        Button { Task { await client.startBaseline(step, retake: true) } } label: {
                            Label("Новая самостоятельная проба", systemImage: "arrow.clockwise")
                        }.buttonStyle(PrimaryButton()).disabled(client.busy || client.hasUnuploadedRecording || client.status?.audio.configured != true)
                    }
                } else {
                    Text("Откроется после предыдущей пробы").font(.caption).foregroundStyle(Theme.secondary)
                }
            }
        }.animation(reduceMotion ? nil : NativeMotion.reveal, value: step.status)
            .sensoryFeedback(trigger: step.status) { _, current in current == "ready" ? .success : nil }
    }

    private var oldRecording: some View {
        SurfaceCard {
            VStack(alignment: .leading, spacing: 14) {
                Text("Запись старого занятия").font(.headline)
                Text("Она осталась только на iPhone и не попадёт в новый стартовый профиль. Прослушай её перед удалением.")
                    .font(.subheadline).foregroundStyle(Theme.secondary)
                Button { Task { await client.playRecording() } } label: { Label("Прослушать", systemImage: "play.circle") }.buttonStyle(SecondaryButton())
                Button { client.stopSpeaking(); client.discardRecording() } label: { Label("Удалить старую запись", systemImage: "trash") }.buttonStyle(QuietButton()).disabled(client.busy)
            }
        }
    }
}
