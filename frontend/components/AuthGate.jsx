/**
 * frontend/components/AuthGate.jsx
 *
 * Two modes:
 *  1. MSAL configured  → Azure AD login (Microsoft button)
 *  2. MSAL not configured → Simple name/email form stored in localStorage
 *
 * Both modes populate UserContext so the rest of the app is identical.
 */
import { useState, useEffect } from 'react';
import { UserContext } from '../lib/UserContext';
import { isMsalConfigured, loginRequest } from '../lib/msalConfig';

// Only import MSAL hooks when configured — avoids errors if packages not installed
let useIsAuthenticated, useMsal, useAccount;
if (isMsalConfigured) {
  ({ useIsAuthenticated, useMsal, useAccount } = require('@azure/msal-react'));
}

const STORAGE_KEY = 'aida_guest_user';

// ── Shared brand header ───────────────────────────────────────────────────────
function LoginBrand() {
  return (
    <div className="login-brand">
      <div className="login-icon">✦</div>
      <h1 className="login-title">AIDA</h1>
      <p className="login-sub">Arvind Intelligent Data Assistant</p>
    </div>
  );
}

// ── Microsoft logo ────────────────────────────────────────────────────────────
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

// ── Guest login form (no Azure AD) ────────────────────────────────────────────
function GuestLoginScreen({ onSubmit }) {
  const [name,  setName]  = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');

  function handleSubmit(e) {
    e.preventDefault();
    if (!name.trim())  return setError('Please enter your name.');
    if (!email.trim()) return setError('Please enter your email.');
    if (!email.trim().toLowerCase().endsWith('@arvindfashions.com')) {
      return setError('Access is restricted to @arvindfashions.com email addresses.');
    }
    onSubmit({ name: name.trim(), email: email.trim().toLowerCase() });
  }

  return (
    <div className="login-shell">
      <div className="login-card">
        <LoginBrand />

        <p className="login-desc">
          Ask business questions about Arvind Fashions data in plain English.
          Enter your Arvind Fashions email to get started.
        </p>

        {error && <div className="login-error">{error}</div>}

        <form onSubmit={handleSubmit} className="guest-form">
          <div className="guest-field">
            <label className="guest-label">Your Name</label>
            <input
              className="guest-input"
              type="text"
              placeholder="e.g. Abhay Kumar"
              value={name}
              onChange={e => setName(e.target.value)}
              autoFocus
            />
          </div>
          <div className="guest-field">
            <label className="guest-label">Work Email</label>
            <input
              className="guest-input"
              type="email"
              placeholder="e.g. abhay@arvindfashions.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
            />
          </div>
          <button type="submit" className="login-btn-ms" style={{ marginTop: 8 }}>
            Continue to AIDA →
          </button>
        </form>

        <p className="login-footer">
          No password needed. Access restricted to <strong>@arvindfashions.com</strong> accounts.
          Your details are used only for audit logging of data queries.
        </p>
      </div>
    </div>
  );
}

// ── Azure AD login screen ─────────────────────────────────────────────────────
function MsLoginScreen({ onLogin, error, loading }) {
  return (
    <div className="login-shell">
      <div className="login-card">
        <LoginBrand />

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

// ── Azure AD gate (MSAL configured) ──────────────────────────────────────────
function MsalAuthGate({ children }) {
  const { instance, accounts } = useMsal();
  const isAuthenticated        = useIsAuthenticated();
  const account                = useAccount(accounts[0] || {});
  const [loginError,   setLoginError]   = useState(null);
  const [loginLoading, setLoginLoading] = useState(false);

  async function handleLogin() {
    setLoginError(null);
    setLoginLoading(true);
    try {
      await instance.loginPopup(loginRequest);
    } catch (err) {
      console.error('MSAL login error:', err);
      if (err.errorCode !== 'user_cancelled') {
        setLoginError(`Sign-in failed (${err.errorCode || err.message})`);
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
      await instance.loginPopup(loginRequest);
      return {};
    }
  }

  if (!isAuthenticated) {
    return <MsLoginScreen onLogin={handleLogin} error={loginError} loading={loginLoading} />;
  }

  const user = {
    id:    account?.idTokenClaims?.oid || account?.localAccountId || '',
    name:  account?.name               || account?.username        || 'Unknown',
    email: account?.username           || '',
  };

  return (
    <UserContext.Provider value={{ user, getAuthHeaders, logout: () => instance.logoutPopup({ account }) }}>
      {children}
    </UserContext.Provider>
  );
}

// ── Guest gate (no Azure AD) ──────────────────────────────────────────────────
export function NoAuthGate({ children }) {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);

  // Load saved user from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) setUser(JSON.parse(saved));
    } catch { /* ignore */ }
    setReady(true);
  }, []);

  function handleGuestSubmit({ name, email }) {
    const guest = {
      id:    `guest_${email.toLowerCase().replace(/[^a-z0-9]/g, '_')}`,
      name,
      email,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(guest));
    setUser(guest);
  }

  function handleLogout() {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem('afl_session_id');
    setUser(null);
  }

  if (!ready) return null;

  if (!user) {
    return <GuestLoginScreen onSubmit={handleGuestSubmit} />;
  }

  return (
    <UserContext.Provider value={{
      user,
      getAuthHeaders: async () => ({
        'X-Guest-Id':    user.id,
        'X-Guest-Name':  user.name,
        'X-Guest-Email': user.email,
      }),
      logout: handleLogout,
    }}>
      {children}
    </UserContext.Provider>
  );
}

// ── Default export — Microsoft login is mandatory ─────────────────────────────
export default function AuthGate({ children }) {
  if (isMsalConfigured) {
    return <MsalAuthGate>{children}</MsalAuthGate>;
  }

  // MSAL not configured — show a setup error instead of falling back to guest mode
  return (
    <div className="login-shell">
      <div className="login-card">
        <LoginBrand />
        <div className="login-error" style={{ marginTop: 24 }}>
          ⚠ Microsoft login is not configured.<br />
          Set <code>NEXT_PUBLIC_AZURE_CLIENT_ID</code> and <code>NEXT_PUBLIC_AZURE_TENANT_ID</code> in <code>frontend/.env.local</code> and restart.
        </div>
      </div>
    </div>
  );
}
