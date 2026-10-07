import SwiftUI
import UIKit
import PhotosUI
import UniformTypeIdentifiers

// «Подготовка к созвону» on the iPhone (planning/v05/PASS-0.5.5.md §3), the same flow, order and words as the PC
// (components/calls/prep.tsx, today-prep.tsx): the entry card «Скоро созвон?» and the list «Подготовки» on «Созвоны», the sheet
// «Подготовка к созвону» (screenshots, «Что ещё важно», «Чего хочешь от звонка», «Когда созвон»), then the prep itself —
// «Читаю переписку…» while Sol reads, then the rehearsal under the title, «Перед звонком помни» and the plan — the Today row, the
// Today quick action and the line over a rehearsal review. Content on solid surfaces, no glass on content, no cards inside
// cards, no kickers.

// MARK: - Draft

/// What the sheet collects before «Подготовить». Screenshots are scaled off the main thread as they come in, so «Подготовить»
/// only uploads.
@MainActor final class PrepDraft: ObservableObject {
    struct Shot: Identifiable, Equatable {
        let id = UUID()
        let upload: PrepUpload
        let thumbnail: UIImage
        static func == (left: Shot, right: Shot) -> Bool { left.id == right.id }
    }

    @Published var shots: [Shot] = []
    @Published var text = ""
    @Published var goal = ""
    @Published var hasCallAt = false
    @Published var callAt: Date
    /// Screenshots still being scaled.
    @Published private(set) var importing = 0
    @Published private(set) var sending = false
    /// The server's Russian refusal, a picture that could not be read, or the offline line.
    @Published var error: String?

    init() {
        callAt = PrepDraft.nextHour()
    }

    /// The next full hour from now: where «Когда созвон» starts.
    static func nextHour(_ now: Date = Date(), calendar: Calendar = .current) -> Date {
        let start = calendar.dateInterval(of: .hour, for: now)?.start ?? now
        return start.addingTimeInterval(3_600)
    }

    var room: Int { max(0, PrepLimits.maxImages - shots.count - importing) }
    var canSubmit: Bool { PrepLabels.canSubmit(images: shots.count, text: text) && importing == 0 && !sending }
    /// Under «Подготовить»: why it is not possible yet, or how long it takes (web `sheetHint`).
    var hint: String {
        if importing > 0 { return "Готовлю скриншоты…" }
        return PrepLabels.submitProblem(images: shots.count, text: text) ?? "Разбор займёт минуту-две."
    }

    /// The fields never exceed the server limits (like the web `maxLength`).
    func clipFields() {
        if text.utf16.count > PrepLimits.textLimit { text = PhraseLabels.prefix(text, utf16: PrepLimits.textLimit) }
        if goal.utf16.count > PrepLimits.goalLimit { goal = PhraseLabels.prefix(goal, utf16: PrepLimits.goalLimit) }
    }

    /// New pictures from the photo picker, the files, a paste or a drop: at most 8 in all, each scaled for the upload.
    func add(_ pictures: [Data]) async {
        guard !pictures.isEmpty else { return }
        let room = self.room
        guard room > 0 else {
            error = "Не больше \(PrepLimits.maxImages) скриншотов."
            return
        }
        let accepted = Array(pictures.prefix(room))
        error = accepted.count < pictures.count ? "Взял первые \(room): не больше \(PrepLimits.maxImages) скриншотов." : nil
        importing += accepted.count
        for data in accepted {
            let prepared = await Task.detached(priority: .userInitiated) { () -> Result<PrepUpload, PrepImages.Problem> in
                do {
                    return .success(try PrepImages.prepare(data))
                } catch let problem as PrepImages.Problem {
                    return .failure(problem)
                } catch {
                    return .failure(.unreadable)
                }
            }.value
            importing -= 1
            switch prepared {
            case .success(let upload):
                // The thumbnail is decoded small, straight from the scaled upload.
                guard let thumbnail = PrepImages.thumbnail(upload.data) else {
                    error = PrepImages.Problem.unreadable.errorDescription
                    continue
                }
                if shots.count < PrepLimits.maxImages { shots.append(Shot(upload: upload, thumbnail: thumbnail)) }
            case .failure(let problem):
                error = problem.errorDescription
            }
        }
    }

    func remove(_ shot: Shot) {
        shots.removeAll { $0.id == shot.id }
    }

    /// «Подготовить»: POST /api/preps. The created prep (status 'reading') is returned; the sheet then closes into it.
    func submit(client: TrainingClient, store: PrepsStore) async -> CallPrep? {
        guard !sending, importing == 0 else { return nil }
        guard PrepLabels.canSubmit(images: shots.count, text: text) else {
            error = PrepCopy.empty
            return nil
        }
        sending = true
        error = nil
        defer { sending = false }
        do {
            let prep = try await store.create(images: shots.map(\.upload), text: text, goal: goal,
                                              callAt: hasCallAt ? callAt : nil, client: client)
            announce(PrepCopy.reading)
            return prep
        } catch {
            let message = TrainingClient.describe(error)
            self.error = message
            announce(message)
            return nil
        }
    }

    func announce(_ message: String) {
        guard UIAccessibility.isVoiceOverRunning, !message.isEmpty else { return }
        UIAccessibility.post(notification: .announcement, argument: message)
    }

#if DEBUG
    /// Previews: a filled sheet.
    func preview(shots: [Shot], text: String, goal: String, callAt: Date?) {
        self.shots = shots
        self.text = text
        self.goal = goal
        if let callAt {
            hasCallAt = true
            self.callAt = callAt
        }
    }
#endif
}

// MARK: - «Созвоны»: entry card and list

/// «Скоро созвон?» above the call upload card.
struct PrepEntryCard: View {
    let open: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top, spacing: 14) {
                Image(systemName: PrepSymbols.phone)
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(Theme.violet)
                    .frame(width: 46, height: 46)
                    .background(Theme.lavender.opacity(0.34), in: RoundedRectangle(cornerRadius: 15, style: .continuous))
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 4) {
                    Text(PrepCopy.entryTitle).font(.headline).accessibilityAddTraits(.isHeader)
                    Text(PrepCopy.entryText)
                        .font(.subheadline)
                        .foregroundStyle(Theme.inkSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            Button(action: open) {
                Text(PrepCopy.entryAction).frame(maxWidth: .infinity)
            }
            .buttonStyle(PrimaryButton(compact: true))
            .accessibilityHint("Скриншоты переписки и пара слов — соберу план и репетицию")
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentSurface(radius: Radius.card)
        .accessibilityElement(children: .contain)
    }
}

