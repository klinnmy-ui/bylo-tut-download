param(
    [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'

$root = $PSScriptRoot
$url = 'http://127.0.0.1:8080/'
$pidFile = Join-Path $env:TEMP 'bylo-tut-web-server.pid'

function Test-Server {
    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 2
        return $response.StatusCode -eq 200
    } catch {
        return $false
    }
}

if (-not (Test-Server)) {
    $node = Get-Command node -ErrorAction SilentlyContinue
    if ($node) {
        $process = Start-Process -FilePath $node.Source `
            -ArgumentList 'local-server.mjs' `
            -WorkingDirectory $root `
            -WindowStyle Hidden `
            -PassThru
    } else {
        $python = Get-Command python -ErrorAction SilentlyContinue
        if (-not $python) {
            $python = Get-Command py -ErrorAction SilentlyContinue
        }
        if (-not $python) {
            throw 'Node.js or Python 3 not found.'
        }
        $process = Start-Process -FilePath $python.Source `
            -ArgumentList '-m', 'http.server', '8080', '--directory', $root `
            -WorkingDirectory $root `
            -WindowStyle Hidden `
            -PassThru
    }

    Set-Content -LiteralPath $pidFile -Value $process.Id -Encoding ascii
    foreach ($attempt in 1..20) {
        Start-Sleep -Milliseconds 150
        if (Test-Server) { break }
        if ($process.HasExited) { throw 'Local server exited during startup.' }
    }
}

if (-not (Test-Server)) {
    throw 'Local server did not respond at http://127.0.0.1:8080/.'
}

if (-not $NoBrowser) {
    Start-Process $url
}
