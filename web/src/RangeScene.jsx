import { usePrefs } from './prefs.jsx';

// The ultrasonic eye, drawn from above: the rover at the bottom, a sound beam fanning out ahead of it, and a shrub that
// sits at exactly the measured distance. Pulses leave the sensor, run out to the shrub and ring back, and they take
// longer the further away it is, so the picture moves at the pace of the real thing.
//
// The scale is 1 px per cm up to the sensor's 200 cm reach. `cm` is the distance ahead, or null when there is no reading.

const SX = 160; // the sensor's position in the picture
const SY = 246;
const REACH = 200; // cm
const HALF = 28; // half-angle of the drawn beam, degrees
const STOP_CM = 30; // matches the firmware's stop distance
const CAREFUL_CM = 80;

const rad = (deg) => (deg * Math.PI) / 180;
const edge = (r, deg) => [SX + r * Math.sin(rad(deg)), SY - r * Math.cos(rad(deg))];
const point = ([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`;
const sector = (r) => `M${SX} ${SY} L${point(edge(r, -HALF))} A${r} ${r} 0 0 1 ${point(edge(r, HALF))} Z`;
const arc = (r, half) => `M${point(edge(r, -half))} A${r} ${r} 0 0 1 ${point(edge(r, half))}`;

export function rangeZone(cm) {
  if (cm == null) return 'none';
  if (cm < STOP_CM) return 'stop';
  if (cm < CAREFUL_CM) return 'careful';
  return 'clear';
}

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

export default function RangeScene({ cm, motion = 'stop' }) {
  const { t } = usePrefs();
  const zone = rangeZone(cm);
  const open = cm != null && cm >= REACH - 5; // nothing in reach
  const shown = cm == null ? REACH : clamp(cm, 0, REACH);
  const k = clamp(shown / REACH, 0.05, 1);
  const obstacleY = SY - clamp(shown, 18, REACH);
  // One pulse takes longer to reach a far object, as sound does.
  const ping = (0.8 + k * 1.4).toFixed(2);
  const valueText = cm == null ? '—' : open ? `${REACH}+` : String(cm);
  const label = cm == null ? t('range.zone.none') : `${valueText} ${t('unit.cm')}`;
  const tag = cm == null || open ? '' : `${cm} ${t('unit.cm')}`;

  return (
    <article className="range-card" aria-label={t('range.title')}>
      <svg
        className="range-scene"
        viewBox="0 0 320 300"
        data-zone={zone}
        data-motion={motion === 'forward' || motion === 'backward' ? motion : undefined}
        style={{ '--ping': `${ping}s` }}
        role="img"
        aria-label={t('range.alt', { value: label })}
      >
        <defs>
          <linearGradient id="range-beam" gradientUnits="userSpaceOnUse" x1="0" y1={SY} x2="0" y2={SY - REACH}>
            <stop offset="0" style={{ stopColor: 'var(--beam)', stopOpacity: 0.85 }} />
            <stop offset="1" style={{ stopColor: 'var(--beam)', stopOpacity: 0.12 }} />
          </linearGradient>
          <radialGradient id="range-canopy" cx="38%" cy="32%" r="75%">
            <stop offset="0" stopColor="#9be05a" />
            <stop offset="0.55" stopColor="#4f9a2a" />
            <stop offset="1" stopColor="#2c6b1c" />
          </radialGradient>
          <clipPath id="range-clip">
            <rect x="0" y="0" width="320" height="300" rx="16" />
          </clipPath>
        </defs>

        <g clipPath="url(#range-clip)">
          <rect className="range-ground" x="0" y="0" width="320" height="300" />
          {/* crop rows: they run past the rover while it drives, so the picture shows the motion too */}
          {[28, 68, 108, 212, 252, 292].map((x) => (
            <line key={x} className="range-row" x1={x} y1="0" x2={x} y2="300" />
          ))}

          {/* the part of the beam the obstacle hides, then the part that reaches it */}
          <path className="range-blocked" d={sector(REACH)} />
          <g className="range-grow" style={{ transform: `scale(${k})` }}>
            <path className="range-beam" d={sector(REACH)} fill="url(#range-beam)" />
            {zone !== 'none' &&
              [0, 1, 2].map((n) => (
                <path key={n} className="range-pulse" d={arc(REACH, HALF)} style={{ animationDelay: `calc(var(--ping) * ${-n / 3})` }} />
              ))}
          </g>

          {/* distance rings */}
          {[50, 100, 150, 200].map((r) => (
            <g key={r} className="range-ring">
              <path d={arc(r, HALF + 12)} />
              <text x={SX + 6} y={SY - r + 12}>
                {r}
              </text>
            </g>
          ))}
          <text className="range-unit-label" x={SX + 6} y={SY - REACH - 6}>
            {t('unit.cm')}
          </text>

          {/* the shrub, at the measured distance */}
          <g className="range-obstacle" data-open={open || undefined} data-hidden={cm == null || undefined} style={{ transform: `translate(${SX}px, ${obstacleY}px)` }}>
            {zone !== 'none' && [0, 1, 2].map((n) => <circle key={n} className="range-echo" r="16" style={{ animationDelay: `calc(var(--ping) * ${-n / 3})` }} />)}
            <circle className="range-halo" r="26" />
            <ellipse className="range-shadow" cx="3" cy="12" rx="19" ry="7" />
            <circle fill="url(#range-canopy)" cx="-8" cy="2" r="13" />
            <circle fill="url(#range-canopy)" cx="9" cy="3" r="12" />
            <circle fill="url(#range-canopy)" cx="0" cy="-8" r="13" />
            <circle fill="#d9f5b8" opacity="0.5" cx="-5" cy="-11" r="3.5" />
            {tag && (
              <g className="range-tag" transform="translate(26 -9)">
                <rect x="0" y="0" width={10 + tag.length * 6.4} height="19" rx="9.5" />
                <text x={5 + (tag.length * 6.4) / 2} y="13.5" textAnchor="middle">
                  {tag}
                </text>
              </g>
            )}
          </g>

          {/* the rover, seen from above */}
          <g className="range-rover">
            {/* six wheels, three a side, each side's three joined by a rocker arm */}
            <line className="rocker" x1="136.5" y1="256.5" x2="136.5" y2="288.5" />
            <line className="rocker" x1="183.5" y1="256.5" x2="183.5" y2="288.5" />
            {[250, 266, 282].map((y) => (
              <g key={y}>
                <rect className="wheel" x="132" y={y} width="9" height="13" rx="3" />
                <rect className="wheel" x="179" y={y} width="9" height="13" rx="3" />
              </g>
            ))}
            <rect className="body" x="139" y="249" width="42" height="50" rx="9" />
            <rect className="deck" x="146" y="266" width="28" height="24" rx="5" />
            <circle className="eye" cx="150" cy="254" r="5.5" />
            <circle className="eye" cx="170" cy="254" r="5.5" />
            <circle className="eye-core" cx="150" cy="254" r="2" />
            <circle className="eye-core" cx="170" cy="254" r="2" />
          </g>
        </g>
      </svg>

      <div className="range-read" data-zone={zone}>
        <p className="range-number" aria-live="polite">
          <span className="mono">{valueText}</span>
          {cm != null && <span className="range-unit">{t('unit.cm')}</span>}
        </p>
        <p className="range-zone">{t(`range.zone.${zone}`)}</p>
      </div>
      <p className="range-tip">{t(`range.tip.${zone}`)}</p>
    </article>
  );
}
