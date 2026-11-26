// Wire protocol between dashboard, server and rover. Every inbound frame is
// untrusted: parse and validate here, and nothing past this file sees raw input.

export const MAX_FRAME_BYTES = 1024;

export const MOVES = Object.freeze(['forward', 'backward', 'left', 'right', 'stop']);
export const LIGHTS = Object.freeze(['front', 'rear']);
/** The camera sits on a pan servo: the dashboard nudges it left or right. */
export const PAN_DIRECTIONS = Object.freeze(['left', 'right']);
/** auto: the light sensor decides; manual: the operator's levels stand. */
export const LIGHT_MODES = Object.freeze(['auto', 'manual']);
/** manual: the operator drives; auto: the rover scans with its ultrasonic and steers itself. */
export const NAV_MODES = Object.freeze(['auto', 'manual']);
export const NAV_STATES = Object.freeze(['idle', 'forward', 'scanning', 'turning', 'reversing']);

const DEVICE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

/** Lamp brightness is a whole percent: 0 is off, 100 is full. */
const isLevel = (n) => Number.isInteger(n) && n >= 0 && n <= 100;

/** @typedef {{ok: true, msg: any} | {ok: false, error: string}} Parsed */

/** @returns {Parsed} */
function parseJson(raw) {
  if (typeof raw !== 'string') return { ok: false, error: 'text frames only' };
  if (raw.length > MAX_FRAME_BYTES) return { ok: false, error: 'frame too large' };
  let msg;
  try {
    msg = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'invalid json' };
  }
  if (msg === null || typeof msg !== 'object' || typeof msg.type !== 'string') {
    return { ok: false, error: 'missing type' };
  }
  return { ok: true, msg };
}

/**
 * Frames a dashboard may send.
 * @returns {Parsed}
 */
export function parseDashboardMessage(raw) {
  const parsed = parseJson(raw);
  if (!parsed.ok) return parsed;
  const { msg } = parsed;

  if (msg.type === 'drive') {
    if (!MOVES.includes(msg.command)) return { ok: false, error: 'unknown command' };
    return { ok: true, msg: { type: 'drive', command: msg.command } };
  }
  if (msg.type === 'light') {
    if (!LIGHTS.includes(msg.light)) return { ok: false, error: 'unknown light' };
    if (!isLevel(msg.level)) return { ok: false, error: 'invalid level' };
    return { ok: true, msg: { type: 'light', light: msg.light, level: msg.level } };
  }
  if (msg.type === 'light_mode') {
    if (!LIGHT_MODES.includes(msg.mode)) return { ok: false, error: 'unknown mode' };
    return { ok: true, msg: { type: 'light_mode', mode: msg.mode } };
  }
  if (msg.type === 'ping') {
    // A probe the dashboard uses to measure the link: answered by the server at once and by the rover when it can.
    if (!Number.isInteger(msg.id) || msg.id < 0 || msg.id > 2 ** 31) return { ok: false, error: 'invalid ping' };
    return { ok: true, msg: { type: 'ping', id: msg.id } };
  }
  if (msg.type === 'horn') {
    if (typeof msg.on !== 'boolean') return { ok: false, error: 'invalid horn' };
    return { ok: true, msg: { type: 'horn', on: msg.on } };
  }
  if (msg.type === 'alarm_mute') {
    if (typeof msg.mute !== 'boolean') return { ok: false, error: 'invalid mute' };
    return { ok: true, msg: { type: 'alarm_mute', mute: msg.mute } };
  }
  if (msg.type === 'nav_mode') {
    if (!NAV_MODES.includes(msg.mode)) return { ok: false, error: 'unknown mode' };
    return { ok: true, msg: { type: 'nav_mode', mode: msg.mode } };
  }
  if (msg.type === 'camera_pan') {
    // One small step of the camera's pan servo; the dashboard repeats it while a button is held.
    if (!PAN_DIRECTIONS.includes(msg.direction)) return { ok: false, error: 'unknown direction' };
    return { ok: true, msg: { type: 'camera_pan', direction: msg.direction } };
  }
  return { ok: false, error: 'unsupported type' };
}

