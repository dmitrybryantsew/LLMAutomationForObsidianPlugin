<#
.SYNOPSIS
    Builds the Android bundle of the Obsidian plugin and deploys it via ADB.
.PARAMETER VaultName
    Specific vault name on device (e.g. "knowledgeBase"). If omitted, deploys to all detected vaults.
.PARAMETER AdbPath
    Custom path to adb.exe. If omitted, searches PATH and standard Android SDK locations.
#>
[CmdletBinding()]
param(
    [string]$VaultName,
    [string]$AdbPath
)

$ErrorActionPreference = 'Stop'

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
$BuildDir = Join-Path $RepoRoot 'build\android'
$PluginId = 'gpt4free-text-generator-plugin'

# 1. Resolve ADB
if (-not $AdbPath) {
    if (Get-Command adb -ErrorAction SilentlyContinue) {
        $AdbPath = (Get-Command adb).Source
    } else {
        $candidatePaths = @(
            "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe",
            "$env:ProgramFiles\Android\platform-tools\adb.exe"
        )
        foreach ($cand in $candidatePaths) {
            if (Test-Path $cand) {
                $AdbPath = $cand
                break
            }
        }
    }
}

if (-not $AdbPath -or -not (Test-Path $AdbPath)) {
    throw "adb.exe was not found. Please specify -AdbPath or ensure the Android SDK is installed."
}

# 2. Check connected device
Write-Host "Checking connected ADB devices..." -ForegroundColor Cyan
$devicesOutput = & $AdbPath devices
$deviceLines = @($devicesOutput | Where-Object { $_ -match '\tdevice$' })
if ($deviceLines.Count -eq 0) {
    throw "No connected Android devices found. Please connect your device with USB debugging enabled."
}
$firstDevice = $deviceLines[0].Split("`t")[0]
Write-Host "Device detected: $firstDevice" -ForegroundColor Green

# 3. Build Android package
Push-Location $RepoRoot
try {
    Write-Host "Building plugin for Android..." -ForegroundColor Cyan
    & npm run build:android
    if ($LASTEXITCODE -ne 0) {
        throw "npm run build:android failed with exit code $LASTEXITCODE"
    }
} finally {
    Pop-Location
}

# 4. Find vaults on device
Write-Host "Locating Obsidian vaults on device..." -ForegroundColor Cyan
$rawFound = & $AdbPath shell "find /sdcard/ -name .obsidian 2>/dev/null"
$vaultObsidianDirs = @($rawFound -split "`r?`n" | Where-Object { $_ -match '/\.obsidian$' } | ForEach-Object { $_.Trim() } | Where-Object { $_.Length -gt 0 })

if ($vaultObsidianDirs.Count -eq 0) {
    throw "No Obsidian vaults found on the connected device."
}

