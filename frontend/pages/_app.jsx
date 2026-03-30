import '../styles/globals.css';
import { useState, useEffect } from 'react';
import { MsalProvider }            from '@azure/msal-react';
import { PublicClientApplication } from '@azure/msal-browser';
import { isMsalConfigured, msalConfig } from '../lib/msalConfig';

/**
 * MSAL v3+ requires explicit async initialize() before first use.
 * Creating and initializing inside useEffect ensures it runs client-side only —
 * avoids the "stubbed_public_client_application_called" SSR error in Next.js.
 */
export default function App({ Component, pageProps }) {
  const [msalInstance, setMsalInstance] = useState(null);

  useEffect(() => {
    if (!isMsalConfigured) return;

    const instance = new PublicClientApplication(msalConfig);
    instance.initialize()
      .then(() => {
        // Handle the redirect response when returning from Microsoft login page
        return instance.handleRedirectPromise();
      })
      .then(() => setMsalInstance(instance))
      .catch(err => console.error('MSAL initialization failed:', err));
  }, []);

  // MSAL configured but not yet initialized — hold rendering until ready
  if (isMsalConfigured && !msalInstance) {
    return null;
  }

  if (isMsalConfigured && msalInstance) {
    return (
      <MsalProvider instance={msalInstance}>
        <Component {...pageProps} />
      </MsalProvider>
    );
  }

  return <Component {...pageProps} />;
}
