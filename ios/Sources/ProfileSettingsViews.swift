import SwiftUI
import UIKit

// MARK: - Navigation

/// The Profile sub-screens (PASS-0.5.3 §3): each row of the compact Profile pushes one of them; a limit notice on Today
/// opens «Тренер и лимиты» or «Голос» directly.
enum ProfileSection: String, Hashable, CaseIterable, Identifiable {
    case details, playbook, voice, reminders, limits, data

    var id: String { rawValue }

    var title: String {
        switch self {
        case .details: return "О тебе"
        case .playbook: return "Мой плейбук"
        case .voice: return "Голос"
        case .reminders: return "Напоминания"
        case .limits: return "Тренер и лимиты"
        case .data: return "Данные"
        }
    }

    /// Stroke symbols in the text colour (DESIGN-PASS 0.5.1: no coloured icon tiles).
    var icon: String {
        switch self {
        case .details: return "person.crop.circle"
        case .playbook: return "person.text.rectangle"
        case .voice: return "waveform"
        case .reminders: return "bell"
        case .limits: return "speedometer"
        case .data: return "externaldrive"
        }
    }
}

/// Deep links into Profile (a limit notice on Today): `ProfileNavigator.shared.open(.limits)`, then select the tab.
/// The tab consumes the request when it appears, or at once when it is already on screen (like `CallsNavigator`).
@MainActor final class ProfileNavigator: ObservableObject {
    static let shared = ProfileNavigator()
    @Published private(set) var pending: ProfileSection?
    func open(_ section: ProfileSection) { pending = section }
    func consume() -> ProfileSection? {
        let section = pending
        pending = nil
        return section
    }
}

// MARK: - Row values

/// The summary line and the one-line values on the right of the Profile rows (pure, unit-tested).
enum ProfileCopy {
    /// The longest «тон: …» summary, in characters (web `shortTone`).
    static let toneLimit = 40
    /// The server's placeholder names are not a name (the web summary's list, plus the iPhone decoder's «ты»).
    static let placeholderNames: Set<String> = ["Ты", "You", "Learner", "ты"]

    /// The summary's name: «Твой профиль» while the server holds only a placeholder (web `Summary`).
    static func displayName(_ name: String?) -> String {
        let clean = name?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return clean.isEmpty || placeholderNames.contains(clean) ? "Твой профиль" : clean
    }

    /// «Практика 15 мин в день · тон: прямо и по делу» (PASS-0.5.3 §3, the same line on the PC).
    static func practiceLine(_ profile: Learner?) -> String {
        var line = "Практика \(profile?.dailyMinutes ?? 15) мин в день"
        if let tone = profile.flatMap({ shortTone($0.feedback) }) { line += " · тон: " + tone }
        return line
    }

    /// The summary's «тон: …», ported from the web's `shortTone` (components/screens/profile-screen.tsx): the first
    /// non-empty clause of the coach-tone answer (up to . , ; : ! ? ( ) — – « - » or a line break), lower-cased unless it
    /// opens with an abbreviation (two capital letters: AI, IELTS), cut at a word to ≤ 40 characters with «…» (at the last
    /// space of the first 39 characters when that space is at position 20 or later). An empty answer has no tone part.
    static func shortTone(_ feedback: String) -> String? {
        let separators = CharacterSet(charactersIn: ".,;:!?()\n—–")
        var parts: [String] = []
        for piece in feedback.components(separatedBy: " - ") {
            parts += piece.components(separatedBy: separators)
        }
        guard let clause = parts.map({ $0.trimmingCharacters(in: .whitespacesAndNewlines) }).first(where: { !$0.isEmpty }) else {
            return nil
        }
        let characters = Array(clause)
        let abbreviation = characters.count >= 2 && isUppercaseLetter(characters[0]) && isUppercaseLetter(characters[1])
        let lowered = abbreviation ? clause : String(characters[0]).lowercased(with: RuFormat.locale) + String(characters.dropFirst())
        guard lowered.count > toneLimit else { return lowered }
        var cut = String(lowered.prefix(toneLimit - 1))
        if let space = cut.lastIndex(of: " "), cut.distance(from: cut.startIndex, to: space) >= 20 {
            cut = String(cut[..<space])
        }
        while let last = cut.last, last.isWhitespace { cut.removeLast() }
        return cut + "…"
    }

