// A small software 3D renderer for the rover on a canvas: flat-shaded polygons drawn back to front.
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
export function attitude([x, y, z], { roll, pitch, yaw }) {
  const PIVOT = 0.38;
  const p = turn(nose(bank([x, y - PIVOT, z], roll), pitch), yaw);
  // Ride a little higher when tilted, so the low wheels stay on the ground instead of sinking into it.
  const lift = Math.abs(Math.sin(pitch * RAD)) * 0.8 + Math.abs(Math.sin(roll * RAD)) * 0.65;
  return [p[0], p[1] + PIVOT + lift, p[2]];
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

/** A wheel: a 12-sided drum lying along the x axis, with a hub cap on the outer face. */
function wheel(cx, cz) {
  const SIDES = 12;
  const R = 0.28;
  const HALF = 0.11;
  const ring = (x, r) => Array.from({ length: SIDES }, (_, i) => {
    const a = (i / SIDES) * Math.PI * 2;
    return [x, R + r * Math.sin(a), cz + r * Math.cos(a)];
  });
  const inner = ring(cx - HALF, R);
  const outer = ring(cx + HALF, R);
  const faces = inner.map((p, i) => {
    const j = (i + 1) % SIDES;
    return { points: [p, inner[j], outer[j], outer[i]], color: i % 2 ? [38, 42, 40] : [52, 57, 54] };
  });
  faces.push({ points: inner, color: [30, 33, 31] }, { points: outer, color: [30, 33, 31] });
  faces.push({ points: ring(cx + Math.sign(cx) * (HALF + 0.012), R * 0.45), color: [242, 183, 5] });
  return faces;
}

/** The six-wheeled rover: chassis, deck, camera mast and an arrow on top that points forward. */
export const ROVER_FACES = [
  ...[-0.62, 0, 0.62].flatMap((z) => [...wheel(-0.62, z), ...wheel(0.62, z)]),
  ...box(0, 0.38, 0, 0.9, 0.22, 1.66, [36, 110, 66]),
  ...box(0, 0.6, -0.14, 0.72, 0.22, 0.86, [226, 232, 222]),
  ...box(0, 0.88, 0.5, 0.08, 0.5, 0.08, [70, 76, 72]),
  ...box(0, 1.2, 0.52, 0.34, 0.18, 0.2, [40, 46, 44]),
  ...box(0, 1.2, 0.63, 0.12, 0.1, 0.04, [90, 170, 230]),
  ...box(-0.28, 0.4, 0.845, 0.16, 0.09, 0.04, [255, 240, 180]),
  ...box(0.28, 0.4, 0.845, 0.16, 0.09, 0.04, [255, 240, 180]),
  // Lies flat on the deck: sorted a little nearer, or the deck's own top face would paint over it.
  { points: [[-0.24, 0.722, -0.36], [0, 0.722, 0.18], [0.24, 0.722, -0.36]], color: [224, 72, 26], nearer: 0.35 },
];

const ZONE_COLORS = { stop: [224, 72, 26], careful: [242, 183, 5], clear: [95, 174, 52] };
/** Distances farther than this are not drawn: the wall would be off the picture. */
const WALL_MAX_CM = 150;
const CM_PER_UNIT = 30;

/** One upright slab per side that sees something near, at the measured distance, turning with the rover. */
function walls(sides, yaw) {
  const out = [];
  for (const { side, cm, zone } of sides) {
    if (cm == null || cm > WALL_MAX_CM) continue;
    const reach = cm / CM_PER_UNIT;
    const alongZ = side === 'front' || side === 'back';
    const sign = side === 'front' || side === 'right' ? 1 : -1;
    const at = sign * ((alongZ ? 0.87 : 0.74) + reach);
    const faces = alongZ ? box(0, 0.32, at, 1.2, 0.64, 0.08, ZONE_COLORS[zone]) : box(at, 0.32, 0, 0.08, 0.64, 1.5, ZONE_COLORS[zone]);
    for (const face of faces) out.push({ ...face, points: face.points.map((p) => turn(p, yaw)), alpha: 0.72 });
    out.push({ label: `${cm} cm`, points: [turn(alongZ ? [0, 0.86, at] : [at, 0.86, 0], yaw)] });
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

/** Draw one frame. view = {azimuth, elevation}; pose = {roll, pitch, yaw}; sides = [{side, cm, zone}]. */
export function drawScene(ctx, width, height, { pose, view, sides }) {
  const DISTANCE = 9;
  const focal = Math.min(width, height * 1.45) * 1.55;
  const project = (p) => {
    const [x, y, z] = turn([p[0], p[1] - 0.45, p[2]], -view.azimuth);
    const c = Math.cos(view.elevation * RAD);
    const s = Math.sin(view.elevation * RAD);
    const up = y * c + z * s;
    const depth = -y * s + z * c + DISTANCE;
    return [width / 2 + (focal * x) / depth, height * 0.54 - (focal * up) / depth, depth];
  };
  const trace = (points) => {
    ctx.beginPath();
    points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
  };

  const sky = ctx.createLinearGradient(0, 0, 0, height);
  sky.addColorStop(0, '#0c1f16');
  sky.addColorStop(1, '#1d3a28');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, height);

  // Ground grid, with the north line picked out.
  const SPAN = 6;
  ctx.lineWidth = 1;
  for (let i = -SPAN; i <= SPAN; i++) {
    for (const [from, to, north] of [[[i, 0, -SPAN], [i, 0, SPAN], false], [[-SPAN, 0, i], [SPAN, 0, i], false]]) {
      const a = project(from);
      const b = project(to);
      ctx.strokeStyle = north ? '#f2b705' : 'rgba(155, 224, 90, 0.2)';
      ctx.beginPath();
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
      ctx.stroke();
    }
  }
  const north = project([0, 0, SPAN + 0.45]);
  ctx.fillStyle = '#f2b705';
  ctx.font = '700 14px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('N', north[0], north[1]);

  // Shadow under the rover.
  ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
  trace([[-0.75, 0, -0.95], [0.75, 0, -0.95], [0.75, 0, 0.95], [-0.75, 0, 0.95]].map((p) => project(turn(p, pose.yaw))));
  ctx.fill();

  const faces = [
    ...ROVER_FACES.map((f) => ({ ...f, points: f.points.map((p) => attitude(p, pose)) })),
    ...walls(sides, pose.yaw),
  ].map((face) => {
    const screen = face.points.map(project);
    return { ...face, screen, depth: screen.reduce((sum, p) => sum + p[2], 0) / screen.length - (face.nearer ?? 0) };
  });
  faces.sort((a, b) => b.depth - a.depth);

  const labels = [];
  for (const face of faces) {
    if (face.label) {
      labels.push(face);
      continue;
    }
    const shade = brightness(face.points);
    const [r, g, b] = face.color.map((v) => Math.min(255, Math.round(v * shade)));
    ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${face.alpha ?? 1})`;
    trace(face.screen);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.28)';
    ctx.stroke();
  }
  ctx.font = '700 13px system-ui, sans-serif';
  for (const { label, screen } of labels) {
    const [x, y] = screen[0];
    const w = ctx.measureText(label).width + 12;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
    ctx.fillRect(x - w / 2, y - 14, w, 20);
    ctx.fillStyle = '#fff';
    ctx.fillText(label, x, y + 1);
  }
}
