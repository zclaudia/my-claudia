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
# Windows: no embedded server sidecar, but includes a pre-built Linux server
# bundle (from CI build-wsl-server job) for auto-deployment into WSL at runtime.
Write-Host "Building Windows desktop app..." -ForegroundColor Cyan

# Check if WSL server bundle is available (placed by CI download-artifact step)
$wslServerDir = "apps\desktop\src-tauri\wsl-server"
if (Test-Path $wslServerDir) {
    Write-Host "  WSL server bundle found at $wslServerDir"
    $wslServerResources = [ordered]@{ "wsl-server/" = "wsl-server/" }
} else {
    Write-Host "  WARNING: WSL server bundle not found — building without it" -ForegroundColor Yellow
    $wslServerResources = [ordered]@{}
}

# Pass a JSON config override as a single argument to `tauri build --config`.
# Using PowerShell argument arrays avoids the quoting issues that caused the
# plain string form to be unreliable on Windows runners.
$tauriConfigObject = [ordered]@{
    version = $env:VERSION
    build = [ordered]@{
        beforeBuildCommand = ""
    }
    bundle = [ordered]@{
        resources = $wslServerResources
        externalBin = @()
    }
}

$tauriConfigJson = $tauriConfigObject | ConvertTo-Json -Depth 10 -Compress
Write-Host "Tauri config override: $tauriConfigJson"

$pnpmArgs = @('--filter', '@my-claudia/desktop', 'run', 'tauri', '--', 'build', '--config', $tauriConfigJson)

Write-Host "Running: pnpm $($pnpmArgs -join ' ')"
& pnpm @pnpmArgs
if ($LASTEXITCODE -ne 0) {
    Write-Error "Tauri build failed"
    exit 1
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
