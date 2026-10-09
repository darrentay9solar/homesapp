"use client";

/**
 * The dashboard's charts, drawn with plain SVG and MUI on the template.
 *
 * Marks follow the data-viz rules: thin columns (24 px at most) rounded at the
 * data end and square on the baseline, hairline solid grid, values in text
 * colours (never the series colour), a legend once there are two series, a
 * tooltip on every mark, and a table view for every chart. Colours come from
 * DESIGN.chart (series) and the theme (text, grid, status).
 */

import TableChartRoundedIcon from "@mui/icons-material/TableChartRounded";
import InsertChartOutlinedRoundedIcon from "@mui/icons-material/InsertChartOutlinedRounded";
import Box from "@mui/material/Box";
import ButtonBase from "@mui/material/ButtonBase";
import Card from "@mui/material/Card";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import { alpha, type Theme, useTheme } from "@mui/material/styles";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { type ReactNode, useEffect, useRef, useState } from "react";

import { num, ticks } from "@/lib/client/analytics";
import { DESIGN } from "@/lib/client/design";
import { T, TR } from "@/lib/client/i18n";

export function seriesColor(t: Theme, i: number): string {
  const s = DESIGN.chart.series[i % DESIGN.chart.series.length];
  return t.palette.mode === "dark" ? s.dark : s.light;
}

/** The width of a box, kept up to date, so charts draw crisply at any size. */
function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

// ------------------------------------------------------------------ frame

/**
 * A chart's card: title and a line saying what it shows, a switch between the
 * chart and the same numbers as a table, then the chart.
 */