enum PrepSymbols {
    static let phone = ShellSymbol.first(["phone.badge.checkmark", "phone.arrow.up.right", "phone"])
}

/// «Подготовки» above «Звонки»: one surface, one row per prep (title, status, counterpart · when).
struct PrepListSection: View {
    let preps: [CallPrep]
    let open: (String) -> Void

    var body: some View {
        if !preps.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                HStack(alignment: .firstTextBaseline) {
                    Text(PrepCopy.list).font(TypeScale.title3).accessibilityAddTraits(.isHeader)
                    Spacer()
                    Text(String(preps.count)).font(.subheadline).foregroundStyle(Theme.inkSecondary)
                        .accessibilityLabel(FeatureFormat.count(preps.count, "подготовка", "подготовки", "подготовок"))
                }
                GroupedRows {
                    ForEach(Array(preps.enumerated()), id: \.element.id) { entry in
                        if entry.offset > 0 { RowDivider() }
                        Button { open(entry.element.id) } label: { PrepRow(prep: entry.element) }
                            .buttonStyle(RowButtonStyle())
                            .accessibilityHint("Открывает подготовку")
                    }
                }
            }
        }
    }
}

/// One prep as a row: title, status chip, counterpart · when.
struct PrepRow: View {
    let prep: CallPrep

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 6) {
                Text(PrepLabels.rowTitle(prep))
                    .font(.headline)
                    .multilineTextAlignment(.leading)
                    .fixedSize(horizontal: false, vertical: true)
                PrepStatusChip(prep: prep)
                let meta = PrepLabels.rowMeta(prep)
                if !meta.isEmpty {
                    Text(meta).font(.footnote).foregroundStyle(Theme.inkSecondary).fixedSize(horizontal: false, vertical: true)
                }
            }
            Spacer(minLength: 8)
            Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(Theme.inkTertiary).padding(.top, 4)
                .accessibilityHidden(true)
        }
        .foregroundStyle(Theme.ink)
        .padding(.horizontal, 16).padding(.vertical, 14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }
}

/// «Читаю» · «Не вышло» · «Репетиция была» · «Готово»: the state of a prep (it changes, so it is a chip).
struct PrepStatusChip: View {
    let prep: CallPrep

    private var icon: String {
        if prep.isReading { return "text.viewfinder" }
        if prep.isFailed { return "exclamationmark.triangle" }
        return PrepRules.latestReminders(prep) == nil ? "checkmark.circle" : "checkmark.seal"
    }
    private var tint: Color {
        if prep.isReading { return FeaturePalette.violet }
        if prep.isFailed { return FeaturePalette.error }
        return PrepRules.latestReminders(prep) == nil ? Theme.inkTertiary : FeaturePalette.lime
    }

    var body: some View {
        FeatureChip(text: PrepLabels.status(prep), icon: icon, tint: tint)
            .accessibilityLabel("Статус: " + PrepLabels.status(prep))
    }
}

// MARK: - Sheet

/// «Подготовка к созвону»: the screenshots and a few words, then «Подготовить». The created prep opens at once (`created`):
/// the prep screen reads «Читаю переписку…» until Sol is done, as on the PC.
struct PrepSheet: View {
    /// The prep was created: the host closes the sheet and opens it.
    let created: (String) -> Void
    @StateObject private var draft: PrepDraft
    @Environment(\.dismiss) private var dismiss

    init(created: @escaping (String) -> Void) {
        self.created = created
        let draft = PrepDraft()
#if DEBUG
        PrepPreview.fill(draft, screen: PreviewFixtures.screen)
#endif
        _draft = StateObject(wrappedValue: draft)
    }

    var body: some View {
        NavigationStack {
            PrepSheetForm(draft: draft, created: created)
                .modifier(LiquidCanvas(intensity: 0.6))
                .navigationTitle(PrepCopy.sheetTitle)
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { SheetCloseButton(title: "Закрыть") { dismiss() } }
                }
        }
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
        .presentationCornerRadius(Radius.sheet)
        .interactiveDismissDisabled(draft.sending)
    }
}

/// The form: screenshots (photos, files, paste, drop), «Что ещё важно», «Чего хочешь от звонка», «Когда созвон», «Подготовить».
private struct PrepSheetForm: View {
    @ObservedObject var draft: PrepDraft
    let created: (String) -> Void
    @EnvironmentObject private var client: TrainingClient
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var pickerItems: [PhotosPickerItem] = []
    @State private var importingFiles = false
    @State private var dropTargeted = false
    @FocusState private var focused: Field?

