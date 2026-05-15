<#
.SYNOPSIS
    Start the MyClaudia server inside WSL from Windows.

.DESCRIPTION
    Standalone debugging script that replicates the Tauri app's WSL server flow:
    1. Health-check: skip if server already running
    2. WSL probe: verify WSL is responsive
    3. Deploy (optional): copy server bundle + node binary into WSL
    4. Start: launch the server and wait for SERVER_READY:<port>

    The app deploys the server to ~/.my-claudia/server/ in WSL. If you've run
    the app at least once, you can use -SkipDeploy to test with the existing
    deployment.

.PARAMETER SkipDeploy
    Skip the deploy step — use whatever is already at ~/.my-claudia/server/ in WSL.
    This is the recommended mode if the app has deployed at least once.

.PARAMETER Deploy
    Force a fresh deploy from the repo's server/bundle/ directory.
    Requires: pnpm --filter @my-claudia/server run bundle (from WSL)

.PARAMETER Port
    Port to check for an existing server (default: 3100).

.PARAMETER UseCmdWrapper
    Launch wsl.exe via cmd.exe /C (mimics what the Tauri Rust code does).
    Use this to test the exact same invocation path as the app.

.EXAMPLE
    # Most common: test with existing deployment
    .\scripts\wsl-server.ps1 -SkipDeploy

    # Test with cmd.exe wrapper (mimics Tauri's wsl_command)
    .\scripts\wsl-server.ps1 -SkipDeploy -UseCmdWrapper

    # Force fresh deploy from repo
    .\scripts\wsl-server.ps1 -Deploy
#>
param(
    [switch]$SkipDeploy,
    [switch]$Deploy,
    [switch]$UseCmdWrapper,
    [int]$Port = 3100
)

$ErrorActionPreference = "Stop"

$WSL_DEPLOY_DIR = "~/.my-claudia/server"

# --- Helpers ---

