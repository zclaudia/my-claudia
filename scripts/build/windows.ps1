# Build Windows desktop app (MSI + NSIS)
# Windows version is UI-only (no embedded server) — connects to WSL or remote server
# Requires: Rust, Node.js, pnpm, Visual Studio Build Tools (MSVC)
# Run in PowerShell from the project root

$ErrorActionPreference = "Stop"
Set-Location "$PSScriptRoot\..\.."

# --- Preflight checks ---
foreach ($cmd in @("rustup", "pnpm", "node")) {
    if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
        Write-Error "$cmd not found. Please install it first."
        exit 1
    }
}

# --- Version bump ---
Write-Host "=== Version bump ===" -ForegroundColor Cyan
$releaseVersion = $env:RELEASE_VERSION
$releaseBuild = $env:RELEASE_BUILD

if ($releaseVersion -and $releaseBuild) {
    $env:VERSION = $releaseVersion
    $env:BUILD = $releaseBuild
    Write-Host "Using externally provided release version: $releaseVersion (build $releaseBuild)"
} else {
    $versionOutput = bash scripts/release/version-bump.sh --platform windows --bump
    foreach ($line in $versionOutput) {
        if ($line -match '^([^=]+)=(.*)$') {
            [System.Environment]::SetEnvironmentVariable($matches[1], $matches[2])
        }
    }
    if (-not $env:VERSION) {
        Write-Error "Failed to derive VERSION from scripts/release/version-bump.sh"
        exit 1
    }
}
Write-Host ""

# --- Pre-build (shared + desktop frontend only, no server bundle) ---
Write-Host "=== Building shared packages ===" -ForegroundColor Cyan
$env:APP_VERSION = $env:VERSION
pnpm -r run build
if ($LASTEXITCODE -ne 0) {
    Write-Error "Pre-build failed"
    exit 1
}
Write-Host ""

# --- Build ---
# Windows: UI-only build — no server bundle, no node sidecar, no server resources
Write-Host "Building Windows desktop app (UI-only)..." -ForegroundColor Cyan
# Build a dedicated alternate Tauri config file, following the standard
# "tauri.conf.*.json" pattern used by Tauri for environment-specific builds.
$baseConfigPath = Join-Path $PWD "apps\desktop\src-tauri\tauri.conf.json"
$windowsConfigPath = Join-Path $PWD "apps\desktop\src-tauri\tauri.conf.windows-ci.json"

$tauriConfig = Get-Content -Raw -Path $baseConfigPath | ConvertFrom-Json -AsHashtable
$tauriConfig.version = $env:VERSION
$tauriConfig.build.beforeBuildCommand = ""
$tauriConfig.bundle.resources = $null
$tauriConfig.bundle.externalBin = @()

$tauriConfigJson = $tauriConfig | ConvertTo-Json -Depth 100
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($windowsConfigPath, $tauriConfigJson, $utf8NoBom)
Write-Host "Tauri config file: $windowsConfigPath"

try {
    $pnpmArgs = @(
        '--filter', '@my-claudia/desktop',
        'run', 'tauri:build',
        '--',
        '--config', 'src-tauri/tauri.conf.windows-ci.json'
    )

    Write-Host "Running: pnpm $($pnpmArgs -join ' ')"
    & pnpm @pnpmArgs
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Tauri build failed"
        exit 1
    }
} finally {
    Remove-Item -Path $windowsConfigPath -ErrorAction SilentlyContinue
}

$bundleDir = "apps\desktop\src-tauri\target\release\bundle"
Write-Host ""
Write-Host "=== Windows builds ===" -ForegroundColor Green

if (Test-Path "$bundleDir\msi") {
    Get-ChildItem "$bundleDir\msi\*.msi" | ForEach-Object {
        Write-Host "  MSI: $_"
        Write-Host "  Size: $([math]::Round($_.Length / 1MB, 1)) MB"
    }
}
if (Test-Path "$bundleDir\nsis") {
    Get-ChildItem "$bundleDir\nsis\*.exe" | ForEach-Object {
        Write-Host "  NSIS: $_"
        Write-Host "  Size: $([math]::Round($_.Length / 1MB, 1)) MB"
    }
}
