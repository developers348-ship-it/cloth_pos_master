"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type SalesProfitPoint = {
  key: string; sales: number; profit: number; invoices: number;
  // Cost management adds these per bucket. The chart deliberately does not plot
  // them: a third series would need a third validated colour and would crowd
  // bars that are already ~2.4px wide at 30 daily buckets. They are read by the
  // panel's table view instead.
  expenses?: number;
  netProfit?: number;
};

/**
 * Grouped columns: Sales and Profit side by side per day (or month), both in
 * rupees, on **one** y-axis.
 *
 * Columns rather than lines because the reader here is a shopkeeper comparing
 * "how did Tuesday do against Monday" — a bar's height is a quantity you can
 * point at, where a line asks you to read a slope. (Not candlesticks: those
 * encode open/high/low/close, and a sale bucket has no such four values —
 * drawing one would be inventing data.)
 *
 * Hand-rolled SVG rather than a charting dependency — the project ships no
 * chart library, and this is one chart with fixed requirements. Colours are
 * slots 1 and 2 of the validated categorical palette (blue / orange): the pair
 * clears the colour-vision-deficiency and contrast gates on a white surface, so
 * the two series stay distinguishable for a red-green colourblind reader.
 *
 * Identity is never colour-alone: a legend is always present, the tooltip lists
 * both series with a colour key, and the panel around this chart offers a table
 * view of the same numbers.
 */

const COLORS = { sales: "#2a78d6", profit: "#eb6834" };
const HEIGHT = 268;
const PAD = { top: 16, right: 30, bottom: 30, left: 64 };
/** Bar cap from the mark spec — a column never fills its slot; the leftover is air. */
const MAX_BAR = 24;
/** Surface gap between the two bars of a pair, and between neighbouring pairs. */
const GAP = 2;
const CORNER = 4;

/** Axis bounds and tick stops on round numbers, covering negatives (a loss-making day). */
function niceScale(min: number, max: number, targetTicks = 5) {
  let lo = Math.min(0, min);
  let hi = Math.max(0, max);
  if (lo === hi) hi = lo + 1;
  const rawStep = (hi - lo) / targetTicks;
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const norm = rawStep / mag;
  // Never step below a whole rupee: a flat range would otherwise tick in
  // fifths and the compact labels would read "0 0 0 1 1 1".
  const step = Math.max(1, (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag);
  lo = Math.floor(lo / step) * step;
  hi = Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return { lo, hi, ticks };
}

/** Axis labels only — the tooltip and table carry exact figures. */
function compact(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(abs % 1_000_000 === 0 ? 0 : 1)}M`;
  if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(abs % 1_000 === 0 ? 0 : 1)}K`;
  return `${sign}${Math.round(abs)}`;
}

/**
 * A column with its **data end** rounded and its baseline end square, per the
 * mark spec. Works in both directions, so a negative profit hangs below the
 * zero line with the rounding at the bottom.
 */
function barPath(left: number, w: number, yBase: number, yValue: number): string {
  const h = Math.abs(yBase - yValue);
  // A bucket that rounds to nothing still gets a sliver rather than vanishing.
  if (h < 1) return `M${left},${yBase}h${w}v-1h${-w}Z`;
  const up = yValue <= yBase;
  const r = Math.min(CORNER, w / 2, h);
  const right = left + w;
  const near = up ? yValue + r : yValue - r;
  return (
    `M${left},${yBase}L${left},${near}Q${left},${yValue} ${left + r},${yValue}` +
    `L${right - r},${yValue}Q${right},${yValue} ${right},${near}L${right},${yBase}Z`
  );
}

/**
 * Bucket keys are `YYYY-MM-DD` or `YYYY-MM`, built in UTC by the API — read
 * back in UTC so a day doesn't slide either side of midnight, and rendered
 * numerically so the axis needs no translated month names.
 */
function bucketDate(key: string): Date {
  return new Date(`${key.length === 7 ? `${key}-01` : key}T00:00:00Z`);
}
function axisLabel(key: string): string {
  const d = bucketDate(key);
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return key.length === 7 ? `${mm}/${d.getUTCFullYear()}` : `${dd}/${mm}`;
}
export function bucketLabel(key: string): string {
  const d = bucketDate(key);
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return key.length === 7 ? `${mm}/${d.getUTCFullYear()}` : `${dd}/${mm}/${d.getUTCFullYear()}`;
}

