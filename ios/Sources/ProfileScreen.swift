import SwiftUI

/// «Профиль»: who you are, what the coach knows, voice, reminders, limits, data and version.
struct ProfileScreen: View {
    @EnvironmentObject private var client: TrainingClient
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @State private var showEditor = false
    @State private var reminderEditor: ReminderEditorSelection? = nil
    @State private var reminderToDelete: PracticeReminder? = nil
    @State private var exportURL: URL? = nil
    @State private var showReset = false
    @State private var confirmSignOut = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    profileCard
                    factsSection
                    voiceCard
                    remindersCard
                    limitsCard
                    dataCard
                    aboutCard
                }
                .padding(.horizontal, 20).padding(.top, 4).padding(.bottom, 32)
                .frame(maxWidth: 680).frame(maxWidth: .infinity)
            }
            .modifier(LiquidCanvas())
            .navigationTitle("Профиль")
            .navigationBarTitleDisplayMode(.large)
            .refreshable { await client.refreshQuietly() }
            .task {
                await client.refreshReminderStatus()
#if DEBUG
                if PreviewFixtures.screen == "reminder-editor" {
                    reminderEditor = ReminderEditorSelection(reminder: client.reminders.first)
                }
#endif
            }
            .sheet(isPresented: $showEditor) {
                if let profile = client.state?.profile {
                    ProfileEditor(profile: profile).environmentObject(client)
                }
            }
            .sheet(item: $reminderEditor) { selection in
                ReminderTimeEditor(reminder: selection.reminder).environmentObject(client)
                    .presentationDetents(dynamicTypeSize.isAccessibilitySize ? [.large] : [.height(500), .large])
                    .presentationDragIndicator(.visible)
            }
            .sheet(isPresented: $showReset) {
                ResetSheet().environmentObject(client)
            }
            .confirmationDialog("Удалить напоминание?", isPresented: reminderDeletePresented, titleVisibility: .visible) {
                if let reminderToDelete {
                    Button("Удалить время \(reminderToDelete.timeLabel)", role: .destructive) {
                        let id = reminderToDelete.id
                        self.reminderToDelete = nil
                        Task { await client.deleteReminder(id: id) }
                    }
                }
                Button("Оставить", role: .cancel) { reminderToDelete = nil }
            } message: { Text("Другие времена останутся без изменений.") }
            .confirmationDialog("Выйти на этом iPhone?", isPresented: $confirmSignOut, titleVisibility: .visible) {
                Button("Выйти", role: .destructive) { client.signOut() }
                Button("Остаться", role: .cancel) {}
            } message: { Text("История останется на сервере. Для входа понадобится адрес и личный код.") }
        }
    }

    private var reminderDeletePresented: Binding<Bool> {
        Binding(get: { reminderToDelete != nil }, set: { if !$0 { reminderToDelete = nil } })
    }

    // MARK: Profile

    private var profileCard: some View {
        let profile = client.state?.profile
        return LiquidCard {
            VStack(alignment: .leading, spacing: 14) {
                HStack(alignment: .center, spacing: 14) {
                    VoiceOrb(mode: .ready, level: 0, mood: .happy, statusDescription: "Твой собеседник", interactive: false)
                        .frame(width: 64, height: 64)
                    VStack(alignment: .leading, spacing: 4) {
                        Text(profile?.name ?? "Профиль").font(TypeScale.title2)
                        Text("Практика \(RuFormat.minutes(profile?.dailyMinutes ?? 15)) в день")
                            .font(.subheadline).foregroundStyle(Theme.inkSecondary)
                    }
                    Spacer(minLength: 0)
                }
                if let goals = profile?.goals, !goals.isEmpty {
                    profileLine("Цели", goals)
                }
                if let work = profile?.professionalContext, !work.isEmpty {
                    profileLine("Работа", work)
                }
                if let relocation = profile?.relocation, !relocation.isEmpty {
                    profileLine("Переезд", relocation)
                }
                if let interests = profile?.interests, !interests.isEmpty {
                    profileLine("Интересы", interests.joined(separator: ", "))
                }
                Button { showEditor = true } label: {
                    Label("Изменить профиль", systemImage: "pencil")
                }
                .buttonStyle(QuietButton())
                .disabled(profile == nil)
            }
        }
    }

    private func profileLine(_ title: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            InputLabel(title: title)
            Text(value).font(.subheadline).lineLimit(3).fixedSize(horizontal: false, vertical: true)
        }
    }

    @ViewBuilder private var factsSection: some View {
        if let facts = client.state?.profileFacts {
            VStack(alignment: .leading, spacing: 10) {
                LiquidSectionHeader(title: "Что я знаю о тебе", systemImage: "person.text.rectangle")
                Text("Факты из твоих созвонов. Принятые помогают собеседнику и разбору.")
                    .font(.footnote).foregroundStyle(Theme.inkSecondary)
                FactsView(facts: facts, embedded: true)
            }
        }
    }

    // MARK: Voice and limits

    private var voiceCard: some View {
        LiquidCard {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    Label("Голос собеседника", systemImage: "speaker.wave.2").font(.headline)
                    Spacer()
                    StatusPill(title: client.status?.audio.configured == true ? "Включён" : "Не подключён",
                               color: client.status?.audio.configured == true ? Theme.lime : Theme.warning)
                }
                Text(client.status?.audio.configured == true
                     ? "Реплики звучат автоматически. Звук играет даже в беззвучном режиме — это учебное приложение."
                     : "Голос подключается на компьютере: Настройки → OpenAI API-ключ. После этого потяни экран вниз.")
                    .font(.footnote).foregroundStyle(Theme.inkSecondary).fixedSize(horizontal: false, vertical: true)
                if let usage = client.state?.audioUsage {
                    Divider().opacity(0.5)
                    HStack(alignment: .firstTextBaseline) {
                        Text(usage.estimated ? "Оценка расходов" : "Расходы на голос").font(.caption).foregroundStyle(Theme.inkSecondary)
                        Spacer()
                        Text(usage.usedUsd.formatted(.currency(code: "USD").locale(RuFormat.locale))).font(.subheadline.weight(.semibold)).monospacedDigit()
                        Text("из " + usage.budgetUsd.formatted(.currency(code: "USD").locale(RuFormat.locale))).font(.caption).foregroundStyle(Theme.inkSecondary)
                    }
                    Text("Записано \(usage.recordedMinutes.formatted(.number.precision(.fractionLength(1)).locale(RuFormat.locale))) мин. Итоговый счёт — у OpenAI.")
                        .font(.caption).foregroundStyle(Theme.inkSecondary)
                }
            }
        }
    }

    private var limitsCard: some View {
        LiquidCard {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    VStack(alignment: .leading, spacing: 4) {
                        InputLabel(title: "Тренер")
                        Text(client.status?.brain.model ?? "GPT-6.1 Sol").font(.headline)
                    }
                    Spacer()
                    StatusPill(title: client.status?.brain.verified == true ? "На связи" : client.status == nil ? "Проверяем" : "Нет связи",
                               color: client.status?.brain.verified == true ? Theme.lime : Theme.warning)
                }
                if let message = client.status?.brain.error, client.status?.brain.verified != true {
                    Text(message).font(.caption).foregroundStyle(Theme.inkSecondary)
                }
                Divider().opacity(0.5)
                QuotaSection()
            }
        }
    }

    // MARK: Reminders

    private var remindersCard: some View {
        LiquidCard {
            VStack(alignment: .leading, spacing: 16) {
                HStack {
                    Label("Время для практики", systemImage: "bell").font(.headline)
                    Spacer()
                    if client.reminderBusy { ProgressView().tint(Theme.violet) }
                }
                reminderPermissionNote
                if client.reminders.isEmpty {
                    Text("Выбери одно или несколько удобных времён. Напоминания приходят по местному времени этого iPhone.")
                        .font(.footnote).foregroundStyle(Theme.inkSecondary)
                }
                ForEach(client.reminders) { reminder in
                    reminderRow(reminder)
                    if reminder.id != client.reminders.last?.id { Divider().opacity(0.45) }
                }
                Button { reminderEditor = ReminderEditorSelection(reminder: nil) } label: {
                    Label("Добавить время", systemImage: "plus").frame(maxWidth: .infinity)
                }
                .buttonStyle(SecondaryButton())
                .disabled(client.reminderBusy || client.reminders.count >= 12)
                if client.reminders.count >= 12 {
                    Text("Можно сохранить до 12 времён. Удали одно, чтобы добавить новое.").font(.caption).foregroundStyle(Theme.inkSecondary)
                }
            }
        }
    }

    @ViewBuilder private var reminderPermissionNote: some View {
        if client.notificationState == "denied" {
            Text("Уведомления выключены в iPhone. Твои времена сохранены.")
                .font(.footnote).foregroundStyle(Theme.inkSecondary)
            Button { client.openSystemSettings() } label: { Label("Разрешить уведомления", systemImage: "arrow.up.right") }
                .buttonStyle(SecondaryButton())
        } else if client.notificationState == "unavailable" {
            Text("iPhone не передал состояние уведомлений. Попробуй открыть настройки приложения.")
                .font(.footnote).foregroundStyle(Theme.inkSecondary)
            Button { client.openSystemSettings() } label: { Label("Настройки iPhone", systemImage: "arrow.up.right") }
                .buttonStyle(QuietButton())
        } else if client.notificationState == "provisional" {
            Text("Разрешена тихая доставка. Чтобы видеть баннеры, включи их в настройках iPhone.")
                .font(.footnote).foregroundStyle(Theme.inkSecondary)
            Button { client.openSystemSettings() } label: { Label("Настройки iPhone", systemImage: "arrow.up.right") }
                .buttonStyle(QuietButton())
        }
    }

    private func reminderRow(_ reminder: PracticeReminder) -> some View {
        HStack(spacing: 12) {
            Button { reminderEditor = ReminderEditorSelection(reminder: reminder) } label: {
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 8) {
                        Text(reminder.timeLabel).font(TypeScale.stat)
                        Image(systemName: "pencil").font(.caption.weight(.medium)).foregroundStyle(Theme.inkSecondary)
                    }
                    Text(reminder.enabled ? "Каждый день" : "На паузе").font(.caption).foregroundStyle(Theme.inkSecondary)
                }
                .foregroundStyle(Theme.ink).frame(maxWidth: .infinity, minHeight: 48, alignment: .leading)
            }
            .buttonStyle(PressButton())
            .accessibilityLabel("Изменить напоминание в " + reminder.timeLabel)
            Toggle("Напоминание в " + reminder.timeLabel, isOn: Binding(get: { reminder.enabled }, set: { value in
                Task { await client.setReminderEnabled(id: reminder.id, enabled: value) }
            }))
            .labelsHidden().tint(Theme.violet).fixedSize()
            Button { reminderToDelete = reminder } label: { Image(systemName: "trash").font(.subheadline) }
                .buttonStyle(LiquidIconButton(size: 44))
                .accessibilityLabel("Удалить напоминание в " + reminder.timeLabel)
        }
        .disabled(client.reminderBusy)
    }

    // MARK: Data, account, about

    private var dataCard: some View {
        LiquidCard {
            VStack(alignment: .leading, spacing: 12) {
                Label("Данные", systemImage: "externaldrive").font(.headline)
                Text("Практика хранится на твоём сервере. Можно выгрузить копию или начать с чистого листа.")
                    .font(.footnote).foregroundStyle(Theme.inkSecondary).fixedSize(horizontal: false, vertical: true)
                if let exportURL {
                    ShareLink(item: exportURL) {
                        Label("Поделиться файлом", systemImage: "square.and.arrow.up")
                    }
                    .buttonStyle(SecondaryButton())
                } else {
                    Button { Task { exportURL = await client.exportData() } } label: {
                        Label(client.busy && client.operationStage == "Готовлю файл с данными" ? "Готовлю файл…" : "Выгрузить данные", systemImage: "arrow.down.doc")
                    }
                    .buttonStyle(SecondaryButton())
                    .disabled(client.busy)
                }
                Button { showReset = true } label: { Label("Удалить всю практику", systemImage: "trash") }
                    .buttonStyle(DestructiveQuietButton())
                    .disabled(client.busy || client.recording)
                Divider().opacity(0.5)
                VStack(alignment: .leading, spacing: 4) {
                    InputLabel(title: "Сервер")
                    Text(client.server.isEmpty ? "Не указан" : client.server).font(.footnote).foregroundStyle(Theme.inkSecondary)
                        .lineLimit(1).truncationMode(.middle)
                }
                Button { confirmSignOut = true } label: { Label("Выйти на этом iPhone", systemImage: "rectangle.portrait.and.arrow.right") }
                    .buttonStyle(QuietButton())
                    .disabled(client.busy || client.recording)
            }
        }
    }

    private var aboutCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 10) {
                BrandMark(size: 34)
                VStack(alignment: .leading, spacing: 2) {
                    Text(AppVersion.display).font(.subheadline.weight(.semibold))
                    if let server = client.status?.app?.version ?? client.state?.app?.version, !server.isEmpty {
                        Text("Сервер " + server).font(.caption).foregroundStyle(Theme.inkSecondary)
                    }
                }
            }
            Text(SigningInfo.note).font(.footnote).foregroundStyle(Theme.inkSecondary).fixedSize(horizontal: false, vertical: true)
        }
        .padding(.horizontal, 4)
    }
}

