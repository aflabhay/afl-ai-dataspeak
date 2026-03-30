/**
 * frontend/components/AuthGate.jsx
 * Microsoft Azure AD login — mandatory for all users.
 * Uses MSAL React hooks (requires MsalProvider in _app.jsx).
 */
import { useState } from 'react';
import { useIsAuthenticated, useMsal, useAccount } from '@azure/msal-react';
import { UserContext } from '../lib/UserContext';
import { loginRequest } from '../lib/msalConfig';

// ── Microsoft logo ─────────────────────────────────────────────────────────────
function MicrosoftLogo() {
  return (
    <svg width="20" height="20" viewBox="0 0 21 21" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: 0 }}>
      <rect x="1"  y="1"  width="9" height="9" fill="#F25022"/>
      <rect x="11" y="1"  width="9" height="9" fill="#7FBA00"/>
      <rect x="1"  y="11" width="9" height="9" fill="#00A4EF"/>
      <rect x="11" y="11" width="9" height="9" fill="#FFB900"/>
    </svg>
  );
}

// ── Login screen ───────────────────────────────────────────────────────────────
function LoginScreen({ onLogin, error, loading }) {
  return (
    <div className="login-shell">
      <div className="login-card">
        <div className="login-brand">
          <div className="login-icon">✦</div>
          <h1 className="login-title">AIDA</h1>
          <p className="login-sub">Arvind Intelligent Data Assistant</p>
        </div>

        <p className="login-desc">
          Sign in with your AFL Microsoft account to access AIDA.
        </p>

        {error && <div className="login-error">{error}</div>}

        <button className="login-btn-ms" onClick={onLogin} disabled={loading}>
          <MicrosoftLogo />
          {loading ? 'Signing in…' : 'Sign in with Microsoft'}
        </button>

        <p className="login-footer">
          Your identity is verified by your AFL Microsoft account.
          No separate password needed.
        </p>
      </div>
    </div>
  );
}

// ── Auth gate ──────────────────────────────────────────────────────────────────
export default function AuthGate({ children }) {
  const { instance, accounts } = useMsal();
  const isAuthenticated         = useIsAuthenticated();
  const account                 = useAccount(accounts[0] || {});
  const [loginError,   setLoginError]   = useState(null);
  const [loginLoading, setLoginLoading] = useState(false);

  async function handleLogin() {
    setLoginError(null);
    setLoginLoading(true);
    try {
      await instance.loginPopup(loginRequest);
    } catch (err) {
      if (err.errorCode !== 'user_cancelled') {
        setLoginError(`Sign-in failed: ${err.errorMessage || err.message || err.errorCode}`);
      }
    } finally {
      setLoginLoading(false);
    }
  }

  async function getAuthHeaders() {
    try {
      const result = await instance.acquireTokenSilent({ ...loginRequest, account });
      return { Authorization: `Bearer ${result.idToken}` };
    } catch {
      try {
        const result = await instance.acquireTokenPopup({ ...loginRequest, account });
        return { Authorization: `Bearer ${result.idToken}` };
      } catch {
        return {};
      }
    }
  }

  function handleLogout() {
    instance.logoutPopup({ account });
  }

  if (!isAuthenticated) {
    return <LoginScreen onLogin={handleLogin} error={loginError} loading={loginLoading} />;
  }

  const user = {
    id:    account?.idTokenClaims?.oid || account?.localAccountId || '',
    name:  account?.name               || account?.username        || 'Unknown',
    email: account?.username           || '',
  };

  return (
    <UserContext.Provider value={{ user, getAuthHeaders, logout: handleLogout }}>
      {children}
    </UserContext.Provider>
  );
}
