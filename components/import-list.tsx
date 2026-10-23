"use client";

import AddPhotoAlternateOutlinedIcon from "@mui/icons-material/AddPhotoAlternateOutlined";
import CheckCircleRoundedIcon from "@mui/icons-material/CheckCircleRounded";
import UploadFileRoundedIcon from "@mui/icons-material/UploadFileRounded";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import FormControlLabel from "@mui/material/FormControlLabel";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import Typography from "@mui/material/Typography";
import { useRef, useState } from "react";

import { MDialog } from "@/components/m";
import { ApiError, useFetcher } from "@/lib/client/api";
import { useApp } from "@/lib/client/app-state";
import { DESIGN } from "@/lib/client/design";
import { T } from "@/lib/client/i18n";

type Result = {
  applied: boolean;
  listDate: string;
  clients: number;
  turnedOn: number;
  notTurnedOn: number;
  counts: { projectsAdded: number; projectsUpdated: number; systemsAdded: number; systemsUpdated: number; outputMonths: number; billingMonths: number; feedback: number; warranties: number; recordProjects: number };
  notes: string[];
};

/**
 * Projects → Import from Excel (superadmins): the company's project list, as
 * it's kept. First a check (what it would add and change, and anything that
 * stops it: a repeated postal code, address or project code above all);
 * then the import itself. Clients not turned on yet become projects with no
 * manager; turned-on ones go to Maintenance. Running it again updates rather
 * than duplicates.
 */
export function ImportListDialog({ onClose, onDone, onPhotos }: { onClose: () => void; onDone: () => Promise<void> | void; onPhotos?: () => void }) {
  const fetcher = useFetcher();
  const { toast } = useApp();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [flats, setFlats] = useState(false);
  const [check, setCheck] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(apply: boolean) {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const q = new URLSearchParams({ apply: apply ? "1" : "0", fileName: file.name, allowSharedPostal: flats ? "1" : "0" });
      const r = await fetcher<Result>(`/import/client-list?${q}`, { method: "POST", body: file, headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" } });
      if (apply) {
        toast(T("Imported: {a} projects added, {b} updated; {c} systems added, {d} updated.", { a: r.counts.projectsAdded, b: r.counts.projectsUpdated, c: r.counts.systemsAdded, d: r.counts.systemsUpdated }));
        await onDone();
        onClose();
      } else setCheck(r);
    } catch (e) {
      setCheck(null);
      setError(e instanceof ApiError ? e.message : T("Something went wrong. Please try again."));
    } finally {
      setBusy(false);
    }
  }

  const c = check?.counts;
  return (
    <MDialog title={T("Import from Excel")} heading={T("The project list, as you keep it")} subtitle={T("Clients not turned on yet become projects; turned-on ones go to Maintenance. It's checked first, and nothing is written until you import.")} onClose={onClose}>
      <Stack sx={{ gap: 2 }}>
        <Box sx={{ border: 2, borderStyle: "dashed", borderColor: "divider", borderRadius: `${DESIGN.radius.card}px`, p: 3, textAlign: "center" }}>
          <UploadFileRoundedIcon sx={{ fontSize: 40, color: "primary.main" }} />
          <Typography sx={{ fontWeight: 600 }}>{file ? file.name : T("Choose the list (.xlsx)")}</Typography>
          <Typography variant="caption" sx={{ color: "text.secondary", display: "block" }}>
            {T("Sheets: Clients List, Actual Solar Output, Billing Period, Feedback, Inverter Warranties (a Projects download has them all).")}
          </Typography>
          <Button onClick={() => input.current?.click()} sx={{ mt: 1 }} data-testid="import-choose">
            {file ? T("Choose another") : T("Choose file")}
          </Button>
          <input
            ref={input}
            type="file"
            hidden
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setCheck(null);
              setError(null);
            }}
            data-testid="import-file"
          />
        </Box>
        <FormControlLabel control={<Switch checked={flats} onChange={(e) => setFlats(e.target.checked)} />} label={<Typography variant="body2">{T("Allow clients sharing a postal code (a block of flats)")}</Typography>} />
        {error && <Alert severity="error">{error}</Alert>}
        {check && c && (
          <Alert severity="success" icon={<CheckCircleRoundedIcon />} data-testid="import-check">
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              {T("{n} clients: {a} turned on, {b} not yet.", { n: check.clients, a: check.turnedOn, b: check.notTurnedOn })}
            </Typography>
            <Typography variant="body2">{T("Projects: {a} to add, {b} to update.", { a: c.projectsAdded, b: c.projectsUpdated })}</Typography>
            <Typography variant="body2">{T("Maintenance systems: {a} to add, {b} to update.", { a: c.systemsAdded, b: c.systemsUpdated })}</Typography>
            {c.recordProjects > 0 && <Typography variant="body2">{T("Project records for imported systems: {n} to add, their empty fields flagged for their managers.", { n: c.recordProjects })}</Typography>}
            <Typography variant="body2">{T("Months of output {a}, billing months {b}, feedback {c}, inverter models {d}.", { a: c.outputMonths, b: c.billingMonths, c: c.feedback, d: c.warranties })}</Typography>
            {check.notes.length > 0 && (
              <Box component="ul" sx={{ m: 0, mt: 1, pl: 2.5 }}>
                {check.notes.slice(0, 12).map((n) => (
                  <Typography key={n} component="li" variant="caption">
                    {n}
                  </Typography>
                ))}
              </Box>
            )}
          </Alert>
        )}
        <Stack direction="row" sx={{ gap: 1 }}>
          <Button fullWidth size="large" variant={check ? "outlined" : "contained"} disabled={!file || busy} onClick={() => void run(false)} data-testid="import-run-check">
            {busy && !check ? T("Checking…") : T("Check")}
          </Button>
          <Button fullWidth size="large" variant="contained" disabled={!check || busy} onClick={() => void run(true)} data-testid="import-run">
            {busy && check ? T("Importing…") : T("Import")}
          </Button>
        </Stack>
        {onPhotos && (
          <Button variant="text" startIcon={<AddPhotoAlternateOutlinedIcon />} onClick={onPhotos} disabled={busy} sx={{ alignSelf: "center" }} data-testid="import-photos">
            {T("Import installed photos instead")}
          </Button>
        )}
      </Stack>
    </MDialog>
  );
}
