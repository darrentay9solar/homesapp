"use client";

import ArrowDownwardRoundedIcon from "@mui/icons-material/ArrowDownwardRounded";
import ArrowUpwardRoundedIcon from "@mui/icons-material/ArrowUpwardRounded";
import FileDownloadRoundedIcon from "@mui/icons-material/FileDownloadRounded";
import FilterAltOffRoundedIcon from "@mui/icons-material/FilterAltOffRounded";
import FilterAltRoundedIcon from "@mui/icons-material/FilterAltRounded";
import FilterListRoundedIcon from "@mui/icons-material/FilterListRounded";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import ButtonBase from "@mui/material/ButtonBase";
import Card from "@mui/material/Card";
import Checkbox from "@mui/material/Checkbox";
import Divider from "@mui/material/Divider";
import FormControlLabel from "@mui/material/FormControlLabel";
import Popover from "@mui/material/Popover";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { type ReactNode, useMemo, useState } from "react";

import { d2s } from "@/components/ui";
import { ApiError, useDownload } from "@/lib/client/api";
import { useApp } from "@/lib/client/app-state";
import { DESIGN } from "@/lib/client/design";
import { T, TR } from "@/lib/client/i18n";
import { activeCount, applyTable, BLANK, type Col, type ColFilter, cellText, type Filters, isActive, sheetOf, type Sort, valuesFor } from "@/lib/client/table";

/** A column as the table shows it: the filterable value (Col), and optionally how its cell looks. */
export type TableCol<R> = Col<R> & { show?: (r: R) => ReactNode; width?: number };

const SHOWN = 300; // rows drawn at once; Download always has every kept row

/**
 * A list as a table with Excel's filters: each column's heading opens sort
 * (either way), "contains", from/to for numbers and dates, and a tick list of
 * its values. The filters combine; what's left is what Download (Excel)
 * gives. The table scrolls sideways inside its card; the page never does.
 * Logic in lib/client/table.ts.
 */
