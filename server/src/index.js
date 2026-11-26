import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { getConnInfo } from '@hono/node-server/conninfo';
import { createNodeWebSocket } from '@hono/node-ws';
import { Hub, keyMatches } from './hub.js';
import { connectStore } from './db.js';
import { createRateLimiter } from './rateLimit.js';
import { createEnvironment, parsePhonePosition } from './environment.js';
import { createSupport } from './support.js';
import { createCamera, pickDefault } from './camera.js';
import { createAuth, SESSION_COOKIE } from './auth.js';
import { createFileUsers } from './users.js';

const port = Number(process.env.PORT) || 5000;
const accessKey = process.env.ACCESS_KEY || '';

/** @type {Awaited<ReturnType<typeof connectStore>>} */
let store = null;
// False until the first attempt to reach MongoDB has finished, so an account is never saved to the wrong place.
let storeSettled = !process.env.MONGODB_URI;

// Signing in is on unless AUTH_REQUIRED=0. Only people use it: the rover and the flame board keep their own key.
const authRequired = process.env.AUTH_REQUIRED !== '0';
// The Demo login button signs anyone who presses it in to a shared demo account. DEMO_LOGIN=0 removes it.
const demoEnabled = process.env.DEMO_LOGIN !== '0';
const dataDir = new URL('../data/', import.meta.url);
const fileUsers = createFileUsers(fileURLToPath(new URL('users.json', dataDir)));

/** Key that signs session cookies: AUTH_SECRET, else one generated once and kept in server/data. */
function loadSecret() {
  if (process.env.AUTH_SECRET) return process.env.AUTH_SECRET;
  const file = new URL('auth-secret', dataDir);
  try {
    return readFileSync(file, 'utf8').trim();
  } catch {
    const fresh = randomBytes(32).toString('hex');
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(file, fresh, { mode: 0o600 });
    return fresh;
  }
}

const auth = createAuth({
  secret: loadSecret(),
  async getUsers() {
    if (!storeSettled) throw new Error('starting');
    return store?.users ?? fileUsers;
  },
});

const environment = createEnvironment();

// Every line the server prints starts with the time, so the terminal reads as a timeline.
const hhmmss = () => new Date().toTimeString().slice(0, 8);
const log = {
  info: (m) => console.log(`${hhmmss()} ${m}`),
  warn: (m) => console.warn(`${hhmmss()} ${m}`),
};

// Mandi prices need a free data.gov.in key (DATA_GOV_API_KEY); news needs none.
const support = createSupport({ apiKey: (process.env.DATA_GOV_API_KEY ?? '').trim(), log });
if (!process.env.DATA_GOV_API_KEY) log.info('[support] DATA_GOV_API_KEY not set: the Mandi prices page will explain how to get a free key');

// The rover's webcam is plugged into this laptop: ffmpeg reads it and the dashboard plays it as MJPEG.
// CAMERA_NAME picks a camera by its exact Windows name (see /api/camera/devices); FFMPEG_PATH points at ffmpeg.exe
// when it is not on PATH. CAMERA_SIZE (default 640x480) and CAMERA_FPS (default 15) trade sharpness for bandwidth.
const camera = createCamera({
  ffmpeg: process.env.FFMPEG_PATH || 'ffmpeg',
  size: process.env.CAMERA_SIZE || '640x480',
  fps: Number(process.env.CAMERA_FPS) || 15,
  log,
});

const hub = new Hub({
  accessKey,
  log,
  onSessionEnd: (summary) => {
    // Fire and forget: the database must never sit on the drive path.
    store?.saveSession(summary).catch((err) => console.warn(`[db] save failed: ${err.name}`));
  },
});

const app = new Hono();
const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

if (!accessKey) console.warn('[server] ACCESS_KEY not set: anyone who can reach this port can drive the rover');

// ---- realtime ---------------------------------------------------------------

const refusedAt = new Map();

