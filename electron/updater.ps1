param(
  [Parameter(Mandatory = $true)][int]$ProcessId,
  [Parameter(Mandatory = $true)][string]$InstallDirectory,
  [Parameter(Mandatory = $true)][string]$ZipPath,
  [Parameter(Mandatory = $true)][string]$Sha256,
  [Parameter(Mandatory = $true)][string]$ExecutableName,
  [Parameter(Mandatory = $false)][switch]$Patch,
  [Parameter(Mandatory = $false)][string]$ExpectedVersion = "",
  [Parameter(Mandatory = $false)][string]$TemporaryScriptPath = "",
  [Parameter(Mandatory = $false)][string]$TemporaryLauncherPath = ""
)

$ErrorActionPreference = "Stop"
$parent = Split-Path -Parent $InstallDirectory
$stage = Join-Path $parent (".WebRevisionDesk-update-" + [guid]::NewGuid())
$backup = Join-Path $parent (".WebRevisionDesk-backup-" + [guid]::NewGuid())
$uninstallerBackup = Join-Path $stage ".uninstaller"
$replacementTarget = ""
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
  if ($Patch) {
    $payload = Join-Path $stage "resources\app"
    $targetApp = Join-Path $InstallDirectory "resources\app"
    $packagePath = Join-Path $payload "package.json"
    if (-not (Test-Path -LiteralPath (Join-Path $InstallDirectory $ExecutableName))) {
      throw "差分更新の対象となるインストール先を確認できません。"
    }
    if ((-not (Test-Path -LiteralPath $packagePath)) -or (-not (Test-Path -LiteralPath (Join-Path $payload "electron\main.mjs")))) {
      throw "差分更新ファイルにアプリケーション本体がありません。"
    }
    $patchPackage = [System.IO.File]::ReadAllText($packagePath) | ConvertFrom-Json
    if ($ExpectedVersion -and $patchPackage.version -ne $ExpectedVersion) {
      throw "差分更新ファイルのバージョンが一致しません。"
    }
    if (-not (Test-Path -LiteralPath $targetApp)) { throw "差分更新の配置先が見つかりません。" }
    $replacementTarget = $targetApp
    Write-UpdaterLog "差分更新ファイルを展開しました。アプリコードのみを置き換えます。"
  } else {
    # An Inno Setup installation keeps its uninstaller in the app directory.
    # Preserve it while replacing the portable application payload.
    $uninstallerFiles = Get-ChildItem -LiteralPath $InstallDirectory -Filter "unins*" -File -ErrorAction SilentlyContinue
    if ($uninstallerFiles) {
      New-Item -ItemType Directory -Path $uninstallerBackup | Out-Null
      $uninstallerFiles | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $uninstallerBackup -Force }
    }
    # Current archives contain a stable WebRevisionDesk/ top-level directory.
    # Accept the earlier root-level format too so upgrades from old releases work.
    $payload = Join-Path $stage "WebRevisionDesk"
    if (-not (Test-Path -LiteralPath (Join-Path $payload $ExecutableName))) { $payload = $stage }
    if (-not (Test-Path -LiteralPath (Join-Path $payload $ExecutableName))) { throw "更新ファイルに実行ファイルがありません。" }
    $replacementTarget = $InstallDirectory
    Write-UpdaterLog "フル更新ファイルを展開しました。配置元: $payload"
  }
  Move-Item -LiteralPath $replacementTarget -Destination $backup
  try {
    Move-Item -LiteralPath $payload -Destination $replacementTarget
  } catch {
    if (Test-Path -LiteralPath $replacementTarget) {
      Remove-Item -LiteralPath $replacementTarget -Recurse -Force
    }
    if (Test-Path -LiteralPath $backup) { Move-Item -LiteralPath $backup -Destination $replacementTarget }
    throw
  }
  if (-not $Patch -and (Test-Path -LiteralPath $uninstallerBackup)) {
    Get-ChildItem -LiteralPath $uninstallerBackup -File | ForEach-Object {
      Copy-Item -LiteralPath $_.FullName -Destination $InstallDirectory -Force
    }
  }
  Remove-Item -LiteralPath $backup -Recurse -Force
  Write-UpdaterLog "更新ファイルをインストール先へ配置しました。"
  Start-Process -FilePath (Join-Path $InstallDirectory $ExecutableName) -WorkingDirectory $InstallDirectory
  try {
    Remove-Item -LiteralPath $ZipPath -Force -ErrorAction Stop
    Remove-Item -LiteralPath "$ZipPath.retry" -Force -ErrorAction SilentlyContinue
    Write-UpdaterLog "適用済みの更新ファイルを削除しました。"
  } catch {
    Write-UpdaterLog "適用済みの更新ファイルを削除できませんでした: $($_.Exception.Message)"
  }
  Write-UpdaterLog "更新後のアプリケーションを起動しました。"
} catch {
  $message = "Web Revision Desk の更新に失敗しました: $($_.Exception.Message)"
  try {
    if (Test-Path -LiteralPath $ZipPath) {
      Set-Content -LiteralPath "$ZipPath.retry" -Encoding UTF8 -Value "retry"
    }
  } catch {
    Write-UpdaterLog "再試行用の更新ファイルを記録できませんでした: $($_.Exception.Message)"
  }
  Write-UpdaterLog $message
  Show-UpdateError "$message`n`nログ: $logPath"
  Write-Error $message
} finally {
  if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue }
  if (Test-Path -LiteralPath $backup) {
    $replacementExists = if ($replacementTarget) {
      Test-Path -LiteralPath $replacementTarget
    } else {
      Test-Path -LiteralPath $InstallDirectory
    }
    if ($replacementExists) { Remove-Item -LiteralPath $backup -Recurse -Force -ErrorAction SilentlyContinue }
  }
  if ($TemporaryScriptPath -and (Test-Path -LiteralPath $TemporaryScriptPath)) {
    Remove-Item -LiteralPath $TemporaryScriptPath -Force -ErrorAction SilentlyContinue
  }
  if ($TemporaryLauncherPath -and (Test-Path -LiteralPath $TemporaryLauncherPath)) {
    Remove-Item -LiteralPath $TemporaryLauncherPath -Force -ErrorAction SilentlyContinue
  }
}
