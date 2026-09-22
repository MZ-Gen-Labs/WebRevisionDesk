param(
  [Parameter(Mandatory = $true)][int]$ProcessId,
  [Parameter(Mandatory = $true)][string]$InstallDirectory,
  [Parameter(Mandatory = $true)][string]$ZipPath,
  [Parameter(Mandatory = $true)][string]$Sha256,
  [Parameter(Mandatory = $true)][string]$ExecutableName
)

$ErrorActionPreference = "Stop"
$parent = Split-Path -Parent $InstallDirectory
$stage = Join-Path $parent (".WebRevisionDesk-update-" + [guid]::NewGuid())
$backup = Join-Path $parent (".WebRevisionDesk-backup-" + [guid]::NewGuid())

try {
  $deadline = (Get-Date).AddSeconds(60)
  while (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue) {
    if ((Get-Date) -gt $deadline) { throw "アプリケーションの終了待機がタイムアウトしました。" }
    Start-Sleep -Milliseconds 500
  }
  if ((Get-FileHash -Algorithm SHA256 -LiteralPath $ZipPath).Hash.ToLowerInvariant() -ne $Sha256.ToLowerInvariant()) {
    throw "更新ファイルのSHA-256が一致しません。"
  }
  New-Item -ItemType Directory -Path $stage | Out-Null
  Expand-Archive -LiteralPath $ZipPath -DestinationPath $stage -Force
  if (-not (Test-Path -LiteralPath (Join-Path $stage $ExecutableName))) { throw "更新ファイルに実行ファイルがありません。" }
  Move-Item -LiteralPath $InstallDirectory -Destination $backup
  try {
    Move-Item -LiteralPath $stage -Destination $InstallDirectory
  } catch {
    Move-Item -LiteralPath $backup -Destination $InstallDirectory
    throw
  }
  Remove-Item -LiteralPath $backup -Recurse -Force
  Start-Process -FilePath (Join-Path $InstallDirectory $ExecutableName) -WorkingDirectory $InstallDirectory
} catch {
  Write-Error "Web Revision Desk の更新に失敗しました: $($_.Exception.Message)"
} finally {
  if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue }
}
