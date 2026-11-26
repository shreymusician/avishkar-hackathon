import { usePrefs } from './prefs.jsx';

// The soil and rain sensors report a wetness percentage. A bare number does not say what to do about it, so each
// is drawn as a small living scene that changes with the reading, with a plain-language label and a tip.
// `value` is 0-100, or null when the sensor is not reporting (the scene then shows a calm, empty state).

/** Soil wetness bands. The calibration in the firmware (config.h) decides what 0 and 100 mean for your probe. */
export function soilLevel(v) {
  if (v == null) return 'none';
  if (v < 15) return 'veryDry';
  if (v < 35) return 'dry';
  if (v < 65) return 'ideal';
  if (v < 85) return 'wet';
  return 'soaked';
}

export function rainLevel(v) {
  if (v == null) return 'none';
  if (v < 5) return 'dry';
  if (v < 25) return 'drizzle';
  if (v < 60) return 'rain';
  return 'heavy';
}

// Plant posture per soil band: stem height and how far the leaves lift (negative = drooping).
const PLANT = {
  none: { stem: 40, lift: 10 },
  veryDry: { stem: 26, lift: -38 },
  dry: { stem: 38, lift: -12 },
  ideal: { stem: 62, lift: 30 },
  wet: { stem: 56, lift: 14 },
  soaked: { stem: 46, lift: -18 },
};

const SOIL_TOP = 100; // where the soil starts in the picture
const SOIL_BOTTOM = 180;

/** The soil cross-section: wetter soil is darker, the water table rises, drips fall, a seedling reacts. */
export function SoilScene({ value }) {
  const { t } = usePrefs();
  const level = soilLevel(value);
  const plant = PLANT[level];
  const waterY = value == null ? SOIL_BOTTOM : SOIL_BOTTOM - ((SOIL_BOTTOM - SOIL_TOP) * value) / 100;
  const stemTop = SOIL_TOP - plant.stem;
  const drips = level === 'none' || level === 'veryDry' || level === 'dry' ? 0 : level === 'ideal' ? 4 : 7;

  return (
    <article className="scene-card" data-kind="soil" data-level={level} aria-label={t('scene.soil')}>
      <header className="scene-head">
        <h3>{t('scene.soil')}</h3>
        <p className="scene-value mono">{value == null ? '—' : `${value}%`}</p>
      </header>

      <svg className="scene" viewBox="0 0 320 190" role="img" aria-label={`${t('scene.soil')}: ${t(`soil.level.${level}`)}`}>
        <defs>
          <clipPath id="soil-clip">
            <rect x="10" y={SOIL_TOP} width="300" height={SOIL_BOTTOM - SOIL_TOP} rx="14" />
          </clipPath>
        </defs>
        <rect className="scene-sky" x="0" y="0" width="320" height="190" rx="16" />
        <circle className="scene-sun" cx="276" cy="36" r="17" />

        <rect className="soil-base" x="10" y={SOIL_TOP} width="300" height={SOIL_BOTTOM - SOIL_TOP} rx="14" />
        <g clipPath="url(#soil-clip)">
          <g className="water-level" style={{ transform: `translateY(${waterY}px)` }}>
            <path className="water" d="M-160 0 q40 -9 80 0 t80 0 t80 0 t80 0 t80 0 t80 0 t80 0 t80 0 V120 H-160 Z" />
          </g>
          {/* grains of soil, so the block does not look like a flat colour */}
          {[40, 90, 130, 175, 215, 265, 70, 150, 240].map((x, i) => (
            <circle key={x} className="grain" cx={x} cy={SOIL_TOP + 14 + ((i * 23) % 56)} r={2 + (i % 3)} />
          ))}
          {/* cracks open up when it is parched */}
          {(level === 'veryDry' || level === 'dry') && (
            <g className="cracks" style={{ opacity: level === 'veryDry' ? 0.9 : 0.45 }}>
              <path d="M80 100 l10 14 l-6 12 l12 16" />
              <path d="M200 100 l-8 12 l10 14 l-6 18" />
              <path d="M140 100 l6 10 l-8 10" />
            </g>
          )}
          {Array.from({ length: drips }, (_, i) => (
            <circle key={i} className="drip" cx={50 + ((i * 41) % 230)} cy={SOIL_TOP + 4} r="3" style={{ animationDelay: `${(i * 0.55) % 3}s` }} />
          ))}
        </g>

        {/* the seedling */}
        <g className="plant" style={{ transformOrigin: `160px ${SOIL_TOP}px` }}>
          <path className="stem" d={`M160 ${SOIL_TOP} Q${level === 'veryDry' ? 154 : 160} ${(SOIL_TOP + stemTop) / 2} 160 ${stemTop}`} />
          <g transform={`translate(160 ${stemTop})`}>
            <ellipse className="leaf" cx="-17" cy="0" rx="19" ry="8" transform={`rotate(${plant.lift})`} />
            <ellipse className="leaf" cx="17" cy="0" rx="19" ry="8" transform={`rotate(${-plant.lift})`} />
            {(level === 'ideal' || level === 'wet') && <ellipse className="leaf" cx="0" cy="-14" rx="7" ry="15" />}
          </g>
        </g>
      </svg>

      <p className="scene-level">{t(`soil.level.${level}`)}</p>
      <div className="scale" aria-hidden="true">
        <span className="scale-bar soil-bar" />
        {value != null && <span className="scale-marker" style={{ left: `${Math.min(100, Math.max(0, value))}%` }} />}
      </div>
      <div className="scale-labels mono" aria-hidden="true">
        <span>{t('soil.scale.dry')}</span>
        <span>{t('soil.scale.ideal')}</span>
        <span>{t('soil.scale.wet')}</span>
      </div>
      <p className="scene-tip">{t(`soil.tip.${level}`)}</p>
    </article>
  );
}

