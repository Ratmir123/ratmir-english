import SwiftUI
import UniformTypeIdentifiers

/// Navigation destinations inside the Созвоны tab.
enum CallsRoute: Hashable {
    case call(String)
    case patterns
    case facts
}

/// Deep links into the Созвоны tab from other screens (Today cards, notifications):
/// `CallsNavigator.shared.open(.call(id))`, then select the tab. The tab consumes the request
/// when it appears (or immediately if it is already on screen).
@MainActor final class CallsNavigator: ObservableObject {
    static let shared = CallsNavigator()
    @Published private(set) var pending: CallsRoute?
    func open(_ route: CallsRoute) { pending = route }
    func consume() -> CallsRoute? {
        let route = pending
        pending = nil
        return route
    }
}

/// Tab root «Созвоны»: upload card, insights (patterns, playbook) and the list of calls.
/// Owns its NavigationStack; polls every 3 s only while a call is processing and the list is visible.
struct CallsScreen: View {
    @EnvironmentObject private var client: TrainingClient

    var body: some View {
        CallsScreenContent(client: client)
    }
}

private struct CallsScreenContent: View {
    @StateObject private var store: CallsStore
    @ObservedObject private var uploads: CallUploadCenter
    @ObservedObject private var navigator: CallsNavigator
    @EnvironmentObject private var client: TrainingClient
    @State private var path: [CallsRoute] = []
    @State private var pendingDelete: CallSummary?
    @Environment(\.scenePhase) private var scenePhase

    init(client: TrainingClient) {
        _store = StateObject(wrappedValue: CallsStore(client: client))
        _uploads = ObservedObject(wrappedValue: CallUploadCenter.shared)
        _navigator = ObservedObject(wrappedValue: CallsNavigator.shared)
    }

    private var stateSignature: String {
        (client.state?.calls ?? []).map { $0.signature }.joined(separator: ",")
            + "#" + String(client.state?.patterns?.count ?? -1) + "#" + String(client.state?.profileFacts?.count ?? -1)
    }
    private var pollIdentity: String { store.pollKey + "|" + (scenePhase == .active ? "active" : "inactive") }

    var body: some View {
        NavigationStack(path: $path) {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    CallUploadCard(compact: false)
                    banners
                    CallsInsightsRow(patterns: store.patterns, facts: store.facts, open: { path.append($0) })
                    callsSection
                }
                .padding(.horizontal, 20)
                .padding(.top, 8)
                .padding(.bottom, 32)
                .frame(maxWidth: 720)
                .frame(maxWidth: .infinity)
            }
            .background { FeatureBackdrop() }
            .refreshable {
                await store.reload()
                await store.refreshClientState()
            }
            .task(id: pollIdentity) {
                guard scenePhase == .active, store.isAnyProcessing else { return }
                await store.pollProcessing()
            }
            .navigationTitle("Созвоны")
            .navigationDestination(for: CallsRoute.self) { route in
                destination(route)
            }
        }
        .task {
            applyPendingRoute()
            await store.reload()
            uploads.sweepOrphans()
#if DEBUG
            if path.isEmpty, let route = FeaturePreviewFixtures.initialRoute(for: PreviewFixtures.screen) { path = [route] }
#endif
        }
        .onChange(of: navigator.pending) { _, route in
            if route != nil { applyPendingRoute() }
        }
        .onChange(of: uploads.completions) { _, _ in
            Task { await store.reload() }
        }
        .onChange(of: stateSignature) { _, _ in store.adoptState() }
        .confirmationDialog("Удалить звонок?", isPresented: deleteBinding, titleVisibility: .visible, presenting: pendingDelete) { call in
            Button("Удалить «\(call.title)»", role: .destructive) {
                Task { await store.delete(callId: call.id) }
            }
            Button("Отмена", role: .cancel) {}
        } message: { _ in
            Text("Удалятся запись, расшифровка, разбор и тренировки из этого звонка. Паттерны пересчитаются.")
        }
    }

    private func applyPendingRoute() {
        guard let route = navigator.consume() else { return }
        path = [route]
    }

    private var deleteBinding: Binding<Bool> {
        Binding(get: { pendingDelete != nil }, set: { if !$0 { pendingDelete = nil } })
    }

    @ViewBuilder private var banners: some View {
        if let error = store.error {
            FeatureBanner(message: error, actionTitle: "Повторить", action: { Task { await store.reload() } },
                          onDismiss: { store.error = nil })
        }
        if let notice = store.notice {
            FeatureBanner(message: notice, tone: .info, onDismiss: { store.notice = nil })
        }
    }

    @ViewBuilder private var callsSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            FeatureSectionTitle(title: "Звонки")
            if store.calls.isEmpty {
                FeatureEmptyState(icon: "phone.bubble", title: "Пока пусто",
                                  text: "Загрузи запись или транскрипт звонка — или опиши его по памяти. Разберу, что сработало, что стоило денег, и соберу тренировки из твоих моментов.")
                    .featureGlass(radius: 24)
            } else {
                ForEach(Array(store.calls.enumerated()), id: \.element.id) { entry in
                    NavigationLink(value: CallsRoute.call(entry.element.id)) {
                        CallRow(call: entry.element)
                    }
                    .buttonStyle(FeatureTileButtonStyle())
                    .contextMenu {
                        Button("Удалить звонок", systemImage: "trash", role: .destructive) { pendingDelete = entry.element }
                    }
                    .featureReveal(entry.offset)
                }
            }
        }
    }

    @ViewBuilder private func destination(_ route: CallsRoute) -> some View {
        switch route {
        case .call(let id):
            CallDetailScreen(callId: id, store: store)
        case .patterns:
            PatternsView(patterns: store.patterns, drills: store.drills)
        case .facts:
            FactsView(facts: store.facts)
        }
    }
}

