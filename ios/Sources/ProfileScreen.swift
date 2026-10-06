import SwiftUI

/// «Профиль», compact (PASS-0.5.3 §3): who you are and a few settings; everything else is one tap away. A native
/// inset-grouped list: the screen's companion (wink), one summary row («О тебе»), then one surface of rows, each with its
/// current value on the right and its own pushed screen («Мой плейбук», «Голос», «Напоминания», «Тренер и лимиты»,
/// «Данные»; «Оформление» is an inline menu), and the version footer. Rows sit on the solid card colour; no glass on
/// content, no cards inside cards. A limit notice on Today opens the matching screen through `ProfileNavigator`.
struct ProfileScreen: View {
    @EnvironmentObject private var client: TrainingClient
    @ObservedObject private var navigator: ProfileNavigator
    @State private var path: [ProfileSection] = []
    @AppStorage(AppAppearance.storageKey) private var appearance = AppAppearance.system.rawValue

    init() {
        _navigator = ObservedObject(wrappedValue: ProfileNavigator.shared)
    }

    var body: some View {
        NavigationStack(path: $path) {
            // Staircase: each section is one step; its card fades in while the rows rise (EntranceFill).
            List {
                introSection.entrance(0)
                summarySection.entrance(1)
                settingsSection.entrance(2)
                footerSection.entrance(3)
            }
            .listStyle(.insetGrouped)
            .scrollContentBackground(.hidden)
            .textCase(nil)
            .entranceStage()
            .modifier(LiquidCanvas())
            .navigationTitle("Профиль")
            .navigationBarTitleDisplayMode(.large)
            .refreshable { await client.refreshQuietly() }
            .navigationDestination(for: ProfileSection.self) { section in
                destination(section)
            }
            .task {
                applyPendingSection()
#if DEBUG
                openPreviewSection()
#endif
                await client.refreshReminderStatus()
            }
        }
        .onChange(of: navigator.pending) { _, section in
            if section != nil { applyPendingSection() }
        }
    }

    /// A deep link replaces whatever was pushed: the learner lands on the screen the notice talks about.
    private func applyPendingSection() {
        guard let section = navigator.consume() else { return }
        path = [section]
    }

#if DEBUG
    private func openPreviewSection() {
        guard path.isEmpty, let screen = PreviewFixtures.screen else { return }
        if screen == "profile-voice" {
            path = [.voice]
        } else if screen == "reminder-editor" || screen == "reminder-denied" {
            path = [.reminders]
        }
    }
#endif

    @ViewBuilder private func destination(_ section: ProfileSection) -> some View {
        switch section {
        case .details: ProfileDetailsView()
        case .playbook: FactsView(facts: client.state?.profileFacts ?? [])
        case .voice: ProfileVoiceView()
        case .reminders: ProfileRemindersView()
        case .limits: ProfileCoachView()
        case .data: ProfileDataView()
        }
    }

    // MARK: Header

    /// The screen's one companion (wink) next to the same lede the web shows (MOTION-PASS-0.5.2 §3).
    private var introSection: some View {
        Section {
            ScreenIntro(text: "Цели, голос, напоминания и твои данные.", mood: .wink)
                .listRowInsets(EdgeInsets(top: 0, leading: 0, bottom: 4, trailing: 0))
                .listRowBackground(Color.clear)
                .listRowSeparator(.hidden)
        }
    }

    /// One summary row: the name, the daily practice and the coach's tone; «Подробнее» is the pushed «О тебе».
    @ViewBuilder private var summarySection: some View {
        let profile = client.state?.profile
        Section {
            NavigationLink(value: ProfileSection.details) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(ProfileCopy.displayName(profile?.name)).font(TypeScale.title2)
                    Text(ProfileCopy.practiceLine(profile))
                        .font(.subheadline).foregroundStyle(Theme.inkSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(.vertical, 4)
                .accessibilityElement(children: .combine)
            }
            .accessibilityHint("Подробнее: цели, работа, переезд и интересы")
        }
        .listRowBackground(EntranceFill(index: 1))
    }

    // MARK: Rows

    /// The same values as the PC rows: each row speaks for its own side of the one limit rule (subscription notices for
    /// the coach, voice ones for «Голос»).
    private var settingsSection: some View {
        let voiceNotice = LimitNotice.current(usage: nil, audioUsage: client.state?.audioUsage)
        let coach = ProfileCopy.coachState(notice: LimitNotice.current(usage: client.subscriptionUsage, audioUsage: nil),
                                           status: client.status, statusUnavailable: client.statusUnavailable)
        return Section {
            valueRow(.playbook, value: ProfileCopy.playbookValue(client.state?.profileFacts ?? []))
            appearanceRow
            valueRow(.voice, value: ProfileCopy.voiceValue(status: client.status, statusUnavailable: client.statusUnavailable,
                                                           usage: client.state?.audioUsage),
                     tone: voiceNotice.map { $0.tone == .danger ? ProfileCopy.CoachTone.danger : ProfileCopy.CoachTone.warning })
            valueRow(.reminders, value: ProfileCopy.remindersValue(client.reminders, notificationState: client.notificationState))
            coachRow(coach)
            valueRow(.data, value: ProfileCopy.retentionValue(client.state?.profile.audioRetentionDays ?? 30))
        }
        .listRowBackground(EntranceFill(index: 2))
    }

