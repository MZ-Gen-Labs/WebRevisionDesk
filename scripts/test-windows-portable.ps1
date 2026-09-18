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

$port = 23187
$dataRoot = Join-Path $testRoot "data"
$env:PORT = "$port"
$env:WEB_REVISION_PRODUCTION = "1"
$env:WEB_REVISION_DATA_DIR = $dataRoot
$process = Start-Process -FilePath (Join-Path $versionRoot "node/node.exe") -ArgumentList "server.js" -WorkingDirectory $versionRoot -PassThru -WindowStyle Hidden
try {
  $healthy = $false
  for ($attempt = 0; $attempt -lt 40; $attempt++) {
    try {
      $health = Invoke-RestMethod "http://127.0.0.1:$port/api/health" -TimeoutSec 2
      if ($health.ok -and $health.version -eq $package.version) { $healthy = $true; break }
    } catch { Start-Sleep -Milliseconds 250 }
  }
  if (-not $healthy) { throw "Portable server did not become healthy." }
  $page = Invoke-WebRequest "http://127.0.0.1:$port/" -UseBasicParsing
  if ($page.StatusCode -ne 200 -or $page.Content -notmatch "Web Revision Desk") { throw "Portable UI was not served correctly." }
} finally {
  if (-not $process.HasExited) { Stop-Process -Id $process.Id -Force }
}

Write-Host "Windows portable smoke test passed."
