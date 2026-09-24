param(
  [Parameter(Mandatory = $true)][string]$InstallerPath,
  [Parameter(Mandatory = $true)][string]$ReleaseAppPath,
  [Parameter(Mandatory = $true)][string]$ScratchDirectory
)

$ErrorActionPreference = "Stop"
$version = (Get-Content -Raw -LiteralPath (Join-Path $ReleaseAppPath "resources\app\package.json") | ConvertFrom-Json).version
$testRoot = Join-Path $ScratchDirectory ("patch-installer-smoke-" + [guid]::NewGuid())
$installDirectory = Join-Path $testRoot "install"
$appDirectory = Join-Path $installDirectory "resources\app"
$installerLog = Join-Path $testRoot "patch-install.log"
$registryKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\{0D4F9CE2-C8DB-4A38-95A4-AEA5C81D22D1}_is1"

function Invoke-PatchInstaller {
  param([string]$LogPath)
  $arguments = @("/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART", "/DIR=`"$installDirectory`"", "/LOG=`"$LogPath`"")
  Start-Process -FilePath $InstallerPath -ArgumentList $arguments -Wait -PassThru
}

try {
  New-Item -ItemType Directory -Path (Join-Path $appDirectory "electron") -Force | Out-Null
  Set-Content -LiteralPath (Join-Path $installDirectory "WebRevisionDesk.exe") -Encoding ASCII -Value "existing-runtime"
  Set-Content -LiteralPath (Join-Path $installDirectory "runtime-sentinel.txt") -Encoding ASCII -Value "runtime-must-remain"
  Set-Content -LiteralPath (Join-Path $appDirectory "electron\main.mjs") -Encoding ASCII -Value "// old application"
  Set-Content -LiteralPath (Join-Path $appDirectory "old-sentinel.txt") -Encoding ASCII -Value "old-app-code"
  Set-Content -LiteralPath (Join-Path $appDirectory "package.json") -Encoding ASCII -Value '{"version":"0.7.16"}'

  $install = Invoke-PatchInstaller $installerLog
  if ($install.ExitCode -ne 0) {
    $details = if (Test-Path -LiteralPath $installerLog) { Get-Content -Raw -LiteralPath $installerLog } else { "Installer log was not created." }
    throw "Compatible patch installation failed with exit code $($install.ExitCode).`n$details"
  }
  $installedVersion = (Get-Content -Raw -LiteralPath (Join-Path $appDirectory "package.json") | ConvertFrom-Json).version
  if ($installedVersion -ne $version) { throw "Expected app version $version after patch install; got $installedVersion." }
  if (-not (Test-Path -LiteralPath (Join-Path $appDirectory "dist\index.html"))) { throw "The new application payload was not installed." }
  if (Test-Path -LiteralPath (Join-Path $appDirectory "old-sentinel.txt")) { throw "Old application files were not replaced." }
  if ((Get-Content -Raw -LiteralPath (Join-Path $installDirectory "runtime-sentinel.txt")).Trim() -ne "runtime-must-remain") {
    throw "The patch installer modified files outside resources/app."
  }
  if (-not (Test-Path -LiteralPath (Join-Path $installDirectory "WebRevisionDesk.exe"))) { throw "The Electron runtime was removed." }
  $displayVersion = (Get-ItemProperty -LiteralPath $registryKey).DisplayVersion
  if ($displayVersion -ne $version) { throw "Add/Remove Programs DisplayVersion was not updated to $version." }

  Set-Content -LiteralPath (Join-Path $appDirectory "package.json") -Encoding ASCII -Value '{"version":"0.7.9"}'
  Set-Content -LiteralPath (Join-Path $appDirectory "old-sentinel.txt") -Encoding ASCII -Value "must-not-be-overwritten"
  $rejectedOldVersion = Invoke-PatchInstaller (Join-Path $testRoot "old-version.log")
  if ($rejectedOldVersion.ExitCode -eq 0) { throw "The patch installer accepted an unsupported old version." }
  if ((Get-Content -Raw -LiteralPath (Join-Path $appDirectory "package.json") | ConvertFrom-Json).version -ne "0.7.9") {
    throw "The unsupported installation was modified."
  }
  if ((Get-Content -Raw -LiteralPath (Join-Path $appDirectory "old-sentinel.txt")).Trim() -ne "must-not-be-overwritten") {
    throw "The unsupported app payload was modified."
  }

  Remove-Item -LiteralPath (Join-Path $installDirectory "WebRevisionDesk.exe") -Force
  $rejectedMissingInstall = Invoke-PatchInstaller (Join-Path $testRoot "missing-install.log")
  if ($rejectedMissingInstall.ExitCode -eq 0) { throw "The patch installer accepted an installation without its executable." }
  if ((Get-Content -Raw -LiteralPath (Join-Path $appDirectory "package.json") | ConvertFrom-Json).version -ne "0.7.9") {
    throw "The missing-install target was modified."
  }
} finally {
  if (Test-Path -LiteralPath $installDirectory) {
    $uninstaller = Join-Path $installDirectory "unins000.exe"
    if (Test-Path -LiteralPath $uninstaller) {
      Start-Process -FilePath $uninstaller -ArgumentList @("/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART") -Wait -PassThru | Out-Null
    }
  }
  Remove-Item -LiteralPath $testRoot -Recurse -Force -ErrorAction SilentlyContinue
}
