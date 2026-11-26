import { useEffect, useState } from 'react';
import App from './App.jsx';
import AuthPage from './AuthPage.jsx';
import Landing from './Landing.jsx';
import Welcome from './Welcome.jsx';
import { BrandLogo } from './BrandLogo.jsx';
import { useAuth } from './auth.jsx';
import { usePrefs } from './prefs.jsx';

const readRoute = () => /^#\/(login|signup)\b/.exec(window.location.hash)?.[1] ?? 'home';

/**
 * The front door. Signed-out visitors get the landing page and the login and signup forms; once signed in (or when the
 * server runs without accounts) they get the field console.
 */
export default function Root() {
  const { status, user, welcome, endWelcome } = useAuth();
  const { t } = usePrefs();
  const [route, setRoute] = useState(readRoute);

  useEffect(() => {
    const on = () => setRoute(readRoute());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);

  // A new page starts at its top.
  useEffect(() => {
    document.querySelector('.site, .auth')?.scrollTo?.(0, 0);
  }, [route, status]);

  if (status === 'loading') {
    return (
      <div className="splash" role="status">
        <BrandLogo />
        <p className="mono">{t('auth.loading').toUpperCase()}</p>
      </div>
    );
  }
  if (status === 'in' || status === 'open') {
    return (
      <>
        <App />
        {welcome && user && <Welcome name={user.name} onDone={endWelcome} />}
      </>
    );
  }
  if (route === 'login' || route === 'signup') return <AuthPage key={route} mode={route} />;
  return <Landing />;
}
