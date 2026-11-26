import { useEffect, useRef, useState } from 'react';
import { usePrefs } from './prefs.jsx';
import { drawScene } from './rover3d.js';
import { zoneOf } from './SonarCard.jsx';

const HOME_VIEW = { azimuth: 35, elevation: 28 };
const STEEP_DEG = 25;
/** GPS wanders by a few metres while standing still: only a larger move extends the track. */
const TRACK_STEP_M = 2.5;
const TRACK_MAX = 600;
const ZERO_KEY = 'agrivision-3d-zero';

// The track outlives the page, so leaving this screen and coming back does not wipe it.
let track = [];

const readZero = () => {
  try {
    return { roll: 0, pitch: 0, yaw: 0, ...JSON.parse(localStorage.getItem(ZERO_KEY)) };
  } catch {
    return { roll: 0, pitch: 0, yaw: 0 };
  }
};

/** Metres east and north of `from`. Flat-earth maths is exact enough across a field. */
const offsetM = (from, to) => ({
  east: (to.lon - from.lon) * 111320 * Math.cos((from.lat * Math.PI) / 180),
  north: (to.lat - from.lat) * 110540,
});

const wrap180 = (deg) => ((((deg + 180) % 360) + 360) % 360) - 180;

export default function Rover3DPage({ pose, sonar }) {
  const { t } = usePrefs();
  const canvas = useRef(null);
  const view = useRef({ ...HOME_VIEW });
  const drag = useRef(null);
  const [zero, setZero] = useState(readZero);

  const live = sonar.online && pose.imu;
  const roll = live ? wrap180(pose.roll - zero.roll) : 0;
  const pitch = live ? pose.pitch - zero.pitch : 0;
  const heading = live ? (((pose.yaw - zero.yaw) % 360) + 360) % 360 : 0;
  const sides = ['front', 'left', 'right', 'back'].map((side) => {
    const cm = sonar.online ? sonar[side] : null;
    return { side, cm, zone: zoneOf(cm) };
  });

  // The drawing loop reads the newest values from here and eases toward them, so updates 10 times a second look smooth.
  const target = useRef(null);
  target.current = { roll, pitch, yaw: heading, sides };

  useEffect(() => {
    const el = canvas.current;
    const ctx = el.getContext('2d');
    const shown = { roll: 0, pitch: 0, yaw: target.current.yaw };
    let frame;
    let last = performance.now();
    const draw = (now) => {
      const ease = 1 - Math.exp(-(now - last) / 90);
      last = now;
      for (const k of ['roll', 'pitch', 'yaw']) shown[k] += wrap180(target.current[k] - shown[k]) * ease;
      const { width, height } = el.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      if (el.width !== Math.round(width * ratio) || el.height !== Math.round(height * ratio)) {
        el.width = Math.round(width * ratio);
        el.height = Math.round(height * ratio);
      }
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      if (width && height) drawScene(ctx, width, height, { pose: shown, view: view.current, sides: target.current.sides });
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, []);

  const grab = (e) => {
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* the pointer is already gone */
    }
    drag.current = { x: e.clientX, y: e.clientY, ...view.current };
  };
  const orbit = (e) => {
    const from = drag.current;
    if (!from) return;
    view.current = {
      azimuth: from.azimuth + (e.clientX - from.x) * 0.5,
      elevation: Math.min(85, Math.max(8, from.elevation + (e.clientY - from.y) * 0.35)),
    };
  };
  const drop = () => {
    drag.current = null;
  };

  const saveZero = (next) => {
    setZero(next);
    try {
      localStorage.setItem(ZERO_KEY, JSON.stringify(next));
    } catch {
      /* private mode: it lasts until reload */
    }
  };

  const steep = live && (Math.abs(roll) >= STEEP_DEG || Math.abs(pitch) >= STEEP_DEG);
  const degrees = (v) => (live ? `${Math.round(v)}°` : '—');
  const status = !sonar.online ? t('view3d.offline') : !pose.imu ? t('view3d.noImu') : null;

  return (
    <>
      <section className="card view3d-card" aria-label={t('view3d.title')}>
        <h2 className="card-title">
          {t('view3d.title')}
          <span className="mono card-note">{(live ? t('sensors.live') : t('sensors.notConnected')).toUpperCase()}</span>
        </h2>
        {steep && (
          <p className="notice mono" role="alert">
            {t('view3d.steep').toUpperCase()}
          </p>
        )}
        <canvas
          ref={canvas}
          className="view3d-canvas"
          role="img"
          aria-label={t('view3d.alt', { roll: degrees(roll), pitch: degrees(pitch), heading: degrees(heading) })}
          onPointerDown={grab}
          onPointerMove={orbit}
          onPointerUp={drop}
          onPointerCancel={drop}
        />
        <p className="muted">{status ?? t('view3d.drag')}</p>
        <ul className="view3d-stats">
          <li><span>{t('view3d.pitch')}</span><strong className="mono">{degrees(pitch)}</strong></li>
          <li><span>{t('view3d.roll')}</span><strong className="mono">{degrees(roll)}</strong></li>
          <li><span>{t('view3d.heading')}</span><strong className="mono">{degrees(heading)}</strong></li>
        </ul>
        <div className="view3d-bar">
          <button type="button" className="btn" disabled={!live} onClick={() => saveZero({ ...zero, roll: pose.roll, pitch: pose.pitch })}>
            {t('view3d.zero')}
          </button>
          <button type="button" className="btn" disabled={!live} onClick={() => saveZero({ ...zero, yaw: pose.yaw })}>
            {t('view3d.north')}
          </button>
          <button type="button" className="btn" onClick={() => { view.current = { ...HOME_VIEW }; }}>
            {t('view3d.reset')}
          </button>
        </div>
      </section>
      <Position gps={sonar.online ? pose.gps : null} />
    </>
  );
}

/** Where the rover is and where it has been, north up, from the GPS fixes. */
function Position({ gps }) {
  const { t } = usePrefs();
  const [, redraw] = useState(0);

  useEffect(() => {
    if (!gps) return;
    const last = track[track.length - 1];
    if (last) {
      const d = offsetM(last, gps);
      if (Math.hypot(d.east, d.north) < TRACK_STEP_M) return;
    }
    track = [...track.slice(1 - TRACK_MAX), { lat: gps.lat, lon: gps.lon }];
    redraw((n) => n + 1);
  }, [gps?.lat, gps?.lon]);

  const origin = track[0] ?? gps;
  const points = origin ? [...track, ...(gps ? [gps] : [])].map((p) => offsetM(origin, p)) : [];
  const here = points[points.length - 1];
  // Square picture, never zoomed in closer than 10 m from the start to an edge.
  const radius = Math.max(10, ...points.map((p) => Math.max(Math.abs(p.east), Math.abs(p.north)) * 1.15));
  const at = (p) => [100 + (p.east / radius) * 90, 100 - (p.north / radius) * 90];

  return (
    <section className="card view3d-card" aria-label={t('view3d.position')}>
      <h2 className="card-title">
        {t('view3d.position')}
        <span className="mono card-note">{(gps ? t('sensors.live') : t('view3d.noFix')).toUpperCase()}</span>
      </h2>
      {!here ? (
        <p className="muted">{t('view3d.noGps')}</p>
      ) : (
        <>
          <svg className="view3d-map" viewBox="0 0 200 200" role="img" aria-label={t('view3d.position')}>
            {[30, 60, 90].map((r) => <circle key={r} cx="100" cy="100" r={r} className="view3d-ring" />)}
            <text x="100" y="9" textAnchor="middle" className="view3d-n">N</text>
            <text x="102" y="197" className="view3d-scale">{`${Math.round(radius)} m`}</text>
            <polyline className="view3d-track" points={points.map((p) => at(p).join(',')).join(' ')} />
            <circle cx={at(points[0])[0]} cy={at(points[0])[1]} r="3.5" className="view3d-start" />
            <circle cx={at(here)[0]} cy={at(here)[1]} r="5" className="view3d-here" />
          </svg>
          <ul className="view3d-stats">
            <li><span>{t('view3d.lat')}</span><strong className="mono">{gps ? gps.lat.toFixed(6) : '—'}</strong></li>
            <li><span>{t('view3d.lon')}</span><strong className="mono">{gps ? gps.lon.toFixed(6) : '—'}</strong></li>
            <li><span>{t('view3d.sats')}</span><strong className="mono">{gps?.sats ?? '—'}</strong></li>
            <li><span>{t('view3d.fromStart')}</span><strong className="mono">{`${Math.round(Math.hypot(here.east, here.north))} m`}</strong></li>
          </ul>
          <div className="view3d-bar">
            <button type="button" className="btn" onClick={() => { track = []; redraw((n) => n + 1); }}>{t('view3d.clear')}</button>
          </div>
        </>
      )}
    </section>
  );
}
