import { useEffect, useMemo, useState } from 'react';
import { usePrefs } from './prefs.jsx';
import { Logo } from './marks.jsx';

const SHOW_MS = 3600;
const FADE_MS = 500;

/** Latin names animate letter by letter. Other scripts join letters into shapes, so they animate word by word. */
function pieces(name) {
  const text = name.trim().replace(/\s+/g, ' ');
  return /^[\u0000-ɏ]+$/.test(text) ? Array.from(text) : text.split(' ').flatMap((w, i, all) => (i < all.length - 1 ? [`${w} `] : [w]));
}

/**
 * A short greeting after logging in or signing up: a seedling grows, then "Welcome" and the person's name rise into
 * place. It fades out by itself, or at a tap, a key press or Escape.
 */
export default function Welcome({ name, onDone }) {
  const { t } = usePrefs();
  const [leaving, setLeaving] = useState(false);
  const parts = useMemo(() => pieces(name), [name]);

  useEffect(() => {
    const out = setTimeout(() => setLeaving(true), SHOW_MS);
    return () => clearTimeout(out);
  }, []);
  useEffect(() => {
    if (!leaving) return undefined;
    const gone = setTimeout(onDone, FADE_MS);
    return () => clearTimeout(gone);
  }, [leaving, onDone]);
  useEffect(() => {
    const skip = () => setLeaving(true);
    window.addEventListener('keydown', skip);
    return () => window.removeEventListener('keydown', skip);
  }, []);

  return (
    <div className="welcome" data-leaving={leaving || undefined} onClick={() => setLeaving(true)} role="status" aria-live="polite">
      <div className="welcome-sun" aria-hidden="true" />
      <div className="welcome-body">
        <svg className="welcome-plant" viewBox="0 0 120 120" aria-hidden="true">
          <path className="w-soil" d="M14 104 Q60 92 106 104" />
          <path className="w-stem" d="M60 100 C60 80 58 62 62 42" />
          <path className="w-leaf l1" d="M60 80 C42 80 30 70 28 56 C46 56 58 64 60 80 Z" />
          <path className="w-leaf l2" d="M60 66 C78 66 90 56 92 42 C74 42 62 50 60 66 Z" />
          <path className="w-leaf l3" d="M62 44 C54 34 56 20 66 12 C74 22 72 36 62 44 Z" />
        </svg>
        <p className="welcome-kicker mono">{t('welcome.kicker').toUpperCase()}</p>
        <h2 className="welcome-title">{t('welcome.title')},</h2>
        <p className="welcome-name" aria-label={name}>
          {parts.map((piece, i) => (
            <span key={i} className="w-char" style={{ animationDelay: `${1.25 + i * 0.045}s` }} aria-hidden="true">
              {piece === ' ' ? ' ' : piece}
            </span>
          ))}
        </p>
        <span className="welcome-rule" aria-hidden="true" />
        <p className="welcome-sub">{t('welcome.sub')}</p>
        <p className="welcome-skip mono">{t('welcome.skip').toUpperCase()}</p>
      </div>
    </div>
  );
}