/// Subscription limits named by window length (L-29: `primary` / `secondary` never read alike).
private struct QuotaSection: View {
    @EnvironmentObject private var client: TrainingClient
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Лимиты подписки").font(.subheadline.weight(.semibold))
            if let usage = client.subscriptionUsage, usage.available && !usage.windows.isEmpty {
                ForEach(usage.windows) { window in windowRow(window) }
                if usage.stale {
                    Text("Данные с последней проверки. Сейчас обновить не удалось.").font(.caption).foregroundStyle(Theme.inkSecondary)
                }
            } else {
                Text("Точный остаток сейчас недоступен. Его можно проверить в ChatGPT.")
                    .font(.footnote).foregroundStyle(Theme.inkSecondary)
            }
            Text("Лимит общий с ChatGPT и Codex.").font(.caption).foregroundStyle(Theme.inkSecondary)
            if let activity = client.subscriptionUsage?.activity {
                HStack {
                    Text("Запросов приложения за \(activity.periodDays) дн.").font(.caption).foregroundStyle(Theme.inkSecondary)
                    Spacer()
                    Text(RuFormat.number(activity.requests)).font(.subheadline.weight(.semibold)).monospacedDigit()
                }
                if let retry = activity.retryAt, let date = NativeDate.parse(retry), date > Date() {
                    Text("Повторить после " + RuFormat.time(date)).font(.caption).foregroundStyle(Theme.inkSecondary)
                }
            }
            if let url = URL(string: client.subscriptionUsage?.manageUrl ?? "https://chatgpt.com/settings/usage") {
                Link(destination: url) {
                    HStack { Text("Открыть лимиты ChatGPT"); Spacer(); Image(systemName: "arrow.up.right") }
                        .font(.subheadline.weight(.semibold))
                }
            }
        }
    }

    private func windowRow(_ window: SubscriptionUsage.Window) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(window.title).font(.footnote.weight(.semibold))
                if let bucket = window.bucketName, !bucket.isEmpty {
                    Text("· " + bucket).font(.caption).foregroundStyle(Theme.inkSecondary)
                }
                Spacer()
                if let remaining = window.remainingPercent {
                    Text("осталось \(Int(min(100, max(0, remaining)).rounded()))%").font(.footnote.weight(.semibold)).monospacedDigit()
                }
            }
            if let remaining = window.remainingPercent {
                LiquidProgressBar(value: remaining / 100, color: Theme.violet, height: 6)
            }
            if let reset = window.resetsAt, let date = NativeDate.parse(reset) {
                Text("Обновится " + RuFormat.dayTime(date)).font(.caption).foregroundStyle(Theme.inkSecondary)
            }
        }
    }
}

