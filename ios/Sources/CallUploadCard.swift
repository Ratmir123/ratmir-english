import SwiftUI
import UniformTypeIdentifiers

/// Upload entry point for real calls. `compact` is a shorter variant for Today.
/// Every instance shows the same shared upload job (`CallUploadCenter.shared`).
struct CallUploadCard: View {
    var compact: Bool = false
    @EnvironmentObject private var client: TrainingClient

    var body: some View {
        CallUploadCardContent(compact: compact, client: client)
    }
}

private struct CallUploadCardContent: View {
    let compact: Bool
    let client: TrainingClient
    @ObservedObject private var uploads: CallUploadCenter
    @State private var importing = false
    @State private var draft: CallFileDraft?
    @State private var pendingDraft: CallFileDraft?
    @State private var showMemory = false
    @State private var pickError: String?
    @State private var confirmCancel = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    init(compact: Bool, client: TrainingClient) {
        self.compact = compact
        self.client = client
        _uploads = ObservedObject(wrappedValue: CallUploadCenter.shared)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            if let job = uploads.job {
                CallUploadJobView(job: job, onCancel: { confirmCancel = true }, onResume: { resume(job) },
                                  onDismiss: { uploads.dismissJob() })
            } else {
                idle
            }
            if let pickError {
                FeatureBanner(message: pickError, onDismiss: { self.pickError = nil })
            }
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .featureGlass(radius: 28, tint: FeaturePalette.lavender.opacity(0.45))
        .animation(reduceMotion ? nil : FeatureMotion.standard, value: uploads.job?.phase)
        .fileImporter(isPresented: $importing, allowedContentTypes: CallUploadCenter.allowedTypes) { result in
            handlePick(result)
        }
        .sheet(item: $draft, onDismiss: releasePendingDraft) { value in
            CallUploadSheet(draft: value) { meta, kind in
                pendingDraft = nil
                uploads.submit(draft: value, meta: meta, textKind: kind, client: client)
            }
            .environmentObject(client)
        }
        .sheet(isPresented: $showMemory) {
            CallMemorySheet { text, meta in
                uploads.submitMemory(text: text, meta: meta, client: client)
            }
            .environmentObject(client)
        }
        .confirmationDialog("Отменить загрузку?", isPresented: $confirmCancel, titleVisibility: .visible) {
            Button("Отменить загрузку", role: .destructive) { uploads.cancel(client: client) }
            Button("Продолжить", role: .cancel) {}
        } message: {
            Text("Загруженная часть удалится. Чтобы разобрать звонок, файл нужно будет выбрать заново.")
        }
    }

