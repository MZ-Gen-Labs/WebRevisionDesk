$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$package = Get-Content (Join-Path $root "package.json") -Raw | ConvertFrom-Json
$archive = Join-Path $root "release/WebRevisionDesk-$($package.version)-win-x64-complete.zip"
$testRoot = Join-Path $env:RUNNER_TEMP "WebRevisionDesk-portable-smoke"

if (-not (Test-Path $archive)) { throw "Portable archive not found: $archive" }
if (Test-Path $testRoot) { Remove-Item $testRoot -Recurse -Force }
Expand-Archive -LiteralPath $archive -DestinationPath $testRoot -Force

$installRoot = Join-Path $testRoot "WebRevisionDesk"
$versionRoot = Join-Path $installRoot "versions/$($package.version)"
$required = @(
  (Join-Path $installRoot "Start-WebRevisionDesk.cmd"),
  (Join-Path $installRoot "launcher.ps1"),
  (Join-Path $installRoot "updater.ps1"),
  (Join-Path $versionRoot "node/node.exe"),
  (Join-Path $versionRoot "server.js"),
  (Join-Path $versionRoot "dist/index.html"),
  (Join-Path $versionRoot "release.json")
)
foreach ($file in $required) { if (-not (Test-Path $file)) { throw "Required portable file is missing: $file" } }

foreach ($script in @((Join-Path $installRoot "launcher.ps1"), (Join-Path $installRoot "updater.ps1"))) {
  $tokens = $null
  $parseErrors = $null
  [System.Management.Automation.Language.Parser]::ParseFile($script, [ref]$tokens, [ref]$parseErrors) | Out-Null
  if ($parseErrors.Count -gt 0) { throw "PowerShell script could not be parsed: $script - $($parseErrors[0].Message)" }
}

$dataRoot = Join-Path $testRoot "data"
$env:WEB_REVISION_DATA_DIR = $dataRoot
$env:WEB_REVISION_NO_BROWSER = "1"
$env:WEB_REVISION_NO_PAUSE = "1"
try {
  & (Join-Path $installRoot "Start-WebRevisionDesk.cmd")
  if ($LASTEXITCODE -ne 0) { throw "Start-WebRevisionDesk.cmd failed with exit code $LASTEXITCODE." }
  $healthy = $false
  for ($attempt = 0; $attempt -lt 40; $attempt++) {
    try {
      $health = Invoke-RestMethod "http://127.0.0.1:5173/api/health" -TimeoutSec 2
      if ($health.ok -and $health.version -eq $package.version) { $healthy = $true; break }
    } catch { Start-Sleep -Milliseconds 250 }
  }
  if (-not $healthy) { throw "Portable server did not become healthy." }
  $page = Invoke-WebRequest "http://127.0.0.1:5173/" -UseBasicParsing
  if ($page.StatusCode -ne 200 -or $page.Content -notmatch "Web Revision Desk") { throw "Portable UI was not served correctly." }
} finally {
  Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique |
    ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }
}

Write-Host "Windows portable smoke test passed."
