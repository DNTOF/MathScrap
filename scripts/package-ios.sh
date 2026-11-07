#!/usr/bin/env bash
# iOS Simulator .app, or a signed IPA when Apple signing inputs are present.
# This script never enrolls in the Apple Developer Program and never creates a certificate.
set -euo pipefail
cd "$(dirname "$0")/.."

target="simulator"
for arg in "$@"; do
  case "$arg" in
    --simulator) target="simulator" ;;
    --device) target="device" ;;
    *)
      echo "Unknown argument: $arg" >&2
      echo "Usage: scripts/package-ios.sh [--simulator|--device]" >&2
      exit 2
      ;;
  esac
done

if [[ "$(uname -s)" != "Darwin" ]]; then
  cat <<'EOF'
This machine is not macOS. No IPA and no iOS Simulator build were produced.

An installable iPhone package needs all of the following, which are not on this Linux builder:

1. A Mac with macOS 12 or newer.
2. Full Xcode 15 or newer (the App Store app, not only Command Line Tools).
   Open Xcode once, then: sudo xcodebuild -license accept
   xcode-select -s /Applications/Xcode.app/Contents/Developer
3. Rust iOS targets:
   rustup target add aarch64-apple-ios aarch64-apple-ios-sim x86_64-apple-ios
4. CocoaPods: brew install cocoapods
5. Node 22 and this repo: npm ci

What each command actually produces:

- npm run pack:ios -- --simulator
  Runs `tauri ios build --debug` for the Apple silicon simulator.
  Output is a .app for the iOS Simulator. It is not an IPA and will not install on an iPhone.

- A development install on your own phone uses a free Apple ID added in
  Xcode > Settings > Accounts, with automatic signing on Personal Team.
  That signature lasts about 7 days and is not a distributable IPA.
  This repository does not collect that Apple ID.

- A distributable IPA (Ad Hoc, TestFlight, or App Store) needs the paid
  Apple Developer Program, which this task does not enroll in or purchase.
  When you already have the certificate and profile, put only these names
  in the CI environment or your shell. Do not commit the values:
    IOS_CERTIFICATE            base64 of the .p12 exported from Keychain
    IOS_CERTIFICATE_PASSWORD
    IOS_MOBILE_PROVISION       base64 of the .mobileprovision
  Optional automatic signing instead of the three above:
    APPLE_API_ISSUER
    APPLE_API_KEY
    APPLE_API_KEY_PATH         path to the AuthKey .p8 already on that Mac
  Then: npm run pack:ios -- --device

Minimum OS for the packaged shell is iOS 16.4 (WebAssembly SIMD for CoMER).
The bundle id is app.mathscrap. It must match the App ID inside the profile.
EOF
  exit 3
fi

if ! command -v xcodebuild >/dev/null 2>&1; then
  echo "xcodebuild is missing. Install full Xcode and point xcode-select at it." >&2
  exit 3
fi
rustup target add aarch64-apple-ios aarch64-apple-ios-sim x86_64-apple-ios
if [[ ! -d src-tauri/gen/apple ]]; then
  npx tauri ios init --ci
fi

version="$(node -p "require('./package.json').version")"
mkdir -p packaging/out

if [[ "$target" == "simulator" ]]; then
  npx tauri ios build --debug --target aarch64-sim --ci
  echo "Simulator build finished. Search src-tauri/gen/apple for the .app."
  echo "This is not an IPA and is not installable on an iPhone."
  find src-tauri/gen/apple -name '*.app' -type d | head -20
  exit 0
fi

signed=0
if [[ -n "${IOS_CERTIFICATE:-}" && -n "${IOS_CERTIFICATE_PASSWORD:-}" && -n "${IOS_MOBILE_PROVISION:-}" ]]; then
  signed=1
elif [[ -n "${APPLE_API_ISSUER:-}" && -n "${APPLE_API_KEY:-}" && -n "${APPLE_API_KEY_PATH:-}" ]]; then
  signed=1
fi
if [[ "$signed" -ne 1 ]]; then
  echo "Refusing to export an IPA. Signing inputs are absent, so the result would not be an installable device package." >&2
  echo "See the prerequisite list printed on a non-Mac run of this script." >&2
  exit 2
fi

method="${IOS_EXPORT_METHOD:-release-testing}"
case "$method" in
  app-store-connect|release-testing|debugging) ;;
  *)
    echo "IOS_EXPORT_METHOD must be app-store-connect, release-testing, or debugging." >&2
    exit 2
    ;;
esac
npx tauri ios build --export-method "$method" --ci
while IFS= read -r file; do
  dest="packaging/out/MathScrap-${version}-ios-$(basename "$file")"
  cp "$file" "$dest"
  echo "artifact $dest"
done < <(find src-tauri/gen/apple -type f -name '*.ipa' | sort)
node scripts/checksum-artifacts.mjs packaging/out
echo "If an IPA was copied above, it was signed with the provided profile. It was not uploaded to App Store Connect or TestFlight."