    private enum Field { case text, goal }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                screenshots
                field(PrepCopy.text) {
                    TextField(PrepCopy.textPlaceholder, text: $draft.text, axis: .vertical)
                        .lineLimit(4...10)
                        .focused($focused, equals: .text)
                }
                field(PrepCopy.goal) {
                    TextField(PrepCopy.goalPlaceholder, text: $draft.goal, axis: .vertical)
                        .lineLimit(1...4)
                        .focused($focused, equals: .goal)
                }
                callAt
                submit
            }
            .padding(.horizontal, 20)
            .padding(.top, 12)
            .padding(.bottom, 28)
            .frame(maxWidth: 600)
            .frame(maxWidth: .infinity)
            .animation(reduceMotion ? nil : NativeMotion.standard, value: draft.shots)
        }
        .scrollDismissesKeyboard(.interactively)
        .onChange(of: draft.text) { _, _ in draft.clipFields() }
        .onChange(of: draft.goal) { _, _ in draft.clipFields() }
        .onChange(of: pickerItems) { _, items in
            guard !items.isEmpty else { return }
            pickerItems = []
            Task { await draft.add(await PrepPictureLoader.load(items)) }
        }
        .fileImporter(isPresented: $importingFiles, allowedContentTypes: [.image], allowsMultipleSelection: true) { result in
            guard case .success(let urls) = result else { return }
            Task { await draft.add(PrepPictureLoader.load(urls)) }
        }
    }

    // MARK: Screenshots

    /// The drop zone: «Перетащи, вставь или выбери до 8 скриншотов.», the thumbnails, «Фото», «Файлы», «Вставить».
    private var screenshots: some View {
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                Text(PrepCopy.images).font(.subheadline.weight(.semibold)).accessibilityAddTraits(.isHeader)
                Text(PrepCopy.imagesHint).font(.footnote).foregroundStyle(Theme.inkSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if !draft.shots.isEmpty || draft.importing > 0 { thumbnails }
            ChipFlow(spacing: 10) {
                PhotosPicker(selection: $pickerItems, maxSelectionCount: max(1, draft.room), matching: .images) {
                    Label("Фото", systemImage: "photo.on.rectangle")
                }
                .buttonStyle(.bordered)
                .buttonBorderShape(.capsule)
                .controlSize(.large)
                .tint(Theme.violet)
                .disabled(draft.room == 0)
                .accessibilityHint("Выбрать скриншоты из «Фото», до 8, по порядку переписки")
                Button { importingFiles = true } label: {
                    Label("Файлы", systemImage: "folder")
                }
                .buttonStyle(.bordered)
                .buttonBorderShape(.capsule)
                .controlSize(.large)
                .tint(Theme.violet)
                .disabled(draft.room == 0)
                PasteButton(supportedContentTypes: [.image]) { providers in
                    Task { @MainActor in await draft.add(await PrepPictureLoader.load(providers)) }
                }
                .labelStyle(.titleAndIcon)
                .buttonBorderShape(.capsule)
                .controlSize(.large)
                .tint(Theme.violet)
                .disabled(draft.room == 0)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.well.opacity(dropTargeted ? 1 : 0.55), in: RoundedRectangle(cornerRadius: Radius.tile, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: Radius.tile, style: .continuous)
                .strokeBorder(dropTargeted ? Theme.violet : Theme.hairline,
                              style: StrokeStyle(lineWidth: dropTargeted ? 2 : 1, dash: [6, 5]))
                .allowsHitTesting(false)
        }
        .onDrop(of: [.image], isTargeted: $dropTargeted) { providers in
            guard draft.room > 0 else { return false }
            Task { @MainActor in await draft.add(await PrepPictureLoader.load(providers)) }
            return true
        }
    }

    private var thumbnails: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 84, maximum: 132), spacing: 10)], alignment: .leading, spacing: 10) {
            ForEach(Array(draft.shots.enumerated()), id: \.element.id) { index, shot in
                PrepThumbnail(image: shot.thumbnail, number: index + 1) { draft.remove(shot) }
                    .transition(reduceMotion ? AnyTransition.opacity : AnyTransition.scale(scale: 0.92).combined(with: .opacity))
            }
            ForEach(0..<draft.importing, id: \.self) { _ in
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(Theme.fill)
                    .aspectRatio(3 / 4, contentMode: .fit)
                    .overlay { ProgressView().tint(Theme.violet) }
                    .accessibilityLabel("Добавляю скриншот")
            }
        }
    }

    // MARK: Fields

    private func label(_ title: String) -> some View {
        (Text(title) + Text(" (необязательно)").foregroundColor(Theme.inkTertiary).fontWeight(.regular))
            .font(.subheadline.weight(.semibold))
            .accessibilityAddTraits(.isHeader)
    }

    private func field<Input: View>(_ title: String, @ViewBuilder input: () -> Input) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            label(title)
            input()
                .font(.body)
                .padding(14)
                .background(Theme.well, in: RoundedRectangle(cornerRadius: Radius.input, style: .continuous))
                .overlay {
                    RoundedRectangle(cornerRadius: Radius.input, style: .continuous)
                        .strokeBorder(Theme.hairline, lineWidth: 1)
                        .allowsHitTesting(false)
                }
                .accessibilityLabel(title)
        }
    }

    private var callAt: some View {
        VStack(alignment: .leading, spacing: 10) {
            Toggle(isOn: $draft.hasCallAt.animation(reduceMotion ? nil : NativeMotion.standard)) { label(PrepCopy.callAt) }
                .tint(Theme.violet)
            if draft.hasCallAt {
                DatePicker("Дата и время", selection: $draft.callAt, in: Date().addingTimeInterval(-3_600)...,
                           displayedComponents: [.date, .hourAndMinute])
                    .font(.subheadline)
                    .environment(\.locale, RuFormat.locale)
                    .transition(.opacity)
            }
        }
    }

    private var submit: some View {
        VStack(alignment: .leading, spacing: 10) {
            if let error = draft.error {
                InlineBanner(tone: .error, title: "Не получилось", message: error, dismiss: { draft.error = nil })
            }
            Button {
                focused = nil
                Task {
                    if let prep = await draft.submit(client: client, store: PrepsStore.shared) { created(prep.id) }
                }
            } label: {
                HStack(spacing: 10) {
                    if draft.sending { ProgressView().tint(Theme.ctaLabel) }
                    Text(draft.sending ? "Отправляю…" : PrepCopy.submit)
                }
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(PrimaryButton())
            .disabled(!draft.canSubmit)
            .accessibilityHint(draft.hint)
            Text(draft.hint)
                .font(.footnote)
                .foregroundStyle(Theme.inkSecondary)
                .frame(maxWidth: .infinity, alignment: .center)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityHidden(true)
        }
    }
}

/// One screenshot in the sheet: its number and × to remove it.
private struct PrepThumbnail: View {
    let image: UIImage
    let number: Int
    let remove: () -> Void

