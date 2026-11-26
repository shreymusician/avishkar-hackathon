import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDashboardMessage, parseRoverMessage, parseSensorNodeMessage, MAX_FRAME_BYTES } from '../src/protocol.js';
import { SessionTracker } from '../src/sessions.js';
import { createRateLimiter } from '../src/rateLimit.js';

test('dashboard frames: valid and invalid', () => {
  assert.equal(parseDashboardMessage('{"type":"drive","command":"stop"}').ok, true);
  assert.equal(parseDashboardMessage('{"type":"drive","command":"up"}').ok, false);
  assert.equal(parseDashboardMessage('{"type":"light","light":"front","level":55}').ok, true);
  assert.equal(parseDashboardMessage('{"type":"light","light":"side","level":50}').ok, false);
  assert.equal(parseDashboardMessage('{"type":"light","light":"front","level":101}').ok, false);
  assert.equal(parseDashboardMessage('{"type":"light","light":"front","level":-1}').ok, false);
  assert.equal(parseDashboardMessage('{"type":"light","light":"front","level":12.5}').ok, false);
  assert.equal(parseDashboardMessage('{"type":"light","light":"front","level":"50"}').ok, false);
  assert.equal(parseDashboardMessage('{"type":"light","light":"front"}').ok, false);
  assert.equal(parseDashboardMessage('{"type":"status"}').ok, false);
  assert.equal(parseDashboardMessage(null).ok, false);
  assert.equal(parseDashboardMessage('x'.repeat(MAX_FRAME_BYTES + 1)).ok, false);
});

test('unknown extra fields are stripped', () => {
  const { msg } = parseDashboardMessage('{"type":"drive","command":"left","evil":"x"}');
  assert.deepEqual(msg, { type: 'drive', command: 'left' });
});

test('rover frames: register and status', () => {
  assert.equal(parseRoverMessage('{"type":"device_register","deviceId":"AGRIROVER-01"}').ok, true);
  assert.equal(parseRoverMessage('{"type":"device_register","deviceId":"bad id!"}').ok, false);
  assert.equal(parseRoverMessage('{"type":"status","motion":"forward","front":100,"rear":0,"rssi":-61}').ok, true);
  assert.equal(parseRoverMessage('{"type":"status","motion":"forward","front":"yes","rear":0}').ok, false);
  assert.equal(parseRoverMessage('{"type":"status","motion":"forward","front":0,"rear":0,"rssi":99}').msg.rssi, null);
});

test('session tracker counts changes, not repeats', () => {
  const s = new SessionTracker(0);
  s.onCommand('forward', 0);
  s.onCommand('forward', 100);
  s.onCommand('forward', 200);
  s.onCommand('left', 1000);
  s.onCommand('stop', 1500);
  const out = s.end(2000);
  assert.equal(out.commands, 2);
  assert.equal(out.driveMs.forward, 1000);
  assert.equal(out.driveMs.left, 500);
  assert.equal(out.totalDriveMs, 1500);
});

test('session tracker closes a held command at the end', () => {
  const s = new SessionTracker(0);
  s.onCommand('backward', 100);
  assert.equal(s.end(600).driveMs.backward, 500);
});

test('rate limiter blocks past the limit and recovers', () => {
  let t = 0;
  const allow = createRateLimiter({ limit: 2, windowMs: 1000, now: () => t });
  assert.equal(allow('a'), true);
  assert.equal(allow('a'), true);
  assert.equal(allow('a'), false);
  assert.equal(allow('b'), true);
  t = 1001;
  assert.equal(allow('a'), true);
});

test('light mode must be auto or manual', () => {
  assert.equal(parseDashboardMessage('{"type":"light_mode","mode":"auto"}').ok, true);
  assert.equal(parseDashboardMessage('{"type":"light_mode","mode":"manual"}').ok, true);
  assert.equal(parseDashboardMessage('{"type":"light_mode","mode":"strobe"}').ok, false);
  assert.equal(parseDashboardMessage('{"type":"light_mode"}').ok, false);
});

test('nav mode must be auto or manual', () => {
  assert.equal(parseDashboardMessage('{"type":"nav_mode","mode":"auto"}').ok, true);
  assert.equal(parseDashboardMessage('{"type":"nav_mode","mode":"manual"}').ok, true);
  assert.equal(parseDashboardMessage('{"type":"nav_mode","mode":"wander"}').ok, false);
});

