// A stand-in rover for developing without hardware. It speaks exactly what the
// ESP32 firmware speaks, so the whole path (browser, server, rover) is the real one.
// Terminal: `d` + Enter flips the fake light sensor, `f` + Enter trips the fake fire sensor. Auto navigation plays a
// believable loop of drive, scan, turn with random distances.
import WebSocket from 'ws';

const port = process.env.PORT || 5000;
const key = process.env.ACCESS_KEY || '';
const url = process.env.ROVER_URL || `ws://localhost:${port}/ws?role=rover`;

const COMMAND_TIMEOUT_MS = 500; // same failsafe as the firmware
let motion = 'stop';
let front = 0;
let rear = 0;
let auto = true;
let dark = false;
let lastCommand = 0;
let timer;

// Navigation: manual, or auto stepping through forward -> scanning -> (turning | reversing).
let nav = 'manual';
let navState = 'idle';
let navSince = 0;
let scan = { c: 150 };
// Field sensors: soil and rain drift slowly; type `f` + Enter to trip two of the five fire channels.
let soil = 42;
let rain = 3;
let fire = 0;
// The real rover's buzzer (GPIO 4) is a scaffold for now, so the simulator reports none unless SIM_BUZZER=1.
const BUZZER_FITTED = process.env.SIM_BUZZER === '1';
let muted = false;
let hornOn = false;
const STEP_MS = { forward: 3000, scanning: 1800, turning: 500, reversing: 400 };
const rand = (lo, hi) => Math.round(lo + Math.random() * (hi - lo));

// Same rule as the firmware: auto follows the sensor, a manual lamp command ends auto.
function applyAuto() {
  if (auto) front = rear = dark ? 100 : 0;
}

function enterNav(state, turnAround = false) {
  navState = state;
  navSince = Date.now();
  if (state === 'forward') {
    motion = 'forward';
    scan = { c: rand(120, 200) };
  } else if (state === 'scanning') {
    motion = 'stop';
    scan = { l: rand(15, 150), c: rand(10, 35), r: rand(15, 150) };
  } else if (state === 'turning') {
    if (!turnAround && Math.max(scan.l, scan.r) < 45) return enterNav('reversing');
    motion = turnAround ? 'right' : scan.l >= scan.r ? 'left' : 'right';
  } else if (state === 'reversing') {
    motion = 'backward';
  } else {
    motion = 'stop';
  }
}

function startNav() {
  nav = 'auto';
  console.log('[sim] auto navigation on');
  enterNav('forward');
}

function stopNav() {
  if (nav === 'manual') return;
  nav = 'manual';
  scan = { c: 150 };
  console.log('[sim] auto navigation off');
  enterNav('idle');
}

function stepNav() {
  if (nav !== 'auto' || Date.now() - navSince < STEP_MS[navState]) return false;
  if (navState === 'forward') enterNav('scanning');
  else if (navState === 'scanning') enterNav(Math.max(scan.l, scan.r) >= 45 ? 'turning' : 'reversing');
  else if (navState === 'reversing') enterNav('turning', true); // back off, then turn around
  else enterNav('forward');
  return true;
}

process.stdin.on('data', (chunk) => {
  const cmd = chunk.toString().trim();
  if (cmd === 'f') {
    fire = fire ? 0 : 2;
    console.log(`[sim] fire channels: ${fire}`);
    return;
  }
  if (cmd !== 'd') return;
  dark = !dark;
  console.log(`[sim] sensor: ${dark ? 'dark' : 'bright'}`);
  applyAuto();
});

function connect() {
  const ws = new WebSocket(url);
  const status = () =>
    ws.readyState === WebSocket.OPEN &&
    ws.send(
      JSON.stringify({ type: 'status', motion, front, rear, auto, dark, nav, navState, sonar: true, scan, sensors: { soil: Math.round(soil), rain: Math.round(rain), fire }, buzzer: { fitted: BUZZER_FITTED, muted }, rssi: -52 }),
    );

  ws.on('open', () => {
    console.log('[sim] connected');
    ws.send(JSON.stringify({ type: 'device_register', deviceId: 'AGRIROVER-SIM', key }));
    clearInterval(timer);
    timer = setInterval(() => {
      if (nav === 'manual' && motion !== 'stop' && Date.now() - lastCommand > COMMAND_TIMEOUT_MS) {
        motion = 'stop';
        console.log('[sim] failsafe stop');
      }
      stepNav();
      soil = Math.min(100, Math.max(5, soil + (Math.random() - 0.5) * 2));
      rain = Math.min(100, Math.max(0, rain + (Math.random() - 0.5) * 1.5));
      status();
    }, 250);
  });

  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.type === 'rover_command') {
      lastCommand = Date.now();
      if (nav === 'auto') {
        if (msg.command === 'stop') stopNav(); // only a stop gets through, and it ends auto
      } else {
        if (msg.command !== motion) console.log(`[sim] ${msg.command}`);
        motion = msg.command;
      }
      status();
    } else if (msg.type === 'rover_ping') {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'pong', id: msg.id }));
    } else if (msg.type === 'rover_horn') {
      if (msg.on !== hornOn) console.log(`[sim] horn ${msg.on ? 'ON' : 'off'}`);
      hornOn = msg.on;
    } else if (msg.type === 'rover_alarm_mute') {
      muted = msg.mute;
      console.log(`[sim] alarms ${muted ? 'muted' : 'on'}`);
      status();
    } else if (msg.type === 'rover_nav_mode') {
      if (msg.mode === 'auto') startNav();
      else stopNav();
      status();
    } else if (msg.type === 'rover_light_command') {
      auto = false;
      if (msg.light === 'front') front = msg.level;
      else rear = msg.level;
      console.log(`[sim] ${msg.light} lamp ${msg.level}%`);
      status();
    } else if (msg.type === 'rover_light_mode') {
      auto = msg.mode === 'auto';
      applyAuto();
      console.log(`[sim] lights ${msg.mode}`);
      status();
    } else if (msg.type === 'error') {
      console.log(`[sim] server error: ${msg.error}`);
    }
  });

  ws.on('close', () => {
    clearInterval(timer);
    motion = 'stop';
    stopNav();
    console.log('[sim] disconnected, retrying in 2s');
    setTimeout(connect, 2000);
  });
  ws.on('error', () => {});
}

connect();
