import SwiftUI
import UIKit

/// Speaker-coloured transcript. Tap a timestamp to hear the call from there; long-press a line to
/// mark it «не так расслышано» (never used to teach) and then rebuild the review without it.
struct CallTranscriptView: View {
    let detail: CallDetail
    @ObservedObject var store: CallsStore
    @ObservedObject var player: FeatureAudioPlayer
    let audioKey: String
    let onSeek: ((Double) -> Void)?
    let onReanalyse: () -> Void

    private var disputedCount: Int { detail.segments.filter { $0.disputed }.count }
    private var speakerOrder: [String] {
        var order: [String] = []
        for segment in detail.segments {
            if let id = segment.speaker, !order.contains(id) { order.append(id) }
        }
        return order
    }
    private var playingSegmentId: String? {
        guard player.activeKey == audioKey, player.isPlaying else { return nil }
        let time = player.currentTime
        return detail.segments.first(where: { segment in
            guard let start = segment.start else { return false }
            let end = segment.end ?? start + 4
            return start <= time && time < end
        })?.id
    }
    private var audioNote: String? {
        if detail.audioUrl == nil { return detail.source == "audio" ? "Аудио этого звонка недоступно — только текст." : nil }
        if let expiry = FeatureFormat.date(detail.audioExpiresAt), expiry < Date() {
            return "Запись удалена через 30 дней хранения. Расшифровка и разбор остались."
        }
        return nil
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if disputedCount > 0 {
                FeatureBanner(message: "Отмечено «не так расслышано»: " + FeatureFormat.count(disputedCount, "строка", "строки", "строк")
                                + ". Пересобери разбор, чтобы эти места не учитывались.",
                              tone: .info, actionTitle: "Пересобрать разбор", action: onReanalyse)
            }
            legend
            if let audioNote {
                Label(audioNote, systemImage: "speaker.slash").font(.footnote).foregroundStyle(.secondary)
            } else if onSeek != nil {
                Label("Нажми на время, чтобы послушать момент. Удерживай строку, чтобы отметить ошибку распознавания.", systemImage: "hand.tap")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            LazyVStack(alignment: .leading, spacing: 10) {
                ForEach(detail.segments) { segment in
                    CallSegmentRow(segment: segment,
                                   speakerLabel: label(for: segment.speaker),
                                   isMe: segment.speaker != nil && segment.speaker == detail.meSpeakerId,
                                   color: color(for: segment.speaker),
                                   highlighted: segment.id == playingSegmentId,
                                   busy: store.isBusy("segment:" + segment.id),
                                   onSeek: onSeek,
                                   onToggleDispute: { toggleDispute(segment) })
                }
            }
        }
    }

    private var legend: some View {
        HStack(spacing: 12) {
            ForEach(speakerOrder, id: \.self) { id in
                HStack(spacing: 6) {
                    Circle().fill(color(for: id)).frame(width: 10, height: 10)
                    Text(label(for: id)).font(.caption.weight(.semibold)).lineLimit(1)
                }
            }
            Spacer(minLength: 0)
        }
        .accessibilityElement(children: .combine)
    }

    private func label(for speakerId: String?) -> String {
        guard let speakerId else { return "Не определено" }
        if let speaker = detail.speaker(speakerId) { return speaker.isMe ? "Ты" : speaker.label }
        return speakerId == "me" ? "Ты" : "Собеседник " + speakerId
    }

    private func color(for speakerId: String?) -> Color {
        guard let speakerId else { return Color.secondary }
        if speakerId == detail.meSpeakerId || speakerId == "me" { return FeaturePalette.lime }
        let palette: [Color] = [FeaturePalette.lavender, FeaturePalette.cyan, FeaturePalette.pink, FeaturePalette.warning]
        let others = speakerOrder.filter { $0 != detail.meSpeakerId && $0 != "me" }
        let index = others.firstIndex(of: speakerId) ?? 0
        return palette[index % palette.count]
    }

    private func toggleDispute(_ segment: CallSegment) {
        Task { await store.setDisputed(callId: detail.id, segmentId: segment.id, disputed: !segment.disputed) }
    }
}

struct CallSegmentRow: View {
    let segment: CallSegment
    let speakerLabel: String
    let isMe: Bool
    let color: Color
    let highlighted: Bool
    let busy: Bool
    let onSeek: ((Double) -> Void)?
    let onToggleDispute: () -> Void
    @State private var showVerbatim = false

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                Circle().fill(color).frame(width: 8, height: 8).accessibilityHidden(true)
                Text(speakerLabel).font(.caption.weight(.semibold))
                Spacer(minLength: 6)
                if busy {
                    ProgressView().controlSize(.mini)
                } else if segment.disputed {
                    FeatureChip(text: "не так расслышано", icon: "ear", tint: FeaturePalette.warning)
                }
                CallTimeButton(at: segment.start, onSeek: onSeek)
            }
            Text(segment.text)
                .font(.body)
                .strikethrough(segment.disputed, color: .secondary)
                .foregroundStyle(segment.disputed ? Color.secondary : Color.primary)
                .textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)
            if isMe, let verbatim = segment.verbatim, !verbatim.isEmpty, verbatim != segment.text {
                DisclosureGroup("Дословно, с паузами и повторами", isExpanded: $showVerbatim) {
                    Text(verbatim)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .textSelection(.enabled)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.top, 4)
                }
                .font(.footnote)
            }
        }
        .padding(12)
        .padding(.leading, 4)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(highlighted ? color.opacity(0.25) : FeaturePalette.solid, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(alignment: .leading) {
            RoundedRectangle(cornerRadius: 2).fill(color).frame(width: 3).padding(.vertical, 10)
        }
        .contextMenu {
            if let start = segment.start, let onSeek {
                Button("Слушать отсюда", systemImage: "play") { onSeek(start) }
            }
            Button(segment.disputed ? "Снять отметку" : "Не так расслышано", systemImage: "ear") { onToggleDispute() }
            Button("Скопировать", systemImage: "doc.on.doc") { UIPasteboard.general.string = segment.text }
        }
        .accessibilityElement(children: .combine)
        .accessibilityAction(named: Text(segment.disputed ? "Снять отметку" : "Отметить: не так расслышано")) { onToggleDispute() }
    }
}