export function ChartCard({
  title,
  sub,
  children,
  table,
  legend,
  testId,
}: {
  title: string;
  sub?: string;
  children: ReactNode;
  table?: { head: string[]; rows: Array<Array<string | number>> };
  legend?: Array<{ label: string; color: (t: Theme) => string }>;
  testId?: string;
}) {
  const [asTable, setAsTable] = useState(false);
  return (
    <Card sx={{ p: { xs: 2, sm: 2.5 }, minWidth: 0 }} data-testid={testId}>
      <Stack direction="row" sx={{ alignItems: "flex-start", gap: 1 }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography component="h3" sx={{ fontWeight: 600, fontSize: 15.5 }}>
            {TR(title)}
          </Typography>
          {sub && (
            <Typography variant="body2" sx={{ color: "text.secondary", mt: 0.25 }}>
              {TR(sub)}
            </Typography>
          )}
        </Box>
        {table && (
          <Tooltip title={asTable ? T("Show as a chart") : T("Show as a table")}>
            <IconButton size="small" aria-label={asTable ? T("Show as a chart") : T("Show as a table")} onClick={() => setAsTable((v) => !v)} sx={{ mt: -0.5, mr: -0.5 }}>
              {asTable ? <InsertChartOutlinedRoundedIcon fontSize="small" /> : <TableChartRoundedIcon fontSize="small" />}
            </IconButton>
          </Tooltip>
        )}
      </Stack>
      {legend && legend.length > 1 && !asTable && (
        <Stack direction="row" sx={{ gap: 2, mt: 1.25, flexWrap: "wrap" }}>
          {legend.map((l) => (
            <Stack key={l.label} direction="row" sx={{ alignItems: "center", gap: 0.75 }}>
              <Box sx={(t) => ({ width: 10, height: 10, borderRadius: "3px", bgcolor: l.color(t) })} />
              <Typography variant="caption" sx={{ color: "text.secondary" }}>
                {TR(l.label)}
              </Typography>
            </Stack>
          ))}
        </Stack>
      )}
      <Box sx={{ mt: 1.75 }}>{asTable && table ? <DataTable head={table.head} rows={table.rows} /> : children}</Box>
    </Card>
  );
}

export function DataTable({ head, rows }: { head: string[]; rows: Array<Array<string | number>> }) {
  return (
    <Box sx={{ overflowX: "auto" }}>
      <Table size="small" sx={{ "& td, & th": { px: 1, whiteSpace: "nowrap" }, "& td:not(:first-of-type), & th:not(:first-of-type)": { textAlign: "right", fontVariantNumeric: "tabular-nums" } }}>
        <TableHead>
          <TableRow>
            {head.map((h) => (
              <TableCell key={h} sx={{ color: "text.secondary", fontWeight: 600, fontSize: 12.5 }}>
                {TR(h)}
              </TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((r, i) => (
            <TableRow key={i}>
              {r.map((c, j) => (
                <TableCell key={j} sx={{ fontSize: 13.5 }}>
                  {typeof c === "number" ? num(c, 1) : TR(c)}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Box>
  );
}

// ------------------------------------------------------------------ stat tile

export type Tone = "neutral" | "bad" | "warn" | "good";

/**
 * A headline number. Pressing it opens the list behind it (the "dropdown"):
 * the tile is a button, and shows when it's the open one.
 */
export function StatTile({
  label,
  value,
  sub,
  icon,
  tone = "neutral",
  delta,
  open,
  onClick,
  testId,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: ReactNode;
  tone?: Tone;
  delta?: { text: string; up: boolean | null } | null;
  open?: boolean;
  onClick?: () => void;
  testId?: string;
}) {
  const color = (t: Theme) => (tone === "bad" ? t.palette.error.main : tone === "warn" ? t.palette.warning.main : tone === "good" ? t.palette.success.main : t.palette.primary.main);
  const inner = (
    <Box sx={{ p: { xs: 1.75, sm: 2 }, width: "100%", textAlign: "left", height: "100%" }}>
      <Stack direction="row" sx={{ alignItems: "center", gap: 1, justifyContent: "space-between" }}>
        <Box sx={(t) => ({ width: 34, height: 34, borderRadius: `${DESIGN.radius.iconTile}px`, display: "grid", placeItems: "center", color: color(t), bgcolor: alpha(color(t), 0.12), "& svg": { fontSize: 19 } })}>{icon}</Box>
        {onClick && (
          <Typography variant="caption" sx={{ color: open ? "primary.main" : "text.secondary", fontWeight: 600 }}>
            {open ? T("Hide") : T("View")}
          </Typography>
        )}
      </Stack>
      <Typography sx={{ fontSize: { xs: 26, sm: 28 }, fontWeight: 600, lineHeight: 1.15, mt: 1.25 }}>{value}</Typography>
      <Typography variant="body2" sx={{ color: "text.secondary", mt: 0.25, lineHeight: 1.35 }}>
        {TR(label)}
      </Typography>
      {(delta || sub) && (
        <Typography variant="caption" component="p" sx={{ mt: 0.5, color: delta && delta.up !== null ? (delta.up ? "success.main" : "error.main") : "text.secondary", fontWeight: delta ? 600 : 400 }}>
          {delta ? `${delta.up === null ? "→" : delta.up ? "↗" : "↘"} ${delta.text}` : sub}
        </Typography>
      )}
    </Box>
  );
  return (
    <Card
      data-testid={testId}
      data-alarm={tone === "bad" || undefined}
      sx={(t) => ({
        display: "flex",
        minWidth: 0,
        ...(tone === "bad" && { bgcolor: alpha(t.palette.error.main, 0.09), borderColor: t.palette.error.main, ...t.applyStyles("dark", { bgcolor: alpha(t.palette.error.main, 0.2) }) }),
        ...(open && { borderColor: t.palette.primary.main, boxShadow: `0 0 0 2px ${alpha(t.palette.primary.main, 0.35)}` }),
      })}
    >
      {onClick ? (
        <ButtonBase onClick={onClick} aria-expanded={open} sx={{ flex: 1, alignItems: "stretch", borderRadius: "inherit" }}>
          {inner}
        </ButtonBase>
      ) : (
        inner
      )}
    </Card>
  );
}

/** Tiles two across on a phone, four on a desktop. */
export const TILE_GRID = {
  display: "grid",
  gap: { xs: 1.25, lg: 2 },
  gridTemplateColumns: { xs: "repeat(2, minmax(0, 1fr))", md: "repeat(4, minmax(0, 1fr))" },
} as const;

// ------------------------------------------------------------------ columns

/**
 * Columns over time: one or two series side by side per period, a 2 px gap
 * between them. Hovering (or tapping) a period shows its values.
 */
export function ColumnChart({
  data,
  series,
  height = 190,
}: {
  data: Array<{ label: string; values: number[] }>;
  series: string[];
  height?: number;
}) {
  const theme = useTheme();
  const [ref, w] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(0, ...data.flatMap((d) => d.values));
  const ys = ticks(max);
  const top = ys[ys.length - 1] || 1;
  const left = 28;
  const bottom = 22;
  const plotW = Math.max(0, w - left);
  const plotH = height - bottom - 6;
  const band = data.length ? plotW / data.length : 0;
  const bar = Math.max(3, Math.min(24, (band * 0.62 - 2 * (series.length - 1)) / series.length));
  const group = bar * series.length + 2 * (series.length - 1);
  const y = (v: number) => 6 + plotH - (v / top) * plotH;
  const grid = theme.palette.divider;
  const muted = theme.palette.text.secondary;
  // Label every column when there's room; otherwise every other one.
  const every = band < 34 ? Math.ceil(34 / band) : 1;

  return (
    <Box ref={ref} sx={{ position: "relative", width: "100%" }} onPointerLeave={() => setHover(null)}>
      {w > 0 && (
        <svg width={w} height={height} role="img" aria-label={series.map((s) => TR(s)).join(", ")} style={{ display: "block", overflow: "visible" }}>
          {ys.map((v) => (
            <g key={v}>
              <line x1={left} x2={w} y1={y(v)} y2={y(v)} stroke={grid} strokeWidth={1} />
              <text x={left - 6} y={y(v) + 4} textAnchor="end" fontSize={11} fill={muted} style={{ fontVariantNumeric: "tabular-nums" }}>
                {num(v)}
              </text>
            </g>
          ))}
          {data.map((d, i) => {
            const x0 = left + i * band + (band - group) / 2;
            return (
              <g key={d.label}>
                {hover === i && <rect x={left + i * band} y={6} width={band} height={plotH} fill={alpha(theme.palette.text.primary, 0.05)} />}
                {d.values.map((v, s) => {
                  const h = (v / top) * plotH;
                  const x = x0 + s * (bar + 2);
                  const r = Math.min(4, h, bar / 2);
                  return v > 0 ? (
                    <path key={s} d={`M${x},${y(0)} v${-(h - r)} q0,${-r} ${r},${-r} h${bar - 2 * r} q${r},0 ${r},${r} v${h - r} z`} fill={seriesColor(theme, s)} />
                  ) : null;
                })}
                {i % every === 0 && (
                  <text x={left + i * band + band / 2} y={height - 6} textAnchor="middle" fontSize={11} fill={muted}>
                    {d.label}
                  </text>
                )}
                <rect
                  x={left + i * band}
                  y={0}
                  width={band}
                  height={height}
                  fill="transparent"
                  tabIndex={0}
                  aria-label={`${d.label}: ${d.values.map((v, s) => `${TR(series[s])} ${v}`).join(", ")}`}
                  onPointerEnter={() => setHover(i)}
                  onFocus={() => setHover(i)}
                  onBlur={() => setHover(null)}
                  style={{ outline: "none", cursor: "default" }}
                />
              </g>
            );
          })}
        </svg>
      )}
      {hover !== null && data[hover] && (
        <ChartTip x={left + hover * band + band / 2} width={w}>
          <Typography variant="caption" sx={{ color: "text.secondary", display: "block" }}>
            {data[hover].label}
          </Typography>
          {data[hover].values.map((v, s) => (
            <Stack key={s} direction="row" sx={{ alignItems: "center", gap: 0.75 }}>
              <Box sx={{ width: 10, height: 2, bgcolor: seriesColor(theme, s) }} />
              <Typography sx={{ fontWeight: 700, fontSize: 13.5 }}>{num(v)}</Typography>
              <Typography variant="caption" sx={{ color: "text.secondary" }}>
                {TR(series[s])}
              </Typography>
            </Stack>
          ))}
        </ChartTip>
      )}
    </Box>
  );
}

function ChartTip({ x, width, children }: { x: number; width: number; children: ReactNode }) {
  const left = Math.min(Math.max(0, x - 70), Math.max(0, width - 150));
  return (
    <Box
      role="status"
      sx={(t) => ({
        position: "absolute",
        top: -8,
        left,
        minWidth: 120,
        maxWidth: 180,
        px: 1.25,
        py: 0.75,
        borderRadius: `${DESIGN.radius.field}px`,
        bgcolor: "background.paper",
        border: 1,
        borderColor: "divider",
        boxShadow: `0 10px 30px -12px ${alpha(t.palette.common.black, 0.4)}`,
        pointerEvents: "none",
        zIndex: 2,
      })}
    >
      {children}
    </Box>
  );
}

// ------------------------------------------------------------------ bars

/**
 * Horizontal bars, label on the left and value at the tip: reads well on a
 * phone and with long names. One series, one colour. Rows can open a list.
 */
export function BarList({
  rows,
  format = (v) => num(v),
  onPick,
  picked,
  emptyText = "Nothing yet in this period.",
  tone,
}: {
  rows: Array<{ key: string; label: string; value: number; note?: string }>;
  format?: (v: number) => string;
  onPick?: (key: string) => void;
  picked?: string | null;
  emptyText?: string;
  tone?: (t: Theme) => string;
}) {
  const max = Math.max(0, ...rows.map((r) => r.value));
  if (!rows.length || max === 0) {
    return (
      <Typography variant="body2" sx={{ color: "text.secondary" }}>
        {TR(emptyText)}
      </Typography>
    );
  }
  return (
    <Stack sx={{ gap: 0.25 }}>
      {rows.map((r) => {
        const body = (
          <Box sx={{ display: "grid", gridTemplateColumns: "minmax(0, 38%) minmax(0, 1fr) auto", alignItems: "center", gap: 1.25, py: 0.75, px: 0.75, width: "100%", textAlign: "left" }}>
            <Typography variant="body2" noWrap title={TR(r.label)} sx={{ color: "text.primary" }}>
              {TR(r.label)}
            </Typography>
            <Box sx={(t) => ({ height: 10, borderRadius: "0 4px 4px 0", bgcolor: alpha(t.palette.text.primary, 0.05), overflow: "hidden" })}>
              <Box sx={(t) => ({ height: "100%", width: `${(r.value / max) * 100}%`, minWidth: r.value > 0 ? 3 : 0, borderRadius: "0 4px 4px 0", bgcolor: tone ? tone(t) : seriesColor(t, 0) })} />
            </Box>
            <Typography variant="body2" sx={{ fontWeight: 600, fontVariantNumeric: "tabular-nums", minWidth: 36, textAlign: "right" }}>
              {format(r.value)}
              {r.note && (
                <Box component="span" sx={{ color: "text.secondary", fontWeight: 400, ml: 0.75, display: { xs: "none", sm: "inline" } }}>
                  {r.note}
                </Box>
              )}
            </Typography>
          </Box>
        );
        return onPick && r.value > 0 ? (
          <ButtonBase key={r.key} onClick={() => onPick(r.key)} aria-expanded={picked === r.key} sx={(t) => ({ borderRadius: `${DESIGN.radius.listItem}px`, bgcolor: picked === r.key ? alpha(t.palette.primary.main, 0.1) : "transparent", "&:hover": { bgcolor: alpha(t.palette.text.primary, 0.04) } })}>
            {body}
          </ButtonBase>
        ) : (
          <Box key={r.key}>{body}</Box>
        );
      })}
    </Stack>
  );
}

// ------------------------------------------------------------------ gauge

/** A ratio against 100%: a half ring, filled in the accent, the rest a lighter step of the same green. */
export function Gauge({ value, caption }: { value: number | null; caption: string }) {
  const theme = useTheme();
  const c = seriesColor(theme, 0);
  const r = 70;
  const len = Math.PI * r;
  const v = value ?? 0;
  return (
    <Stack sx={{ alignItems: "center" }}>
      <svg width={180} height={104} viewBox="0 0 180 104" role="img" aria-label={`${Math.round(v * 100)}%`}>
        <path d={`M20,92 A${r},${r} 0 0 1 160,92`} fill="none" stroke={alpha(c, 0.16)} strokeWidth={16} strokeLinecap="round" />
        {value !== null && v > 0 && (
          <path d={`M20,92 A${r},${r} 0 0 1 160,92`} fill="none" stroke={c} strokeWidth={16} strokeLinecap="round" strokeDasharray={`${len * v} ${len}`} />
        )}
        <text x={90} y={84} textAnchor="middle" fontSize={30} fontWeight={600} fill={theme.palette.text.primary} fontFamily="inherit">
          {value === null ? "—" : `${Math.round(v * 100)}%`}
        </text>
      </svg>
      <Typography variant="body2" sx={{ color: "text.secondary", textAlign: "center", mt: 0.5, maxWidth: 260 }}>
        {caption}
      </Typography>
    </Stack>
  );
}

// ------------------------------------------------------------------ heatmap

/** Counts by day and hour, darker for more (one hue). Each cell says its count on hover or focus. */
export function Heatmap({ days, hours, counts }: { days: string[]; hours: number[]; counts: number[][] }) {
  const theme = useTheme();
  const c = seriesColor(theme, 0);
  const max = Math.max(0, ...counts.flat());
  const [hover, setHover] = useState<{ d: number; h: number } | null>(null);
  const fill = (n: number) => (n === 0 ? alpha(theme.palette.text.primary, 0.05) : alpha(c, 0.18 + 0.82 * (n / (max || 1))));
  const hourLabel = (h: number) => `${h}:00`;
  return (
    <Box>
      <Box sx={{ display: "grid", gridTemplateColumns: `34px repeat(${hours.length}, minmax(0, 1fr))`, gap: "3px", alignItems: "center" }} onPointerLeave={() => setHover(null)}>
        {days.map((d, di) => (
          <Box key={d} sx={{ display: "contents" }}>
            <Typography variant="caption" sx={{ color: "text.secondary" }}>
              {TR(d)}
            </Typography>
            {hours.map((h, hi) => (
              <Box
                key={h}
                tabIndex={0}
                aria-label={T("{day} {hour}: {n} check-ins", { day: TR(d), hour: hourLabel(h), n: counts[di][hi] })}
                onPointerEnter={() => setHover({ d: di, h: hi })}
                onFocus={() => setHover({ d: di, h: hi })}
                sx={{ aspectRatio: "1", maxHeight: 26, borderRadius: "4px", bgcolor: fill(counts[di][hi]), outline: hover && hover.d === di && hover.h === hi ? `2px solid ${theme.palette.text.primary}` : "none", outlineOffset: -1 }}
              />
            ))}
          </Box>
        ))}
        <Box />
        {hours.map((h, hi) => (
          <Typography key={h} variant="caption" sx={{ color: "text.secondary", fontSize: 10, textAlign: "center", visibility: hi % 3 === 0 ? "visible" : "hidden" }}>
            {h}
          </Typography>
        ))}
      </Box>
      <Stack direction="row" sx={{ alignItems: "center", gap: 1, mt: 1.25, flexWrap: "wrap" }}>
        <Typography variant="caption" sx={{ color: "text.secondary", flex: 1, minWidth: 0 }}>
          {hover ? T("{day} {hour}: {n} check-ins", { day: TR(days[hover.d]), hour: hourLabel(hours[hover.h]), n: counts[hover.d][hover.h] }) : T("Hover or tap a square for its count.")}
        </Typography>
        <Typography variant="caption" sx={{ color: "text.secondary" }}>
          {T("Fewer")}
        </Typography>
        {[0, 0.25, 0.5, 0.75, 1].map((s) => (
          <Box key={s} sx={{ width: 14, height: 14, borderRadius: "3px", bgcolor: s === 0 ? alpha(theme.palette.text.primary, 0.05) : alpha(c, 0.18 + 0.82 * s) }} />
        ))}
        <Typography variant="caption" sx={{ color: "text.secondary" }}>
          {T("More")}
        </Typography>
      </Stack>
    </Box>
  );
}
