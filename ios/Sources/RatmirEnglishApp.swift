import SwiftUI

private enum Theme {
    static let charcoal = Color(red: 0.13, green: 0.13, blue: 0.13)
    static let surface = Color(red: 0.89, green: 0.89, blue: 0.89)
    static let lavender = Color(red: 0.72, green: 0.67, blue: 0.94)
    static let lime = Color(red: 0.83, green: 0.95, blue: 0.34)
}

@main struct RatmirEnglishApp: App {
    @StateObject private var client = TrainingClient()
    var body: some Scene {
        WindowGroup {
            RootView().environmentObject(client).tint(Theme.charcoal)
                .task { await client.restore() }
        }
    }
}

struct RootView: View {
    @EnvironmentObject private var client: TrainingClient
    var body: some View {
        Group {
            if client.signedIn {
                TabView {
                    HomeView().tabItem { Label("Сегодня", systemImage: "sun.max") }
                    ProgressViewScreen().tabItem { Label("Прогресс", systemImage: "chart.xyaxis.line") }
                    HistoryView().tabItem { Label("История", systemImage: "clock.arrow.circlepath") }
                    SettingsView().tabItem { Label("Настройки", systemImage: "slider.horizontal.3") }
                }
            } else { LoginView() }
        }
        .sheet(item: $client.conversation) { conversation in
            ConversationView(id: conversation.id).environmentObject(client)
                .interactiveDismissDisabled(client.busy || client.recording)
        }
        .alert("Не получилось", isPresented: Binding(get: { client.error != nil },
            set: { if !$0 { client.error = nil } })) {
            Button("Понятно", role: .cancel) { client.error = nil }
        } message: { Text(client.error ?? "") }
    }
}

struct LoginView: View {
    @EnvironmentObject private var client: TrainingClient
    @State private var code = ""
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    Text("R·").font(.system(size: 48, weight: .bold)).padding(20)
                        .background(Theme.lime, in: RoundedRectangle(cornerRadius: 26))
                    Text("Твой английский.\nТвоя практика.").font(.largeTitle.bold())
                    Text("Подключи личный сервер. Уровень, история и занятия будут общими с компьютером.")
                        .foregroundStyle(.secondary)
                    TextField("https://адрес-сервера", text: $client.server)
                        .keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                    SecureField("Личный код доступа", text: $code)
                        .textInputAutocapitalization(.never).autocorrectionDisabled()
                    Button { Task { await client.login(code: code); if client.signedIn { code = "" } } } label: {
                        HStack { Text("Подключиться"); Spacer(); if client.busy { ProgressView() } else { Image(systemName: "arrow.right") } }
                    }.buttonStyle(PrimaryButton()).disabled(client.busy || code.isEmpty)
                }.textFieldStyle(.roundedBorder).padding(24)
            }.background(Theme.surface).navigationTitle("Ratmir English")
        }
    }
}

