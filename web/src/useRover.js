import { useCallback, useEffect, useRef, useState } from 'react';

const NO_SONAR = { online: false, deviceId: null, front: null, left: null, right: null, back: null, rssi: null };
const NO_POSE = { imu: false, roll: null, pitch: null, yaw: null, gps: null };
const OFFLINE = { online: false, deviceId: null, motion: 'stop', front: false, rear: false, auto: false, dark: null, nav: 'manual', navState: 'idle', sonar: false, scan: { l: null, c: null, r: null }, sensors: { soil: null, rain: null, fire: null }, gps: null, buzzer: { fitted: false, muted: false }, rssi: null };

/** The fire-sensor board is its own device, so it has its own presence and readings. */
const NO_FIRE = { online: false, deviceId: null, channels: [false, false, false, false, false], count: 0, rssi: null };

const PING_EVERY_MS = 2000;
const PING_TIMEOUT_MS = 3000;
const WINDOW = 10; // how many recent probes the loss figure covers

/** How good the path is, from the probes. state: 'down' | 'idle' (no rover to measure) | 'poor' | 'ok' | 'good'. */
const NO_QUALITY = { state: 'down', serverMs: null, roverMs: null, avgMs: null, lossPct: 0, probes: 0 };

const readKey = () => {
  try {
    return sessionStorage.getItem('agrirover-key') ?? '';
  } catch {
    return '';
  }
};

/**
 * One WebSocket to the server, reconnecting with backoff.
 * link: 'connecting' | 'open' | 'closed' | 'denied' (server wants an access key)
 */