enum AppVersion {
    static var display: String {
        let short = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0.5.0"
        let build = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? ""
        return "Smooth Talk " + short + (build.isEmpty ? "" : " (\(build))")
    }
}

/// AltStore installs expire after seven days; the date comes from the embedded profile.
enum SigningInfo {
    static var expirationDate: Date? {
        guard let url = Bundle.main.url(forResource: "embedded", withExtension: "mobileprovision"),
              let data = try? Data(contentsOf: url),
              let text = String(data: data, encoding: .isoLatin1),
              let start = text.range(of: "<?xml"),
              let end = text.range(of: "</plist>"),
              start.lowerBound < end.upperBound,
              let plistData = String(text[start.lowerBound..<end.upperBound]).data(using: .isoLatin1),
              let plist = (try? PropertyListSerialization.propertyList(from: plistData, options: [], format: nil)) as? [String: Any] else {
            return nil
        }
        return plist["ExpirationDate"] as? Date
    }

    static var note: String {
        guard let date = expirationDate else {
            return "Установка через AltStore: обновляй подпись до истечения 7 дней. Занятия и история останутся на сервере."
        }
        let days = Calendar.current.dateComponents([.day], from: Date(), to: date).day ?? 0
        if days < 0 { return "Подпись приложения истекла. Обнови её в AltStore — история на сервере." }
        return "Подпись истекает через \(RuFormat.count(days, "день", "дня", "дней")) (\(RuFormat.day(date))). Обнови её в AltStore заранее."
    }
}

