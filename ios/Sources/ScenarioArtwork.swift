import SwiftUI
import UIKit

/// Decorative catalog artwork; families without a bundled asset retain their SF Symbol.
struct ScenarioArtwork: View {
    let familyID: String
    let symbol: String

    var body: some View {
        Group {
            if let artwork = UIImage(named: "scenario-\(familyID)-v1") {
                Image(uiImage: artwork)
                    .renderingMode(.original)
                    .resizable()
                    .scaledToFit()
            } else {
                Image(systemName: symbol)
                    .font(.body.weight(.medium))
                    .foregroundStyle(Theme.ink)
            }
        }
        .frame(width: 44, height: 44)
        .accessibilityHidden(true)
    }
}