    var body: some View {
        Color.clear
            .aspectRatio(3 / 4, contentMode: .fit)
            .overlay(alignment: .top) {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFill()
                    .accessibilityHidden(true)
            }
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Theme.hairline, lineWidth: 1)
                    .allowsHitTesting(false)
            }
            .overlay(alignment: .bottomLeading) {
                Text(String(number))
                    .font(.caption.weight(.heavy).monospacedDigit())
                    .foregroundStyle(Theme.ink)
                    .frame(minWidth: 22, minHeight: 22)
                    .padding(.horizontal, 4)
                    .background(Theme.solid, in: Capsule())
                    .padding(6)
                    .accessibilityHidden(true)
            }
            .overlay(alignment: .topTrailing) {
                Button(action: remove) {
                    Image(systemName: "xmark")
                        .font(.caption.weight(.bold))
                        .foregroundStyle(Theme.ink)
                        .frame(width: 28, height: 28)
                        .background(Theme.solid, in: Circle())
                        .overlay { Circle().strokeBorder(Theme.hairline, lineWidth: 1) }
                        .frame(width: 44, height: 44)
                        .contentShape(Rectangle())
                }
                .buttonStyle(PressButton())
                .accessibilityLabel("Убрать скриншот \(number)")
            }
            .accessibilityElement(children: .contain)
            .accessibilityLabel("Скриншот \(number)")
    }
}

/// Reads the bytes of picked, pasted, dropped or imported pictures (nothing is kept beyond the upload).
enum PrepPictureLoader {
    @MainActor static func load(_ items: [PhotosPickerItem]) async -> [Data] {
        var result: [Data] = []
        for item in items {
            if let data = try? await item.loadTransferable(type: Data.self) { result.append(data) }
        }
        return result
    }

    static func load(_ urls: [URL]) -> [Data] {
        urls.compactMap { url in
            let scoped = url.startAccessingSecurityScopedResource()
            defer { if scoped { url.stopAccessingSecurityScopedResource() } }
            return try? Data(contentsOf: url)
        }
    }

    static func load(_ providers: [NSItemProvider]) async -> [Data] {
        var result: [Data] = []
        for provider in providers where provider.hasItemConformingToTypeIdentifier(UTType.image.identifier) {
            let data: Data? = await withCheckedContinuation { continuation in
                _ = provider.loadDataRepresentation(forTypeIdentifier: UTType.image.identifier) { data, _ in
                    continuation.resume(returning: data)
                }
            }
            if let data { result.append(data) }
        }
        return result
    }
}

// MARK: - Reading and failure

/// While Sol reads the chat: the chubrik thinks over «Читаю переписку…»; «Ещё немного: …» after ~25 s; a reading that outlasts
/// the polling says to look in later (web `PrepDetailView` reading state).
struct PrepReadingPanel: View {
    let prep: CallPrep
    /// The store still polls this prep.
    let polling: Bool
    @State private var slow = false

    private var started: Date { NativeDate.parse(prep.createdAt) ?? Date() }

    private var detail: String {
        if !polling && Date().timeIntervalSince(started) >= PrepLimits.pollLimit {
            return "Что-то долго. Загляни сюда через пару минут или потяни экран вниз, чтобы обновить."
        }
        if slow { return PrepCopy.readingSlow }
        return PrepLabels.readingDetail(images: prep.input.images)
    }

    var body: some View {
        VStack(spacing: 14) {
            ScreenMascot(mood: .thinking, size: 112, mode: .thinking, interactive: false)
            SpeechBubble(title: PrepCopy.reading, detail: detail)
        }
        .frame(maxWidth: .infinity)
        .task(id: prep.id + prep.createdAt) {
            slow = false
            let wait = PrepLimits.slowAfter - Date().timeIntervalSince(started)
            if wait > 0 {
                do { try await Task.sleep(for: .seconds(wait)) } catch { return }
            }
            slow = true
        }
        .onChange(of: slow) { _, now in
            guard now, UIAccessibility.isVoiceOverRunning else { return }
            UIAccessibility.post(notification: .announcement, argument: PrepCopy.readingSlow)
        }
    }
}

/// Reading failed: the shared line, the server's note and «Повторить» (POST …/retry).
struct PrepFailedPanel: View {
    let prep: CallPrep
    @EnvironmentObject private var client: TrainingClient
    @ObservedObject private var store: PrepsStore

    init(prep: CallPrep) {
        self.prep = prep
        _store = ObservedObject(wrappedValue: PrepsStore.shared)
    }

    var body: some View {
        VStack(spacing: 14) {
            ScreenMascot(mood: .sad, size: 96, interactive: false)
            SpeechBubble(title: PrepCopy.failed)
            if let note = PrepLabels.failure(prep) {
                Text(note)
                    .font(.subheadline)
                    .foregroundStyle(Theme.inkSecondary)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Button {
                Task { await store.retry(prep, client: client) }
            } label: {
                HStack(spacing: 10) {
                    if store.working.contains(prep.id) { ProgressView().tint(Theme.ctaLabel) }
                    Label("Повторить", systemImage: "arrow.clockwise")
                }
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(PrimaryButton())
            .disabled(store.working.contains(prep.id))
            .accessibilityHint("Ещё раз прочитаю переписку")
        }
        .frame(maxWidth: .infinity)
    }
}

// MARK: - Prep

/// One prep (a destination of «Созвоны»): the header; «Читаю переписку…» while Sol reads; then the rehearsal under the title
/// («Как на созвоне» / «С опорами», «Репетиция · ~10 мин» or «Ещё раз, жёстче»), «Перед звонком помни» once a rehearsal was
/// reviewed, and the plan.
struct PrepDetailScreen: View {
    let prepId: String
    @EnvironmentObject private var client: TrainingClient
    @ObservedObject private var store: PrepsStore
    @State private var mode = "call"
    @State private var confirmDelete = false
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase

    init(prepId: String) {
        self.prepId = prepId
        _store = ObservedObject(wrappedValue: PrepsStore.shared)
    }

    private var prep: CallPrep? { store.prep(prepId, in: client.state) }
    /// A rehearsal review lands in the background: the prep is read again every 4 s while one is analysed (web, likewise).
    private var analysingKey: String {
        guard scenePhase == .active, let prep, prep.rehearsals.contains(where: { $0.status == "analysing" }) else { return "" }
        return prep.rehearsals.map(\.status).joined(separator: ",")
    }

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 26) {
                    if let prep {
                        PrepDetailContent(prep: prep, mode: $mode, confirmDelete: { confirmDelete = true })
                    } else if store.loading.contains(prepId) || (client.state == nil && !store.missing.contains(prepId)) {
                        PlacementWaitingView(text: "Открываю подготовку…", retry: nil)
                    } else {
                        FeatureEmptyState(icon: "doc.questionmark", title: "Подготовка не найдена",
                                          text: "Возможно, её удалили на другом устройстве.")
                    }
                    Color.clear.frame(height: 1).id("prep-bottom")
                }
                .padding(.horizontal, 20)
                .padding(.top, 8)
                .padding(.bottom, 24)
                .frame(maxWidth: 720)
                .frame(maxWidth: .infinity)
            }
            .refreshable { await store.load(prepId, client: client) }
#if DEBUG
            .task {
                guard PreviewFixtures.screen == "prep-detail-bottom" else { return }
                do { try await Task.sleep(for: .milliseconds(450)) } catch { return }
                proxy.scrollTo("prep-bottom", anchor: .bottom)
            }
#endif
        }
        .background { FeatureBackdrop() }
        .navigationTitle(prep.map(PrepLabels.title) ?? PrepCopy.sheetTitle)
        .navigationBarTitleDisplayMode(.inline)
        .task { await store.load(prepId, client: client) }
        .task(id: analysingKey) {
            guard !analysingKey.isEmpty else { return }
            while !Task.isCancelled {
                do { try await Task.sleep(for: .seconds(4)) } catch { return }
                await store.load(prepId, client: client)
            }
        }
        .onDisappear {
            if client.playingModelLine?.hasPrefix(PrepLineKey.prefix) == true || client.loadingModelLine?.hasPrefix(PrepLineKey.prefix) == true {
                client.stopSpeaking()
            }
        }
        .confirmationDialog("Удалить подготовку?", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Удалить", role: .destructive) {
                guard let prep else { return }
                Task {
                    if await store.delete(prep, client: client) { dismiss() }
                }
            }
            Button("Отмена", role: .cancel) {}
        } message: {
            Text("Репетиции останутся в истории.")
        }
    }
}

