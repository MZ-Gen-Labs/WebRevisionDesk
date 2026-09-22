#!/bin/sh
set -eu

PROCESS_ID=""
INSTALL_PATH=""
ZIP_PATH=""
EXPECTED_SHA256=""
TEMPORARY_SCRIPT_PATH=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --process-id) PROCESS_ID="$2"; shift 2 ;;
    --install-path) INSTALL_PATH="$2"; shift 2 ;;
    --zip-path) ZIP_PATH="$2"; shift 2 ;;
    --sha256) EXPECTED_SHA256="$2"; shift 2 ;;
    --temporary-script-path) TEMPORARY_SCRIPT_PATH="$2"; shift 2 ;;
    *) exit 2 ;;
  esac
done

LOG_DIRECTORY="$HOME/Library/Logs/WebRevisionDesk"
LOG_PATH="$LOG_DIRECTORY/updater.log"
STAGE="$(mktemp -d "${TMPDIR:-/tmp}/WebRevisionDesk-update.XXXXXX")"
BACKUP="${INSTALL_PATH}.backup-$$"

log() { mkdir -p "$LOG_DIRECTORY"; printf '%s %s\n' "$(date '+%Y-%m-%dT%H:%M:%S%z')" "$1" >> "$LOG_PATH"; }
fail() {
  if [ -n "$ZIP_PATH" ] && [ -f "$ZIP_PATH" ]; then
    : > "$ZIP_PATH.retry" 2>/dev/null || true
  fi
  log "更新に失敗しました: $1"
  osascript -e "display alert \"Web Revision Desk\" message \"更新に失敗しました: $1\\n\\nログ: $LOG_PATH\" as critical" >/dev/null 2>&1 || true
  exit 1
}
cleanup() { rm -rf "$STAGE"; [ -n "$TEMPORARY_SCRIPT_PATH" ] && rm -f "$TEMPORARY_SCRIPT_PATH"; }
trap cleanup EXIT

log "更新処理を開始しました。インストール先: $INSTALL_PATH"
deadline=$(( $(date +%s) + 60 ))
while kill -0 "$PROCESS_ID" 2>/dev/null; do
  [ "$(date +%s)" -le "$deadline" ] || fail "アプリケーションの終了待機がタイムアウトしました。"
  sleep 1
done
actual_sha256="$(shasum -a 256 "$ZIP_PATH" | awk '{print $1}')"
[ "$(printf '%s' "$actual_sha256" | tr '[:upper:]' '[:lower:]')" = "$(printf '%s' "$EXPECTED_SHA256" | tr '[:upper:]' '[:lower:]')" ] || fail "更新ファイルのSHA-256が一致しません。"
unzip -q "$ZIP_PATH" -d "$STAGE" || fail "更新ファイルを展開できません。"
PAYLOAD="$STAGE/WebRevisionDesk.app"
[ -d "$PAYLOAD" ] || PAYLOAD="$(find "$STAGE" -maxdepth 2 -type d -name WebRevisionDesk.app -print -quit)"
[ -n "$PAYLOAD" ] && [ -d "$PAYLOAD" ] || fail "更新ファイルにWebRevisionDesk.appがありません。"
mv "$INSTALL_PATH" "$BACKUP" || fail "旧版を退避できません。"
if ! mv "$PAYLOAD" "$INSTALL_PATH"; then
  mv "$BACKUP" "$INSTALL_PATH" || true
  fail "新版を配置できません。"
fi
rm -rf "$BACKUP"
log "更新を適用しました。再起動します。"
open -n "$INSTALL_PATH" || fail "更新後のアプリを起動できません。"
if ! rm -f "$ZIP_PATH" "$ZIP_PATH.retry"; then
  log "適用済みの更新ファイルを削除できませんでした。"
else
  log "適用済みの更新ファイルを削除しました。"
fi
