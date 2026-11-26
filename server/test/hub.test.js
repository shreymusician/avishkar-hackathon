import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Hub, ROVER_TIMEOUT_MS } from '../src/hub.js';

const quiet = { info() {}, warn() {} };

function fakeSocket() {
  return {
    sent: [],
    closed: null,
    send(text) {
      this.sent.push(JSON.parse(text));
    },
    close(code, reason) {
      this.closed = { code, reason };
    },
    last(type) {
      return [...this.sent].reverse().find((m) => m.type === type);
    },
  };
}

function setup(options = {}) {
  let t = 1000;
  const sessions = [];
  const hub = new Hub({ now: () => t, onSessionEnd: (s) => sessions.push(s), log: quiet, ...options });
  const advance = (ms) => (t += ms);
  const rover = fakeSocket();
  const dash = fakeSocket();
  hub.addDashboard(dash);
  hub.registerRover(rover, JSON.stringify({ type: 'device_register', deviceId: 'R1', key: options.accessKey ?? '' }));
  return { hub, rover, dash, sessions, advance };
}

test('registered rover is acknowledged and announced to dashboards', () => {
  const { rover, dash } = setup();
  assert.equal(rover.last('register_ack').deviceId, 'R1');
  assert.equal(dash.last('rover').rover.online, true);
});

test('drive command reaches the rover', () => {
  const { hub, rover, dash } = setup();
  hub.handleDashboard(dash, JSON.stringify({ type: 'drive', command: 'forward' }));
  assert.deepEqual(rover.last('rover_command'), { type: 'rover_command', command: 'forward' });
});

test('light command reaches the rover', () => {
  const { hub, rover, dash } = setup();
  hub.handleDashboard(dash, JSON.stringify({ type: 'light', light: 'rear', level: 40 }));
  assert.deepEqual(rover.last('rover_light_command'), { type: 'rover_light_command', light: 'rear', level: 40 });
});

test('light mode reaches the rover and its sensor report reaches dashboards', () => {
  const { hub, rover, dash } = setup();
  hub.handleDashboard(dash, JSON.stringify({ type: 'light_mode', mode: 'auto' }));
  assert.deepEqual(rover.last('rover_light_mode'), { type: 'rover_light_mode', mode: 'auto' });
  hub.handleRover(rover, JSON.stringify({ type: 'status', motion: 'stop', front: 100, rear: 100, auto: true, dark: true, rssi: -50 }));
  assert.equal(dash.last('rover').rover.auto, true);
  assert.equal(dash.last('rover').rover.dark, true);
});

test('nav mode reaches the rover, and the scan reaches dashboards', () => {
  const { hub, rover, dash } = setup();
  hub.handleDashboard(dash, JSON.stringify({ type: 'nav_mode', mode: 'auto' }));
  assert.deepEqual(rover.last('rover_nav_mode'), { type: 'rover_nav_mode', mode: 'auto' });
  hub.handleRover(
    rover,
    JSON.stringify({ type: 'status', motion: 'stop', front: 0, rear: 0, nav: 'auto', navState: 'scanning', sonar: true, scan: { l: 80, c: 20, r: 40 }, rssi: -50 }),
  );
  const state = dash.last('rover').rover;
  assert.equal(state.nav, 'auto');
  assert.equal(state.navState, 'scanning');
  assert.deepEqual(state.scan, { l: 80, c: 20, r: 40 });
});

test('a dashboard that leaves during auto navigation stops the rover', () => {
  const { hub, rover, dash } = setup();
  hub.handleDashboard(dash, JSON.stringify({ type: 'nav_mode', mode: 'auto' }));
  hub.removeDashboard(dash);
  assert.deepEqual(rover.last('rover_command'), { type: 'rover_command', command: 'stop' });
});

