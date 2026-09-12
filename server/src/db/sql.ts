import "dotenv/config";
import sql from "mssql";
import { DefaultAzureCredential } from "@azure/identity";

const connectionString = process.env.SQL_CONNECTION_STRING;

// The pool is optional: when no connection string is configured the API
// falls back to bundled seed data so the app still runs locally.
export const sqlConfigured = Boolean(connectionString);

let poolPromise: Promise<sql.ConnectionPool> | null = null;

// Pull a value for a keyword out of an ODBC-style connection string.
function readKey(cs: string, key: string): string | undefined {
  const m = cs.match(new RegExp(`${key}\\s*=\\s*([^;]+)`, "i"));
  return m ? m[1].trim().replace(/^"|"$/g, "") : undefined;
}

// Build an mssql config. Precedence:
//  1. SQL_USER + SQL_PASSWORD env vars -> SQL auth (password taken verbatim, so
//     special characters don't need connection-string escaping).
//  2. Connection string asking for Azure AD -> token via DefaultAzureCredential.
//  3. Otherwise the raw connection string is passed straight through.
async function buildConfig(cs: string): Promise<sql.config | string> {
  const rawServer = readKey(cs, "Server") ?? readKey(cs, "Data Source") ?? "";
  const hostPort = rawServer.replace(/^tcp:/i, "");
  const [host, portStr] = hostPort.split(",");
  const database = readKey(cs, "Initial Catalog") ?? readKey(cs, "Database") ?? "";
  const port = portStr ? Number(portStr) : 1433;

  const user = process.env.SQL_USER;
  const password = process.env.SQL_PASSWORD;
  if (user && password) {
    return {
      server: host,
      port,
      database,
      user,
      password,
      options: { encrypt: true, trustServerCertificate: false },
    };
  }

  const auth = readKey(cs, "Authentication");
  if (!auth || !/active directory/i.test(auth)) return cs;

  const credential = new DefaultAzureCredential();
  const accessToken = await credential.getToken("https://database.windows.net/.default");
  if (!accessToken) throw new Error("Could not acquire an Azure AD token for SQL");

  return {
    server: host,
    port,
    database,
    options: { encrypt: true, trustServerCertificate: false },
    authentication: {
      type: "azure-active-directory-access-token",
      options: { token: accessToken.token },
    },
  };
}

export function getPool(): Promise<sql.ConnectionPool> {
  if (!connectionString) {
    return Promise.reject(new Error("SQL_CONNECTION_STRING is not set"));
  }
  if (!poolPromise) {
    poolPromise = buildConfig(connectionString)
      .then((config) => new sql.ConnectionPool(config as any).connect())
      .then((pool) => {
        console.log("Connected to Azure SQL");
        return pool;
      })
      .catch((err) => {
        poolPromise = null;
        console.error("SQL connection failed", err);
        throw err;
      });
  }
  return poolPromise;
}

export { sql };
