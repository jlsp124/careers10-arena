[CmdletBinding()]
param(
    [string]$Version = "",
    [switch]$Clean
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $RepoRoot

if ([string]::IsNullOrWhiteSpace($Version)) {
    $Version = (Get-Content (Join-Path $RepoRoot "VERSION") -Raw).Trim()
}
if ([string]::IsNullOrWhiteSpace($Version)) {
    throw "Build version is empty."
}

$env:CORTISOL_APP_VERSION = $Version
$DistPath = Join-Path $RepoRoot "dist\windows"
$WorkPath = Join-Path $RepoRoot "build\pyinstaller\host"
$HostExe = Join-Path $DistPath "Cortisol Host.exe"

python -m pip install -r requirements.txt
python -m pip install -r requirements-build.txt

if ($Clean) {
    Remove-Item -LiteralPath $WorkPath -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $HostExe -Force -ErrorAction SilentlyContinue
}

New-Item -ItemType Directory -Force -Path $DistPath | Out-Null
New-Item -ItemType Directory -Force -Path $WorkPath | Out-Null

python -m PyInstaller `
    --noconfirm `
    --distpath $DistPath `
    --workpath $WorkPath `
    packaging\pyinstaller\host.spec

if (-not (Test-Path -LiteralPath $HostExe)) {
    throw "Host build did not create $HostExe"
}

Write-Host "[Cortisol Host] Built $HostExe"
