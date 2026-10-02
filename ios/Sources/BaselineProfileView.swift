import SwiftUI

struct NativeBaselineProfile: View {
    let report: BaselineReport?
    @EnvironmentObject private var client: TrainingClient
    private var buildingProfile: Bool { client.busy && client.operationStage == "Собираю твой стартовый профиль" }
    var body: some View {
        if let report { reportContent(report) }
        else {
            SurfaceCard {
                VStack(alignment: .leading, spacing: 14) {
                    InputLabel(title: "Стартовый профиль")
                    Text("Три разговора пройдены.").font(.title3.weight(.semibold))
                    Text("Соберём наблюдения об английском и самом разговоре. Практику уже можно продолжать.")
                        .font(.subheadline).foregroundStyle(Theme.secondary)
                    Button { Task { await client.buildBaselineReport() } } label: {
                        HStack { Text(buildingProfile ? "Собираем стартовый профиль" : "Показать стартовый профиль"); Spacer(); Image(systemName: "arrow.right") }
                    }.buttonStyle(PrimaryButton()).disabled(client.busy)
                    if buildingProfile {
                        ActivityPanel(title: "Собираем стартовый профиль", detail: "Сравниваем три разговора и выбираем, что тренировать первым.", startedAt: client.operationStartedAt)
                    }
                }
            }
        }
    }
    private func reportContent(_ report: BaselineReport) -> some View {
        SurfaceCard {
            VStack(alignment: .leading, spacing: 20) {
                InputLabel(title: "Стартовый профиль. Предварительная оценка")
                Text("Отсюда начнём расти.").font(.title2.weight(.semibold))
                Text(report.summary).font(.subheadline).fixedSize(horizontal: false, vertical: true)
                if let cefr = report.cefr {
                    VStack(alignment: .leading, spacing: 10) {
                        Text(cefr.from == cefr.to ? cefr.from : cefr.from + "–" + cefr.to)
                            .font(.system(.title, design: .rounded).weight(.semibold))
                        Text("Предварительный диапазон CEFR").font(.caption.weight(.medium))
                        Text(cefr.scope).font(.subheadline)
                        Text(cefr.reason).font(.footnote).foregroundStyle(Theme.secondary)
                        Text("Это не результат сертификационного экзамена.").font(.caption).foregroundStyle(Theme.secondary)
                    }.padding(18).frame(maxWidth: .infinity, alignment: .leading)
                        .background(Theme.lavender, in: RoundedRectangle(cornerRadius: 22))
                } else {
                    Text("Пока недостаточно оснований для диапазона CEFR. Ниже есть наблюдения по конкретным навыкам.")
                        .font(.footnote).foregroundStyle(Theme.secondary)
                }
                priorities(report.priorities)
                DisclosureGroup {
                    VStack(alignment: .leading, spacing: 20) {
                        ForEach(report.skills) { observation in observationView(observation) }
                    }.padding(.top, 12)
                } label: { Text("На чём основана оценка").font(.subheadline.weight(.medium)) }
                DisclosureGroup {
                    VStack(alignment: .leading, spacing: 12) {
                        Text(report.languageVsCommunication.observation).font(.subheadline)
                        Text(report.languageVsCommunication.russianQuote).font(.subheadline).foregroundStyle(Theme.secondary)
                            .padding(15).frame(maxWidth: .infinity, alignment: .leading).background(Theme.surface.opacity(0.5), in: RoundedRectangle(cornerRadius: 17))
                        Text(report.languageVsCommunication.limitation).font(.footnote).foregroundStyle(Theme.secondary)
                    }.padding(.top, 12)
                } label: { Text("Английский и привычки разговора").font(.subheadline.weight(.medium)) }
                DisclosureGroup {
                    VStack(alignment: .leading, spacing: 10) {
                        ForEach(Array(report.limitations.enumerated()), id: \.offset) { _, limitation in Text(limitation).font(.footnote).foregroundStyle(Theme.secondary) }
                    }.padding(.top, 12)
                } label: { Text("Что пока нельзя оценить").font(.subheadline.weight(.medium)) }
                VStack(alignment: .leading, spacing: 8) {
                    Text("Следующий шаг").font(.caption.weight(.semibold))
                    Text(report.nextFocus).font(.subheadline)
                }.padding(18).frame(maxWidth: .infinity, alignment: .leading).background(Theme.lime.opacity(0.65), in: RoundedRectangle(cornerRadius: 22))
            }
        }
    }
    private func priorities(_ values: [String]) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("С чего начинаем").font(.headline)
            ForEach(Array(values.enumerated()), id: \.offset) { index, value in
                HStack(alignment: .top, spacing: 10) {
                    Text(String(index + 1)).font(.caption.weight(.semibold)).frame(width: 25, height: 25).background(Theme.lavender.opacity(0.4), in: Circle())
                    Text(value).font(.subheadline)
                }
            }
        }
    }
    private func observationView(_ value: BaselineReport.Observation) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(skillLabel(value.skill)).font(.subheadline.weight(.semibold))
            Text(value.confidence == "unobserved" ? "Не наблюдалось" : value.confidence == "limited" ? "Пока мало данных" : "Несколько согласованных наблюдений")
                .font(.caption).foregroundStyle(Theme.secondary)
            Text(value.observation).font(.subheadline)
            ForEach(Array(value.evidence.enumerated()), id: \.offset) { _, evidence in
                Button {
                    if let source = client.state?.sessions.first(where: { $0.id == evidence.sessionId }) { client.resume(source) }
                } label: {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(evidence.quote).font(.subheadline).multilineTextAlignment(.leading)
                        Label("Открыть исходную попытку", systemImage: "arrow.up.right").font(.caption).foregroundStyle(Theme.secondary)
                    }.padding(15).frame(maxWidth: .infinity, alignment: .leading).background(Theme.surface.opacity(0.5), in: RoundedRectangle(cornerRadius: 18))
                }.buttonStyle(PressButton()).disabled(client.busy || client.recording)
            }
        }
    }
    private func skillLabel(_ id: String) -> String {
        ["listening": "Понимание на слух", "vocabulary": "Активный английский", "grammar": "Построение фраз", "clarity": "Понятность речи", "coherence": "Содержание и логика", "reciprocity": "Использование услышанного", "initiative": "Управление разговором", "repair": "Уточнение и восстановление"][id] ?? id
    }
}