test('field sensor readings reach dashboards', () => {
  const { hub, rover, dash } = setup();
  hub.handleRover(rover, JSON.stringify({ type: 'status', motion: 'stop', front: 0, rear: 0, sensors: { soil: 35, rain: 4, fire: 0 }, rssi: -50 }));
  assert.deepEqual(dash.last('rover').rover.sensors, { soil: 35, rain: 4, fire: 0 });
  hub.handleRover(rover, JSON.stringify({ type: 'status', motion: 'stop', front: 0, rear: 0, sensors: { soil: 35, rain: 4, fire: 3 }, rssi: -50 }));
  assert.equal(dash.last('rover').rover.sensors.fire, 3);
});


test('horn and alarm mute reach the rover; buzzer state reaches dashboards', () => {
  const { hub, rover, dash } = setup();
  hub.handleDashboard(dash, JSON.stringify({ type: 'horn', on: true }));
  assert.deepEqual(rover.last('rover_horn'), { type: 'rover_horn', on: true });
  hub.handleDashboard(dash, JSON.stringify({ type: 'alarm_mute', mute: true }));
  assert.deepEqual(rover.last('rover_alarm_mute'), { type: 'rover_alarm_mute', mute: true });
  hub.handleRover(rover, JSON.stringify({ type: 'status', motion: 'stop', front: 0, rear: 0, buzzer: { fitted: true, muted: true }, rssi: -50 }));
  assert.deepEqual(dash.last('rover').rover.buzzer, { fitted: true, muted: true });
});

test('a ping is answered by the server at once and by the rover when it replies', () => {
  const { hub, rover, dash } = setup();
  hub.handleDashboard(dash, JSON.stringify({ type: 'ping', id: 41 }));
  assert.deepEqual(dash.last('pong'), { type: 'pong', id: 41, scope: 'server', rover: true });
  assert.deepEqual(rover.last('rover_ping'), { type: 'rover_ping', id: 41 });
  hub.handleRover(rover, JSON.stringify({ type: 'pong', id: 41 }));
  assert.deepEqual(dash.last('pong'), { type: 'pong', id: 41, scope: 'rover', rover: true });
});

test('a ping still gets a server answer when the rover is offline', () => {
  const { hub, rover, dash } = setup();
  hub.removeRover(rover);
  hub.handleDashboard(dash, JSON.stringify({ type: 'ping', id: 5 }));
  assert.deepEqual(dash.last('pong'), { type: 'pong', id: 5, scope: 'server', rover: false });
  assert.equal(dash.last('error'), undefined);
});

test('a rover reply goes only to the dashboard that asked, and only once', () => {
  const { hub, rover, dash } = setup();
  const other = fakeSocket();
  hub.addDashboard(other);
  hub.handleDashboard(dash, JSON.stringify({ type: 'ping', id: 9 }));
  hub.handleRover(rover, JSON.stringify({ type: 'pong', id: 9 }));
  hub.handleRover(rover, JSON.stringify({ type: 'pong', id: 9 })); // a duplicate is ignored
  assert.equal(dash.sent.filter((m) => m.type === 'pong' && m.scope === 'rover').length, 1);
  assert.equal(other.sent.filter((m) => m.type === 'pong').length, 0);
});

test('a timed-out rover is explained: never sent a status vs went silent', () => {
  const lines = [];
  const log = { info: (m) => lines.push(m), warn: (m) => lines.push(m) };
  const { hub, rover, advance } = setup({ log });
  advance(ROVER_TIMEOUT_MS + 500);
  hub.tick();
  assert.match(lines.join('\n'), /timed out: .*0 status frame\(s\).*never sent a status frame/);

  const second = setup({ log });
  second.hub.handleRover(second.rover, JSON.stringify({ type: 'status', motion: 'stop', front: 0, rear: 0, rssi: -50 }));
  second.advance(ROVER_TIMEOUT_MS + 500);
  second.hub.tick();
  assert.match(lines.join('\n'), /1 status frame\(s\).*lost power or reset/);
});