app.get(
  '/ws',
  upgradeWebSocket(async (c) => {
    const asked = c.req.query('role');
    const role = asked === 'rover' || asked === 'sensor' || asked === 'motor' || asked === 'sonar' ? asked : 'dashboard';
    const key = c.req.query('key');
    const from = getConnInfo(c).remote.address ?? 'unknown';
    let registered = false;

    // Only people need an account; the rover and the flame board present the access key instead.
    let signedIn = true;
    if (role === 'dashboard' && authRequired) {
      signedIn = await auth.userFor(getCookie(c, SESSION_COOKIE)).then(Boolean, () => false);
    }

    return {
      onOpen(_evt, ws) {
        // A rover that never shows up here is not reaching the server at all: check WiFi, the laptop's
        // address in secrets.h, the firewall, and router client isolation.
        if (!signedIn) {
          // A page left open from before accounts existed retries every second: say so once a minute, not every time.
          const t = Date.now();
          if (t - (refusedAt.get(from) ?? 0) > 60_000) {
            refusedAt.set(from, t);
            log.warn(`[ws] a dashboard at ${from} is not signed in, so it is refused. An old page left open does this every second: reload it.`);
          }
          return ws.close(4403, 'sign in required');
        }
        log.info(`[ws] ${role} connected from ${from}`);
        if (role === 'dashboard') {
          if (!keyMatches(accessKey, key)) return ws.close(4401, 'key required');
          hub.addDashboard(ws);
        }
      },
      onMessage(evt, ws) {
        try {
          const raw = typeof evt.data === 'string' ? evt.data : null;
          if (role === 'dashboard') return hub.handleDashboard(ws, raw);
          if (role === 'sensor') {
            if (!registered) registered = hub.registerFireNode(ws, raw);
            else hub.handleFireNode(ws, raw);
            return;
          }
          if (role === 'sonar') {
            if (!registered) registered = hub.registerSonarNode(ws, raw);
            else hub.handleSonarNode(ws, raw);
            return;
          }
          if (role === 'motor') {
            if (!registered) registered = hub.registerMotorNode(ws, raw);
            else hub.handleMotorNode(ws, raw);
            return;
          }
          if (!registered) registered = hub.registerRover(ws, raw);
          else hub.handleRover(ws, raw);
        } catch (err) {
          // One bad frame costs one rejection, never the process.
          console.warn(`[ws] handler error: ${err.message}`);
        }
      },
      onClose(_evt, ws) {
        if (!signedIn) return;
        log.info(`[ws] ${role} disconnected (${from})`);
        if (role === 'dashboard') hub.removeDashboard(ws);
        else if (role === 'sensor') hub.removeFireNode(ws);
        else if (role === 'motor') hub.removeMotorNode(ws);
        else if (role === 'sonar') hub.removeSonarNode(ws);
        else hub.removeRover(ws);
      },
    };
  }),
);

setInterval(() => hub.tick(), 1000).unref();

// ---- history API ------------------------------------------------------------

const api = new Hono();
const allow = createRateLimiter({ limit: 60, windowMs: 60_000 });

api.use('*', async (c, next) => {
  const ip = getConnInfo(c).remote.address ?? 'unknown';
  if (!allow(ip)) return c.json({ error: 'slow down' }, 429);
  await next();
});

api.get('/health', (c) => c.json({ ok: true, authRequired: Boolean(accessKey), loginRequired: authRequired, demoLogin: authRequired && demoEnabled, history: Boolean(store) }));

// ---- accounts ---------------------------------------------------------------

const allowLogin = createRateLimiter({ limit: 8, windowMs: 10 * 60_000 });
const allowSignup = createRateLimiter({ limit: 20, windowMs: 60 * 60_000 });

function startSession(c, result) {
  setCookie(c, SESSION_COOKIE, result.token, {
    httpOnly: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: result.maxAgeSeconds,
    secure: new URL(c.req.url).protocol === 'https:',
  });
}

/** Runs an auth step; the store still starting up is a 503, not a crash. */
async function guarded(c, step) {
  try {
    return await step();
  } catch (err) {
    if (err.message === 'starting') return c.json({ error: 'starting' }, 503);
    console.warn(`[auth] ${err.message}`);
    // Atlas timeouts and dropped connections are the database being out of reach, not a bug: say so.
    const unreachable = /ETIMEDOUT|ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|timed out|Server selection|topology|MongoNetwork|MongoServerSelection/i.test(
      `${err.name} ${err.message}`,
    );
    return c.json({ error: unreachable ? 'database' : 'server' }, unreachable ? 503 : 500);
  }
}

