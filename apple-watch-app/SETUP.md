# Apple Watch App — Setup Guide

## What's here

```
Sources/
  Watch/    — standalone watchOS app (SwiftUI, watchOS 9+)
  iOS/      — optional companion iPhone app for easier API key setup
```

---

## 1. Create the Xcode project

1. **File → New → Project → iOS → App** (not watchOS — an iOS container lets you publish to App Store and use WatchConnectivity)
   - Product name: `CaminoDeMountDoom`
   - Bundle ID: `com.yourname.caminomountdoom`
   - Interface: SwiftUI, Language: Swift
   - Uncheck tests

2. **Add a watchOS target**
   - File → New → Target → watchOS → Watch App
   - Name: `CaminoDeMountDoom Watch App`
   - Same bundle prefix: `com.yourname.caminomountdoom.watchkitapp`
   - Tick "Is companion to existing iOS app"

3. **Add source files**
   - Drag all `Sources/Watch/*.swift` into the watchOS target
   - Drag all `Sources/iOS/*.swift` into the iOS target (replace generated ContentView)
   - Delete the stub files Xcode generated for each target

---

## 2. Capabilities & entitlements

### watchOS target

In Signing & Capabilities:

| Capability | Notes |
|------------|-------|
| HealthKit | Tick "Clinical Health Records" OFF, everything else default |
| Background Modes | Tick **Background App Refresh** |

### iOS target

| Capability | Notes |
|------------|-------|
| (none required) | WatchConnectivity works without a special entitlement |

---

## 3. Info.plist keys

### watchOS `Info.plist`

```xml
<!-- HealthKit read permission description -->
<key>NSHealthShareUsageDescription</key>
<string>Camino de Mount Doom reads your daily step count to track your journey progress.</string>

<!-- Background fetch -->
<key>WKBackgroundModes</key>
<array>
    <string>workout-processing</string>
    <string>background-app-refresh</string>
</array>

<!-- Required for standalone watch app -->
<key>WKRunsIndependentlyOfCompanionApp</key>
<true/>
```

### watchOS `Entitlements.entitlements`

```xml
<key>com.apple.developer.healthkit</key>
<true/>
<key>com.apple.developer.healthkit.access</key>
<array/>
```

---

## 4. App settings — how the API key gets to the watch

### Option A: In-watch entry (standalone, no iPhone app needed)

1. Open the Camino app on Apple Watch
2. Tap the **gear icon** → Settings
3. Tap the API key field → system picker opens (dictation, scribble, or keyboard)
4. **Best flow**: On iPhone, open the web app → Profile → copy the API key → it goes to Universal Clipboard → on watch, long-press the key field → Paste

Universal Clipboard (same Apple ID on both devices, Bluetooth and WiFi on) moves the clipboard from iPhone to watch seamlessly. This is the recommended standalone path.

### Option B: iOS companion app (easier, recommended)

1. Install both the watch app and iOS companion on paired devices
2. Open iOS companion → paste API key → tap "Send to Apple Watch"
3. `WCSession.transferUserInfo` delivers it to the watch even if the watch is asleep; the watch app picks it up next time it runs

---

## 5. Screen flow

```
ContentView (root)
  ├─ [no API key]        ErrorView "No API key / Configure in Settings"
  ├─ [sharing off]       ErrorView "Enable step sharing in Settings"
  ├─ [loading]           ProgressView
  ├─ [error]             ErrorView with message
  ├─ [no groups]         ErrorView "No groups / Join one in the web app"
  └─ GroupPagerView      horizontal TabView (.page style)
       ├─ GroupPageView  per group: name · days on road · top-4 members · "Tap for details"
       │    └─ tap →  MemberDetailContainerView (horizontal TabView, starts on current user)
       │                   └─ MemberDetailView: name · progress bar · % · last-week Δ · ahead/behind · next checkpoint
       └─ WebAppPageView   "Open on iPhone" button
```

Gear icon on every screen opens **SettingsView** (API key TextField + sharing toggle).

---

## 6. Sync logic

Mirrors the Garmin app exactly:

- `StepSyncManager.sync()` runs hourly via `WKApplication.scheduleBackgroundRefresh`
- Reads `last_sync_date` from `UserDefaults`; if `today > lastSync`, backfills up to 7 missed days from HealthKit history
- Always sends today's live step count
- On HTTP 2xx: writes today's date as `last_sync_date`
- On failure: silent; retries next scheduled run

HealthKit authorization is requested once on first foreground launch and re-used in background.

---

## 7. Testing without a physical watch

### Xcode Simulator

All UI, navigation, and API calls work in the watchOS Simulator (no HealthKit data).
To simulate steps: use **Xcode → Debug → Simulate Location** is for GPS; for steps, inject manually:

```swift
// Temporary: in StepSyncManager.queryDailySteps(), return a stub when running in Simulator
#if targetEnvironment(simulator)
return 8500
#endif
```

Remove before shipping.

### Testing on your friend's watch

You need a paid **Apple Developer Program** membership ($99/year) to:
- Register your friend's device (Settings → Privacy → Developer Mode, grab UDID)
- Add their device to your provisioning profile in the developer portal
- Build with that profile → Xcode can install over USB or via wireless pairing

OR use **TestFlight** (same $99 account):
1. Archive the app (Product → Archive)
2. Distribute via TestFlight in App Store Connect
3. Add your friend as an external tester with their Apple ID
4. They install via the TestFlight app on their iPhone; it pushes the watch app automatically

TestFlight is the cleanest path for remote testing — no USB needed, and the friend manages it through the TestFlight app.

### Free developer account (no $99)

A free Apple ID lets you sideload to **your own devices only** with a 7-day provisioning profile. You cannot distribute to others without the paid account.

---

## 8. App Store submission

**Cost**: Apple Developer Program = $99/year (one-time annual fee, not per app).

**Requirements**:
- The watch app is bundled inside the iOS container app — both go in the same `.ipa`
- App Store Connect: create an app record, upload the archive, add screenshots for both iPhone and Apple Watch (watchOS 7+ watch screenshots are required)
- Review time: typically 1–3 days for updates, up to a week for new apps
- watchOS apps don't need a separate store listing; they appear under the iOS app on the App Store

**Standalone watch app** (no iOS app shown at all): Apple allows this since watchOS 7. You submit just the watchOS target. But since we already have an iOS companion, submitting both together is recommended and simpler.

---

## 9. Checklist before first build

- [ ] Replace bundle IDs in both targets with your real reversed-domain prefix
- [ ] Add your Apple Developer team in Signing & Capabilities
- [ ] Add HealthKit + Background Modes capabilities to the watchOS target
- [ ] Add `NSHealthShareUsageDescription` and background mode keys to watchOS `Info.plist`
- [ ] Set `WKRunsIndependentlyOfCompanionApp = true` if you want it to work without the iPhone app
- [ ] Confirm `Constants.stepSyncURL` and `Constants.groupDataURL` match your Supabase project
- [ ] Test sync manually: run app → go to Settings → paste a real API key → check Supabase `step_logs` table
