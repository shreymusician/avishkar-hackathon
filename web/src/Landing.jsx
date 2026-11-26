import { LANGUAGES } from './i18n.js';
import { usePrefs } from './prefs.jsx';
import SafeImg from './SafeImg.jsx';
import { BrandLogo } from './BrandLogo.jsx';
import { Logo, Moon, Sun } from './marks.jsx';

const FEATURES = [
  { id: 'drive', icon: 'M12 3 L12 21 M3 12 H21 M12 3 L8.5 6.5 M12 3 L15.5 6.5 M12 21 L8.5 17.5 M12 21 L15.5 17.5 M3 12 L6.5 8.5 M3 12 L6.5 15.5 M21 12 L17.5 8.5 M21 12 L17.5 15.5' },
  { id: 'soil', icon: 'M12 3 C12 3 5.5 10 5.5 14.5 A6.5 6.5 0 0 0 18.5 14.5 C18.5 10 12 3 12 3 Z M9 15 A3 3 0 0 0 12 18' },
  { id: 'fire', icon: 'M12 3 C12 8 7 9.5 7 14.5 A5 5 0 0 0 17 14.5 C17 12 15.5 10.8 15 9 C13.5 10.2 13 8 12 3 Z M12 19 C10.3 19 9.5 17.8 9.5 16.5 C9.5 15 11 14.5 12 13 C13 14.5 14.5 15 14.5 16.5 C14.5 17.8 13.7 19 12 19 Z' },
  { id: 'weather', icon: 'M7 17 A4 4 0 0 1 7.5 9 A5.5 5.5 0 0 1 18 10.5 A3.2 3.2 0 0 1 17.5 17 Z M8 20.5 L7 22 M12 20.5 L11 22 M16 20.5 L15 22' },
  { id: 'lang', icon: 'M4 5 H13 M8.5 3 V5 M6 5 C6.5 9 9 12 12.5 13.5 M11 5 C10.5 9 8 12 4.5 13.5 M13 20 L16.5 11 L20 20 M14.3 17 H18.7' },
];

function FeatureIcon({ path }) {
  return (
    <svg viewBox="0 0 24 24" className="feat-icon" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d={path} />
    </svg>
  );
}

/** Language and theme, small enough for the top bar and the footer. */
export function SitePrefs({ compact = false }) {
  const { t, lang, setLang, theme, setTheme } = usePrefs();
  const dark = theme === 'dark';
  return (
    <div className={`site-prefs${compact ? ' compact' : ''}`}>
      <div className="lang" role="group" aria-label={t('prefs.language')}>
        {LANGUAGES.map((l) => (
          <button key={l.code} type="button" lang={l.code} aria-pressed={lang === l.code} onClick={() => setLang(l.code)} title={l.name}>
            {l.label}
          </button>
        ))}
      </div>
      <button
        type="button"
        className="icon-btn"
        onClick={() => setTheme(dark ? 'light' : 'dark')}
        aria-label={dark ? t('prefs.toLight') : t('prefs.toDark')}
        title={dark ? t('prefs.toLight') : t('prefs.toDark')}
      >
        {dark ? <Sun /> : <Moon />}
      </button>
    </div>
  );
}

/** The public front page: what AgriVision is, in pictures and a few honest sentences, with the way in. */
export default function Landing() {
  const { t } = usePrefs();
  return (
    <div className="site">
      <header className="site-nav">
        <a className="site-brand" href="#/" aria-label="AgriVision">
          <BrandLogo />
        </a>
        <div className="site-nav-prefs">
          <SitePrefs compact />
        </div>
        <nav className="site-nav-actions" aria-label="Account">
          <a className="btn ghost" href="#/login">
            {t('land.nav.login')}
          </a>
          <a className="btn solid" href="#/signup">
            {t('land.nav.signup')}
          </a>
        </nav>
      </header>

      <main>
        <section className="hero-land">
          <SafeImg src="/landing-hero.jpg" alt={t('land.hero.alt')} className="hero-land-img" fetchPriority="high" fallback={<div className="hero-land-img fallback" />} />
          <div className="hero-land-shade" aria-hidden="true" />
          <div className="hero-land-copy">
            <p className="kicker mono">{t('land.hero.kicker').toUpperCase()}</p>
            <h1>{t('land.hero.title')}</h1>
            <p className="lede">{t('land.hero.text')}</p>
            <div className="hero-land-cta">
              <a className="btn solid big" href="#/signup">
                {t('land.hero.cta')}
              </a>
              <a className="btn glass big" href="#/login">
                {t('land.hero.login')}
              </a>
            </div>
            <p className="tagline-land mono">{t('land.tagline').toUpperCase()}</p>
          </div>
        </section>

        <section className="band story">
          <div className="story-copy">
            <p className="kicker mono">{t('land.story.kicker').toUpperCase()}</p>
            <h2>{t('land.story.title')}</h2>
            <p>{t('land.story.p1')}</p>
            <p>{t('land.story.p2')}</p>
          </div>
          <figure className="photo tall">
            <SafeImg src="/landing-rover.jpg" alt={t('land.story.alt')} loading="lazy" />
          </figure>
        </section>

        <section className="band features">
          <p className="kicker mono">{t('land.feat.kicker').toUpperCase()}</p>
          <h2>{t('land.feat.title')}</h2>
          <ul className="feat-grid">
            {FEATURES.map(({ id, icon }) => (
              <li key={id} className="feat">
                <span className="feat-badge">
                  <FeatureIcon path={icon} />
                </span>
                <h3>{t(`land.feat.${id}.t`)}</h3>
                <p>{t(`land.feat.${id}.d`)}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className="band vision">
          <div className="vision-pics">
            <figure className="photo">
              <SafeImg src="/landing-vision.jpg" alt={t('land.vision.alt')} loading="lazy" />
            </figure>
            <figure className="photo small">
              <SafeImg src="/landing-field.jpg" alt={t('land.field.alt')} loading="lazy" />
              <figcaption>{t('land.field.caption')}</figcaption>
            </figure>
          </div>
          <div className="vision-copy">
            <p className="kicker mono">{t('land.vision.kicker').toUpperCase()}</p>
            <h2>{t('land.vision.title')}</h2>
            <p>{t('land.vision.text')}</p>
          </div>
        </section>

        <section className="band steps">
          <h2>{t('land.steps.title')}</h2>
          <ol className="step-list">
            {[1, 2, 3].map((n) => (
              <li key={n}>
                <span className="step-n" aria-hidden="true">
                  {n}
                </span>
                <h3>{t(`land.step${n}.t`)}</h3>
                <p>{t(`land.step${n}.d`)}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="cta-land">
          <Logo />
          <h2>{t('land.cta.title')}</h2>
          <p>{t('land.cta.text')}</p>
          <div className="hero-land-cta center">
            <a className="btn solid big" href="#/signup">
              {t('land.hero.cta')}
            </a>
            <a className="btn glass big" href="#/login">
              {t('land.nav.login')}
            </a>
          </div>
        </section>
      </main>

      <footer className="site-foot">
        <p>{t('land.foot.text')}</p>
        <SitePrefs />
      </footer>
    </div>
  );
}
