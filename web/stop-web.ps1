$ErrorActionPreference = 'Stop'

$pidFile = Join-Path $env:TEMP 'bylo-tut-web-server.pid'
if (-not (Test-Path -LiteralPath $pidFile)) {
    Write-Host 'Bylo Tut local server is not running.'
    exit 0
}

$serverPid = [int](Get-Content -LiteralPath $pidFile -Raw)
$process = Get-Process -Id $serverPid -ErrorAction SilentlyContinue
if ($process -and $process.ProcessName -in @('node', 'python', 'py')) {
    Stop-Process -Id $serverPid
    Write-Host 'Bylo Tut local server stopped.'
} else {
    Write-Host 'Saved process is no longer running; stale PID file removed.'
}
Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
