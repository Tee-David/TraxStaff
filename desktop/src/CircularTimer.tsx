// Hero circular timer: a brand-gradient progress ring with the elapsed time in
// the center. The ring sweeps once per hour (a soft visual cadence) so it feels
// alive without implying a fixed countdown.
export default function CircularTimer({ seconds, label }: { seconds: number; label: string }) {
  const size = 240;
  const stroke = 16;
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const progress = (seconds % 3600) / 3600; // one sweep per hour
  const dash = circ * progress;

  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const time =
    h > 0
      ? `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`
      : `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;

  return (
    <div className="ring-wrap">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <defs>
          <linearGradient id="timerGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#2a2aa8" />
            <stop offset="1" stopColor="#000065" />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#eceef5" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="url(#timerGrad)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circ}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: "stroke-dasharray 0.9s linear" }}
        />
      </svg>
      <div className="ring-center">
        <div className="ring-time">{time}</div>
        {label && <div className="ring-label">{label}</div>}
      </div>
    </div>
  );
}
