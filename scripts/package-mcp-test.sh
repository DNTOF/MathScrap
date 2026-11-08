#!/usr/bin/env bash
# Unsigned Windows test build of the packaged MCP listener.
# This does not sign, does not create a GitHub Release, and does not use the
# official app identifier. It is not v0.0.1.
set -euo pipefail
cd "$(dirname "$0")/.."

os="$(uname -s)"
case "$os" in
  MINGW*|MSYS*|CYGWIN*) ;;
  *)
    echo "This machine is ${os}. A Windows test EXE was not built here."
    echo "CI workflow mcp-test-build / windows-mcp-test builds it and uploads a CI artifact."
    echo "That upload is not a GitHub Release."
    exit 3
    ;;
esac

unset WINDOWS_CERTIFICATE WINDOWS_CERTIFICATE_PASSWORD WINDOWS_CERTIFICATE_THUMBPRINT || true
export MATHSCRAP_MCP_PROFILE=mcptest

npx tauri build --config src-tauri/tauri.mcptest.json --no-bundle --ci
cargo build --manifest-path src-tauri/Cargo.toml --release --bin mathscrap-mcp

mkdir -p packaging/out
rm -f packaging/out/MathScrap-mcp-test-windows-x64.exe packaging/out/mathscrap-mcp.exe packaging/out/SHA256SUMS packaging/out/PROVENANCE.txt
cp src-tauri/target/release/mathscrap-mcp-test.exe packaging/out/MathScrap-mcp-test-windows-x64.exe
cp src-tauri/target/release/mathscrap-mcp.exe packaging/out/mathscrap-mcp.exe

cat > packaging/out/PROVENANCE.txt <<EOF
source=$(git rev-parse HEAD)
profile=mcptest
product=MathScrap MCP Test
identifier=app.mathscrap.mcptest
version=0.0.2-dev
signed=no
github_release=no
official_v0.0.1=no
transport=stdio helper to 127.0.0.1 only
session_dir=%LOCALAPPDATA%\\MathScrap-mcptest\\mcp
EOF
node scripts/checksum-artifacts.mjs packaging/out
echo "Test build is in packaging/out. It is unsigned and it is not a release."