export default function SalesProfitChart({
  points,
  salesLabel,
  profitLabel,
  formatValue,
  dimmed,
  isUrdu,
}: {
  points: SalesProfitPoint[];
  salesLabel: string;
  profitLabel: string;
  formatValue: (n: number) => string;
  /** True while a refetch is in flight — the previous render is held, faded. */
  dimmed?: boolean;
  isUrdu?: boolean;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(720);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(320, entry.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const innerW = Math.max(1, width - PAD.left - PAD.right);
  const innerH = HEIGHT - PAD.top - PAD.bottom;

  const scale = useMemo(() => {
    const values = points.flatMap((p) => [p.sales, p.profit]);
    return niceScale(Math.min(0, ...values), Math.max(0, ...values));
  }, [points]);

  /** One band per bucket; the pair of bars sits centred in it with air either side. */
  const band = innerW / Math.max(1, points.length);
  const barW = Math.max(1.5, Math.min(MAX_BAR, (band - GAP * 3) / 2));
  const bandLeft = useCallback((i: number) => PAD.left + i * band, [band]);
  const pairLeft = useCallback(
    (i: number) => bandLeft(i) + (band - (barW * 2 + GAP)) / 2,
    [bandLeft, band, barW]
  );

  const y = useCallback(
    (v: number) => PAD.top + innerH - ((v - scale.lo) / (scale.hi - scale.lo)) * innerH,
    [innerH, scale]
  );
  const yBase = y(0);

  // Thin the x labels to whatever the container actually fits, allowing ~64px
  // per label — a fixed count collides on a phone once the keys are `MM/YYYY`.
  const labelSlots = Math.max(2, Math.floor(innerW / 64));
  const labelEvery = Math.max(1, Math.ceil(points.length / labelSlots));

  /** The whole band is the hit target, so nobody has to land on a thin bar. */
  function onMove(e: React.PointerEvent<SVGSVGElement>) {
    if (points.length === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const i = Math.floor((e.clientX - rect.left - PAD.left) / band);
    setHover(Math.max(0, Math.min(points.length - 1, i)));
  }

  function onKey(e: React.KeyboardEvent<SVGSVGElement>) {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const step = e.key === "ArrowRight" ? 1 : -1;
    setHover((h) => Math.max(0, Math.min(points.length - 1, (h ?? 0) + step)));
  }

  const active = hover !== null ? points[hover] : null;
  // Keep the tooltip inside the card — it flips to the left of the hovered band
  // once that band is past the midpoint.
  const bandCentre = hover === null ? 0 : bandLeft(hover) + band / 2;
  const tipLeft = bandCentre > width / 2 ? bandCentre - 188 : bandCentre + 12;

  const keys = [
    { label: salesLabel, color: COLORS.sales, value: active?.sales ?? 0 },
    { label: profitLabel, color: COLORS.profit, value: active?.profit ?? 0 },
  ];

  return (
    <div ref={wrapRef} className="relative w-full">
      <svg
        width={width}
        height={HEIGHT}
        role="img"
        tabIndex={0}
        aria-label={`${salesLabel} / ${profitLabel}`}
        className={`block outline-none transition-opacity ${dimmed ? "opacity-50" : ""}`}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
        onKeyDown={onKey}
        // Keyboard focus must show what hover shows, so tabbing in lands on the
        // latest bucket rather than on nothing until an arrow key is pressed.
        onFocus={() => setHover((h) => h ?? Math.max(0, points.length - 1))}
        onBlur={() => setHover(null)}
      >
        {/* Gridlines — hairline, solid, one step off the surface. */}
        {scale.ticks.map((tv) => (
          <g key={tv}>
            <line
              x1={PAD.left}
              x2={width - PAD.right}
              y1={y(tv)}
              y2={y(tv)}
              stroke="#eef0f2"
              strokeWidth={1}
            />
            <text x={PAD.left - 10} y={y(tv) + 4} textAnchor="end" fontSize={11} fill="#9ca3af">
              {compact(tv)}
            </text>
          </g>
        ))}

        {/* A wash over the hovered band, so the chart visibly responds. */}
        {hover !== null && (
          <rect x={bandLeft(hover)} y={PAD.top} width={band} height={innerH} fill="#0f172a" opacity={0.04} />
        )}

        {points.map((p, i) => (
          <g key={p.key}>
            <path d={barPath(pairLeft(i), barW, yBase, y(p.sales))} fill={COLORS.sales} />
            <path d={barPath(pairLeft(i) + barW + GAP, barW, yBase, y(p.profit))} fill={COLORS.profit} />
          </g>
        ))}

        {/* Baseline drawn over the bars so their square ends read as one edge. */}
        <line x1={PAD.left} x2={width - PAD.right} y1={yBase} y2={yBase} stroke="#d1d5db" strokeWidth={1} />

        {points.map((p, i) =>
          i % labelEvery === 0 || i === points.length - 1 ? (
            <text
              key={p.key}
              x={bandLeft(i) + band / 2}
              y={HEIGHT - 10}
              textAnchor="middle"
              fontSize={11}
              fill="#9ca3af"
            >
              {axisLabel(p.key)}
            </text>
          ) : null
        )}
      </svg>

      {/* One tooltip, every series; the value leads and the name follows. */}
      {active && hover !== null && (
        <div
          className="pointer-events-none absolute z-10 w-44 rounded-lg border border-gray-200 bg-white px-3 py-2 shadow-lg"
          style={{ left: tipLeft, top: PAD.top }}
        >
          <div className="mb-1.5 text-[11px] font-medium text-gray-500">{bucketLabel(active.key)}</div>
          {keys.map((k) => (
            <div key={k.label} className="flex items-center gap-2 py-0.5">
              <span className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: k.color }} />
              <span className="text-xs font-semibold text-gray-800">{formatValue(k.value)}</span>
              <span className={`ml-auto text-[11px] text-gray-400 ${isUrdu ? "urdu-text" : ""}`}>{k.label}</span>
            </div>
          ))}
        </div>
      )}

      {/* Legend — always present for two series. Swatches mirror the marks. */}
      <div className="mt-1 flex items-center justify-center gap-5">
        {keys.map((k) => (
          <span key={k.label} className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: k.color }} />
            <span className={`text-xs text-gray-500 ${isUrdu ? "urdu-text" : ""}`}>{k.label}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
