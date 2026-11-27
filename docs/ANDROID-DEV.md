# Android development on this PC

The Android APK is debug-signed and built locally or in GitHub Actions. This page covers the local toolchain, phone debugging and the phone-size UI check.

## One-time setup

Requirements: Windows 10/11, the Android SDK command-line tools, Node 20+, Rust with the Android targets, and Microsoft Edge.

```powershell
.\scripts\android\setup.ps1
```

It downloads Temurin JDK 21 to `%LOCALAPPDATA%\Android\jdk-21`, installs `build-tools;37.0.0` and NDK r29 into `%LOCALAPPDATA%\Android\Sdk`, and installs Playwright Core for the UI check. Nothing is installed system-wide.

`.env.local` in the repo root must contain the real `TMDB` and `TRAKT` keys. The desktop build uses the same file; it is git-ignored. A build without it fails in `build.rs`.

Add `-Emulator` to install the emulator, an API 36 x86_64 image and a `filmie` AVD. The emulator is optional and slow on a laptop.

Each shell needs the toolchain on its PATH. The build/install scripts do this themselves; for manual commands:

```powershell
. .\scripts\android\env.ps1
```

It sets `ANDROID_HOME`, `JAVA_HOME`, `NDK_HOME` and `CARGO_PROFILE_DEV_DEBUG=0` (smaller debug APK, no Rust symbols).

## Build and install

```powershell
.\scripts\android\build.ps1                    # arm64 APK for a phone
.\scripts\android\build.ps1 -Install           # build, then install and open
.\scripts\android\build.ps1 -Target x86_64     # emulator image
```

The APK lands in `dist\android\Filmie-<target>-debug.apk`. The first `tauri android init` generates `src-tauri\gen\android`; it is git-ignored and safe to delete.

Install the newest APK by hand:

```powershell
.\scripts\android\install.ps1
```

If `adb install` reports `INSTALL_FAILED_UPDATE_INCOMPATIBLE`, the installed app was signed by the other toolchain (CI or local). Uninstall once, then install:

```powershell
.\scripts\android\install.ps1 -Uninstall
```

The CI build and a local build use different debug keys. After switching sources, the first install needs `-Uninstall`; after that, updates install over the same key.

## Debugging

### Phone over USB

1. Enable Developer options and USB debugging.
2. Connect the phone and accept the RSA prompt.
3. `.\scripts\android\install.ps1 -Uninstall` once.
4. `.\scripts\android\logcat.ps1` shows the app's logcat, including WebView `chromium` console errors. Add `-All` for every process, `-Clear` to start clean.

The app also has **Settings → Test connections**, which calls TMDB and Trakt and prints the exact result or error. Use it first for “no data” problems — it separates a bad key from a network/TLS failure.

### WebView DevTools

The debug WebView is inspectable from a Chromium browser. With the phone connected and the app open:

1. Open `edge://inspect/#devices` (or `chrome://inspect`).
2. Find `app.filmie` and choose **inspect**.
3. The DevTools console shows the UI errors; the network tab shows image loads. Rust API calls are IPC, so their errors appear in the page or in the connection test, not as web requests.

If the WebView is not listed, the app may not be a debug build, or another process holds the WebSocket; close and reopen the app.

### Rust/API logs

The app's HTTP requests are made in Rust. A failed `invoke` shows the error in the page that requested it; the connection test prints it directly. `adb logcat` also carries Rust stderr and the WebView console.

## Phone-size UI check

```powershell
npm --prefix scripts/android/ui run check
```

Renders `ui/` in Edge at 390×844 with `scripts/site-shots/mock.js` standing in for Tauri, and writes `artifacts/ui-phone/{home,discover,title,settings,search,lists}.png`. It catches layout regressions without a build or a phone. The data is mocked, so it does not test the API.

The script uses Microsoft Edge through `playwright-core`. If Edge is missing, run `npx playwright install chromium` and change the launch channel.

## Emulator (optional)

```powershell
.\scripts\android\setup.ps1 -Emulator
.\scripts\android\emulator.ps1
```

`emulator.ps1` builds the x86_64 APK, starts the `filmie` AVD with software rendering, waits for boot, then installs and opens the app. It prints `emulator -accel-check` first. If acceleration is unavailable, the emulator still runs but is very slow; WHPX/AEHD may need a Windows feature and a reboot. A physical arm64 phone is the recommended test target.

## How the toolchain maps to CI

| | Local | GitHub Actions |
|---|---|---|
| Keys | `.env.local` | repository secrets `TMDB`, `TRAKT`, `TRAKT_REDIRECT_URI` |
| JDK | `%LOCALAPPDATA%\Android\jdk-21` | Temurin 21 |
| SDK | platform 37.0, build-tools 37.0.0 | same |
| NDK | r29 `29.0.14206865` | same |
| Targets | aarch64 (phone), x86_64 (emulator) | aarch64 |
| Signing | `%USERPROFILE%\.android\debug.keystore` | cached `android-debug-keystore-v1` |
| Artifact | `dist\android\*.apk` | `filmie-android-debug` artifact |

## Notes and limits

- The Android UI is the phone layout below 720 px: bottom bar, full-width pages, no page title.
- Trakt has no platform keyring on Android, so the Trakt tokens and the MDBList key live in `secrets.json` in the app's private data dir. They survive a restart; **Settings → Sign out** still clears them.
- The Android back gesture closes the top drawer or dialog, then steps through the app's history, then leaves the app.
- Android TLS uses Mozilla's bundled roots (`tls_certs_only`) because `rustls-platform-verifier` is not initialized in this build. Desktop keeps the platform verifier.
- The APK is arm64 unless built with `-Target x86_64`; the emulator needs the x86_64 one.
- `src-tauri/extensions` is not bundled on Android (`tauri.android.conf.json` removes the desktop resource).
