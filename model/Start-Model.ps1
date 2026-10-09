param([switch]$ModelOnly, [ValidateRange(10,600)][int]$TimeoutSeconds = 120)
$ErrorActionPreference = 'Stop'
$taskSettings = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'model.config.json') -Raw | ConvertFrom-Json
$taskBaseUrl = "http://127.0.0.1:$($taskSettings.port)/v1"
function Test-ModelReady {
    try {
        $taskModels = Invoke-RestMethod "$taskBaseUrl/models" -TimeoutSec 2
    } catch { return $false }
    if ($taskModels.data.id -contains $taskSettings.model_id) { return $true }
    throw "A different model is listening on port $($taskSettings.port). Choose another port."
}
if (Test-ModelReady) { Write-Output "Model ready at $taskBaseUrl"; return }
$taskPortBusy = Get-NetTCPConnection -State Listen -LocalPort $taskSettings.port -ErrorAction SilentlyContinue
if ($taskPortBusy) { throw "Port $($taskSettings.port) is occupied. Wait for the existing model to finish starting or choose another port." }
foreach ($taskFile in @($taskSettings.server, $taskSettings.model, $taskSettings.projector)) {
    if (-not (Test-Path -LiteralPath $taskFile -PathType Leaf)) { throw "Missing model/runtime file: $taskFile. Rerun setup-model.ps1." }
}
# Start-Process joins argument arrays on Windows; quote file paths explicitly.
foreach ($taskPath in @($taskSettings.model, $taskSettings.projector)) {
    if ($taskPath.Contains('"')) { throw 'Model paths cannot contain double quotes.' }
}
$taskArguments = @('-m', ('"' + $taskSettings.model + '"'), '--mmproj', ('"' + $taskSettings.projector + '"'), '--alias', $taskSettings.model_id, '--host', '127.0.0.1', '--port', $taskSettings.port, '-c', $taskSettings.context_size, '-np', '1', '--image-max-tokens', '16384')
if ($taskSettings.backend -eq 'cuda') { $taskArguments += @('-ngl', 'all', '-fa', 'on', '--cache-type-k', 'q8_0', '--cache-type-v', 'q8_0') }
else { $taskArguments += @('-ngl', '0', '--no-mmproj-offload') }
$taskProcess = Start-Process -FilePath $taskSettings.server -ArgumentList $taskArguments -WorkingDirectory (Split-Path -Parent $taskSettings.server) -WindowStyle Hidden -RedirectStandardOutput (Join-Path $PSScriptRoot 'server.stdout.log') -RedirectStandardError (Join-Path $PSScriptRoot 'server.stderr.log') -PassThru
$taskDeadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
while ([DateTime]::UtcNow -lt $taskDeadline) {
    if ($taskProcess.HasExited) { throw "Model server exited ($($taskProcess.ExitCode)). See $PSScriptRoot\server.stderr.log" }
    if (Test-ModelReady) { Write-Output "Model ready at $taskBaseUrl (PID $($taskProcess.Id))"; return }
    Start-Sleep -Seconds 2
}
throw "Startup timed out. The server may still be loading (PID $($taskProcess.Id)); inspect $PSScriptRoot\server.stderr.log before starting again."
