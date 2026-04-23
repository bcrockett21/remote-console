$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$appPackageRoot = Join-Path $repoRoot "apps\teams-tab\appPackage"
$manifestPath = Join-Path $appPackageRoot "dist\manifest.json"
$colorIconPath = Join-Path $appPackageRoot "color.png"
$outlineIconPath = Join-Path $appPackageRoot "outline.png"
$packageStageDir = Join-Path $appPackageRoot "dist\package"
$packageZipPath = Join-Path $appPackageRoot "dist\teams-app-package.zip"

if (-not (Test-Path $manifestPath)) {
  throw "Manifest was not found at '$manifestPath'. Run 'npm run build:teams-manifest' first."
}

if (-not (Test-Path $colorIconPath)) {
  throw "Color icon was not found at '$colorIconPath'."
}

if (-not (Test-Path $outlineIconPath)) {
  throw "Outline icon was not found at '$outlineIconPath'."
}

if (Test-Path $packageStageDir) {
  Remove-Item -LiteralPath $packageStageDir -Recurse -Force
}

if (Test-Path $packageZipPath) {
  Remove-Item -LiteralPath $packageZipPath -Force
}

New-Item -ItemType Directory -Path $packageStageDir | Out-Null
Copy-Item -LiteralPath $manifestPath -Destination (Join-Path $packageStageDir "manifest.json")
Copy-Item -LiteralPath $colorIconPath -Destination (Join-Path $packageStageDir "color.png")
Copy-Item -LiteralPath $outlineIconPath -Destination (Join-Path $packageStageDir "outline.png")

Compress-Archive -LiteralPath (Join-Path $packageStageDir "*") -DestinationPath $packageZipPath

Write-Host "teams app package written to $packageZipPath"
