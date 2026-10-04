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
            }
            .background { FeatureBackdrop() }
            .navigationTitle("Факты о тебе")
        }
    }

    private var content: some View {
        VStack(alignment: .leading, spacing: 18) {
            if !embedded {
                Text("Что тренажёр знает о тебе: ставки, кейсы, цифры, условия. Собеседник, подсказки и разбор опираются только на принятые факты.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if let error {
                FeatureBanner(message: error, onDismiss: { self.error = nil })
            }
            if current.isEmpty {
                FeatureEmptyState(icon: "person.text.rectangle", title: "Фактов пока нет",
                                  text: "После разбора звонка здесь появятся предложения: ставки, кейсы и договорённости, которые прозвучали.")
                    .featureGlass(radius: 24)
            }
            if !suggested.isEmpty {
                VStack(alignment: .leading, spacing: 12) {
                    FeatureSectionTitle(title: "Новые предложения", subtitle: "Прими только то, что верно. Ставки — для своего типа клиента.")
                    ForEach(suggested) { fact in row(fact) }
                }
            }
            ForEach(acceptedKinds, id: \.self) { kind in
                VStack(alignment: .leading, spacing: 10) {
                    FeatureSectionTitle(title: FeatureLabels.factKind(kind), icon: FeatureLabels.factKindIcon(kind))
                    ForEach(accepted.filter { $0.kind == kind }) { fact in row(fact) }
                }
            }
            if !rejected.isEmpty {
                DisclosureGroup {
                    VStack(alignment: .leading, spacing: 10) {
                        ForEach(rejected) { fact in row(fact) }
                    }
                    .padding(.top, 8)
                } label: {
                    Text("Отклонённые · \(rejected.count)").font(.subheadline.weight(.semibold))
                }
                .padding(16)
                .featureGlass(radius: 22)
            }
        }
        .onChange(of: signature) { _, _ in overrides = nil }
    }

    private func row(_ fact: ProfileFact) -> some View {
        FactRow(fact: fact, busy: busy.contains(fact.id),
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
                    .foregroundStyle(FeaturePalette.violet)
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
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .featureGlass(radius: 20, tint: fact.status == "suggested" ? FeaturePalette.lime.opacity(0.35) : nil)
        .opacity(fact.status == "rejected" ? 0.7 : 1)
        .accessibilityElement(children: .contain)
    }

    @ViewBuilder private var actions: some View {
        switch fact.status {
        case "suggested":
            HStack(spacing: 10) {
                Button("Верно", action: onAccept).buttonStyle(SecondaryButton()).disabled(busy)
                Button("Неверно", action: onReject).buttonStyle(QuietButton()).disabled(busy)
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