test('a frame the server rejects is logged, not silently ignored', () => {
  const lines = [];
  const { hub, rover } = setup({ log: { info: () => {}, warn: (m) => lines.push(m) } });
  hub.handleRover(rover, JSON.stringify({ type: 'status', motion: 'sideways', front: 0, rear: 0 }));
  assert.match(lines.join('\n'), /rejected \(unknown motion\)/);
});

test('invalid dashboard frames are rejected, not forwarded', () => {
  const { hub, rover, dash } = setup();
  const before = rover.sent.length;
  hub.handleDashboard(dash, JSON.stringify({ type: 'drive', command: 'fly' }));
  hub.handleDashboard(dash, 'not json');
  assert.equal(rover.sent.length, before);
  assert.equal(dash.last('error').error, 'invalid json');
});

test('rover with the wrong key is refused', () => {
  const hub = new Hub({ accessKey: 'secret', log: quiet });
  const rover = fakeSocket();
  const ok = hub.registerRover(rover, JSON.stringify({ type: 'device_register', deviceId: 'R1', key: 'nope' }));
  assert.equal(ok, false);
  assert.equal(hub.state.online, false);
});

test('commands while the rover is offline get an error', () => {
  const hub = new Hub({ log: quiet });
  const dash = fakeSocket();
  hub.addDashboard(dash);
  hub.handleDashboard(dash, JSON.stringify({ type: 'drive', command: 'forward' }));
  assert.equal(dash.last('error').error, 'rover offline');
});

test('a dashboard that disconnects mid-drive stops the rover', () => {
  const { hub, rover, dash } = setup();
  hub.handleDashboard(dash, JSON.stringify({ type: 'drive', command: 'left' }));
  hub.removeDashboard(dash);
  assert.deepEqual(rover.last('rover_command'), { type: 'rover_command', command: 'stop' });
});

test('a dashboard that already stopped does not send a second stop', () => {
  const { hub, rover, dash } = setup();
  hub.handleDashboard(dash, JSON.stringify({ type: 'drive', command: 'left' }));
  hub.handleDashboard(dash, JSON.stringify({ type: 'drive', command: 'stop' }));
  const before = rover.sent.length;
  hub.removeDashboard(dash);
  assert.equal(rover.sent.length, before);
});

test('rover status updates the shared state', () => {
  const { hub, rover, dash } = setup();
  hub.handleRover(rover, JSON.stringify({ type: 'status', motion: 'forward', front: 70, rear: 0, rssi: -60 }));
  assert.equal(hub.state.motion, 'forward');
  assert.equal(dash.last('rover').rover.front, 70);
});

test('a silent rover is marked offline', () => {
  const { hub, rover, dash, advance } = setup();
  advance(ROVER_TIMEOUT_MS + 1);
  hub.tick();
  assert.equal(hub.state.online, false);
  assert.equal(dash.last('rover').rover.online, false);
  assert.equal(rover.closed.code, 4001);
});

test('a reconnecting rover supersedes its old socket', () => {
  const { hub, rover } = setup();
  const fresh = fakeSocket();
  hub.registerRover(fresh, JSON.stringify({ type: 'device_register', deviceId: 'R1' }));
  assert.equal(rover.closed.code, 4000);
  hub.removeRover(rover); // the old socket closing must not take the new one offline
  assert.equal(hub.state.online, true);
});

test('session summary is emitted when a dashboard leaves', () => {
  const { hub, dash, sessions, advance } = setup();
  hub.handleDashboard(dash, JSON.stringify({ type: 'drive', command: 'forward' }));
  advance(2000);
  hub.handleDashboard(dash, JSON.stringify({ type: 'drive', command: 'stop' }));
  hub.removeDashboard(dash);
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].driveMs.forward, 2000);
  assert.equal(sessions[0].commands, 1);
});

test('an idle dashboard produces no session', () => {
  const { hub, dash, sessions } = setup();
  hub.removeDashboard(dash);
  assert.equal(sessions.length, 0);
});

