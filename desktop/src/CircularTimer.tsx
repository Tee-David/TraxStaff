// Hero circular timer: a bold brand-gradient progress ring. The center shows
// today's worked time ticking live; the ring fills toward the daily target.
// A play/pause control sits under the goal label.
export default function CircularTimer({
  seconds,
  targetSeconds,
  active,
  onToggle,
}: {
  seconds: number;
  targetSeconds: number;
  active: boolean;
  onToggle: () => void;
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
        <div className={`ring-status ${active ? "on" : "paused"}`}>
          <span className="ring-dot" /> {active ? "Tracking" : "Not tracking"}
        </div>
        <div className="ring-time">{time}</div>
        {/* This control ends the session — it does not pause it. Labelled and
            drawn as Stop so the destructive action isn't disguised as a pause. */}
        <button className={`ring-toggle ${active ? "on" : ""}`} onClick={onToggle} aria-label={active ? "Stop tracking" : "Start tracking"}>
          {active ? (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><rect x="3.5" y="3.5" width="9" height="9" rx="1.6" /></svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M5 3.5v9l7.5-4.5z" /></svg>
          )}
        </button>
      </div>
    </div>
  );
}
