import AVFoundation

/// The recording engine and AVAudioPlayer hand ownership of one OS session to
/// each other. Never force a speaker route while an external output is selected.
enum NativeAudioRoute {
    static func hasExternalOutput(_ route: AVAudioSessionRouteDescription) -> Bool {
        hasExternalOutputTypes(route.outputs.map(\.portType))
    }
    static func hasExternalOutputTypes(_ ports: [AVAudioSession.Port]) -> Bool {
        ports.contains { $0 != .builtInSpeaker && $0 != .builtInReceiver }
    }
    static func needsReceiverRepair(_ ports: [AVAudioSession.Port]) -> Bool {
        !hasExternalOutputTypes(ports) && ports.contains(.builtInReceiver)
    }

    static func prepareCapture() throws {
        let audio = AVAudioSession.sharedInstance()
        let external = hasExternalOutput(audio.currentRoute)
        try audio.setActive(false, options: .notifyOthersOnDeactivation)
        var options: AVAudioSession.CategoryOptions = [.allowBluetooth, .allowBluetoothA2DP]
        if !external { options.insert(.defaultToSpeaker) }
        try audio.setCategory(.playAndRecord, mode: .default, options: options)
        try audio.setPreferredSampleRate(48000)
        try audio.setActive(true)
    }

    static func preparePlayback() throws {
        let audio = AVAudioSession.sharedInstance()
        // A stopped mic must not leave the phone in a call/receiver configuration.
        try audio.setActive(false, options: .notifyOthersOnDeactivation)
        if audio.category == .playAndRecord { try audio.overrideOutputAudioPort(.none) }
        try audio.setCategory(.playback, mode: .default, options: [])
        try audio.setActive(true)
        try repairReceiverIfNeeded()
    }

    static func repairReceiverIfNeeded() throws {
        let audio = AVAudioSession.sharedInstance()
        guard needsReceiverRepair(audio.currentRoute.outputs.map(\.portType)) else { return }
        // This is a fallback for an observed receiver route, never an unconditional
        // speaker override. A charger alone does not authorize taking over headphones.
        try audio.setActive(false, options: .notifyOthersOnDeactivation)
        try audio.setCategory(.playAndRecord, mode: .default, options: [.allowBluetooth, .allowBluetoothA2DP])
        try audio.setActive(true)
        if !hasExternalOutput(audio.currentRoute) { try audio.overrideOutputAudioPort(.speaker) }
    }

    static func deactivate() {
        let audio = AVAudioSession.sharedInstance()
        try? audio.setActive(false, options: .notifyOthersOnDeactivation)
        if audio.category == .playAndRecord { try? audio.overrideOutputAudioPort(.none) }
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