/// Keys of the English lines a prep reads aloud (`TrainingClient.speakModelLine`).
enum PrepLineKey {
    static let prefix = "prep:"
    static func make(_ prepId: String, _ slot: String) -> String { prefix + prepId + ":" + slot }
}

/// Everything above the dock, in the order of PASS-0.5.5 §3 and the PC.
private struct PrepDetailContent: View {
    let prep: CallPrep
    @Binding var mode: String
    let confirmDelete: () -> Void
    @EnvironmentObject private var client: TrainingClient
    @ObservedObject private var store: PrepsStore

    init(prep: CallPrep, mode: Binding<String>, confirmDelete: @escaping () -> Void) {
        self.prep = prep
        _mode = mode
        self.confirmDelete = confirmDelete
        _store = ObservedObject(wrappedValue: PrepsStore.shared)
    }

    private func key(_ slot: String) -> String { PrepLineKey.make(prep.id, slot) }

    var body: some View {
        VStack(alignment: .leading, spacing: 26) {
            header
            if let notice = store.notice {
                FeatureBanner(message: notice, onDismiss: { store.notice = nil })
            }
            if prep.isReading {
                PrepReadingPanel(prep: prep, polling: store.polling.contains(prep.id))
                    .padding(.vertical, 12)
            } else if prep.isFailed {
                PrepFailedPanel(prep: prep)
                    .padding(.vertical, 12)
                deleteButton
            } else {
                plan
                deleteButton
            }
        }
    }

