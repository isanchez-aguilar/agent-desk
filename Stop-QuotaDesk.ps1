$ErrorActionPreference = 'Stop'
$nodeCommand = (Get-Command node -ErrorAction Stop).Source
$dataDirectory = & $nodeCommand (Join-Path $PSScriptRoot 'bin/quota-desk.mjs') data
if ($LASTEXITCODE -ne 0 -or -not $dataDirectory) { throw 'Quota Desk could not resolve its data folder.' }
$dataDirectory = "$dataDirectory".Trim()
$pidFile = Join-Path $dataDirectory 'server.pid'
if (-not (Test-Path -LiteralPath $pidFile)) { Write-Output 'No server is registered.'; exit }
$serverProcessId = [int](Get-Content -LiteralPath $pidFile)
$serverProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$serverProcessId"
$expectedScript = Join-Path $PSScriptRoot 'server.mjs'
if ($null -eq $serverProcess) { Write-Output 'The server is already stopped.'; exit }
if ($serverProcess.Name -ne 'node.exe' -or -not $serverProcess.CommandLine.Contains($expectedScript)) { throw 'The PID belongs to another process; it will not be stopped.' }
Stop-Process -Id $serverProcessId
Write-Output 'Quota Desk stopped. Its records are kept.'
