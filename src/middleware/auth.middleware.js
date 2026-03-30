/**
 * src/middleware/auth.middleware.js
 * ───────────────────────────────────
 * Validates Azure AD ID tokens on every protected API request.
 *
 * Token flow:
 *   1. Frontend (MSAL) → acquires ID token from Azure AD
 *   2. Frontend sends:  Authorization: Bearer <idToken>
 *   3. This middleware validates the JWT signature using Azure AD's JWKS endpoint
 *   4. On success: sets req.user = { id, name, email, tenantId }
 *   5. On failure: returns 401
 *
 * If AZURE_CLIENT_ID is not configured (local dev without Azure AD),
 * auth is skipped and req.user is set to a local dev placeholder.
 *
 * Required env vars:
 *   AZURE_TENANT_ID  — Azure AD Directory (tenant) ID
 *   AZURE_CLIENT_ID  — App Registration Application (client) ID
 */

const jwksClient = require('jwks-rsa');
const jwt        = require('jsonwebtoken');
const logger     = require('../utils/logger');

const AUTH_CONFIGURED = !!(process.env.AZURE_TENANT_ID && process.env.AZURE_CLIENT_ID);

// Cache JWKS keys for 24 hours — avoids hitting Azure AD on every request
const client = AUTH_CONFIGURED
  ? jwksClient({
      jwksUri:      `https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID}/discovery/v2.0/keys`,
      cache:        true,
      cacheMaxAge:  86_400_000,  // 24h
      rateLimit:    true,
    })
  : null;

function getSigningKey(header, callback) {
  client.getSigningKey(header.kid, (err, key) => {
    if (err) return callback(err);
    callback(null, key.getPublicKey());
  });
}

/**
 * Express middleware. Attaches req.user on success.
 */
function requireAuth(req, res, next) {
  // ── Dev bypass: no Azure AD configured ──────────────────────────────────
  if (!AUTH_CONFIGURED) {
    req.user = {
      id:    'local-dev-user',
      name:  'Local Dev User',
      email: 'dev@localhost',
    };
    return next();
  }

  const authHeader = req.headers.authorization;

  // Microsoft login is mandatory — reject any request without a Bearer token
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required. Please sign in with your Microsoft account.' });
  }

  const token = authHeader.slice(7);

  jwt.verify(
    token,
    getSigningKey,
    {
      audience:   process.env.AZURE_CLIENT_ID,
      issuer:     `https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID}/v2.0`,
      algorithms: ['RS256'],
    },
    (err, decoded) => {
      if (err) {
        logger.warn(`Auth failed: ${err.message}`);
        return res.status(401).json({ error: 'Token invalid or expired. Please sign in again.' });
      }

      req.user = {
        id:       decoded.oid,                                           // Azure AD Object ID — stable, unique
        name:     decoded.name || decoded.given_name || 'Unknown',
        email:    decoded.preferred_username || decoded.upn || decoded.email || '',
        tenantId: decoded.tid,
      };

      logger.info(`Authenticated: ${req.user.email} (${req.user.id.slice(0, 8)}…)`);
      next();
    },
  );
}

module.exports = { requireAuth, AUTH_CONFIGURED };
