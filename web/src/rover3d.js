// A small software 3D renderer for the rover on a canvas: flat-shaded polygons drawn back to front, with the moving
// parts (spinning wheels, rolling ground, tracks, dust, sensor ripples, instruments) kept in one "world" object.
// World axes: x right, y up, z forward (north). Angles are in degrees.

const RAD = Math.PI / 180;

/** Turn about the vertical axis, clockwise seen from above: heading 90 points "forward" to the right. */
export function turn([x, y, z], deg) {
  const c = Math.cos(deg * RAD);
  const s = Math.sin(deg * RAD);
  return [x * c + z * s, y, -x * s + z * c];
}

/** Positive pitch lifts the nose. */
export function nose([x, y, z], deg) {
  const c = Math.cos(deg * RAD);
  const s = Math.sin(deg * RAD);
  return [x, y * c + z * s, -y * s + z * c];
}

/** Positive roll drops the right side. */
export function bank([x, y, z], deg) {
  const c = Math.cos(deg * RAD);
  const s = Math.sin(deg * RAD);
  return [x * c + y * s, -x * s + y * c, z];
}

/** A rover-frame point placed in the world: roll, then pitch, then heading, about the middle of the chassis. */
export function attitude([x, y, z], { roll, pitch, yaw }, bob = 0) {
  const PIVOT = 0.38;
  const p = turn(nose(bank([x, y - PIVOT, z], roll), pitch), yaw);
  // Ride a little higher when tilted, so the low wheels stay on the ground instead of sinking into it.
  const lift = Math.abs(Math.sin(pitch * RAD)) * 0.8 + Math.abs(Math.sin(roll * RAD)) * 0.65;
  return [p[0], p[1] + PIVOT + lift + bob, p[2]];
}

function box(cx, cy, cz, w, h, d, color) {
  const v = (i, j, k) => [cx + (i * w) / 2, cy + (j * h) / 2, cz + (k * d) / 2];
  return [
    [v(-1, 1, -1), v(-1, 1, 1), v(1, 1, 1), v(1, 1, -1)], // top
    [v(-1, -1, -1), v(1, -1, -1), v(1, -1, 1), v(-1, -1, 1)], // bottom
    [v(-1, -1, 1), v(1, -1, 1), v(1, 1, 1), v(-1, 1, 1)], // front
    [v(-1, -1, -1), v(-1, 1, -1), v(1, 1, -1), v(1, -1, -1)], // back
    [v(1, -1, -1), v(1, 1, -1), v(1, 1, 1), v(1, -1, 1)], // right
    [v(-1, -1, -1), v(-1, -1, 1), v(-1, 1, 1), v(-1, 1, -1)], // left
  ].map((points) => ({ points, color }));
}

const WHEEL_R = 0.28;
const WHEEL_X = 0.62;
const AXLES = [-0.62, 0, 0.62];

/** A wheel: a 12-sided drum lying along the x axis, with a spoked hub on the outer face. `spin` is in radians. */
function wheel(cx, cz, spin) {
  const SIDES = 12;
  const HALF = 0.11;
  const at = (x, r, a) => [x, WHEEL_R + r * Math.sin(a), cz + r * Math.cos(a)];
  const ring = (x, r) => Array.from({ length: SIDES }, (_, i) => at(x, r, (i / SIDES) * Math.PI * 2 - spin));
  const inner = ring(cx - HALF, WHEEL_R);
  const outer = ring(cx + HALF, WHEEL_R);
  const faces = inner.map((p, i) => {
    const j = (i + 1) % SIDES;
    return { points: [p, inner[j], outer[j], outer[i]], color: i % 2 ? [38, 42, 40] : [66, 72, 68] };
  });
  faces.push({ points: inner, color: [30, 33, 31] }, { points: outer, color: [30, 33, 31] });
  const side = Math.sign(cx);
  const capX = cx + side * (HALF + 0.012);
  faces.push({ points: ring(capX, WHEEL_R * 0.5), color: [242, 183, 5] });
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2 - spin;
    faces.push({
      points: [at(capX + side * 0.006, 0.03, a + 1.6), at(capX + side * 0.006, WHEEL_R * 0.82, a + 0.09), at(capX + side * 0.006, WHEEL_R * 0.82, a - 0.09), at(capX + side * 0.006, 0.03, a - 1.6)],
      color: [255, 236, 170],
      nearer: 0.02,
    });
  }
  return faces;
}

