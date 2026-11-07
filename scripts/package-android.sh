#!/usr/bin/env bash
# Android APK. Default is a debug-signed APK (sideload with adb). It is not a Play release.
# Release signing inputs, values never printed:
#   ANDROID_KEY_ALIAS  ANDROID_KEY_PASSWORD  ANDROID_KEY_BASE64
set -euo pipefail
cd "$(dirname "$0")/.."

mode="debug"
install_sdk=0
for arg in "$@"; do
  case "$arg" in
    --debug) mode="debug" ;;
    --release) mode="release" ;;
    --install-sdk) install_sdk=1 ;;
    *)
      echo "Unknown argument: $arg" >&2
      echo "Usage: scripts/package-android.sh [--debug|--release] [--install-sdk]" >&2
      exit 2
      ;;
  esac
done

NDK_VERSION="${ANDROID_NDK_VERSION:-27.2.12479018}"
PLATFORM="${ANDROID_PLATFORM:-android-35}"
BUILD_TOOLS="${ANDROID_BUILD_TOOLS:-35.0.0}"
CMDLINE_URL="${ANDROID_CMDLINE_TOOLS_URL:-https://dl.google.com/android/repository/commandlinetools-linux-13114758_latest.zip}"

if [[ "$install_sdk" -eq 1 ]]; then
  sdk="${ANDROID_HOME:-$HOME/android-sdk}"
  mkdir -p "$sdk/cmdline-tools"
  if [[ ! -x "$sdk/cmdline-tools/latest/bin/sdkmanager" ]]; then
    tmp="$(mktemp)"
    curl -fsSL -o "$tmp" "$CMDLINE_URL"
    rm -rf "$sdk/cmdline-tools/latest"
    unzip -q "$tmp" -d "$sdk/cmdline-tools"
    mv "$sdk/cmdline-tools/cmdline-tools" "$sdk/cmdline-tools/latest"
    rm -f "$tmp"
  fi
  export ANDROID_HOME="$sdk"
  export ANDROID_SDK_ROOT="$sdk"
  yes | "$sdk/cmdline-tools/latest/bin/sdkmanager" --sdk_root="$sdk" --licenses >/dev/null || true
  "$sdk/cmdline-tools/latest/bin/sdkmanager" --sdk_root="$sdk" "platform-tools" "platforms;${PLATFORM}" "build-tools;${BUILD_TOOLS}" "ndk;${NDK_VERSION}"
fi

missing=0
if ! command -v java >/dev/null 2>&1; then
  echo "JDK 17 or newer is not on PATH."
  missing=1
fi
if [[ -z "${ANDROID_HOME:-}${ANDROID_SDK_ROOT:-}" && -d "$HOME/android-sdk" ]]; then
  export ANDROID_HOME="$HOME/android-sdk"
  export ANDROID_SDK_ROOT="$HOME/android-sdk"
fi
if [[ -z "${ANDROID_HOME:-}${ANDROID_SDK_ROOT:-}" ]]; then
  echo "ANDROID_HOME is unset. Re-run with --install-sdk or point it at an Android SDK."
  missing=1
else
  export ANDROID_HOME="${ANDROID_HOME:-$ANDROID_SDK_ROOT}"
  export ANDROID_SDK_ROOT="${ANDROID_SDK_ROOT:-$ANDROID_HOME}"
fi
if [[ -z "${NDK_HOME:-}" && -n "${ANDROID_HOME:-}" && -d "${ANDROID_HOME}/ndk/${NDK_VERSION}" ]]; then
  export NDK_HOME="${ANDROID_HOME}/ndk/${NDK_VERSION}"
fi
if [[ -z "${NDK_HOME:-}" || ! -d "${NDK_HOME}" ]]; then
  echo "NDK_HOME is unset. Expected ${ANDROID_HOME:-ANDROID_HOME}/ndk/${NDK_VERSION}."
  missing=1
fi
(
  cd src-tauri
  rustup show active-toolchain >/dev/null
  rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android
)
if [[ "$missing" -ne 0 ]]; then
  echo "Android prerequisites are incomplete. No APK was produced."
  exit 3
fi

version="$(node -p "require('./package.json').version")"
if [[ ! -d src-tauri/gen/android ]]; then
  npx tauri android init --ci
fi

mkdir -p packaging/out
if [[ "$mode" == "release" ]]; then
  if [[ -z "${ANDROID_KEY_ALIAS:-}" || -z "${ANDROID_KEY_PASSWORD:-}" || -z "${ANDROID_KEY_BASE64:-}" ]]; then
    echo "Release APK needs ANDROID_KEY_ALIAS, ANDROID_KEY_PASSWORD, and ANDROID_KEY_BASE64." >&2
    echo "This script does not generate a keystore. No release APK was produced." >&2
    exit 2
  fi
  node scripts/android-release-signing.mjs
  npx tauri android build --apk --target aarch64 --split-per-abi --ci
  label="release-signed"
else
  # Keep the debug APK installable without embedding full Rust debuginfo.
  # The signature is still the Android debug keystore, not a Play release key.
  CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_DEV_STRIP=symbols \
    npx tauri android build --debug --apk --target aarch64 --split-per-abi --ci
  label="debug-signed"
fi

copied=0
while IFS= read -r file; do
  kind="$(basename "$(dirname "$file")")"
  abi="$(basename "$(dirname "$(dirname "$file")")")"
  if [[ "$kind" != debug && "$kind" != release ]]; then
    abi="$kind"
  fi
  dest="packaging/out/MathScrap-${version}-android-${abi}-${label}.apk"
  cp "$file" "$dest"
  echo "artifact $dest"
  copied=1
done < <(find src-tauri/gen/android -type f -name '*.apk' ! -name '*-unsigned.apk' | sort)
if [[ "$mode" == "debug" && -f "$HOME/.android/debug.keystore" ]]; then
  tools="$(find "$ANDROID_HOME/build-tools" -mindepth 1 -maxdepth 1 -type d | sort | tail -1)"
  for apk in packaging/out/MathScrap-"${version}"-android-*-debug-signed.apk; do
    [[ -f "$apk" ]] || continue
    tmp="${apk}.unaligned"
    python3 scripts/compact-debug-apk.py "$apk" "$tmp"
    "$tools/zipalign" -f -p 4 "$tmp" "${apk}.aligned"
    "$tools/apksigner" sign --ks "$HOME/.android/debug.keystore" --ks-pass pass:android --key-pass pass:android --ks-key-alias androiddebugkey "${apk}.aligned"
    mv "${apk}.aligned" "$apk"
    rm -f "$tmp" "${apk}.idsig"
  done
fi
if [[ "$copied" -ne 1 ]]; then
  echo "The Android build finished but no APK was found." >&2
  exit 1
fi
node scripts/checksum-artifacts.mjs packaging/out
if [[ "$label" == "debug-signed" ]]; then
  echo "This APK is signed with the Android debug keystore. It can be sideloaded with adb install."
  echo "It is not a Play Store release and the debug certificate is not a production key."
else
  echo "This APK is signed with the keystore supplied through ANDROID_KEY_BASE64."
  echo "It was not uploaded to Play."
fi
