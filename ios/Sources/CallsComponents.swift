import SwiftUI
import UIKit
import AVFoundation

// Shared kit for the 0.5 feature screens (placement test, calls, patterns, playbook).
// Tokens follow planning/v05/DESIGN-SYSTEM.md §2 in light and dark; nothing here forces a colour scheme.

// MARK: - Tokens

/// Feature-screen names for the shared DESIGN-SYSTEM tokens. Everything except `track` comes from
/// the shell's `Theme` (NativeDesign.swift), so a restyle there reaches these screens too.
enum FeaturePalette {
    /// bg.base
    static let base = Theme.base
    /// surface.solid — long reading (reviews, transcripts).
    static let solid = Theme.solid
    static let lime = Theme.lime
    static let lavender = Theme.lavender
    static let violet = Theme.violet
    static let cyan = Theme.cyan
    static let pink = Theme.pink
    static let warning = Theme.warning
    static let error = Theme.danger
    /// Readable "positive" text: lime itself is unreadable on light surfaces.
    static let success = Theme.limeInk
    static let hairline = Theme.hairline
    static let highlight = Theme.glassHighlight
    static let shadow = Theme.shadow
    /// Neutral fill for wells, bars and small tiles inside cards.
    static let track = Color(uiColor: UIColor { traits in
        traits.userInterfaceStyle == .dark
            ? UIColor(red: 245.0 / 255, green: 245.0 / 255, blue: 248.0 / 255, alpha: 0.12)
            : UIColor(red: 24.0 / 255, green: 23.0 / 255, blue: 28.0 / 255, alpha: 0.08)
    })
}

enum FeatureMotion {
    static let press = Animation.spring(response: 0.22, dampingFraction: 0.7)
    static let standard = Animation.spring(response: 0.38, dampingFraction: 0.82)
    static let bouncy = Animation.bouncy(duration: 0.5, extraBounce: 0.1)
    static let reveal = Animation.easeOut(duration: 0.32)
    static func stagger(_ index: Int) -> Animation { standard.delay(Double(min(max(index, 0), 6)) * 0.04) }
}

// MARK: - Materials

/// Glass for floating chrome and interactive tiles — the shell's `LiquidChrome` (Liquid Glass on
/// iOS 26+, material fallback earlier, solid with Reduce Transparency / Increase Contrast).
struct FeatureGlass: ViewModifier {
    var radius: CGFloat = 22
    var tint: Color? = nil
    var interactive = false

    func body(content: Content) -> some View {
        content.modifier(LiquidChrome(radius: radius, tint: tint, interactive: interactive))
    }
}

/// Solid reading surface (reviews, transcripts, passages). Never glass.
struct FeatureSurface: ViewModifier {
    var radius: CGFloat = 28
    var padding: CGFloat = 18
    func body(content: Content) -> some View {
        content
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(FeaturePalette.solid, in: RoundedRectangle(cornerRadius: radius, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: radius, style: .continuous)
                    .strokeBorder(FeaturePalette.hairline, lineWidth: 1).allowsHitTesting(false)
            }
    }
}

extension View {
    func featureGlass(radius: CGFloat = 22, tint: Color? = nil, interactive: Bool = false) -> some View {
        modifier(FeatureGlass(radius: radius, tint: tint, interactive: interactive))
    }
    func featureSurface(radius: CGFloat = 28, padding: CGFloat = 18) -> some View {
        modifier(FeatureSurface(radius: radius, padding: padding))
    }
    /// Reveal: opacity + 8 pt rise + blur 6→0, staggered 40 ms (max 6). Reduce Motion: shown at once.
    func featureReveal(_ index: Int = 0) -> some View { modifier(FeatureReveal(index: index)) }
}

struct FeatureReveal: ViewModifier {
    let index: Int
    @State private var shown = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    func body(content: Content) -> some View {
        content
            .opacity(shown || reduceMotion ? 1 : 0)
            .offset(y: shown || reduceMotion ? 0 : 8)
            .blur(radius: shown || reduceMotion ? 0 : 6)
            .onAppear {
                guard !shown else { return }
                if reduceMotion { shown = true } else { withAnimation(FeatureMotion.stagger(index)) { shown = true } }
            }
    }
}

/// The shell's ambient aurora (slow drift, static with Reduce Motion, solid with Reduce Transparency).
struct FeatureBackdrop: View {
    var body: some View {
        AmbientBackdrop()
    }
}

// MARK: - Small components

struct FeatureTileButtonStyle: ButtonStyle {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed && !reduceMotion ? 0.96 : 1)
            .animation(reduceMotion ? nil : FeatureMotion.press, value: configuration.isPressed)
    }
}