    private var idle: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: "phone.bubble.fill")
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(FeaturePalette.violet)
                    .frame(width: 44, height: 44)
                    .featureGlass(radius: 22, tint: FeaturePalette.lavender)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 4) {
                    Text("Разбор реального звонка").font(.headline)
                    Text(compact ? "Запись, транскрипт или рассказ по памяти."
                                 : "Запись, видео, транскрипт или готовый разбор. Найду, что сработало и что стоило денег, и соберу тренировки из твоих же моментов.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            if compact {
                HStack(spacing: 10) {
                    Button { importing = true } label: { Label("Загрузить", systemImage: "square.and.arrow.up") }
                        .buttonStyle(PrimaryButton())
                    Button { showMemory = true } label: { Label("По памяти", systemImage: "text.bubble") }
                        .buttonStyle(QuietButton())
                }
            } else {
                Button { importing = true } label: { Label("Загрузить созвон", systemImage: "square.and.arrow.up") }
                    .buttonStyle(PrimaryButton())
                Button { showMemory = true } label: { Label("Описать по памяти", systemImage: "text.bubble") }
                    .buttonStyle(QuietButton())
                Text("Аудио хранится 30 дней, текст и разбор — пока не удалишь. Лучше предупреждать собеседников, что звонок записывается.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private func handlePick(_ result: Result<URL, Error>) {
        switch result {
        case .success(let url):
            do {
                let value = try uploads.makeDraft(from: url)
                pickError = nil
                pendingDraft = value
                // Let the document picker finish dismissing before the details sheet appears.
                Task {
                    try? await Task.sleep(for: .milliseconds(350))
                    draft = value
                }
            } catch {
                pickError = FeatureErrorText.describe(error)
            }
        case .failure(let error):
            if !FeatureErrorText.isCancellation(error) { pickError = FeatureErrorText.describe(error) }
        }
    }

    /// A details sheet closed without «Разобрать» must release the file's security scope.
    private func releasePendingDraft() {
        if let pendingDraft { uploads.releaseDraft(pendingDraft) }
        pendingDraft = nil
    }

    private func resume(_ job: CallUploadJob) {
        guard let callId = job.callId else { uploads.dismissJob(); return }
        uploads.resume(callId: callId, title: job.title, uploadedBytes: nil, client: client)
    }
}

/// Progress of the shared upload job.
struct CallUploadJobView: View {
    let job: CallUploadJob
    let onCancel: () -> Void
    let onResume: () -> Void
    let onDismiss: () -> Void

    private var title: String {
        switch job.phase {
        case .preparing: return "Готовлю файл…"
        case .extracting: return "Извлекаю звук…"
        case .creating: return "Создаю разбор…"
        case .uploading: return "Загружаю запись"
        case .completing: return "Проверяю загрузку…"
        case .done: return "Отправлено на разбор"
        case .failed: return "Загрузка остановилась"
        }
    }
    private var icon: String {
        switch job.phase {
        case .done: return "checkmark.circle.fill"
        case .failed: return "exclamationmark.triangle.fill"
        case .extracting: return "waveform"
        default: return "arrow.up.circle"
        }
    }
    private var percentText: String {
        let percent = FeatureNumber.int(job.fraction * 100) ?? 0
        return FeatureFormat.megabytes(job.sentBytes) + " из " + FeatureFormat.megabytes(job.totalBytes) + " · \(percent) %"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                Label(title, systemImage: icon)
                    .font(.headline)
                    .foregroundStyle(job.phase == .failed ? FeaturePalette.error : Color.primary)
                Spacer(minLength: 8)
                if job.isRunning {
                    Button("Отменить", action: onCancel).buttonStyle(QuietButton())
                }
            }
            Text(job.title).font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
            progress
            if job.phase == .failed {
                if let message = job.message {
                    Text(message).font(.footnote).fixedSize(horizontal: false, vertical: true)
                }
                if job.resumable {
                    Button("Продолжить загрузку", action: onResume).buttonStyle(PrimaryButton())
                }
                Button("Закрыть", action: onDismiss).buttonStyle(QuietButton())
            }
        }
        .accessibilityElement(children: .contain)
    }

    @ViewBuilder private var progress: some View {
        switch job.phase {
        case .extracting:
            if let value = job.extractProgress {
                FeatureProgressBar(value: value, tint: FeaturePalette.cyan, accessibilityText: "Извлекаю звук")
            } else {
                ProgressView().frame(maxWidth: .infinity, alignment: .leading)
            }
            Text("Видео остаётся на iPhone — на сервер уйдёт только звук.").font(.caption).foregroundStyle(.secondary)
        case .uploading:
            FeatureProgressBar(value: job.fraction, tint: FeaturePalette.violet, accessibilityText: "Загружено " + percentText)
            Text(percentText).font(.footnote.weight(.semibold)).monospacedDigit().foregroundStyle(.secondary)
        case .preparing, .creating, .completing:
            ProgressView().frame(maxWidth: .infinity, alignment: .leading)
        case .done:
            Text("Расшифровка и разбор займут несколько минут. Звонок уже в списке — можно закрыть приложение.")
                .font(.footnote).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
        case .failed:
            EmptyView()
        }
    }
}

// MARK: - Sheets

/// Optional details shared by file and memory uploads.
struct CallMetaFields: View {
    @Binding var meta: CallUploadMeta