    /// `\p{Lu}`: an uppercase letter (by its first scalar).
    private static func isUppercaseLetter(_ character: Character) -> Bool {
        character.unicodeScalars.first?.properties.generalCategory == .uppercaseLetter
    }

    /// «Голос» row (web `voiceValue`): «Подключён · $3 из $50» / «Нет ключа»; «Проверяю…» or «Статус недоступен» while the
    /// server status is unknown. Spend in whole dollars rounded down, the budget as it was set.
    static func voiceValue(status: ServerStatus?, statusUnavailable: Bool, usage: AudioUsage?) -> String {
        guard let status else { return statusUnavailable ? "Статус недоступен" : "Проверяю…" }
        guard status.audio.configured else { return "Нет ключа" }
        guard let usage else { return "Подключён" }
        return "Подключён · " + LimitNotice.wholeDollars(usage.usedUsd) + " из " + LimitNotice.budgetDollars(usage.budgetUsd)
    }

    enum CoachTone: Equatable { case neutral, good, warning, danger }

    /// «Тренер и лимиты» row (web `coachChip`): a subscription limit notice speaks first («Лимит исчерпан», «Упёрся в
    /// лимит», «Лимит на исходе»), then the model's own status («На связи» / «Не подключается» / «Нет связи»), or
    /// «Проверяю…» / «Статус недоступен» while it is unknown.
    static func coachState(notice: LimitNotice?, status: ServerStatus?, statusUnavailable: Bool) -> (label: String, tone: CoachTone) {
        if let notice {
            switch notice.kind {
            case .subscriptionLow: return (label: "Лимит на исходе", tone: CoachTone.warning)
            case .rateLimited: return (label: "Упёрся в лимит", tone: CoachTone.danger)
            default: return (label: "Лимит исчерпан", tone: CoachTone.danger)
            }
        }
        guard let status else {
            if statusUnavailable { return (label: "Статус недоступен", tone: CoachTone.warning) }
            return (label: "Проверяю…", tone: CoachTone.neutral)
        }
        if let error = status.brain.error, !error.isEmpty, !status.brain.verified {
            return (label: "Не подключается", tone: CoachTone.warning)
        }
        if status.brain.verified { return (label: "На связи", tone: CoachTone.good) }
        return (label: "Нет связи", tone: CoachTone.warning)
    }

    /// «09:30, 19:00» (up to three times, then «и ещё N») or «Выключены».
    static func remindersValue(_ reminders: [PracticeReminder], notificationState: String) -> String {
        let active = PracticeReminder.ordered(reminders.filter { $0.enabled })
        guard !active.isEmpty, notificationState != "denied" else { return "Выключены" }
        let times = active.map { $0.timeLabel }
        if times.count <= 3 { return times.joined(separator: ", ") }
        return times.prefix(2).joined(separator: ", ") + " и ещё \(times.count - 2)"
    }

    /// «Аудио 30 дней», «Аудио 3 месяца».
    static func retentionValue(_ days: Int) -> String { "Аудио " + retention(days) }

    static func retention(_ days: Int) -> String {
        switch days {
        case 90: return "3 месяца"
        case 180: return "6 месяцев"
        default: return "\(days) " + RuFormat.plural(days, "день", "дня", "дней")
        }
    }

    /// «Мой плейбук» row (web `PlaybookRow`): «4 факта · 2 новых», «1 новое — проверь», «4 факта» or «Пока пусто».
    static func playbookValue(_ facts: [ProfileFact]) -> String {
        playbookValue(accepted: facts.filter { $0.status == "accepted" }.count,
                      toCheck: facts.filter { $0.status == "suggested" }.count)
    }

    static func playbookValue(accepted: Int, toCheck: Int) -> String {
        let fresh = "\(toCheck) " + RuFormat.plural(toCheck, "новое", "новых", "новых")
        let known = "\(accepted) " + RuFormat.plural(accepted, "факт", "факта", "фактов")
        if accepted > 0 && toCheck > 0 { return known + " · " + fresh }
        if toCheck > 0 { return fresh + " — проверь" }
        if accepted > 0 { return known }
        return "Пока пусто"
    }
}