struct HomeView: View {
    @EnvironmentObject private var client: TrainingClient
    @State private var context = "life"
    @State private var mode = "learning"
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    Text("Привет, \(client.state?.profile.name ?? "ты").").font(.largeTitle.bold())
                    Text("Один разговор сегодня — уже движение вперёд.").foregroundStyle(.secondary)
                    HStack(spacing: 12) {
                        Metric(value: "\(client.state?.completed ?? 0)", title: "Занятий", color: Theme.lavender)
                        Metric(value: "\(client.state?.xp ?? 0)", title: "Опыт XP", color: Theme.lime)
                    }
                    VStack(alignment: .leading, spacing: 18) {
                        Label("\(client.state?.profile.dailyMinutes ?? 15) минут для себя", systemImage: "waveform")
                            .font(.title2.bold())
                        Picker("Ситуация", selection: $context) {
                            Text("Жизнь").tag("life"); Text("Работа").tag("work"); Text("Переезд").tag("relocation")
                        }.pickerStyle(.segmented)
                        Picker("Режим", selection: $mode) {
                            Text("С опорами").tag("learning"); Text("Созвон").tag("call")
                        }.pickerStyle(.segmented)
                        Text(mode == "call" ? "Реплики собеседника скрыты. Слушай, отвечай, проявляй интерес." : "Подсказки доступны. После разговора — разбор и улучшенная попытка.")
                            .font(.subheadline).foregroundStyle(.secondary)
                        Button { Task { await client.start(mode: mode, context: context) } } label: {
                            HStack { Text(client.busy ? "Готовим разговор…" : "Начать разговор"); Spacer(); Image(systemName: "arrow.up.right") }
                        }.buttonStyle(PrimaryButton()).disabled(client.busy)
                    }.padding(22).background(.white, in: RoundedRectangle(cornerRadius: 28))
                    if let saved = client.state?.sessions.first(where: { $0.status != "completed" }) {
                        Button { client.conversation = saved; client.assistantTextShown = saved.mode == "learning" } label: {
                            VStack(alignment: .leading, spacing: 8) {
                                Text("Продолжить").font(.caption.bold())
                                Text(saved.lesson.title).font(.headline)
                                Text(saved.status == "review" ? "Твой разбор готов" : "Вернуться к занятию").font(.subheadline)
                            }.frame(maxWidth: .infinity, alignment: .leading).padding(22)
                                .background(Theme.lavender.opacity(0.35), in: RoundedRectangle(cornerRadius: 28))
                        }.buttonStyle(.plain)
                    }
                }.padding(20)
            }.background(Theme.surface).navigationTitle("Сегодня").navigationBarTitleDisplayMode(.inline)
                .refreshable { await client.perform { try await client.refresh() } }
        }
    }
}

