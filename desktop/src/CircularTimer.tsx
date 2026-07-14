// Hero circular timer: a bold brand-gradient progress ring. The center shows
// today's worked time ticking live; the ring fills toward the daily target.
export default function CircularTimer({
  seconds,
  targetSeconds,
  active,
}: {
  seconds: number;
  targetSeconds: number;
  active: boolean;
}) {
  const size = 208;
  const stroke = 14;
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(1, seconds / targetSeconds));
  const dash = circ * pct;

  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const time = `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;

  return (
    <div className="ring-wrap">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <defs>
          <linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#3b5bff" />
            <stop offset="1" stopColor="#000065" />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--track)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="url(#ringGrad)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circ}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: "stroke-dasharray 0.9s cubic-bezier(0.22,1,0.36,1)" }}
        />
      </svg>
      <div className="ring-center">
        <div className={`ring-status ${active ? "on" : ""}`}>
          <span className="ring-dot" /> {active ? "Tracking" : "Paused"}
        </div>
        <div className="ring-time">{time}</div>
        <div className="ring-sub">{Math.round(pct * 100)}% of daily goal</div>
      </div>
    </div>
  );
}