extension ProfileCopy.CoachTone {
    /// Status colours only for status (DESIGN-PASS 0.5.1): lime when on air, warning / danger for problems.
    var color: Color {
        switch self {
        case .neutral: return Theme.inkTertiary
        case .good: return Theme.lime
        case .warning: return Theme.warning
        case .danger: return Theme.danger
        }
    }
}

/// A row title with its stroke icon in the text colour.
struct ProfileRowTitle: View {
    let title: String
    let icon: String
    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: icon).font(.body).foregroundStyle(Theme.ink).frame(width: 24).accessibilityHidden(true)
            Text(title).foregroundStyle(Theme.ink)
        }
    }
}

/// The pushed screens share the Profile list look: inset-grouped rows on the solid card colour over the canvas.
private struct ProfileSubscreen: ViewModifier {
    let title: String
    func body(content: Content) -> some View {
        content
            .listStyle(.insetGrouped)
            .scrollContentBackground(.hidden)
            .textCase(nil)
            .modifier(LiquidCanvas())
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
    }
}

// MARK: - О тебе

/// «О тебе»: what the coach knows (read-only); «Изменить» opens the existing editor sheet.
struct ProfileDetailsView: View {
    @EnvironmentObject private var client: TrainingClient
    @State private var showEditor = false

    var body: some View {
        let profile = client.state?.profile
        List {
            Section {
                VStack(alignment: .leading, spacing: 4) {
                    Text(ProfileCopy.displayName(profile?.name)).font(TypeScale.title2)
                    Text(ProfileCopy.practiceLine(profile)).font(.subheadline).foregroundStyle(Theme.inkSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(.vertical, 4)
                .accessibilityElement(children: .combine)
            }
            .listRowBackground(Theme.solid)
            Section {
                detail("Цели", profile?.goals)
                detail("Работа", profile?.professionalContext)
                detail("Переезд", profile?.relocation)
                detail("Интересы", profile.map { $0.interests.joined(separator: ", ") })
                detail("Тон тренера", profile?.feedback)
            } footer: {
                Text("Собеседник и тренер подстраивают занятия под это.")
            }
            .listRowBackground(Theme.solid)
        }
        .modifier(ProfileSubscreen(title: ProfileSection.details.title))
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button("Изменить") { showEditor = true }
                    .disabled(profile == nil)
            }
        }
        .sheet(isPresented: $showEditor) {
            if let current = client.state?.profile {
                ProfileEditor(profile: current).environmentObject(client)
            }
        }
    }

