import Foundation

enum Constants {
    static let stepSyncURL = "https://wpkwqhbrvphjppfquqby.supabase.co/functions/v1/step-sync"
    static let groupDataURL = "https://wpkwqhbrvphjppfquqby.supabase.co/functions/v1/get-group-data"
    static let webAppURL = "https://camino-de-mount-doom.netlify.app"
    static let syncInterval: TimeInterval = 3600
    static let apiKeyStorageKey = "api_key"
    static let shareStepsKey = "share_steps"
    static let lastSyncDateKey = "last_sync_date"
    static let backgroundTaskIdentifier = "com.caminomountdoom.stepsync"
}