const DROPS = { none: 0, dry: 0, drizzle: 7, rain: 15, heavy: 28 };
const FALL_SECONDS = { drizzle: 1.7, rain: 1.05, heavy: 0.66 };

/** The sky over the rain plate: sun when dry, then a darkening cloud and falling drops as it gets wetter. */
export function RainScene({ value }) {
  const { t } = usePrefs();
  const level = rainLevel(value);
  const drops = DROPS[level];
  const fall = FALL_SECONDS[level] ?? 1;

  return (
    <article className="scene-card" data-kind="rain" data-level={level} aria-label={t('scene.rain')}>
      <header className="scene-head">
        <h3>{t('scene.rain')}</h3>
        <p className="scene-value mono">{value == null ? '—' : `${value}%`}</p>
      </header>

      <svg className="scene" viewBox="0 0 320 190" role="img" aria-label={`${t('scene.rain')}: ${t(`rain.level.${level}`)}`}>
        <rect className="scene-sky" x="0" y="0" width="320" height="190" rx="16" />

        {(level === 'dry' || level === 'none') && (
          <g className="sun-rays" style={{ transformOrigin: '160px 62px' }}>
            {Array.from({ length: 12 }, (_, i) => (
              <line key={i} className="ray" x1="160" y1="22" x2="160" y2="12" transform={`rotate(${i * 30} 160 62)`} />
            ))}
          </g>
        )}
        {(level === 'dry' || level === 'none') && <circle className="scene-sun big" cx="160" cy="62" r="26" />}

        {level !== 'dry' && level !== 'none' && (
          <g className="cloud">
            <ellipse cx="112" cy="64" rx="38" ry="22" />
            <ellipse cx="156" cy="48" rx="44" ry="30" />
            <ellipse cx="204" cy="64" rx="38" ry="22" />
            <rect x="112" y="60" width="92" height="26" rx="12" />
          </g>
        )}

        <rect className="ground" x="0" y="158" width="320" height="32" />
        {Array.from({ length: drops }, (_, i) => {
          const x = 78 + ((i * 53) % 168);
          const delay = ((i * 0.37) % fall).toFixed(2);
          return (
            <g key={i}>
              <line className="rain-drop" x1={x} y1="86" x2={x - 4} y2="100" style={{ animationDuration: `${fall}s`, animationDelay: `-${delay}s` }} />
              <ellipse className="ripple" cx={x - 4} cy="166" rx="2" ry="1" style={{ animationDuration: `${fall}s`, animationDelay: `-${delay}s` }} />
            </g>
          );
        })}
      </svg>

      <p className="scene-level">{t(`rain.level.${level}`)}</p>
      <div className="scale" aria-hidden="true">
        <span className="scale-bar rain-bar" />
        {value != null && <span className="scale-marker" style={{ left: `${Math.min(100, Math.max(0, value))}%` }} />}
      </div>
      <div className="scale-labels mono" aria-hidden="true">
        <span>{t('rain.scale.dry')}</span>
        <span>{t('rain.scale.rain')}</span>
        <span>{t('rain.scale.heavy')}</span>
      </div>
      <p className="scene-tip">{t(`rain.tip.${level}`)}</p>
    </article>
  );
}
