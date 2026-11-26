import { usePrefs } from './prefs.jsx';

// The 5-channel flame sensor, drawn from above: the rover in the middle and one wedge of a half-circle for each
// channel. D1 is the far left, D3 straight ahead and D5 the far right, so the wedges are in the same order as the
// sensor's pins. A wedge that sees a flame glows and burns; the others breathe calmly while the board is online.

const CX = 160;
const CY = 178;
const R = 150;
const INNER = 30;
const STEP = 36; // 180 degrees over five channels

const rad = (deg) => (deg * Math.PI) / 180;
const at = (r, deg) => [CX + r * Math.cos(rad(deg)), CY - r * Math.sin(rad(deg))];
const pt = ([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`;

const wedge = (i) => {
  const a0 = 180 - i * STEP;
  const a1 = 180 - (i + 1) * STEP;
  return `M${pt(at(INNER, a0))} L${pt(at(R, a0))} A${R} ${R} 0 0 1 ${pt(at(R, a1))} L${pt(at(INNER, a1))} A${INNER} ${INNER} 0 0 0 ${pt(at(INNER, a0))} Z`;
};
const ring = (r) => `M${pt(at(r, 180))} A${r} ${r} 0 0 1 ${pt(at(r, 0))}`;

const FLAME = 'M12 3 C13 8 18 9 18 15 a6 6 0 0 1 -12 0 c0 -3 2 -4 3 -6 c1 2 2 2 3 -1 c0 -2 0 -3 0 -5 z';

export default function FireFan({ channels, online }) {
  const { t } = usePrefs();
  const on = channels.map((c) => online && c);
  const any = on.some(Boolean);
  const state = !online ? t('fire.state.off') : any ? t('fire.state.fire') : t('fire.state.clear');

  return (
    <svg className="fire-fan" viewBox="0 0 320 206" data-online={online || undefined} data-alert={any || undefined} role="img" aria-label={t('fire.alt', { state })}>
      <defs>
        <radialGradient id="fire-glow" gradientUnits="userSpaceOnUse" cx={CX} cy={CY} r={R}>
          <stop offset="0.15" stopColor="#ffd45a" stopOpacity="0.95" />
          <stop offset="0.55" stopColor="#ff7a2a" stopOpacity="0.88" />
          <stop offset="1" stopColor="#d9480f" stopOpacity="0.6" />
        </radialGradient>
      </defs>

      {[62, 106].map((r) => (
        <path key={r} className="fan-ring" d={ring(r)} />
      ))}

      {channels.map((_, i) => {
        const mid = 180 - i * STEP - STEP / 2;
        const [lx, ly] = at(R - 20, mid);
        const [fx, fy] = at(92, mid);
        const lit = on[i];
        return (
          <g key={i} className="fan-wedge" data-on={lit || undefined} data-off={!online || undefined} style={{ '--i': i }}>
            <path className="fan-shape" d={wedge(i)} />
            <text className="fan-id" x={lx} y={ly + 3.5} textAnchor="middle">
              D{i + 1}
            </text>
            {lit && (
              <g className="fan-flames" transform={`translate(${fx.toFixed(1)} ${fy.toFixed(1)})`}>
                <g className="fan-flame big">
                  <path d={FLAME} transform="translate(-21 -40) scale(1.75)" />
                </g>
                <g className="fan-flame small a">
                  <path d={FLAME} transform="translate(-30 -18) scale(0.9)" />
                </g>
                <g className="fan-flame small b">
                  <path d={FLAME} transform="translate(9 -20) scale(0.9)" />
                </g>
                {[-14, 0, 14].map((x, n) => (
                  <circle key={x} className="fan-ember" cx={x} cy="-30" r="1.9" style={{ animationDelay: `${n * 0.45}s` }} />
                ))}
              </g>
            )}
          </g>
        );
      })}

      {online && (
        <g className="fan-sweep" aria-hidden="true">
          <line x1={CX} y1={CY} x2={CX} y2={CY - R} />
          <circle cx={CX} cy={CY - R + 4} r="3.2" />
        </g>
      )}

      {/* the rover at the middle of the fan */}
      <g className="fan-rover">
        <circle cx={CX} cy={CY} r="27" className="fan-hub" />
        <rect x={CX - 11} y={CY - 18} width="22" height="34" rx="6" className="fan-body" />
        {/* six wheels, three a side */}
        {[-16, -5, 6].flatMap((dy) => [
          <rect key={`l${dy}`} x={CX - 16} y={CY + dy} width="5" height="8" rx="2" className="fan-wheel" />,
          <rect key={`r${dy}`} x={CX + 11} y={CY + dy} width="5" height="8" rx="2" className="fan-wheel" />,
        ])}
        <path d={`M${CX - 4} ${CY - 8} L${CX} ${CY - 14} L${CX + 4} ${CY - 8}`} className="fan-arrow" />
      </g>
    </svg>
  );
}