test('a stale dashboard leaving does not stop a rover another dashboard is now driving', () => {
  const { hub, rover, dash } = setup();
  const other = fakeSocket();
  hub.addDashboard(other);
  hub.handleDashboard(dash, JSON.stringify({ type: 'nav_mode', mode: 'auto' }));
  hub.handleDashboard(other, JSON.stringify({ type: 'nav_mode', mode: 'auto' })); // the newer tab takes over
  const before = rover.sent.filter((m) => m.type === 'rover_command').length;
  hub.removeDashboard(dash); // the old tab finally closes
  assert.equal(rover.sent.filter((m) => m.type === 'rover_command').length, before, 'no stop for the old tab');
  hub.removeDashboard(other); // the tab that owns it leaves: now it stops
  assert.deepEqual(rover.last('rover_command'), { type: 'rover_command', command: 'stop' });
});

test('closing an idle second dashboard does not stop a rover being driven by the first', () => {
  const { hub, rover, dash } = setup();
  const idle = fakeSocket();
  hub.addDashboard(idle);
  hub.handleDashboard(dash, JSON.stringify({ type: 'drive', command: 'forward' }));
  hub.removeDashboard(idle);
  assert.equal(rover.sent.filter((m) => m.type === 'rover_command' && m.command === 'stop').length, 0);
});

test('a dashboard that took over driving owns the stop-on-leave', () => {
  const { hub, rover, dash } = setup();
  const other = fakeSocket();
  hub.addDashboard(other);
  hub.handleDashboard(dash, JSON.stringify({ type: 'drive', command: 'forward' }));
  hub.handleDashboard(other, JSON.stringify({ type: 'drive', command: 'left' }));
  hub.removeDashboard(dash);
  assert.equal(rover.sent.filter((m) => m.type === 'rover_command' && m.command === 'stop').length, 0);
  hub.removeDashboard(other);
  assert.deepEqual(rover.last('rover_command'), { type: 'rover_command', command: 'stop' });
});

// ---- the fire-sensor board ------------------------------------------------------------------------

function addFireNode(hub, id = 'AGRIROVER-FIRE-01', key = '') {
  const node = fakeSocket();
  const ok = hub.registerFireNode(node, JSON.stringify({ type: 'device_register', deviceId: id, key }));
  return { node, ok };
}
const fireFrame = (d, rssi = -55) => JSON.stringify({ type: 'fire_status', d, rssi });

test('the fire sensor board registers and its channels reach dashboards', () => {
  const { hub, dash } = setup();
  const { node, ok } = addFireNode(hub);
  assert.equal(ok, true);
  assert.equal(node.last('register_ack').deviceId, 'AGRIROVER-FIRE-01');
  assert.equal(dash.last('fire').fire.online, true);
  hub.handleFireNode(node, fireFrame([0, 0, 0, 0, 0]));
  hub.handleFireNode(node, fireFrame([0, 1, 0, 0, 1]));
  const fire = dash.last('fire').fire;
  assert.deepEqual(fire.channels, [false, true, false, false, true]);
  assert.equal(fire.count, 2);
});

test('the fire sensor board and the rover are independent devices', () => {
  const { hub, rover, dash } = setup();
  const { node } = addFireNode(hub);
  assert.equal(hub.state.online, true, 'the rover is still online');
  assert.equal(rover.closed, null, 'registering the board did not close the rover');
  hub.handleFireNode(node, fireFrame([1, 0, 0, 0, 0]));
  hub.removeRover(rover); // the driver board goes away...
  assert.equal(hub.fire.count, 1, '...the fire reading stays');
  assert.equal(hub.fire.online, true);
  hub.removeFireNode(node);
  assert.equal(hub.fire.online, false);
  assert.equal(dash.last('fire').fire.count, 0);
});

test('a new dashboard is told what the fire sensor board is seeing', () => {
  const { hub } = setup();
  const { node } = addFireNode(hub);
  hub.handleFireNode(node, fireFrame([0, 0, 1, 0, 0]));
  const late = fakeSocket();
  hub.addDashboard(late);
  assert.deepEqual(late.last('snapshot').fire.channels, [false, false, true, false, false]);
});

