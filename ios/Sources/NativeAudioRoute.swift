import AVFoundation

/// Small thread-safe ownership clock; no audio API or main-thread wait occurs here.
/// A delayed release from an old player must never deactivate a newer microphone.
final class AudioSessionCommandOrder {
    private let lock = NSLock()
    private var generation = 0
    func reserve() -> Int {
        lock.lock(); defer { lock.unlock() }
        generation += 1
        return generation
    }
    func snapshot() -> Int {
        lock.lock(); defer { lock.unlock() }
        return generation
    }
    func isCurrent(_ owner: Int) -> Bool {
        lock.lock(); defer { lock.unlock() }
        return owner == generation
    }
    func reserveRelease(ifOwnedBy owner: Int?) -> Int? {
        lock.lock(); defer { lock.unlock() }
        if let owner, owner != generation { return nil }
        generation += 1
        return generation
    }
}

/// The recording engine and AVAudioPlayer hand ownership of one OS session to
/// each other. Never force a speaker route while an external output is selected.
enum NativeAudioRoute {
    private static let queue = DispatchQueue(label: "app.ratmirenglish.audio-session", qos: .userInitiated)
    private static let order = AudioSessionCommandOrder()
    static func hasExternalOutput(_ route: AVAudioSessionRouteDescription) -> Bool {
        hasExternalOutputTypes(route.outputs.map(\.portType))
    }
    static func hasExternalOutputTypes(_ ports: [AVAudioSession.Port]) -> Bool {
        ports.contains { $0 != .builtInSpeaker && $0 != .builtInReceiver }
    }
    static func needsReceiverRepair(_ ports: [AVAudioSession.Port]) -> Bool {
        !hasExternalOutputTypes(ports) && ports.contains(.builtInReceiver)
    }

    static func prepareCapture() async throws -> Int {
        try await configure { owner in
            let audio = AVAudioSession.sharedInstance()
            let external = hasExternalOutput(audio.currentRoute)
            try audio.setActive(false, options: .notifyOthersOnDeactivation)
            try checkOwner(owner)
            var options: AVAudioSession.CategoryOptions = [.allowBluetooth, .allowBluetoothA2DP]
            if !external { options.insert(.defaultToSpeaker) }
            try audio.setCategory(.playAndRecord, mode: .default, options: options)
            try audio.setPreferredSampleRate(48000)
            try checkOwner(owner)
            try audio.setActive(true)
        }
    }

    static func preparePlayback() async throws -> Int {
        try await configure { owner in
            let audio = AVAudioSession.sharedInstance()
            // A stopped mic must not leave the phone in a call/receiver configuration.
            try audio.setActive(false, options: .notifyOthersOnDeactivation)
            try checkOwner(owner)
            if audio.category == .playAndRecord { try audio.overrideOutputAudioPort(.none) }
            try audio.setCategory(.playback, mode: .default, options: [])
            try checkOwner(owner)
            try audio.setActive(true)
            try checkOwner(owner)
            try repairReceiverOnQueue(owner: owner)
        }
    }

    static func repairReceiverIfNeeded() async throws {
        let owner = order.snapshot()
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            queue.async {
                do {
                    try checkOwner(owner)
                    try repairReceiverOnQueue(owner: owner)
                    try checkOwner(owner)
                    continuation.resume()
                } catch { continuation.resume(throwing: error) }
            }
        }
    }

    private static func repairReceiverOnQueue(owner: Int) throws {
        let audio = AVAudioSession.sharedInstance()
        guard needsReceiverRepair(audio.currentRoute.outputs.map(\.portType)) else { return }
        // This is a fallback for an observed receiver route, never an unconditional
        // speaker override. A charger alone does not authorize taking over headphones.
        try audio.setActive(false, options: .notifyOthersOnDeactivation)
        try checkOwner(owner)
        try audio.setCategory(.playAndRecord, mode: .default, options: [.allowBluetooth, .allowBluetoothA2DP])
        try checkOwner(owner)
        try audio.setActive(true)
        try checkOwner(owner)
        if !hasExternalOutput(audio.currentRoute) { try audio.overrideOutputAudioPort(.speaker) }
    }

    static func deactivate(ifOwnedBy owner: Int? = nil) {
        guard let release = order.reserveRelease(ifOwnedBy: owner) else { return }
        queue.async {
            guard order.isCurrent(release) else { return }
            let audio = AVAudioSession.sharedInstance()
            try? audio.setActive(false, options: .notifyOthersOnDeactivation)
            if order.isCurrent(release), audio.category == .playAndRecord { try? audio.overrideOutputAudioPort(.none) }
        }
    }

    private static func checkOwner(_ owner: Int) throws {
        guard order.isCurrent(owner) else { throw CancellationError() }
    }

    private static func configure(_ operation: @escaping (Int) throws -> Void) async throws -> Int {
        let owner = order.reserve()
        return try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Int, Error>) in
                queue.async {
                    do {
                        try checkOwner(owner)
                        try operation(owner)
                        try checkOwner(owner)
                        continuation.resume(returning: owner)
                    } catch {
                        // The same serial queue performs any cleanup, but a stale
                        // configuration cannot release the next queued owner.
                        deactivate(ifOwnedBy: owner)
                        continuation.resume(throwing: error)
                    }
                }
            }
        } onCancel: { deactivate(ifOwnedBy: owner) }
    }

    static func outputLabel() -> String {
        let ports = AVAudioSession.sharedInstance().currentRoute.outputs
        if ports.isEmpty { return "Звук пока не запущен" }
        return ports.map { port in
            switch port.portType {
            case .builtInSpeaker: return "Динамик iPhone"
            case .builtInReceiver: return "Верхний динамик iPhone"
            case .headphones: return "Наушники"
            case .bluetoothA2DP, .bluetoothHFP, .bluetoothLE: return "Bluetooth"
            case .airPlay: return "AirPlay"
            case .usbAudio: return "USB-аудио"
            default: return "Внешний звук"
            }
        }.joined(separator: ", ")
    }
}
