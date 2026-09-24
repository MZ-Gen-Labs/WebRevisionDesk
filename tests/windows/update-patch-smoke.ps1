param(
  [Parameter(Mandatory = $true)][string]$UpdaterPath,
  [Parameter(Mandatory = $true)][string]$ScratchDirectory
)

$ErrorActionPreference = "Stop"
$testRoot = Join-Path $ScratchDirectory ("update-patch-smoke-" + [guid]::NewGuid())
$installDirectory = Join-Path $testRoot "install"
$patchRoot = Join-Path $testRoot "patch"
$patchResources = Join-Path $patchRoot "resources"
$patchApp = Join-Path $patchResources "app"
$zipPath = Join-Path $testRoot "patch.zip"
$stagedUpdaterPath = Join-Path $testRoot "updater.ps1"

try {
  $installedApp = Join-Path $installDirectory "resources\app"
  New-Item -ItemType Directory -Path $installedApp -Force | Out-Null
  New-Item -ItemType Directory -Path $patchApp -Force | Out-Null
  Copy-Item -LiteralPath (Join-Path $env:windir "System32\whoami.exe") -Destination (Join-Path $installDirectory "WebRevisionDesk.exe")
  Set-Content -LiteralPath (Join-Path $installDirectory "runtime.txt") -Encoding UTF8 -Value "keep-runtime"
  Set-Content -LiteralPath (Join-Path $installedApp "package.json") -Encoding UTF8 -Value '{"version":"0.7.15"}'
  Set-Content -LiteralPath (Join-Path $installedApp "old-code.txt") -Encoding UTF8 -Value "old-code"

  Set-Content -LiteralPath (Join-Path $patchApp "package.json") -Encoding UTF8 -Value '{"version":"0.7.16","main":"electron/main.mjs"}'
  New-Item -ItemType Directory -Path (Join-Path $patchApp "electron") -Force | Out-Null
  Set-Content -LiteralPath (Join-Path $patchApp "electron\main.mjs") -Encoding UTF8 -Value "// patch payload"
  Set-Content -LiteralPath (Join-Path $patchApp "new-code.txt") -Encoding UTF8 -Value "new-code"
  Compress-Archive -Path $patchResources -DestinationPath $zipPath -CompressionLevel Optimal

  $completedProcess = Start-Process -FilePath $env:ComSpec -ArgumentList "/d /c exit 0" -PassThru -Wait
  $sha256 = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()
  $updaterSource = [System.IO.File]::ReadAllText((Resolve-Path -LiteralPath $UpdaterPath).Path)
  [System.IO.File]::WriteAllText($stagedUpdaterPath, $updaterSource, [System.Text.UTF8Encoding]::new($true))
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $stagedUpdaterPath `
    -ProcessId $completedProcess.Id `
    -InstallDirectory $installDirectory `
    -ZipPath $zipPath `
    -Sha256 $sha256 `
    -ExecutableName "WebRevisionDesk.exe" `
    -Patch `
    -ExpectedVersion "0.7.16"
  if ($LASTEXITCODE -ne 0) { throw "The app-only patch updater exited with code $LASTEXITCODE." }

  if ((Get-Content -Raw -LiteralPath (Join-Path $installedApp "package.json") | ConvertFrom-Json).version -ne "0.7.16") {
    throw "The app-only patch did not update the application version."
  }
  if (-not (Test-Path -LiteralPath (Join-Path $installedApp "new-code.txt"))) {
    throw "The app-only patch payload was not installed."
  }
  if (Test-Path -LiteralPath (Join-Path $installedApp "old-code.txt")) {
    throw "The app-only patch did not replace the previous app payload."
  }
  if ((Get-Content -Raw -LiteralPath (Join-Path $installDirectory "runtime.txt")).Trim() -ne "keep-runtime") {
    throw "The app-only patch modified a file outside resources/app."
  }
  if (-not (Test-Path -LiteralPath (Join-Path $installDirectory "WebRevisionDesk.exe"))) {
    throw "The app-only patch removed the Electron executable."
  }
} finally {
  Remove-Item -LiteralPath $testRoot -Recurse -Force -ErrorAction SilentlyContinue
}
