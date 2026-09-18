param(
  [Parameter(Mandatory = $false)][string]$InstallRoot,
  [switch]$RollbackAttempt
)

$ErrorActionPreference = "Stop"
if ([string]::IsNullOrWhiteSpace($InstallRoot)) { $InstallRoot = $PSScriptRoot }
$InstallRoot = [IO.Path]::GetFullPath($InstallRoot)
$PathRoot = [IO.Path]::GetPathRoot($InstallRoot)
if ($InstallRoot -ne $PathRoot) { $InstallRoot = $InstallRoot.TrimEnd([char[]]"\/") }
$CurrentFile = Join-Path $InstallRoot "current.json"
$VersionsRoot = Join-Path $InstallRoot "versions"
$DataRoot = Join-Path $env:LOCALAPPDATA "WebRevisionEditor"
$LogDirectory = Join-Path $DataRoot "logs"
$ApplicationUrl = "http://127.0.0.1:5173/"
$HealthUrl = "${ApplicationUrl}api/health"
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

function Get-RunningApplicationHealth {
  try {
    $Health = Invoke-RestMethod -Uri $HealthUrl -TimeoutSec 2
    if ($Health.ok -eq $true) { return $Health }
  } catch {}
  return $null
}

function Get-ManagedApplicationProcess {
  $ListenerPids = @(
    Get-NetTCPConnection -LocalAddress "127.0.0.1" -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue |
      Select-Object -ExpandProperty OwningProcess -Unique
  )
  if ($ListenerPids.Count -eq 0) { return $null }
  if ($ListenerPids.Count -ne 1) { throw "Multiple processes are listening on port 5173. No process was changed." }

  $ListenerPid = [int]$ListenerPids[0]
  $ProcessInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $ListenerPid" -ErrorAction Stop
  $ExecutablePath = [IO.Path]::GetFullPath([string]$ProcessInfo.ExecutablePath)
  $VersionsPrefix = $VersionsRoot.TrimEnd([char[]]"\/") + [IO.Path]::DirectorySeparatorChar
  $ExpectedSuffix = "\node\node.exe"
  $IsNode = [string]$ProcessInfo.Name -ieq "node.exe"
  $IsInsideInstall = $ExecutablePath.StartsWith($VersionsPrefix, [StringComparison]::OrdinalIgnoreCase)
  $HasExpectedSuffix = $ExecutablePath.EndsWith($ExpectedSuffix, [StringComparison]::OrdinalIgnoreCase)
  if (-not $IsNode -or -not $IsInsideInstall -or -not $HasExpectedSuffix) {
    throw "Port 5173 is used by a process that is not managed by this Web Revision Desk installation. No process was changed."
  }
  return [PSCustomObject]@{ Id = $ListenerPid; ExecutablePath = $ExecutablePath }
}

function Stop-ManagedApplication {
  $Managed = Get-ManagedApplicationProcess
  if ($null -eq $Managed) { return $false }
  Stop-Process -Id $Managed.Id -Force -ErrorAction Stop
  for ($Attempt = 0; $Attempt -lt 40; $Attempt++) {
    if (-not (Get-Process -Id $Managed.Id -ErrorAction SilentlyContinue)) {
      Write-LauncherLog "Stopped managed process PID $($Managed.Id)."
      return $true
    }
    Start-Sleep -Milliseconds 250
  }
  throw "The managed Web Revision Desk process could not be stopped."
}

function Open-Application {
  if ($env:WEB_REVISION_NO_BROWSER -ne "1") { Start-Process $ApplicationUrl }
}

function Invoke-ApplicationMenu {
  if ($env:WEB_REVISION_NO_MENU -eq "1") { return }
  while ($true) {
    Write-Host ""
    Write-Host "[O] Open Web Revision Desk"
    Write-Host "[R] Restart Web Revision Desk"
    Write-Host "[S] Stop Web Revision Desk"
    Write-Host "[Enter] Close this window"
    $Choice = (Read-Host "Select an action").Trim().ToUpperInvariant()
    switch ($Choice) {
      "" { return }
      "O" { Open-Application }
      "R" {
        if ((Read-Host "Restart Web Revision Desk? (Y/N)").Trim() -ieq "Y") {
          Stop-ManagedApplication | Out-Null
          Write-LauncherLog "Restart requested from launcher menu."
          & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $PSCommandPath
          exit $LASTEXITCODE
        }
        Write-Host "Restart canceled."
      }
      "S" {
        if ((Read-Host "Stop Web Revision Desk? (Y/N)").Trim() -ieq "Y") {
          Stop-ManagedApplication | Out-Null
          Write-Host "Web Revision Desk stopped."
          return
        }
        Write-Host "Stop canceled."
      }
      default { Write-Host "Enter O, R, S, or press Enter." }
    }
  }
}

