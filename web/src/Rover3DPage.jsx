import { useEffect, useRef, useState } from 'react';
import { usePrefs } from './prefs.jsx';
import { createWorld, drawScene, stepWorld, WALL_MAX_CM } from './rover3d.js';
import { zoneOf } from './SonarCard.jsx';

const HOME_VIEW = { azimuth: 35, elevation: 28, distance: 9 };
/** The camera starts here and swoops to the home view when the page opens. */
const INTRO_VIEW = { azimuth: 190, elevation: 62, distance: 17 };
const ORBIT_DEG_PER_S = 12;
const STEEP_DEG = 25;
const ZERO_KEY = 'agrivision-3d-zero';

const readZero = () => {
  try {
    return { roll: 0, pitch: 0, yaw: 0, ...JSON.parse(localStorage.getItem(ZERO_KEY)) };
  } catch {
    return { roll: 0, pitch: 0, yaw: 0 };
  }
};

const wrap180 = (deg) => ((((deg + 180) % 360) + 360) % 360) - 180;

export default function Rover3DPage({ pose, sonar, motion }) {
  const { t } = usePrefs();
  const canvas = useRef(null);
  const calm = useRef(window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const view = useRef({ ...(calm.current ? HOME_VIEW : INTRO_VIEW) });
  /** Where the camera is gliding to (null once it has arrived), and the spin left over from a flick. */
  const glide = useRef(calm.current ? null : { ...HOME_VIEW });
  const fling = useRef(0);
  const drag = useRef(null);
  const [orbiting, setOrbiting] = useState(false);
  const orbitingRef = useRef(false);
  orbitingRef.current = orbiting;
  const [zero, setZero] = useState(readZero);

  const live = sonar.online && pose.imu;
  const roll = live ? wrap180(pose.roll - zero.roll) : 0;
  const pitch = live ? pose.pitch - zero.pitch : 0;
  const heading = live ? (((pose.yaw - zero.yaw) % 360) + 360) % 360 : 0;
  const sides = ['front', 'left', 'right', 'back'].map((side) => {
    const cm = sonar.online ? sonar[side] : null;
    return { side, cm, zone: zoneOf(cm) };
  });

  const steep = live && (Math.abs(roll) >= STEEP_DEG || Math.abs(pitch) >= STEEP_DEG);

  // The drawing loop reads the newest values from here and eases toward them, so updates 10 times a second look smooth.
  const target = useRef(null);
  target.current = { roll, pitch, yaw: heading, sides, motion, live, steep, sonarLive: sonar.online };

  useEffect(() => {
    const el = canvas.current;
    const ctx = el.getContext('2d');
    const world = createWorld();
    // Tilt and heading follow on a lightly damped spring, so a knock settles like a real chassis.
    const shown = { roll: 0, pitch: 0, yaw: target.current.yaw };
    const speed = { roll: 0, pitch: 0, yaw: 0 };
    const walls = Object.fromEntries(target.current.sides.map((s) => [s.side, { cm: WALL_MAX_CM, zone: 'clear', show: 0, label: '' }]));
    let frame;
    let last = performance.now();
    const draw = (now) => {
      const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
      last = now;
      const want = target.current;
      for (const k of ['roll', 'pitch', 'yaw']) {
        speed[k] += (wrap180(want[k] - shown[k]) * 140 - speed[k] * 19) * dt;
        shown[k] += speed[k] * dt;
      }
      stepWorld(world, dt, { motion: want.motion, yaw: shown.yaw, calm: calm.current });

      const ease = 1 - Math.exp(-dt * 9);
      const sides = want.sides.map(({ side, cm, zone }) => {
        const wall = walls[side];
        const near = cm != null && cm <= WALL_MAX_CM;
        if (near) {
          // A wall that was hidden appears where the obstacle is; one already showing glides there.
          wall.cm = wall.show < 0.05 ? cm : wall.cm + (cm - wall.cm) * ease;
          wall.zone = zone;
          wall.label = `${cm} cm`;
        }
        wall.show += ((near ? 1 : 0) - wall.show) * ease;
        return { side, ...wall };
      });

      const cam = view.current;
      if (glide.current) {
        const k = 1 - Math.exp(-dt * 3.2);
        cam.azimuth += wrap180(glide.current.azimuth - cam.azimuth) * k;
        cam.elevation += (glide.current.elevation - cam.elevation) * k;
        cam.distance += (glide.current.distance - cam.distance) * k;
        if (Math.abs(wrap180(glide.current.azimuth - cam.azimuth)) < 0.2 && Math.abs(glide.current.distance - cam.distance) < 0.02) glide.current = null;
      } else if (!drag.current) {
        cam.azimuth += (fling.current + (orbitingRef.current ? ORBIT_DEG_PER_S : 0)) * dt;
        fling.current *= Math.exp(-dt * 2.6);
      }

      const { width, height } = el.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      if (el.width !== Math.round(width * ratio) || el.height !== Math.round(height * ratio)) {
        el.width = Math.round(width * ratio);
        el.height = Math.round(height * ratio);
      }
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      if (width && height) {
        drawScene(ctx, width, height, { pose: shown, view: cam, sides, world, live: want.live, sonarLive: want.sonarLive, steep: want.steep, calm: calm.current });
      }
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
    glide.current = null;
    fling.current = 0;
    drag.current = { x: e.clientX, y: e.clientY, ...view.current, lastX: e.clientX, lastAt: performance.now(), rate: 0 };
  };
  const orbit = (e) => {
    const from = drag.current;
    if (!from) return;
    const now = performance.now();
    if (now > from.lastAt) from.rate = ((e.clientX - from.lastX) * 0.5 * 1000) / (now - from.lastAt);
    from.lastX = e.clientX;
    from.lastAt = now;
    view.current.azimuth = from.azimuth + (e.clientX - from.x) * 0.5;
    view.current.elevation = Math.min(85, Math.max(8, from.elevation + (e.clientY - from.y) * 0.35));
  };
  const drop = () => {
    const from = drag.current;
    // Let go while still moving and the view keeps turning for a moment.
    if (from && !calm.current && performance.now() - from.lastAt < 80) fling.current = Math.max(-360, Math.min(360, from.rate));
    drag.current = null;
  };
  const resetView = () => {
    setOrbiting(false);
    fling.current = 0;
    if (calm.current) view.current = { ...HOME_VIEW };
    else glide.current = { ...HOME_VIEW };
  };

  const saveZero = (next) => {
    setZero(next);
    try {
      localStorage.setItem(ZERO_KEY, JSON.stringify(next));
    } catch {
      /* private mode: it lasts until reload */
    }
  };

  const degrees = (v) => (live ? `${Math.round(v)}°` : '—');
  const status = !sonar.online ? t('view3d.offline') : !pose.imu ? t('view3d.noImu') : null;

  return (
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
        <button type="button" className="btn" aria-pressed={orbiting} onClick={() => { glide.current = null; setOrbiting((on) => !on); }}>
          {t('view3d.orbit')}
        </button>
        <button type="button" className="btn" onClick={resetView}>
          {t('view3d.reset')}
        </button>
      </div>
    </section>
  );
}

