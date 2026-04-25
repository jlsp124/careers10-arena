[CmdletBinding()]
param(
    [string]$Version = "",
    [switch]$Clean,
    [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $RepoRoot

if ([string]::IsNullOrWhiteSpace($Version)) {
    $Version = (Get-Content (Join-Path $RepoRoot "VERSION") -Raw).Trim()
}
if ([string]::IsNullOrWhiteSpace($Version)) {
    throw "Release version is empty."
}

if (-not $SkipBuild) {
    & (Join-Path $PSScriptRoot "build_host.ps1") -Version $Version -Clean:$Clean
    & (Join-Path $PSScriptRoot "build_client.ps1") -Version $Version -Clean:$Clean
}

$DistPath = Join-Path $RepoRoot "dist\windows"
$HostExe = Join-Path $DistPath "Cortisol Host.exe"
$ClientExe = Join-Path $DistPath "Cortisol Client.exe"
if (-not (Test-Path -LiteralPath $HostExe)) {
    throw "Missing Host executable: $HostExe"
}
if (-not (Test-Path -LiteralPath $ClientExe)) {
    throw "Missing Client executable: $ClientExe"
}

$ReleaseBase = Join-Path $RepoRoot "dist\release"
$ReleaseName = "Cortisol Arcade-$Version-windows"
$ReleaseRoot = Join-Path $ReleaseBase $ReleaseName
$ZipPath = Join-Path $ReleaseBase "$ReleaseName.zip"

if ($Clean) {
    Remove-Item -LiteralPath $ReleaseRoot -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $ZipPath -Force -ErrorAction SilentlyContinue
}

New-Item -ItemType Directory -Force -Path $ReleaseRoot | Out-Null
Copy-Item -LiteralPath $HostExe -Destination (Join-Path $ReleaseRoot "Cortisol Host.exe") -Force
Copy-Item -LiteralPath $ClientExe -Destination (Join-Path $ReleaseRoot "Cortisol Client.exe") -Force

$RuntimeRoot = Join-Path $ReleaseRoot "runtime_data"
New-Item -ItemType Directory -Force -Path (Join-Path $RuntimeRoot "sync\snapshots") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $RuntimeRoot "live") | Out-Null
Set-Content -Path (Join-Path $RuntimeRoot "README.txt") -Encoding UTF8 -Value @"
Cortisol Arcade runtime data

runtime_data/live is created and mutated locally by Cortisol Host. Do not commit raw live data.
runtime_data/sync stores encrypted .world.enc snapshots and commit-safe manifests.
Cortisol Client stores only local connection preferences and does not write sync snapshots.
"@

Copy-Item -LiteralPath (Join-Path $RepoRoot "docs\release\README.md") -Destination (Join-Path $ReleaseRoot "README.md") -Force

$Commit = "unknown"
$Branch = "unknown"
try {
    $Commit = (git rev-parse --short HEAD).Trim()
    $Branch = (git branch --show-current).Trim()
} catch {
}

$Metadata = [ordered]@{
    product = "Cortisol Arcade"
    version = $Version
    built_at = [DateTime]::UtcNow.ToString("yyyy-MM-ddTHH:mm:ssZ")
    commit = $Commit
    branch = $Branch
    artifacts = @(
        "Cortisol Host.exe",
        "Cortisol Client.exe"
    )
    runtime_data = [ordered]@{
        live = "runtime_data/live"
        sync = "runtime_data/sync"
        live_policy = "local_only_raw_data"
        sync_policy = "encrypted_snapshots_and_commit_safe_manifests"
    }
}
$Metadata | ConvertTo-Json -Depth 6 | Set-Content -Path (Join-Path $ReleaseRoot "build-metadata.json") -Encoding UTF8

if (Test-Path -LiteralPath $ZipPath) {
    Remove-Item -LiteralPath $ZipPath -Force
}
Compress-Archive -Path (Join-Path $ReleaseRoot "*") -DestinationPath $ZipPath -Force

Write-Host "[Cortisol Arcade] Release folder: $ReleaseRoot"
Write-Host "[Cortisol Arcade] Release zip: $ZipPath"
