// Small inline marks. Rounded caps and joins, to match the soft field-guide look.

const ROTATE = { forward: 0, right: 90, backward: 180, left: 270 };

export function Chevron({ direction }) {
  return (
    <svg className="mark" viewBox="0 0 48 48" aria-hidden="true" style={{ transform: `rotate(${ROTATE[direction]}deg)` }}>
      <path d="M10 28 L24 14 L38 28" fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M24 14 V38" stroke="currentColor" strokeWidth="5" strokeLinecap="round" />
    </svg>
  );
}

export function StopMark() {
  return (
    <svg className="mark small" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="5" y="5" width="14" height="14" rx="3" fill="currentColor" />
    </svg>
  );
}

export function Lamp({ on }) {
  return (
    <svg className="mark small" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="14" cy="12" r="6.5" fill={on ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" />
      {on && <path d="M3 8 H6 M2 12 H5.5 M3 16 H6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />}
    </svg>
  );
}

/** The AgriVision leaf mark: two leaves and a signal arc, after the project artwork. */
export function Logo() {
  return (
    <svg className="logo" viewBox="0 0 48 48" aria-hidden="true">
      <path d="M8 38 C8 24 16 14 28 12 C28 26 22 36 8 38 Z" style={{ fill: 'var(--logo-deep)' }} />
      <path d="M22 40 C22 30 28 22 38 20 C38 31 33 38 22 40 Z" style={{ fill: 'var(--logo-leaf)' }} />
      <path d="M33 6 a9 9 0 0 1 9 9 M33 11 a4 4 0 0 1 4 4" fill="none" style={{ stroke: 'var(--logo-leaf)' }} strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

export function Sun() {
  return (
    <svg className="mark small" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2 V5 M12 19 V22 M2 12 H5 M19 12 H22 M4.9 4.9 L7 7 M17 17 L19.1 19.1 M4.9 19.1 L7 17 M17 7 L19.1 4.9" />
    </svg>
  );
}

export function Eye({ off = false }) {
  return (
    <svg className="mark small" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 12 C4.5 7.5 8 5.5 12 5.5 C16 5.5 19.5 7.5 22 12 C19.5 16.5 16 18.5 12 18.5 C8 18.5 4.5 16.5 2 12 Z" />
      <circle cx="12" cy="12" r="3" />
      {off && <path d="M4 4 L20 20" />}
    </svg>
  );
}

export function Moon() {
  return (
    <svg className="mark small" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 14.5 A8.5 8.5 0 1 1 9.5 4 A7 7 0 0 0 20 14.5 Z" />
    </svg>
  );
}

export function Compass() {
  return (
    <svg className="mark small" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M15.5 8.5 L13.5 13.5 L8.5 15.5 L10.5 10.5 Z" />
    </svg>
  );
}

const SENSOR_PATHS = {
  temperature: <path d="M10 14 V5 a2 2 0 0 1 4 0 v9 a4 4 0 1 1 -4 0 z" />,
  humidity: <path d="M12 3 C8 9 6 12 6 15 a6 6 0 0 0 12 0 c0 -3 -2 -6 -6 -12 z" />,
  soil: <path d="M3 17 C7 13 9 19 13 15 S19 14 21 17 M3 21 H21 M12 3 V10 M9 7 L12 10 L15 7" />,
  rain: <path d="M6 15 a4 4 0 0 1 1 -8 a5 5 0 0 1 10 1 a3.5 3.5 0 0 1 0 7 z M8 19 l-1 2 M12 19 l-1 2 M16 19 l-1 2" />,
  wind: <path d="M3 9 H14 a3 3 0 1 0 -3 -3 M3 15 H18 a3 3 0 1 1 -3 3 M3 12 H9" />,
  air: <path d="M4 8 C8 4 12 12 16 8 S20 6 21 8 M4 14 C8 10 12 18 16 14 S20 12 21 14" />,
  sun: <path d="M12 3 V6 M12 18 V21 M3 12 H6 M18 12 H21 M5.6 5.6 L7.7 7.7 M16.3 16.3 L18.4 18.4 M5.6 18.4 L7.7 16.3 M16.3 7.7 L18.4 5.6 M8 12 a4 4 0 1 0 8 0 a4 4 0 1 0 -8 0" />,
  flame: <path d="M12 3 C13 8 18 9 18 15 a6 6 0 0 1 -12 0 c0 -3 2 -4 3 -6 c1 2 2 2 3 -1 c0 -2 0 -3 0 -5 z" />,
};

export function SensorMark({ kind }) {
  return (
    <svg className="mark small" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {SENSOR_PATHS[kind]}
    </svg>
  );
}

const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' };

export function Menu() {
  return (
    <svg className="mark small" viewBox="0 0 24 24" aria-hidden="true" {...stroke} strokeWidth="2.4">
      <path d="M4 7 H20 M4 12 H20 M4 17 H20" />
    </svg>
  );
}

export function IconControl() {
  return (
    <svg className="mark small" viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="2.2" />
      <path d="M12 9.8 V3.5 M10 13.2 L4.6 16.4 M14 13.2 L19.4 16.4" />
    </svg>
  );
}

export function IconBulb() {
  return (
    <svg className="mark small" viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
      <path d="M9 18 H15 M10 21 H14 M12 3 a6 6 0 0 0 -3.6 10.8 c0.7 0.6 1 1.3 1 2.2 H14.6 c0 -0.9 0.3 -1.6 1 -2.2 A6 6 0 0 0 12 3 Z" />
    </svg>
  );
}

export function IconSprout() {
  return (
    <svg className="mark small" viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
      <path d="M12 21 V11 M12 11 C12 7 9 5 5 5 C5 9 8 11 12 11 M12 13 C12 9.5 14.5 7.5 19 7.5 C19 11.5 16 13 12 13" />
    </svg>
  );
}

export function IconCloudSun() {
  return (
    <svg className="mark small" viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
      <path d="M7 19 a4 4 0 0 1 0.5 -8 a5.5 5.5 0 0 1 10.3 1.3 A3.4 3.4 0 0 1 17.5 19 Z M7 4 V5.5 M2.5 8.5 H4 M4 5.5 L5 6.5 M11 4.5 L10 5.5" />
    </svg>
  );
}

/** Farmer support: a heart with a sprout, for care and help. */
export function IconSupport() {
  return (
    <svg className="mark small" viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
      <path d="M12 21 C6 17 3 13.6 3 10 A4.6 4.6 0 0 1 12 8.4 A4.6 4.6 0 0 1 21 10 C21 13.6 18 17 12 21 Z" />
      <path d="M12 8.4 V4.2 M12 5.6 C10.4 5.6 9.2 4.8 9 3.4 C10.6 3.4 11.8 4.2 12 5.6 Z M12 5 C12.2 3.8 13.2 3 14.6 3 C14.4 4.2 13.4 5 12 5 Z" />
    </svg>
  );
}

export function IconInfo() {
  return (
    <svg className="mark small" viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11 V16.5 M12 7.6 V7.7" strokeWidth="2.6" />
    </svg>
  );
}

export function IconUser() {
  return (
    <svg className="mark small" viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
      <circle cx="12" cy="8.5" r="3.6" />
      <path d="M4.5 20 C5 15.5 8 13.5 12 13.5 C16 13.5 19 15.5 19.5 20" />
    </svg>
  );
}

export function IconHorn() {
  return (
    <svg className="mark small" viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
      <path d="M3 10 V14 H7 L13 18.5 V5.5 L7 10 Z M16.5 9 a4.5 4.5 0 0 1 0 6 M19 6.5 a8 8 0 0 1 0 11" />
    </svg>
  );
}
