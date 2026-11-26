import { timingSafeEqual } from 'node:crypto';
import { FIRE_CHANNELS, parseDashboardMessage, parseMotorNodeMessage, parseRoverMessage, parseSensorNodeMessage, parseSonarNodeMessage, SONAR_SIDES } from './protocol.js';
import { SessionTracker } from './sessions.js';

/** The rover is considered gone when it has not reported for this long. */
export const ROVER_TIMEOUT_MS = 6000;

const NO_SCAN = Object.freeze({ l: null, c: null, r: null });
const NO_SENSORS = Object.freeze({ soil: null, rain: null, fire: null });
const NO_BUZZER = Object.freeze({ fitted: false, muted: false });
/** The fire-sensor board, which is a separate device from the rover: offline, nothing seen. */
const NO_FIRE = Object.freeze({ online: false, deviceId: null, channels: Object.freeze(Array(FIRE_CHANNELS).fill(false)), count: 0, rssi: null });

/** The ultrasonic board: offline, no distances. */
const NO_SONAR = Object.freeze({ online: false, deviceId: null, front: null, left: null, right: null, back: null, rssi: null });

/** Tilt and heading from the same board: nothing known. */
const NO_POSE = Object.freeze({ imu: false, roll: null, pitch: null, yaw: null });

/** Constant-time string comparison; an empty expected key means "open". */
export function keyMatches(expected, given) {
  if (!expected) return true;
  const a = Buffer.from(expected);
  const b = Buffer.from(String(given ?? ''));
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Sockets are anything with send(string) and close(code, reason), so the hub
 * can be tested with fakes and does not care which server library owns them.
 * Driving state lives here in memory; nothing on the drive path waits on the
 * database.
 */
export class Hub {
  /**
   * @param {{accessKey?: string, now?: () => number, onSessionEnd?: (s: object) => void,
   *          log?: {info: Function, warn: Function}}} [options]
   */
  constructor({ accessKey = '', now = Date.now, onSessionEnd = () => {}, log = console } = {}) {
    this.accessKey = accessKey;
    this.now = now;
    this.onSessionEnd = onSessionEnd;
    this.log = log;
    /** @type {Map<object, {tracker: SessionTracker, driving: boolean, navAuto: boolean}>} */
    this.dashboards = new Map();
    /** Probes waiting for the rover's answer: id -> the dashboard that asked. */
    this.pings = new Map();
    /** @type {null | {ws: object, lastSeen: number}} */
    this.rover = null;
    /** The fire-sensor board: its own connection, so it never displaces (or is displaced by) the rover. */
    this.fireNode = null;
    /** Extra motor boards (the second ESP32): they get a copy of every drive command, and nothing else. */
    this.motorNodes = new Map();
    this.fire = NO_FIRE;
    /** The ultrasonic board (the third ESP32): it only reports distances. */
    this.sonarNode = null;
    this.sonar = NO_SONAR;
    this.pose = NO_POSE;
    this.state = { online: false, deviceId: null, motion: 'stop', front: 0, rear: 0, auto: false, dark: null, nav: 'manual', navState: 'idle', sonar: false, scan: NO_SCAN, sensors: NO_SENSORS, buzzer: NO_BUZZER, rssi: null };
  }

  // ---- dashboards ---------------------------------------------------------

  addDashboard(ws) {
    this.dashboards.set(ws, { tracker: new SessionTracker(this.now()), driving: false, navAuto: false });
    this.#send(ws, { type: 'snapshot', rover: this.state, fire: this.fire, motors: this.#motorBoards(), motorDark: this.#motorDark(), motorLights: this.#motorLights(), motorSensors: this.#motorSensors(), sonar: this.sonar, pose: this.pose, serverTime: new Date(this.now()).toISOString() });
  }

  removeDashboard(ws) {
    const entry = this.dashboards.get(ws);
    if (!entry) return;
    this.dashboards.delete(ws);
    // The operator vanished mid-drive: do not leave the rover obeying a ghost.
    // The same goes for an operator who started auto navigation and left.
    if (entry.driving || entry.navAuto) this.#toRover({ type: 'rover_command', command: 'stop' });
    const summary = entry.tracker.end(this.now());
    if (summary) this.onSessionEnd(summary);
  }

  handleDashboard(ws, raw) {
    const entry = this.dashboards.get(ws);
    if (!entry) return;
    const parsed = parseDashboardMessage(raw);
    if (!parsed.ok) return this.#send(ws, { type: 'error', error: parsed.error });
    const { msg } = parsed;

    if (msg.type === 'ping') return this.#handlePing(ws, msg.id);

    // The camera servo hangs on the second ESP32, so it needs that board, not the rover.
    if (msg.type === 'camera_pan') {
      if (this.motorNodes.size === 0) return this.#send(ws, { type: 'error', error: 'camera_offline' });
      for (const node of this.motorNodes.keys()) this.#send(node, { type: 'camera_pan', direction: msg.direction });
      return;
    }

    // Headlights on an extra motor board work without the rover board.
    const lampsElsewhere = (msg.type === 'light' || msg.type === 'light_mode') && this.#motorLights() !== null;
    if (!this.state.online && !lampsElsewhere) return this.#send(ws, { type: 'error', error: 'rover offline' });

    if (msg.type === 'drive') {
      entry.driving = msg.command !== 'stop';
      if (msg.command === 'stop') this.#clearNavOwner(); // a stop also ends auto navigation
      else this.#takeOver(entry, 'driving');
      entry.tracker.onCommand(msg.command, this.now());
      this.#toRover({ type: 'rover_command', command: msg.command });
    } else if (msg.type === 'horn') {
      this.#toRover({ type: 'rover_horn', on: msg.on });
    } else if (msg.type === 'alarm_mute') {
      this.#toRover({ type: 'rover_alarm_mute', mute: msg.mute });
    } else if (msg.type === 'nav_mode') {
      if (msg.mode === 'auto') this.#takeOver(entry, 'navAuto');
      else this.#clearNavOwner();
      this.#toRover({ type: 'rover_nav_mode', mode: msg.mode });
    } else if (msg.type === 'light_mode') {
      this.#toRover({ type: 'rover_light_mode', mode: msg.mode });
    } else {
      entry.tracker.onLight();
      this.#toRover({ type: 'rover_light_command', light: msg.light, level: msg.level });
    }
  }

  // ---- rover --------------------------------------------------------------

  /** First frame on a rover socket. Returns whether the rover was accepted. */
  registerRover(ws, raw) {
    const parsed = parseRoverMessage(raw);
    if (!parsed.ok || parsed.msg.type !== 'device_register') {
      this.log.warn(`[hub] rover rejected: ${parsed.ok ? 'first frame was not device_register' : parsed.error}`);
      this.#send(ws, { type: 'error', error: parsed.ok ? 'register first' : parsed.error });
      return false;
    }
    if (!keyMatches(this.accessKey, parsed.msg.key)) {
      this.log.warn('[hub] rover rejected: bad key');
      this.#send(ws, { type: 'error', error: 'bad key' });
      return false;
    }
    // A reconnecting board supersedes its own lingering socket.
    if (this.rover && this.rover.ws !== ws) this.rover.ws.close(4000, 'superseded');
    this.rover = { ws, lastSeen: this.now(), registeredAt: this.now(), statuses: 0, lastType: 'device_register' };
    this.state = { online: true, deviceId: parsed.msg.deviceId, motion: 'stop', front: 0, rear: 0, auto: false, dark: null, nav: 'manual', navState: 'idle', sonar: false, scan: NO_SCAN, sensors: NO_SENSORS, buzzer: NO_BUZZER, rssi: null };
    this.log.info(`[hub] rover online: ${parsed.msg.deviceId}`);
    this.#send(ws, { type: 'register_ack', deviceId: parsed.msg.deviceId, serverTime: new Date(this.now()).toISOString() });
    this.#broadcastRover();
    return true;
  }

  handleRover(ws, raw) {
    if (!this.rover || this.rover.ws !== ws) return;
    const parsed = parseRoverMessage(raw);
    if (!parsed.ok) {
      this.log.warn(`[hub] rover sent a frame the server rejected (${parsed.error}): ${String(raw).slice(0, 160)}`);
      return this.#send(ws, { type: 'error', error: parsed.error });
    }
    this.rover.lastSeen = this.now();
    this.rover.lastType = parsed.msg.type;
    if (parsed.msg.type === 'pong') return this.#answerPing(parsed.msg.id);
    if (parsed.msg.type !== 'status') return;
    this.rover.statuses += 1;
    const { motion, front, rear, auto, dark, nav, navState, sonar, scan, sensors, buzzer, rssi } = parsed.msg;
    const prev = this.state;
    const signalShifted = rssi !== prev.rssi && (rssi === null || prev.rssi === null || Math.abs(rssi - prev.rssi) >= 5);
    const changed = motion !== prev.motion || front !== prev.front || rear !== prev.rear ||
      auto !== prev.auto || dark !== prev.dark ||
      nav !== prev.nav || navState !== prev.navState || sonar !== prev.sonar ||
      sensors.soil !== prev.sensors.soil || sensors.rain !== prev.sensors.rain || sensors.fire !== prev.sensors.fire ||
      buzzer.fitted !== prev.buzzer.fitted || buzzer.muted !== prev.buzzer.muted ||
      scan.l !== prev.scan.l || scan.c !== prev.scan.c || scan.r !== prev.scan.r || signalShifted;
    this.state = { ...prev, motion, front, rear, auto, dark, nav, navState, sonar, scan, sensors, buzzer, rssi: changed ? rssi : prev.rssi };
    // Heartbeats that change nothing are not rebroadcast; they only keep the rover alive.
    if (changed) this.#broadcastRover();
  }

  removeRover(ws) {
    if (!this.rover || this.rover.ws !== ws) return;
    this.log.info(`[hub] rover disconnected after ${this.#upFor()}`);
    this.#rover_offline();
  }

  /** Call on a timer: a rover that stops reporting is marked offline. */
  tick() {
    if (this.fireNode && this.now() - this.fireNode.lastSeen > ROVER_TIMEOUT_MS) {
      const { ws } = this.fireNode;
      this.log.warn(`[hub] fire sensor timed out: registered ${((this.now() - this.fireNode.registeredAt) / 1000).toFixed(1)} s ago, ${this.fireNode.statuses} status frame(s), silent for ${((this.now() - this.fireNode.lastSeen) / 1000).toFixed(1)} s. The board lost power or reset, or its WiFi dropped.`);
      this.#fireNodeOffline();
      ws.close(4001, 'timeout');
    }
    if (this.sonarNode && this.now() - this.sonarNode.lastSeen > ROVER_TIMEOUT_MS) {
      const { ws, deviceId } = this.sonarNode;
      this.log.warn(`[hub] ultrasonic board ${deviceId} timed out: it lost power or its WiFi dropped.`);
      this.#sonarOffline();
      ws.close(4001, 'timeout');
    }
    for (const [ws, node] of this.motorNodes) {
      if (this.now() - node.lastSeen > ROVER_TIMEOUT_MS) {
        this.log.warn(`[hub] motor board ${node.deviceId} timed out: it lost power or its WiFi dropped.`);
        this.motorNodes.delete(ws);
        ws.close(4001, 'timeout');
        this.#broadcastMotors();
      }
    }
    if (this.rover && this.now() - this.rover.lastSeen > ROVER_TIMEOUT_MS) {
      this.log.warn(`[hub] rover timed out: ${this.#timeoutReason()}`);
      const { ws } = this.rover;
      this.#rover_offline();
      ws.close(4001, 'timeout');
    }
  }

  // ---- extra motor boards -------------------------------------------------

  /** First frame on a motor socket. Returns whether the board was accepted. */
  registerMotorNode(ws, raw) {
    const parsed = parseMotorNodeMessage(raw);
    if (!parsed.ok || parsed.msg.type !== 'device_register') {
      this.log.warn(`[hub] motor board rejected: ${parsed.ok ? 'first frame was not device_register' : parsed.error}`);
      this.#send(ws, { type: 'error', error: parsed.ok ? 'register first' : parsed.error });
      return false;
    }
    if (!keyMatches(this.accessKey, parsed.msg.key)) {
      this.log.warn('[hub] motor board rejected: bad key');
      this.#send(ws, { type: 'error', error: 'bad key' });
      return false;
    }
    // A reconnecting board supersedes its own lingering socket.
    for (const [old, node] of this.motorNodes) {
      if (node.deviceId === parsed.msg.deviceId && old !== ws) {
        this.motorNodes.delete(old);
        old.close(4000, 'superseded');
      }
    }
    this.motorNodes.set(ws, { deviceId: parsed.msg.deviceId, lastSeen: this.now() });
    this.log.info(`[hub] motor board online: ${parsed.msg.deviceId}`);
    this.#send(ws, { type: 'register_ack', deviceId: parsed.msg.deviceId, serverTime: new Date(this.now()).toISOString() });
    this.#broadcastMotors();
    return true;
  }

  handleMotorNode(ws, raw) {
    const node = this.motorNodes.get(ws);
    if (!node) return;
    const parsed = parseMotorNodeMessage(raw);
    if (!parsed.ok) {
      this.log.warn(`[hub] motor board sent a frame the server rejected (${parsed.error}): ${String(raw).slice(0, 160)}`);
      return this.#send(ws, { type: 'error', error: parsed.error });
    }
    node.lastSeen = this.now();
    // Dashboards hear only about a change of sensor readings or headlights, not every heartbeat.
    if (parsed.msg.type !== 'motor_status') return;
    const { dark, lights, sensors } = parsed.msg;
    if ((node.dark ?? null) !== dark || JSON.stringify(node.lights ?? null) !== JSON.stringify(lights) ||
      JSON.stringify(node.sensors ?? null) !== JSON.stringify(sensors)) {
      node.dark = dark;
      node.lights = lights;
      node.sensors = sensors;
      this.#broadcastMotors();
    }
  }

  removeMotorNode(ws) {
    const node = this.motorNodes.get(ws);
    if (!node) return;
    this.motorNodes.delete(ws);
    this.log.info(`[hub] motor board disconnected: ${node.deviceId}`);
    this.#broadcastMotors();
  }

  /** Ids of the extra motor boards that are connected now. */
  #motorBoards() {
    return [...this.motorNodes.values()].map((n) => n.deviceId);
  }

  /** The light reading from whichever extra board has a light sensor: true dark, false bright, null none. */
  #motorDark() {
    for (const n of this.motorNodes.values()) if (typeof n.dark === 'boolean') return n.dark;
    return null;
  }

  /** The headlights of whichever extra board drives them: {front, rear, auto}, or null when none does. */
  #motorLights() {
    for (const n of this.motorNodes.values()) if (n.lights) return n.lights;
    return null;
  }

  /** Soil and rain from whichever extra board has them: {soil, rain}, or null when none does. */
  #motorSensors() {
    for (const n of this.motorNodes.values()) if (n.sensors) return n.sensors;
    return null;
  }

  #broadcastMotors() {
    const frame = JSON.stringify({ type: 'motors', boards: this.#motorBoards(), dark: this.#motorDark(), lights: this.#motorLights(), sensors: this.#motorSensors() });
    for (const ws of this.dashboards.keys()) this.#sendRaw(ws, frame);
  }

  // ---- ultrasonic board ---------------------------------------------------

  /** First frame on a sonar socket. Returns whether the board was accepted. */
  registerSonarNode(ws, raw) {
    const parsed = parseSonarNodeMessage(raw);
    if (!parsed.ok || parsed.msg.type !== 'device_register') {
      this.log.warn(`[hub] ultrasonic board rejected: ${parsed.ok ? 'first frame was not device_register' : parsed.error}`);
      this.#send(ws, { type: 'error', error: parsed.ok ? 'register first' : parsed.error });
      return false;
    }
    if (!keyMatches(this.accessKey, parsed.msg.key)) {
      this.log.warn('[hub] ultrasonic board rejected: bad key');
      this.#send(ws, { type: 'error', error: 'bad key' });
      return false;
    }
    if (this.sonarNode && this.sonarNode.ws !== ws) this.sonarNode.ws.close(4000, 'superseded');
    this.sonarNode = { ws, deviceId: parsed.msg.deviceId, lastSeen: this.now() };
    this.sonar = { ...NO_SONAR, online: true, deviceId: parsed.msg.deviceId };
    this.pose = NO_POSE;
    this.#broadcastPose();
    this.log.info(`[hub] ultrasonic board online: ${parsed.msg.deviceId}`);
    this.#send(ws, { type: 'register_ack', deviceId: parsed.msg.deviceId, serverTime: new Date(this.now()).toISOString() });
    this.#broadcastSonar();
    return true;
  }

  handleSonarNode(ws, raw) {
    if (!this.sonarNode || this.sonarNode.ws !== ws) return;
    const parsed = parseSonarNodeMessage(raw);
    if (!parsed.ok) {
      this.log.warn(`[hub] ultrasonic board sent a frame the server rejected (${parsed.error}): ${String(raw).slice(0, 160)}`);
      return this.#send(ws, { type: 'error', error: parsed.error });
    }
    this.sonarNode.lastSeen = this.now();
    if (parsed.msg.type === 'pose_status') {
      const { type, ...pose } = parsed.msg;
      if (JSON.stringify(pose) === JSON.stringify(this.pose)) return;
      this.pose = pose;
      return this.#broadcastPose();
    }
    if (parsed.msg.type !== 'sonar_status') return;
    const { distances, rssi } = parsed.msg;
    // Heartbeats that change no distance keep the board alive without waking every dashboard.
    const changed = SONAR_SIDES.some((side) => distances[side] !== this.sonar[side]) || this.sonar.rssi === null;
    if (!changed) return;
    this.sonar = { ...this.sonar, ...distances, rssi };
    this.#broadcastSonar();
  }

  removeSonarNode(ws) {
    if (!this.sonarNode || this.sonarNode.ws !== ws) return;
    this.log.info(`[hub] ultrasonic board disconnected: ${this.sonarNode.deviceId}`);
    this.#sonarOffline();
  }

  #sonarOffline() {
    this.sonarNode = null;
    this.sonar = NO_SONAR;
    this.pose = NO_POSE;
    this.#broadcastSonar();
    this.#broadcastPose();
  }

  #broadcastPose() {
    const frame = JSON.stringify({ type: 'pose', pose: this.pose });
    for (const ws of this.dashboards.keys()) this.#sendRaw(ws, frame);
  }

  #broadcastSonar() {
    const frame = JSON.stringify({ type: 'sonar', sonar: this.sonar });
    for (const ws of this.dashboards.keys()) this.#sendRaw(ws, frame);
  }

  // ---- fire-sensor board --------------------------------------------------

  /** First frame on a sensor socket. Returns whether the board was accepted. */
  registerFireNode(ws, raw) {
    const parsed = parseSensorNodeMessage(raw);
    if (!parsed.ok || parsed.msg.type !== 'device_register') {
      this.log.warn(`[hub] fire sensor rejected: ${parsed.ok ? 'first frame was not device_register' : parsed.error}`);
      this.#send(ws, { type: 'error', error: parsed.ok ? 'register first' : parsed.error });
      return false;
    }
    if (!keyMatches(this.accessKey, parsed.msg.key)) {
      this.log.warn('[hub] fire sensor rejected: bad key');
      this.#send(ws, { type: 'error', error: 'bad key' });
      return false;
    }
    if (this.fireNode && this.fireNode.ws !== ws) this.fireNode.ws.close(4000, 'superseded');
    this.fireNode = { ws, lastSeen: this.now(), registeredAt: this.now(), statuses: 0, lastType: 'device_register' };
    // Online but no reading yet: channels stay clear until the board reports, but the count is only trusted once it does.
    this.fire = { ...NO_FIRE, online: true, deviceId: parsed.msg.deviceId };
    this.log.info(`[hub] fire sensor online: ${parsed.msg.deviceId}`);
    this.#send(ws, { type: 'register_ack', deviceId: parsed.msg.deviceId, serverTime: new Date(this.now()).toISOString() });
    this.#broadcastFire();
    return true;
  }

  handleFireNode(ws, raw) {
    if (!this.fireNode || this.fireNode.ws !== ws) return;
    const parsed = parseSensorNodeMessage(raw);
    if (!parsed.ok) {
      this.log.warn(`[hub] fire sensor sent a frame the server rejected (${parsed.error}): ${String(raw).slice(0, 160)}`);
      return this.#send(ws, { type: 'error', error: parsed.error });
    }
    this.fireNode.lastSeen = this.now();
    this.fireNode.lastType = parsed.msg.type;
    if (parsed.msg.type !== 'fire_status') return;
    this.fireNode.statuses += 1;
    const { channels, rssi } = parsed.msg;
    const count = channels.filter(Boolean).length;
    const prev = this.fire;
    const changed = channels.some((v, i) => v !== prev.channels[i]) || prev.rssi === null;
    if (count !== prev.count) {
      this.log.warn(count > 0 ? `[hub] FIRE: ${count} of ${FIRE_CHANNELS} flame channels see fire (${channels.map((v, i) => (v ? `D${i + 1}` : null)).filter(Boolean).join(', ')})` : '[hub] fire cleared');
    }
    this.fire = { ...prev, channels, count, rssi };
    // Heartbeats that change nothing keep the board alive without waking every dashboard.
    if (changed) this.#broadcastFire();
  }

  removeFireNode(ws) {
    if (!this.fireNode || this.fireNode.ws !== ws) return;
    this.log.info(`[hub] fire sensor disconnected after ${((this.now() - this.fireNode.registeredAt) / 1000).toFixed(1)} s, ${this.fireNode.statuses} status frame(s)`);
    this.#fireNodeOffline();
  }

  #fireNodeOffline() {
    this.fireNode = null;
    this.fire = NO_FIRE;
    this.#broadcastFire();
  }

  #broadcastFire() {
    const frame = JSON.stringify({ type: 'fire', fire: this.fire });
    for (const ws of this.dashboards.keys()) this.#sendRaw(ws, frame);
  }

  // ---- internals ----------------------------------------------------------

  /**
   * The dashboard's link probe. The server answers at once (so it can tell the browser-to-server leg from
   * the whole path), then asks the rover, whose reply is passed back as the second half.
   */
  #handlePing(ws, id) {
    this.#send(ws, { type: 'pong', id, scope: 'server', rover: this.state.online });
    if (!this.state.online) return;
    if (this.pings.size > 64) this.pings.delete(this.pings.keys().next().value); // never grow without bound
    this.pings.set(id, ws);
    this.#toRover({ type: 'rover_ping', id });
  }

  #answerPing(id) {
    const ws = this.pings.get(id);
    if (!ws) return;
    this.pings.delete(id);
    this.#send(ws, { type: 'pong', id, scope: 'rover', rover: true });
  }

  /**
   * The rover obeys whoever spoke last, so that dashboard alone is answerable for stopping it when it
   * leaves. Without this, an old tab closing late (or a phone and a laptop open together) would stop a
   * rover another dashboard is now driving.
   */
  #takeOver(owner, field) {
    for (const entry of this.dashboards.values()) {
      if (entry !== owner) {
        entry.driving = false;
        entry.navAuto = false;
      }
    }
    owner[field] = true;
  }

  #clearNavOwner() {
    for (const entry of this.dashboards.values()) entry.navAuto = false;
  }

  #upFor() {
    const r = this.rover;
    return `${((this.now() - r.registeredAt) / 1000).toFixed(1)} s, ${r.statuses} status frame${r.statuses === 1 ? '' : 's'}`;
  }

  /** Why a rover that registered went quiet, in words, so the terminal explains it. */
  #timeoutReason() {
    const r = this.rover;
    const quiet = ((this.now() - r.lastSeen) / 1000).toFixed(1);
    const head = `registered ${((this.now() - r.registeredAt) / 1000).toFixed(1)} s ago, ${r.statuses} status frame(s), silent for ${quiet} s (last frame: ${r.lastType}).`;
    if (r.statuses === 0) {
      return `${head} It registered but never sent a status frame: the board either did not receive our register_ack, or it reset right after registering (check its Serial Monitor: "last reset", "boot #").`;
    }
    return `${head} It was sending, then stopped without closing the connection: the board lost power or reset (brownout), or its WiFi dropped.`;
  }

  #rover_offline() {
    this.rover = null;
    this.state = { online: false, deviceId: null, motion: 'stop', front: 0, rear: 0, auto: false, dark: null, nav: 'manual', navState: 'idle', sonar: false, scan: NO_SCAN, sensors: NO_SENSORS, buzzer: NO_BUZZER, rssi: null };
    this.#broadcastRover();
  }

  #toRover(frame) {
    if (this.rover) this.#send(this.rover.ws, frame);
    // The extra motor boards drive their wheels with the same commands, and stop with them. A board with the
    // headlights also takes the lamp commands.
    const shared = frame.type === 'rover_command' || frame.type === 'rover_light_command' || frame.type === 'rover_light_mode';
    if (shared) for (const ws of this.motorNodes.keys()) this.#send(ws, frame);
  }

  #broadcastRover() {
    const frame = JSON.stringify({ type: 'rover', rover: this.state });
    for (const ws of this.dashboards.keys()) this.#sendRaw(ws, frame);
  }

  #send(ws, frame) {
    this.#sendRaw(ws, JSON.stringify(frame));
  }

  #sendRaw(ws, text) {
    try {
      ws.send(text);
    } catch (err) {
      this.log.warn(`[hub] send failed: ${err.message}`);
    }
  }
}
