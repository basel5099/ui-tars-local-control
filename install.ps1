[CmdletBinding()]
param(
    [string]$InstallDirectory = (Join-Path $env:LOCALAPPDATA 'UI-TARS-Local-Control'),
    [string]$SkillDirectory,
    [string]$ModelBaseUrl,
    [string]$ModelName,
    [string]$ModelLauncher,
    [switch]$WithModel,
    [string]$ModelRoot,
    [string]$ModelDirectory,
    [ValidateSet('auto','cuda','cpu')][string]$Backend = 'auto',
    [ValidateRange(1024,65535)][int]$ModelPort = 8080,
    [switch]$SkipMcpRegistration
)
$ErrorActionPreference = 'Stop'
$taskSource = $PSScriptRoot
if ($env:OS -ne 'Windows_NT') { throw 'UI-TARS Local Control requires Windows.' }
$taskNode = (Get-Command node -ErrorAction Stop).Source
$taskNpm = (Get-Command npm.cmd -ErrorAction Stop).Source
$taskNodeVersion = & $taskNode --version
if ([version]$taskNodeVersion.TrimStart('v') -lt [version]'22.0.0') { throw 'Install Node.js 22 or newer first.' }
if (-not $SkipMcpRegistration) { $taskCodex = (Get-Command codex -ErrorAction Stop).Source }
$InstallDirectory = [IO.Path]::GetFullPath($InstallDirectory)
if ($InstallDirectory.TrimEnd('\') -eq $taskSource.TrimEnd('\')) { throw 'Choose an install directory different from the source checkout.' }
if (-not $SkillDirectory) {
    $taskCodexRoot = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $env:USERPROFILE '.codex' }
    $SkillDirectory = Join-Path $taskCodexRoot 'skills\ui-tars-local-control'
}
$SkillDirectory = [IO.Path]::GetFullPath($SkillDirectory)
if ($SkillDirectory.TrimEnd('\') -eq (Join-Path $taskSource 'skill').TrimEnd('\')) { throw 'Choose a skill directory different from the source skill.' }

# Preserve local settings on reinstall unless the caller explicitly replaces them.
$taskConfigPath = Join-Path $InstallDirectory 'control.config.json'
$taskSettings = @{ base_url = 'http://127.0.0.1:8080/v1'; model = 'ui-tars-1.5-7b'; launcher = $null }
if (Test-Path -LiteralPath $taskConfigPath) {
    $taskPrevious = Get-Content -LiteralPath $taskConfigPath -Raw | ConvertFrom-Json
    foreach ($taskProperty in $taskPrevious.PSObject.Properties) { $taskSettings[$taskProperty.Name] = $taskProperty.Value }
}
if ($PSBoundParameters.ContainsKey('ModelBaseUrl')) { $taskSettings.base_url = $ModelBaseUrl }
if ($PSBoundParameters.ContainsKey('ModelName')) { $taskSettings.model = $ModelName }
if ($PSBoundParameters.ContainsKey('ModelLauncher')) { $taskSettings.launcher = $ModelLauncher }
$taskDataDirectory = if ($env:UI_TARS_CONTROL_DATA) { $env:UI_TARS_CONTROL_DATA } elseif ($taskSettings.data_directory) { $taskSettings.data_directory } else { Join-Path $InstallDirectory 'data' }
$taskLock = Join-Path $taskDataDirectory 'active.lock'
if (Test-Path -LiteralPath $taskLock) { throw 'A task lock exists. Check bridge health and stop any active task before reinstalling.' }
if ($WithModel) {
    if ($PSBoundParameters.ContainsKey('ModelBaseUrl') -or $PSBoundParameters.ContainsKey('ModelName') -or $PSBoundParameters.ContainsKey('ModelLauncher')) { throw 'Use WithModel with ModelRoot/Backend/ModelPort, or configure an existing endpoint with ModelBaseUrl/ModelName/ModelLauncher.' }
    if (-not $ModelRoot) { $ModelRoot = Join-Path $InstallDirectory 'model' }
    $ModelRoot = [IO.Path]::GetFullPath($ModelRoot)
    & (Join-Path $taskSource 'setup-model.ps1') -ModelRoot $ModelRoot -ModelDirectory $ModelDirectory -Backend $Backend -Port $ModelPort -Start
    $taskSettings.base_url = "http://127.0.0.1:$ModelPort/v1"
    $taskSettings.model = 'ui-tars-1.5-7b'
    $taskSettings.launcher = Join-Path $ModelRoot 'Start-Model.ps1'
}
$taskEndpoint = [uri]$taskSettings.base_url
if ($taskEndpoint.Host -notin @('localhost', '127.0.0.1', '[::1]') -or $taskEndpoint.Scheme -notin @('http', 'https') -or $taskEndpoint.UserInfo) { throw 'ModelBaseUrl must be a loopback HTTP(S) endpoint without URL credentials.' }
if (-not $taskSettings.model) { throw 'ModelName cannot be empty.' }
if ($taskSettings.launcher) {
    $taskSettings.launcher = (Resolve-Path -LiteralPath $taskSettings.launcher -ErrorAction Stop).Path
    if ([IO.Path]::GetExtension($taskSettings.launcher) -ne '.ps1') { throw 'ModelLauncher must be a PowerShell .ps1 file accepting -ModelOnly.' }
}

New-Item -ItemType Directory -Path $InstallDirectory,(Join-Path $InstallDirectory 'src'),(Join-Path $InstallDirectory 'test') -Force | Out-Null
Copy-Item -Path (Join-Path $taskSource 'src\*') -Destination (Join-Path $InstallDirectory 'src') -Force
Copy-Item -Path (Join-Path $taskSource 'test\*.mjs') -Destination (Join-Path $InstallDirectory 'test') -Force
Copy-Item -LiteralPath (Join-Path $taskSource 'package.json'),(Join-Path $taskSource 'package-lock.json') -Destination $InstallDirectory -Force
$taskSettings | ConvertTo-Json | Set-Content -LiteralPath $taskConfigPath -Encoding utf8
Push-Location $InstallDirectory
try {
    & $taskNpm ci --omit=dev
    if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
    $taskTests = @(Get-ChildItem -Path test\*.test.mjs | Select-Object -ExpandProperty FullName)
    & $taskNode --test @taskTests
    if ($LASTEXITCODE -ne 0) { throw 'Bridge checks failed.' }
    & $taskNode test/mcp-check.mjs
    if ($LASTEXITCODE -ne 0) { throw 'MCP checks failed.' }
} finally { Pop-Location }

New-Item -ItemType Directory -Path $SkillDirectory,(Join-Path $SkillDirectory 'agents'),(Join-Path $SkillDirectory 'scripts') -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $taskSource 'skill\SKILL.md') -Destination $SkillDirectory -Force
Copy-Item -LiteralPath (Join-Path $taskSource 'skill\agents\openai.yaml') -Destination (Join-Path $SkillDirectory 'agents') -Force
Copy-Item -LiteralPath (Join-Path $taskSource 'skill\scripts\control.ps1') -Destination (Join-Path $SkillDirectory 'scripts') -Force
@{ install_directory = $InstallDirectory } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $SkillDirectory 'runtime.json') -Encoding utf8
if (-not $SkipMcpRegistration) {
    & $taskCodex mcp add ui_tars_local_control -- $taskNode (Join-Path $InstallDirectory 'src\server.mjs')
    if ($LASTEXITCODE -ne 0) { throw 'MCP registration failed. The bridge and skill are installed; register the server manually.' }
}
Write-Output "Installed UI-TARS Local Control in $InstallDirectory"
Write-Output "Installed skill in $SkillDirectory"