test('unchanged fire heartbeats keep the board alive without waking dashboards', () => {
  const { hub, dash } = setup();
  const { node } = addFireNode(hub);
  hub.handleFireNode(node, fireFrame([0, 0, 0, 0, 0]));
  const before = dash.sent.filter((m) => m.type === 'fire').length;
  hub.handleFireNode(node, fireFrame([0, 0, 0, 0, 0]));
  hub.handleFireNode(node, fireFrame([0, 0, 0, 0, 0]));
  assert.equal(dash.sent.filter((m) => m.type === 'fire').length, before);
});

test('a silent fire sensor board is marked offline, and its fire reading is cleared', () => {
  const lines = [];
  const { hub, dash, advance } = setup({ log: { info: () => {}, warn: (m) => lines.push(m) } });
  const { node } = addFireNode(hub);
  hub.handleFireNode(node, fireFrame([1, 1, 0, 0, 0]));
  advance(ROVER_TIMEOUT_MS + 500);
  hub.tick();
  assert.equal(hub.fire.online, false);
  assert.equal(hub.fire.count, 0, 'a dead board must not leave a stale alarm on screen');
  assert.equal(dash.last('fire').fire.online, false);
  assert.equal(node.closed.code, 4001);
  assert.match(lines.join('\n'), /fire sensor timed out/);
});

test('the fire sensor board needs the access key and a first register frame', () => {
  const { hub } = setup({ accessKey: 'secret' });
  assert.equal(addFireNode(hub, 'AGRIROVER-FIRE-01', 'wrong').ok, false);
  assert.equal(addFireNode(hub, 'AGRIROVER-FIRE-01', 'secret').ok, true);
  const rude = fakeSocket();
  assert.equal(hub.registerFireNode(rude, fireFrame([0, 0, 0, 0, 0])), false);
});

test('a reconnecting fire sensor board replaces its own lingering socket only', () => {
  const { hub, rover } = setup();
  const first = addFireNode(hub).node;
  const second = addFireNode(hub).node;
  assert.equal(first.closed.code, 4000);
  assert.equal(rover.closed, null);
  hub.removeFireNode(first); // the old socket finally closes: the new one must stay online
  assert.equal(hub.fire.online, true);
  hub.handleFireNode(second, fireFrame([0, 0, 0, 0, 1]));
  assert.equal(hub.fire.count, 1);
});

test('an extra motor board gets every drive and lamp command, but not pings', () => {
  const { hub, dash } = setup();
  const motor = fakeSocket();
  assert.equal(hub.registerMotorNode(motor, JSON.stringify({ type: 'device_register', deviceId: 'REAR-01', key: '' })), true);
  assert.equal(motor.last('register_ack').deviceId, 'REAR-01');
  hub.handleDashboard(dash, JSON.stringify({ type: 'drive', command: 'left' }));
  assert.deepEqual(motor.last('rover_command'), { type: 'rover_command', command: 'left' });
  hub.handleDashboard(dash, JSON.stringify({ type: 'light', light: 'front', level: 50 }));
  assert.equal(motor.last('rover_light_command').level, 50);
  hub.handleDashboard(dash, JSON.stringify({ type: 'ping', id: 1 }));
  assert.equal(motor.sent.some((m) => m.type === 'rover_ping'), false);
});

test('a dashboard that leaves mid-drive stops the extra motor board too', () => {
  const { hub, dash } = setup();
  const motor = fakeSocket();
  hub.registerMotorNode(motor, JSON.stringify({ type: 'device_register', deviceId: 'REAR-01', key: '' }));
  hub.handleDashboard(dash, JSON.stringify({ type: 'drive', command: 'forward' }));
  hub.removeDashboard(dash);
  assert.equal(motor.last('rover_command').command, 'stop');
});