    /// The title, who and when; on a ready prep the rehearsal under it (web header: the mode, the button, the note).
    private var header: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .center, spacing: 14) {
                VStack(alignment: .leading, spacing: 6) {
                    Text(PrepLabels.title(prep))
                        .font(TypeScale.title)
                        .tracking(-0.4)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityAddTraits(.isHeader)
                    let subtitle = PrepLabels.subtitle(prep)
                    if !subtitle.isEmpty {
                        Text(subtitle).font(.subheadline).foregroundStyle(Theme.inkSecondary).fixedSize(horizontal: false, vertical: true)
                    }
                }
                Spacer(minLength: 0)
                if !prep.isReading {
                    ScreenMascot(mood: prep.isFailed ? .sad : .determined, size: 72)
                }
            }
            if prep.isReady { PrepRehearseControls(prep: prep, mode: $mode) }
        }
        .padding(.top, 4)
    }

    @ViewBuilder private var plan: some View {
        if let latest = PrepRules.latestReminders(prep) {
            PrepSection(title: PrepCopy.remember, hint: PrepLabels.rememberHint(latest)) {
                PrepRows(Array(latest.remember.enumerated()), ring: true) { entry in
                    PrepReminderRow(reminder: entry.element, lineKey: key("remember-\(entry.offset)"))
                }
            }
        }
        if prep.situation != nil || prep.goal != nil { situation }
        if !prep.watchouts.isEmpty {
            PrepSection(title: PrepCopy.watchouts, hint: "из твоих прошлых созвонов") {
                ForEach(Array(prep.watchouts.enumerated()), id: \.offset) { index, watchout in
                    PrepWatchoutCard(watchout: watchout, number: index + 1, lineKey: key("watchout-\(index)"))
                }
            }
        }
        if !prep.questions.isEmpty {
            PrepSection(title: PrepCopy.questions) {
                PrepRows(Array(prep.questions.enumerated())) { entry in
                    PrepQuestionRow(question: entry.element, lineKey: key("question-\(entry.offset)"))
                }
            }
        }
        if let lines = prep.lines {
            PrepSection(title: PrepCopy.lines) {
                PrepRows(PrepLabels.keyLines(lines)) { item in
                    PrepLineRow(label: item.label, line: item.line, lineKey: key(item.slot))
                }
            }
        }
        if let price = prep.price { priceSection(price) }
        if !prep.avoid.isEmpty {
            PrepSection(title: PrepCopy.avoid) {
                PrepRows(prep.avoid) { item in PrepBulletRow(symbol: "xmark.circle", text: item) }
            }
        }
        if !prep.risks.isEmpty {
            PrepSection(title: PrepCopy.risks) {
                PrepRows(prep.risks) { item in PrepBulletRow(symbol: "exclamationmark.shield", text: item) }
            }
        }
        if !prep.rehearsals.isEmpty { rehearsals }
        if !prep.limitations.isEmpty {
            Text(prep.limitations.joined(separator: " "))
                .font(.caption)
                .foregroundStyle(Theme.inkSecondary)
                .frame(maxWidth: .infinity, alignment: .leading)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    /// «О чём звонок»: who they are and what they want, then «Цель:» with the minimum.
    private var situation: some View {
        PrepSection(title: PrepCopy.situation) {
            VStack(alignment: .leading, spacing: 12) {
                if let situation = prep.situation {
                    Text(situation).font(.body).fixedSize(horizontal: false, vertical: true)
                }
                if let goal = prep.goal {
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Image(systemName: "checkmark.circle").foregroundStyle(Theme.limeInk).accessibilityHidden(true)
                        (Text(PrepCopy.goalTitle + ": ").fontWeight(.semibold) + Text(goal))
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .font(.subheadline)
                    .accessibilityElement(children: .combine)
                }
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentSurface(radius: Radius.tile)
        }
    }

    private func priceSection(_ price: PrepPrice) -> some View {
        PrepSection(title: PrepCopy.price) {
            VStack(alignment: .leading, spacing: 0) {
                if !price.anchor.isEmpty || !price.floor.isEmpty {
                    HStack(alignment: .top, spacing: 16) {
                        if !price.anchor.isEmpty { priceFact(PrepCopy.anchor, price.anchor) }
                        if !price.floor.isEmpty { priceFact(PrepCopy.floor, price.floor) }
                    }
                    .padding(.horizontal, 16).padding(.vertical, 14)
                }
                if !price.say.isEmpty {
                    RowDivider()
                    PrepLineRow(label: PrepCopy.say, line: price.say, lineKey: key("price-say"))
                }
                if !price.ifLow.isEmpty {
                    RowDivider()
                    PrepLineRow(label: PrepCopy.ifLow, line: price.ifLow, lineKey: key("price-low"))
                }
                if let notes = price.notes {
                    RowDivider()
                    Text(notes).font(.footnote).foregroundStyle(Theme.inkSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 16).padding(.vertical, 12)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentSurface(radius: Radius.tile)
        }
    }

    private func priceFact(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label).font(.footnote).foregroundStyle(Theme.inkSecondary)
            Text(value).font(TypeScale.headline.weight(.bold)).fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }

    /// «Репетиции»: «1. 7 окт. · Как на созвоне · давление 2 из 3» and «Открыть» (or «удалена» / «разбираю…»).
    private var rehearsals: some View {
        PrepSection(title: "Репетиции") {
            PrepRows(Array(prep.rehearsals.enumerated())) { entry in
                PrepRehearsalRow(rehearsal: entry.element, number: entry.offset + 1, open: openRehearsal)
            }
        }
    }

    /// A rehearsal opens like any lesson from the history; one the state does not carry is fetched first.
    private func openRehearsal(_ id: String) {
        if let session = client.state?.session(id) {
            client.resume(session)
            return
        }
        Task {
            do {
                let session: Conversation = try await client.request("sessions/" + id)
                client.resume(session)
            } catch {
                store.notice = TrainingClient.describe(error)
            }
        }
    }

    private var deleteButton: some View {
        Button(role: .destructive, action: confirmDelete) {
            HStack(spacing: 8) {
                if store.working.contains(prep.id) { ProgressView().controlSize(.small) }
                Label(PrepCopy.delete, systemImage: "trash")
            }
        }
        .buttonStyle(DestructiveQuietButton())
        .disabled(store.working.contains(prep.id))
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.top, 4)
    }
}

/// A section title over its content, with an optional quiet line under it (never a kicker).
private struct PrepSection<Content: View>: View {
    let title: String
    var hint: String? = nil
    let content: Content

    init(title: String, hint: String? = nil, @ViewBuilder content: () -> Content) {
        self.title = title
        self.hint = hint
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .firstTextBaseline, spacing: 10) {
                    heading
                    Spacer(minLength: 8)
                    hintText
                }
                VStack(alignment: .leading, spacing: 2) {
                    heading
                    hintText
                }
            }
            content
        }
    }

    private var heading: some View {
        Text(title).font(TypeScale.title3).accessibilityAddTraits(.isHeader)
    }

    @ViewBuilder private var hintText: some View {
        if let hint {
            Text(hint).font(.footnote).foregroundStyle(Theme.inkSecondary)
        }
    }
}

/// Rows of one surface separated by hairlines (never a card inside a card). `ring` outlines it in lime: the one block to read
/// right before the call («Перед звонком помни»).
private struct PrepRows<Item, Row: View>: View {
    let items: [Item]
    var ring = false
    let row: (Item) -> Row

    init(_ items: [Item], ring: Bool = false, @ViewBuilder row: @escaping (Item) -> Row) {
        self.items = items
        self.ring = ring
        self.row = row
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(items.indices), id: \.self) { index in
                if index > 0 { RowDivider() }
                row(items[index])
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .clipShape(RoundedRectangle(cornerRadius: Radius.tile, style: .continuous))
        .contentSurface(radius: Radius.tile)
        .overlay {
            if ring {
                RoundedRectangle(cornerRadius: Radius.tile, style: .continuous)
                    .strokeBorder(Theme.lime, lineWidth: 2)
                    .allowsHitTesting(false)
            }
        }
    }
}

/// The English line to say, on a quiet lime well, with «Послушать» (the review's «Пример сильнее», web `Line`).
private struct PrepSayWell: View {
    let label: String
    let line: String
    let lineKey: String

    var body: some View {
        HStack(alignment: .center, spacing: 10) {
            VStack(alignment: .leading, spacing: 4) {
                Text(label).font(.footnote.weight(.semibold)).foregroundStyle(Theme.inkSecondary)
                Text(PrepLabels.english(line))
                    .font(.subheadline.weight(.semibold))
                    .textSelection(.enabled)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityElement(children: .combine)
            PrepListenButton(text: line, key: lineKey)
        }
        .padding(.leading, 12).padding(.trailing, 6).padding(.vertical, 8)
        .background(Theme.lime.opacity(0.16), in: RoundedRectangle(cornerRadius: Radius.input, style: .continuous))
    }
}

/// «Перед звонком помни»: what went wrong in the rehearsal, his words, then «Скажи» (listenable).
private struct PrepReminderRow: View {
    let reminder: PrepReminder
    let lineKey: String

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                Image(systemName: PrepLabels.reminderSymbol(reminder.kind))
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Theme.violet)
                    .frame(width: 22)
                    .accessibilityHidden(true)
                Text(reminder.title).font(.subheadline.weight(.semibold)).fixedSize(horizontal: false, vertical: true)
            }
            if let said = reminder.said {
                FeatureQuote(text: said)
            }
            if let better = reminder.better {
                PrepSayWell(label: "Скажи", line: better, lineKey: lineKey)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
    }
}