$deployCount = 0
foreach ($obsDir in $vaultObsidianDirs) {
    $currentVault = ($obsDir -replace '/\.obsidian$', '') -split '/' | Select-Object -Last 1
    if ($VaultName -and $currentVault -ne $VaultName) {
        continue
    }

    Write-Host "`nDeploying to vault: $currentVault ($obsDir)..." -ForegroundColor Yellow
    $pluginTargetDir = "$obsDir/plugins/$PluginId"

    & $AdbPath shell "mkdir -p '$pluginTargetDir'"

    & $AdbPath push "$BuildDir/main.js" "$pluginTargetDir/main.js"
    & $AdbPath push "$BuildDir/manifest.json" "$pluginTargetDir/manifest.json"
    & $AdbPath push "$BuildDir/styles.css" "$pluginTargetDir/styles.css"
    & $AdbPath push "$BuildDir/sql-wasm.wasm" "$pluginTargetDir/sql-wasm.wasm"

    # Configure sync settings in data.json if present
    $dataJsonPath = "$pluginTargetDir/data.json"
    $existingDataJson = & $AdbPath shell "cat '$dataJsonPath' 2>/dev/null"
    if ($existingDataJson -match '\{') {
        try {
            $dataObj = $existingDataJson | ConvertFrom-Json
            if (-not $dataObj.PSObject.Properties['noteSyncDeviceRole']) { $dataObj | Add-Member -NotePropertyName 'noteSyncDeviceRole' -NotePropertyValue 'mobile' } else { $dataObj.noteSyncDeviceRole = 'mobile' }
            if (-not $dataObj.PSObject.Properties['noteSyncEndpoint']) { $dataObj | Add-Member -NotePropertyName 'noteSyncEndpoint' -NotePropertyValue 'https://obsidianvault.duckdns.org' } else { $dataObj.noteSyncEndpoint = 'https://obsidianvault.duckdns.org' }
            if (-not $dataObj.PSObject.Properties['cardSyncEndpoint']) { $dataObj | Add-Member -NotePropertyName 'cardSyncEndpoint' -NotePropertyValue 'https://obsidianvault.duckdns.org' } else { $dataObj.cardSyncEndpoint = 'https://obsidianvault.duckdns.org' }
            if (-not $dataObj.PSObject.Properties['cardSyncApiKey']) { $dataObj | Add-Member -NotePropertyName 'cardSyncApiKey' -NotePropertyValue '8z3qHsPTrSoLD4lN/Eaud/D6A5ffW57U00oCEsijCyY=' } else { $dataObj.cardSyncApiKey = '8z3qHsPTrSoLD4lN/Eaud/D6A5ffW57U00oCEsijCyY=' }
            if (-not $dataObj.PSObject.Properties['noteSyncApiKey']) { $dataObj | Add-Member -NotePropertyName 'noteSyncApiKey' -NotePropertyValue '8z3qHsPTrSoLD4lN/Eaud/D6A5ffW57U00oCEsijCyY=' } else { $dataObj.noteSyncApiKey = '8z3qHsPTrSoLD4lN/Eaud/D6A5ffW57U00oCEsijCyY=' }
            if (-not $dataObj.PSObject.Properties['noteSyncOnStartup']) { $dataObj | Add-Member -NotePropertyName 'noteSyncOnStartup' -NotePropertyValue $true } else { $dataObj.noteSyncOnStartup = $true }
            if (-not $dataObj.PSObject.Properties['noteSyncAutoSyncIntervalMinutes']) { $dataObj | Add-Member -NotePropertyName 'noteSyncAutoSyncIntervalMinutes' -NotePropertyValue 10 } else { $dataObj.noteSyncAutoSyncIntervalMinutes = 10 }

            $tempDataFile = [System.IO.Path]::GetTempFileName()
            $dataObj | ConvertTo-Json -Depth 20 | Set-Content -Path $tempDataFile -Encoding utf8
            & $AdbPath push $tempDataFile $dataJsonPath
            Remove-Item $tempDataFile -Force
            Write-Host "Configured sync settings in $dataJsonPath" -ForegroundColor Green
        } catch {
            Write-Host "Warning: Could not configure ${dataJsonPath}: $_" -ForegroundColor DarkYellow
        }
    }

    # Ensure plugin is enabled in community-plugins.json
    $commPluginsPath = "$obsDir/community-plugins.json"
    $existingPluginsJson = & $AdbPath shell "cat '$commPluginsPath' 2>/dev/null"
    if ($existingPluginsJson -match '\[') {
        try {
            $parsed = $existingPluginsJson | ConvertFrom-Json
            if ($parsed -notcontains $PluginId) {
                $parsed += $PluginId
                $updatedJson = $parsed | ConvertTo-Json -Depth 5
                $tempFile = [System.IO.Path]::GetTempFileName()
                $updatedJson | Set-Content -Path $tempFile -Encoding utf8
                & $AdbPath push $tempFile $commPluginsPath
                Remove-Item $tempFile -Force
                Write-Host "Enabled $PluginId in $commPluginsPath" -ForegroundColor Green
            }
        } catch {
            Write-Host "Warning: Could not parse $commPluginsPath, skipping auto-enable." -ForegroundColor DarkYellow
        }
    }

    $deployCount++
}

Write-Host "`nSuccessfully deployed to $deployCount vault(s)!" -ForegroundColor Green