try {
  if (-not (Test-Path -LiteralPath $CurrentFile)) { throw "current.json was not found." }
  $Current = Get-Content -LiteralPath $CurrentFile -Raw | ConvertFrom-Json
  $Version = [string]$Current.version
  if ($Version -notmatch '^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][A-Za-z0-9.-]+)?$') { throw "The version information is invalid." }
  $VersionDirectory = Join-Path $VersionsRoot $Version
  $Node = Join-Path $VersionDirectory "node\node.exe"
  $Server = Join-Path $VersionDirectory "server.js"
  if (-not (Test-Path -LiteralPath $Node) -or -not (Test-Path -LiteralPath $Server)) {
    throw "The application files for version $Version were not found."
  }

  $env:WEB_REVISION_INSTALL_ROOT = $InstallRoot
  $env:WEB_REVISION_DATA_DIR = $DataRoot
  $env:WEB_REVISION_PRODUCTION = "1"
  $env:PLAYWRIGHT_BROWSERS_PATH = "0"

  $RunningHealth = Get-RunningApplicationHealth
  if ($null -ne $RunningHealth) {
    $Managed = Get-ManagedApplicationProcess
    if ($null -eq $Managed) { throw "Port 5173 responded without an identifiable managed process." }
    Write-Host "Web Revision Desk is already running. Opening the existing page."
    Write-LauncherLog "Reused running v$($RunningHealth.version) (PID $($Managed.Id))."
    Open-Application
    Invoke-ApplicationMenu
    exit 0
  }
  if ($null -ne (Get-ManagedApplicationProcess)) {
    throw "A managed process is listening on port 5173 but is not responding. Stop it before retrying."
  }

  $Process = Start-Process -FilePath $Node -ArgumentList "server.js" -WorkingDirectory $VersionDirectory -PassThru -WindowStyle Hidden
  Write-LauncherLog "Started v$Version (PID $($Process.Id))."

  $Ready = $false
  for ($Attempt = 0; $Attempt -lt 40; $Attempt++) {
    Start-Sleep -Milliseconds 500
    if ($Process.HasExited) { break }
    $Health = Get-RunningApplicationHealth
    if ($null -ne $Health -and [string]$Health.version -eq $Version) { $Ready = $true; break }
  }
  if ($Ready) {
    Open-Application
    Write-Host "Web Revision Desk v$Version started."
    Write-LauncherLog "v$Version is ready."
    Invoke-ApplicationMenu
    exit 0
  }

  if (-not $Process.HasExited) { Stop-Process -Id $Process.Id -Force -ErrorAction SilentlyContinue }
  Write-LauncherLog "v$Version failed to become ready."
  $Previous = [string]$Current.previousVersion
  if (-not $RollbackAttempt -and $Previous -match '^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][A-Za-z0-9.-]+)?$') {
    $PreviousDirectory = Join-Path $VersionsRoot $Previous
    if (Test-Path -LiteralPath (Join-Path $PreviousDirectory "server.js")) {
      Save-Current ([ordered]@{ version = $Previous; previousVersion = $Version; rolledBackAt = (Get-Date).ToUniversalTime().ToString("o") })
      Write-LauncherLog "Rolled back from v$Version to v$Previous."
      & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $PSCommandPath -RollbackAttempt
      exit $LASTEXITCODE
    }
  }
  throw "The application could not be started. Log: $LogFile"
} catch {
  Write-LauncherLog "ERROR: $($_.Exception.Message)"
  Add-Type -AssemblyName PresentationFramework
  [System.Windows.MessageBox]::Show("Web Revision Editor could not be started.`n$($_.Exception.Message)", "Startup error", "OK", "Error") | Out-Null
  exit 1
}