api.post('/auth/signup', (c) =>
  guarded(c, async () => {
    // Behind the dev proxy every caller shares one address, so this only blunts bulk signups.
    if (!allowSignup(getConnInfo(c).remote.address ?? 'unknown')) return c.json({ error: 'slow down' }, 429);
    const body = await c.req.json().catch(() => null);
    const result = await auth.signup(body);
    if (!result.ok) return c.json({ error: result.error, fields: result.fields }, result.status);
    startSession(c, result);
    log.info(`[auth] new account: ${result.user.name} (${result.user.role})`);
    return c.json({ user: result.user }, 201);
  }),
);

api.post('/auth/login', (c) =>
  guarded(c, async () => {
    const body = await c.req.json().catch(() => null);
    // Counted per phone number, so guessing one account's password is capped wherever the guesses come from.
    if (!allowLogin(String(body?.phone ?? '').replace(/\D/g, '').slice(-10))) return c.json({ error: 'slow down' }, 429);
    const result = await auth.login(body);
    if (!result.ok) return c.json({ error: result.error }, result.status);
    startSession(c, result);
    return c.json({ user: result.user });
  }),
);

api.post('/auth/demo', (c) =>
  guarded(c, async () => {
    if (!authRequired || !demoEnabled) return c.json({ error: 'demo_off' }, 404);
    const result = await auth.demo();
    startSession(c, result);
    log.info('[auth] demo login');
    return c.json({ user: result.user });
  }),
);

const allowPassword = createRateLimiter({ limit: 8, windowMs: 10 * 60_000 });

api.post('/auth/password', (c) =>
  guarded(c, async () => {
    const user = await auth.userFor(getCookie(c, SESSION_COOKIE));
    if (!user) return c.json({ error: 'signed_out' }, 401);
    // Counted per account: someone holding a stolen session still cannot guess the current password quickly.
    if (!allowPassword(user.id)) return c.json({ error: 'slow down' }, 429);
    const body = await c.req.json().catch(() => null);
    const result = await auth.changePassword(user.id, body);
    if (!result.ok) return c.json({ error: result.error, fields: result.fields }, result.status);
    startSession(c, result);
    log.info(`[auth] password changed: ${user.name}`);
    return c.json({ user: result.user });
  }),
);

api.post('/auth/logout', (c) => {
  deleteCookie(c, SESSION_COOKIE, { path: '/' });
  return c.json({ ok: true });
});

api.get('/auth/me', (c) =>
  guarded(c, async () => {
    const user = await auth.userFor(getCookie(c, SESSION_COOKIE));
    return user ? c.json({ user }) : c.json({ error: 'signed_out' }, 401);
  }),
);

// Lets the signup form suggest the farm's village, district and state from the network's location.
api.get('/auth/place', async (c) => {
  try {
    return c.json(await environment.placeByAddress(getConnInfo(c).remote.address));
  } catch (err) {
    console.warn(`[auth] place lookup: ${err.message}`);
    return c.json({ error: 'upstream' }, 502);
  }
});

// Everything below is for signed-in people only.
api.use('*', async (c, next) => {
  if (!authRequired) return next();
  const user = await auth.userFor(getCookie(c, SESSION_COOKIE)).catch(() => null);
  if (!user) return c.json({ error: 'signed_out' }, 401);
  await next();
});

api.use('*', async (c, next) => {
  // An <img> cannot send headers, so the camera stream may carry the access key in its address instead.
  const given = c.req.header('x-access-key') ?? (c.req.path.startsWith('/api/camera/') ? c.req.query('key') : undefined);
  if (!keyMatches(accessKey, given)) return c.json({ error: 'unauthorized' }, 401);
  await next();
});

api.get('/history', async (c) => {
  if (!store) return c.json({ available: false, sessions: [], totals: null });
  try {
    const [sessions, totals] = await Promise.all([store.recentSessions(20), store.totals()]);
    return c.json({ available: true, sessions, totals });
  } catch (err) {
    console.warn(`[db] read failed: ${err.name}`);
    return c.json({ available: false, sessions: [], totals: null });
  }
});

// Conditions for the field. The position comes from the phone or laptop looking at the dashboard, which reports its
// own location automatically (the farmer watches from near the land), and otherwise from the network address (city
// level, often a wrong city) of whoever is asking. Weather, soil and air data are fetched and cached here, so browsers
// never call third parties. The phone's position travels in a header, not the URL, so it stays out of access logs.
api.get('/environment', async (c) => {
  const phone = parsePhonePosition(c.req.header('x-phone-position'));
  try {
    const position = phone ?? (await environment.locateByAddress(getConnInfo(c).remote.address));
    const data = await environment.forPosition(position);
    return c.json({ source: phone ? 'phone' : 'network', position, data, updatedAt: new Date().toISOString() });
  } catch (err) {
    console.warn(`[environment] ${err.message}`);
    return c.json({ error: 'upstream' }, 502);
  }
});

