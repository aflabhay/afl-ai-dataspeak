/**
 * src/fabric/fabric.client.js
 * ────────────────────────────
 * Microsoft Fabric / SQL Server connection pool using mssql.
 *
 * Authentication: Azure Active Directory with client credentials
 * (service principal). Requires:
 *   FABRIC_SERVER        — e.g. abc123.datawarehouse.fabric.microsoft.com
 *   FABRIC_DATABASE      — e.g. Arvind_Analytics_Warehouse
 *   FABRIC_CLIENT_ID     — Azure AD app client ID
 *   FABRIC_CLIENT_SECRET — Azure AD app client secret
 *   FABRIC_TENANT_ID     — Azure tenant ID
 */

const sql    = require('mssql');
const logger = require('../utils/logger');

let _pool = null;

/**
 * Get (or create) the mssql connection pool.
 * @returns {Promise<sql.ConnectionPool>}
 */
async function getPool() {
  if (_pool && _pool.connected) return _pool;

  const config = {
    server:   process.env.FABRIC_SERVER,
    database: process.env.FABRIC_DATABASE,
    authentication: {
      type: 'azure-active-directory-service-principal-secret',
      options: {
        clientId:     process.env.FABRIC_CLIENT_ID,
        clientSecret: process.env.FABRIC_CLIENT_SECRET,
        tenantId:     process.env.FABRIC_TENANT_ID,
      },
    },
    options: {
      encrypt:              true,
      trustServerCertificate: false,
      enableArithAbort:     true,
      connectTimeout:       30_000,
      requestTimeout:       60_000,
    },
    pool: {
      max: 5,
      min: 0,
      idleTimeoutMillis: 30_000,
    },
  };

  logger.info(`Connecting to Fabric: ${process.env.FABRIC_SERVER}`);
  _pool = await sql.connect(config);
  logger.info('Fabric connection pool established');

  return _pool;
}

module.exports = { getPool, sql };
