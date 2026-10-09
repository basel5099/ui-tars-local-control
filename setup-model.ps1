[CmdletBinding()]
param(
    [string]$ModelRoot = (Join-Path $env:LOCALAPPDATA 'UI-TARS-Local-Control\model'),
    [ValidateSet('auto','cuda','cpu')][string]$Backend = 'auto',
    [ValidateRange(1024,65535)][int]$Port = 8080,
    [string]$ModelDirectory,
    [string]$DownloadDirectory,
    [ValidateRange(4096,131072)][int]$ContextSize = 32768,
    [switch]$CheckOnly,
    [switch]$Start
)
$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT' -or -not [Environment]::Is64BitOperatingSystem -or $env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { throw 'This installer supports Windows x64.' }
$taskManifest = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'model\manifest.json') -Raw | ConvertFrom-Json
$ModelRoot = [IO.Path]::GetFullPath($ModelRoot)
if (-not $ModelDirectory) { $ModelDirectory = Join-Path $ModelRoot 'models' }
if (-not $DownloadDirectory) { $DownloadDirectory = Join-Path $ModelRoot 'downloads' }
$ModelDirectory = [IO.Path]::GetFullPath($ModelDirectory)
$DownloadDirectory = [IO.Path]::GetFullPath($DownloadDirectory)
$taskGpu = @(Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name)
if ($Backend -eq 'auto') { $Backend = if ($taskGpu -match 'NVIDIA') { 'cuda' } else { 'cpu' } }
$taskRuntime = Join-Path $ModelRoot ("runtime-" + $taskManifest.runtime_release + '-' + $Backend)
$taskAssets = @($taskManifest.runtime.$Backend)
Write-Output ('Detected graphics: ' + ($taskGpu -join ', '))
Write-Output "Backend: $Backend; model directory: $ModelDirectory"
Write-Output 'UI-TARS 1.5 7B Q4_K_M + vision projector: 6.13 GB. Allow about 9 GB free for a complete CUDA installation.'
if ($Backend -eq 'cpu') { Write-Warning 'CPU mode is much slower; allow longer task timeouts. CUDA was tested on a 12 GB NVIDIA GPU.' }

# Account for downloads and extraction on each selected volume before writing files.
$taskNeeded = @{}
function Add-SpaceRequirement([string]$Path, [long]$Bytes) {
    $taskVolume = [IO.Path]::GetPathRoot($Path)
    if (-not $taskNeeded.ContainsKey($taskVolume)) { $taskNeeded[$taskVolume] = [long]0 }
    $taskNeeded[$taskVolume] += $Bytes
}
foreach ($taskAsset in $taskManifest.models) {
    $taskPath = Join-Path $ModelDirectory $taskAsset.name
    if (-not (Test-Path -LiteralPath $taskPath)) { Add-SpaceRequirement $ModelDirectory $taskAsset.size }
}
foreach ($taskAsset in $taskAssets) {
    if (-not (Test-Path -LiteralPath (Join-Path $DownloadDirectory $taskAsset.name))) { Add-SpaceRequirement $DownloadDirectory $taskAsset.size }
}
Add-SpaceRequirement $ModelRoot ([long](($taskAssets | Measure-Object size -Sum).Sum * 3) + 512MB)
foreach ($taskVolume in $taskNeeded.Keys) {
    $taskDrive = [IO.DriveInfo]::new($taskVolume)
    Write-Output ("{0} free {1:N2} GB; estimated additional requirement {2:N2} GB" -f $taskVolume, ($taskDrive.AvailableFreeSpace/1GB), ($taskNeeded[$taskVolume]/1GB))
    if ($taskDrive.AvailableFreeSpace -lt $taskNeeded[$taskVolume]) { throw "Insufficient space on $taskVolume. Choose ModelRoot/ModelDirectory/DownloadDirectory on another drive." }
}
if ($CheckOnly) { Write-Output 'Preflight complete; nothing downloaded or changed.'; return }
$taskNode = (Get-Command node -ErrorAction Stop).Source
$taskNodeVersion = & $taskNode --version
if ([version]$taskNodeVersion.TrimStart('v') -lt [version]'22.0.0') { throw 'Install Node.js 22 or newer first.' }
$taskRuntimeProcess = @(Get-CimInstance Win32_Process -Filter "Name = 'llama-server.exe'" | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($taskRuntime.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase) })
if ($taskRuntimeProcess.Count -gt 0) { throw 'This runtime is already running. Reuse its launcher with install.ps1 -ModelLauncher, or stop the model server before rerunning model setup.' }
New-Item -ItemType Directory -Path $ModelRoot,$ModelDirectory,$DownloadDirectory,$taskRuntime -Force | Out-Null

