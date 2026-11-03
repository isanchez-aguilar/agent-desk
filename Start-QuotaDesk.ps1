param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$nodeCommand = (Get-Command node -ErrorAction Stop).Source
$toolDirectory = $PSScriptRoot
# Same rule as the server: QUOTA_DESK_DATA, an existing data/ next to the code, or ~/.quota-desk.
$dataDirectory = & $nodeCommand (Join-Path $toolDirectory 'bin/quota-desk.mjs') data
if ($LASTEXITCODE -ne 0 -or -not $dataDirectory) { throw 'Quota Desk could not resolve its data folder.' }
$dataDirectory = "$dataDirectory".Trim()
New-Item -ItemType Directory -Force -Path $dataDirectory | Out-Null
$address = 'http://127.0.0.1:4318'
$ready = $false
try {
  $response = Invoke-RestMethod "$address/api/data" -TimeoutSec 3
  $ready = $null -ne $response.agents.codex -and $null -ne $response.csrf
} catch {}
if (-not $ready) {
  # Start the server through WMI instead of Start-Process: a process created by
  # Start-Process stays in the caller's job object, so closing the terminal, an
  # agent app or its session killed it silently. A WMI-created process is not a
  # child of the caller, so it survives them.
  $server = Join-Path $toolDirectory 'server.mjs'
  $log = Join-Path $dataDirectory 'server.log'
  $errorLog = Join-Path $dataDirectory 'server-error.log'
  $commandLine = 'cmd.exe /c ""' + $nodeCommand + '" "' + $server + '" >> "' + $log + '" 2>> "' + $errorLog + '""'
  # ShowWindow = 0 (SW_HIDE): no console window. With Windows Terminal as the
  # default terminal, a visible cmd.exe would otherwise stay open as a black
  # window for as long as the server runs.
  $startup = New-CimInstance -ClassName Win32_ProcessStartup -ClientOnly -Property @{ ShowWindow = [uint16]0 }
  $created = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = $commandLine; CurrentDirectory = $toolDirectory; ProcessStartupInformation = $startup }
  if ($created.ReturnValue -ne 0) { throw "Quota Desk could not be started (WMI $($created.ReturnValue))." }
  for ($attempt = 0; $attempt -lt 20; $attempt++) {
    Start-Sleep -Milliseconds 500
    try {
      $response = Invoke-RestMethod "$address/api/data" -TimeoutSec 2
      if ($null -ne $response.agents.codex -and $null -ne $response.csrf) { $ready = $true; break }
    } catch {}
  }
  if ($ready) {
    # Stop-QuotaDesk checks this PID: it must be the node process, not the cmd wrapper.
    $node = Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($server) } | Select-Object -First 1
    if ($node) { $node.ProcessId | Set-Content -LiteralPath (Join-Path $dataDirectory 'server.pid') }
  }
}
if (-not $ready) { throw "Quota Desk did not start. See $errorLog; port 4318 may be in use." }
$lanCode = Join-Path $dataDirectory 'lan-code'
try { $lanOn = (Get-Content -LiteralPath (Join-Path $dataDirectory 'config.json') -Raw | ConvertFrom-Json).lan -eq $true } catch { $lanOn = $false }
if ($lanOn -and (Test-Path -LiteralPath $lanCode)) {
  # The adapter that has a default gateway is the real LAN; WSL and VM adapters have none.
  $lanIp = (Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway -and $_.IPv4Address } | Select-Object -First 1).IPv4Address.IPAddress
  Write-Output "LAN: http://$($lanIp):4318   Code: $((Get-Content -LiteralPath $lanCode -Raw | ConvertFrom-Json).code)"
}
if (-not $NoBrowser) { Start-Process $address }