struct ConversationView: View {
    let id: String
    @EnvironmentObject private var client: TrainingClient
    @Environment(\.dismiss) private var dismiss
    private var conversation: Conversation? { client.conversation }
    var body: some View {
        NavigationStack {
            ScrollViewReader { proxy in
                ScrollView {
                    VStack(alignment: .leading, spacing: 20) {
                        if let conversation {
                            Text(conversation.lesson.goal).font(.headline)
                            Text(conversation.lesson.why).font(.subheadline).foregroundStyle(.secondary)
                            VoiceCircle(active: client.recording || client.playing, recording: client.recording)
                                .frame(maxWidth: .infinity).padding(.vertical, 12)
                            ForEach(conversation.turns) { turn in
                                if turn.role == "user" || conversation.mode == "learning" || client.assistantTextShown || conversation.analysis != nil {
                                    VStack(alignment: .leading, spacing: 8) {
                                        Text(turn.role == "user" ? "ТЫ" : "СОБЕСЕДНИК").font(.caption2.bold()).foregroundStyle(.secondary)
                                        Text(turn.text).textSelection(.enabled)
                                    }.frame(maxWidth: .infinity, alignment: .leading).padding(18)
                                        .background(turn.role == "user" ? Theme.lavender.opacity(0.35) : .white,
                                            in: RoundedRectangle(cornerRadius: 22))
                                }
                            }
                            if conversation.status == "active" || conversation.status == "error" {
                                HStack {
                                    Button("Слушать", systemImage: "speaker.wave.2") { Task { await client.speak() } }
                                    if conversation.mode == "call" && !client.assistantTextShown {
                                        Button("Показать текст") { Task { await client.revealText() } }
                                    } else if conversation.mode == "learning" {
                                        Button("Подсказка") { Task { await client.getHint() } }
                                    }
                                }.font(.subheadline).disabled(client.busy || client.recording)
                                if let hint = client.hint { Text(hint).padding(16).background(Theme.lime.opacity(0.3), in: RoundedRectangle(cornerRadius: 20)) }
                                composer(retry: false)
                                Button("Закончить и разобрать") { Task { await client.action("finish") } }
                                    .disabled(client.busy || client.recording)
                            }
                            if conversation.status == "analysing" {
                                HStack { ProgressView(); Text("Sol разбирает разговор…") }
                                Button("Проверить разбор") { Task { await client.perform { try await client.refresh() } } }
                            }
                            if let analysis = conversation.analysis {
                                Text("Разбор").font(.title.bold())
                                Text(analysis.summary)
                                ForEach(analysis.strengths, id: \.self) { Text("✓ " + $0) }
                                ForEach(analysis.priorities) { priority in
                                    VStack(alignment: .leading, spacing: 12) {
                                        Text(priority.title).font(.headline)
                                        Text("“" + priority.quote + "”").foregroundStyle(.secondary)
                                        Text(priority.explanation)
                                        Text(priority.example).font(.headline)
                                        Text(priority.retryInstruction)
                                    }.padding(20).background(.white, in: RoundedRectangle(cornerRadius: 24))
                                }
                                ForEach(analysis.limitations, id: \.self) { Text($0).font(.footnote).foregroundStyle(.secondary) }
                                ForEach(Array(conversation.retries.enumerated()), id: \.offset) { _, attempt in
                                    Text(attempt.feedback).padding(18).background(Theme.lavender.opacity(0.3), in: RoundedRectangle(cornerRadius: 20))
                                }
                                if conversation.status != "completed" {
                                    composer(retry: true)
                                    Button("Завершить занятие") { Task { await client.action("complete") } }
                                        .buttonStyle(PrimaryButton()).disabled(client.busy || client.recording ||
                                            (!analysis.priorities.isEmpty && conversation.retries.last?.improved != true))
                                }
                            }
                        }
                        Color.clear.frame(height: 1).id("end")
                    }.padding(20)
                }.background(Theme.surface)
                    .onChange(of: conversation?.turns.count) { _, _ in proxy.scrollTo("end", anchor: .bottom) }
            }
            .navigationTitle(conversation?.lesson.title ?? "Разговор").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Свернуть") { dismiss(); client.conversation = nil }
                        .disabled(client.busy || client.recording)
                }
            }
            .task(id: conversation?.status) { await client.pollReview() }
        }
    }
    private func composer(retry: Bool) -> some View {
        VStack(spacing: 12) {
            TextField(retry ? "Улучшенная попытка…" : "Твой ответ на английском…", text: $client.draft, axis: .vertical)
                .lineLimit(3...8).padding(16).background(.white, in: RoundedRectangle(cornerRadius: 18))
                .disabled(client.busy || client.pendingMessageID != nil)
            HStack(spacing: 12) {
                Button {
                    Task { if client.recording { await client.stopRecording() } else { await client.beginRecording() } }
                } label: {
                    Label(client.recording ? "Стоп" : "Записать", systemImage: client.recording ? "stop.fill" : "mic.fill")
                }.buttonStyle(PrimaryButton()).disabled(client.busy || client.pendingMessageID != nil)
                Button { Task { await client.send(retry: retry) } } label: {
                    Text(client.busy ? "Ждём…" : client.pendingMessageID != nil ? "Повторить" : "Отправить")
                }.buttonStyle(PrimaryButton()).disabled(client.busy || client.recording || client.draft.isEmpty)
            }
            Text("Запись сначала появится текстом: проверь распознавание перед отправкой.").font(.caption).foregroundStyle(.secondary)
        }
    }
}

struct ProgressViewScreen: View {
    @EnvironmentObject private var client: TrainingClient
    private let labels = ["listening": "На слух", "vocabulary": "Активный английский", "grammar": "Построение фраз",
        "clarity": "Понятность", "coherence": "Логика", "reciprocity": "Использование услышанного", "initiative": "Инициатива", "repair": "Уточнения"]
    private let states = ["unknown": "Ещё проверяем", "supported": "С опорами", "provisional": "Первые успехи", "independent": "Самостоятельно", "recheck": "Пора перепроверить"]
    var body: some View {
        NavigationStack {
            List(client.state?.skills ?? []) { skill in
                VStack(alignment: .leading, spacing: 8) {
                    Text(labels[skill.id] ?? skill.id).font(.headline)
                    Text(states[skill.state] ?? skill.state).foregroundStyle(.secondary)
                    Text("Самостоятельных успехов: \(skill.independentSuccesses)").font(.caption)
                    HStack {
                        Label("Новая ситуация", systemImage: skill.transfer ? "checkmark.circle.fill" : "circle")
                        Label("После паузы", systemImage: skill.retention ? "checkmark.circle.fill" : "circle")
                    }.font(.caption)
                }.padding(.vertical, 8).listRowBackground(Color.white)
            }.scrollContentBackground(.hidden).background(Theme.surface).navigationTitle("Прогресс")
        }
    }
}

