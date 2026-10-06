import SwiftUI

/// The playbook: facts about the learner (rates, floors, cases, metrics, confidential terms,
/// relocation…) grouped by kind. Suggested facts come first with «Верно / Неверно»; accepted facts
/// feed the partner, hints and the evaluator. `embedded: true` renders without scroll view/backdrop.
struct FactsView: View {
    let facts: [ProfileFact]
    var embedded: Bool = false
    @EnvironmentObject private var client: TrainingClient
    @State private var overrides: [ProfileFact]?
    @State private var busy: Set<String> = []
    @State private var error: String?

    private var current: [ProfileFact] { overrides ?? facts }
    private var signature: String { facts.map { $0.id + $0.status }.joined() }
    private var suggested: [ProfileFact] { current.filter { $0.status == "suggested" } }
    private var accepted: [ProfileFact] { current.filter { $0.status == "accepted" } }
    private var rejected: [ProfileFact] { current.filter { $0.status == "rejected" } }
    private var acceptedKinds: [String] {
        let present = Set(accepted.map { $0.kind })
        let known = FeatureLabels.factKindOrder.filter { present.contains($0) }
        let unknown = present.subtracting(FeatureLabels.factKindOrder).sorted()
        return known + unknown
    }

    var body: some View {
        if embedded {
            content
        } else {
            ScrollView {
                content
                    .padding(.horizontal, 20)
                    .padding(.top, 8)
                    .padding(.bottom, 32)
                    .frame(maxWidth: 720)
                    .frame(maxWidth: .infinity)
                    .entranceStage()
            }
            .background { FeatureBackdrop() }
            .navigationTitle("Факты о тебе")
        }
    }

    /// Blocks carry their staircase step; embedded in a host without a stage they simply show.
    private var content: some View {
        VStack(alignment: .leading, spacing: 18) {
            if !embedded {
                Text("Что тренажёр знает о тебе: ставки, кейсы, цифры, условия. Собеседник, подсказки и разбор опираются только на принятые факты.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .entrance(0)
            }
            if let error {
                FeatureBanner(message: error, onDismiss: { self.error = nil })
            }
            if current.isEmpty {
                FeatureEmptyState(icon: "person.text.rectangle", title: "Фактов пока нет",
                                  text: "После разбора звонка здесь появятся предложения: ставки, кейсы и договорённости, которые прозвучали.")
                    .featureGlass(radius: 24)
                    .entrance(1)
            }
            if !suggested.isEmpty {
                VStack(alignment: .leading, spacing: 10) {
                    FeatureSectionTitle(title: "Проверь, всё ли верно · \(suggested.count)", subtitle: "Прими только то, что верно. Ставки — для своего типа клиента.")
                    group(suggested)
                }
                .entrance(1)
            }
            ForEach(Array(acceptedKinds.enumerated()), id: \.element) { index, kind in
                VStack(alignment: .leading, spacing: 10) {
                    FeatureSectionTitle(title: FeatureLabels.factKind(kind))
                    group(accepted.filter { $0.kind == kind })
                }
                .entrance(2 + index)
            }
            if !rejected.isEmpty {
                DisclosureGroup {
                    VStack(alignment: .leading, spacing: 0) {
                        ForEach(Array(rejected.enumerated()), id: \.element.id) { index, fact in
                            if index > 0 { RowDivider(inset: 0) }
                            row(fact, inset: 0)
                        }
                    }
                    .padding(.top, 8)
                } label: {
                    Text("Отклонённые · \(rejected.count)").font(.subheadline.weight(.semibold))
                }
                .padding(16)
                .featureGlass(radius: 22)
                .entrance(2 + acceptedKinds.count)
            }
        }
        .onChange(of: signature) { _, _ in overrides = nil }
    }

    private func group(_ facts: [ProfileFact]) -> some View {
        GroupedRows {
            ForEach(Array(facts.enumerated()), id: \.element.id) { index, fact in
                if index > 0 { RowDivider(inset: 48) }
                row(fact)
            }
        }
    }

    private func row(_ fact: ProfileFact, inset: CGFloat = 16) -> some View {
        FactRow(fact: fact, busy: busy.contains(fact.id), inset: inset,
                onAccept: { decide(fact, accept: true) },
                onReject: { decide(fact, accept: false) })
    }

    private func decide(_ fact: ProfileFact, accept: Bool) {
        guard !busy.contains(fact.id) else { return }
        if client.isFeaturePreview {
            error = "В предпросмотре изменения не сохраняются."
            return
        }
        busy.insert(fact.id)
        Task {
            do {
                let envelope: FactsEnvelope = try await client.request("facts", body: ["factId": fact.id, "decision": accept ? "accept" : "reject"])
                overrides = envelope.profileFacts
                await client.featureRefresh()
            } catch {
                self.error = FeatureErrorText.describe(error)
            }
            busy.remove(fact.id)
        }
    }
}

struct FactRow: View {
    let fact: ProfileFact
    let busy: Bool
    var inset: CGFloat = 16
    let onAccept: () -> Void
    let onReject: () -> Void

    private var sourceText: String {
        var parts: [String] = []
        switch fact.source.type {
        case "call": parts.append("из звонка")
        case "seed": parts.append("из первых данных")
        default: parts.append("добавлено вручную")
        }
        if let at = fact.at { parts.append(FeatureFormat.clock(at)) }
        if let date = FeatureFormat.shortDate(fact.createdAt) { parts.append(date) }
        return parts.joined(separator: " · ")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: FeatureLabels.factKindIcon(fact.kind))
                    .foregroundStyle(Color.primary)
                    .frame(width: 22)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 4) {
                    Text(fact.text).font(.subheadline.weight(.semibold)).fixedSize(horizontal: false, vertical: true)
                    Text(FeatureLabels.factKind(fact.kind) + " · " + sourceText).font(.caption).foregroundStyle(.secondary)
                }
                Spacer(minLength: 0)
                if busy { ProgressView().controlSize(.small) }
            }
            if let quote = fact.quote, !quote.isEmpty {
                FeatureQuote(text: quote)
            }
            actions
        }
        .padding(.horizontal, inset).padding(.vertical, 14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .opacity(fact.status == "rejected" ? 0.7 : 1)
        .accessibilityElement(children: .contain)
    }

    @ViewBuilder private var actions: some View {
        switch fact.status {
        case "suggested":
            HStack(spacing: 10) {
                Button(action: onAccept) { Label("Верно", systemImage: "checkmark") }
                    .buttonStyle(PrimaryButton(compact: true)).fixedSize().disabled(busy)
                    .accessibilityLabel("Верно: " + fact.text)
                Button(action: onReject) { Label("Нет", systemImage: "xmark") }
                    .buttonStyle(QuietButton()).disabled(busy)
                    .accessibilityLabel("Неверно: " + fact.text)
            }
        case "accepted":
            Menu {
                Button("Убрать из плейбука", systemImage: "minus.circle", role: .destructive, action: onReject)
            } label: {
                Label("В плейбуке", systemImage: "checkmark.seal").font(.footnote.weight(.semibold))
            }
            .disabled(busy)
        default:
            Button("Вернуть", action: onAccept).buttonStyle(QuietButton()).disabled(busy)
        }
    }
}
