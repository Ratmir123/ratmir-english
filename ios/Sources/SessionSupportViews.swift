import SwiftUI

// MARK: - Hints (PASS-0.5.3 §2, web components/session/conversation.tsx «Подсказка»)

/// The three hint levels, requested in any order; the server records the strongest support used for the line.
enum HintLevel: Int, CaseIterable, Identifiable {
    case nudge = 1, structure = 2, example = 3

    var id: Int { rawValue }

    var title: String {
        switch self {
        case .nudge: return "Намёк"
        case .structure: return "Конструкция"
        case .example: return "Пример"
        }
    }
}

extension Conversation {
    /// «Подсказка» is offered only in «С опорами» speaking lessons (web `showSupports`): never in a reading or writing
    /// task, a call-mode lesson or a removed baseline probe.
    var offersHints: Bool {
        mode == "learning" && !isBaseline && !isTextActivity && !isWriting
            && lesson.activity != "reading" && lesson.activity != "writing"
    }
}

/// The composer's hint block: heading, «Сначала попробуй сам…», three chips (the last requested one selected) and the
/// dismissible hint card. While the request runs the caption reads «Подбираю подсказку» and the chips wait; while the
/// learner speaks only the hint card stays, so the dock does not grow under the live captions.
struct ComposerHintsPanel: View {
    let conversation: Conversation
    @EnvironmentObject private var client: TrainingClient
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var pending: Bool { client.busy && client.operationStage == TrainingClient.hintStage }
    private var blocked: Bool {
        client.busy || client.recording || client.microphoneStarting || conversation.processing != nil
            || conversation.status != "active"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if !client.recording {
                Label {
                    Text("Подсказка")
                } icon: {
                    Image(systemName: "lightbulb")
                }
                .font(.subheadline.weight(.semibold))
                .accessibilityAddTraits(.isHeader)
                caption
                chips
            }
            if let hint = client.hint { hintCard(hint) }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .animation(reduceMotion ? nil : NativeMotion.standard, value: client.hint)
    }

    @ViewBuilder private var caption: some View {
        if pending {
            HStack(spacing: 8) {
                ProgressView().controlSize(.small).tint(Theme.violet)
                Text("Подбираю подсказку")
            }
            .font(.caption).foregroundStyle(Theme.inkSecondary)
            .accessibilityElement(children: .combine)
        } else {
            Text("Сначала попробуй сам — опора учитывается в разборе.")
                .font(.caption).foregroundStyle(Theme.inkSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var chips: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 8) { chipButtons }
            VStack(spacing: 8) { chipButtons }
        }
    }

    @ViewBuilder private var chipButtons: some View {
        ForEach(HintLevel.allCases) { level in
            let selected = client.selectedHintLevel == level.rawValue
            Button {
                Task { await client.getHint(level: level.rawValue) }
            } label: {
                Text(level.title)
            }
            .buttonStyle(HintChipStyle(selected: selected))
            .disabled(blocked)
            .accessibilityAddTraits(selected ? .isSelected : [])
            .accessibilityHint("Подсказка уровня \(level.rawValue) из 3. Опора учитывается в разборе.")
        }
    }

    private func hintCard(_ hint: String) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "lightbulb.fill").foregroundStyle(Theme.limeInk).padding(.top, 2).accessibilityHidden(true)
            Text(hint).font(.subheadline).fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
            Button { client.hint = nil } label: { Image(systemName: "xmark").font(.caption.weight(.bold)) }
                .buttonStyle(LiquidIconButton(size: 30))
                .accessibilityLabel("Скрыть подсказку")
        }
        .padding(12)
        .background(Theme.lime.opacity(0.22), in: RoundedRectangle(cornerRadius: Radius.input, style: .continuous))
        .transition(.opacity)
    }
}

/// A hint level chip: a quiet capsule; the selected level gets the lavender wash and a violet edge (selection colour).
private struct HintChipStyle: ButtonStyle {
    let selected: Bool
    @Environment(\.isEnabled) private var isEnabled
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.footnote.weight(.semibold))
            .lineLimit(1)
            .padding(.horizontal, 12).padding(.vertical, 10)
            .frame(maxWidth: .infinity, minHeight: 44)
            .foregroundStyle(isEnabled ? Theme.ink : Theme.inkTertiary)
            .background(selected ? Theme.lavender.opacity(0.55) : Theme.fill, in: Capsule())
            .overlay {
                if selected { Capsule().strokeBorder(Theme.violet, lineWidth: 1.5) }
            }
            .contentShape(Capsule())
            .scaleEffect(configuration.isPressed && isEnabled && !reduceMotion ? 0.97 : 1)
            .animation(reduceMotion ? nil : NativeMotion.press, value: configuration.isPressed)
    }
}

// MARK: - Comfort (PASS-0.5.3 §2, web components/session/review.tsx)

/// «Как ощущалось занятие?» in the review dock (status `review`): an optional 1–5 between «сложно» and «комфортно», sent
/// with «Завершить занятие» and «Отложить попытку». VoiceOver reads one adjustable element.
struct ComfortRatingRow: View {
    let conversation: Conversation
    @EnvironmentObject private var client: TrainingClient

    var body: some View {
        if conversation.status == "review" {
            let selected = client.comfort(for: conversation)
            VStack(alignment: .leading, spacing: 8) {
                Text("Как ощущалось занятие?").font(.footnote.weight(.semibold)).foregroundStyle(Theme.inkSecondary)
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 8) {
                        edge("сложно")
                        scale(selected)
                        edge("комфортно")
                    }
                    VStack(alignment: .leading, spacing: 4) {
                        scale(selected)
                        HStack {
                            edge("сложно")
                            Spacer(minLength: 8)
                            edge("комфортно")
                        }
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("Как ощущалось занятие: от 1 (сложно) до 5 (комфортно)")
            .accessibilityValue(selected.map { "\($0) из 5" } ?? "Не выбрано")
            .accessibilityAdjustableAction { direction in
                let current = selected ?? 0
                if direction == .increment {
                    client.setComfort(min(5, current + 1), for: conversation.id)
                } else if direction == .decrement, current > 1 {
                    client.setComfort(current - 1, for: conversation.id)
                }
            }
            .sensoryFeedback(.selection, trigger: selected)
            .disabled(client.busy)
        }
    }

    private func edge(_ text: String) -> some View {
        Text(text).font(.caption).foregroundStyle(Theme.inkSecondary).lineLimit(1).fixedSize()
    }

    private func scale(_ selected: Int?) -> some View {
        HStack(spacing: 6) {
            ForEach(1...5, id: \.self) { value in
                Button { client.setComfort(value, for: conversation.id) } label: {
                    Text("\(value)").font(.subheadline.weight(.semibold)).monospacedDigit()
                        .frame(width: 40, height: 40)
                        .foregroundStyle(Theme.ink)
                        .background(selected == value ? Theme.lavender.opacity(0.55) : Theme.fill, in: Circle())
                        .overlay {
                            if selected == value { Circle().strokeBorder(Theme.violet, lineWidth: 1.5) }
                        }
                        .frame(minWidth: 44, minHeight: 44)
                        .contentShape(Circle())
                }
                .buttonStyle(PressButton())
            }
        }
    }
}
