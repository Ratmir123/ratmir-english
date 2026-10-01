# Ratmir English

Source-only review candidate for a private English conversation trainer. The application practises dialogue, provides feedback, and derives skill observations from the learner's own attempts. It does not certify a CEFR level or infer pronunciation from a transcript.

## Run locally

Use Node.js 24 or newer, then run npm ci, npm run build, and npm run start. The default address is http://127.0.0.1:3000. Set up your own profile in Settings. The generic source profile contains no learner history.

Text currently uses the locally authenticated Codex integration. Optional speech/transcription uses your own OpenAI API account and is billed separately. This source kit does not include credentials. Keep secrets in your private environment or data directory, never NEXT_PUBLIC variables.

The Sign in with ChatGPT implementation is a review candidate. OAuth application display name: Ratmir English (with a space). Package/technical brand identifiers may use RatmirEnglish. Do not claim that this application is registered, approved, or that its hosted login has been verified until those checks are complete.

## Privacy and publication

This repository is code only. It excludes learner notes, recordings, SQLite databases, personal profile seeds, logs, screenshots, reference images, and Codex/OAuth/API credentials. Runtime data stays outside the public repository. On a shared host, configure private authentication and HTTPS before accepting remote users.

Windows runtime scripts support a hidden local supervisor. Use node scripts/start.mjs --check, --status, or --stop. Enable Autostart.cmd registers a task for the current user's next logon; Disable Autostart.cmd removes only the verified project task. Read the scripts before using them. Linux/server deployment has its own deployment review.

## Windows desktop companion

After npm run build, run npm run desktop:build on Windows x64. Install Desktop.cmd installs the per-user shell, configures this workspace and Node.js, and adds its own Windows Startup shortcut. Open Training.cmd launches it; Disable Desktop Autostart.cmd removes only that verified shortcut. The NSIS installer manages the desktop/Start menu shortcuts and uninstall entry. The application still needs this built workspace, Node.js 24+, an authenticated Codex, and internet; it is not a self-contained distribution for arbitrary machines.

The shell opens a greeting with a 5-minute or usual session, stays in the tray when its window closes, and exposes a small always-on-top coach with Ctrl+Alt+E. Clipboard text is read only when Paste is clicked. Quick explanations and retries use Sol but currently do not persist to history or award XP. An explicit 30-minute notification works while the shell stays running; OS notification delivery and a microphone call need device verification. The Electron renderer has no Node integration, is sandboxed, and loads only the local trainer.

The iPhone path remains a home-screen web app after private HTTPS deployment. A Windows tray application does not make a powered-off PC available remotely.

## Verification and license

Run npm run build before npm run typecheck. This export omits the private workspace's test/smoke scripts and source history. It is a review artifact, not a claim that hosted OAuth or every deployment path has passed end-to-end verification.

MIT is the proposed license for our source code; inspect LICENSE and confirm contributor ownership before publication. Third-party packages keep their own licenses. No user-supplied visual reference is included or relicensed. App icons, including the Windows ICO conversion, must be checked for authorship during review.

Creating this folder does not create a public repository or grant permission to publish it. Review the source, license, dependency licenses, generic configuration, and OAuth app details; obtain explicit approval for the exact public destination and commit.
