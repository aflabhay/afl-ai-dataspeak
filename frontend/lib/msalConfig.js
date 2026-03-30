/**
 * frontend/lib/msalConfig.js
 * ───────────────────────────
 * Microsoft Authentication Library (MSAL) configuration.
 *
 * Required environment variables (in frontend/.env.local):
 *   NEXT_PUBLIC_AZURE_CLIENT_ID   — App Registration Application (client) ID
 *   NEXT_PUBLIC_AZURE_TENANT_ID   — Azure AD Directory (tenant) ID
 *
 * If these are not set, MSAL is disabled and the app runs without auth
 * (useful for local development).
 */

export const isMsalConfigured = !!(
  process.env.NEXT_PUBLIC_AZURE_CLIENT_ID &&
  process.env.NEXT_PUBLIC_AZURE_TENANT_ID
);

export const msalConfig = {
  auth: {
    clientId:    process.env.NEXT_PUBLIC_AZURE_CLIENT_ID || '',
    authority:   `https://login.microsoftonline.com/${process.env.NEXT_PUBLIC_AZURE_TENANT_ID || 'common'}`,
    redirectUri: typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000',
    postLogoutRedirectUri: typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000',
    // Prevent MSAL from navigating a second time after processing the redirect
    // response — this second navigation was causing the post-login loop.
    navigateToLoginRequestUrl: false,
  },
  cache: {
    cacheLocation:          'localStorage', // persist login across browser restarts
    storeAuthStateInCookie: true,           // extra resilience for Safari / strict cookie policies
  },
};

// Scopes requested on login — openid + profile gives us name/email in the ID token
export const loginRequest = {
  scopes: ['openid', 'profile', 'User.Read'],
};
