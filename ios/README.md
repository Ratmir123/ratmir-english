# iPhone client — Smooth Talk 0.5

Native SwiftUI client, iOS 17+ (Liquid Glass on iOS 26+), sharing the private HTTPS backend with the PC app. Communication coaching practised in English; the interface is Russian. Light and dark themes follow the system.

Five tabs, identical to the PC version: **Сегодня** (one next step chosen in a fixed order: unsent recording → placement test → unfinished lesson or review → call waiting for the speaker → personal drill → the server's plan; quick actions, level, patterns, weekly rhythm), **Практика** (personal drills and the scenario catalog from `GET /api/families`), **Созвоны** (call upload, reviews and patterns), **Прогресс** (placement level, rank and XP, skills, history, rewards) and **Профиль** (profile, playbook facts, voice, reminders, limits, data, version).

Lessons keep the v0.4 safeguards: microphone recording with live subtitles, review of the transcript before sending, the original WAV kept until it reaches the server (an unsent recording can always be played or deleted from Today), voice playback with lip-sync on the mascot, analysis, the required improved attempt and an optional pushback round. Starting a lesson, sending an answer or completing never waits for status or quota reads. No Apple password, OpenAI key or ChatGPT credentials are embedded in the app or CI.

CI captures synthetic screens (`--preview=<screen>`) on an iPhone 11 simulator in light, dark and large type, and runs the native tests. Preview fixtures are compiled only in Debug; the Release IPA has no sample profile. Simulator screenshots do not verify physical microphone capture, audio routing or local notification delivery.

The macOS GitHub Actions job builds an unsigned device IPA. AltStore Classic on Windows signs this IPA with the owner's free Apple Account. This is a personal installation, not App Store distribution. Build success is distinct from installation and a physical-device microphone test.

1. Install AltServer and its Apple dependencies using the [official Windows instructions](https://faq.altstore.io/altstore-classic/how-to-install-altstore-windows). Connect the unlocked iPhone by USB and trust the computer.
2. Install AltStore through AltServer. Enter Apple Account credentials only in that installation flow. Enable Developer Mode if requested, and trust the app profile on the phone.
3. Download the successful workflow artifact, unzip it, transfer `RatmirEnglish.ipa` to Files on iPhone, and import it with AltStore's My Apps + button while AltServer is reachable.
4. Enter the private server HTTPS origin and access code in the native app. Access is kept in Keychain; lesson data remains on the private server.
5. Refresh before seven days elapse. AltStore tries automatic refresh when it can reach a computer running AltServer over the same Wi-Fi network or USB. A Linux VPS cannot perform this device signing connection. Training itself does not need the PC on.

The app uses local reminders, not APNs remote push. Free signing has capability limits. A later paid Apple Developer membership can change the installation/distribution route; server history does not depend on the signing team. A team/bundle ID change can require logging in again, so do not rely on local Keychain contents migrating.

Do not remove an expired app just to refresh its signature. Follow AltStore's recovery instructions. iOS compatibility and hardware behavior must be verified on the actual device; a CI build alone does not establish them.

Sources: [Apple Personal Team limits](https://developer.apple.com/help/account/basics/about-your-developer-account), [AltServer refresh conditions](https://faq.altstore.io/altstore-classic/altserver), [GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions).