struct FeatureChip: View {
    let text: String
    var icon: String? = nil
    var tint: Color = FeaturePalette.lavender
    var body: some View {
        HStack(spacing: 4) {
            if let icon { Image(systemName: icon).imageScale(.small) }
            Text(text).lineLimit(1)
        }
        .font(.caption.weight(.semibold))
        .foregroundStyle(.primary)
        .padding(.horizontal, 10)
        .padding(.vertical, 5)
        .background(tint.opacity(0.24), in: Capsule())
        .overlay { Capsule().strokeBorder(tint.opacity(0.5), lineWidth: 1).allowsHitTesting(false) }
        .accessibilityElement(children: .combine)
    }
}

struct FeatureSectionTitle: View {
    let title: String
    var subtitle: String? = nil
    var icon: String? = nil
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 8) {
                if let icon { Image(systemName: icon).foregroundStyle(FeaturePalette.violet) }
                Text(title).font(.title3.weight(.semibold)).fontDesign(.rounded)
            }
            if let subtitle, !subtitle.isEmpty {
                Text(subtitle).font(.subheadline).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
    }
}

struct FeatureQuote: View {
    let text: String
    var timestamp: String? = nil
    var strike = false
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("“" + text + "”").font(.subheadline).italic().strikethrough(strike, color: .secondary)
                .foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                .textSelection(.enabled)
            if let timestamp {
                Text(timestamp).font(.caption.monospacedDigit()).foregroundStyle(.tertiary)
            }
        }
        .padding(.leading, 12)
        .overlay(alignment: .leading) { RoundedRectangle(cornerRadius: 2).fill(FeaturePalette.lavender).frame(width: 3) }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Цитата: " + text + (timestamp.map { ", " + $0 } ?? ""))
    }
}

struct FeatureBanner: View {
    enum Tone { case error, info, success }
    let message: String
    var tone: Tone = .error
    var actionTitle: String? = nil
    var action: (() -> Void)? = nil
    var onDismiss: (() -> Void)? = nil
    private var icon: String {
        switch tone {
        case .error: return "exclamationmark.triangle.fill"
        case .info: return "info.circle.fill"
        case .success: return "checkmark.circle.fill"
        }
    }
    private var tint: Color {
        switch tone {
        case .error: return FeaturePalette.error
        case .info: return FeaturePalette.violet
        case .success: return FeaturePalette.success
        }
    }
    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: icon).foregroundStyle(tint).font(.body.weight(.semibold)).accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 10) {
                Text(message).font(.subheadline).fixedSize(horizontal: false, vertical: true)
                if let actionTitle, let action {
                    Button(actionTitle, action: action).buttonStyle(QuietButton())
                }
            }
            Spacer(minLength: 0)
            if let onDismiss {
                Button(action: onDismiss) {
                    Image(systemName: "xmark").font(.footnote.weight(.semibold)).frame(width: 32, height: 32)
                }
                .buttonStyle(.plain)
                .foregroundStyle(.secondary)
                .accessibilityLabel("Скрыть сообщение")
            }
        }
        .padding(14)
        .featureGlass(radius: 20, tint: tint.opacity(0.4))
        .accessibilityElement(children: .contain)
    }
}

struct FeatureProgressBar: View {
    let value: Double
    var tint: Color = FeaturePalette.violet
    var height: CGFloat = 8
    var accessibilityText: String = ""
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    private var clamped: Double { value.isFinite ? min(1, max(0, value)) : 0 }
    var body: some View {
        GeometryReader { geometry in
            ZStack(alignment: .leading) {
                Capsule().fill(FeaturePalette.track)
                Capsule().fill(tint)
                    .frame(width: clamped > 0 ? max(height, geometry.size.width * CGFloat(clamped)) : 0)
            }
        }
        .frame(height: height)
        .animation(reduceMotion ? nil : FeatureMotion.standard, value: clamped)
        .accessibilityElement()
        .accessibilityLabel(accessibilityText.isEmpty ? "Прогресс" : accessibilityText)
    }
}

struct FeatureEmptyState: View {
    let icon: String
    let title: String
    let text: String
    var body: some View {
        VStack(spacing: 10) {
            Image(systemName: icon).font(.system(size: 30, weight: .medium)).foregroundStyle(FeaturePalette.violet)
                .accessibilityHidden(true)
            Text(title).font(.headline).multilineTextAlignment(.center)
            Text(text).font(.subheadline).foregroundStyle(.secondary).multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 24)
        .padding(.horizontal, 16)
        .accessibilityElement(children: .combine)
    }
}

