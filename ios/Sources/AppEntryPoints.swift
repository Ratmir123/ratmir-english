import SwiftUI
import UIKit
import AppIntents

// iPhone entry points of «Запомнить» (planning/v05/PASS-0.5.3.md §1.7): the Home Screen quick action «Запомнить фразу»
// (`UIApplicationShortcutItems` in project.yml, cold and warm launch) and the App Intent «Запомнить фразу» (Siri, Shortcuts —
// including the Share Sheet through a shortcut — and the Action button). Both only queue the capture sheet; the shell
// presents it right after the launch hand-off, once signed in. No new entitlements.

extension Notification.Name {
    /// The quick action or the App Intent asked for the capture sheet (the root turns it into the sheet when it can).
    static let smoothTalkCapturePhrase = Notification.Name("smooth-talk-capture-phrase")
}

/// Requests to open the phrases sheet from outside the shell. Kept until the root can present them (signed in, the launch
/// layer gone, no placement test on screen), so a cold launch or a signed-out phone loses nothing.
@MainActor final class AppEntryInbox {
    static let shared = AppEntryInbox()
    /// `UIApplicationShortcutItemType` of «Запомнить фразу» (ios/project.yml).
    static let captureShortcutType = "app.ratmirenglish.capture"

    private(set) var pending: PhraseSheetRoute?

    func request(_ route: PhraseSheetRoute) {
        pending = route
        NotificationCenter.default.post(name: .smoothTalkCapturePhrase, object: nil)
    }

    /// The capture sheet, prefilled with a shared text when there is one (clipped to 600 characters).
    func requestCapture(text: String?) {
        let clean = text.map { PhraseLabels.insert("", $0).text } ?? ""
        request(.captureSheet(clean.isEmpty ? nil : clean))
    }

    /// A Home Screen quick action; false for any other item.
    @discardableResult func handle(_ item: UIApplicationShortcutItem) -> Bool {
        guard item.type == Self.captureShortcutType else { return false }
        requestCapture(text: nil)
        return true
    }

    func take() -> PhraseSheetRoute? {
        defer { pending = nil }
        return pending
    }

    func clear() { pending = nil }
}

// MARK: - Quick action

/// A cold launch from the quick action brings the item with the scene connection; a warm one arrives at the scene delegate.
/// SwiftUI keeps its own window: the scene delegate below only adds the quick action callback (it never implements
/// `scene(_:willConnectTo:options:)`). The Objective-C selectors are spelled out so UIKit finds them whatever the SDK's
/// concurrency annotations on the completion handlers are.
@MainActor final class SmoothTalkAppDelegate: NSObject, UIApplicationDelegate {
    @objc(application:configurationForConnectingSceneSession:options:)
    func application(_ application: UIApplication, configurationForConnecting connectingSceneSession: UISceneSession,
                     options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        if let item = options.shortcutItem { AppEntryInbox.shared.handle(item) }
        let configuration = UISceneConfiguration(name: connectingSceneSession.configuration.name,
                                                 sessionRole: connectingSceneSession.role)
        configuration.delegateClass = SmoothTalkSceneDelegate.self
        return configuration
    }

    @objc(application:performActionForShortcutItem:completionHandler:)
    func application(_ application: UIApplication, performActionFor shortcutItem: UIApplicationShortcutItem,
                     completionHandler: @escaping (Bool) -> Void) {
        completionHandler(AppEntryInbox.shared.handle(shortcutItem))
    }
}

/// Warm launch: the app was in the background when «Запомнить фразу» was chosen on the Home Screen.
@MainActor final class SmoothTalkSceneDelegate: NSObject, UIWindowSceneDelegate {
    @objc(windowScene:performActionForShortcutItem:completionHandler:)
    func windowScene(_ windowScene: UIWindowScene, performActionFor shortcutItem: UIApplicationShortcutItem,
                     completionHandler: @escaping (Bool) -> Void) {
        completionHandler(AppEntryInbox.shared.handle(shortcutItem))
    }
}

// MARK: - App Intent

/// «Запомнить фразу»: opens Smooth Talk on the capture sheet, prefilled with `text` when a shortcut passes one.
struct CapturePhraseIntent: AppIntent {
    static let title: LocalizedStringResource = "Запомнить фразу"
    static let openAppWhenRun: Bool = true

    @Parameter(title: "Текст")
    var text: String?

    init() {}

    init(text: String?) {
        self.text = text
    }

    @MainActor
    func perform() async throws -> some IntentResult {
        AppEntryInbox.shared.requestCapture(text: text)
        return .result()
    }
}

/// Siri and Spotlight phrase; Shortcuts and the Action button list the same intent.
struct SmoothTalkAppShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(intent: CapturePhraseIntent(), phrases: ["Запомнить фразу в \(.applicationName)"],
                    shortTitle: "Запомнить фразу", systemImageName: "text.badge.plus")
    }
}

// MARK: - Presentation

/// Puts the phrases sheet over the shell and turns queued entries into it: after the launch hand-off, never over the placement
/// test, and a lesson on screen is minimised first (it stays one tap away above the tab bar; a recording is never cut).
/// «Повторить» inside the sheet starts its round once the sheet is gone, so the lesson sheet can present.
@MainActor struct PhraseSheetsHost: ViewModifier {
    /// The launch layer (waiting, greeting or hand-off) still covers the shell.
    let launchCovering: Bool
    @EnvironmentObject private var client: TrainingClient
    @ObservedObject private var store: PhrasesStore

    init(launchCovering: Bool) {
        self.launchCovering = launchCovering
        _store = ObservedObject(wrappedValue: PhrasesStore.shared)
    }

    /// Changes whenever a queued entry might become presentable.
    private var entryKey: String {
        [client.signedIn, launchCovering, client.conversationPresented, client.placementPresented, client.recording,
         client.microphoneStarting, client.error == nil, store.route == nil].map { $0 ? "1" : "0" }.joined()
    }

    func body(content: Content) -> some View {
        content
            .sheet(item: $store.route, onDismiss: sheetClosed) { route in
                PhrasesSheet(route: route)
                    .environmentObject(client)
                    .environment(\.locale, RuFormat.locale)
#if DEBUG
                    .modifier(PreviewAccessibility())
#endif
            }
            .onReceive(NotificationCenter.default.publisher(for: .smoothTalkCapturePhrase)) { _ in adoptEntry() }
            .task(id: entryKey) {
                do { try await Task.sleep(for: .milliseconds(PhraseTiming.settleMilliseconds)) } catch { return }
                adoptEntry()
            }
            .onChange(of: client.signedIn) { _, signedIn in
                if !signedIn { store.reset() }
            }
    }

    private func adoptEntry() {
        guard let request = AppEntryInbox.shared.pending else { return }
        guard client.signedIn, !launchCovering, !client.placementPresented, client.error == nil else { return }
        if client.conversationPresented {
            guard !client.recording, !client.microphoneStarting else { return }
            client.minimizeConversation(keepMoment: true)
            return
        }
        if case .list = request, store.route != nil {
            // «Мои фразы» is already one tap away in the open sheet.
            AppEntryInbox.shared.clear()
            return
        }
        AppEntryInbox.shared.clear()
        store.route = request
    }

    private func sheetClosed() {
        guard let mode = store.takePendingRound() else { return }
        Task { await client.startPhraseRound(mode: mode) }
    }
}