struct ReminderEditorSelection: Identifiable {
    let id = UUID()
    let reminder: PracticeReminder?
}

struct ReminderTimeEditor: View {
    @EnvironmentObject private var client: TrainingClient
    @Environment(\.dismiss) private var dismiss
    let reminder: PracticeReminder?
    @State private var date: Date
    @State private var saveError: String? = nil
    init(reminder: PracticeReminder?) {
        self.reminder = reminder
        _date = State(initialValue: Calendar.current.date(from: DateComponents(hour: reminder?.hour ?? 19, minute: reminder?.minute ?? 0)) ?? Date())
    }
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    DatePicker("Каждый день в", selection: $date, displayedComponents: .hourAndMinute)
                        .datePickerStyle(.wheel).labelsHidden().frame(maxWidth: .infinity).frame(height: 180)
                        .environment(\.locale, RuFormat.locale)
                        .accessibilityLabel("Время ежедневного напоминания")
                    Text("По местному времени iPhone. После переезда напоминание останется в это же время.")
                        .font(.footnote).foregroundStyle(Theme.inkSecondary)
                    if let saveError {
                        Text(saveError).font(.footnote).foregroundStyle(Theme.danger).accessibilityLabel("Не сохранено. " + saveError)
                    }
                    Button { save() } label: {
                        HStack {
                            Text(client.reminderBusy ? "Сохраняю" : "Сохранить время")
                            Spacer()
                            if client.reminderBusy { ProgressView().tint(Theme.ctaLabel) } else { Image(systemName: "checkmark") }
                        }
                    }
                    .buttonStyle(PrimaryButton())
                    .disabled(client.reminderBusy)
                }.padding(24)
            }
            .modifier(LiquidCanvas(intensity: 0.6))
            .navigationTitle(reminder == nil ? "Новое напоминание" : "Изменить время")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Отмена") { dismiss() }.disabled(client.reminderBusy) } }
            .interactiveDismissDisabled(client.reminderBusy)
        }
    }
    private func save() {
        saveError = nil
        let parts = Calendar.current.dateComponents([.hour, .minute], from: date)
        Task {
            let accepted = await client.saveReminder(id: reminder?.id, hour: parts.hour ?? 19, minute: parts.minute ?? 0)
            if accepted { dismiss() } else {
                saveError = client.error ?? "Не удалось сохранить время."
                client.error = nil
            }
        }
    }
}

