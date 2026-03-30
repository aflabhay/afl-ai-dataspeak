import '../styles/globals.css';
import { isMsalConfigured, msalConfig } from '../lib/msalConfig';

// Static imports — packages must be installed
import { MsalProvider }             from '@azure/msal-react';
import { PublicClientApplication }  from '@azure/msal-browser';

// Create the MSAL instance once at module level (client-side only)
// MsalProvider automatically calls initialize() internally in msal-react v2+
const msalInstance = isMsalConfigured && typeof window !== 'undefined'
  ? new PublicClientApplication(msalConfig)
  : null;

export default function App({ Component, pageProps }) {
  if (isMsalConfigured && msalInstance) {
    return (
      <MsalProvider instance={msalInstance}>
        <Component {...pageProps} />
      </MsalProvider>
    );
  }
  return <Component {...pageProps} />;
}