/// Copies text with a short confirmation and a success haptic.
struct FeatureCopyButton: View {
    let text: String
    var title = "Скопировать"
    @State private var copied = 0
    @State private var showCopied = false
    var body: some View {
        Button {
            UIPasteboard.general.string = text
            copied += 1
            showCopied = true
        } label: {
            Label(showCopied ? "Скопировано" : title, systemImage: showCopied ? "checkmark" : "doc.on.doc")
        }
        .buttonStyle(QuietButton())
        .sensoryFeedback(.success, trigger: copied)
        .task(id: copied) {
            guard copied > 0 else { return }
            do { try await Task.sleep(for: .seconds(2)) } catch { return }
            showCopied = false
        }
        .accessibilityHint("Копирует текст в буфер обмена")
    }
}

// MARK: - Formatting (Russian)

@MainActor enum FeatureFormat {
    private static let isoFractional: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()
    private static let isoPlain = ISO8601DateFormatter()
    private static let isoDay: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withFullDate]
        return formatter
    }()
    private static let shortFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "ru_RU")
        formatter.setLocalizedDateFormatFromTemplate("d MMM")
        return formatter
    }()
    private static let longFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "ru_RU")
        formatter.setLocalizedDateFormatFromTemplate("d MMMM")
        return formatter
    }()
    private static let yearFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "ru_RU")
        formatter.setLocalizedDateFormatFromTemplate("d MMMM yyyy")
        return formatter
    }()
    private static let timeFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "ru_RU")
        formatter.dateFormat = "HH:mm"
        return formatter
    }()
    static let russian = Locale(identifier: "ru_RU")

    static func date(_ iso: String?) -> Date? {
        guard let iso, !iso.isEmpty else { return nil }
        return isoFractional.date(from: iso) ?? isoPlain.date(from: iso) ?? isoDay.date(from: String(iso.prefix(10)))
    }
    static func iso(_ date: Date) -> String { isoPlain.string(from: date) }
    /// "3 окт."
    static func shortDate(_ iso: String?) -> String? { date(iso).map { shortFormatter.string(from: $0) } }
    /// "3 октября" (adds the year when it is not the current one).
    static func longDate(_ iso: String?) -> String? {
        guard let value = date(iso) else { return nil }
        let sameYear = Calendar.current.component(.year, from: value) == Calendar.current.component(.year, from: Date())
        return sameYear ? longFormatter.string(from: value) : yearFormatter.string(from: value)
    }
    /// "Сегодня, 14:05" / "Вчера" / "3 окт."
    static func relative(_ iso: String?) -> String? {
        guard let value = date(iso) else { return nil }
        if Calendar.current.isDateInToday(value) { return "Сегодня, " + timeFormatter.string(from: value) }
        if Calendar.current.isDateInYesterday(value) { return "Вчера" }
        return shortFormatter.string(from: value)
    }
    /// Call timestamp "08:13" or "1:02:03".
    static func clock(_ seconds: Double?) -> String {
        guard let seconds, seconds.isFinite, seconds >= 0 else { return "—" }
        let total = FeatureNumber.int(seconds.rounded(.down)) ?? 0
        let hours = total / 3600, minutes = (total % 3600) / 60, secs = total % 60
        if hours > 0 { return String(format: "%d:%02d:%02d", hours, minutes, secs) }
        return String(format: "%02d:%02d", minutes, secs)
    }
    /// "14 мин" / "1 ч 05 мин" / "45 с"
    static func duration(_ seconds: Double?) -> String? {
        guard let seconds, seconds.isFinite, seconds > 0 else { return nil }
        let total = FeatureNumber.int(seconds) ?? 0
        if total < 60 { return "\(total) с" }
        let minutes = total / 60
        if minutes < 60 { return "\(minutes) мин" }
        return String(format: "%d ч %02d мин", minutes / 60, minutes % 60)
    }
    static func decimal(_ value: Double, digits: Int = 1) -> String {
        guard value.isFinite else { return "—" }
        return value.formatted(.number.locale(russian).precision(.fractionLength(0...max(0, digits))))
    }
    static func integer(_ value: Double) -> String {
        guard value.isFinite else { return "—" }
        return value.formatted(.number.locale(russian).precision(.fractionLength(0)))
    }
    static func money(_ value: Double, currency: String) -> String {
        let symbol = currency.uppercased() == "EUR" ? "€" : "$"
        return symbol + integer(value)
    }
    static func megabytes(_ bytes: Double) -> String {
        decimal(max(0, bytes) / 1_048_576, digits: bytes >= 100 * 1_048_576 ? 0 : 1) + " МБ"
    }
    static func plural(_ count: Int, _ one: String, _ few: String, _ many: String) -> String {
        let n10 = abs(count) % 10, n100 = abs(count) % 100
        if n10 == 1 && n100 != 11 { return one }
        if (2...4).contains(n10) && !(12...14).contains(n100) { return few }
        return many
    }
    /// "3 вопроса"
    static func count(_ value: Int, _ one: String, _ few: String, _ many: String) -> String {
        "\(value) " + plural(value, one, few, many)
    }
}

