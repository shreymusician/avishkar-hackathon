// Live camera: the rover's webcam is plugged into this laptop, and ffmpeg reads it (Windows DirectShow).
// The frames are served as MJPEG (multipart/x-mixed-replace), which every browser plays in a plain <img>,
// so a phone on the same network sees the same feed as the laptop.
//
// One ffmpeg process per camera is shared by every viewer. It starts with the first viewer and stops a few
// seconds after the last one leaves, which also frees the camera (and its light) for other programs.

import { spawn } from 'node:child_process';

/** Names of the video devices in `ffmpeg -list_devices true -f dshow -i dummy` output. */
export function parseDevices(text) {
  const names = [];
  for (const line of String(text).split(/\r?\n/)) {
    const m = line.match(/"([^"]+)"\s+\(video\)/);
    if (m && !names.includes(m[1])) names.push(m[1]);
  }
  return names;
}

const VIRTUAL = /virtual|obs|broadcast|snap camera|droidcam|iriun|manycam|xsplit/i;
const BUILT_IN = /integrated|built-?in|hp (wide )?vision|facetime|front camera/i;

/** The camera to show when nobody chose: CAMERA_NAME if set, else a real USB camera over virtual and built-in ones. */
export function pickDefault(names, wanted = '') {
  if (wanted && names.includes(wanted)) return wanted;
  const real = names.filter((n) => !VIRTUAL.test(n));
  return real.find((n) => !BUILT_IN.test(n)) ?? real[0] ?? names[0] ?? null;
}

/**
 * Splits ffmpeg's concatenated JPEG output into whole frames. JPEG data never contains FF D9 except at the end
 * (a data byte FF is always followed by 00), so the markers are a safe boundary.
 */
export function createFrameSplitter(onFrame) {
  const SOI = Buffer.from([0xff, 0xd8]);
  const EOI = Buffer.from([0xff, 0xd9]);
  let buf = Buffer.alloc(0);
  return (chunk) => {
    buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
    for (;;) {
      const start = buf.indexOf(SOI);
      if (start < 0) {
        // Keep a trailing FF: it may be the first half of the next frame's start marker.
        buf = buf.length && buf[buf.length - 1] === 0xff ? buf.subarray(buf.length - 1) : Buffer.alloc(0);
        return;
      }
      const end = buf.indexOf(EOI, start + 2);
      if (end < 0) {
        buf = Buffer.from(buf.subarray(start)); // own copy: the caller's chunk may be reused
        if (buf.length > 8 * 1024 * 1024) buf = Buffer.alloc(0); // a runaway stream must not grow without bound
        return;
      }
      onFrame(buf.subarray(start, end + 2));
      buf = buf.subarray(end + 2);
    }
  };
}

/**
 * @param {{ffmpeg?: string, size?: string, fps?: number, quality?: number, idleMs?: number,
 *          spawnImpl?: typeof spawn, log?: {info: Function, warn: Function}}} [options]
 */
