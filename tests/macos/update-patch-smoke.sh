#!/bin/sh
set -eu

UPDATER_PATH="${1:-}"
SCRATCH_DIRECTORY="${2:-${TMPDIR:-/tmp}}"

if [ -z "$UPDATER_PATH" ] || [ ! -f "$UPDATER_PATH" ]; then
  echo "Usage: $0 <path-to-updater.sh> [scratch-directory]" >&2
  exit 2
fi

TEST_ROOT="$(mktemp -d "$SCRATCH_DIRECTORY/update-patch-mac-smoke.XXXXXX")"
MOCK_BIN="$TEST_ROOT/bin"
INSTALL_APP="$TEST_ROOT/WebRevisionDesk.app"
PATCH_ROOT="$TEST_ROOT/patch"
ZIP_PATH="$TEST_ROOT/patch.zip"

cleanup() {
  rm -rf "$TEST_ROOT"
}
trap cleanup EXIT

mkdir -p "$MOCK_BIN"
# Mock 'open' command so the test does not launch an application instance
cat << 'EOF' > "$MOCK_BIN/open"
#!/bin/sh
exit 0
EOF
chmod +x "$MOCK_BIN/open"

# Construct initial .app bundle
APP_CONTENTS="$INSTALL_APP/Contents"
APP_MACOS="$APP_CONTENTS/MacOS"
APP_RESOURCES="$APP_CONTENTS/Resources"
INSTALLED_APP="$APP_RESOURCES/app"

mkdir -p "$APP_MACOS" "$INSTALLED_APP"
cat << 'EOF' > "$APP_MACOS/Electron"
#!/bin/sh
exit 0
EOF
chmod +x "$APP_MACOS/Electron"

cat << 'EOF' > "$APP_CONTENTS/Info.plist"
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleExecutable</key>
  <string>Electron</string>
  <key>CFBundleIdentifier</key>
  <string>jp.co.webrevisiondesk.app</string>
  <key>CFBundleName</key>
  <string>WebRevisionDesk</string>
  <key>CFBundleShortVersionString</key>
  <string>0.7.15</string>
  <key>CFBundleVersion</key>
  <string>0.7.15</string>
</dict>
</plist>
EOF

printf 'keep-runtime\n' > "$APP_RESOURCES/runtime.txt"
printf '{"name":"web-revision-desk","version":"0.7.15"}\n' > "$INSTALLED_APP/package.json"
printf 'old-code\n' > "$INSTALLED_APP/old-code.txt"

codesign --force --deep --sign - "$INSTALL_APP" >/dev/null 2>&1
codesign --verify --deep --strict "$INSTALL_APP"

# Construct patch package
PATCH_APP="$PATCH_ROOT/resources/app"
mkdir -p "$PATCH_APP/electron"
printf '{"name":"web-revision-desk","version":"0.7.16","main":"electron/main.mjs"}\n' > "$PATCH_APP/package.json"
printf '// patch payload\n' > "$PATCH_APP/electron/main.mjs"
printf 'new-code\n' > "$PATCH_APP/new-code.txt"

(
  cd "$PATCH_ROOT"
  zip -q -r "$ZIP_PATH" resources
)

SHA256="$(shasum -a 256 "$ZIP_PATH" | awk '{print $1}')"

# Completed dummy process for PID wait
/bin/sh -c 'exit 0' &
DUMMY_PID=$!
wait $DUMMY_PID || true

STAGED_UPDATER="$TEST_ROOT/updater.sh"
cp "$UPDATER_PATH" "$STAGED_UPDATER"
chmod +x "$STAGED_UPDATER"

set +e
PATH="$MOCK_BIN:$PATH" /bin/sh "$STAGED_UPDATER" \
  --process-id "$DUMMY_PID" \
  --install-path "$INSTALL_APP" \
  --zip-path "$ZIP_PATH" \
  --sha256 "$SHA256" \
  --patch \
  --expected-version "0.7.16"
UPDATER_RC=$?
set -e
if [ "$UPDATER_RC" -ne 0 ]; then
  echo "Error: updater.sh exited with $UPDATER_RC" >&2
  exit "$UPDATER_RC"
fi

# Verifications
if [ ! -f "$INSTALLED_APP/package.json" ]; then
  echo "Error: package.json missing after update" >&2
  exit 1
fi

NEW_VERSION="$(grep '"version"' "$INSTALLED_APP/package.json" | head -n 1 | sed -E 's/.*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/')"
if [ "$NEW_VERSION" != "0.7.16" ]; then
  echo "Error: Application version was not updated to 0.7.16 (found: $NEW_VERSION)" >&2
  exit 1
fi

if [ ! -f "$INSTALLED_APP/new-code.txt" ]; then
  echo "Error: New code payload was not installed" >&2
  exit 1
fi

if [ -f "$INSTALLED_APP/old-code.txt" ]; then
  echo "Error: Old code payload still exists" >&2
  exit 1
fi

if [ "$(cat "$APP_RESOURCES/runtime.txt")" != "keep-runtime" ]; then
  echo "Error: File outside app directory was modified" >&2
  exit 1
fi

PLIST_VERSION="$(/usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" "$APP_CONTENTS/Info.plist")"
if [ "$PLIST_VERSION" != "0.7.16" ]; then
  echo "Error: Info.plist CFBundleShortVersionString was not updated (found: $PLIST_VERSION)" >&2
  exit 1
fi

# Verify codesign is valid after patch
codesign --verify --deep --strict "$INSTALL_APP" || {
  echo "Error: Code signature verification failed after patch update" >&2
  exit 1
}

echo "macOS patch updater smoke test passed successfully."
