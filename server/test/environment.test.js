import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEnvironment, isPrivateAddress, parsePhonePosition, shape, weatherKey } from '../src/environment.js';

const hours = Array.from({ length: 48 }, (_, n) => `2026-10-30T${String(n % 24).padStart(2, '0')}:00`);
const series = (v) => hours.map(() => v);

const forecast = (over = {}) => ({
  elevation: 560,
  current: { time: '2026-10-30T12:00', temperature_2m: 30, relative_humidity_2m: 40, precipitation: 0, wind_speed_10m: 6, weather_code: 1 },
  hourly: {
    time: hours,
    soil_moisture_0_to_1cm: series(0.17),
    soil_moisture_9_to_27cm: series(0.28),
    soil_temperature_0cm: series(39),
    precipitation: series(0),
    precipitation_probability: series(5),
    wind_speed_10m: series(6),
    ...over,
  },
  daily: {
    time: ['2026-10-30', '2026-10-31', '2026-11-01'],
    temperature_2m_max: [31, 30, 29],
    temperature_2m_min: [19, 19, 20],
    precipitation_sum: [0, 1, 3],
    precipitation_probability_max: [10, 30, 60],
    et0_fao_evapotranspiration: [4, 4, 3],
    uv_index_max: [8, 7, 6],
    sunrise: ['2026-10-30T06:12', '2026-10-31T06:12', '2026-11-01T06:13'],
    sunset: ['2026-10-30T17:55', '2026-10-31T17:54', '2026-11-01T17:53'],
  },
});

test('shape: soil, next rain and spraying window come from the right hour', () => {
  const rain = series(0);
  rain[15] = 0.6; // three hours after the 12:00 reading
  const f = shape(forecast({ precipitation: rain }), { current: { us_aqi: 80, pm2_5: 20 } }, { city: 'Pune', principalSubdivision: 'Maharashtra', countryName: 'India' });
  assert.equal(f.place, 'Pune, Maharashtra, India');
  assert.equal(f.soil.moisture, 17);
  assert.equal(f.soil.root, 28);
  assert.equal(f.rainInHours, 3);
  assert.equal(f.sprayWindow, true); // calm and dry for the next 3 hours (12, 13, 14)
  assert.equal(f.now.weather, 'wx.1');
  assert.deepEqual(f.air, { aqi: 80, pm25: 20 });
  assert.equal(f.days.length, 3);
});

test('shape: no rain, no air, no place are all fine', () => {
  const f = shape(forecast(), null, null);
  assert.equal(f.rainInHours, null);
  assert.equal(f.air, null);
  assert.equal(f.place, null);
});

test('weatherKey maps WMO codes', () => {
  assert.equal(weatherKey(0), 'wx.0');
  assert.equal(weatherKey(63), 'wx.rain');
  assert.equal(weatherKey(95), 'wx.thunder');
  assert.equal(weatherKey(7), 'wx.unknown');
});

test('private and loopback addresses are recognised', () => {
  for (const ip of ['127.0.0.1', '::1', '::ffff:192.168.1.20', '10.58.46.222', '172.20.1.1', '169.254.3.3', 'fd00::1', undefined]) {
    assert.equal(isPrivateAddress(ip), true, String(ip));
  }
  for (const ip of ['103.139.159.52', '8.8.8.8', '172.32.0.1']) assert.equal(isPrivateAddress(ip), false, ip);
});

/** A fetch that answers by URL and counts calls. */
function fakeFetch() {
  const calls = [];
  const impl = async (url) => {
    calls.push(String(url));
    const u = String(url);
    const body = u.includes('open-meteo.com/v1/forecast')
      ? forecast()
      : u.includes('air-quality')
        ? { current: { us_aqi: 50, pm2_5: 10 } }
        : u.includes('bigdatacloud')
          ? { city: 'Bengaluru', principalSubdivision: 'Karnataka', countryName: 'India' }
          : { success: true, latitude: 12.97, longitude: 77.59 };
    return { ok: true, json: async () => body };
  };
  return { impl, calls };
}

test('forPosition caches by rounded position, so a moving rover does not hammer the APIs', async () => {
  const { impl, calls } = fakeFetch();
  const env = createEnvironment({ fetchImpl: impl });
  const a = await env.forPosition({ lat: 12.97161, lon: 77.59461 });
  const callsAfterFirst = calls.length;
  const b = await env.forPosition({ lat: 12.97164, lon: 77.59458 }); // same ~100 m cell
  assert.equal(calls.length, callsAfterFirst);
  assert.deepEqual(a, b);
  await env.forPosition({ lat: 13.5, lon: 77.59461 });
  assert.ok(calls.length > callsAfterFirst);
});

test('locateByAddress asks about the server itself for private addresses, and caches', async () => {
  const { impl, calls } = fakeFetch();
  const env = createEnvironment({ fetchImpl: impl });
  const pos = await env.locateByAddress('10.58.46.222');
  assert.deepEqual(pos, { lat: 12.97, lon: 77.59, accuracy: null });
  assert.equal(calls[0], 'https://ipwho.is/'); // no address appended
  await env.locateByAddress('192.168.0.5');
  assert.equal(calls.length, 1);
  await env.locateByAddress('103.139.159.52');
  assert.equal(calls[1], 'https://ipwho.is/103.139.159.52');
});

test('a phone position is read, rounded to about 1 km, and bad ones are refused', () => {
  assert.deepEqual(parsePhonePosition('13.31534,75.77394,38.6'), { lat: 13.32, lon: 75.77, accuracy: 39 });
  assert.deepEqual(parsePhonePosition('13.3,75.7'), { lat: 13.3, lon: 75.7, accuracy: null });
  assert.deepEqual(parsePhonePosition('-33.9,18.4,0'), { lat: -33.9, lon: 18.4, accuracy: 0 });
  for (const bad of [undefined, null, '', 'abc', '13.3', ',75.7', '95,75', '13,200', 'NaN,NaN', '13.3,,5']) {
    assert.equal(parsePhonePosition(bad), null, `should refuse ${String(bad)}`);
  }
});

test('an upstream failure rejects instead of caching it', async () => {
  let fail = true;
  const impl = async () => (fail ? { ok: false, status: 503 } : { ok: true, json: async () => forecast() });
  const env = createEnvironment({ fetchImpl: impl });
  await assert.rejects(env.forPosition({ lat: 1, lon: 1 }));
  fail = false;
  assert.ok(await env.forPosition({ lat: 1, lon: 1 }));
});