export function createCamera({
  ffmpeg = 'ffmpeg',
  size = '640x480',
  fps = 15,
  quality = 6,
  idleMs = 8000,
  spawnImpl = spawn,
  log = console,
} = {}) {
  /** @type {Map<string, {proc: any, subs: Set<Function>, last: Buffer|null, frames: number, idle: any, retry: any, error: string, usedSize: boolean, startedAt: number}>} */
  const feeds = new Map();
  let listCache = { at: 0, value: null };

  function run(args, timeoutMs = 6000) {
    return new Promise((resolve) => {
      let out = '';
      let child;
      try {
        child = spawnImpl(ffmpeg, args, { windowsHide: true });
      } catch (err) {
        return resolve({ missing: true, out: String(err.message) });
      }
      const timer = setTimeout(() => child.kill(), timeoutMs);
      child.stderr?.on('data', (d) => (out += d));
      child.stdout?.on('data', (d) => (out += d));
      child.on('error', (err) => {
        clearTimeout(timer);
        resolve({ missing: err.code === 'ENOENT', out: String(err.message) });
      });
      child.on('close', () => {
        clearTimeout(timer);
        resolve({ missing: false, out });
      });
    });
  }

  /** {available, devices}: available is false when ffmpeg itself cannot be run. Cached for a few seconds. */
  async function devices() {
    if (listCache.value && Date.now() - listCache.at < 4000) return listCache.value;
    const { missing, out } = await run(['-hide_banner', '-list_devices', 'true', '-f', 'dshow', '-i', 'dummy']);
    const value = missing ? { available: false, devices: [] } : { available: true, devices: parseDevices(out) };
    listCache = { at: Date.now(), value };
    return value;
  }

  function start(name, feed, withSize) {
    const args = ['-hide_banner', '-loglevel', 'error', '-f', 'dshow', '-rtbufsize', '64M'];
    if (withSize) args.push('-video_size', size, '-framerate', String(fps));
    args.push('-i', `video=${name}`, '-an', '-f', 'image2pipe', '-vcodec', 'mjpeg', '-q:v', String(quality), '-');
    feed.usedSize = withSize;
    feed.startedAt = Date.now();
    let proc;
    try {
      proc = spawnImpl(ffmpeg, args, { windowsHide: true });
    } catch (err) {
      feed.error = err.message;
      return;
    }
    feed.proc = proc;
    let stderr = '';
    proc.stdout.on(
      'data',
      createFrameSplitter((frame) => {
        feed.last = Buffer.from(frame); // copy: the splitter's buffer is reused
        feed.frames += 1;
        feed.error = '';
        for (const cb of feed.subs) cb(feed.last);
      }),
    );
    proc.stderr.on('data', (d) => (stderr = (stderr + d).slice(-600)));
    proc.on('error', (err) => {
      feed.error = err.code === 'ENOENT' ? 'no_ffmpeg' : err.message;
    });
    proc.on('close', () => {
      if (feed.proc !== proc) return;
      feed.proc = null;
      if (feed.subs.size === 0) return;
      // Died while someone is watching: if it never produced a frame, the camera may not accept the size, so try
      // without it once; otherwise retry in a moment (the camera was unplugged, or another program took it).
      const neverWorked = feed.frames === 0;
      if (neverWorked && withSize) return start(name, feed, false);
      feed.error = stderr.trim().split(/\r?\n/).pop() || 'camera stopped';
      log.warn(`[camera] ${name}: ${feed.error}`);
      feed.retry = setTimeout(() => feed.subs.size && start(name, feed, feed.usedSize), 2500);
    });
    log.info(`[camera] started "${name}"${withSize ? ` at ${size} ${fps} fps` : ''}`);
  }

  function stop(name) {
    const feed = feeds.get(name);
    if (!feed) return;
    clearTimeout(feed.idle);
    clearTimeout(feed.retry);
    feeds.delete(name);
    const proc = feed.proc;
    feed.proc = null;
    if (proc) proc.kill();
    log.info(`[camera] stopped "${name}" (nobody watching)`);
  }

  /** Calls onFrame(jpegBuffer) for every frame of the named camera. Returns the function that stops listening. */
  function subscribe(name, onFrame) {
    let feed = feeds.get(name);
    if (!feed) {
      feed = { proc: null, subs: new Set(), last: null, frames: 0, idle: null, retry: null, error: '', usedSize: true, startedAt: 0 };
      feeds.set(name, feed);
    }
    clearTimeout(feed.idle);
    feed.subs.add(onFrame);
    if (!feed.proc && !feed.retry) start(name, feed, true);
    if (feed.last) onFrame(feed.last);
    return () => {
      feed.subs.delete(onFrame);
      if (feed.subs.size === 0) {
        feed.idle = setTimeout(() => stop(name), idleMs);
        feed.idle.unref?.();
      }
    };
  }

  /** The most recent frame, or a fresh one: resolves null if the camera gives nothing within the timeout. */
  function snapshot(name, timeoutMs = 7000) {
    return new Promise((resolve) => {
      let done = false;
      let off = () => {};
      const finish = (frame) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        off();
        resolve(frame);
      };
      const timer = setTimeout(() => finish(null), timeoutMs);
      off = subscribe(name, finish);
      if (done) off();
    });
  }

  function status() {
    return [...feeds.entries()].map(([name, f]) => ({ name, running: Boolean(f.proc), viewers: f.subs.size, frames: f.frames, error: f.error }));
  }

  function shutdown() {
    for (const name of [...feeds.keys()]) stop(name);
  }

  return { devices, subscribe, snapshot, status, shutdown };
}
