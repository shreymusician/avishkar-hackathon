import { useEffect, useState } from 'react';

const RETRY_DELAYS_MS = [700, 1800, 4000]; // a weak hotspot often fails a request once and serves it the next time

/**
 * An <img> that does not give up after one failed request. If the picture fails to load (a dropped packet on a weak
 * WiFi, a server that was restarting) it tries again a few times, each with a fresh address so the browser cannot
 * hand back its cached failure, and only then shows `fallback` (or the alt text) instead of a broken-image icon.
 */
export default function SafeImg({ src, alt, fallback = null, className, ...rest }) {
  const [attempt, setAttempt] = useState(0);
  const [gaveUp, setGaveUp] = useState(false);

  useEffect(() => {
    setAttempt(0);
    setGaveUp(false);
  }, [src]);

  const failed = () => {
    if (attempt < RETRY_DELAYS_MS.length) {
      setTimeout(() => setAttempt((n) => n + 1), RETRY_DELAYS_MS[attempt]);
    } else {
      console.warn(`[image] ${src} failed to load after ${attempt + 1} tries`);
      setGaveUp(true);
    }
  };

  if (gaveUp) {
    return (
      fallback ?? (
        <span className={`img-failed ${className ?? ''}`} role="img" aria-label={alt}>
          {alt}
        </span>
      )
    );
  }
  return (
    <img
      {...rest}
      className={className}
      src={attempt === 0 || src.startsWith('data:') ? src : `${src}?retry=${attempt}`}
      alt={alt}
      onError={failed}
    />
  );
}
