import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createCamera, createFrameSplitter, parseDevices, pickDefault } from '../src/camera.js';

const quiet = { info() {}, warn() {} };
const jpeg = (n) => Buffer.from([0xff, 0xd8, n, n, n, 0xff, 0xd9]);

test('parseDevices lists the video devices only, once each', () => {
  const text = [
    '[in#0 @ 000001] "HP Wide Vision HD Camera" (video)',
    '[in#0 @ 000001]   Alternative name "@device_pnp_\\\\?\\usb#vid_0408"',
    '[in#0 @ 000001] "USB 2.0 Webcam" (video)',
    '[in#0 @ 000001] "Microphone Array" (audio)',
    '[in#0 @ 000001] "USB 2.0 Webcam" (video)',
  ].join('\r\n');
  assert.deepEqual(parseDevices(text), ['HP Wide Vision HD Camera', 'USB 2.0 Webcam']);
});

test('pickDefault prefers a real USB camera over virtual and built-in ones, and honours CAMERA_NAME', () => {
  const names = ['OBS Virtual Camera', 'HP Wide Vision HD Camera', 'USB 2.0 Webcam'];
  assert.equal(pickDefault(names), 'USB 2.0 Webcam');
  assert.equal(pickDefault(names, 'HP Wide Vision HD Camera'), 'HP Wide Vision HD Camera');
  assert.equal(pickDefault(['OBS Virtual Camera', 'HP Wide Vision HD Camera']), 'HP Wide Vision HD Camera');
  assert.equal(pickDefault(['OBS Virtual Camera']), 'OBS Virtual Camera');
  assert.equal(pickDefault([]), null);
});

test('the frame splitter finds whole frames however the bytes are chunked', () => {
  const frames = [];
  const feed = createFrameSplitter((f) => frames.push(Buffer.from(f)));
  const all = Buffer.concat([Buffer.from([1, 2]), jpeg(7), jpeg(8), jpeg(9)]);
  for (let i = 0; i < all.length; i += 3) feed(all.subarray(i, i + 3));
  assert.deepEqual(frames, [jpeg(7), jpeg(8), jpeg(9)]);
});

function fakeProcess() {
  const proc = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.killed = false;
  proc.kill = () => {
    proc.killed = true;
    proc.emit('close', 0);
  };
  return proc;
}

test('one ffmpeg process is shared, frames reach every viewer, and it stops after the last one leaves', async () => {
  const spawned = [];
  const camera = createCamera({
    idleMs: 20,
    log: quiet,
    spawnImpl: () => {
      const p = fakeProcess();
      spawned.push(p);
      return p;
    },
  });
  const a = [];
  const b = [];
  const offA = camera.subscribe('Cam', (f) => a.push(f));
  const offB = camera.subscribe('Cam', (f) => b.push(f));
  assert.equal(spawned.length, 1);
  spawned[0].stdout.emit('data', jpeg(5));
  assert.equal(a.length, 1);
  assert.equal(b.length, 1);
  const late = [];
  camera.subscribe('Cam', (f) => late.push(f)); // a late viewer gets the latest frame at once
  assert.equal(late.length, 1);
  offA();
  offB();
  await new Promise((r) => setTimeout(r, 15));
  assert.equal(spawned[0].killed, false); // the late viewer is still watching
});

test('a camera that never produced a frame is retried once without the requested size', () => {
  const calls = [];
  const camera = createCamera({
    log: quiet,
    spawnImpl: (_cmd, args) => {
      const p = fakeProcess();
      calls.push({ args, p });
      return p;
    },
  });
  camera.subscribe('Cam', () => {});
  assert.ok(calls[0].args.includes('-video_size'));
  calls[0].p.emit('close', 1);
  assert.equal(calls.length, 2);
  assert.ok(!calls[1].args.includes('-video_size'));
  assert.ok(calls[1].args.includes('video=Cam'));
});

test('devices reports ffmpeg missing instead of throwing', async () => {
  const camera = createCamera({
    log: quiet,
    spawnImpl: () => {
      const p = fakeProcess();
      setImmediate(() => p.emit('error', Object.assign(new Error('spawn ffmpeg ENOENT'), { code: 'ENOENT' })));
      return p;
    },
  });
  assert.deepEqual(await camera.devices(), { available: false, devices: [] });
});
