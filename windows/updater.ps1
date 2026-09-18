param(
  [Parameter(Mandatory = $true)][string]$InstallRoot,
  [Parameter(Mandatory = $true)][string]$Version,
  [Parameter(Mandatory = $true)][string]$ZipPath,
  [Parameter(Mandatory = $true)][string]$ExpectedDigest,
  [Parameter(Mandatory = $true)][int]$AppPid
)

$ErrorActionPreference = "Stop"
$InstallRoot = [IO.Path]::GetFullPath($InstallRoot)
$PathRoot = [IO.Path]::GetPathRoot($InstallRoot)
if ($InstallRoot -ne $PathRoot) { $InstallRoot = $InstallRoot.TrimEnd([char[]]"\/") }
$ZipPath = [IO.Path]::GetFullPath($ZipPath)
$VersionsRoot = Join-Path $InstallRoot "versions"
$CurrentFile = Join-Path $InstallRoot "current.json"
$DataRoot = Join-Path $env:LOCALAPPDATA "WebRevisionEditor"
$LogDirectory = Join-Path $DataRoot "logs"
New-Item -ItemType Directory -Force -Path $LogDirectory | Out-Null
$LogFile = Join-Path $LogDirectory "updater.log"

function Write-UpdaterLog([string]$Message) {
  Add-Content -LiteralPath $LogFile -Value "$(Get-Date -Format o) $Message"
}

try {
  if ($Version -notmatch '^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][A-Za-z0-9.-]+)?$') { throw "The version information is invalid." }
  if (-not (Test-Path -LiteralPath $ZipPath)) { throw "The update ZIP was not found." }
  if (-not $ExpectedDigest.StartsWith("sha256:")) { throw "SHA-256 information is missing." }
  if (-not (Test-Path -LiteralPath $CurrentFile)) { throw "current.json was not found." }

  Write-UpdaterLog "Waiting for PID $AppPid before applying v$Version."
  for ($Attempt = 0; $Attempt -lt 120; $Attempt++) {
    if (-not (Get-Process -Id $AppPid -ErrorAction SilentlyContinue)) { break }
    Start-Sleep -Milliseconds 500
  }
  if (Get-Process -Id $AppPid -ErrorAction SilentlyContinue) { throw "The previous version could not be stopped." }

  $ActualDigest = "sha256:$((Get-FileHash -LiteralPath $ZipPath -Algorithm SHA256).Hash.ToLowerInvariant())"
  if ($ActualDigest -ne $ExpectedDigest.ToLowerInvariant()) { throw "The update ZIP SHA-256 does not match." }

  New-Item -ItemType Directory -Force -Path $VersionsRoot | Out-Null
  $Staging = Join-Path $VersionsRoot ".staging-$Version"
  if (Test-Path -LiteralPath $Staging) { Remove-Item -LiteralPath $Staging -Recurse -Force }
  New-Item -ItemType Directory -Path $Staging | Out-Null
  Expand-Archive -LiteralPath $ZipPath -DestinationPath $Staging -Force

  $ReleaseFile = Join-Path $Staging "release.json"
  if (-not (Test-Path -LiteralPath $ReleaseFile)) { throw "release.json is missing from the update ZIP." }
  $Release = Get-Content -LiteralPath $ReleaseFile -Raw | ConvertFrom-Json
  if ([string]$Release.version -ne $Version) { throw "The update ZIP version does not match." }
  foreach ($Required in @("server.js", "dist\index.html", "node\node.exe", "node_modules\playwright\package.json")) {
    if (-not (Test-Path -LiteralPath (Join-Path $Staging $Required))) { throw "A required update file is missing: $Required" }
  }

  $Destination = Join-Path $VersionsRoot $Version
  if (Test-Path -LiteralPath $Destination) {
    $Backup = "$Destination.replaced-$(Get-Date -Format yyyyMMddHHmmss)"
    Move-Item -LiteralPath $Destination -Destination $Backup
  }
  Move-Item -LiteralPath $Staging -Destination $Destination

  $Current = Get-Content -LiteralPath $CurrentFile -Raw | ConvertFrom-Json
  $Previous = [string]$Current.version
  $Next = [ordered]@{ version = $Version; previousVersion = $Previous; updatedAt = (Get-Date).ToUniversalTime().ToString("o") }
  $Temporary = "$CurrentFile.tmp"
  $Next | ConvertTo-Json | Set-Content -LiteralPath $Temporary -Encoding UTF8
  Move-Item -LiteralPath $Temporary -Destination $CurrentFile -Force
  Write-UpdaterLog "Switched from v$Previous to v$Version."
  Start-Process -FilePath (Join-Path $InstallRoot "Start-WebRevisionDesk.cmd") -WorkingDirectory $InstallRoot
  exit 0
} catch {
  Write-UpdaterLog "ERROR: $($_.Exception.Message)"
  Add-Type -AssemblyName PresentationFramework
  [System.Windows.MessageBox]::Show("The update could not be applied. The previous version is still active.`n$($_.Exception.Message)", "Update error", "OK", "Error") | Out-Null
  exit 1
}
