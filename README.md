# Ratmir English

Open-source English conversation trainer with native SwiftUI and Windows clients and a private self-hosted backend. The application practises dialogue, provides feedback, and derives skill observations from the learner's own attempts. It does not certify a CEFR level or infer pronunciation from a transcript.

## Run locally

Use Node.js 24 or newer, then run npm ci, npm run build, and npm run start. The default address is http://127.0.0.1:3000. Set up your own profile in Settings. The generic source profile contains no learner history.

Text currently uses the locally authenticated Codex integration. Optional speech/transcription uses your own OpenAI API account and is billed separately. This source kit does not include credentials. Keep secrets in your private environment or data directory, never NEXT_PUBLIC variables.

Self-hosting can use Sign in with ChatGPT (SIWC) through a separately authorized VM identity. OAuth application display name: Ratmir English. Package/technical identifiers may use RatmirEnglish. Consent and a real strict gpt-6.1-sol request have been verified on a personal Linux VM. This does not imply OpenAI verification of the agent or universal model availability for other accounts; run the explicit probe for your account and do not substitute another model silently.

## Privacy and publication

This repository is code only. It excludes learner notes, recordings, SQLite databases, personal profile seeds, logs, screenshots, reference images, and Codex/OAuth/API credentials. Runtime data stays outside the public repository. On a shared host, configure private authentication and HTTPS before accepting remote users.

Windows runtime scripts support a hidden local supervisor. Use node scripts/start.mjs --check, --status, or --stop. Enable Autostart.cmd registers a task for the current user's next logon; Disable Autostart.cmd removes only the verified project task. Read the scripts before using them. Linux/server deployment has its own deployment review.

## Windows desktop companion

After npm run build, run npm run desktop:build on Windows x64. Install Desktop.cmd installs the per-user shell, configures this workspace and Node.js, and adds its own Windows Startup shortcut. Open Training.cmd launches it; Disable Desktop Autostart.cmd removes only that verified shortcut. The NSIS installer manages the desktop/Start menu shortcuts and uninstall entry. The application still needs this built workspace, Node.js 24+, an authenticated Codex, and internet; it is not a self-contained distribution for arbitrary machines.

The shell opens a greeting with a 5-minute or usual session, stays in the tray when its window closes, and exposes a small always-on-top coach with Ctrl+Alt+E. Clipboard text is read only when Paste is clicked. Quick explanations and retries use Sol but currently do not persist to history or award XP. The Electron renderer has no Node integration and is sandboxed. A remote desktop-config.json containing mode=remote and an exact HTTPS origin uses the VPS without a local Node/backend, with a separate authenticated cookie partition. Local mode still requires the built workspace and Node.js.

## Native iPhone app

See [ios/README.md](ios/README.md). SwiftUI screens use the same private backend and include text/voice practice, analysis and retry, progress, history, Keychain login and local reminders. GitHub Actions builds an unsigned IPA on a standard macOS runner; AltStore Classic signs it for a free personal Apple Account. Free profiles last seven days. Refresh requires contact with a computer running AltServer; ordinary training uses the VPS while that computer is off. Physical installation, microphone behavior and iOS compatibility still require device testing. The HTTPS web interface remains available too.

## Verification and license

Run npm run build before npm run typecheck. This export omits the private workspace's test/smoke scripts and source history. It is a review artifact, not a claim that hosted OAuth or every deployment path has passed end-to-end verification.

Our source code is licensed under MIT. Third-party packages keep their own licenses. No user-supplied visual reference is included or relicensed. The iOS icon is generated from our own lettermark drawing code during CI.

Only audited source files belong in this repository. Never add a private profile seed, SQLite database, recordings, server env file, SSH key or OAuth credentials. Publishing code does not publish private runtime data.
