import '../styles/globals.css';
import { useEffect, useState } from 'react';
import { MsalProvider }            from '@azure/msal-react';
import { PublicClientApplication } from '@azure/msal-browser';
import { isMsalConfigured, msalConfig } from '../lib/msalConfig';

/**
 * Module-level singletons — survive React Strict Mode's double-invoke of
 * useEffect in dev. initialize() and handleRedirectPromise() must each run
 * exactly once; a second call clears the processed auth state and logs the
 * user out immediately after sign-in.
 */
let _msalInstance  = null;
let _initPromise   = null;

function getMsalInstance() {
  if (!isMsalConfigured || typeof window === 'undefined') return null;
  if (!_msalInstance) _msalInstance = new PublicClientApplication(msalConfig);
  return _msalInstance;
}

function initMsal() {
  if (_initPromise) return _initPromise;           // already running / done
  const instance = getMsalInstance();
  if (!instance) return (_initPromise = Promise.resolve(null));

  _initPromise = instance
    .initialize()
    .then(() => instance.handleRedirectPromise())  // process auth code once
    .then(() => instance)
    .catch(err => { console.error('MSAL init error:', err); return instance; });

  return _initPromise;
}

export default function App({ Component, pageProps }) {
  const [msalInstance, setMsalInstance] = useState(null);
  const [ready,        setReady]        = useState(false);

  useEffect(() => {
    initMsal().then(instance => {
      setMsalInstance(instance || null);
      setReady(true);
    });
  }, []);

  if (!ready) {
    return (
      <div style={{ minHeight: '100vh', background: '#0F2044', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: 'rgba(255,255,255,.4)', fontFamily: 'Inter,sans-serif', fontSize: 14 }}>
          Loading…
        </div>
      </div>
    );
  }

  if (msalInstance) {
    return (
      <MsalProvider instance={msalInstance}>
        <Component {...pageProps} />
      </MsalProvider>
    );
  }

  return <Component {...pageProps} />;
}