/** A distance in whole centimetres, or null when the rover has no reading. */
const distance = (n) => (Number.isInteger(n) && n >= 0 && n <= 500 ? n : null);

/** The registration frame every device sends first. */
function parseRegister(msg) {
  if (typeof msg.deviceId !== 'string' || !DEVICE_ID.test(msg.deviceId)) {
    return { ok: false, error: 'invalid deviceId' };
  }
  const key = typeof msg.key === 'string' ? msg.key.slice(0, 256) : '';
  return { ok: true, msg: { type: 'device_register', deviceId: msg.deviceId, key } };
}

/** The flame sensor has five channels, D1 to D5. */
export const FIRE_CHANNELS = 5;

/**
 * Frames the fire-sensor board may send: one registration, then fire_status heartbeats carrying one flag per
 * flame channel (1 = flame seen). It is a second device alongside the rover, with its own connection.
 * @returns {Parsed}
 */
export function parseSensorNodeMessage(raw) {
  const parsed = parseJson(raw);
  if (!parsed.ok) return parsed;
  const { msg } = parsed;

  if (msg.type === 'device_register') return parseRegister(msg);
  if (msg.type === 'fire_status') {
    const flags = msg.d;
    const valid = Array.isArray(flags) && flags.length === FIRE_CHANNELS && flags.every((v) => v === 0 || v === 1 || v === true || v === false);
    if (!valid) return { ok: false, error: 'invalid channels' };
    const rssi = Number.isFinite(msg.rssi) && msg.rssi <= 0 && msg.rssi >= -127 ? Math.round(msg.rssi) : null;
    return { ok: true, msg: { type: 'fire_status', channels: flags.map((v) => v === 1 || v === true), rssi } };
  }
  return { ok: false, error: 'unsupported type' };
}

/** The four ultrasonic sensors, by the side of the rover each one faces. */
export const SONAR_SIDES = Object.freeze(['front', 'left', 'right', 'back']);

/**
 * Frames the ultrasonic board (the third ESP32) may send: one registration, then sonar_status frames with a
 * distance in whole centimetres per side. Anything else (the board sends -1 for no echo) becomes null.
 * @returns {Parsed}
 */
export function parseSonarNodeMessage(raw) {
  const parsed = parseJson(raw);
  if (!parsed.ok) return parsed;
  const { msg } = parsed;

  if (msg.type === 'device_register') return parseRegister(msg);
  if (msg.type === 'pose_status') {
    // Tilt and heading from the board's motion sensor (null without one).
    const angle = (n, min, max) => (Number.isFinite(n) && n >= min && n <= max ? Math.round(n * 10) / 10 : null);
    const roll = msg.imu === true ? angle(msg.roll, -180, 180) : null;
    const pitch = msg.imu === true ? angle(msg.pitch, -90, 90) : null;
    const yaw = msg.imu === true ? angle(msg.yaw, 0, 360) : null;
    const imu = roll !== null && pitch !== null && yaw !== null;
    return { ok: true, msg: { type: 'pose_status', imu, roll, pitch, yaw } };
  }
  if (msg.type === 'sonar_status') {
    const rssi = Number.isFinite(msg.rssi) && msg.rssi <= 0 && msg.rssi >= -127 ? Math.round(msg.rssi) : null;
    const distances = Object.fromEntries(SONAR_SIDES.map((side) => [side, distance(msg[side])]));
    return { ok: true, msg: { type: 'sonar_status', distances, rssi } };
  }
  return { ok: false, error: 'unsupported type' };
}

/**
 * Frames an extra motor board (the second ESP32 of the 6WD) may send: one registration, then motor_status
 * heartbeats. It obeys the commands the server copies to it and reports whatever sensors are wired to it.
 * @returns {Parsed}
 */
