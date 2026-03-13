# Build Windows desktop app (MSI + NSIS)
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

# --- Install / update dependencies ---
Write-Host "=== Installing dependencies ===" -ForegroundColor Cyan
pnpm install
Write-Host ""

# --- Pre-build (shared + desktop frontend) ---
# NOTE: server bundle is skipped on Windows — it bundles a Node sidecar with
# native modules (better-sqlite3, node-pty) that require Unix build tools.
# The Tauri config override clears beforeBuildCommand and the Windows app
# connects to a remote server instead of embedding one.
Write-Host "=== Building shared packages ===" -ForegroundColor Cyan
$env:APP_VERSION = $env:VERSION
pnpm -r run build
Write-Host ""

# --- Build ---
Write-Host "Building Windows desktop app..." -ForegroundColor Cyan
# Write config to a temp file to avoid PowerShell JSON escaping issues
$tauriConfig = @{
    version = $env:VERSION
    build = @{ beforeBuildCommand = "" }
} | ConvertTo-Json -Compress
$configFile = [System.IO.Path]::GetTempFileName()
Set-Content -Path $configFile -Value $tauriConfig -Encoding UTF8
try {
    pnpm --filter @my-claudia/desktop exec tauri build --config $configFile
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Tauri build failed"
        exit 1
    }
} finally {
    Remove-Item -Path $configFile -ErrorAction SilentlyContinue
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
