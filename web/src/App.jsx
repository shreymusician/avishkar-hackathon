import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRover } from './useRover.js';
import { useDrive } from './useDrive.js';
import { usePrefs } from './prefs.jsx';
import { useAuth } from './auth.jsx';
import { LANGUAGES } from './i18n.js';
import FieldConditions from './FieldConditions.jsx';
import Joystick from './Joystick.jsx';
import SafeImg from './SafeImg.jsx';
import { BrandLogo } from './BrandLogo.jsx';
import { RainScene, SoilScene } from './SensorScenes.jsx';
import RangeScene from './RangeScene.jsx';
import AccountPage from './AccountPage.jsx';
import FireFan from './FireScene.jsx';
import {
  Chevron, IconUser, IconBulb, IconHorn, IconCloudSun, IconControl, IconInfo, IconSprout, IconSupport, Lamp as LampMark, Logo, Menu, Moon, SensorMark, StopMark, Sun,
} from './marks.jsx';
import SupportPage from './SupportPage.jsx';
import CameraCard from './CameraCard.jsx';
import SonarCard from './SonarCard.jsx';
import Rover3DPage from './Rover3DPage.jsx';

const KEY_COMMANDS = {
  w: 'forward', arrowup: 'forward',
  s: 'backward', arrowdown: 'backward',
  a: 'left', arrowleft: 'left',
  d: 'right', arrowright: 'right',
};

const isTextEntry = (el) =>
  Boolean(el) && (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.isContentEditable);

const mmss = (ms) => {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
};

/** The app's pages, in drawer order. `title` is an i18n key. */
const PAGES = [
  { id: 'control', title: 'control.title', Icon: IconControl },
  { id: 'view3d', title: 'view3d.title', Icon: IconControl },
  { id: 'lights', title: 'lights.title', Icon: IconBulb },
  { id: 'sensors', title: 'sensors.title', Icon: IconSprout },
  { id: 'environment', title: 'field.title', Icon: IconCloudSun },
  { id: 'support', title: 'support.title', Icon: IconSupport },
  { id: 'status', title: 'status.title', Icon: IconInfo },
  { id: 'account', title: 'account.title', Icon: IconUser },
];

const readPage = () => {
  const id = /^#\/(\w+)/.exec(window.location.hash)?.[1];
  return PAGES.some((p) => p.id === id) ? id : 'control';
};

