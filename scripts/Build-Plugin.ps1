[CmdletBinding()]
param(
    [switch]$Deploy,
    [switch]$Test,
    [switch]$SkipInstall,
    [string]$PluginDir = $env:OBSIDIAN_PLUGIN_DIR
)

$ErrorActionPreference = 'Stop'

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
$BuildDir = Join-Path $RepoRoot 'build\gpt4free-text-generator-plugin'

function Invoke-LoggedCommand {
    param(
        [Parameter(Mandatory = $true)]
        [string]$FilePath,
        [Parameter(ValueFromRemainingArguments = $true)]
        [string[]]$Arguments
    )

    Write-Host "> $FilePath $($Arguments -join ' ')" -ForegroundColor Cyan
    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Command failed with exit code $LASTEXITCODE`: $FilePath $($Arguments -join ' ')"
    }
}

Push-Location $RepoRoot
try {
    if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
        throw 'npm was not found. Install Node.js/npm before building this plugin.'
    }

    if (-not $SkipInstall -and -not (Test-Path (Join-Path $RepoRoot 'node_modules'))) {
        if (Test-Path (Join-Path $RepoRoot 'package-lock.json')) {
            Invoke-LoggedCommand npm ci
        } else {
            Invoke-LoggedCommand npm install
        }
    }

    Invoke-LoggedCommand npm run build

    if (-not (Test-Path (Join-Path $BuildDir 'main.js'))) {
        throw "Build did not produce expected bundle: $BuildDir\main.js"
    }

    if ($Test) {
        Invoke-LoggedCommand npm test
    }

    if ($Deploy) {
        if ([string]::IsNullOrWhiteSpace($PluginDir)) {
            throw 'Deploy requested, but no plugin directory was provided. Pass -PluginDir or set OBSIDIAN_PLUGIN_DIR.'
        }

        $env:OBSIDIAN_PLUGIN_DIR = $PluginDir
        Invoke-LoggedCommand npm run deploy
    }

    Write-Host "Build package ready: $BuildDir" -ForegroundColor Green
    if ($Deploy) {
        Write-Host "Deployed to: $PluginDir" -ForegroundColor Green
        Write-Host 'Runtime files data.json and transcripts.db were not touched.' -ForegroundColor Yellow
    }
} finally {
    Pop-Location
}