enum FeatureErrorText {
    /// Russian text that says what happened and what to do.
    static func describe(_ error: Error) -> String {
        if let urlError = error as? URLError {
            switch urlError.code {
            case .notConnectedToInternet, .networkConnectionLost, .dataNotAllowed, .internationalRoamingOff:
                return "Нет связи с интернетом. Проверь сеть и повтори."
            case .timedOut:
                return "Сервер долго не отвечает. Попробуй ещё раз чуть позже."
            case .cannotFindHost, .cannotConnectToHost, .dnsLookupFailed:
                return "Сервер недоступен. Проверь, что он запущен, и повтори."
            case .cancelled:
                return "Действие отменено."
            default:
                return "Не получилось связаться с сервером. Повтори ещё раз."
            }
        }
        if error is DecodingError { return "Сервер прислал данные в новом формате. Обнови приложение." }
        if error is CancellationError { return "Действие отменено." }
        let text = error.localizedDescription
        return text.isEmpty ? "Что-то пошло не так. Повтори ещё раз." : text
    }
    static func isCancellation(_ error: Error) -> Bool {
        if error is CancellationError { return true }
        if let urlError = error as? URLError, urlError.code == .cancelled { return true }
        return false
    }
}

// MARK: - Audio playback shared by listening clips, TTS lines and call audio

struct FeaturePlaybackEnd: Equatable {
    let key: String
    let completed: Bool
    let token: Int
}

private final class FeaturePlaybackDelegate: NSObject, AVAudioPlayerDelegate {
    let finished: (Bool) -> Void
    init(finished: @escaping (Bool) -> Void) { self.finished = finished }
    func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) { finished(flag) }
    func audioPlayerDecodeErrorDidOccur(_ player: AVAudioPlayer, error: Error?) { finished(false) }
}

/// One AVAudioPlayer at a time. Takes the shared audio session through NativeAudioRoute (the same
/// ownership clock TrainingClient uses) and releases it when playback ends. Owners call `stop()` on
/// disappear and on audio interruptions.
@MainActor final class FeatureAudioPlayer: ObservableObject {
    @Published private(set) var activeKey: String?
    @Published private(set) var loadingKey: String?
    @Published private(set) var isPlaying = false
    @Published private(set) var currentTime: Double = 0
    @Published private(set) var duration: Double = 0
    @Published private(set) var lastEnd: FeaturePlaybackEnd?
    @Published var error: String?

    private var player: AVAudioPlayer?
    private var delegate: FeaturePlaybackDelegate?
    private var owner: Int?
    private var ticker: Task<Void, Never>?
    private var generation = 0
    private var endToken = 0
    private var stopAt: Double?
    weak var client: TrainingClient?
    /// Playback level for the mascot's lip-sync (`MeasuredVoiceOrb(meter:mode: .speaking)`); read per frame, never observed.
    let meter = VoiceMeter()

    init(client: TrainingClient? = nil) { self.client = client }

    var progress: Double { duration > 0 ? min(1, max(0, currentTime / duration)) : 0 }
    func isActive(_ key: String) -> Bool { activeKey == key && (isPlaying || loadingKey == key) }

    /// Marks a key as loading while the caller downloads its bytes.
    func beginLoading(_ key: String) {
        stop()
        loadingKey = key
        error = nil
    }
    func cancelLoading(_ key: String) { if loadingKey == key { loadingKey = nil } }

    func play(data: Data, key: String, from offset: Double = 0, until end: Double? = nil) async {
        await launch(key: key, from: offset, until: end) { try AVAudioPlayer(data: data) }
    }

    func play(fileURL: URL, key: String, from offset: Double = 0, until end: Double? = nil) async {
        await launch(key: key, from: offset, until: end) { try AVAudioPlayer(contentsOf: fileURL) }
    }