// MARK: - Insights row

struct CallsInsightsRow: View {
    let patterns: [CommunicationPattern]
    let facts: [ProfileFact]
    let open: (CallsRoute) -> Void

    private var activePatterns: [CommunicationPattern] {
        patterns.filter { $0.isWeakness && !$0.dismissed && $0.status != "resolved" }
            .sorted { $0.costRank < $1.costRank }
    }
    private var suggestedFacts: Int { facts.filter { $0.status == "suggested" }.count }
    private var acceptedFacts: Int { facts.filter { $0.status == "accepted" }.count }

    var body: some View {
        if !patterns.isEmpty || !facts.isEmpty {
            VStack(spacing: 12) {
                if !patterns.isEmpty { patternsTile }
                if !facts.isEmpty { factsTile }
            }
        }
    }

    private var patternsTile: some View {
        Button { open(.patterns) } label: {
            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    Label("Мои паттерны", systemImage: "point.3.connected.trianglepath.dotted").font(.headline)
                    Spacer()
                    Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(.secondary)
                }
                if activePatterns.isEmpty {
                    Text("Сейчас нет активных паттернов. Новые появятся после разбора звонков.")
                        .font(.subheadline).foregroundStyle(.secondary).multilineTextAlignment(.leading)
                } else {
                    ForEach(activePatterns.prefix(2)) { pattern in
                        HStack(alignment: .firstTextBaseline, spacing: 10) {
                            Text(pattern.title).font(.subheadline).lineLimit(1)
                            Spacer(minLength: 8)
                            PatternHistoryDots(history: pattern.history, limit: 6)
                        }
                    }
                }
            }
            .foregroundStyle(Color.primary)
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(Rectangle())
            .featureGlass(radius: 24, interactive: true)
        }
        .buttonStyle(FeatureTileButtonStyle())
        .accessibilityHint("Открывает все паттерны")
    }

    private var factsTile: some View {
        Button { open(.facts) } label: {
            HStack(spacing: 12) {
                Label("Факты о тебе", systemImage: "person.text.rectangle").font(.headline)
                Spacer()
                if suggestedFacts > 0 {
                    FeatureChip(text: FeatureFormat.count(suggestedFacts, "новый", "новых", "новых"), tint: FeaturePalette.lime)
                } else {
                    Text(FeatureFormat.count(acceptedFacts, "факт", "факта", "фактов")).font(.subheadline).foregroundStyle(.secondary)
                }
                Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(.secondary)
            }
            .foregroundStyle(Color.primary)
            .padding(16)
            .contentShape(Rectangle())
            .featureGlass(radius: 24, interactive: true)
        }
        .buttonStyle(FeatureTileButtonStyle())
        .accessibilityHint("Открывает плейбук: ставки, кейсы и факты")
    }
}

// MARK: - Row and status

struct CallRow: View {
    let call: CallSummary

    private var subtitle: String {
        var parts: [String] = []
        if let counterpart = call.counterpart, !counterpart.isEmpty { parts.append(counterpart) }
        if let date = FeatureFormat.relative(call.occurredAt ?? call.createdAt) { parts.append(date) }
        if let duration = FeatureFormat.duration(call.durationSeconds) { parts.append(duration) }
        return parts.joined(separator: " · ")
    }

