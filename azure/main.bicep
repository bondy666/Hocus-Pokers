// Hocus Pokers — infrastructure as code.
// Provisions: Linux App Service plan + Node web app, Azure SQL server + database,
// and wires SQL_CONNECTION_STRING into the web app settings.
//
// Deploy:
//   az group create -n rg-hocuspokers-prod -l uksouth
//   az deployment group create -g rg-hocuspokers-prod \
//     -f azure/main.bicep -p azure/main.parameters.json -p sqlAdminPassword='<strong-password>'

targetScope = 'resourceGroup'

@description('Base name used to derive resource names.')
param baseName string = 'hocuspokers'

@description('Environment short name (e.g. prod, dev).')
param environment string = 'prod'

@description('Azure region for all resources.')
param location string = resourceGroup().location

@description('App Service plan SKU.')
param appServiceSku string = 'B1'

@description('Node runtime version for the web app.')
param nodeVersion string = '22-lts'

@description('SQL administrator login.')
param sqlAdminUser string = 'hpadmin'

@secure()
@description('SQL administrator password.')
param sqlAdminPassword string

@description('Comma-separated list of organiser emails permitted to make changes. Empty = any signed-in user.')
param adminEmails string = ''

@description('Google OAuth client ID (from Google Cloud console). Leave empty to disable Google sign-in.')
param googleClientId string = ''

@secure()
@description('Google OAuth client secret.')
param googleClientSecret string = ''

@description('Microsoft (Entra ID) application client ID. Leave empty to disable Microsoft sign-in.')
param microsoftClientId string = ''

@secure()
@description('Microsoft (Entra ID) client secret.')
param microsoftClientSecret string = ''

@description('VAPID public key for Web Push (safe to expose to browser clients).')
param vapidPublicKey string = ''

@secure()
@description('VAPID private key for Web Push.')
param vapidPrivateKey string = ''

@description('VAPID subject — a mailto: or https URL identifying the push sender.')
param vapidSubject string = 'mailto:club@hocuspokers.local'

@description('Microsoft token issuer tenant. Use "common" to allow both work/school and personal Microsoft accounts.')
param microsoftTenant string = 'common'

@description('Allow other Azure services to reach the SQL server (App Service outbound).')
param allowAzureServices bool = true

var suffix = uniqueString(resourceGroup().id)
var webAppName = 'app-${baseName}-${environment}-${suffix}'
var planName = 'plan-${baseName}-${environment}'
var sqlServerName = 'sql-${baseName}-${environment}-${suffix}'
var sqlDbName = 'sqldb-${baseName}-${environment}'
var keyVaultName = 'kv-hp-${suffix}'
var kvSecretsBase = 'https://${keyVaultName}.vault.azure.net/secrets'

resource plan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: planName
  location: location
  sku: {
    name: appServiceSku
  }
  kind: 'linux'
  properties: {
    reserved: true
  }
}

resource sqlServer 'Microsoft.Sql/servers@2023-08-01-preview' = {
  name: sqlServerName
  location: location
  properties: {
    administratorLogin: sqlAdminUser
    administratorLoginPassword: sqlAdminPassword
    minimalTlsVersion: '1.2'
    publicNetworkAccess: 'Enabled'
  }
}

resource sqlDb 'Microsoft.Sql/servers/databases@2023-08-01-preview' = {
  parent: sqlServer
  name: sqlDbName
  location: location
  sku: {
    name: 'Basic'
    tier: 'Basic'
  }
  properties: {
    collation: 'SQL_Latin1_General_CP1_CI_AS'
    maxSizeBytes: 2147483648
  }
}

// Allow Azure services (e.g. App Service) to connect. The 0.0.0.0 special rule
// represents "Allow Azure services and resources to access this server".
resource allowAzure 'Microsoft.Sql/servers/firewallRules@2023-08-01-preview' = if (allowAzureServices) {
  parent: sqlServer
  name: 'AllowAllAzureIps'
  properties: {
    startIpAddress: '0.0.0.0'
    endIpAddress: '0.0.0.0'
  }
}

var sqlConnectionString = 'Server=tcp:${sqlServer.properties.fullyQualifiedDomainName},1433;Database=${sqlDbName};User Id=${sqlAdminUser};Password=${sqlAdminPassword};Encrypt=true;TrustServerCertificate=false;Connection Timeout=30;'

resource webApp 'Microsoft.Web/sites@2023-12-01' = {
  name: webAppName
  location: location
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: 'NODE|${nodeVersion}'
      appCommandLine: 'npm start'
      ftpsState: 'Disabled'
      minTlsVersion: '1.2'
    }
  }
}