    private func detail(_ title: String, _ value: String?) -> some View {
        let text = value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return VStack(alignment: .leading, spacing: 3) {
            Text(title).font(.footnote).foregroundStyle(Theme.inkSecondary)
            Text(text.isEmpty ? "Не указано" : text).font(.body)
                .foregroundStyle(text.isEmpty ? Theme.inkTertiary : Theme.ink)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Голос

/// The monthly voice budget (PASS-0.5.3 §2): 1–50 $, the server default 50 when it is not set.
enum VoiceBudget {
    static let range: ClosedRange<Double> = 1...50
    static let fallback = 50.0
    /// Saved this long after the last change (web BudgetField).
    static let autosaveDelay = 0.9

    static func clamped(_ value: Double) -> Double? {
        guard value.isFinite else { return nil }
        return min(range.upperBound, max(range.lowerBound, value))
    }

    /// One Stepper tap from `current` toward the value the Stepper proposes: the next whole dollar up or down
    /// (12.5 → 13 or 12), never outside 1–50.
    static func stepped(_ current: Double, toward proposed: Double) -> Double {
        guard current.isFinite, proposed.isFinite else { return fallback }
        if proposed > current { return min(range.upperBound, current.rounded(.down) + 1) }
        if proposed < current { return max(range.lowerBound, current.rounded(.up) - 1) }
        return current
    }

    /// «50», «12,5»: the number next to the Stepper (the label already says «$ в месяц»).
    static func label(_ value: Double) -> String {
        guard value.isFinite else { return "–" }
        if value == value.rounded() { return String(Int(value)) }
        return value.formatted(.number.precision(.fractionLength(0...2)).locale(RuFormat.locale))
    }

    /// «$1.28 из $50»: this month's estimate with cents, as on the PC.
    static func usage(_ value: AudioUsage) -> String {
        let used = value.usedUsd.isFinite ? max(0, value.usedUsd) : 0
        return "$" + String(format: "%.2f", used) + " из " + LimitNotice.budgetDollars(value.budgetUsd)
    }
}

/// «Голос»: whether the partner's voice is on, the monthly budget (saved on its own) and this month's spend.
struct ProfileVoiceView: View {
    @EnvironmentObject private var client: TrainingClient

    private var configured: Bool? { client.status?.audio.configured }

    var body: some View {
        List {
            Section {
                HStack(spacing: 12) {
                    Text("Голос собеседника")
                    Spacer(minLength: 8)
                    StatusPill(title: configured == nil ? "Проверяю…" : configured == true ? "Подключён" : "Нет ключа",
                               color: configured == nil ? Theme.inkTertiary : configured == true ? Theme.lime : Theme.warning)
                }
            } footer: {
                if let configured {
                    Text(configured
                         ? "Реплики звучат автоматически. Звук играет даже в беззвучном режиме — это учебное приложение."
                         : "Голос подключается на компьютере: Профиль → Голос. После этого потяни экран вниз.")
                }
            }
            .listRowBackground(Theme.solid)
            Section {
                VoiceBudgetField()
            } footer: {
                Text("Распознавание речи и голос собеседника оплачиваются отдельно, через OpenAI API. Когда бюджет кончится, можно заниматься текстом.")
            }
            .listRowBackground(Theme.solid)
            if let usage = client.state?.audioUsage {
                Section {
                    LabeledContent {
                        Text(VoiceBudget.usage(usage)).font(.body.weight(.semibold)).monospacedDigit()
                    } label: {
                        Text("Голос за месяц, оценка")
                    }
                    .accessibilityElement(children: .combine)
                } footer: {
                    Text("Записано \(usage.recordedMinutes.formatted(.number.precision(.fractionLength(1)).locale(RuFormat.locale))) мин. Итоговый счёт — у OpenAI.")
                }
                .listRowBackground(Theme.solid)
            }
        }
        .modifier(ProfileSubscreen(title: ProfileSection.voice.title))
        .refreshable { await client.refreshQuietly() }
    }
}

/// «Бюджет голоса, $ в месяц» (1–50): a Stepper with the value, saved on its own 0.9 s after the last change and at once
/// when the screen closes (web BudgetField): «Сохраняю…» / «Сохранено» / «Не удалось сохранить бюджет.».
struct VoiceBudgetField: View {
    private enum SaveState: Equatable { case idle, saving, saved, failed }

    @EnvironmentObject private var client: TrainingClient
    @State private var amount = VoiceBudget.fallback
    @State private var editing = false
    @State private var saveState = SaveState.idle
    @State private var pendingSave: Task<Void, Never>? = nil
    @State private var savedReset: Task<Void, Never>? = nil

    private var savedAmount: Double { client.state?.profile.budgetUsd ?? VoiceBudget.fallback }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Stepper(value: stepperValue, in: VoiceBudget.range, step: 1) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text("Бюджет голоса, $ в месяц")
                    Spacer(minLength: 8)
                    Text(VoiceBudget.label(amount)).font(.body.weight(.semibold)).monospacedDigit()
                }
            }
            .accessibilityValue(VoiceBudget.label(amount) + " долларов в месяц")
            status
        }
        .padding(.vertical, 4)
        .onAppear { syncFromServer() }
        .onChange(of: savedAmount) { _, _ in syncFromServer() }
        .onChange(of: saveState) { _, state in announce(state) }
        .onDisappear { commitNow() }
    }

    @ViewBuilder private var status: some View {
        switch saveState {
        case .saving:
            Text("Сохраняю…").font(.footnote).foregroundStyle(Theme.inkSecondary)
        case .saved:
            Label("Сохранено", systemImage: "checkmark").font(.footnote.weight(.semibold)).foregroundStyle(Theme.limeInk)
        case .failed:
            Text("Не удалось сохранить бюджет.").font(.footnote).foregroundStyle(Theme.danger)
        case .idle:
            Text("От $1 до $50. Сохраняется само.").font(.footnote).foregroundStyle(Theme.inkSecondary)
        }
    }

    private var stepperValue: Binding<Double> {
        Binding(get: { amount }, set: { proposed in change(VoiceBudget.stepped(amount, toward: proposed)) })
    }

    /// The server's value shows until the learner changes it (edits from the PC arrive here too).
    private func syncFromServer() {
        guard !editing, saveState != .saving else { return }
        amount = VoiceBudget.clamped(savedAmount) ?? VoiceBudget.fallback
    }

    private func change(_ value: Double) {
        guard value != amount else { return }
        amount = value
        editing = true
        saveState = .idle
        savedReset?.cancel()
        pendingSave?.cancel()
        pendingSave = Task { @MainActor in
            do { try await Task.sleep(for: .seconds(VoiceBudget.autosaveDelay)) } catch { return }
            await commit()
        }
    }

    private func commitNow() {
        guard editing else { return }
        pendingSave?.cancel()
        pendingSave = nil
        Task { @MainActor in await commit() }
    }

    @MainActor private func commit() async {
        pendingSave = nil
        guard editing else { return }
        editing = false
        guard let value = VoiceBudget.clamped(amount) else {
            saveState = .failed
            return
        }
        if value == client.state?.profile.budgetUsd {
            saveState = .idle
            return
        }
        saveState = .saving
        let saved = await client.saveVoiceBudget(value)
        saveState = saved ? .saved : .failed
        guard saved else { return }
        savedReset?.cancel()
        savedReset = Task { @MainActor in
            do { try await Task.sleep(for: .seconds(2.4)) } catch { return }
            if saveState == .saved { saveState = .idle }
        }
    }

    private func announce(_ state: SaveState) {
        let message: String
        switch state {
        case .saved: message = "Сохранено"
        case .failed: message = "Не удалось сохранить бюджет."
        default: return
        }
        UIAccessibility.post(notification: .announcement, argument: message)
    }
}