export function DataTable<R>({
  rows,
  cols,
  rowKey,
  onOpen,
  exportAs,
  title,
  testId,
}: {
  rows: R[];
  cols: TableCol<R>[];
  rowKey: (r: R) => string | number;
  onOpen?: (r: R) => void;
  /** What Download names the workbook and its sheet, and records in the audit log ("projects", "maintenance"...). */
  exportAs: { what: string; title: string };
  /** A name for the table in its toolbar (English; translated here). */
  title?: string;
  testId?: string;
}) {
  const [filters, setFilters] = useState<Filters>({});
  const [sort, setSort] = useState<Sort>(null);
  const [menu, setMenu] = useState<{ key: string; el: HTMLElement } | null>(null);
  const [more, setMore] = useState(SHOWN);
  const kept = useMemo(() => applyTable(rows, cols, filters, sort), [rows, cols, filters, sort]);
  const on = activeCount(filters);
  const download = useDownload();
  const { toast } = useApp();
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      const sheet = sheetOf(kept, cols);
      await download("/export/table.xlsx", `${exportAs.title}.xlsx`, { what: exportAs.what, title: exportAs.title, ...sheet });
      toast(T("Downloaded. Open it in Excel."));
    } catch (e) {
      toast(e instanceof ApiError ? e.message : T("Something went wrong. Please try again."), "bad");
    } finally {
      setBusy(false);
    }
  }

  const col = menu ? cols.find((c) => c.key === menu.key) : undefined;
  return (
    <Card sx={{ mt: 2 }} data-testid={testId}>
      <Stack direction="row" sx={{ alignItems: "center", gap: 1, px: 2, py: 1.25, flexWrap: "wrap" }}>
        {title && <Typography sx={{ fontWeight: 600 }}>{TR(title)}</Typography>}
        <Typography variant="body2" sx={{ color: "text.secondary", flex: "1 1 auto" }} data-testid="table-count">
          {kept.length === rows.length ? T(rows.length === 1 ? "1 row" : "{n} rows", { n: rows.length }) : T("{n} of {total} rows", { n: kept.length, total: rows.length })}
        </Typography>
        {on > 0 && (
          <Button size="small" startIcon={<FilterAltOffRoundedIcon />} onClick={() => setFilters({})} data-testid="table-clear">
            {T(on === 1 ? "Clear 1 filter" : "Clear {n} filters", { n: on })}
          </Button>
        )}
        <Button size="small" variant="outlined" startIcon={<FileDownloadRoundedIcon />} disabled={busy || kept.length === 0} onClick={() => void save()} data-testid="table-download">
          {T("Download (Excel)")}
        </Button>
      </Stack>
      <Divider />
      <Box sx={{ overflowX: "auto", maxWidth: "100%" }}>
        <Table size="small" stickyHeader sx={{ minWidth: Math.max(640, cols.reduce((n, c) => n + (c.width ?? 140), 0)) }}>
          <TableHead>
            <TableRow>
              {cols.map((c) => {
                const filtered = isActive(filters[c.key]);
                const sorted = sort?.key === c.key ? sort.dir : null;
                return (
                  <TableCell key={c.key} sx={{ whiteSpace: "nowrap", fontWeight: 600, width: c.width, bgcolor: "background.paper" }}>
                    <ButtonBase
                      onClick={(e) => setMenu({ key: c.key, el: e.currentTarget })}
                      aria-label={T("Sort and filter {column}", { column: TR(c.label) })}
                      data-testid={`col-${c.key}`}
                      sx={{ gap: 0.5, fontFamily: "inherit", fontWeight: 600, fontSize: 13, color: filtered ? "primary.main" : "text.primary", borderRadius: `${DESIGN.radius.field}px`, px: 0.5, py: 0.25 }}
                    >
                      {TR(c.label)}
                      {sorted === "asc" && <ArrowUpwardRoundedIcon sx={{ fontSize: 15 }} />}
                      {sorted === "desc" && <ArrowDownwardRoundedIcon sx={{ fontSize: 15 }} />}
                      {filtered ? <FilterAltRoundedIcon sx={{ fontSize: 16 }} /> : <FilterListRoundedIcon sx={{ fontSize: 16, opacity: 0.45 }} />}
                    </ButtonBase>
                  </TableCell>
                );
              })}
            </TableRow>
          </TableHead>
          <TableBody>
            {kept.slice(0, more).map((r) => (
              <TableRow key={rowKey(r)} hover={Boolean(onOpen)} onClick={onOpen ? () => onOpen(r) : undefined} sx={{ cursor: onOpen ? "pointer" : undefined }} data-testid="table-row">
                {cols.map((c) => (
                  <TableCell key={c.key} sx={{ whiteSpace: c.type === "text" || !c.type ? "normal" : "nowrap", fontSize: 13.5, maxWidth: 320 }}>
                    {c.show ? c.show(r) : plain(c, c.get(r))}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Box>
      {kept.length === 0 && (
        <Typography variant="body2" sx={{ color: "text.secondary", p: 3, textAlign: "center" }}>
          {T("No rows match these filters.")}
        </Typography>
      )}
      {kept.length > more && (
        <Stack sx={{ alignItems: "center", py: 1.5 }}>
          <Button onClick={() => setMore((n) => n + SHOWN)}>{T("Show {n} more", { n: Math.min(SHOWN, kept.length - more) })}</Button>
        </Stack>
      )}
      {menu && col && (
        <FilterMenu
          anchor={menu.el}
          col={col}
          values={valuesFor(rows, cols, filters, col.key)}
          filter={filters[col.key] ?? {}}
          sort={sort?.key === col.key ? sort.dir : null}
          onSort={(dir) => {
            setSort(dir ? { key: col.key, dir } : null);
            setMenu(null);
          }}
          onApply={(f) => {
            setFilters((x) => ({ ...x, [col.key]: f }));
            setMore(SHOWN);
            setMenu(null);
          }}
          onClose={() => setMenu(null)}
        />
      )}
    </Card>
  );
}

function plain<R>(c: Col<R>, v: ReturnType<Col<R>["get"]>): ReactNode {
  if (v === null || v === undefined || v === "") return <Box component="span" sx={{ color: "text.disabled" }}>—</Box>;
  if (c.type === "date") return d2s(cellText(c, v));
  return String(v);
}

/** One column's menu, as Excel's: sort, then the filters, applied together with OK. */
function FilterMenu<R>({
  anchor,
  col,
  values,
  filter,
  sort,
  onSort,
  onApply,
  onClose,
}: {
  anchor: HTMLElement;
  col: Col<R>;
  values: string[];
  filter: ColFilter;
  sort: "asc" | "desc" | null;
  onSort: (dir: "asc" | "desc" | null) => void;
  onApply: (f: ColFilter) => void;
  onClose: () => void;
}) {
  const [contains, setContains] = useState(filter.contains ?? "");
  const [min, setMin] = useState(filter.min ?? "");
  const [max, setMax] = useState(filter.max ?? "");
  const [ticked, setTicked] = useState<Set<string>>(() => new Set(filter.values ?? values));
  const [find, setFind] = useState("");
  const listed = values.filter((v) => v.toLowerCase().includes(find.trim().toLowerCase()));
  const all = values.every((v) => ticked.has(v));
  const type = col.type ?? "text";
  const [up, down] = type === "number" ? ["Smallest to largest", "Largest to smallest"] : type === "date" ? ["Oldest to newest", "Newest to oldest"] : ["Sort A to Z", "Sort Z to A"];
  const show = (v: string) => (v === BLANK ? T("(Blanks)") : type === "date" ? d2s(v) : v);

  return (
    <Popover open anchorEl={anchor} onClose={onClose} anchorOrigin={{ vertical: "bottom", horizontal: "left" }} slotProps={{ paper: { sx: { width: 300, maxWidth: "calc(100vw - 32px)" } } }}>
      <Stack sx={{ p: 1.5, gap: 1.25 }} data-testid="filter-menu">
        <Stack direction="row" sx={{ gap: 1 }}>
          <Button size="small" variant={sort === "asc" ? "contained" : "outlined"} startIcon={<ArrowUpwardRoundedIcon />} onClick={() => onSort(sort === "asc" ? null : "asc")} sx={{ flex: 1 }}>
            {T(up)}
          </Button>
          <Button size="small" variant={sort === "desc" ? "contained" : "outlined"} startIcon={<ArrowDownwardRoundedIcon />} onClick={() => onSort(sort === "desc" ? null : "desc")} sx={{ flex: 1 }}>
            {T(down)}
          </Button>
        </Stack>
        <Divider />
        {type === "text" ? (
          <TextField size="small" label={T("Contains")} value={contains} onChange={(e) => setContains(e.target.value)} />
        ) : (
          <Stack direction="row" sx={{ gap: 1 }}>
            <TextField size="small" type={type === "date" ? "date" : "number"} label={T("From")} value={min} onChange={(e) => setMin(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} sx={{ flex: 1 }} />
            <TextField size="small" type={type === "date" ? "date" : "number"} label={T("To")} value={max} onChange={(e) => setMax(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} sx={{ flex: 1 }} />
          </Stack>
        )}
        {values.length > 8 && <TextField size="small" placeholder={T("Search the values")} value={find} onChange={(e) => setFind(e.target.value)} />}
        <Box sx={{ maxHeight: 220, overflowY: "auto", border: 1, borderColor: "divider", borderRadius: `${DESIGN.radius.field}px`, px: 1 }}>
          <FormControlLabel
            control={<Checkbox size="small" checked={all} indeterminate={!all && ticked.size > 0} onChange={() => setTicked(all ? new Set() : new Set(values))} />}
            label={<Typography variant="body2" sx={{ fontWeight: 600 }}>{T("(Select all)")}</Typography>}
            sx={{ display: "flex", m: 0 }}
          />
          {listed.map((v) => (
            <FormControlLabel
              key={v}
              control={
                <Checkbox
                  size="small"
                  checked={ticked.has(v)}
                  onChange={() =>
                    setTicked((s) => {
                      const n = new Set(s);
                      if (n.has(v)) n.delete(v);
                      else n.add(v);
                      return n;
                    })
                  }
                />
              }
              label={<Typography variant="body2" noWrap>{show(v)}</Typography>}
              sx={{ display: "flex", m: 0, minWidth: 0 }}
            />
          ))}
        </Box>
        <Stack direction="row" sx={{ gap: 1, justifyContent: "flex-end" }}>
          <Button size="small" onClick={() => onApply({})}>
            {T("Clear")}
          </Button>
          <Button
            size="small"
            variant="contained"
            data-testid="filter-ok"
            onClick={() =>
              onApply({
                // Every value ticked is no filter at all, so a value added later still shows.
                values: all ? undefined : [...ticked],
                contains: type === "text" ? contains : undefined,
                min: type === "text" ? undefined : min,
                max: type === "text" ? undefined : max,
              })
            }
          >
            {T("OK")}
          </Button>
        </Stack>
      </Stack>
    </Popover>
  );
}