test('rover status: navigation fields are validated and optional', () => {
  const full = parseRoverMessage('{"type":"status","motion":"stop","front":0,"rear":0,"nav":"auto","navState":"scanning","sonar":true,"scan":{"l":80,"c":20,"r":9999},"rssi":-50}');
  assert.equal(full.ok, true);
  assert.deepEqual(full.msg.scan, { l: 80, c: 20, r: null });
  assert.equal(full.msg.nav, 'auto');
  const legacy = parseRoverMessage('{"type":"status","motion":"stop","front":0,"rear":0,"rssi":-50}');
  assert.equal(legacy.msg.nav, 'manual');
  assert.equal(legacy.msg.navState, 'idle');
  assert.equal(legacy.msg.sonar, false);
  assert.deepEqual(legacy.msg.scan, { l: null, c: null, r: null });
  assert.deepEqual(legacy.msg.sensors, { soil: null, rain: null, fire: null });
  const withSensors = parseRoverMessage('{"type":"status","motion":"stop","front":0,"rear":0,"sensors":{"soil":41,"rain":120,"fire":2},"rssi":-50}');
  assert.deepEqual(withSensors.msg.sensors, { soil: 41, rain: null, fire: 2 });
});


test('horn and alarm mute take booleans only', () => {
  assert.equal(parseDashboardMessage('{"type":"horn","on":true}').ok, true);
  assert.equal(parseDashboardMessage('{"type":"horn","on":"yes"}').ok, false);
  assert.equal(parseDashboardMessage('{"type":"horn"}').ok, false);
  assert.equal(parseDashboardMessage('{"type":"alarm_mute","mute":false}').ok, true);
  assert.equal(parseDashboardMessage('{"type":"alarm_mute","mute":1}').ok, false);
});

test('rover status: buzzer fields default to not fitted', () => {
  const fitted = parseRoverMessage('{"type":"status","motion":"stop","front":0,"rear":0,"buzzer":{"fitted":true,"muted":true}}');
  assert.deepEqual(fitted.msg.buzzer, { fitted: true, muted: true });
  const legacy = parseRoverMessage('{"type":"status","motion":"stop","front":0,"rear":0}');
  assert.deepEqual(legacy.msg.buzzer, { fitted: false, muted: false });
});

test('ping and pong carry a whole-number id only', () => {
  assert.equal(parseDashboardMessage('{"type":"ping","id":7}').ok, true);
  assert.equal(parseDashboardMessage('{"type":"ping","id":"7"}').ok, false);
  assert.equal(parseDashboardMessage('{"type":"ping","id":-1}').ok, false);
  assert.equal(parseDashboardMessage('{"type":"ping"}').ok, false);
  assert.equal(parseRoverMessage('{"type":"pong","id":7}').ok, true);
  assert.equal(parseRoverMessage('{"type":"pong","id":1.5}').ok, false);
});

test('every status frame the driver firmware can emit is accepted', () => {
  const frames = [
    '{"type":"status","motion":"stop","front":0,"rear":0,"auto":true,"dark":false,"nav":"manual","navState":"idle","sonar":true,"scan":{},"sensors":{},"buzzer":{"fitted":false,"muted":false},"rssi":-61}',
    '{"type":"status","motion":"forward","front":100,"rear":100,"auto":false,"dark":true,"nav":"manual","navState":"idle","sonar":true,"scan":{"c":200},"sensors":{"soil":4,"rain":0},"buzzer":{"fitted":false,"muted":false},"rssi":-58}',
    '{"type":"status","motion":"stop","front":0,"rear":0,"auto":true,"dark":false,"nav":"auto","navState":"scanning","sonar":true,"scan":{"l":80,"c":22,"r":140},"sensors":{"soil":41,"rain":3},"buzzer":{"fitted":false,"muted":false},"rssi":-70}',
    '{"type":"status","motion":"stop","front":0,"rear":0,"auto":true,"dark":false,"nav":"manual","navState":"idle","sonar":true,"scan":{"c":200},"sensors":{"soil":0,"rain":0},"buzzer":{"fitted":false,"muted":false},"rssi":0}',
  ];
  for (const raw of frames) assert.equal(parseRoverMessage(raw).ok, true, raw);
});

test('fire sensor board: registration and five-channel frames', () => {
  assert.equal(parseSensorNodeMessage('{"type":"device_register","deviceId":"AGRIROVER-FIRE-01","key":""}').ok, true);
  assert.equal(parseSensorNodeMessage('{"type":"device_register","deviceId":"bad id!"}').ok, false);
  const ok = parseSensorNodeMessage('{"type":"fire_status","d":[0,0,1,0,1],"rssi":-61}');
  assert.deepEqual(ok.msg.channels, [false, false, true, false, true]);
  assert.equal(ok.msg.rssi, -61);
  assert.deepEqual(parseSensorNodeMessage('{"type":"fire_status","d":[true,false,false,false,false]}').msg.channels, [true, false, false, false, false]);
  for (const bad of ['[0,0,0,0]', '[0,0,0,0,0,0]', '[0,0,2,0,0]', '["1",0,0,0,0]', '"00000"', 'null']) {
    assert.equal(parseSensorNodeMessage(`{"type":"fire_status","d":${bad}}`).ok, false, bad);
  }
  assert.equal(parseSensorNodeMessage('{"type":"status"}').ok, false);
  // a rover frame is not a sensor frame, and the other way round
  assert.equal(parseRoverMessage('{"type":"fire_status","d":[0,0,0,0,0]}').ok, false);
});