// MARK: - Напоминания

/// «Напоминания»: daily practice times on this iPhone (permission notes, edit, pause, delete, up to 12).
struct ProfileRemindersView: View {
    @EnvironmentObject private var client: TrainingClient
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @State private var reminderEditor: ReminderEditorSelection? = nil
    @State private var reminderToDelete: PracticeReminder? = nil

    var body: some View {
        List {
            Section {
                permissionNote
                ForEach(client.reminders) { reminder in
                    reminderRow(reminder)
                }
                Button { reminderEditor = ReminderEditorSelection(reminder: nil) } label: {
                    Label("Добавить время", systemImage: "plus")
                }
                .disabled(client.reminderBusy || client.reminders.count >= 12)
            } header: {
                HStack {
                    Text("Время для практики").font(.subheadline.weight(.semibold)).foregroundStyle(Theme.inkSecondary)
                    Spacer()
                    if client.reminderBusy { ProgressView().tint(Theme.violet) }
                }
            } footer: {
                if client.reminders.count >= 12 {
                    Text("Можно сохранить до 12 времён. Удали одно, чтобы добавить новое.")
                } else if client.reminders.isEmpty {
                    Text("Выбери одно или несколько удобных времён. Напоминания приходят по местному времени этого iPhone.")
                }
            }
            .listRowBackground(Theme.solid)
        }
        .modifier(ProfileSubscreen(title: ProfileSection.reminders.title))
        .task {
            await client.refreshReminderStatus()
#if DEBUG
            if PreviewFixtures.screen == "reminder-editor" && reminderEditor == nil {
                // After the push settles: a sheet presented mid-transition can be dropped.
                try? await Task.sleep(for: .milliseconds(450))
                reminderEditor = ReminderEditorSelection(reminder: client.reminders.first)
            }
#endif
        }
        .sheet(item: $reminderEditor) { selection in
            ReminderTimeEditor(reminder: selection.reminder).environmentObject(client)
                .presentationDetents(dynamicTypeSize.isAccessibilitySize ? [.large] : [.height(500), .large])
                .presentationDragIndicator(.visible)
        }
        .confirmationDialog("Удалить напоминание?", isPresented: deletePresented, titleVisibility: .visible) {
            if let reminderToDelete {
                Button("Удалить время \(reminderToDelete.timeLabel)", role: .destructive) {
                    let id = reminderToDelete.id
                    self.reminderToDelete = nil
                    Task { await client.deleteReminder(id: id) }
                }
            }
            Button("Оставить", role: .cancel) { reminderToDelete = nil }
        } message: { Text("Другие времена останутся без изменений.") }
    }