/** Everything on the rover that does not move by itself: chassis, deck, camera mast and the forward arrow. */
const BODY_FACES = [
  ...box(0, 0.38, 0, 0.9, 0.22, 1.66, [36, 110, 66]),
  ...box(0, 0.6, -0.14, 0.72, 0.22, 0.86, [226, 232, 222]),
  ...box(0, 0.88, 0.5, 0.08, 0.5, 0.08, [70, 76, 72]),
  ...box(0, 1.2, 0.52, 0.34, 0.18, 0.2, [40, 46, 44]),
  ...box(0, 1.2, 0.63, 0.12, 0.1, 0.04, [90, 170, 230]),
  ...box(-0.28, 0.4, 0.845, 0.16, 0.09, 0.04, [255, 240, 180]),
  ...box(0.28, 0.4, 0.845, 0.16, 0.09, 0.04, [255, 240, 180]),
  ...box(-0.3, 0.78, -0.48, 0.03, 0.16, 0.03, [70, 76, 72]),
  // Lies flat on the deck: sorted a little nearer, or the deck's own top face would paint over it.
  { points: [[-0.24, 0.722, -0.36], [0, 0.722, 0.18], [0.24, 0.722, -0.36]], color: [224, 72, 26], nearer: 0.35 },
];

const ZONE_COLORS = { stop: [224, 72, 26], careful: [242, 183, 5], clear: [95, 174, 52], none: [150, 170, 160] };
/** Distances farther than this are not drawn: the wall would be off the picture. */
export const WALL_MAX_CM = 150;
const CM_PER_UNIT = 30;
/** How far the middle of each side is from the rover's centre, and which way it faces. */
const SIDES = { front: { heading: 0, edge: 0.87 }, right: { heading: 90, edge: 0.74 }, back: { heading: 180, edge: 0.87 }, left: { heading: 270, edge: 0.74 } };

/** One upright slab per side that sees something near. Each fades and grows in, and glides to a new distance. */
function walls(sides, yaw, time) {
  const out = [];
  for (const { side, cm, zone, show, label } of sides) {
    if (show < 0.02) continue;
    const { heading, edge } = SIDES[side];
    const at = edge + cm / CM_PER_UNIT;
    const pulse = zone === 'stop' ? 0.18 * Math.sin(time * 9) : 0;
    const width = side === 'front' || side === 'back' ? 1.2 : 1.5;
    const height = 0.64 * show;
    const faces = box(0, height / 2, at, width, height, 0.08, ZONE_COLORS[zone]);
    for (const face of faces) out.push({ ...face, points: face.points.map((p) => turn(p, yaw + heading)), alpha: (0.68 + pulse) * show });
    if (show > 0.5) out.push({ label, points: [turn([0, height + 0.22, at], yaw + heading)] });
  }
  return out;
}

const LIGHT = [0.35, 0.86, -0.37];

function brightness([a, b, c]) {
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const len = Math.hypot(...n) || 1;
  return 0.58 + 0.5 * Math.abs((n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2]) / len);
}

// ---- movement --------------------------------------------------------------

const SPEED = 1.5; // ground units per second shown while driving
const DRIVE = { forward: [1, 1], backward: [-1, -1], left: [-1, 1], right: [1, -1], stop: [0, 0] };
const TRACK_LIFE_S = 5;
const DUST_LIFE_S = 0.9;

/** The state that carries over from frame to frame. */
export const createWorld = () => ({ time: 0, offset: [0, 0], left: 0, right: 0, spinLeft: 0, spinRight: 0, tracks: [], dust: [], sinceTrack: 0, sinceDust: 0 });

/**
 * Advance the moving parts by `dt` seconds. The wheels and ground follow the command the rover reports it is obeying
 * (it has no wheel encoders, so this is not a measured speed). `calm` leaves out dust for reduced motion.
 */