/// «Твои ловушки»: one card per trap (siblings, never nested): number, what, why here, «Скажи вместо:» + the English line.
private struct PrepWatchoutCard: View {
    let watchout: PrepWatchout
    let number: Int
    let lineKey: String

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 12) {
                Text(String(number)).font(.caption.weight(.bold)).foregroundStyle(Theme.onAccent)
                    .frame(width: 26, height: 26).background(Theme.lavender, in: Circle())
                    .accessibilityHidden(true)
                Text(watchout.title).font(.headline).fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 2)
            }
            if !watchout.why.isEmpty {
                Text(watchout.why).font(.subheadline).foregroundStyle(Theme.inkSecondary).fixedSize(horizontal: false, vertical: true)
            }
            if !watchout.instead.isEmpty {
                PrepSayWell(label: PrepCopy.instead, line: watchout.instead, lineKey: lineKey)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentSurface(radius: Radius.tile)
    }
}

/// «Спроси их»: the English question (listenable) and why it matters here.
private struct PrepQuestionRow: View {
    let question: PrepQuestion
    let lineKey: String

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            VStack(alignment: .leading, spacing: 4) {
                Text(PrepLabels.english(question.en))
                    .font(.subheadline.weight(.semibold))
                    .textSelection(.enabled)
                    .fixedSize(horizontal: false, vertical: true)
                if !question.why.isEmpty {
                    Text(question.why).font(.footnote).foregroundStyle(Theme.inkSecondary).fixedSize(horizontal: false, vertical: true)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityElement(children: .combine)
            PrepListenButton(text: question.en, key: lineKey)
        }
        .padding(.leading, 16).padding(.trailing, 10).padding(.vertical, 12)
    }
}

/// A Russian label over an English line with «Послушать» (key lines, the price lines).
private struct PrepLineRow: View {
    let label: String
    let line: String
    let lineKey: String

    var body: some View {
        HStack(alignment: .center, spacing: 10) {
            VStack(alignment: .leading, spacing: 4) {
                Text(label).font(.footnote.weight(.semibold)).foregroundStyle(Theme.inkSecondary)
                Text(PrepLabels.english(line))
                    .font(.subheadline)
                    .textSelection(.enabled)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityElement(children: .combine)
            PrepListenButton(text: line, key: lineKey)
        }
        .padding(.leading, 16).padding(.trailing, 10).padding(.vertical, 12)
    }
}

/// «Не говори» and «Риски»: a stroke symbol and the Russian line.
private struct PrepBulletRow: View {
    let symbol: String
    let text: String

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            Image(systemName: symbol).font(.subheadline.weight(.medium)).foregroundStyle(Theme.inkSecondary).accessibilityHidden(true)
            Text(text).font(.subheadline).fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 16).padding(.vertical, 12)
        .accessibilityElement(children: .combine)
    }
}

/// «Послушать»: the line read by the app voice (POST /api/tts → /api/audio/<file>, the same path as the review examples);
/// a second tap stops it.
struct PrepListenButton: View {
    let text: String
    let key: String
    @EnvironmentObject private var client: TrainingClient

    var body: some View {
        let active = client.playingModelLine == key || client.loadingModelLine == key
        Button { Task { await client.speakModelLine(text, key: key) } } label: {
            if client.loadingModelLine == key {
                ProgressView()
            } else {
                Image(systemName: active ? "stop.fill" : "speaker.wave.2.fill")
            }
        }
        .buttonStyle(SoftIconButton(size: 40, tint: Theme.cyan.opacity(0.32)))
        .disabled(client.recording || client.microphoneStarting)
        .accessibilityLabel(active ? "Остановить" : "Послушать")
    }
}

/// Under the title of a ready prep (web header): the mode, «Репетиция · ~10 мин» or «Ещё раз, жёстче», and a small note —
/// the mode hint and what the partner will do at this pressure.
private struct PrepRehearseControls: View {
    let prep: CallPrep
    @Binding var mode: String
    @EnvironmentObject private var client: TrainingClient

    private var starting: Bool { client.isStarting(TrainingClient.prepKey(prep.id)) }
    private var blocked: Bool { client.busy || client.startingIntent != nil || client.recording || client.hasUnuploadedRecording }
    private var note: String { PrepLabels.rehearseNote(mode: mode, rehearsals: prep.rehearsals.count) }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            SelectionRow(selection: $mode, options: [
                SelectionOption(id: "call", title: ModeCopy.title("call"), icon: "phone"),
                SelectionOption(id: "learning", title: ModeCopy.title("learning"), icon: "lightbulb"),
            ])
            .accessibilityLabel("Режим репетиции")
            Button {
                Task { await client.startPrepRehearsal(prepId: prep.id, mode: mode) }
            } label: {
                HStack(spacing: 10) {
                    if starting {
                        ProgressView().tint(Theme.ctaLabel)
                    } else {
                        Image(systemName: prep.rehearsals.isEmpty ? "play.fill" : "bolt.fill").accessibilityHidden(true)
                    }
                    Text(starting ? "Готовим…" : PrepLabels.rehearseTitle(prep))
                }
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(PrimaryButton())
            .disabled(blocked)
            .accessibilityHint(note)
            Text(note)
                .font(.footnote)
                .foregroundStyle(Theme.inkSecondary)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityHidden(true)
        }
        .padding(.top, 14)
        .overlay(alignment: .top) { RowDivider(inset: 0) }
    }
}