    private var deletePresented: Binding<Bool> {
        Binding(get: { reminderToDelete != nil }, set: { if !$0 { reminderToDelete = nil } })
    }

    @ViewBuilder private var permissionNote: some View {
        if client.notificationState == "denied" {
            VStack(alignment: .leading, spacing: 10) {
                Text("Уведомления выключены в iPhone. Твои времена сохранены.")
                    .font(.footnote).foregroundStyle(Theme.inkSecondary)
                Button { client.openSystemSettings() } label: { Label("Разрешить уведомления", systemImage: "arrow.up.right") }
                    .buttonStyle(QuietButton())
            }
            .padding(.vertical, 4)
        } else if client.notificationState == "unavailable" {
            VStack(alignment: .leading, spacing: 10) {
                Text("iPhone не передал состояние уведомлений. Попробуй открыть настройки приложения.")
                    .font(.footnote).foregroundStyle(Theme.inkSecondary)
                Button { client.openSystemSettings() } label: { Label("Настройки iPhone", systemImage: "arrow.up.right") }
                    .buttonStyle(QuietButton())
            }
            .padding(.vertical, 4)
        } else if client.notificationState == "provisional" {
            VStack(alignment: .leading, spacing: 10) {
                Text("Разрешена тихая доставка. Чтобы видеть баннеры, включи их в настройках iPhone.")
                    .font(.footnote).foregroundStyle(Theme.inkSecondary)
                Button { client.openSystemSettings() } label: { Label("Настройки iPhone", systemImage: "arrow.up.right") }
                    .buttonStyle(QuietButton())
            }
            .padding(.vertical, 4)
        }
    }

