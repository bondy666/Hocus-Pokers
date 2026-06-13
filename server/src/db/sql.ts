import "dotenv/config";
import sql from "mssql";

const connectionString = process.env.SQL_CONNECTION_STRING;

// The pool is optional: when no connection string is configured the API
// falls back to bundled seed data so the app still runs locally.
export const sqlConfigured = Boolean(connectionString);

let poolPromise: Promise<sql.ConnectionPool> | null = null;

export function getPool(): Promise<sql.ConnectionPool> {
  if (!connectionString) {
    return Promise.reject(new Error("SQL_CONNECTION_STRING is not set"));
  }
  if (!poolPromise) {
    poolPromise = new sql.ConnectionPool(connectionString)
      .connect()
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