export function parseMotorNodeMessage(raw) {
  const parsed = parseJson(raw);
  if (!parsed.ok) return parsed;
  const { msg } = parsed;

  if (msg.type === 'device_register') return parseRegister(msg);
  if (msg.type === 'motor_status') {
    if (!MOVES.includes(msg.motion)) return { ok: false, error: 'unknown motion' };
    const rssi = Number.isFinite(msg.rssi) && msg.rssi <= 0 && msg.rssi >= -127 ? Math.round(msg.rssi) : null;
    // The board's light sensor, when it has one: null when it sends no reading.
    const dark = typeof msg.dark === 'boolean' ? msg.dark : null;
    // Headlights, when this board drives them: brightness of each lamp and whether the light sensor is in charge.
    const lights = isLevel(msg.front) && isLevel(msg.rear) ? { front: msg.front, rear: msg.rear, auto: msg.auto === true } : null;
    // Soil moisture and rain, 0-100 % (wetter is higher), each null when not fitted.
    const soil = isLevel(msg.soil) ? msg.soil : null;
    const rain = isLevel(msg.rain) ? msg.rain : null;
    const sensors = soil === null && rain === null ? null : { soil, rain };
    return { ok: true, msg: { type: 'motor_status', motion: msg.motion, dark, lights, sensors, rssi } };
  }
  return { ok: false, error: 'unsupported type' };
}

/**
 * Frames a rover may send: one registration, then status heartbeats.
 * @returns {Parsed}
 */
export function parseRoverMessage(raw) {
  const parsed = parseJson(raw);
  if (!parsed.ok) return parsed;
  const { msg } = parsed;

  if (msg.type === 'device_register') return parseRegister(msg);
  if (msg.type === 'pong') {
    if (!Number.isInteger(msg.id) || msg.id < 0 || msg.id > 2 ** 31) return { ok: false, error: 'invalid pong' };
    return { ok: true, msg: { type: 'pong', id: msg.id } };
  }
  if (msg.type === 'status') {
    if (!MOVES.includes(msg.motion)) return { ok: false, error: 'unknown motion' };
    if (!isLevel(msg.front) || !isLevel(msg.rear)) return { ok: false, error: 'invalid lights' };
    const rssi = Number.isFinite(msg.rssi) && msg.rssi <= 0 && msg.rssi >= -127 ? Math.round(msg.rssi) : null;
    // Older firmware sends neither field: treat it as manual with no sensor reading.
    const auto = msg.auto === true;
    const dark = typeof msg.dark === 'boolean' ? msg.dark : null;
    // Navigation fields are optional too: older firmware has no scanner.
    const nav = msg.nav === 'auto' ? 'auto' : 'manual';
    const navState = NAV_STATES.includes(msg.navState) ? msg.navState : 'idle';
    const sonar = msg.sonar === true;
    // Field sensors, each null when that sensor is not fitted: soil and rain are 0-100 %
    // (wetter is higher), fire is how many of the 5 flame channels see fire (0-5).
    const level = (n, max) => (Number.isInteger(n) && n >= 0 && n <= max ? n : null);
    const sensors = { soil: level(msg.sensors?.soil, 100), rain: level(msg.sensors?.rain, 100), fire: level(msg.sensors?.fire, 5) };
    // The buzzer: fitted says whether the rover has one; muted silences its automatic alarms.
    const buzzer = { fitted: msg.buzzer?.fitted === true, muted: msg.buzzer?.muted === true };
    const scan = { l: distance(msg.scan?.l), c: distance(msg.scan?.c), r: distance(msg.scan?.r) };
    return {
      ok: true,
      msg: { type: 'status', motion: msg.motion, front: msg.front, rear: msg.rear, auto, dark, nav, navState, sonar, scan, sensors, buzzer, rssi },
    };
  }
  return { ok: false, error: 'unsupported type' };
}
