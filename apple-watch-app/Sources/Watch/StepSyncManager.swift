import Foundation
import HealthKit

// Handles HealthKit queries and batched step sync to the backend.
// Mirror of the Garmin StepSync module: always re-syncs yesterday to capture the
// full-day count, then backfills any additional missed days (up to 7).
actor StepSyncManager {
    static let shared = StepSyncManager()

    private let healthStore = HKHealthStore()
    private let stepType = HKQuantityType(.stepCount)

    private let dateFormatter: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withFullDate]
        f.timeZone = .current
        return f
    }()

    // MARK: - Authorization

    func requestAuthorization() async -> Bool {
        guard HKHealthStore.isHealthDataAvailable() else { return false }
        do {
            try await healthStore.requestAuthorization(toShare: [], read: [stepType])
            return true
        } catch {
            return false
        }
    }

    // MARK: - Sync

    func sync(apiKey: String) async {
        guard !apiKey.isEmpty else { return }

        let today = isoString(daysAgo: 0)
        let lastSync = UserDefaults.standard.string(forKey: Constants.lastSyncDateKey)

        var entries: [StepEntry] = []

        // Backfill missed days (same logic as Garmin: missedDays >= 1 → re-sync yesterday + any gaps)
        let missed = daysBetween(from: lastSync ?? today, to: today)
        if missed >= 1 {
            let limit = min(missed, 7)
            for daysAgo in 1...limit {
                let dateStr = isoString(daysAgo: daysAgo)
                if let steps = await queryDailySteps(for: dateStr) {
                    entries.append(StepEntry(date: dateStr, steps: steps))
                }
            }
        }

        // Today's live count
        if let todaySteps = await queryDailySteps(for: today) {
            entries.append(StepEntry(date: today, steps: todaySteps))
        }

        guard !entries.isEmpty else { return }

        do {
            let payload = StepSyncPayload(dates: entries, api_key: apiKey)
            let url = URL(string: Constants.stepSyncURL)!
            var request = URLRequest(url: url)
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONEncoder().encode(payload)

            let (_, response) = try await URLSession.shared.data(for: request)
            if let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) {
                UserDefaults.standard.set(today, forKey: Constants.lastSyncDateKey)
            }
        } catch {
            // Silent failure; next background refresh will retry
        }
    }

    // MARK: - HealthKit queries

    private func queryDailySteps(for dateString: String) async -> Int? {
        guard let start = dateFormatter.date(from: dateString) else { return nil }
        let end = Calendar.current.date(byAdding: .day, value: 1, to: start)!

        let predicate = HKQuery.predicateForSamples(withStart: start, end: end, options: .strictStartDate)
        let descriptor = HKStatisticsQueryDescriptor(
            quantityType: stepType,
            predicate: predicate,
            options: .cumulativeSum
        )
        do {
            let result = try await descriptor.result(for: healthStore)
            let steps = result?.sumQuantity()?.doubleValue(for: .count()) ?? 0
            return Int(steps)
        } catch {
            return nil
        }
    }

    // MARK: - Date helpers

    private func isoString(daysAgo: Int) -> String {
        let date = Calendar.current.date(byAdding: .day, value: -daysAgo, to: Date()) ?? Date()
        return dateFormatter.string(from: date)
    }

    private func daysBetween(from earlier: String, to later: String) -> Int {
        guard let d1 = dateFormatter.date(from: earlier),
              let d2 = dateFormatter.date(from: later) else { return 0 }
        return max(0, Calendar.current.dateComponents([.day], from: d1, to: d2).day ?? 0)
    }
}