    private func launch(key: String, from offset: Double, until end: Double?, make: () throws -> AVAudioPlayer) async {
        if client?.recording == true || client?.microphoneStarting == true {
            if loadingKey == key { loadingKey = nil }
            return
        }
        client?.stopSpeaking()
        release(notify: false)
        generation += 1
        let current = generation
        loadingKey = key
        activeKey = key
        error = nil
        do {
            let sessionOwner = try await NativeAudioRoute.preparePlayback()
            guard current == generation else { NativeAudioRoute.deactivate(ifOwnedBy: sessionOwner); return }
            owner = sessionOwner
            let audio = try make()
            audio.isMeteringEnabled = true
            audio.prepareToPlay()
            let safeStart = offset.isFinite ? max(0, min(audio.duration, offset)) : 0
            audio.currentTime = safeStart
            if let end, end.isFinite, end > safeStart { stopAt = min(audio.duration, end) } else { stopAt = nil }
            let playbackDelegate = FeaturePlaybackDelegate { @Sendable [weak self] completed in
                guard let strongSelf = self else { return }
                Task { @MainActor [strongSelf] in strongSelf.handleFinish(generation: current, completed: completed) }
            }
            audio.delegate = playbackDelegate
            delegate = playbackDelegate
            player = audio
            duration = audio.duration
            currentTime = safeStart
            guard audio.play() else { throw ClientError.message("Не удалось включить звук. Проверь громкость и повтори.") }
            loadingKey = nil
            isPlaying = true
            startTicker(generation: current)
        } catch is CancellationError {
            if current == generation { release(notify: false) }
        } catch {
            guard current == generation else { return }
            release(notify: false)
            self.error = FeatureErrorText.describe(error)
        }
    }

    /// Stops playback early (not counted as a completed listen).
    func stop() {
        guard activeKey != nil || loadingKey != nil || player != nil else { return }
        generation += 1
        release(notify: true)
    }

    func seek(to seconds: Double) {
        guard let player, seconds.isFinite else { return }
        player.currentTime = max(0, min(player.duration, seconds))
        currentTime = player.currentTime
    }

    private func handleFinish(generation finished: Int, completed: Bool) {
        guard finished == generation else { return }
        let key = activeKey
        ticker?.cancel(); ticker = nil
        player = nil; delegate = nil
        isPlaying = false
        meter.level = 0
        currentTime = completed ? duration : currentTime
        activeKey = nil; loadingKey = nil; stopAt = nil
        let sessionOwner = owner; owner = nil
        if let sessionOwner { NativeAudioRoute.deactivate(ifOwnedBy: sessionOwner) }
        if let key {
            endToken += 1
            lastEnd = FeaturePlaybackEnd(key: key, completed: completed, token: endToken)
        }
    }

    private func release(notify: Bool) {
        let key = activeKey
        ticker?.cancel(); ticker = nil
        player?.stop(); player = nil; delegate = nil
        let wasPlaying = isPlaying
        isPlaying = false
        meter.level = 0
        activeKey = nil; loadingKey = nil; stopAt = nil
        let sessionOwner = owner; owner = nil
        if let sessionOwner { NativeAudioRoute.deactivate(ifOwnedBy: sessionOwner) }
        if notify, wasPlaying, let key {
            endToken += 1
            lastEnd = FeaturePlaybackEnd(key: key, completed: false, token: endToken)
        }
    }

    private func startTicker(generation current: Int) {
        ticker?.cancel()
        ticker = Task { @MainActor [weak self] in
            while !Task.isCancelled {
                guard let self, current == self.generation, let player = self.player else { return }
                player.updateMeters()
                self.meter.level = min(1, max(0, Double((player.averagePower(forChannel: 0) + 55) / 55)))
                // Published time changes at most ~4 times a second: lists observing the player stay calm.
                if abs(player.currentTime - self.currentTime) >= 0.25 { self.currentTime = player.currentTime }
                if let stopAt = self.stopAt, player.currentTime >= stopAt {
                    self.handleFinish(generation: current, completed: true)
                    player.stop()
                    return
                }
                do { try await Task.sleep(for: .milliseconds(33)) } catch { return }
            }
        }
    }
}

/// Small round play/stop control used for TTS lines and clips.
struct FeaturePlayButton: View {
    let isPlaying: Bool
    let isLoading: Bool
    var label = "Прослушать"
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            ZStack {
                if isLoading {
                    ProgressView()
                } else {
                    Image(systemName: isPlaying ? "stop.fill" : "play.fill")
                        .font(.footnote.weight(.bold))
                        .contentTransition(.symbolEffect(.replace))
                }
            }
            .frame(width: 44, height: 44)
            .featureGlass(radius: 22, tint: FeaturePalette.cyan.opacity(0.6), interactive: true)
        }
        .buttonStyle(FeatureTileButtonStyle())
        .accessibilityLabel(isPlaying ? "Остановить" : label)
    }
}