// Secrets live in Key Vault and are surfaced to the app as Key Vault references,
// resolved at runtime via the web app's managed identity. Kept in a dedicated
// 'appsettings' resource so it can depend on the role assignment + secrets
// existing first (otherwise the references would fail to resolve on first run).
resource webAppSettings 'Microsoft.Web/sites/config@2023-12-01' = {
  parent: webApp
  name: 'appsettings'
  properties: {
    NODE_ENV: 'production'
    PORT: '8080'
    WEBSITES_PORT: '8080'
    SCM_DO_BUILD_DURING_DEPLOYMENT: 'false'
    ADMIN_EMAILS: adminEmails
    VAPID_PUBLIC_KEY: vapidPublicKey
    VAPID_SUBJECT: vapidSubject
    SQL_CONNECTION_STRING: '@Microsoft.KeyVault(SecretUri=${kvSecretsBase}/sql-connection-string/)'
    GOOGLE_PROVIDER_AUTHENTICATION_SECRET: '@Microsoft.KeyVault(SecretUri=${kvSecretsBase}/google-auth-secret/)'
    MICROSOFT_PROVIDER_AUTHENTICATION_SECRET: '@Microsoft.KeyVault(SecretUri=${kvSecretsBase}/microsoft-auth-secret/)'
    VAPID_PRIVATE_KEY: '@Microsoft.KeyVault(SecretUri=${kvSecretsBase}/vapid-private-key/)'
  }
  dependsOn: [
    secretsRoleAssignment
    sqlConnSecret
    googleAuthSecret
    microsoftAuthSecret
    vapidPrivateSecret
  ]
}

// Azure App Service "Easy Auth" — handles Google & Microsoft OAuth in front of
// the app and forwards the signed-in principal to the Node server. The site
// stays publicly viewable (AllowAnonymous); writes are gated in-app by checking
// the principal and the ADMIN_EMAILS allow-list.
resource authSettings 'Microsoft.Web/sites/config@2023-12-01' = {
  parent: webApp
  name: 'authsettingsV2'
  dependsOn: [
    webAppSettings
  ]
  properties: {
    platform: {
      enabled: true
    }
    globalValidation: {
      requireAuthentication: false
      unauthenticatedClientAction: 'AllowAnonymous'
    }
    login: {
      tokenStore: {
        enabled: true
      }
    }
    identityProviders: {
      azureActiveDirectory: {
        enabled: !empty(microsoftClientId)
        registration: {
          openIdIssuer: 'https://login.microsoftonline.com/${microsoftTenant}/v2.0'
          clientId: microsoftClientId
          clientSecretSettingName: 'MICROSOFT_PROVIDER_AUTHENTICATION_SECRET'
        }
        validation: {
          allowedAudiences: [
            microsoftClientId
          ]
        }
      }
      google: {
        enabled: !empty(googleClientId)
        registration: {
          clientId: googleClientId
          clientSecretSettingName: 'GOOGLE_PROVIDER_AUTHENTICATION_SECRET'
        }
        login: {
          scopes: [
            'openid'
            'email'
            'profile'
          ]
        }
      }
    }
  }
}

output webAppName string = webApp.name
output webAppUrl string = 'https://${webApp.properties.defaultHostName}'
output sqlServerFqdn string = sqlServer.properties.fullyQualifiedDomainName
output sqlDatabaseName string = sqlDbName
output keyVaultName string = keyVault.name

// ----- Key Vault for application secrets -----
// RBAC-authorised vault. The web app's managed identity is granted
// "Key Vault Secrets User" so it can resolve the @Microsoft.KeyVault(...)
// references in app settings. NB: whoever runs this deployment needs a
// data-plane role (e.g. "Key Vault Secrets Officer") to write the secrets.
resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: keyVaultName
  location: location
  properties: {
    sku: {
      family: 'A'
      name: 'standard'
    }
    tenantId: subscription().tenantId
    enableRbacAuthorization: true
  }
}

resource sqlConnSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'sql-connection-string'
  properties: {
    value: sqlConnectionString
  }
}

resource googleAuthSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'google-auth-secret'
  properties: {
    value: googleClientSecret
  }
}

resource microsoftAuthSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'microsoft-auth-secret'
  properties: {
    value: microsoftClientSecret
  }
}

resource vapidPrivateSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'vapid-private-key'
  properties: {
    value: vapidPrivateKey
  }
}

// Built-in role: Key Vault Secrets User (read secret values).
var kvSecretsUserRoleId = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '4633458b-17de-408a-b874-0445c86b69e6')

resource secretsRoleAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(keyVault.id, webApp.id, kvSecretsUserRoleId)
  scope: keyVault
  properties: {
    roleDefinitionId: kvSecretsUserRoleId
    principalId: webApp.identity.principalId
    principalType: 'ServicePrincipal'
  }
}
