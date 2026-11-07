#!/usr/bin/env bash
# Unsigned Windows NSIS installer and MathScrap.exe, built on Windows.
# Optional Authenticode inputs (never printed): WINDOWS_CERTIFICATE, WINDOWS_CERTIFICATE_PASSWORD.
# When those are imported into the runner certificate store, also set WINDOWS_CERTIFICATE_THUMBPRINT.
set -euo pipefail
cd "$(dirname "$0")/.."

os="$(uname -s)"
case "$os" in
  MINGW*|MSYS*|CYGWIN*) ;;
  *)
    echo "This machine is ${os}. A Windows EXE was not built here."
    echo "Build on Windows with: npm run pack:windows"
    echo "CI job: package.yml / windows, runner windows-latest."
    echo "The installer is unsigned unless a manual run imports WINDOWS_CERTIFICATE."
    echo "WebView2 must already be on the machine (Windows 11, and Windows 10 from version 1803). This package does not download it."
    exit 3
    ;;
esac

version="$(node -p "require('./package.json').version")"
mkdir -p packaging/out
args=(build --bundles nsis --ci)
if [[ -n "${WINDOWS_CERTIFICATE_THUMBPRINT:-}" ]]; then
  args+=(--config "{\"bundle\":{\"windows\":{\"certificateThumbprint\":\"${WINDOWS_CERTIFICATE_THUMBPRINT}\",\"digestAlgorithm\":\"sha256\",\"timestampUrl\":\"http://timestamp.digicert.com\"}}}")
  label="signed"
else
  label="unsigned"
  echo "No WINDOWS_CERTIFICATE_THUMBPRINT. Building an unsigned installer. Windows SmartScreen will warn."
fi

npx tauri "${args[@]}"

copied=0
while IFS= read -r file; do
  base="$(basename "$file")"
  dest="packaging/out/MathScrap-${version}-windows-x64-${label}-${base}"
  cp "$file" "$dest"
  echo "artifact $dest"
  copied=1
done < <(find src-tauri/target/release/bundle/nsis src-tauri/target/release -maxdepth 3 -type f \( -name '*.exe' -o -name '*.msi' \) 2>/dev/null || true)
if [[ "$copied" -ne 1 ]]; then
  echo "tauri build finished but no EXE was found." >&2
  exit 1
fi
node scripts/checksum-artifacts.mjs packaging/out
echo "Windows ${label} package is in packaging/out."
echo "Installable: yes, as an unsigned desktop program, unless label is signed."
echo "Not a Store submission."
