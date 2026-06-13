# Provision the Microsoft Entra app registration for Hocus Pokers Easy Auth.
#
# Easy Auth's Microsoft (azureActiveDirectory) provider needs an Entra app
# registration with a client secret and the App Service callback as a redirect
# URI. Entra app registrations cannot be created in pure ARM/Bicep, so this
# script uses the Azure CLI. Run it once, then feed the printed values into the
# Bicep deployment (microsoftClientId / microsoftClientSecret).
#
# Google OAuth is NOT scriptable with the Azure CLI — create that client
# manually in the Google Cloud console (see README "Authentication").
#
# Prerequisites: `az login` with rights to create app registrations.
#
# Usage:
#   ./setup-auth.ps1 -AppName "hocuspokers-web" -SiteHostname "hocuspokers-web.azurewebsites.net"

[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)] [string] $AppName,
  [Parameter(Mandatory = $true)] [string] $SiteHostname,
  # 'common' = personal + work/school accounts; or a specific tenant id.
  [string] $SignInAudience = "AzureADandPersonalMicrosoftAccount"
)

$ErrorActionPreference = "Stop"

$redirectUri = "https://$SiteHostname/.auth/login/aad/callback"
Write-Host "Creating Entra app '$AppName' with redirect URI:`n  $redirectUri" -ForegroundColor Cyan

# Create (or reuse) the app registration.
$existing = az ad app list --display-name $AppName --query "[0].appId" -o tsv
if ($existing) {
  Write-Host "An app named '$AppName' already exists (appId $existing); reusing it." -ForegroundColor Yellow
  $appId = $existing
  az ad app update --id $appId `
    --web-redirect-uris $redirectUri `
    --sign-in-audience $SignInAudience | Out-Null
} else {
  $appId = az ad app create `
    --display-name $AppName `
    --sign-in-audience $SignInAudience `
    --web-redirect-uris $redirectUri `
    --query appId -o tsv
}

# Easy Auth uses the hybrid flow (response_type=code id_token), so the app
# registration MUST issue ID tokens. This is OFF by default on a new
# registration and, if left off, the /.auth/login/aad/callback returns HTTP 401.
az ad app update --id $appId --enable-id-token-issuance true | Out-Null

# Generate a client secret (valid 2 years).
$secret = az ad app credential reset `
  --id $appId `
  --display-name "easy-auth" `
  --years 2 `
  --query password -o tsv

Write-Host "`nEntra app registration ready." -ForegroundColor Green
Write-Host "Feed these into the Bicep deployment (treat the secret as sensitive):`n"
Write-Host "  microsoftClientId     = $appId"
Write-Host "  microsoftClientSecret = $secret"
Write-Host "`nExample:" -ForegroundColor DarkGray
Write-Host "  az deployment group create -g <rg> -f azure/main.bicep \\" -ForegroundColor DarkGray
Write-Host "    -p microsoftClientId=$appId microsoftClientSecret=$secret ..." -ForegroundColor DarkGray