export function useRover() {
  const [link, setLink] = useState('connecting');
  const [rover, setRover] = useState(OFFLINE);
  const [error, setError] = useState('');
  const [key, setKeyState] = useState(readKey);
  const socket = useRef(null);
  const [quality, setQuality] = useState(NO_QUALITY);
  const [fire, setFire] = useState(NO_FIRE);
  /** Ids of the extra motor boards (the rear ESP32) the server says are connected. */
  const [motors, setMotors] = useState([]);
  /** The second ESP32's light sensor: true dark, false bright, null when there is no reading. */
  const [motorDark, setMotorDark] = useState(null);
  /** Headlights driven by the second ESP32: {front, rear, auto}, or null when it drives none. */
  const [motorLights, setMotorLights] = useState(null);
  /** Soil and rain wired to the second ESP32: {soil, rain}, or null when it reports none. */
  const [motorSensors, setMotorSensors] = useState(null);
  /** Four-side distances from the third ESP32. */
  const [sonar, setSonar] = useState(NO_SONAR);
  /** Tilt, heading and GPS from the third ESP32. */
  const [pose, setPose] = useState(NO_POSE);
  // Probe bookkeeping lives in a ref: it changes every 2 s and must not re-run the connection effect.
  const probe = useRef({ next: 1, open: new Map(), history: [], serverMs: null, roverMs: null, roverOnline: false });

  const publishQuality = useCallback(() => {
    const p = probe.current;
    if (!p.roverOnline) {
      setQuality({ ...NO_QUALITY, state: p.serverMs == null ? 'down' : 'idle', serverMs: p.serverMs });
      return;
    }
    const recent = p.history.slice(-WINDOW);
    const answered = recent.filter((ms) => ms != null);
    const lossPct = recent.length ? Math.round(((recent.length - answered.length) / recent.length) * 100) : 0;
    const avgMs = answered.length ? Math.round(answered.reduce((a, b) => a + b, 0) / answered.length) : null;
    const lastThree = recent.slice(-3);
    let state = 'good';
    if (lastThree.length === 3 && lastThree.every((ms) => ms == null)) state = 'down';
    else if (lossPct >= 30 || (p.roverMs ?? 0) > 350) state = 'poor';
    else if (lossPct > 0 || (p.roverMs ?? 0) > 150) state = 'ok';
    else if (recent.length === 0) state = 'idle';
    setQuality({ state, serverMs: p.serverMs, roverMs: p.roverMs, avgMs, lossPct, probes: recent.length });
  }, []);
  const publishRef = useRef(publishQuality);
  publishRef.current = publishQuality;

  const setKey = useCallback((next) => {
    try {
      sessionStorage.setItem('agrirover-key', next);
    } catch {
      /* private mode: the key just lasts until reload */
    }
    setKeyState(next);
  }, []);

  useEffect(() => {
    let closedByUs = false;
    let retry = 0;
    let timer;

    const connect = () => {
      setLink('connecting');
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${proto}//${location.host}/ws?role=dashboard&key=${encodeURIComponent(key)}`);
      socket.current = ws;

      ws.onopen = () => {
        retry = 0;
        setLink('open');
        setError('');
      };
      ws.onmessage = (event) => {
        let msg;
        try {
          msg = JSON.parse(event.data);
        } catch {
          return;
        }
        if (msg.type === 'snapshot' || msg.type === 'rover') {
          setRover(msg.rover);
          if (msg.fire) setFire(msg.fire);
          if (msg.sonar) setSonar(msg.sonar);
          if (msg.pose) setPose(msg.pose);
          if (Array.isArray(msg.motors)) {
            setMotors(msg.motors);
            setMotorDark(msg.motorDark ?? null);
            setMotorLights(msg.motorLights ?? null);
            setMotorSensors(msg.motorSensors ?? null);
          }
          if (probe.current.roverOnline !== msg.rover.online) {
            probe.current.roverOnline = msg.rover.online;
            if (!msg.rover.online) probe.current.history = [];
            publishRef.current();
          }
        } else if (msg.type === 'fire') {
          setFire(msg.fire);
        } else if (msg.type === 'pose') {
          setPose(msg.pose);
        } else if (msg.type === 'sonar') {
          setSonar(msg.sonar);
        } else if (msg.type === 'motors') {
          setMotors(Array.isArray(msg.boards) ? msg.boards : []);
          setMotorDark(msg.dark ?? null);
          setMotorLights(msg.lights ?? null);
          setMotorSensors(msg.sensors ?? null);
        } else if (msg.type === 'pong') {
          const p = probe.current;
          const sent = p.open.get(msg.id);
          if (!sent) return;
          const ms = Math.round(performance.now() - sent.at);
          if (msg.scope === 'server') {
            p.serverMs = ms;
            sent.serverDone = true;
            p.roverOnline = msg.rover;
            if (!msg.rover) p.open.delete(msg.id);
          } else {
            p.roverMs = ms;
            p.history.push(ms);
            p.open.delete(msg.id);
          }
          publishRef.current();
        } else if (msg.type === 'error') setError(msg.error);
      };
      ws.onclose = (event) => {
        setRover(OFFLINE);
        setFire(NO_FIRE);
        setMotors([]);
        setMotorDark(null);
        setMotorLights(null);
        setMotorSensors(null);
        setSonar(NO_SONAR);
        setPose(NO_POSE);
        probe.current = { next: 1, open: new Map(), history: [], serverMs: null, roverMs: null, roverOnline: false };
        setQuality(NO_QUALITY);
        if (closedByUs) return;
        if (event.code === 4403) {
          // The session ended (expired, or signed out in another tab): the account page takes over.
          window.dispatchEvent(new Event('agrirover:signed-out'));
          return setLink('closed');
        }
        if (event.code === 4401) return setLink('denied');
        setLink('closed');
        retry += 1;
        timer = setTimeout(connect, Math.min(5000, 500 * 2 ** retry));
      };
    };

    connect();
    return () => {
      closedByUs = true;
      clearTimeout(timer);
      socket.current?.close();
    };
  }, [key]);

  // Probe the whole path (browser -> server -> rover and back) every couple of seconds while connected.
  // A probe the rover never answers counts as lost, which is what a flaky link looks like from here.
  useEffect(() => {
    if (link !== 'open') return undefined;
    const tick = () => {
      const ws = socket.current;
      if (ws?.readyState !== WebSocket.OPEN) return;
      const p = probe.current;
      const now = performance.now();
      for (const [id, sent] of p.open) {
        if (now - sent.at > PING_TIMEOUT_MS) {
          p.open.delete(id);
          if (p.roverOnline) p.history.push(null);
          if (!sent.serverDone) p.serverMs = null;
        }
      }
      const id = p.next++;
      p.open.set(id, { at: now, serverDone: false });
      ws.send(JSON.stringify({ type: 'ping', id }));
      publishRef.current();
    };
    tick();
    const timer = setInterval(tick, PING_EVERY_MS);
    return () => clearInterval(timer);
  }, [link]);

  const send = useCallback((frame) => {
    const ws = socket.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(frame));
  }, []);

  return { link, rover, quality, fire, motors, motorDark, motorLights, motorSensors, sonar, pose, error, send, key, setKey };
}
