param(
  [Parameter(Mandatory = $true)][int]$ProcessId,
  [Parameter(Mandatory = $true)][string]$InstallDirectory,
  [Parameter(Mandatory = $true)][string]$ZipPath,
  [Parameter(Mandatory = $true)][string]$Sha256,
  [Parameter(Mandatory = $true)][string]$ExecutableName,
  [Parameter(Mandatory = $false)][string]$TemporaryScriptPath = "",
  [Parameter(Mandatory = $false)][string]$TemporaryLauncherPath = ""
)

$ErrorActionPreference = "Stop"
$parent = Split-Path -Parent $InstallDirectory
$stage = Join-Path $parent (".WebRevisionDesk-update-" + [guid]::NewGuid())
$backup = Join-Path $parent (".WebRevisionDesk-backup-" + [guid]::NewGuid())
$logDirectory = Join-Path $env:LOCALAPPDATA "WebRevisionDesk\logs"
$logPath = Join-Path $logDirectory "updater.log"

function Write-UpdaterLog([string]$Message) {
  try {
    New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
    Add-Content -LiteralPath $logPath -Encoding UTF8 -Value ("{0:o} {1}" -f (Get-Date), $Message)
  } catch {}
}

function Show-UpdateError([string]$Message) {
  try {
    Add-Type -AssemblyName PresentationFramework
    [System.Windows.MessageBox]::Show(
      $Message,
      "Web Revision Desk",
      [System.Windows.MessageBoxButton]::OK,
      [System.Windows.MessageBoxImage]::Error
    ) | Out-Null
  } catch {}
}

function Get-Sha256([string]$Path) {
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try {
    return ([System.BitConverter]::ToString($sha.ComputeHash([System.IO.File]::ReadAllBytes($Path)))).Replace("-", "")
  } finally {
    $sha.Dispose()
  }
}

try {
  Write-UpdaterLog "更新処理を開始しました。インストール先: $InstallDirectory"
  $deadline = (Get-Date).AddSeconds(60)
  while (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue) {
    if ((Get-Date) -gt $deadline) { throw "アプリケーションの終了待機がタイムアウトしました。" }
    Start-Sleep -Milliseconds 500
  }
  Write-UpdaterLog "アプリケーションの終了を確認しました。"
  if ((Get-Sha256 $ZipPath).ToLowerInvariant() -ne $Sha256.ToLowerInvariant()) {
    throw "更新ファイルのSHA-256が一致しません。"
  }
  Write-UpdaterLog "更新ファイルのSHA-256を確認しました。"
  New-Item -ItemType Directory -Path $stage | Out-Null
  Expand-Archive -LiteralPath $ZipPath -DestinationPath $stage -Force
  # Current archives contain a stable WebRevisionDesk/ top-level directory.
  # Accept the earlier root-level format too so upgrades from old releases work.
  $payload = Join-Path $stage "WebRevisionDesk"
  if (-not (Test-Path -LiteralPath (Join-Path $payload $ExecutableName))) { $payload = $stage }
  if (-not (Test-Path -LiteralPath (Join-Path $payload $ExecutableName))) { throw "更新ファイルに実行ファイルがありません。" }
  Write-UpdaterLog "更新ファイルを展開しました。配置元: $payload"
  Move-Item -LiteralPath $InstallDirectory -Destination $backup
  try {
    Move-Item -LiteralPath $payload -Destination $InstallDirectory
  } catch {
    if ((Test-Path -LiteralPath $backup) -and -not (Test-Path -LiteralPath $InstallDirectory)) {
      Move-Item -LiteralPath $backup -Destination $InstallDirectory
    }
    throw
  }
  Remove-Item -LiteralPath $backup -Recurse -Force
  Write-UpdaterLog "更新ファイルをインストール先へ配置しました。"
  Start-Process -FilePath (Join-Path $InstallDirectory $ExecutableName) -WorkingDirectory $InstallDirectory
  Write-UpdaterLog "更新後のアプリケーションを起動しました。"
} catch {
  $message = "Web Revision Desk の更新に失敗しました: $($_.Exception.Message)"
  Write-UpdaterLog $message
  Show-UpdateError "$message`n`nログ: $logPath"
  Write-Error $message
} finally {
  if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue }
  if ($TemporaryScriptPath -and (Test-Path -LiteralPath $TemporaryScriptPath)) {
    Remove-Item -LiteralPath $TemporaryScriptPath -Force -ErrorAction SilentlyContinue
  }
  if ($TemporaryLauncherPath -and (Test-Path -LiteralPath $TemporaryLauncherPath)) {
    Remove-Item -LiteralPath $TemporaryLauncherPath -Force -ErrorAction SilentlyContinue
  }
}