    private func reminderRow(_ reminder: PracticeReminder) -> some View {
        HStack(spacing: 12) {
            Button { reminderEditor = ReminderEditorSelection(reminder: reminder) } label: {
                VStack(alignment: .leading, spacing: 2) {
                    Text(reminder.timeLabel).font(TypeScale.stat)
                    Text(reminder.enabled ? "Каждый день" : "На паузе").font(.footnote).foregroundStyle(Theme.inkSecondary)
                }
                .foregroundStyle(Theme.ink).frame(maxWidth: .infinity, minHeight: 48, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(PressButton())
            .accessibilityLabel("Изменить напоминание в " + reminder.timeLabel)
            Toggle("Напоминание в " + reminder.timeLabel, isOn: Binding(get: { reminder.enabled }, set: { value in
                Task { await client.setReminderEnabled(id: reminder.id, enabled: value) }
            }))
            .labelsHidden().tint(Theme.violet).fixedSize()
            Button { reminderToDelete = reminder } label: { Image(systemName: "trash").font(.subheadline) }
                .buttonStyle(SoftIconButton(size: 40))
                .accessibilityLabel("Удалить напоминание в " + reminder.timeLabel)
        }
        .disabled(client.reminderBusy)
    }
}

// MARK: - Тренер и лимиты

/// «Тренер и лимиты»: Sol's connection (with a re-check) and the subscription limits.
struct ProfileCoachView: View {
    @EnvironmentObject private var client: TrainingClient
    @State private var checking = false

    var body: some View {
        List {
            Section {
                HStack(alignment: .center, spacing: 12) {
                    VStack(alignment: .leading, spacing: 3) {
                        Text(client.status?.brain.model ?? "GPT-6.1 Sol")
                        if let message = client.status?.brain.error, client.status?.brain.verified != true {
                            Text(message).font(.footnote).foregroundStyle(Theme.inkSecondary)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                    Spacer(minLength: 8)
                    let model = ProfileCopy.coachState(notice: nil, status: client.status, statusUnavailable: client.statusUnavailable)
                    StatusPill(title: model.label, color: model.tone.color)
                }
                Button { Task { await check() } } label: {
                    HStack {
                        Text(checking ? "Проверяю…" : "Проверить подключение")
                        Spacer()
                        if checking { ProgressView().tint(Theme.violet) } else { Image(systemName: "arrow.clockwise") }
                    }
                }
                .disabled(checking)
            } footer: {
                Text("GPT-6.1 Sol подбирает занятия, ведёт разговор и разбирает ответы.")
            }
            .listRowBackground(Theme.solid)
            Section {
                QuotaSection()
                    .padding(.vertical, 4)
            }
            .listRowBackground(Theme.solid)
        }
        .modifier(ProfileSubscreen(title: ProfileSection.limits.title))
        .refreshable { await client.refreshMeta() }
        // Opening the limits reads them again (web: opening the «Тренер и лимиты» row).
        .task { await client.refreshUsage() }
    }

    private func check() async {
        checking = true
        await client.refreshMeta()
        checking = false
    }
}

/// Subscription limits (web SubscriptionLimits): windows by bucket and period with historical values marked, Sol's own
/// activity in this app, the time of the check and the ChatGPT usage page.
private struct QuotaSection: View {
    @EnvironmentObject private var client: TrainingClient

    var body: some View {
        let usage = client.subscriptionUsage
        let summary = SubscriptionSummary.make(usage)
        let buckets = Self.buckets(summary)
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text("Лимиты подписки").font(.subheadline.weight(.semibold)).accessibilityAddTraits(.isHeader)
                Spacer(minLength: 8)
                if let plan = summary.planLabel {
                    Text(plan).font(.caption.weight(.semibold)).foregroundStyle(Theme.inkSecondary)
                }
            }
            Text(summary.scopeLabel).font(.caption).foregroundStyle(Theme.inkSecondary)
            if summary.available {
                if let notice = summary.notice {
                    Label(notice, systemImage: "exclamationmark.circle")
                        .font(.caption).foregroundStyle(Theme.inkSecondary)
                }
                ForEach(buckets, id: \.self) { bucket in
                    if buckets.count > 1, let label = summary.windows.first(where: { $0.bucketId == bucket })?.bucketLabel {
                        Text(label).font(.footnote.weight(.semibold))
                    }
                    ForEach(summary.windows.filter { $0.bucketId == bucket }) { window in
                        windowRow(window)
                    }
                }
            } else {
                VStack(alignment: .leading, spacing: 3) {
                    Text("Остаток пока недоступен").font(.footnote.weight(.semibold))
                    Text(summary.unavailableText).font(.footnote).foregroundStyle(Theme.inkSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            if let activity = usage?.activity { activityBlock(activity) }
            if let checked = summary.checkedLabel {
                Text("Проверено: " + checked).font(.caption).foregroundStyle(Theme.inkSecondary)
            }
            if let url = SubscriptionSummary.manageURL(usage?.manageUrl) {
                Link(destination: url) {
                    HStack { Text("Открыть лимиты ChatGPT"); Spacer(); Image(systemName: "arrow.up.right") }
                        .font(.subheadline.weight(.semibold))
                }
            }
        }
    }

    private static func buckets(_ summary: SubscriptionSummary) -> [String] {
        var ids: [String] = []
        for window in summary.windows where !ids.contains(window.bucketId) { ids.append(window.bucketId) }
        return ids
    }

    private func windowRow(_ window: SubscriptionSummary.Window) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(window.periodLabel).font(.footnote.weight(.semibold))
                if !window.fresh {
                    Text("Прошлая проверка").font(.caption2.weight(.semibold)).foregroundStyle(Theme.inkSecondary)
                }
                Spacer(minLength: 8)
                if let label = window.percentLabel {
                    Text(label + "% " + (window.fresh ? "осталось" : "оставалось"))
                        .font(.footnote.weight(.semibold)).monospacedDigit()
                }
            }
            if let remaining = window.remainingPercent {
                LiquidProgressBar(value: remaining / 100, color: window.low ? Theme.warning : Theme.violet, height: 6)
                    .opacity(window.fresh ? 1 : 0.5)
            } else {
                Text("Остаток не передан").font(.caption).foregroundStyle(Theme.inkSecondary)
            }
            if let relative = window.resetRelative {
                Text(relative + (window.resetLabel.map { " · " + $0 } ?? ""))
                    .font(.caption).foregroundStyle(Theme.inkSecondary)
            } else {
                Text("Время сброса не указано").font(.caption).foregroundStyle(Theme.inkSecondary)
            }
            if window.duplicateConflict {
                Text("Данные периода расходятся. Обнови проверку.").font(.caption).foregroundStyle(Theme.inkSecondary)
            }
            if window.low {
                Text(window.exhausted ? "Лимит исчерпан. Новые ответы могут быть недоступны до сброса."
                                      : "Остаток небольшой. Учитывай его перед длинным занятием.")
                    .font(.caption.weight(.semibold)).fixedSize(horizontal: false, vertical: true)
            }
        }
        .accessibilityElement(children: .combine)
    }

    private func activityBlock(_ activity: SubscriptionUsage.Activity) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline) {
                Text("Sol в этом приложении").font(.footnote.weight(.semibold))
                Spacer(minLength: 8)
                Text("За \(activity.periodDays) дн.").font(.caption).foregroundStyle(Theme.inkSecondary)
            }
            HStack(alignment: .top, spacing: 18) {
                stat(activity.requests, "Запросов")
                stat(activity.successful, "Ответил")
                stat(activity.failed, "С ошибкой")
            }
            Text("Это активность тренинга. Она не показывает расход всей подписки.")
                .font(.caption).foregroundStyle(Theme.inkSecondary).fixedSize(horizontal: false, vertical: true)
            if let last = SubscriptionSummary.timestamp(activity.lastLimitAt) {
                Text("Последнее ограничение: " + RuFormat.dayTime(last)).font(.caption).foregroundStyle(Theme.inkSecondary)
            }
            if let retry = SubscriptionSummary.timestamp(activity.retryAt), retry > Date() {
                Text("Сервис разрешит повтор после " + RuFormat.time(retry) + ".").font(.caption.weight(.semibold))
            }
        }
        .padding(.top, 4)
    }

    private func stat(_ value: Int, _ title: String) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(RuFormat.number(value)).font(.subheadline.weight(.semibold)).monospacedDigit()
            Text(title).font(.caption).foregroundStyle(Theme.inkSecondary)
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Данные