// Farmer support. Mandi prices come for a whole state (the page picks the district and crop), news in the person's language.
api.get('/support/mandi', async (c) => {
  const state = (c.req.query('state') ?? '').trim();
  if (!/^[\p{L} &.'-]{2,40}$/u.test(state)) return c.json({ error: 'bad_state' }, 400);
  try {
    return c.json({ state, ...(await support.mandi(state)), updatedAt: new Date().toISOString() });
  } catch (err) {
    console.warn(`[support] mandi: ${err.message}`);
    return c.json({ error: 'upstream' }, 502);
  }
});

api.get('/support/news', async (c) => {
  try {
    return c.json({ ...(await support.news(c.req.query('lang') ?? 'en')), updatedAt: new Date().toISOString() });
  } catch (err) {
    console.warn(`[support] news: ${err.message}`);
    return c.json({ error: 'upstream' }, 502);
  }
});

// ---- live camera --------------------------------------------------------------

/** The camera asked for (?name=), checked against the real device list so nothing else reaches ffmpeg. */
async function chooseCamera(c) {
  const { available, devices } = await camera.devices();
  if (!available) return { error: 'no_ffmpeg' };
  if (devices.length === 0) return { error: 'no_camera' };
  const asked = c.req.query('name');
  if (asked) return devices.includes(asked) ? { name: asked } : { error: 'no_camera' };
  return { name: pickDefault(devices, process.env.CAMERA_NAME ?? '') };
}

api.get('/camera/devices', async (c) => {
  const { available, devices } = await camera.devices();
  return c.json({ available, devices, default: pickDefault(devices, process.env.CAMERA_NAME ?? ''), feeds: camera.status() });
});

api.get('/camera/snapshot', async (c) => {
  const chosen = await chooseCamera(c);
  if (chosen.error) return c.json({ error: chosen.error }, 503);
  const frame = await camera.snapshot(chosen.name);
  if (!frame) return c.json({ error: 'no_frame' }, 503);
  return new Response(frame, { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store' } });
});

api.get('/camera/stream', async (c) => {
  const chosen = await chooseCamera(c);
  if (chosen.error) return c.json({ error: chosen.error }, 503);
  const encoder = new TextEncoder();
  let off = () => {};
  const stream = new ReadableStream({
    start(controller) {
      off = camera.subscribe(chosen.name, (frame) => {
        // A viewer that cannot keep up skips frames instead of building a backlog.
        if ((controller.desiredSize ?? 1) <= 0) return;
        try {
          controller.enqueue(encoder.encode(`--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${frame.length}\r\n\r\n`));
          controller.enqueue(frame);
          controller.enqueue(encoder.encode('\r\n'));
        } catch {
          off();
        }
      });
      c.req.raw.signal?.addEventListener('abort', () => off());
    },
    cancel() {
      off();
    },
  });
  return new Response(stream, {
    headers: { 'Content-Type': 'multipart/x-mixed-replace; boundary=frame', 'Cache-Control': 'no-store, no-cache', Connection: 'keep-alive' },
  });
});

app.route('/api', api);

// ---- built dashboard --------------------------------------------------------

if (existsSync('../web/dist')) {
  app.use('*', serveStatic({ root: '../web/dist' }));
  app.get('*', serveStatic({ path: '../web/dist/index.html' }));
}

// ---- start ------------------------------------------------------------------

const server = serve({ fetch: app.fetch, port }, (info) => console.log(`[server] http://localhost:${info.port}  ws path /ws`));
injectWebSocket(server);

connectStore({ uri: process.env.MONGODB_URI || '', dbName: process.env.MONGODB_DB || 'agrirover' }).then((s) => {
  store = s;
  storeSettled = true;
  log.info(`[auth] accounts are kept ${store ? 'in MongoDB' : 'in server/data/users.json'}`);
});

process.on('SIGINT', async () => {
  camera.shutdown();
  await store?.close();
  process.exit(0);
});