export function stepWorld(world, dt, { motion, yaw, calm }) {
  const [wantLeft, wantRight] = DRIVE[motion] ?? DRIVE.stop;
  const ease = 1 - Math.exp(-dt * 6); // the motors spin up and coast down
  world.left += (wantLeft - world.left) * ease;
  world.right += (wantRight - world.right) * ease;
  world.time += dt;
  world.spinLeft += (world.left * SPEED * dt) / WHEEL_R;
  world.spinRight += (world.right * SPEED * dt) / WHEEL_R;

  const travel = ((world.left + world.right) / 2) * SPEED * dt;
  const ahead = turn([0, 0, 1], yaw);
  world.offset[0] += ahead[0] * travel;
  world.offset[1] += ahead[2] * travel;

  const effort = Math.max(Math.abs(world.left), Math.abs(world.right));
  world.sinceTrack += dt;
  if (effort > 0.25 && world.sinceTrack > 0.05) {
    world.sinceTrack = 0;
    for (const x of [-WHEEL_X, WHEEL_X]) {
      const p = turn([x, 0, -0.62], yaw);
      world.tracks.push({ x: p[0] + world.offset[0], z: p[2] + world.offset[1], side: Math.sign(x), born: world.time });
    }
  }
  world.tracks = world.tracks.filter((t) => world.time - t.born < TRACK_LIFE_S);

  world.sinceDust += dt;
  if (!calm && effort > 0.35 && world.sinceDust > 0.035) {
    world.sinceDust = 0;
    for (const [x, speed] of [[-WHEEL_X, world.left], [WHEEL_X, world.right]]) {
      // Thrown out behind the wheel that trails in the direction it is rolling.
      const trailing = speed >= 0 ? -0.86 : 0.86;
      const p = turn([x + (Math.random() - 0.5) * 0.2, 0.06, trailing], yaw);
      const kick = turn([(Math.random() - 0.5) * 0.5, 0, -Math.sign(speed) * (0.4 + Math.random() * 0.6)], yaw);
      world.dust.push({ x: p[0] + world.offset[0], y: p[1], z: p[2] + world.offset[1], vx: kick[0], vy: 0.25 + Math.random() * 0.45, vz: kick[2], born: world.time });
    }
  }
  for (const d of world.dust) {
    d.x += d.vx * dt;
    d.y += d.vy * dt;
    d.z += d.vz * dt;
  }
  world.dust = world.dust.filter((d) => world.time - d.born < DUST_LIFE_S);
}

// ---- drawing ---------------------------------------------------------------

const SPAN = 6;