function Write-Step($msg) { Write-Host "[*] $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "[+] $msg" -ForegroundColor Green }
function Write-Err($msg)  { Write-Host "[-] $msg" -ForegroundColor Red }
function Write-Info($msg)  { Write-Host "    $msg" -ForegroundColor Gray }

function Test-ServerHealth([int]$p) {
    try {
        $resp = Invoke-WebRequest -Uri "http://127.0.0.1:$p/health" -TimeoutSec 3 -UseBasicParsing -ErrorAction Stop
        return $resp.StatusCode -eq 200
    } catch {
        return $false
    }
}

function Invoke-Wsl {
    param([string]$Command, [int]$TimeoutSec = 60, [switch]$ViaCmdWrapper)

    $psi = New-Object System.Diagnostics.ProcessStartInfo
    if ($ViaCmdWrapper) {
        # Mimic Tauri's wsl_command: cmd.exe /C wsl bash -c "..."
        $psi.FileName = "cmd.exe"
        $psi.Arguments = "/C wsl bash -c `"$Command`""
    } else {
        $psi.FileName = "wsl"
        $psi.Arguments = "bash -c `"$Command`""
    }
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true

    Write-Info "  > $($psi.FileName) $($psi.Arguments)"

    $proc = [System.Diagnostics.Process]::Start($psi)
    $stdout = $proc.StandardOutput.ReadToEnd()
    $stderr = $proc.StandardError.ReadToEnd()
    $exited = $proc.WaitForExit($TimeoutSec * 1000)

    if (-not $exited) {
        try { $proc.Kill() } catch {}
        throw "WSL command timed out after ${TimeoutSec}s"
    }

    return @{
        ExitCode = $proc.ExitCode
        Stdout   = $stdout
        Stderr   = $stderr
    }
}

function Convert-ToWslPath([string]$WinPath) {
    $p = $WinPath -replace '\\', '/'
    if ($p -match '^([A-Za-z]):\/(.*)') {
        return "/mnt/$($Matches[1].ToLower())/$($Matches[2])"
    }
    return $p
}

# --- Main Flow ---

Write-Host ""
Write-Host "=== MyClaudia WSL Server Debugger ===" -ForegroundColor Yellow
Write-Host ""

# Step 1: Health check
Write-Step "Checking if server is already running on port $Port..."
if (Test-ServerHealth $Port) {
    Write-Ok "Server already running on port $Port - nothing to do."
    exit 0
}
Write-Info "No server running."

# Step 2: WSL probe
Write-Step "Checking WSL availability (UseCmdWrapper=$UseCmdWrapper)..."
try {
    $probe = Invoke-Wsl -Command "echo ok" -TimeoutSec 15 -ViaCmdWrapper:$UseCmdWrapper
    if ($probe.ExitCode -ne 0 -or $probe.Stdout.Trim() -ne "ok") {
        Write-Err "WSL probe failed (exit=$($probe.ExitCode))"
        if ($probe.Stdout.Trim()) { Write-Info "stdout: $($probe.Stdout.Trim())" }
        if ($probe.Stderr.Trim()) { Write-Info "stderr: $($probe.Stderr.Trim())" }
        exit 1
    }
    Write-Ok "WSL is available."
} catch {
    Write-Err "WSL is not available: $_"
    exit 1
}

# Step 3: Verify / Deploy
if ($Deploy) {
    Write-Step "Deploying server bundle to WSL..."

    # Find repo root (script is at <repo>/scripts/wsl-server.ps1)
    $repoRoot = Split-Path -Parent $PSScriptRoot
    $bundleDir = Join-Path $repoRoot "server" "bundle"
    $cacheNodeBin = Join-Path $repoRoot ".cache" "node-sidecar" "node-v22.14.0-linux-x64"

    if (-not (Test-Path (Join-Path $bundleDir "server.mjs"))) {
        Write-Err "Server bundle not found at: $bundleDir"
        Write-Info "Build it first (from WSL): pnpm --filter @my-claudia/server run bundle"
        exit 1
    }

    $wslBundlePath = Convert-ToWslPath $bundleDir

    # server/bundle/ doesn't include a node binary — it goes to src-tauri/binaries/ instead.
    # We need to copy the cached Linux node binary separately.
    if (Test-Path $cacheNodeBin) {
        $wslNodeBin = Convert-ToWslPath $cacheNodeBin
        Write-Info "Bundle: $bundleDir"
        Write-Info "Node binary: $cacheNodeBin"
    } else {
        Write-Err "Cached Linux node binary not found at: $cacheNodeBin"
        Write-Info "Build the server bundle from WSL first: pnpm --filter @my-claudia/server run bundle"
        exit 1
    }

    $deployCmd = @(
        "rm -rf $WSL_DEPLOY_DIR",
        "mkdir -p $WSL_DEPLOY_DIR",
        "cp -r '$wslBundlePath/'* $WSL_DEPLOY_DIR/",
        "cp '$wslNodeBin' $WSL_DEPLOY_DIR/node",
        "chmod +x $WSL_DEPLOY_DIR/node",
        "echo 'dev-script' > $WSL_DEPLOY_DIR/.version",
        "echo `"Deploy complete: `$(ls $WSL_DEPLOY_DIR/ | wc -l) items`""
    ) -join " && "

    try {
        $dResult = Invoke-Wsl -Command $deployCmd -TimeoutSec 30 -ViaCmdWrapper:$UseCmdWrapper
        if ($dResult.ExitCode -ne 0) {
            Write-Err "Deploy failed (exit=$($dResult.ExitCode)):"
            if ($dResult.Stderr.Trim()) { Write-Info $dResult.Stderr.Trim() }
            exit 1
        }
        Write-Ok $dResult.Stdout.Trim()
    } catch {
        Write-Err "Deploy failed: $_"
        exit 1
    }
} elseif (-not $SkipDeploy) {
    Write-Info "Tip: use -SkipDeploy (use existing deployment) or -Deploy (fresh deploy from repo)"
}

# Step 4: Verify deployed files
Write-Step "Verifying server deployment in WSL..."
try {
    $check = Invoke-Wsl -Command "test -x $WSL_DEPLOY_DIR/node && test -f $WSL_DEPLOY_DIR/server.mjs && echo FILES_OK || echo FILES_MISSING" -TimeoutSec 10 -ViaCmdWrapper:$UseCmdWrapper
    if ($check.Stdout.Trim() -ne "FILES_OK") {
        Write-Err "Server files missing in WSL ($WSL_DEPLOY_DIR)"
        # Show what's there
        $ls = Invoke-Wsl -Command "ls -la $WSL_DEPLOY_DIR/ 2>&1 || echo '(directory not found)'" -TimeoutSec 10 -ViaCmdWrapper:$UseCmdWrapper
        Write-Info $ls.Stdout.Trim()
        Write-Info "Run with -Deploy to deploy, or ensure the app has deployed at least once."
        exit 1
    }
    $ver = Invoke-Wsl -Command "cat $WSL_DEPLOY_DIR/.version 2>/dev/null" -TimeoutSec 5 -ViaCmdWrapper:$UseCmdWrapper
    Write-Ok "Server files OK (version: $($ver.Stdout.Trim()))"
} catch {
    Write-Err "Failed to verify: $_"
    exit 1
}

# Step 5: Start server
Write-Step "Starting server in WSL (UseCmdWrapper=$UseCmdWrapper)..."
$serverCmd = "cd ~/.my-claudia && exec ./server/node ./server/server.mjs"
Write-Info "Command: $serverCmd"
Write-Host ""

$psi = New-Object System.Diagnostics.ProcessStartInfo
if ($UseCmdWrapper) {
    $psi.FileName = "cmd.exe"
    $psi.Arguments = "/C wsl bash -c `"$serverCmd`""
} else {
    $psi.FileName = "wsl"
    $psi.Arguments = "bash -c `"$serverCmd`""
}
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError = $true
$psi.UseShellExecute = $false
$psi.CreateNoWindow = $false

Write-Info "  > $($psi.FileName) $($psi.Arguments)"
Write-Host ""

$proc = [System.Diagnostics.Process]::Start($psi)

$reader = $proc.StandardOutput
$errReader = $proc.StandardError
$serverPort = $null
$timeoutMs = 30000
$sw = [System.Diagnostics.Stopwatch]::StartNew()

# Drain stderr in a background thread to prevent pipe deadlock
$stderrTask = [System.Threading.Tasks.Task]::Run([System.Action]{
    while ($null -ne ($line = $errReader.ReadLine())) {
        [Console]::Error.WriteLine("  [stderr] $line")
    }
})

# Read stdout line-by-line, looking for SERVER_READY:<port>
while (-not $reader.EndOfStream) {
    $line = $reader.ReadLine()
    if ($null -eq $line) { break }

    if ($line -match "^SERVER_READY:(\d+)$") {
        $serverPort = [int]$Matches[1]
        Write-Host ""
        Write-Ok "Server ready on port $serverPort!"
        Write-Ok "URL: http://127.0.0.1:$serverPort"
        Write-Host ""
        break
    }

    Write-Host "  [stdout] $line" -ForegroundColor DarkGray

    if ($sw.ElapsedMilliseconds -gt $timeoutMs) {
        Write-Err "Timeout waiting for SERVER_READY after $($timeoutMs / 1000)s"
        try { $proc.Kill() } catch {}
        exit 1
    }
}

if ($null -eq $serverPort) {
    Write-Err "Server exited without emitting SERVER_READY"
    if (-not $proc.HasExited) { try { $proc.Kill() } catch {} }
    Write-Info "Check stderr output above for details."
    exit 1
}

# Keep streaming output until Ctrl+C or process exit
Write-Host "Server is running. Press Ctrl+C to stop." -ForegroundColor Yellow
Write-Host ""

try {
    while (-not $reader.EndOfStream) {
        $line = $reader.ReadLine()
        if ($null -ne $line) {
            Write-Host "  [stdout] $line" -ForegroundColor DarkGray
        }
    }
} catch {
    # Ctrl+C or process exit
} finally {
    if (-not $proc.HasExited) {
        Write-Step "Stopping server..."
        try {
            $proc.Kill()
            $proc.WaitForExit(5000) | Out-Null
        } catch {}
    }
    Write-Ok "Server stopped."
}
