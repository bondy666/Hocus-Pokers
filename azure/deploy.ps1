# Build and deploy the Hocus Pokers app to the Azure Web App provisioned by
# azure/main.bicep. Run AFTER the infrastructure deployment has succeeded.
#
# It looks up the web app name from the Bicep deployment outputs, builds the
# frontend + server, packages the runtime artefacts (the App Service runs
# `npm start` with SCM build disabled, so we must ship pre-built code plus the
# server's node_modules), and zip-deploys.
#
# Usage (from the repo root or anywhere):
#   ./azure/deploy.ps1
#   ./azure/deploy.ps1 -ResourceGroup rg-hocuspokers-prod -DeploymentName main

[CmdletBinding()]
param(
  [string] $ResourceGroup = "rg-hocuspokers-prod",
  [string] $DeploymentName = "main"
)

$ErrorActionPreference = "Stop"

# Resolve repo root (parent of this script's folder) so the script works from any cwd.
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot
Write-Host "Repo root: $repoRoot" -ForegroundColor DarkGray

Write-Host "Looking up web app name from deployment '$DeploymentName'..." -ForegroundColor Cyan
$webapp = az deployment group show -g $ResourceGroup -n $DeploymentName `
  --query properties.outputs.webAppName.value -o tsv
if (-not $webapp) {
  throw "Could not read webAppName output. Has the infra deployment '$DeploymentName' succeeded in '$ResourceGroup'?"
}
Write-Host "Target web app: $webapp" -ForegroundColor Green

Write-Host "Building frontend + server (npm run build:all)..." -ForegroundColor Cyan
npm run build:all
if ($LASTEXITCODE -ne 0) { throw "build:all failed" }

$zipPath = Join-Path $repoRoot "deploy.zip"
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }

Write-Host "Packaging runtime artefacts into deploy.zip..." -ForegroundColor Cyan
$items = @(
  "dist",
  "server\dist",
  "server\node_modules",
  "server\package.json",
  "package.json"
)
foreach ($i in $items) {
  if (-not (Test-Path $i)) { throw "Expected path not found: $i (did build:all run?)" }
}

# NB: building the zip on Windows PowerShell with Compress-Archive or
# ZipFile.CreateFromDirectory writes entry names with BACKSLASH separators,
# which Linux/Kudu treats as a single odd filename (so 'server/dist/index.js'
# never exists and the app fails with MODULE_NOT_FOUND). We therefore add each
# file explicitly with a forward-slash entry name.
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

# Map of source path -> archive prefix. Directories are walked recursively.
$sources = @(
  @{ Path = "dist";                Prefix = "dist" },
  @{ Path = "server\dist";         Prefix = "server/dist" },
  @{ Path = "server\node_modules"; Prefix = "server/node_modules" }
)
$files = @(
  @{ Path = "server\package.json"; Entry = "server/package.json" },
  @{ Path = "package.json";        Entry = "package.json" }
)

$zip = [System.IO.Compression.ZipFile]::Open($zipPath, [System.IO.Compression.ZipArchiveMode]::Create)
try {
  foreach ($s in $sources) {
    $root = (Resolve-Path $s.Path).Path
    Get-ChildItem -Path $root -Recurse -File | ForEach-Object {
      $rel = $_.FullName.Substring($root.Length).TrimStart('\','/').Replace('\','/')
      $entryName = "$($s.Prefix)/$rel"
      [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $_.FullName, $entryName) | Out-Null
    }
  }
  foreach ($f in $files) {
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, (Resolve-Path $f.Path).Path, $f.Entry) | Out-Null
  }
}
finally {
  $zip.Dispose()
}

Write-Host "Deploying to Azure (zip deploy)..." -ForegroundColor Cyan
az webapp deploy -g $ResourceGroup -n $webapp --src-path $zipPath --type zip
if ($LASTEXITCODE -ne 0) { throw "az webapp deploy failed" }

$url = az deployment group show -g $ResourceGroup -n $DeploymentName `
  --query properties.outputs.webAppUrl.value -o tsv
Write-Host "`nDeployed. Your site:" -ForegroundColor Green
Write-Host "  $url"
Write-Host "`n(First load may be slow on the Free tier while the app warms up.)" -ForegroundColor DarkGray