/// One rehearsal: its number, day, mode and pressure; «Открыть» when its session can be opened.
private struct PrepRehearsalRow: View {
    let rehearsal: PrepRehearsal
    let number: Int
    let open: (String) -> Void
    @EnvironmentObject private var client: TrainingClient

    private var title: String { PrepLabels.rehearsalTitle(rehearsal, number: number) }

    var body: some View {
        if PrepLabels.canOpen(rehearsal) {
            Button { open(rehearsal.sessionId) } label: {
                ListRowLabel(icon: "bubble.left.and.bubble.right", title: title, showsChevron: false) {
                    Text("Открыть").font(.footnote.weight(.semibold)).foregroundStyle(Theme.violet)
                }
            }
            .buttonStyle(RowButtonStyle())
            .disabled(client.recording || client.startingIntent != nil || client.busy)
            .accessibilityHint("Открывает репетицию и её разбор")
        } else {
            ListRowLabel(icon: "bubble.left.and.bubble.right", title: title, showsChevron: false) {
                Text(PrepLabels.rehearsalStatus(rehearsal.status)).font(.footnote).foregroundStyle(Theme.inkSecondary)
            }
            .accessibilityElement(children: .combine)
        }
    }
}

// MARK: - Today

/// «Созвон · {title}» above Today's one task while a call is coming (`PrepRules.todayPrep`, web `TodayPrep`): who and when; the
/// row opens the prep, «Репетиция» starts it as on the call.
struct TodayPrepCard: View {
    let select: (ShellTab) -> Void
    @EnvironmentObject private var client: TrainingClient
    @ObservedObject private var store: PrepsStore
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    init(select: @escaping (ShellTab) -> Void) {
        self.select = select
        _store = ObservedObject(wrappedValue: PrepsStore.shared)
    }

    var body: some View {
        if let prep = PrepRules.todayPrep(store.preps(in: client.state, lastRefresh: client.lastRefresh)) {
            card(prep)
        }
    }

    /// The row itself opens the prep in «Созвоны»; «Репетиция» trails it (web `TodayPrep`).
    private func card(_ prep: CallPrep) -> some View {
        Group {
            if dynamicTypeSize.isAccessibilitySize {
                VStack(alignment: .leading, spacing: 4) {
                    openButton(prep)
                    rehearseButton(prep).padding(.leading, 16).padding(.bottom, 12)
                }
            } else {
                HStack(spacing: 8) {
                    openButton(prep)
                    rehearseButton(prep).padding(.trailing, 10)
                }
            }
        }
        .foregroundStyle(Theme.ink)
        .clipShape(RoundedRectangle(cornerRadius: Radius.tile, style: .continuous))
        .contentSurface(radius: Radius.tile)
        .accessibilityElement(children: .contain)
    }

    private func openButton(_ prep: CallPrep) -> some View {
        let subtitle = PrepLabels.subtitle(prep)
        return Button {
            CallsNavigator.shared.open(.prep(prep.id))
            select(.calls)
        } label: {
            HStack(alignment: .center, spacing: 12) {
                Image(systemName: PrepSymbols.phone)
                    .font(.body.weight(.medium))
                    .foregroundStyle(Theme.violet)
                    .frame(width: 26)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    Text(PrepLabels.todayTitle(prep)).font(.subheadline.weight(.semibold))
                        .multilineTextAlignment(.leading)
                        .fixedSize(horizontal: false, vertical: true)
                    if !subtitle.isEmpty {
                        Text(subtitle).font(.footnote).foregroundStyle(Theme.inkSecondary)
                            .multilineTextAlignment(.leading)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                Spacer(minLength: 0)
            }
            .padding(.leading, 16)
            .padding(.vertical, 12)
            .frame(maxWidth: .infinity, minHeight: 60, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(RowButtonStyle())
        .accessibilityHint("Открывает подготовку на вкладке «Созвоны»")
    }

    private func rehearseButton(_ prep: CallPrep) -> some View {
        let starting = client.isStarting(TrainingClient.prepKey(prep.id))
        return Button {
            Task { await client.startPrepRehearsal(prepId: prep.id, mode: "call") }
        } label: {
            HStack(spacing: 6) {
                if starting { ProgressView().controlSize(.small).tint(Theme.ctaLabel) }
                Text(starting ? "Готовим…" : "Репетиция")
            }
        }
        .buttonStyle(PrimaryButton(compact: true))
        .disabled(client.busy || client.startingIntent != nil || client.recording || client.hasUnuploadedRecording)
        .accessibilityHint(ModeCopy.title("call") + ". " + ModeCopy.explanation("call"))
    }
}

// MARK: - Rehearsal review

/// Over the review of a rehearsal (web `review-prep`): «Репетиция созвона · главное на звонок собрано в подготовке, сверху.» and
/// «К подготовке» (the prep with its fresh «Перед звонком помни»).
struct PrepRehearsalLine: View {
    let conversation: Conversation
    @EnvironmentObject private var client: TrainingClient
    @ObservedObject private var store: PrepsStore

    init(conversation: Conversation) {
        self.conversation = conversation
        _store = ObservedObject(wrappedValue: PrepsStore.shared)
    }

    var body: some View {
        if let prepId = conversation.lesson.prepId {
            VStack(alignment: .leading, spacing: 10) {
                HStack(alignment: .firstTextBaseline, spacing: 10) {
                    Image(systemName: PrepSymbols.phone)
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(Theme.violet)
                        .accessibilityHidden(true)
                    (Text(PrepCopy.rehearsalOf).fontWeight(.semibold) + Text(" · " + PrepLabels.reviewNote))
                        .font(.subheadline)
                        .fixedSize(horizontal: false, vertical: true)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                Button(PrepCopy.backToPrep) { open(prepId) }
                    .buttonStyle(QuietButton())
                    .disabled(client.recording || client.microphoneStarting || store.missing.contains(prepId))
                    .accessibilityHint("Сворачивает разбор и открывает подготовку")
            }
            .foregroundStyle(Theme.ink)
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentSurface(radius: Radius.tile)
            .accessibilityElement(children: .contain)
        }
    }

    private func open(_ prepId: String) {
        client.minimizeConversation(keepMoment: true)
        CallsNavigator.shared.open(.prep(prepId))
        client.requestedTab = .calls
    }
}
