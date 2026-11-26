import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { LANGUAGES, translate } from './i18n.js';

const PrefsContext = createContext(null);

const THEMES = ['light', 'dark'];

// Storage can be blocked (private windows, embedded previews): the app just forgets.
const read = (key, valid, fallback) => {
  try {
    const value = localStorage.getItem(key);
    return valid(value) ? value : fallback;
  } catch {
    return fallback;
  }
};
const write = (key, value) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* not remembered */
  }
};

/** Language (English by default) and theme (light by default), remembered per browser. */
export function PrefsProvider({ children }) {
  const [lang, setLangState] = useState(() => read('agrirover-lang', (v) => LANGUAGES.some((l) => l.code === v), 'en'));
  const [theme, setThemeState] = useState(() => read('agrirover-theme', (v) => THEMES.includes(v), 'light'));

  const setLang = useCallback((code) => {
    setLangState(code);
    write('agrirover-lang', code);
  }, []);
  const setTheme = useCallback((next) => {
    setThemeState(next);
    write('agrirover-theme', next);
  }, []);

  const t = useCallback((key, vars) => translate(lang, key, vars), [lang]);
  const locale = LANGUAGES.find((l) => l.code === lang)?.locale ?? 'en-IN';

  useEffect(() => {
    document.documentElement.lang = lang;
    document.title = translate(lang, 'app.title');
  }, [lang]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#10241a' : '#0f4d2e');
  }, [theme]);

  const value = useMemo(() => ({ lang, setLang, theme, setTheme, t, locale }), [lang, setLang, theme, setTheme, t, locale]);
  return <PrefsContext.Provider value={value}>{children}</PrefsContext.Provider>;
}

export function usePrefs() {
  return useContext(PrefsContext);
}