test('a motor board with the wrong key is refused, a silent one is dropped, a reconnect supersedes', () => {
  const { hub, advance } = setup({ accessKey: 'secret' });
  const bad = fakeSocket();
  assert.equal(hub.registerMotorNode(bad, JSON.stringify({ type: 'device_register', deviceId: 'REAR-01', key: 'nope' })), false);
  const first = fakeSocket();
  const second = fakeSocket();
  hub.registerMotorNode(first, JSON.stringify({ type: 'device_register', deviceId: 'REAR-01', key: 'secret' }));
  hub.registerMotorNode(second, JSON.stringify({ type: 'device_register', deviceId: 'REAR-01', key: 'secret' }));
  assert.equal(first.closed.code, 4000);
  advance(ROVER_TIMEOUT_MS + 1);
  hub.tick();
  assert.equal(second.closed.code, 4001);
});

test('dashboards are told which extra motor boards are connected, and when one leaves', () => {
  const { hub, dash } = setup();
  assert.deepEqual(dash.last('snapshot').motors, []);
  const motor = fakeSocket();
  hub.registerMotorNode(motor, JSON.stringify({ type: 'device_register', deviceId: 'REAR-01', key: '' }));
  assert.deepEqual(dash.last('motors').boards, ['REAR-01']);
  hub.removeMotorNode(motor);
  assert.deepEqual(dash.last('motors').boards, []);
  hub.registerMotorNode(motor, JSON.stringify({ type: 'device_register', deviceId: 'REAR-01', key: '' }));
  const late = fakeSocket();
  hub.addDashboard(late);
  assert.deepEqual(late.last('snapshot').motors, ['REAR-01']);
});

test('a camera pan step goes to the motor board, even with the rover offline, and says so when there is no board', () => {
  const { hub, dash } = setup();
  hub.handleDashboard(dash, JSON.stringify({ type: 'camera_pan', direction: 'left' }));
  assert.equal(dash.last('error').error, 'camera_offline');
  const motor = fakeSocket();
  hub.registerMotorNode(motor, JSON.stringify({ type: 'device_register', deviceId: 'REAR-01', key: '' }));
  hub.handleDashboard(dash, JSON.stringify({ type: 'camera_pan', direction: 'right' }));
  assert.deepEqual(motor.last('camera_pan'), { type: 'camera_pan', direction: 'right' });
  hub.handleDashboard(dash, JSON.stringify({ type: 'camera_pan', direction: 'up' }));
  assert.equal(dash.last('error').error, 'unknown direction');
});

test('the motor board light reading reaches dashboards, only when it changes, and clears when the board leaves', () => {
  const { hub, dash } = setup();
  const motor = fakeSocket();
  hub.registerMotorNode(motor, JSON.stringify({ type: 'device_register', deviceId: 'REAR-01', key: '' }));
  const beat = (dark) => hub.handleMotorNode(motor, JSON.stringify({ type: 'motor_status', motion: 'stop', dark }));
  const frames = () => dash.sent.filter((m) => m.type === 'motors').length;
  beat(true);
  assert.equal(dash.last('motors').dark, true);
  const count = frames();
  beat(true);
  assert.equal(frames(), count);
  beat(false);
  assert.equal(dash.last('motors').dark, false);
  hub.removeMotorNode(motor);
  assert.equal(dash.last('motors').dark, null);
});

test('headlights on a motor board take lamp commands even with no rover, and report back to dashboards', () => {
  const hub = new Hub({ log: quiet });
  const dash = fakeSocket();
  const motor = fakeSocket();
  hub.addDashboard(dash);
  hub.registerMotorNode(motor, JSON.stringify({ type: 'device_register', deviceId: 'REAR-01', key: '' }));
  hub.handleDashboard(dash, JSON.stringify({ type: 'light_mode', mode: 'auto' }));
  assert.equal(dash.last('error').error, 'rover offline'); // a board that reports no headlights does not count
  hub.handleMotorNode(motor, JSON.stringify({ type: 'motor_status', motion: 'stop', dark: true, front: 100, rear: 100, auto: true }));
  assert.deepEqual(dash.last('motors').lights, { front: 100, rear: 100, auto: true });
  hub.handleDashboard(dash, JSON.stringify({ type: 'light', light: 'front', level: 40 }));
  assert.deepEqual(motor.last('rover_light_command'), { type: 'rover_light_command', light: 'front', level: 40 });
  hub.handleDashboard(dash, JSON.stringify({ type: 'light_mode', mode: 'auto' }));
  assert.equal(motor.last('rover_light_mode').mode, 'auto');
});

