Build and optionally install the Android APK.

Usage: /build-android [dev] [install]

Arguments (space-separated, order doesn't matter): `$ARGUMENTS`
- "dev": Build dev variant (applicationId: com.myClaudia.desktop.dev, name: "MyClaudia Dev")
- "install": Install APK to connected device after building
- Both can be combined: `/build-android dev install`

## Steps

1. Parse arguments from: `$ARGUMENTS`
   - Contains "dev" → add `--dev` flag
   - Contains "install" → add `--install` flag

2. Ask the user for the keystore password if not provided, then run the build script with `KEYSTORE_PASS`:
   ```bash
   KEYSTORE_PASS=<password> ./scripts/build-android.sh [--dev] [--install]
   ```

   Examples:
   ```bash
   # Release build only:
   KEYSTORE_PASS=<password> ./scripts/build-android.sh

   # Dev build only:
   KEYSTORE_PASS=<password> ./scripts/build-android.sh --dev

   # Release build + install:
   KEYSTORE_PASS=<password> ./scripts/build-android.sh --install

   # Dev build + install:
   KEYSTORE_PASS=<password> ./scripts/build-android.sh --dev --install
   ```

3. The script handles everything:
   - Preflight checks (JDK, Android SDK, NDK, Rust targets)
   - Version bump (unless `--no-bump`)
   - Tauri Android build (passes `-PisDev=true` to Gradle for dev)
   - APK signing with dedicated keystore (release or dev)
   - Optional device installation

4. Report the result:
   - APK location (my-claudia.apk or my-claudia-dev.apk)
   - File size
   - Install status (if --install was used)

## Dev vs Release

| | Release | Dev |
|--|---------|-----|
| applicationId | `com.myClaudia.desktop` | `com.myClaudia.desktop.dev` |
| App name | MyClaudia | MyClaudia Dev |
| APK name | my-claudia.apk | my-claudia-dev.apk |
| Coexist | Yes — different applicationId, both can be installed simultaneously |

## Signing

- Release: `~/.android/my-claudia-release.keystore` (alias: `my-claudia-release`)
- Dev: `~/.android/my-claudia-dev.keystore` (alias: `my-claudia-dev`)
- Password passed via `KEYSTORE_PASS` environment variable
- Keystore path and alias can be overridden with `KEYSTORE` and `KEY_ALIAS` env vars

## Notes

- Build runs locally (requires Android SDK, NDK, JDK 17, Rust targets)
- The build script auto-detects macOS vs Linux environment
- APK output: `apps/desktop/src-tauri/gen/android/app/build/outputs/apk/universal/release/`
