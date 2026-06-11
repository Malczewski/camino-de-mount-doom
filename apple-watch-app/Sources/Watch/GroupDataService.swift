import Foundation

enum GroupDataService {
    enum FetchError: LocalizedError {
        case unauthorized
        case server(Int)

        var errorDescription: String? {
            switch self {
            case .unauthorized: return "Invalid API key"
            case .server(let code): return "Server error \(code)"
            }
        }
    }

    static func fetchGroups(apiKey: String) async throws -> GroupDataResponse {
        let url = URL(string: Constants.groupDataURL)!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: ["api_key": apiKey])

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }

        if http.statusCode == 401 { throw FetchError.unauthorized }
        guard (200..<300).contains(http.statusCode) else { throw FetchError.server(http.statusCode) }

        return try JSONDecoder().decode(GroupDataResponse.self, from: data)
    }
}
