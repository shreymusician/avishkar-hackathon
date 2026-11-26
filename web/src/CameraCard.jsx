import { useCallback, useEffect, useRef, useState } from 'react';
import { usePrefs } from './prefs.jsx';

const PICK_KEY = 'agrivision-camera';

const TURN_KEY = 'agrivision-camera-turn';

/** How far the view is turned, in degrees (0, 90, 180 or 270): the webcam is bolted to the rover however it fits. */
const readTurn = () => {
  try {
    const n = Number(localStorage.getItem(TURN_KEY));
    return [0, 90, 180, 270].includes(n) ? n : 0;
  } catch {
    return 0;
  }
};

const readPick = () => {
  try {
    return localStorage.getItem(PICK_KEY) ?? '';
  } catch {
    return '';
  }
};

/**
 * The rover's webcam, live. The laptop reads the USB camera and serves it as MJPEG, so this is a plain <img>
 * that works on every device that can open the dashboard. The stream only runs while the card is playing and
 * the tab is visible, so a forgotten tab does not keep the camera busy.
 */
const PAN_REPEAT_MS = 120; // while a pan button is held, one step this often

export default function CameraCard({ accessKey, send, panReady = false }) {
  const { t } = usePrefs();
  const panTimer = useRef(null);

  const stopPan = useCallback(() => {
    clearInterval(panTimer.current);
    panTimer.current = null;
  }, []);

  // One step at once, then more while the button stays down.
  const startPan = (direction) => {
    if (!panReady || panTimer.current) return;
    const step = () => send?.({ type: 'camera_pan', direction });
    step();
    panTimer.current = setInterval(step, PAN_REPEAT_MS);
  };

  useEffect(() => stopPan, [stopPan]);
  useEffect(() => {
    if (!panReady) stopPan();
  }, [panReady, stopPan]);

  const [list, setList] = useState({ status: 'loading', devices: [], default: null });
  const [pick, setPick] = useState(readPick);
  const [playing, setPlaying] = useState(true);
  const [visible, setVisible] = useState(() => !document.hidden);
  const [phase, setPhase] = useState('connecting'); // connecting | live | lost
  const [nonce, setNonce] = useState(0);
  const [turn, setTurn] = useState(readTurn);

  const rotate = () => {
    const next = (turn + 90) % 360;
    setTurn(next);
    try {
      localStorage.setItem(TURN_KEY, String(next));
    } catch {
      /* private mode: the turn just lasts until reload */
    }
  };

  const loadDevices = useCallback(async () => {
    setList((l) => ({ ...l, status: 'loading' }));
    try {
      const res = await fetch('/api/camera/devices', { headers: { 'x-access-key': accessKey } });
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      if (!data.available) return setList({ status: 'noffmpeg', devices: [], default: null });
      setList({ status: data.devices.length ? 'ready' : 'none', devices: data.devices, default: data.default });
    } catch {
      setList({ status: 'error', devices: [], default: null });
    }
  }, [accessKey]);

  useEffect(() => {
    loadDevices();
  }, [loadDevices]);

  useEffect(() => {
    const onVisibility = () => setVisible(!document.hidden);
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  const name = list.devices.includes(pick) ? pick : list.default;
  const streaming = list.status === 'ready' && name && playing && visible;
  const src = streaming ? `/api/camera/stream?name=${encodeURIComponent(name)}&key=${encodeURIComponent(accessKey ?? '')}&n=${nonce}` : null;

  useEffect(() => {
    setPhase('connecting');
  }, [src]);

  const choose = (next) => {
    setPick(next);
    try {
      localStorage.setItem(PICK_KEY, next);
    } catch {
      /* private mode: the choice just lasts until reload */
    }
  };

  const retry = () => {
    setNonce((n) => n + 1);
    setPlaying(true);
    if (list.status !== 'ready') loadDevices();
  };

  let message = null;
  if (list.status === 'loading') message = t('camera.starting');
  else if (list.status === 'noffmpeg') message = t('camera.noFfmpeg');
  else if (list.status === 'none') message = t('camera.none');
  else if (list.status === 'error') message = t('camera.unreachable');
  else if (!playing) message = t('camera.paused');
  else if (phase === 'lost') message = t('camera.lost');

  return (
    <section className="card camera-card" aria-label={t('camera.title')}>
      <h2 className="card-title">
        {t('camera.title')}
        <span className="mono card-note">{t('camera.note')}</span>
      </h2>

      <div className="cam-frame" data-live={phase === 'live' && streaming ? 'true' : undefined}>
        {src && phase !== 'lost' && (
          <img
            key={src}
            className="cam-img"
            data-turn={turn || undefined}
            src={src}
            alt={t('camera.alt')}
            onLoad={() => setPhase('live')}
            onError={() => setPhase('lost')}
          />
        )}
        {src && phase === 'connecting' && <p className="cam-msg mono">{t('camera.starting')}</p>}
        {message && !(src && phase === 'connecting') && <p className="cam-msg">{message}</p>}
        {phase === 'live' && streaming && <span className="cam-badge mono">{t('camera.live').toUpperCase()}</span>}
      </div>

      <div className="cam-pan" role="group" aria-label={t('camera.panTitle')}>
        {['left', 'right'].map((direction) => (
          <button
            key={direction}
            type="button"
            className="btn small cam-pan-btn"
            disabled={!panReady}
            title={panReady ? undefined : t('camera.panOffline')}
            onPointerDown={(e) => {
              try {
                e.currentTarget.setPointerCapture?.(e.pointerId); // keeps the hold going if the finger slides off the button
              } catch {
                /* not an active pointer: the hold still works, it just ends on pointerup */
              }
              startPan(direction);
            }}
            onPointerUp={stopPan}
            onPointerCancel={stopPan}
            onLostPointerCapture={stopPan}
            onKeyDown={(e) => {
              if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) startPan(direction);
            }}
            onKeyUp={stopPan}
            onBlur={stopPan}
          >
            {direction === 'left' ? `◀ ${t('camera.panLeft')}` : `${t('camera.panRight')} ▶`}
          </button>
        ))}
        {!panReady && <span className="cam-pan-note mono">{t('camera.panOffline')}</span>}
      </div>

      <div className="cam-bar">
        {list.devices.length > 1 && (
          <label className="cam-pick">
            <span className="mono">{t('camera.pick').toUpperCase()}</span>
            <select value={name ?? ''} onChange={(e) => choose(e.target.value)}>
              {list.devices.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </label>
        )}
        <button type="button" className="btn small" onClick={rotate} disabled={list.status !== 'ready'}>
          {t('camera.rotate')}
        </button>
        <button type="button" className="btn small" onClick={() => setPlaying((p) => !p)} disabled={list.status !== 'ready'}>
          {playing ? t('camera.pause') : t('camera.play')}
        </button>
        <button type="button" className="btn small" onClick={retry}>
          {t('camera.retry')}
        </button>
      </div>
    </section>
  );
}
