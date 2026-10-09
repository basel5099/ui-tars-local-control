# Invoke the bridge CLI from any working directory. Arguments are passed as data.
$ErrorActionPreference = 'Stop'
$taskArguments = $args
$taskSettingsPath = Join-Path (Split-Path -Parent $PSScriptRoot) 'runtime.json'
$taskInstall = $env:UI_TARS_CONTROL_HOME
if (-not $taskInstall -and (Test-Path -LiteralPath $taskSettingsPath)) {
    $taskInstall = (Get-Content -LiteralPath $taskSettingsPath -Raw | ConvertFrom-Json).install_directory
}
if (-not $taskInstall) { $taskInstall = Join-Path $env:LOCALAPPDATA 'UI-TARS-Local-Control' }
$taskCli = Join-Path $taskInstall 'src\cli.mjs'
if (-not (Test-Path -LiteralPath $taskCli)) { throw 'Bridge is not installed. Run install.ps1 from the UI-TARS Local Control repository first.' }
& node $taskCli @taskArguments
exit $LASTEXITCODE