    var body: some View {
        HStack(alignment: .top, spacing: 14) {
            Image(systemName: FeatureLabels.callSourceIcon(call.source))
                .font(.body.weight(.semibold))
                .foregroundStyle(FeaturePalette.violet)
                .frame(width: 42, height: 42)
                .background(FeaturePalette.lavender.opacity(0.35), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 6) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(call.title).font(.headline).lineLimit(2).multilineTextAlignment(.leading)
                    Spacer(minLength: 6)
                    CallStatusChip(call: call)
                }
                if !subtitle.isEmpty {
                    Text(subtitle).font(.footnote).foregroundStyle(.secondary)
                }
                detailLine
            }
        }
        .foregroundStyle(Color.primary)
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(Rectangle())
        .featureGlass(radius: 24, interactive: true)
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder private var detailLine: some View {
        switch call.kind {
        case .queued, .processing, .analysing:
            HStack(spacing: 10) {
                CallProgressRing(percent: call.progress?.percent ?? 0)
                Text(call.progress.map { $0.stage.isEmpty ? FeatureLabels.callStatus(call.status) : $0.stage } ?? FeatureLabels.callStatus(call.status))
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        case .needsSpeaker:
            Label("Подтверди, кто из собеседников ты", systemImage: "person.2.wave.2")
                .font(.footnote.weight(.semibold))
                .foregroundStyle(FeaturePalette.warning)
        case .awaitingUpload:
            Label("Загрузка не закончена — открой, чтобы продолжить", systemImage: "arrow.up.circle")
                .font(.footnote)
                .foregroundStyle(.secondary)
        case .error:
            Text(call.error ?? "Разбор не получился. Открой, чтобы повторить.")
                .font(.footnote)
                .foregroundStyle(FeaturePalette.error)
                .lineLimit(2)
        case .ready:
            VStack(alignment: .leading, spacing: 4) {
                if let outcome = call.outcome, !outcome.isEmpty {
                    Text(outcome).font(.subheadline).lineLimit(2).multilineTextAlignment(.leading)
                }
                if let cost = call.topCost, !cost.isEmpty {
                    Label(cost, systemImage: "dollarsign.circle").font(.footnote).foregroundStyle(.secondary).lineLimit(1)
                }
                if call.drillsTotal > 0 {
                    Text("Тренировки: \(call.drillsDone) из \(call.drillsTotal)").font(.footnote.weight(.semibold)).foregroundStyle(.secondary)
                }
            }
        case .unknown:
            EmptyView()
        }
    }
}

struct CallStatusChip: View {
    let call: CallSummary

    private var icon: String {
        switch call.kind {
        case .awaitingUpload: return "arrow.up.circle"
        case .queued: return "clock"
        case .processing: return "waveform"
        case .needsSpeaker: return "person.2"
        case .analysing: return "sparkles"
        case .ready: return "checkmark.seal"
        case .error: return "exclamationmark.triangle"
        case .unknown: return "questionmark.circle"
        }
    }
    private var tint: Color {
        switch call.kind {
        case .awaitingUpload, .needsSpeaker: return FeaturePalette.warning
        case .queued: return FeaturePalette.lavender
        case .processing: return FeaturePalette.cyan
        case .analysing: return FeaturePalette.violet
        case .ready: return FeaturePalette.lime
        case .error: return FeaturePalette.error
        case .unknown: return FeaturePalette.lavender
        }
    }

    var body: some View {
        FeatureChip(text: FeatureLabels.callStatus(call.status), icon: icon, tint: tint)
            .accessibilityLabel("Статус: " + FeatureLabels.callStatus(call.status))
    }
}

struct CallProgressRing: View {
    let percent: Double
    var size: CGFloat = 22
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        ZStack {
            Circle().stroke(FeaturePalette.track, lineWidth: 3)
            if percent > 0 {
                Circle()
                    .trim(from: 0, to: CGFloat(min(100, max(0, percent)) / 100))
                    .stroke(FeaturePalette.violet, style: StrokeStyle(lineWidth: 3, lineCap: .round))
                    .rotationEffect(.degrees(-90))
            } else {
                ProgressView().controlSize(.mini)
            }
        }
        .frame(width: size, height: size)
        .animation(reduceMotion ? nil : FeatureMotion.standard, value: percent)
        .accessibilityHidden(true)
    }
}
