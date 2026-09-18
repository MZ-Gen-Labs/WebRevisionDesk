param(
  [Parameter(Mandatory = $false)][string]$InstallRoot = $PSScriptRoot,
  [switch]$RollbackAttempt
)

$ErrorActionPreference = "Stop"
$InstallRoot = [IO.Path]::GetFullPath($InstallRoot.TrimEnd('\'))
$CurrentFile = Join-Path $InstallRoot "current.json"
$DataRoot = Join-Path $env:LOCALAPPDATA "WebRevisionEditor"
$LogDirectory = Join-Path $DataRoot "logs"
New-Item -ItemType Directory -Force -Path $LogDirectory | Out-Null
$LogFile = Join-Path $LogDirectory "launcher.log"

function Write-LauncherLog([string]$Message) {
  Add-Content -LiteralPath $LogFile -Value "$(Get-Date -Format o) $Message"
}

function Save-Current($State) {
  $Temporary = "$CurrentFile.tmp"
  $State | ConvertTo-Json | Set-Content -LiteralPath $Temporary -Encoding UTF8
  Move-Item -LiteralPath $Temporary -Destination $CurrentFile -Force
}

try {
  if (-not (Test-Path -LiteralPath $CurrentFile)) { throw "current.json がありません。" }
  $Current = Get-Content -LiteralPath $CurrentFile -Raw | ConvertFrom-Json
  $Version = [string]$Current.version
  if ($Version -notmatch '^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][A-Za-z0-9.-]+)?$') { throw "バージョン情報が不正です。" }
  $VersionDirectory = Join-Path (Join-Path $InstallRoot "versions") $Version
  $Node = Join-Path $VersionDirectory "node\node.exe"
  $Server = Join-Path $VersionDirectory "server.js"
  if (-not (Test-Path -LiteralPath $Node) -or -not (Test-Path -LiteralPath $Server)) {
    throw "バージョン $Version の実行ファイルが見つかりません。"
  }

  $env:WEB_REVISION_INSTALL_ROOT = $InstallRoot
  $env:WEB_REVISION_DATA_DIR = $DataRoot
  $env:WEB_REVISION_PRODUCTION = "1"
  $env:PLAYWRIGHT_BROWSERS_PATH = "0"
  $Process = Start-Process -FilePath $Node -ArgumentList "server.js" -WorkingDirectory $VersionDirectory -PassThru -WindowStyle Hidden
  Write-LauncherLog "Started v$Version (PID $($Process.Id))."

  $Ready = $false
  for ($Attempt = 0; $Attempt -lt 40; $Attempt++) {
    Start-Sleep -Milliseconds 500
    if ($Process.HasExited) { break }
    try {
      $Health = Invoke-RestMethod -Uri "http://127.0.0.1:5173/api/health" -TimeoutSec 2
      if ($Health.ok -eq $true -and [string]$Health.version -eq $Version) { $Ready = $true; break }
    } catch {}
  }
  if ($Ready) {
    Start-Process "http://127.0.0.1:5173/"
    Write-LauncherLog "v$Version is ready."
    exit 0
  }

  if (-not $Process.HasExited) { Stop-Process -Id $Process.Id -Force -ErrorAction SilentlyContinue }
  Write-LauncherLog "v$Version failed to become ready."
  $Previous = [string]$Current.previousVersion
  if (-not $RollbackAttempt -and $Previous -match '^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][A-Za-z0-9.-]+)?$') {
    $PreviousDirectory = Join-Path (Join-Path $InstallRoot "versions") $Previous
    if (Test-Path -LiteralPath (Join-Path $PreviousDirectory "server.js")) {
      Save-Current ([ordered]@{ version = $Previous; previousVersion = $Version; rolledBackAt = (Get-Date).ToUniversalTime().ToString("o") })
      Write-LauncherLog "Rolled back from v$Version to v$Previous."
      & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $PSCommandPath -InstallRoot $InstallRoot -RollbackAttempt
      exit $LASTEXITCODE
    }
  }
  throw "アプリを起動できませんでした。ログ: $LogFile"
} catch {
  Write-LauncherLog "ERROR: $($_.Exception.Message)"
  Add-Type -AssemblyName PresentationFramework
  [System.Windows.MessageBox]::Show("Web Revision Editorを起動できませんでした。`n$($_.Exception.Message)", "起動エラー", "OK", "Error") | Out-Null
  exit 1
}
