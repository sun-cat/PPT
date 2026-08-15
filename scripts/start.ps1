$ErrorActionPreference = "Stop"

$projectDir = Split-Path -Parent $PSScriptRoot
Set-Location $projectDir

function ConvertTo-HttpProxyUrl {
    param([string]$ProxyServer)

    $candidate = [string]$ProxyServer
    if (-not $candidate) {
        return $null
    }

    if ($candidate.Contains(";") -or $candidate -match "^(http|https)=") {
        $proxyEntries = @{}
        foreach ($entry in ($candidate -split ";")) {
            if ($entry -match "^\s*([^=]+)=(.+)\s*$") {
                $proxyEntries[$matches[1].ToLowerInvariant()] = $matches[2].Trim()
            }
        }
        $candidate = if ($proxyEntries.ContainsKey("https")) {
            $proxyEntries["https"]
        } elseif ($proxyEntries.ContainsKey("http")) {
            $proxyEntries["http"]
        } else {
            ""
        }
    }

    if (-not $candidate) {
        return $null
    }
    if ($candidate -notmatch "^[a-z][a-z0-9+.-]*://") {
        $candidate = "http://$candidate"
    }

    try {
        $uri = [Uri]$candidate
        if ($uri.Scheme -in @("http", "https") -and $uri.Host -and $uri.Port) {
            return $uri.AbsoluteUri.TrimEnd("/")
        }
    } catch {
    }
    return $null
}

function Get-WindowsSystemProxy {
    try {
        $settings = Get-ItemProperty `
            -LiteralPath "HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings" `
            -Name ProxyEnable, ProxyServer `
            -ErrorAction Stop
        if ($settings.ProxyEnable -eq 1) {
            return ConvertTo-HttpProxyUrl -ProxyServer $settings.ProxyServer
        }
    } catch {
    }
    return $null
}

if (-not $env:IMAGE_API_PROXY) {
    $detectedProxy = Get-WindowsSystemProxy
    if ($detectedProxy) {
        $env:IMAGE_API_PROXY = $detectedProxy
        Write-Host "System network proxy detected."
    }
}
if ($env:IMAGE_API_PROXY) {
    if (-not $env:HTTPS_PROXY) {
        $env:HTTPS_PROXY = $env:IMAGE_API_PROXY
    }
    if (-not $env:HTTP_PROXY) {
        $env:HTTP_PROXY = $env:IMAGE_API_PROXY
    }
}

$systemNode = Get-Command node -ErrorAction SilentlyContinue
$systemNpm = Get-Command npm -ErrorAction SilentlyContinue
$codexRuntime = Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies"
$codexNode = Join-Path $codexRuntime "node\bin\node.exe"
$codexPnpm = Join-Path $codexRuntime "bin\fallback\pnpm.cmd"

$nodeExe = if ($systemNode) {
    $systemNode.Source
} elseif (Test-Path $codexNode) {
    $codexNode
} else {
    $null
}

if (-not $nodeExe) {
    throw "Node.js was not found. Install Node.js 20 or newer from https://nodejs.org/."
}

if (
    -not (Test-Path (Join-Path $projectDir "node_modules\jszip")) -or
    -not (Test-Path (Join-Path $projectDir "node_modules\pptxgenjs")) -or
    -not (Test-Path (Join-Path $projectDir "node_modules\undici"))
) {
    Write-Host "First run: installing public dependencies..."
    if ($systemNpm) {
        & $systemNpm.Source install
    } elseif (Test-Path $codexPnpm) {
        & $codexPnpm install
    } else {
        throw "npm was not found. Reinstall Node.js with npm included."
    }
    if ($LASTEXITCODE -ne 0) {
        throw "Dependency installation failed. Check the network and run the Windows launcher again."
    }
}

function Test-LocalPortInUse {
    param([int]$Port)

    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $connection = $client.BeginConnect("127.0.0.1", $Port, $null, $null)
        if (-not $connection.AsyncWaitHandle.WaitOne(300)) {
            return $false
        }
        $client.EndConnect($connection)
        return $true
    } catch {
        return $false
    } finally {
        $client.Close()
    }
}

function Get-RunningAppHealth {
    param([int]$Port)

    try {
        return Invoke-RestMethod `
            -Uri "http://127.0.0.1:$Port/api/health" `
            -TimeoutSec 1
    } catch {
        return $null
    }
}

$packageInfo = Get-Content -LiteralPath (Join-Path $projectDir "package.json") -Raw -Encoding UTF8 | ConvertFrom-Json
$expectedVersion = [string]$packageInfo.version
$selectedPort = $null

foreach ($candidatePort in 3210..3220) {
    if (-not (Test-LocalPortInUse -Port $candidatePort)) {
        $selectedPort = $candidatePort
        break
    }

    $health = Get-RunningAppHealth -Port $candidatePort
    if (
        $candidatePort -eq 3210 -and
        $health -and
        $health.ok -eq $true -and
        $health.service -eq "shengcai-mini-ppt" -and
        [string]$health.version -ne $expectedVersion
    ) {
        throw "An older version of this tool is still using port 3210. Close the older terminal window, then start this version again. To preserve browser API settings and courseware archives, this version will not switch ports during an update."
    }
    if (
        $health -and
        $health.ok -eq $true -and
        $health.service -eq "shengcai-mini-ppt" -and
        [string]$health.version -eq $expectedVersion
    ) {
        $appUrl = "http://127.0.0.1:$candidatePort"
        $browserOpener = Join-Path $PSScriptRoot "open-browser.ps1"
        Start-Process -FilePath "powershell.exe" `
            -ArgumentList @(
                "-NoProfile",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
                "`"$browserOpener`"",
                "-Url",
                "`"$appUrl`""
            ) `
            -WindowStyle Hidden | Out-Null
        Write-Host "This version is already running: $appUrl"
        exit 0
    }
}

if (-not $selectedPort) {
    throw "Ports 3210-3220 are occupied. Close an older copy of this tool and try again."
}

$env:PORT = [string]$selectedPort
$appUrl = "http://127.0.0.1:$selectedPort"
$browserOpener = Join-Path $PSScriptRoot "open-browser.ps1"
$browserArguments = @(
    "-NoProfile"
    "-ExecutionPolicy"
    "Bypass"
    "-File"
    "`"$browserOpener`""
    "-Url"
    "`"$appUrl`""
)

Start-Process -FilePath "powershell.exe" `
    -ArgumentList $browserArguments `
    -WindowStyle Hidden | Out-Null

Write-Host "Shengcai Mini PPT is starting..."
if ($selectedPort -ne 3210) {
    Write-Host "Port 3210 is occupied by another program. This run will use port $selectedPort."
    Write-Host "Browser data saved on port 3210 may not be visible. Close the program using 3210 and restart this tool to restore it."
}
Write-Host "The browser will open automatically: $appUrl"
& $nodeExe (Join-Path $projectDir "server.mjs")