/// Name, goals, work context, relocation, interests, daily minutes and coach tone (POST profile).
private struct ProfileEditor: View {
    let profile: Learner
    @EnvironmentObject private var client: TrainingClient
    @Environment(\.dismiss) private var dismiss
    @State private var name: String
    @State private var goals: String
    @State private var interests: String
    @State private var work: String
    @State private var relocation: String
    @State private var minutes: Int
    @State private var feedback: String

    init(profile: Learner) {
        self.profile = profile
        _name = State(initialValue: profile.name)
        _goals = State(initialValue: profile.goals)
        _interests = State(initialValue: profile.interests.joined(separator: ", "))
        _work = State(initialValue: profile.professionalContext)
        _relocation = State(initialValue: profile.relocation)
        _minutes = State(initialValue: profile.dailyMinutes)
        _feedback = State(initialValue: profile.feedback)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Как к тебе обращаться") {
                    TextField("Имя", text: $name).textInputAutocapitalization(.words)
                }
                Section("Цели") {
                    TextField("Чего хочешь добиться", text: $goals, axis: .vertical).lineLimit(2...6)
                }
                Section("Работа и переезд") {
                    TextField("Чем занимаешься", text: $work, axis: .vertical).lineLimit(2...6)
                    TextField("Куда и когда переезд", text: $relocation, axis: .vertical).lineLimit(1...4)
                }
                Section("Интересы, через запятую") {
                    TextField("Например: AI, игры, спорт", text: $interests, axis: .vertical).lineLimit(1...3)
                }
                Section("Практика в день") {
                    Stepper(value: $minutes, in: 5...60, step: 5) {
                        Text(RuFormat.minutes(minutes)).monospacedDigit()
                    }
                }
                Section("Тон тренера") {
                    TextField("Например: прямо и по делу", text: $feedback, axis: .vertical).lineLimit(1...4)
                }
            }
            .scrollContentBackground(.hidden)
            .modifier(LiquidCanvas(intensity: 0.6))
            .navigationTitle("Профиль")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Отмена") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Сохранить") { save() }
                        .disabled(client.busy || name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
        }
    }

    private func save() {
        let list = interests.split(separator: ",").map { String($0) }
        Task {
            let saved = await client.saveProfile(name: name, goals: goals, interests: list, professionalContext: work,
                                                 relocation: relocation, dailyMinutes: minutes, feedback: feedback)
            if saved { dismiss() }
        }
    }
}

