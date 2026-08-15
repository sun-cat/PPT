param(
    [Parameter(Mandatory = $true)]
    [string]$Url
)

$ErrorActionPreference = "SilentlyContinue"
$healthUrl = "$Url/api/health"

function Open-AppBrowser {
    param(
        [Parameter(Mandatory = $true)]
        [string]$TargetUrl
    )

    $chromeCandidates = @(
        (Join-Path $env:LOCALAPPDATA "Google\Chrome\Application\chrome.exe"),
        (Join-Path $env:ProgramFiles "Google\Chrome\Application\chrome.exe"),
        (Join-Path ${env:ProgramFiles(x86)} "Google\Chrome\Application\chrome.exe")
    ) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }

    $chromeExe = $chromeCandidates | Select-Object -First 1
    if ($chromeExe) {
        Start-Process -FilePath $chromeExe -ArgumentList $TargetUrl
        return
    }

    Start-Process -FilePath $TargetUrl
}

for ($attempt = 0; $attempt -lt 80; $attempt++) {
    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri $healthUrl -TimeoutSec 1
        if ($response.StatusCode -eq 200) {
            $health = $response.Content | ConvertFrom-Json
            if ($health.ok -eq $true -and $health.service -eq "shengcai-mini-ppt") {
                Open-AppBrowser -TargetUrl $Url
                exit 0
            }
        }
    } catch {
    }

    Start-Sleep -Milliseconds 250
}

exit 1
