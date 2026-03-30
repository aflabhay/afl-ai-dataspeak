/**
 * frontend/lib/UserContext.js
 * ────────────────────────────
 * React context that provides the authenticated user + a helper to get
 * the Authorization header for API calls anywhere in the component tree.
 *
 * Shape:
 *   user            : { id, name, email } | null
 *   getAuthHeaders  : () => Promise<{ Authorization: string }>
 *   logout          : () => void
 */

import { createContext, useContext } from 'react';

export const UserContext = createContext({
  user:           null,
  getAuthHeaders: async () => ({}),
  logout:         () => {},
});

export function useUser() {
  return useContext(UserContext);
}