/** True while the media query matches (for the permanent desktop drawer). */
function useMedia(query) {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMatches(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return matches;
}

export default function App() {
  const { t, locale } = usePrefs();
  const { link, rover, quality, fire, motors, motorDark, motorLights, motorSensors, sonar, pose, error, send, key, setKey } = useRover();
  // The headlights hang on the second ESP32 (next to the light sensor); a rover board that has them still works.
  const lamps = motorLights
    ? { online: true, ...motorLights, dark: motorDark }
    : { online: rover.online, front: rover.front, rear: rover.rear, auto: rover.auto, dark: rover.dark };
  const [armed, setArmed] = useState(false);

  const linked = link === 'open' && rover.online;
  const navAuto = rover.nav === 'auto';
  // While the rover steers itself the drive keys stay locked; a stop ends auto.
  const enabled = armed && linked && !navAuto;
  const { command, press, release, halt, haltCount } = useDrive({ send, enabled });

  // Is the rover really doing what the keys say? Its status reports the motion it is in; if that stays different from
  // the command for a moment, the commands are not getting through (a stalled link, a board that is resetting).
  const [notFollowing, setNotFollowing] = useState(false);
  useEffect(() => {
    const mismatch = enabled && command !== 'stop' && rover.motion !== command;
    if (!mismatch) {
      setNotFollowing(false);
      return undefined;
    }
    const id = setTimeout(() => setNotFollowing(true), 900);
    return () => clearTimeout(id);
  }, [enabled, command, rover.motion]);

  // Losing the rover or the link disarms; the operator re-arms on purpose.
  useEffect(() => {
    if (!linked) setArmed(false);
  }, [linked]);

  // Switching a lamp off remembers its level, so switching on restores it.
  const lastLevel = useRef({ front: 100, rear: 100 });
  const setLamp = (light, level) => {
    if (lamps.online) send({ type: 'light', light, level });
  };
  const toggleLamp = (light) => {
    const now = lamps[light];
    if (now > 0) lastLevel.current[light] = now;
    setLamp(light, now > 0 ? 0 : lastLevel.current[light]);
  };
  const toggleLampRef = useRef(toggleLamp);
  toggleLampRef.current = toggleLamp;

  // AUTO hands the headlights to the light sensor; any manual lamp change on the
  // rover ends it, and the rover's report keeps this button honest.
  const toggleAuto = () => {
    if (lamps.online) send({ type: 'light_mode', mode: lamps.auto ? 'manual' : 'auto' });
  };
  const toggleAutoRef = useRef(toggleAuto);
  toggleAutoRef.current = toggleAuto;

  // The manual / auto-navigate switch is hidden for now. If the rover is still in auto from before, hand it back to
  // manual so the drive keys are not left locked with no way to unlock them.
  useEffect(() => {
    if (rover.online && navAuto) send({ type: 'nav_mode', mode: 'manual' });
  }, [rover.online, navAuto, send]);

  useEffect(() => {
    const down = (event) => {
      if (isTextEntry(event.target) || event.metaKey || event.ctrlKey || event.altKey) return;
      const k = event.key.toLowerCase();
      if (k === ' ') {
        event.preventDefault();
        halt();
        return;
      }
      if (!event.repeat && k === 'l') return toggleAutoRef.current();
      if (!event.repeat && (k === 'f' || k === 'r')) return toggleLampRef.current(k === 'f' ? 'front' : 'rear');
      const cmd = KEY_COMMANDS[k];
      if (!cmd) return;
      event.preventDefault(); // arrow keys would scroll the page
      if (!event.repeat) press(`key:${k}`, cmd);
    };
    const up = (event) => {
      const k = event.key.toLowerCase();
      if (KEY_COMMANDS[k]) release(`key:${k}`);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, [press, release, halt]);

  // ---- app shell: pages behind a navigation drawer ---------------------------
  const wide = useMedia('(min-width: 1060px)');
  const [page, setPage] = useState(readPage);
  const [drawer, setDrawer] = useState(false);
  const scroller = useRef(null);
  const activeItem = useRef(null);
  const drawerHidden = !wide && !drawer;
  const pageDef = PAGES.find((p) => p.id === page) ?? PAGES[0];

  const go = useCallback((id) => {
    if (window.location.hash !== `#/${id}`) window.location.hash = `#/${id}`;
    setPage(id);
    setDrawer(false);
    scroller.current?.scrollTo({ top: 0 });
  }, []);

  // The address bar and the back button move between pages like they would in an app.
  useEffect(() => {
    const on = () => {
      setPage(readPage());
      scroller.current?.scrollTo({ top: 0 });
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);

  // Swipe in from the left edge to open the drawer, swipe left to close it.
  useEffect(() => {
    let start = null;
    const down = (e) => {
      const t0 = e.touches[0];
      start = { x: t0.clientX, y: t0.clientY };
    };
    const up = (e) => {
      if (!start || window.matchMedia('(min-width: 1060px)').matches) return;
      const t1 = e.changedTouches[0];
      const dx = t1.clientX - start.x;
      const dy = Math.abs(t1.clientY - start.y);
      const from = start.x;
      start = null;
      if (dy > 60) return;
      if (dx > 70 && from < 28) setDrawer(true);
      else if (dx < -70) setDrawer(false);
    };
    window.addEventListener('touchstart', down, { passive: true });
    window.addEventListener('touchend', up, { passive: true });
    return () => {
      window.removeEventListener('touchstart', down);
      window.removeEventListener('touchend', up);
    };
  }, []);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && setDrawer(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Opening the drawer moves focus into it; closing it hands focus back to the menu button.
  useEffect(() => {
    if (drawer) activeItem.current?.focus();
  }, [drawer]);

  // Material-style touch ripple on every button and drawer item.
  useEffect(() => {
    const down = (e) => {
      const el = e.target.closest?.('button:not(:disabled), .drawer-item');
      if (!el) return;
      const r = el.getBoundingClientRect();
      const size = Math.max(r.width, r.height) * 2;
      const dot = document.createElement('span');
      dot.className = 'ripple';
      dot.style.cssText = `width:${size}px;height:${size}px;left:${e.clientX - r.left - size / 2}px;top:${e.clientY - r.top - size / 2}px`;
      el.appendChild(dot);
      dot.addEventListener('animationend', () => dot.remove());
    };
    document.addEventListener('pointerdown', down, { passive: true });
    return () => document.removeEventListener('pointerdown', down);
  }, []);

  const readout = !rover.online
    ? t('readout.noRover')
    : navAuto
      ? t('readout.auto', { state: t(`navstate.${rover.navState}`) })
      : !armed
        ? t('readout.locked')
        : command === 'stop'
          ? t('readout.hold')
          : t(`motion.${command}`);

  // Known server errors are translated; anything else is shown as sent.
  const errorText = (e) => {
    const translated = t(`err.${e}`);
    return translated === `err.${e}` ? e : translated;
  };

  // Active means the rover is reporting in right now. Remember when it last was.
  const lastActive = useRef(null);
  if (rover.online) lastActive.current = Date.now();

  // The simulator registers as AGRIROVER-SIM. Say so wherever "active" is shown, so a fake rover left
  // running in the background is never mistaken for the real one.
  const simulated = rover.online && /-SIM$/i.test(rover.deviceId ?? '');
  const activeLabel = rover.online ? t('active.on') + (simulated ? ` · ${t('active.sim')}` : '') : t('active.off');

  const linkText = t(`link.${link === 'open' ? 'open' : link}`);

  return (
    <div className="app" data-drawer={drawer || undefined}>
      <aside
        className="drawer"
        id="drawer"
        aria-label={t('drawer.menu')}
        aria-hidden={drawerHidden || undefined}
        inert={drawerHidden || undefined}
      >
        <div className="drawer-head">
          <BrandLogo />
          <div className="brand">
            <Logo />
            <div>
              <p className="wordmark">
                Agri<span>Vision</span>
              </p>
              <p className="tagline">{t('app.tagline')}</p>
            </div>
          </div>
          <p className="drawer-status mono" data-state={rover.online ? 'on' : 'off'}>
            <span className="dot" aria-hidden="true" />
            {activeLabel.toUpperCase()}
            {rover.online && <span className="dev-id"> · {rover.deviceId}</span>}
          </p>
        </div>

        <nav aria-label={t('drawer.menu')}>
          <ul className="drawer-list">
            {PAGES.map(({ id, title, Icon }) => (
              <li key={id}>
                <a
                  href={`#/${id}`}
                  className="drawer-item"
                  aria-current={page === id ? 'page' : undefined}
                  ref={page === id ? activeItem : undefined}
                  onClick={(e) => {
                    e.preventDefault();
                    go(id);
                  }}
                >
                  <Icon />
                  <span>{t(title)}</span>
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <DrawerAccount />
        <DrawerPrefs />
      </aside>
      <div className="scrim" onClick={() => setDrawer(false)} aria-hidden="true" />

      <div className="main">
        <header className="appbar">
          <div className="appbar-row">
            <button
              type="button"
              className="menu-btn"
              aria-label={drawer ? t('drawer.close') : t('drawer.open')}
              aria-expanded={drawer}
              aria-controls="drawer"
              onClick={() => setDrawer((d) => !d)}
            >
              <Menu />
            </button>
            <BrandLogo />
            <SignalBars quality={quality} />
            <span className="bar-chip mono" data-state={rover.online ? 'on' : 'off'} data-sim={simulated || undefined} role="status">
              <span className="dot" aria-hidden="true" />
              {activeLabel.toUpperCase()}
            </span>
          </div>
          <h1 className="appbar-title">{t(pageDef.title)}</h1>
        </header>

        <main className="page-scroll" ref={scroller}>
          {link === 'denied' && <KeyForm onSubmit={setKey} current={key} />}
          {error && link !== 'denied' && (
            <p className="notice mono" role="alert">
              {errorText(error).toUpperCase()}
            </p>
          )}

          <div className="page" key={page} data-page={page}>
            {page === 'control' && (
              <>
                <section className="hero" aria-label={t('hero.kicker')}>
                  <SafeImg src="/rover-field.jpg" alt={t('hero.alt')} fallback={<div className="hero-fallback" role="img" aria-label={t('hero.alt')} />} />
                  <p className="active-badge mono" data-state={rover.online ? 'on' : 'off'} data-sim={simulated || undefined}>
                    <span className="dot" aria-hidden="true" />
                    {activeLabel.toUpperCase()}
                    {!rover.online && (
                      <span className="last">
                        {' · '}
                        {lastActive.current
                          ? t('active.lastSeen', { time: new Date(lastActive.current).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }) })
                          : t('active.never')}
                      </span>
                    )}
                  </p>
                  <div className="hero-text">
                    <p className="hero-kicker mono">{t('hero.kicker').toUpperCase()}</p>
                    <p className="hero-title">{rover.online ? t('hero.ready') : t('hero.waiting')}</p>
                    <p className="hero-sub">
                      {rover.online
                        ? `${
                            navAuto
                              ? t('hero.navigating', { state: t(`navstate.${rover.navState}`) })
                              : rover.motion === 'stop'
                                ? t('hero.holding')
                                : t('hero.moving', { dir: t(`motion.${rover.motion}`) })
                          } · ${lamps.auto ? t('hero.lightsAuto') : t('hero.lightsManual')}`
                        : t('hero.waitingSub')}
                    </p>
                  </div>
                </section>

                <CameraCard accessKey={key} send={send} panReady={motors.length > 0} />

                <SonarCard sonar={sonar} />

                <section className="card drive" aria-label={t('control.title')}>
                  <h2 className="card-title">
                    {t('control.title')}
                    <span className="mono card-note">{t('control.note')}</span>
                  </h2>
                  <p className="readout" aria-hidden="true">
                    {readout}
                  </p>
                  {enabled && command !== 'stop' && (notFollowing || quality.state === 'poor' || quality.state === 'down') && (
                    <p className="drive-warn" role="alert">
                      {notFollowing ? t('drive.notFollowing') : t('drive.weakLink')}
                    </p>
                  )}

                  <button type="button" className="arm" aria-pressed={armed} disabled={!linked} onClick={() => setArmed((a) => !a)}>
                    <span className="arm-state mono">{(armed ? t('arm.armed') : t('arm.locked')).toUpperCase()}</span>
                    <span className="arm-text">{armed ? t('arm.armedText') : t('arm.lockedText')}</span>
                  </button>

                  <Joystick enabled={enabled} command={command} press={press} release={release} haltCount={haltCount} />
                  <button type="button" className="key stop" onPointerDown={halt} aria-label={t('key.stop')}>
                    <StopMark />
                    <span className="stop-text">{t('key.stop').toUpperCase()}</span>
                    <span className="hint mono">{t('key.space').toUpperCase()}</span>
                  </button>
                  <HornButton send={send} visible={rover.online && rover.buzzer.fitted} />

                  <div className="range-section" role="group" aria-label={t('range.title')}>
                    <h3 className="nav-head">
                      {t('range.title')}
                      <span className="mono card-note">{t('range.note')}</span>
                    </h3>
                    {!rover.online ? (
                      <p className="nav-state">{t('range.waiting')}</p>
                    ) : !rover.sonar ? (
                      <p className="nav-state">{t('range.noSonar')}</p>
                    ) : (
                      <RangeScene cm={rover.scan.c} motion={rover.motion} />
                    )}
                  </div>
                </section>
              </>
            )}

            {page === 'view3d' && <Rover3DPage pose={pose} sonar={sonar} />}

            {page === 'lights' && (
              <section className="card c-lights" aria-label={t('lights.title')}>
                <h2 className="card-title">
                  {t('lights.title')}
                  <span className="mono card-note">{t('lights.note')}</span>
                </h2>
                <button type="button" className="arm auto-lights" aria-pressed={lamps.auto} disabled={!lamps.online} onClick={toggleAuto}>
                  <span className="arm-state mono">{(lamps.auto ? t('lights.auto') : t('lights.manual')).toUpperCase()}</span>
                  <span className="arm-text">
                    {lamps.auto
                      ? t('lights.autoText', { sensor: lamps.dark ? t('lights.sensorDark') : t('lights.sensorBright') })
                      : t('lights.manualText')}
                  </span>
                </button>
                <div className="lamps">
                  <Lamp name={t('lamp.front')} hint="F" level={lamps.front} disabled={!lamps.online} onToggle={() => toggleLamp('front')} onLevel={(v) => setLamp('front', v)} />
                  <Lamp name={t('lamp.rear')} hint="R" level={lamps.rear} disabled={!lamps.online} onToggle={() => toggleLamp('rear')} onLevel={(v) => setLamp('rear', v)} />
                </div>
              </section>
            )}

            {page === 'sensors' && <FieldSensors sensors={rover.sensors} boardSensors={motorSensors} fire={fire} online={rover.online} buzzer={rover.buzzer} send={send} />}

            {page === 'environment' && <FieldConditions accessKey={key} />}
            {page === 'support' && <SupportPage accessKey={key} />}
            {page === 'account' && <AccountPage />}

            {page === 'status' && (
              <>
                <section className="card c-quality" aria-label={t('quality.title')}>
                  <h2 className="card-title">{t('quality.title')}</h2>
                  <LinkQuality quality={quality} rssi={rover.rssi} online={rover.online} />
                </section>
                <section className="card c-status" aria-label={t('status.title')}>
                  <h2 className="card-title">{t('status.title')}</h2>
                  <Specs link={link} rover={rover} motors={motors} motorDark={motorDark} motorLights={motorLights} sonar={sonar} />
                </section>
                <section className="card c-runs" aria-label={t('runs.title')}>
                  <h2 className="card-title">{t('runs.title')}</h2>
                  <History accessKey={key} locale={locale} />
                </section>
              </>
            )}
          </div>

          <footer className="foot mono">{t('foot.text').toUpperCase()}</footer>
        </main>

        <ActionBar armed={armed} linked={linked} onArm={() => setArmed((a) => !a)} onStop={halt} />
      </div>

      <p className="sr-only" role="status">
        {armed ? t('sr.armed') : t('sr.locked')}. {rover.online ? t('sr.online') : t('sr.offline')}.
      </p>
    </div>
  );
}

/**
 * Hold to sound the rover's buzzer. While held it repeats every 100 ms, like a drive key, because the
 * rover silences the horn 500 ms after the last command: a dropped link or a closed tab cannot leave
 * it blaring. Only shown when the rover reports a buzzer.
 */
function HornButton({ send, visible }) {
  const { t } = usePrefs();
  const timer = useRef(null);

  const stop = useCallback(() => {
    if (timer.current == null) return;
    clearInterval(timer.current);
    timer.current = null;
    send({ type: 'horn', on: false });
  }, [send]);

  const start = (event) => {
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
      /* the pointer is already gone; the press still counts */
    }
    if (timer.current != null) return;
    send({ type: 'horn', on: true });
    timer.current = setInterval(() => send({ type: 'horn', on: true }), 100);
  };

  useEffect(() => {
    window.addEventListener('blur', stop);
    document.addEventListener('visibilitychange', stop);
    return () => {
      stop();
      window.removeEventListener('blur', stop);
      document.removeEventListener('visibilitychange', stop);
    };
  }, [stop]);

  if (!visible) return null;
  return (
    <button
      type="button"
      className="horn"
      aria-label={t('horn.hint')}
      onPointerDown={start}
      onPointerUp={stop}
      onPointerCancel={stop}
      onLostPointerCapture={stop}
      onContextMenu={(e) => e.preventDefault()}
    >
      <IconHorn />
      <span className="horn-label">{t('horn.label').toUpperCase()}</span>
      <span className="horn-hint">{t('horn.hint')}</span>
    </button>
  );
}

/**
 * Pinned to the bottom of phones and tablets so the two things that matter most, arming and
 * stopping, are always under the thumb however far the page is scrolled. Hidden on wide screens,
 * where the drive card is on screen and Space stops.
 */
function ActionBar({ armed, linked, onArm, onStop }) {
  const { t } = usePrefs();
  return (
    <div className="action-bar" role="group" aria-label={t('control.title')}>
      <button type="button" className="bar-arm" aria-pressed={armed} disabled={!linked} onClick={onArm}>
        {(armed ? t('arm.armed') : t('arm.locked')).toUpperCase()}
      </button>
      <button type="button" className="bar-stop" onPointerDown={onStop} aria-label={t('key.stop')}>
        <StopMark />
        {t('key.stop').toUpperCase()}
      </button>
    </div>
  );
}

/** Four bars that fill with the strength of the path to the rover, with the round-trip time beside them. */
function SignalBars({ quality, large = false }) {
  const { t } = usePrefs();
  const bars = { good: 4, ok: 3, poor: 2, down: 0, idle: 0 }[quality.state] ?? 0;
  const ms = quality.roverMs ?? quality.serverMs;
  const label = `${t('quality.title')}: ${t(`quality.state.${quality.state}`)}${ms != null ? `, ${ms} ms` : ''}`;
  return (
    <span className="signal" data-state={quality.state} data-large={large || undefined} role="img" aria-label={label} title={label}>
      <span className="signal-bars" aria-hidden="true">
        {[1, 2, 3, 4].map((n) => (
          <i key={n} data-on={n <= bars || undefined} style={{ height: `${6 + n * (large ? 7 : 4)}px` }} />
        ))}
      </span>
      {ms != null && <span className="signal-ms mono">{ms} ms</span>}
    </span>
  );
}

/** What the probes say about the path, in words, with the numbers underneath. */
function LinkQuality({ quality, rssi, online }) {
  const { t } = usePrefs();
  const state = quality.state;
  const ms = (v) => (v == null ? '\u2014' : t('quality.ms', { n: v }));
  const wifi = rssi == null ? null : rssi >= -60 ? 'strong' : rssi >= -72 ? 'ok' : 'weak';
  return (
    <div className="quality" data-state={state}>
      <div className="quality-head">
        <SignalBars quality={quality} large />
        <div>
          <p className="quality-state">{t(`quality.state.${state}`)}</p>
          <p className="quality-tip">{t(`quality.tip.${state}`)}</p>
        </div>
      </div>
      <ul className="quality-stats">
        <li>
          <span>{t('quality.server')}</span>
          <strong className="mono">{ms(quality.serverMs)}</strong>
        </li>
        <li>
          <span>{t('quality.rover')}</span>
          <strong className="mono">{online ? ms(quality.roverMs) : '\u2014'}</strong>
        </li>
        <li>
          <span>{t('quality.avg')}</span>
          <strong className="mono">{online ? ms(quality.avgMs) : '\u2014'}</strong>
        </li>
        <li data-warn={quality.lossPct > 0 || undefined}>
          <span>{t('quality.loss')}</span>
          <strong className="mono">{online && quality.probes ? `${quality.lossPct}%` : '\u2014'}</strong>
        </li>
        <li data-warn={wifi === 'weak' || undefined}>
          <span>{t('quality.wifi')}</span>
          <strong className="mono">{wifi ? `${t(`quality.rssi.${wifi}`)} · ${rssi} dBm` : '\u2014'}</strong>
        </li>
      </ul>
    </div>
  );
}

/** Soil moisture, rain and the 5-channel fire sensor, as reported by the boards over the websocket. */
function FieldSensors({ sensors, boardSensors, fire, online, buzzer, send }) {
  const { t } = usePrefs();
  // Soil and rain come from the second ESP32 (or a rover board that has them); fire is its own connection,
  // so either can be live without the other.
  const soil = boardSensors?.soil ?? (online ? sensors?.soil : null) ?? null;
  const rain = boardSensors?.rain ?? (online ? sensors?.rain : null) ?? null;
  const live = soil != null || rain != null || fire.online;
  const fireCount = fire.online ? fire.count : 0;
  return (
    <section className="card c-sensors" aria-label={t('sensors.title')}>
      <h2 className="card-title">
        {t('sensors.title')}
        <span className="mono card-note">{(live ? t('sensors.live') : t('sensors.notConnected')).toUpperCase()}</span>
      </h2>
      {fireCount > 0 && (
        <p className="notice mono" role="alert">
          {t('sensors.fireWarn', { n: fireCount }).toUpperCase()}
        </p>
      )}
      <div className="scenes">
        <SoilScene value={soil} />
        <RainScene value={rain} />
      </div>
      <FireCard fire={fire} />
      {!live && <p className="muted">{t('sensors.hint')}</p>}
      {online && buzzer.fitted && (
        <>
          <button
            type="button"
            className="switch-row mute-row"
            role="switch"
            aria-checked={buzzer.muted}
            onClick={() => send({ type: 'alarm_mute', mute: !buzzer.muted })}
          >
            <IconHorn />
            <span>{t('alarm.mute')}</span>
            <span className="switch" aria-hidden="true" />
          </button>
          <p className="muted">{t('alarm.muteHint')}</p>
        </>
      )}
    </section>
  );
}

/** Where each flame channel looks, left to right across the front of the rover (D1 is the far left). */
const FIRE_DIRECTIONS = ['left', 'frontLeft', 'ahead', 'frontRight', 'right'];

/**
 * The 5-channel flame sensor, live from its own board: a fan with one wedge per direction that glows and burns while
 * that channel sees a flame, and a row of chips that names each direction and says what it sees.
 */
function FireCard({ fire }) {
  const { t } = usePrefs();
  const alert = fire.online && fire.count > 0;
  const state = !fire.online ? t('fire.boardOffline') : alert ? t('sensors.fireAlert', { n: fire.count }) : t('sensors.fireClear');
  const dirName = (i) => t(`fire.dir.${FIRE_DIRECTIONS[i]}`);
  const where = fire.channels.flatMap((on, i) => (on ? [dirName(i)] : [])).join(', ');
  return (
    <div className="fire-card" data-alert={alert || undefined} data-online={fire.online || undefined}>
      {alert && (
        <div className="fire-embers" aria-hidden="true">
          {[8, 20, 33, 47, 60, 72, 85].map((left, i) => (
            <span key={left} style={{ left: `${left}%`, animationDelay: `${(i * 0.37) % 2.1}s` }} />
          ))}
        </div>
      )}
      <div className="fire-head">
        <SensorMark kind="flame" />
        <span className="fire-name">{t('sensors.fire')}</span>
        <span className="fire-value mono">{state}</span>
      </div>
      <p className="fire-banner" role={alert ? 'alert' : 'status'}>
        {!fire.online ? t('fire.offlineNote') : alert ? t('fire.detected', { where }) : t('fire.allClear')}
      </p>
      <FireFan channels={fire.channels} online={fire.online} />
      <ul className="fire-channels" aria-label={t('fire.channels')}>
        {fire.channels.map((on, i) => {
          const lit = fire.online && on;
          return (
            <li key={i} data-on={lit || undefined} data-off={!fire.online || undefined} aria-label={`${dirName(i)}: ${!fire.online ? t('fire.state.off') : lit ? t('fire.state.fire') : t('fire.state.clear')}`}>
              <span className="fire-lamp" aria-hidden="true" />
              <span className="mono fire-id">D{i + 1}</span>
              <span className="fire-dir">{dirName(i)}</span>
              <span className="fire-st mono">{!fire.online ? '—' : lit ? t('fire.state.fire').toUpperCase() : t('fire.state.clear').toUpperCase()}</span>
            </li>
          );
        })}
      </ul>
      {fire.online && (
        <p className="fire-board mono">
          {t('fire.boardOnline', { id: fire.deviceId })}
          {fire.rssi != null ? ` · ${fire.rssi} dBm` : ''}
        </p>
      )}
    </div>
  );
}

/** Language and dark mode at the foot of the drawer. English and light are the defaults. */
function DrawerPrefs() {
  const { t, lang, setLang, theme, setTheme } = usePrefs();
  const dark = theme === 'dark';
  return (
    <div className="drawer-foot">
      <p className="drawer-label mono">{t('prefs.language').toUpperCase()}</p>
      <div className="lang" role="group" aria-label={t('prefs.language')}>
        {LANGUAGES.map((l) => (
          <button key={l.code} type="button" lang={l.code} aria-pressed={lang === l.code} onClick={() => setLang(l.code)} title={l.name}>
            {l.label}
          </button>
        ))}
      </div>
      <button type="button" className="switch-row" role="switch" aria-checked={dark} onClick={() => setTheme(dark ? 'light' : 'dark')}>
        {dark ? <Moon /> : <Sun />}
        <span>{t('prefs.dark')}</span>
        <span className="switch" aria-hidden="true" />
      </button>
    </div>
  );
}

/** Who is signed in, and the way out. Not shown when the server runs without accounts. */
function DrawerAccount() {
  const { t } = usePrefs();
  const { user, logout } = useAuth();
  if (!user) return null;
  const place = [user.village, user.district].filter(Boolean).join(', ');
  return (
    <div className="drawer-account">
      <span className="avatar" aria-hidden="true">
        {user.name.trim().charAt(0).toUpperCase()}
      </span>
      <div className="who">
        <p className="who-name">
          {user.name}
          {user.role === 'admin' && <span className="role mono"> · {t('acct.admin').toUpperCase()}</span>}
        </p>
        {place && <p className="who-place">{place}</p>}
      </div>
      <button type="button" className="plain out" onClick={logout}>
        {t('acct.logout')}
      </button>
    </div>
  );
}

/** Slider commands are sent at most this often while dragging, plus once on release. */
const SEND_EVERY_MS = 60;

function Lamp({ name, hint, level, disabled, onToggle, onLevel }) {
  const { t } = usePrefs();
  // While the operator drags, show their value; the rover's report catches up after.
  const [drag, setDrag] = useState(null);
  const lastSent = useRef(0);
  const trailing = useRef(null);
  const settle = useRef(null);
  const shown = drag ?? level;
  const on = level > 0;

  useEffect(() => () => {
    clearTimeout(trailing.current);
    clearTimeout(settle.current);
  }, []);

  const change = (event) => {
    const value = Number(event.target.value);
    setDrag(value);
    clearTimeout(settle.current);
    const wait = SEND_EVERY_MS - (Date.now() - lastSent.current);
    clearTimeout(trailing.current);
    if (wait <= 0) {
      lastSent.current = Date.now();
      onLevel(value);
    } else {
      trailing.current = setTimeout(() => {
        lastSent.current = Date.now();
        onLevel(value);
      }, wait);
    }
  };

  const release = (event) => {
    const value = Number(event.currentTarget.value);
    clearTimeout(trailing.current);
    lastSent.current = Date.now();
    onLevel(value);
    settle.current = setTimeout(() => setDrag(null), 600);
  };

  return (
    <div className="lamp" data-on={on || undefined} data-disabled={disabled || undefined}>
      <button type="button" className="lamp-toggle" aria-pressed={on} disabled={disabled} onClick={onToggle}>
        <LampMark on={on} />
        <span className="lamp-name">{name}</span>
        <span className="lamp-state mono">{on ? `${shown}%` : t('lamp.off').toUpperCase()}</span>
        <span className="hint mono">{hint}</span>
      </button>
      <input
        className="dim"
        type="range"
        min="0"
        max="100"
        step="5"
        value={shown}
        disabled={disabled}
        aria-label={t('lamp.brightness', { name })}
        aria-valuetext={t('lamp.percent', { n: shown })}
        onChange={change}
        onPointerUp={release}
        onKeyUp={release}
        onBlur={release}
      />
    </div>
  );
}

function Specs({ link, rover, motors = [], motorDark = null, motorLights = null, sonar }) {
  const { t } = usePrefs();
  const [db, setDb] = useState(null);
  useEffect(() => {
    let live = true;
    fetch('/api/health')
      .then((r) => r.json())
      .then((h) => live && setDb(Boolean(h.history)))
      .catch(() => live && setDb(null));
    return () => {
      live = false;
    };
  }, []);
  const [since, setSince] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (link === 'open') setSince(Date.now());
  }, [link]);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const dash = '—';
  const rows = useMemo(
    () => [
      [t('status.server'), t(`link.${link}`)],
      [t('status.database'), db == null ? dash : db ? t('status.dbOn') : t('status.dbOff')],
      [t('status.rover'), rover.online ? t('status.online') : t('status.offline')],
      [t('status.rearBoard'), motors.length > 0 ? t('status.online') : t('status.offline')],
      [t('status.sonarBoard'), sonar?.online ? t('status.online') : t('status.offline')],
      [t('status.motion'), rover.online ? t(`motion.${rover.motion}`) : dash],
      [
        t('status.navigation'),
        rover.online ? (rover.nav === 'auto' ? `${t('status.auto')} · ${t(`navstate.${rover.navState}`)}` : t('status.manual')) : dash,
      ],
      [t('status.lights'), motorLights || rover.online ? ((motorLights ?? rover).auto ? t('status.auto') : t('status.manual')) : dash],
      [
        t('status.sensor'),
        // The sensor now sits on the second ESP32; a rover board that reports one still works.
        (motorDark ?? (rover.online ? rover.dark : null)) != null
          ? (motorDark ?? rover.dark) ? t('lights.sensorDark') : t('lights.sensorBright')
          : dash,
      ],
      [t('status.signal'), rover.online && rover.rssi != null ? `${rover.rssi} dBm` : dash],
      [t('status.connected'), link === 'open' ? mmss(now - since) : dash],
    ],
    [t, link, rover, motors, motorDark, motorLights, sonar, now, since, db],
  );

  return (
    <dl className="specs">
      {rows.map(([name, value]) => (
        <div className="spec" key={name}>
          <dt>{name}</dt>
          <span className="leader" aria-hidden="true" />
          <dd className="mono">{value.toUpperCase()}</dd>
        </div>
      ))}
    </dl>
  );
}

function History({ accessKey, locale }) {
  const { t } = usePrefs();
  const [data, setData] = useState(null);

  useEffect(() => {
    let live = true;
    fetch('/api/history', { headers: { 'x-access-key': accessKey } })
      .then((r) => (r.ok ? r.json() : { available: false, sessions: [] }))
      .then((json) => live && setData(json))
      .catch(() => live && setData({ available: false, sessions: [] }));
    return () => {
      live = false;
    };
  }, [accessKey]);

  if (!data) return <p className="muted mono">{t('runs.loading').toUpperCase()}</p>;
  if (!data.available) return <p className="muted">{t('runs.noDb')}</p>;
  if (data.sessions.length === 0) return <p className="muted">{t('runs.none')}</p>;

  return (
    <>
      <ol className="specs runs">
        {data.sessions.slice(0, 6).map((s) => (
          <li className="spec" key={s.startedAt}>
            <span>{new Date(s.startedAt).toLocaleString(locale, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
            <span className="leader" aria-hidden="true" />
            <span className="mono">{mmss(s.totalDriveMs)}</span>
          </li>
        ))}
      </ol>
      <p className="muted mono">{t('runs.summary', { n: data.totals.sessions, time: mmss(data.totals.driveMs) }).toUpperCase()}</p>
    </>
  );
}

function KeyForm({ onSubmit, current }) {
  const { t } = usePrefs();
  const [value, setValue] = useState('');
  return (
    <form
      className="notice keyform"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(value);
      }}
    >
      <label htmlFor="access-key" className="mono">
        {(current ? t('key.refused') : t('key.required')).toUpperCase()}
      </label>
      <input id="access-key" type="password" autoComplete="off" value={value} onChange={(e) => setValue(e.target.value)} />
      <button type="submit" className="plain">
        {t('key.unlock')}
      </button>
    </form>
  );
}
