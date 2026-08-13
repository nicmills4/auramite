import { card } from "../ui";

const DAY_MS = 86_400_000;
const GOLD = "#e3b341";
const RED = "#f87171";

type ScanRow = { id: string; pageId: string; ranAt: Date; ok: boolean; highCount: number };
type Predecessor = { ok: boolean; highCount: number } | null | undefined;

/**
 * Dual-axis trend, rendered server-side as SVG — no chart dependency, no
 * client JS. Left axis (gold line): open high-severity findings, carried
 * forward per page between scans and summed. Right axis (red bars): new leaks
 * detected in each bucket. Day buckets; weeks past 120 days.
 */
export function TrendChart({
  scans,
  addedOf,
  predecessorOf,
  from,
  to,
}: {
  scans: ScanRow[];
  addedOf: (scanId: string) => number;
  predecessorOf: Map<string, Predecessor>;
  from: Date | null;
  to: Date | null;
}) {
  if (scans.length === 0) return null;

  const asc = [...scans].sort((a, b) => a.ranAt.getTime() - b.ranAt.getTime());
  const start = (from ?? asc[0].ranAt).getTime();
  const end = (to ?? new Date()).getTime();
  if (end <= start) return null;

  const spanDays = (end - start) / DAY_MS;
  const bucketMs = spanDays > 120 ? 7 * DAY_MS : DAY_MS;
  const bucketStart = Math.floor(start / bucketMs) * bucketMs;
  const bucketCount = Math.min(Math.ceil((end - bucketStart) / bucketMs), 400);
  if (bucketCount < 2) return null;

  // Carry-forward standing: seed each page from its scan just before the
  // window, then advance through in-range scans bucket by bucket.
  const perPageHigh = new Map<string, number>();
  for (const [pageId, pred] of predecessorOf) {
    if (pred?.ok) perPageHigh.set(pageId, pred.highCount);
  }

  const buckets: { t: number; high: number; added: number }[] = [];
  let i = 0;
  for (let b = 0; b < bucketCount; b++) {
    const bEnd = bucketStart + (b + 1) * bucketMs;
    let added = 0;
    while (i < asc.length && asc[i].ranAt.getTime() < bEnd) {
      const s = asc[i];
      if (s.ok) perPageHigh.set(s.pageId, s.highCount);
      added += addedOf(s.id);
      i++;
    }
    let high = 0;
    for (const v of perPageHigh.values()) high += v;
    buckets.push({ t: bucketStart + b * bucketMs, high, added });
  }

  const maxHigh = Math.max(1, ...buckets.map((b) => b.high));
  const maxAdded = Math.max(1, ...buckets.map((b) => b.added));

  // Geometry. viewBox units — the SVG scales with its container.
  const W = 720;
  const H = 190;
  const L = 34;
  const R = 34;
  const T = 12;
  const B = 26;
  const plotW = W - L - R;
  const plotH = H - T - B;
  const x = (b: number) => L + (plotW * (b + 0.5)) / buckets.length;
  const yHigh = (v: number) => T + plotH - (plotH * v) / maxHigh;
  const yAdded = (v: number) => T + plotH - (plotH * v) / maxAdded;
  const barW = Math.min(14, (plotW / buckets.length) * 0.5);

  const linePts = buckets.map((b, idx) => `${x(idx).toFixed(1)},${yHigh(b.high).toFixed(1)}`).join(" ");
  const areaPts = `${L},${T + plotH} ${linePts} ${L + plotW},${T + plotH}`;

  const fmtDay = (t: number) =>
    new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(t));
  const xLabelEvery = Math.max(1, Math.ceil(buckets.length / 5));

  return (
    <div className={`${card} p-5`}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="font-mono text-[11px] uppercase tracking-[0.15em] text-zinc-500">Leak trend</p>
        <div className="flex items-center gap-4 text-[11px] text-zinc-500">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-[3px] w-4 rounded" style={{ background: GOLD }} />
            Open high findings <span className="text-zinc-600">(left)</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-2 rounded-sm" style={{ background: RED }} />
            New leaks <span className="text-zinc-600">(right)</span>
          </span>
        </div>
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-label={`Leak trend: open high-severity findings peaked at ${maxHigh}; new leaks peaked at ${maxAdded} per ${bucketMs === DAY_MS ? "day" : "week"}.`}
      >
        {/* gridlines + left axis (open high findings) */}
        {[0, 0.5, 1].map((f) => {
          const v = Math.round(maxHigh * f);
          const y = yHigh(v);
          return (
            <g key={`l${f}`}>
              <line x1={L} x2={W - R} y1={y} y2={y} stroke="rgba(255,255,255,0.06)" />
              <text x={L - 6} y={y + 3} textAnchor="end" fontSize="9" fill="#71717a" fontFamily="monospace">{v}</text>
            </g>
          );
        })}
        {/* right axis (new leaks) */}
        {[0.5, 1].map((f) => {
          const v = Math.round(maxAdded * f);
          return (
            <text key={`r${f}`} x={W - R + 6} y={yAdded(v) + 3} textAnchor="start" fontSize="9" fill={RED} fillOpacity="0.7" fontFamily="monospace">{v}</text>
          );
        })}

        {/* new-leak bars (right axis) */}
        {buckets.map((b, idx) =>
          b.added > 0 ? (
            <rect
              key={`b${b.t}`}
              x={x(idx) - barW / 2}
              y={yAdded(b.added)}
              width={barW}
              height={T + plotH - yAdded(b.added)}
              rx="1.5"
              fill={RED}
              fillOpacity="0.75"
            >
              <title>{`${fmtDay(b.t)}: ${b.added} new leak${b.added === 1 ? "" : "s"}`}</title>
            </rect>
          ) : null,
        )}

        {/* standing line + soft area (left axis) */}
        <polygon points={areaPts} fill={GOLD} fillOpacity="0.07" />
        <polyline points={linePts} fill="none" stroke={GOLD} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {buckets.map((b, idx) => (
          <circle key={`c${b.t}`} cx={x(idx)} cy={yHigh(b.high)} r="2.4" fill={GOLD}>
            <title>{`${fmtDay(b.t)}: ${b.high} open high finding${b.high === 1 ? "" : "s"}`}</title>
          </circle>
        ))}

        {/* x labels */}
        {buckets.map((b, idx) =>
          idx % xLabelEvery === 0 ? (
            <text key={`x${b.t}`} x={x(idx)} y={H - 8} textAnchor="middle" fontSize="9" fill="#71717a" fontFamily="monospace">
              {fmtDay(b.t)}
            </text>
          ) : null,
        )}
      </svg>
    </div>
  );
}