    var body: some View {
        Section("О звонке") {
            TextField("Название, например «Скрининг в агентстве»", text: $meta.title)
            TextField("Собеседник, например «Продюсер агентства»", text: $meta.counterpart)
            Picker("Контекст", selection: $meta.context) {
                Text("Работа").tag("work")
                Text("Жизнь").tag("life")
                Text("Переезд").tag("relocation")
                Text("Другое").tag("other")
            }
            Toggle("Указать дату", isOn: $meta.hasDate)
            if meta.hasDate {
                DatePicker("Когда был", selection: $meta.occurredAt, in: ...Date(), displayedComponents: [.date, .hourAndMinute])
                    .environment(\.locale, Locale(identifier: "ru_RU"))
            }
        }
        Section {
            TextField("Чего ты хотел от звонка: цель, цифры, подготовка", text: $meta.notes, axis: .vertical)
                .lineLimit(3...8)
        } header: {
            Text("Цель и контекст")
        } footer: {
            Text("Необязательно, но так разбор точнее: сравню итог с тем, чего ты хотел.")
        }
    }
}

struct CallUploadSheet: View {
    let draft: CallFileDraft
    let onSubmit: (CallUploadMeta, CallTextKind) -> Void
    @State private var meta: CallUploadMeta
    @State private var textKind: CallTextKind
    @Environment(\.dismiss) private var dismiss

    init(draft: CallFileDraft, onSubmit: @escaping (CallUploadMeta, CallTextKind) -> Void) {
        self.draft = draft
        self.onSubmit = onSubmit
        var initial = CallUploadMeta()
        initial.title = draft.suggestedTitle
        _meta = State(initialValue: initial)
        let markdown = draft.fileExtension == "md" || draft.fileExtension == "markdown"
        _textKind = State(initialValue: markdown ? .debrief : .transcript)
    }

    private var kindText: String {
        switch draft.kind {
        case .audio: return "Аудиозапись"
        case .video: return "Видео — уйдёт только звук"
        case .text: return "Текст"
        }
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    HStack(spacing: 12) {
                        Image(systemName: draft.kind == .text ? "doc.text" : draft.kind == .video ? "film" : "waveform")
                            .foregroundStyle(FeaturePalette.violet)
                            .frame(width: 28)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(draft.fileName).font(.subheadline.weight(.semibold)).lineLimit(2)
                            Text(kindText + (draft.bytes > 0 ? " · " + FeatureFormat.megabytes(Double(draft.bytes)) : ""))
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                    .accessibilityElement(children: .combine)
                }
                if draft.kind == .text {
                    Section {
                        Picker("Что это", selection: $textKind) {
                            ForEach(CallTextKind.allCases) { kind in
                                Text(kind.title).tag(kind)
                            }
                        }
                        .pickerStyle(.segmented)
                    } header: {
                        Text("Что это")
                    } footer: {
                        Text(textKind == .transcript
                             ? "Расшифровка звонка: строки Whisper, «Имя: текст», .vtt, .srt или .sbv."
                             : "Готовый разбор в Markdown: перенесу выводы в паттерны и тренировки.")
                    }
                }
                CallMetaFields(meta: $meta)
            }
            .navigationTitle("Новый созвон")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Отмена") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Разобрать") {
                        onSubmit(meta, textKind)
                        dismiss()
                    }
                }
            }
        }
    }
}

struct CallMemorySheet: View {
    let onSubmit: (String, CallUploadMeta) -> Void
    @State private var text = ""
    @State private var meta = CallUploadMeta()
    @Environment(\.dismiss) private var dismiss

    private var trimmed: String { text.trimmingCharacters(in: .whitespacesAndNewlines) }
    private static let minimum = 40

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    ZStack(alignment: .topLeading) {
                        if text.isEmpty {
                            Text("Кто был, о чём договорились, что сказал ты, что ответили, где было трудно…")
                                .foregroundStyle(.tertiary)
                                .padding(.top, 8)
                                .padding(.leading, 5)
                                .allowsHitTesting(false)
                        }
                        TextEditor(text: $text)
                            .frame(minHeight: 180)
                            .accessibilityLabel("Описание звонка")
                    }
                } header: {
                    Text("Как прошёл звонок")
                } footer: {
                    Text("По-русски или по-английски. Разбор по памяти — только стратегия: без цитат, языка и темпа. "
                         + (trimmed.count < Self.minimum ? "Ещё хотя бы \(Self.minimum - trimmed.count) символов." : ""))
                }
                CallMetaFields(meta: $meta)
            }
            .navigationTitle("По памяти")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Отмена") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Разобрать") {
                        onSubmit(trimmed, meta)
                        dismiss()
                    }
                    .disabled(trimmed.count < Self.minimum)
                }
            }
        }
    }
}
