import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/barlow-condensed/700.css';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import '@fontsource/noto-sans-kannada/400.css';
import '@fontsource/noto-sans-kannada/600.css';
import '@fontsource/noto-sans-kannada/700.css';
import '@fontsource/noto-sans-devanagari/400.css';
import '@fontsource/noto-sans-devanagari/600.css';
import '@fontsource/noto-sans-devanagari/700.css';
import './styles.css';
import { PrefsProvider } from './prefs.jsx';
import { AuthProvider } from './auth.jsx';
import Root from './Root.jsx';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <PrefsProvider>
      <AuthProvider>
        <Root />
      </AuthProvider>
    </PrefsProvider>
  </StrictMode>,
);
