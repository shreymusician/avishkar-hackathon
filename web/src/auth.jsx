import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

const AuthContext = createContext(null);

/** Posts JSON to the account API. Resolves to `{ ok, data }`; a network failure is `{ ok: false, data: { error: 'network' } }`. */
async function post(path, body) {
  try {
    const res = await fetch(`/api/auth/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    });
    return { ok: res.ok, data: await res.json().catch(() => ({})) };
  } catch {
    return { ok: false, data: { error: 'network' } };
  }
}

/**
 * Who is signed in. `status` is 'loading' until the server answers, then 'in', 'out', or 'open' when the server runs
 * without accounts (AUTH_REQUIRED=0), in which case nobody needs to sign in.
 */
export function AuthProvider({ children }) {
  const [state, setState] = useState({ status: 'loading', user: null });
  // True right after logging in or signing up (not on a page reload), so the greeting plays once.
  const [welcome, setWelcome] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let next = { status: 'out', user: null };
      try {
        const me = await fetch('/api/auth/me');
        if (me.ok) next = { status: 'in', user: (await me.json()).user };
        else {
          const health = await fetch('/api/health').then((r) => r.json()).catch(() => null);
          if (health && health.loginRequired === false) next = { status: 'open', user: null };
        }
      } catch {
        /* server not reachable: show the signed-out pages, the forms say so when used */
      }
      if (!cancelled) setState(next);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // The live link closes with code 4403 when the session has ended elsewhere or expired.
  useEffect(() => {
    const out = () => setState((s) => (s.status === 'in' ? { status: 'out', user: null } : s));
    window.addEventListener('agrirover:signed-out', out);
    return () => window.removeEventListener('agrirover:signed-out', out);
  }, []);

  const finish = useCallback((result) => {
    if (result.ok) {
      setState({ status: 'in', user: result.data.user });
      setWelcome(true);
    }
    return result;
  }, []);

  const value = useMemo(
    () => ({
      ...state,
      login: async (phone, password) => finish(await post('login', { phone, password })),
      signup: async (form) => finish(await post('signup', form)),
      demo: async () => finish(await post('demo')),
      async changePassword(form) {
        const result = await post('password', form);
        // The server hands back a fresh session cookie; this tab carries on signed in.
        if (result.ok) setState({ status: 'in', user: result.data.user });
        return result;
      },
      welcome,
      endWelcome: () => setWelcome(false),
      async logout() {
        await post('logout');
        setWelcome(false);
        setState({ status: 'out', user: null });
      },
    }),
    [state, welcome, finish],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