    /// One line: the title on the left, the current value on the right (a status dot when a limit speaks).
    private func valueRow(_ section: ProfileSection, value: String, tone: ProfileCopy.CoachTone? = nil) -> some View {
        NavigationLink(value: section) {
            LabeledContent {
                HStack(spacing: 6) {
                    if let tone {
                        Circle().fill(tone.color).frame(width: 8, height: 8).accessibilityHidden(true)
                    }
                    Text(value).foregroundStyle(Theme.inkSecondary).multilineTextAlignment(.trailing)
                }
            } label: {
                ProfileRowTitle(title: section.title, icon: section.icon)
            }
        }
    }

    /// «Тренер и лимиты»: the status as a pill, like the PC chip.
    private func coachRow(_ coach: (label: String, tone: ProfileCopy.CoachTone)) -> some View {
        NavigationLink(value: ProfileSection.limits) {
            LabeledContent {
                StatusPill(title: coach.label, color: coach.tone.color)
            } label: {
                ProfileRowTitle(title: ProfileSection.limits.title, icon: ProfileSection.limits.icon)
            }
        }
    }

    /// «Оформление»: a menu right in the row; only on this device.
    private var appearanceRow: some View {
        Picker(selection: $appearance) {
            ForEach(AppAppearance.allCases) { option in
                Text(option.title).tag(option.rawValue)
            }
        } label: {
            ProfileRowTitle(title: "Оформление", icon: "circle.lefthalf.filled")
        }
        .pickerStyle(.menu)
        .tint(Theme.inkSecondary)
        .accessibilityHint("Только на этом устройстве")
    }

    // MARK: Footer

    private var footerSection: some View {
        Section {
            VStack(spacing: 6) {
                Text(versionLine).font(.footnote.weight(.semibold)).foregroundStyle(Theme.inkSecondary)
                Text(SigningInfo.note).font(.caption).foregroundStyle(Theme.inkSecondary)
                    .multilineTextAlignment(.center).fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity)
            .listRowInsets(EdgeInsets(top: 4, leading: 16, bottom: 12, trailing: 16))
            .listRowBackground(Color.clear)
            .listRowSeparator(.hidden)
            .accessibilityElement(children: .combine)
        }
    }

    private var versionLine: String {
        var line = AppVersion.display
        if let server = client.status?.app?.version ?? client.state?.app?.version, !server.isEmpty {
            line += " · сервер " + server
        }
        return line
    }
}

enum AppVersion {
    static var display: String {
        let short = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0.5.3"
        let build = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? ""
        return "Smooth Talk " + short + (build.isEmpty ? "" : " (\(build))")
    }
}

/// AltStore installs expire after seven days; the date comes from the embedded profile (read once per launch).
enum SigningInfo {
    static let expirationDate: Date? = {
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
    }()

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
struct ProfileEditor: View {
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

/// Typed confirmation: the server accepts only the literal word DELETE. The warning says exactly what goes and what
/// stays (PASS-0.5.3 §1.1, the same text on the PC), with the existing export one tap away.
struct ResetSheet: View {
    @EnvironmentObject private var client: TrainingClient
    @Environment(\.dismiss) private var dismiss
    @State private var typed = ""
    @State private var exportURL: URL? = nil
    @State private var exporting = false
    @State private var exportError: String? = nil
    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 18) {
                Text("Удалятся занятия, записи, созвоны с разборами, паттерны, тренировки и результат теста уровня. Профиль, принятые факты и «Мои фразы» останутся. Отменить нельзя.")
                    .font(.subheadline).fixedSize(horizontal: false, vertical: true)
                exportLink
                Text("Чтобы подтвердить, введи DELETE.").font(.footnote).foregroundStyle(Theme.inkSecondary)
                TextField("DELETE", text: $typed)
                    .textInputAutocapitalization(.characters).autocorrectionDisabled()
                    .padding(14)
                    .background(Theme.well, in: RoundedRectangle(cornerRadius: Radius.input, style: .continuous))
                Button(role: .destructive) {
                    Task {
                        let done = await client.resetAllTraining(confirmation: typed.trimmingCharacters(in: .whitespacesAndNewlines))
                        if done { dismiss() }
                    }
                } label: {
                    HStack { Text("Удалить навсегда"); Spacer(); Image(systemName: "trash") }
                }
                .buttonStyle(PrimaryButton())
                .disabled(typed.trimmingCharacters(in: .whitespacesAndNewlines) != "DELETE" || client.busy)
                Spacer()
            }
            .padding(24)
            .modifier(LiquidCanvas(intensity: 0.5))
            .navigationTitle("Удалить всю практику")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Отмена") { dismiss() } } }
        }
        .presentationDetents([.medium, .large])
    }

    /// «Сначала скачать копию»: the same export as «Выгрузить данные», then the system share sheet.
    @ViewBuilder private var exportLink: some View {
        VStack(alignment: .leading, spacing: 6) {
            if let exportURL {
                ShareLink(item: exportURL) {
                    Label("Поделиться копией", systemImage: "square.and.arrow.up")
                }
            } else {
                Button {
                    Task { await prepareExport() }
                } label: {
                    Label(exporting ? "Готовлю файл…" : "Сначала скачать копию", systemImage: "arrow.down.doc")
                }
                .disabled(exporting || client.busy)
            }
            if let exportError {
                Text(exportError).font(.footnote).foregroundStyle(Theme.danger).fixedSize(horizontal: false, vertical: true)
            }
        }
        .font(.subheadline.weight(.semibold))
        .buttonStyle(PressButton())
        .foregroundStyle(Theme.violet)
    }

    private func prepareExport() async {
        exporting = true
        exportError = nil
        let url = await client.exportData()
        exporting = false
        if let url {
            exportURL = url
        } else {
            // Shown here, inside the sheet: the shell's alert cannot appear over it.
            exportError = client.error ?? "Не удалось подготовить файл. Попробуй ещё раз."
            client.error = nil
        }
    }
}