function Assert-Asset([string]$Path, $Asset) {
    if ((Get-Item -LiteralPath $Path).Length -ne $Asset.size) { throw "Incorrect size: $Path. Keep or move it aside and retry; existing files are never silently overwritten." }
    Write-Output "Verifying SHA-256: $($Asset.name)"
    if ((Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant() -ne $Asset.sha256) { throw "SHA-256 mismatch: $Path. Do not use this file. Move it aside and rerun setup." }
}
function Get-VerifiedAsset([string]$Url, [string]$Destination, $Asset) {
    if (Test-Path -LiteralPath $Destination) { Assert-Asset $Destination $Asset; return }
    $taskPartial = $Destination + '.partial'
    if (-not (Test-Path -LiteralPath $taskPartial) -or (Get-Item -LiteralPath $taskPartial).Length -ne $Asset.size) {
        Write-Output "Downloading $($Asset.name) (resumable)"
        & $taskNode (Join-Path $PSScriptRoot 'src\download.mjs') $Url $taskPartial $Asset.size
        if ($LASTEXITCODE -ne 0) { throw "Download interrupted: $($Asset.name). Rerun the same command to resume." }
    }
    Assert-Asset $taskPartial $Asset
    Move-Item -LiteralPath $taskPartial -Destination $Destination
}
foreach ($taskAsset in $taskManifest.models) {
    $taskUrl = "$($taskManifest.model_source)/resolve/$($taskManifest.model_revision)/$($taskAsset.name)?download=true"
    Get-VerifiedAsset $taskUrl (Join-Path $ModelDirectory $taskAsset.name) $taskAsset
}
foreach ($taskAsset in $taskAssets) {
    $taskArchive = Join-Path $DownloadDirectory $taskAsset.name
    Get-VerifiedAsset "https://github.com/ggml-org/llama.cpp/releases/download/$($taskManifest.runtime_release)/$($taskAsset.name)" $taskArchive $taskAsset
    Expand-Archive -LiteralPath $taskArchive -DestinationPath $taskRuntime -Force
}
$taskServers = @(Get-ChildItem -LiteralPath $taskRuntime -Filter llama-server.exe -Recurse)
if ($taskServers.Count -ne 1) { throw 'Expected exactly one llama-server.exe in the extracted runtime.' }
$taskServerDirectory = $taskServers[0].DirectoryName
# Some release archives place CUDA DLLs in a sibling directory.
Get-ChildItem -LiteralPath $taskRuntime -Filter *.dll -Recurse | Where-Object DirectoryName -NE $taskServerDirectory | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $taskServerDirectory -Force }
$taskSettings = @{
    server = $taskServers[0].FullName; model = (Join-Path $ModelDirectory $taskManifest.models[0].name)
    projector = (Join-Path $ModelDirectory $taskManifest.models[1].name); model_id = $taskManifest.model_id
    port = $Port; backend = $Backend; context_size = $ContextSize
}
$taskSettings | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $ModelRoot 'model.config.json') -Encoding utf8
$taskLauncher = Join-Path $ModelRoot 'Start-Model.ps1'
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'model\Start-Model.ps1') -Destination $taskLauncher -Force
Write-Output "Verified model and runtime installed. Launcher: $taskLauncher"
if ($Start) { & $taskLauncher -ModelOnly }
