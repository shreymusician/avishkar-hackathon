// A stand-in for the fire-sensor ESP32, for developing without hardware. It speaks exactly what
// firmware/fire_sensor/fire_sensor.ino speaks (role "sensor"), so the path board -> server -> dashboard is the real one.
// Terminal: type 1 to 5 + Enter to hold a "flame" in front of that channel, 0 + Enter to clear them all.
import WebSocket from 'ws';

const port = process.env.PORT || 5000;
const key = process.env.ACCESS_KEY || '';
const url = process.env.SENSOR_URL || `ws://localhost:${port}/ws?role=sensor`;

const channels = [0, 0, 0, 0, 0];
let timer;

process.stdin.on('data', (chunk) => {
  const cmd = chunk.toString().trim();
  if (cmd === '0') channels.fill(0);
  else if (/^[1-5]$/.test(cmd)) channels[Number(cmd) - 1] ^= 1;
  else return;
  console.log(`[sim-fire] D1..D5 = ${channels.join(' ')}`);
  push?.();
});

let push = null;

function connect() {
  const ws = new WebSocket(url);
  const status = () => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ type: 'fire_status', d: channels, rssi: -57 }));
  push = status;

  ws.on('open', () => {
    console.log('[sim-fire] connected');
    ws.send(JSON.stringify({ type: 'device_register', deviceId: 'AGRIROVER-FIRE-SIM', key }));
    clearInterval(timer);
    timer = setInterval(status, 2000); // the same 2 s heartbeat as the firmware
    setTimeout(status, 300);
  });
  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.type === 'error') console.log(`[sim-fire] server error: ${msg.error}`);
  });
  ws.on('close', () => {
    clearInterval(timer);
    console.log('[sim-fire] disconnected, retrying in 2s');
    setTimeout(connect, 2000);
  });
  ws.on('error', () => {});
}

connect();