/** Draw one frame. view = {azimuth, elevation, distance}; pose = {roll, pitch, yaw}; sides = eased sonar sides. */
export function drawScene(ctx, width, height, { pose, view, sides, world, live, sonarLive, steep, calm }) {
  const focal = Math.min(width, height * 1.45) * 1.55;
  const { time, offset } = world;
  const project = (p) => {
    const [x, y, z] = turn([p[0], p[1] - 0.45, p[2]], -view.azimuth);
    const c = Math.cos(view.elevation * RAD);
    const s = Math.sin(view.elevation * RAD);
    const up = y * c + z * s;
    const depth = Math.max(1, -y * s + z * c + view.distance);
    return [width / 2 + (focal * x) / depth, height * 0.54 - (focal * up) / depth, depth];
  };
  const trace = (points, close = true) => {
    ctx.beginPath();
    points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    if (close) ctx.closePath();
  };

  const sky = ctx.createLinearGradient(0, 0, 0, height);
  sky.addColorStop(0, '#07140e');
  sky.addColorStop(1, '#1f3f2b');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, height);
  const centre = project([0, 0, 0]);
  const glow = ctx.createRadialGradient(centre[0], centre[1], 0, centre[0], centre[1], Math.max(width, height) * 0.5);
  glow.addColorStop(0, 'rgba(155, 224, 90, 0.16)');
  glow.addColorStop(1, 'rgba(155, 224, 90, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);

  // Ground grid. It slides under the rover while driving and fades toward the edges.
  const frac = (v) => v - Math.floor(v);
  const fade = (x, z) => Math.max(0, 1 - Math.hypot(x, z) / (SPAN + 0.6));
  ctx.lineWidth = 1;
  const segment = (a, b) => {
    const alpha = fade((a[0] + b[0]) / 2, (a[2] + b[2]) / 2) * 0.5;
    if (alpha <= 0.01) return;
    ctx.strokeStyle = `rgba(155, 224, 90, ${alpha.toFixed(3)})`;
    trace([project(a), project(b)], false);
    ctx.stroke();
  };
  const shiftX = -frac(offset[0]);
  const shiftZ = -frac(offset[1]);
  for (let i = -SPAN; i <= SPAN + 1; i++) {
    for (let j = -SPAN; j < SPAN; j++) {
      segment([i + shiftX, 0, j], [i + shiftX, 0, j + 1]);
      segment([j, 0, i + shiftZ], [j + 1, 0, i + shiftZ]);
    }
  }

  // Wheel tracks left behind.
  ctx.lineCap = 'round';
  for (const side of [-1, 1]) {
    const line = world.tracks.filter((t) => t.side === side);
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1];
      const b = line[i];
      if (b.born - a.born > 0.2) continue; // a stop in between
      const alpha = (1 - (time - b.born) / TRACK_LIFE_S) * fade(b.x - offset[0], b.z - offset[1]);
      ctx.strokeStyle = `rgba(2, 8, 4, ${(alpha * 0.75).toFixed(3)})`;
      ctx.lineWidth = Math.max(2, (focal * 0.14) / project([0, 0, 0])[2]);
      trace([project([a.x - offset[0], 0, a.z - offset[1]]), project([b.x - offset[0], 0, b.z - offset[1]])], false);
      ctx.stroke();
    }
  }
  ctx.lineCap = 'butt';

  // The ultrasonic pings: arcs that travel out from each side as far as it sees.
  if (sonarLive && !calm) {
    for (const { side, cm, zone, show } of sides) {
      const { heading, edge } = SIDES[side];
      const reach = show > 0.5 ? cm / CM_PER_UNIT : WALL_MAX_CM / CM_PER_UNIT;
      const [r, g, b] = ZONE_COLORS[show > 0.5 ? zone : 'none'];
      const rate = zone === 'stop' ? 1.8 : zone === 'careful' ? 1.15 : 0.7;
      for (let k = 0; k < 3; k++) {
        const phase = frac(time * rate + k / 3);
        const radius = phase * reach;
        const arc = Array.from({ length: 13 }, (_, i) => {
          const a = ((i - 6) / 6) * 32;
          const p = turn([0, 0, radius + 0.08], a);
          return project(turn([p[0], 0.03, p[2] + edge], pose.yaw + heading));
        });
        ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${((1 - phase) * (show > 0.5 ? 0.95 : 0.4)).toFixed(3)})`;
        ctx.lineWidth = 2.5;
        trace(arc, false);
        ctx.stroke();
      }
    }
  }

  // North marker.
  ctx.font = '700 14px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const north = project([0, 0, SPAN - 0.4]);
  ctx.fillStyle = '#f2b705';
  ctx.fillText('N', north[0], north[1]);

  // A ring under the rover: breathing while live, flashing red when the tilt is dangerous.
  const ring = (radius) => Array.from({ length: 48 }, (_, i) => project(turn([0, 0.01, radius], (i / 48) * 360)));
  if (live || steep) {
    const beat = calm ? 0 : Math.sin(time * (steep ? 9 : 2));
    ctx.strokeStyle = steep ? `rgba(224, 72, 26, ${0.65 + 0.35 * beat})` : `rgba(155, 224, 90, ${0.32 + 0.14 * beat})`;
    ctx.lineWidth = steep ? 4 : 2;
    trace(ring(1.35 + beat * (steep ? 0.1 : 0.05)));
    ctx.stroke();
  }

  // Shadow under the rover.
  ctx.fillStyle = 'rgba(0, 0, 0, 0.38)';
  trace([[-0.75, 0, -0.95], [0.75, 0, -0.95], [0.75, 0, 0.95], [-0.75, 0, 0.95]].map((p) => project(turn(p, pose.yaw))));
  ctx.fill();

  // The body shivers on its wheels while the motors run.
  const effort = Math.max(Math.abs(world.left), Math.abs(world.right));
  const bob = calm ? 0 : effort * 0.012 * Math.sin(time * 34);
  const lamp = calm ? 1 : 0.5 + 0.5 * Math.sin(time * 5);
  const beacon = box(-0.3, 0.9, -0.48, 0.09, 0.09, 0.09, live ? [60 + 195 * lamp, 90 + 140 * lamp, 40] : [110, 118, 112]);
  const faces = [
    ...[...BODY_FACES, ...beacon].map((f) => ({ ...f, points: f.points.map((p) => attitude(p, pose, bob)) })),
    ...AXLES.flatMap((z) => [...wheel(-WHEEL_X, z, world.spinLeft), ...wheel(WHEEL_X, z, world.spinRight)])
      .map((f) => ({ ...f, points: f.points.map((p) => attitude(p, pose)) })),
    ...walls(sides, pose.yaw, calm ? 0 : time),
    ...world.dust.map((d) => ({ dust: (time - d.born) / DUST_LIFE_S, points: [[d.x - offset[0], d.y, d.z - offset[1]]] })),
  ].map((face) => {
    const screen = face.points.map(project);
    return { ...face, screen, depth: screen.reduce((sum, p) => sum + p[2], 0) / screen.length - (face.nearer ?? 0) };
  });
  faces.sort((a, b) => b.depth - a.depth);

  const labels = [];
  ctx.lineWidth = 1;
  for (const face of faces) {
    if (face.label) {
      labels.push(face);
      continue;
    }
    if (face.dust !== undefined) {
      const [x, y, depth] = face.screen[0];
      ctx.fillStyle = `rgba(196, 170, 126, ${((1 - face.dust) * 0.5).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(x, y, (focal * (0.03 + face.dust * 0.12)) / depth, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }
    const shade = brightness(face.points);
    const [r, g, b] = face.color.map((v) => Math.min(255, Math.round(v * shade)));
    ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${face.alpha ?? 1})`;
    trace(face.screen);
    ctx.fill();
    ctx.strokeStyle = `rgba(0, 0, 0, ${0.28 * (face.alpha ?? 1)})`;
    ctx.stroke();
  }
  ctx.font = '700 13px system-ui, sans-serif';
  for (const { label, screen } of labels) {
    const [x, y] = screen[0];
    const w = ctx.measureText(label).width + 12;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
    ctx.fillRect(x - w / 2, y - 10, w, 20);
    ctx.fillStyle = '#fff';
    ctx.fillText(label, x, y + 1);
  }

  const size = Math.max(28, Math.min(46, width * 0.07));
  horizon(ctx, size + 12, size + 12, size, pose);
  compass(ctx, width - size - 12, size + 12, size, pose.yaw);
  ctx.textBaseline = 'alphabetic';
}

/** Cockpit-style horizon: the sky and ground tip and slide with the rover's tilt. */
function horizon(ctx, x, y, r, { roll, pitch }) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.clip();
  ctx.translate(x, y);
  ctx.rotate(-roll * RAD);
  const drop = Math.max(-r, Math.min(r, (pitch / 45) * r));
  ctx.fillStyle = '#3d7fb8';
  ctx.fillRect(-2 * r, -2 * r, 4 * r, 2 * r + drop);
  ctx.fillStyle = '#7a5a32';
  ctx.fillRect(-2 * r, drop, 4 * r, 2 * r);
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 1.5;
  for (const mark of [-30, -15, 0, 15, 30]) {
    const at = drop - (mark / 45) * r;
    const half = mark === 0 ? r : r * 0.22;
    ctx.beginPath();
    ctx.moveTo(-half, at);
    ctx.lineTo(half, at);
    ctx.stroke();
  }
  ctx.restore();
  // The fixed rover symbol and rim.
  ctx.strokeStyle = '#f2b705';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(x - r * 0.6, y);
  ctx.lineTo(x - r * 0.18, y);
  ctx.lineTo(x, y + r * 0.16);
  ctx.lineTo(x + r * 0.18, y);
  ctx.lineTo(x + r * 0.6, y);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();
}

/** Compass card that rotates under a fixed pointer, relative to the heading set as north. */
function compass(ctx, x, y, r, yaw) {
  ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.font = `700 ${Math.round(r * 0.3)}px system-ui, sans-serif`;
  for (let deg = 0; deg < 360; deg += 30) {
    const a = (deg - yaw) * RAD;
    const sin = Math.sin(a);
    const cos = Math.cos(a);
    if (deg % 90 === 0) {
      ctx.fillStyle = deg === 0 ? '#f2b705' : '#fff';
      ctx.fillText('NESW'[deg / 90], x + sin * r * 0.68, y - cos * r * 0.68);
    } else {
      ctx.beginPath();
      ctx.moveTo(x + sin * r * 0.78, y - cos * r * 0.78);
      ctx.lineTo(x + sin * r * 0.92, y - cos * r * 0.92);
      ctx.stroke();
    }
  }
  ctx.fillStyle = '#e0481a';
  ctx.beginPath();
  ctx.moveTo(x, y - r * 0.4);
  ctx.lineTo(x + r * 0.16, y + r * 0.2);
  ctx.lineTo(x - r * 0.16, y + r * 0.2);
  ctx.closePath();
  ctx.fill();
}