test('soil and rain from the motor board reach dashboards, only when they change, and clear when the board leaves', () => {
  const { hub, dash } = setup();
  const motor = fakeSocket();
  hub.registerMotorNode(motor, JSON.stringify({ type: 'device_register', deviceId: 'REAR-01', key: '' }));
  const beat = (soil, rain) => hub.handleMotorNode(motor, JSON.stringify({ type: 'motor_status', motion: 'stop', soil, rain }));
  const frames = () => dash.sent.filter((m) => m.type === 'motors').length;
  beat(42, 7);
  assert.deepEqual(dash.last('motors').sensors, { soil: 42, rain: 7 });
  const count = frames();
  beat(42, 7);
  assert.equal(frames(), count);
  beat(60, 500); // an impossible reading is dropped, the good one still arrives
  assert.deepEqual(dash.last('motors').sensors, { soil: 60, rain: null });
  const late = fakeSocket();
  hub.addDashboard(late);
  assert.deepEqual(late.last('snapshot').motorSensors, { soil: 60, rain: null });
  hub.removeMotorNode(motor);
  assert.equal(dash.last('motors').sensors, null);
});

test('the ultrasonic board reports four distances to dashboards, only on change, and clears when it leaves', () => {
  const { hub, dash } = setup();
  const board = fakeSocket();
  assert.equal(dash.last('snapshot').sonar.online, false);
  assert.equal(hub.registerSonarNode(board, JSON.stringify({ type: 'device_register', deviceId: 'SONAR-01', key: '' })), true);
  assert.equal(dash.last('sonar').sonar.online, true);
  const beat = (front) => hub.handleSonarNode(board, JSON.stringify({ type: 'sonar_status', front, left: 80, right: -1, back: 900, rssi: -50 }));
  const frames = () => dash.sent.filter((m) => m.type === 'sonar').length;
  beat(30);
  const { front, left, right, back } = dash.last('sonar').sonar;
  assert.deepEqual({ front, left, right, back }, { front: 30, left: 80, right: null, back: null });
  const count = frames();
  beat(30);
  assert.equal(frames(), count);
  beat(12);
  assert.equal(dash.last('sonar').sonar.front, 12);
  hub.removeSonarNode(board);
  assert.deepEqual([dash.last('sonar').sonar.online, dash.last('sonar').sonar.front], [false, null]);
});

test('tilt and heading from the third board reach dashboards, bad values are dropped, and leaving clears them', () => {
  const { hub, dash } = setup();
  const board = fakeSocket();
  hub.registerSonarNode(board, JSON.stringify({ type: 'device_register', deviceId: 'SONAR-01', key: '' }));
  const beat = (extra) => hub.handleSonarNode(board, JSON.stringify({ type: 'pose_status', imu: true, roll: 3.24, pitch: -7, yaw: 90, ...extra }));
  const frames = () => dash.sent.filter((m) => m.type === 'pose').length;
  beat({});
  assert.deepEqual(dash.last('pose').pose, { imu: true, roll: 3.2, pitch: -7, yaw: 90 });
  const count = frames();
  beat({});
  assert.equal(frames(), count);
  beat({ roll: 999 });
  assert.deepEqual(dash.last('pose').pose, { imu: false, roll: null, pitch: -7, yaw: 90 });
  hub.removeSonarNode(board);
  assert.deepEqual(dash.last('pose').pose, { imu: false, roll: null, pitch: null, yaw: null });
});