struct HistoryView: View {
    @EnvironmentObject private var client: TrainingClient
    var body: some View {
        NavigationStack {
            List(client.state?.sessions ?? []) { conversation in
                Button { client.conversation = conversation; client.assistantTextShown = conversation.mode == "learning" } label: {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(conversation.lesson.title).font(.headline)
                        Text(conversation.status == "completed" ? "Завершено" : conversation.status == "review" ? "Разбор готов" : "Можно продолжить")
                            .font(.caption).foregroundStyle(.secondary)
                    }.padding(.vertical, 8)
                }.listRowBackground(Color.white)
            }.scrollContentBackground(.hidden).background(Theme.surface).navigationTitle("История")
        }
    }
}

struct SettingsView: View {
    @EnvironmentObject private var client: TrainingClient
    var body: some View {
        NavigationStack {
            Form {
                Section("Мозг тренинга") {
                    Text(client.status?.brain.model ?? "Проверяем…")
                    Label(client.status?.brain.verified == true ? "Проверен на сервере" : "Нужно проверить доступ",
                        systemImage: client.status?.brain.verified == true ? "checkmark.seal" : "exclamationmark.circle")
                    Text("Общие лимиты ChatGPT. Серверный SIWC сейчас не предоставляет точные проценты остатка.").font(.footnote)
                    Link("Проверить лимиты ChatGPT", destination: URL(string: "https://chatgpt.com/settings/usage")!)
                }
                Section("Голос") { Text(client.status?.audio.configured == true ? "API-ключ настроен" : "Добавь API-ключ в настройках на компьютере") }
                Section("Напоминания") {
                    Button("Напоминать каждый день в 19:00") { Task { await client.remindAt19() } }.disabled(client.busy)
                    Text("Локальное уведомление на этом iPhone. Время следует часовому поясу устройства.").font(.footnote)
                }
                Section("Установка") {
                    Text("Бесплатная подпись действует 7 дней. Обновляй её через AltStore при связи с ПК.").font(.footnote)
                }
            }.navigationTitle("Настройки")
        }
    }
}

struct Metric: View {
    let value: String; let title: String; let color: Color
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(value).font(.system(size: 36, weight: .semibold, design: .rounded)).monospacedDigit()
            Text(title).font(.subheadline)
        }.frame(maxWidth: .infinity, alignment: .leading).padding(22)
            .background(color, in: RoundedRectangle(cornerRadius: 26))
    }
}

struct PrimaryButton: ButtonStyle {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.font(.headline).padding(.horizontal, 18).padding(.vertical, 17)
            .frame(maxWidth: .infinity).background(Theme.charcoal, in: RoundedRectangle(cornerRadius: 20))
            .foregroundStyle(Theme.lime).scaleEffect(configuration.isPressed && !reduceMotion ? 0.97 : 1)
            .animation(reduceMotion ? nil : .easeOut(duration: 0.16), value: configuration.isPressed)
    }
}

struct VoiceCircle: View {
    let active: Bool; let recording: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 30, paused: !active || reduceMotion)) { timeline in
            let phase = active && !reduceMotion ? sin(timeline.date.timeIntervalSinceReferenceDate * 3) : 0
            ZStack {
                Circle().stroke(Theme.lavender.opacity(0.3), lineWidth: 14).scaleEffect(1.05 + phase * 0.025)
                Circle().fill(LinearGradient(colors: [Theme.lavender, Theme.charcoal], startPoint: .topLeading, endPoint: .bottomTrailing))
                    .scaleEffect(1 + phase * 0.035)
                Image(systemName: recording ? "mic.fill" : active ? "waveform" : "waveform.circle")
                    .font(.system(size: 42)).foregroundStyle(Theme.lime)
            }.frame(width: 126, height: 126)
        }.accessibilityLabel(recording ? "Записывается твой ответ" : active ? "Звучит собеседник" : "Готов к разговору")
    }
}