/// «Данные»: export, delete all practice, how long recordings are kept, the server and «Выйти на этом iPhone».
struct ProfileDataView: View {
    @EnvironmentObject private var client: TrainingClient
    @State private var exportURL: URL? = nil
    @State private var showReset = false
    @State private var confirmSignOut = false

    var body: some View {
        List {
            Section {
                if let exportURL {
                    ShareLink(item: exportURL) {
                        Label("Поделиться файлом", systemImage: "square.and.arrow.up")
                    }
                } else {
                    Button { Task { exportURL = await client.exportData() } } label: {
                        Label(client.busy && client.operationStage == "Готовлю файл с данными" ? "Готовлю файл…" : "Выгрузить данные",
                              systemImage: "arrow.down.doc")
                    }
                    .disabled(client.busy)
                }
                Button(role: .destructive) { showReset = true } label: { Label("Удалить всю практику", systemImage: "trash") }
                    .foregroundStyle(Theme.danger)
                    .disabled(client.busy || client.recording)
            } footer: {
                Text("Практика хранится на твоём сервере. Можно выгрузить копию или начать с чистого листа.")
            }
            .listRowBackground(Theme.solid)
            Section {
                LabeledContent("Хранить аудио", value: ProfileCopy.retention(client.state?.profile.audioRetentionDays ?? 30))
            } footer: {
                Text("Срок хранения записей меняется на компьютере: Профиль → Данные.")
            }
            .listRowBackground(Theme.solid)
            Section {
                VStack(alignment: .leading, spacing: 3) {
                    Text("Сервер").font(.footnote).foregroundStyle(Theme.inkSecondary)
                    Text(client.server.isEmpty ? "Не указан" : client.server).font(.body)
                        .lineLimit(1).truncationMode(.middle)
                }
                .accessibilityElement(children: .combine)
                Button { confirmSignOut = true } label: {
                    Label("Выйти на этом iPhone", systemImage: "rectangle.portrait.and.arrow.right")
                }
                .disabled(client.busy || client.recording)
            }
            .listRowBackground(Theme.solid)
        }
        .modifier(ProfileSubscreen(title: ProfileSection.data.title))
        .sheet(isPresented: $showReset) {
            ResetSheet().environmentObject(client)
        }
        .confirmationDialog("Выйти на этом iPhone?", isPresented: $confirmSignOut, titleVisibility: .visible) {
            Button("Выйти", role: .destructive) { client.signOut() }
            Button("Остаться", role: .cancel) {}
        } message: { Text("История останется на сервере. Для входа понадобится адрес и личный код.") }
    }
}