/// Typed confirmation: the server accepts only the literal word DELETE.
private struct ResetSheet: View {
    @EnvironmentObject private var client: TrainingClient
    @Environment(\.dismiss) private var dismiss
    @State private var typed = ""
    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 18) {
                Text("Удалятся все занятия, разборы, записи, созвоны и прогресс на сервере. Это не отменить.")
                    .font(.subheadline).fixedSize(horizontal: false, vertical: true)
                Text("Чтобы подтвердить, введи DELETE.").font(.footnote).foregroundStyle(Theme.inkSecondary)
                TextField("DELETE", text: $typed)
                    .textInputAutocapitalization(.characters).autocorrectionDisabled()
                    .padding(14)
                    .background(Theme.well, in: RoundedRectangle(cornerRadius: Radius.input, style: .continuous))
                Button {
                    Task {
                        let done = await client.resetAllTraining(confirmation: typed.trimmingCharacters(in: .whitespacesAndNewlines))
                        if done { dismiss() }
                    }
                } label: {
                    HStack { Text("Удалить всё"); Spacer(); Image(systemName: "trash") }
                }
                .buttonStyle(PrimaryButton())
                .disabled(typed.trimmingCharacters(in: .whitespacesAndNewlines) != "DELETE" || client.busy)
                Spacer()
            }
            .padding(24)
            .modifier(LiquidCanvas(intensity: 0.5))
            .navigationTitle("Удалить практику")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Отмена") { dismiss() } } }
        }
        .presentationDetents([.medium, .large])
    }
}
