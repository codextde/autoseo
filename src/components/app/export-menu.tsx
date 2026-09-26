"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, Download, ExternalLink, FileSpreadsheet, Loader2, Sheet } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useOptionalShell } from "@/components/app/shell-context";
import { buildCsv, buildHtmlTable, buildTsv } from "@/server/seo/lib/csv";
import { exportRowsToGoogleSheetAction } from "@/features/integrations/actions";
import { parseCsv, parseCsvNumbers } from "@/lib/csv-parse";

export { parseCsv };

export type ExportCell = string | number | boolean | null | undefined;
export type ExportTable = { headers: string[]; rows: ExportCell[][] };

const MAX_SHEET_CELLS = 5_000_000;

/** Triggers a client-side file download (same behaviour as the SEO export helpers). */
export function downloadTextFile(filename: string, content: string, type = "text/csv;charset=utf-8") {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Fetches a CSV export route and returns it as a table (header row + data rows). */
export async function fetchCsvTable(href: string): Promise<ExportTable> {
  const res = await fetch(href, { cache: "no-store" });
  if (!res.ok) throw new Error(`Export failed (HTTP ${res.status})`);
  const [headers = [], ...rows] = parseCsv(await res.text());
  return { headers, rows: parseCsvNumbers(rows) };
}

async function copyForSheets(data: ExportTable): Promise<boolean> {
  const tsv = buildTsv(data.headers, data.rows);
  try {
    if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/plain": new Blob([tsv], { type: "text/plain" }),
          "text/html": new Blob([buildHtmlTable(data.headers, data.rows)], { type: "text/html" }),
        }),
      ]);
    } else await navigator.clipboard.writeText(tsv);
    return true;
  } catch {
    toast.error("Could not copy to the clipboard");
    return false;
  }
}

type ConnectState = { reason: "no_account" | "reconnect" | "not_configured"; message: string };

/**
 * "Export to Google Sheets": creates a real spreadsheet via the Sheets API in the Drive of the
 * user's linked Google account. When no account/scope is linked, a dialog offers a popup OAuth flow
 * (the page keeps its state and the export resumes automatically) or a clipboard fallback.
 */
export function useGoogleSheetsExport() {
  const shell = useOptionalShell();
  const projectId = shell?.currentProjectId ?? null;
  const [busy, setBusy] = useState(false);
  const [connect, setConnect] = useState<ConnectState | null>(null);
  const [copied, setCopied] = useState(false);
  const pending = useRef<{ title: string; data: ExportTable } | null>(null);
  const popupRef = useRef<Window | null>(null);

  const run = useCallback(
    async (title: string, data: ExportTable, target: Window | null) => {
      if (!projectId) return;
      setBusy(true);
      try {
        const res = await exportRowsToGoogleSheetAction({
          projectId,
          title,
          headers: data.headers.map(String),
          rows: data.rows.map((r) => r.map((c) => (c === undefined ? null : typeof c === "number" && !Number.isFinite(c) ? null : c))),
        });
        if (!res.ok) {
          target?.close();
          toast.error(res.error);
          return;
        }
        if (res.data.status === "connect_required") {
          target?.close();
          pending.current = { title, data };
          setConnect({ reason: res.data.reason, message: res.data.message });
          return;
        }
        const url = res.data.url;
        pending.current = null;
        setConnect(null);
        if (target && !target.closed) {
          target.location.href = url;
          toast.success(`Google Sheet created (${res.data.rows.toLocaleString("en-US")} rows).`);
        } else {
          toast.success("Google Sheet created", {
            action: { label: "Open", onClick: () => window.open(url, "_blank", "noopener,noreferrer") },
            duration: 15_000,
          });
        }
      } catch (err) {
        target?.close();
        toast.error(err instanceof Error ? err.message : "Export to Google Sheets failed");
      } finally {
        setBusy(false);
      }
    },
    [projectId],
  );

  /** Call from a click handler (a tab is opened synchronously so popup blockers allow it). */
  const exportToSheets = useCallback(
    async (title: string | (() => string), getData: () => ExportTable | Promise<ExportTable>) => {
      let target: Window | null = null;
      try {
        target = window.open("", "_blank");
        if (target) {
          target.opener = null;
          target.document.title = "Creating Google Sheet…";
          target.document.body.innerHTML =
            '<p style="font:14px system-ui,sans-serif;color:#555;padding:24px">Creating your Google Sheet…</p>';
        }
      } catch {
        target = null;
      }
      try {
        const data = await getData();
        if (!data.rows.length) {
          target?.close();
          toast.error("No data to export");
          return;
        }
        if ((data.rows.length + 1) * Math.max(1, data.headers.length) > MAX_SHEET_CELLS) {
          target?.close();
          toast.error("The table is too large for Google Sheets — download CSV instead.");
          return;
        }
        await run(typeof title === "function" ? title() : title, data, target);
      } catch (err) {
        target?.close();
        toast.error(err instanceof Error ? err.message : "Export failed");
      }
    },
    [run],
  );

  // OAuth popup → resume the pending export once the account is connected.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      const d = e.data as { type?: string; ok?: boolean; error?: string | null; message?: string | null } | null;
      if (!d || d.type !== "autoseo:google-oauth") return;
      popupRef.current = null;
      if (!d.ok) {
        toast.error(d.message || (d.error === "access_denied" ? "The Google connection was cancelled." : "The Google connection did not finish."));
        return;
      }
      const job = pending.current;
      setConnect(null);
      if (job) void run(job.title, job.data, null);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [run]);

  const openConnectPopup = () => {
    if (!projectId) return;
    const qs = new URLSearchParams({ projectId, product: "sheets", returnTo: "/api/oauth/google/popup-done" });
    const w = 520;
    const h = 680;
    const left = Math.max(0, window.screenX + (window.outerWidth - w) / 2);
    const top = Math.max(0, window.screenY + (window.outerHeight - h) / 2);
    popupRef.current = window.open(`/api/oauth/google/start?${qs}`, "autoseo-google-oauth", `width=${w},height=${h},left=${left},top=${top}`);
    if (!popupRef.current) toast.error("The popup was blocked — allow popups for this site and try again.");
  };

  const dialog = (
    <Dialog
      open={!!connect}
      onOpenChange={(v) => {
        if (!v) {
          setConnect(null);
          setCopied(false);
        }
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{copied ? "Table copied" : "Export to Google Sheets"}</DialogTitle>
          <DialogDescription>
            {copied
              ? "Open a new Google Sheet and paste (⌘/Ctrl + V) — columns and links are preserved."
              : connect?.reason === "not_configured"
                ? connect.message
                : `${connect?.message ?? ""} AutoSEO only gets access to spreadsheets it creates for you (Google Drive “drive.file” permission).`}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:justify-between">
          {copied ? (
            <Button asChild onClick={() => setConnect(null)}>
              <a href="https://sheets.new" target="_blank" rel="noopener noreferrer">
                Open Google Sheets <ExternalLink className="size-3.5" />
              </a>
            </Button>
          ) : (
            <>
              <Button
                variant="ghost"
                onClick={async () => {
                  const job = pending.current;
                  if (job && (await copyForSheets(job.data))) setCopied(true);
                }}
              >
                Copy table instead
              </Button>
              {connect?.reason !== "not_configured" && (
                <Button onClick={openConnectPopup} disabled={busy}>
                  {busy && <Loader2 className="size-3.5 animate-spin" />}
                  {connect?.reason === "reconnect" ? "Reconnect Google" : "Connect Google"}
                </Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  return { exportToSheets, busy, dialog, available: !!projectId };
}

/**
 * Export ▾ → "Download CSV" and "Google Sheets". `getData` may be async (e.g. fetch all rows).
 * With `csvHref` the CSV item downloads that server-generated file instead of building one.
 */
export function ExportMenu({
  filename,
  getData,
  title,
  csvHref,
  disabled,
  label = "Export",
  size = "sm",
  className,
  children,
}: {
  filename: string;
  getData: () => ExportTable | Promise<ExportTable>;
  /** Spreadsheet title (defaults to the filename). */
  title?: string;
  csvHref?: string;
  disabled?: boolean;
  label?: string;
  size?: "sm" | "default";
  className?: string;
  /** Extra menu items (rendered after a separator). */
  children?: React.ReactNode;
}) {
  const sheets = useGoogleSheetsExport();
  const [csvBusy, setCsvBusy] = useState(false);
  const downloadCsv = async () => {
    if (csvHref) {
      const a = document.createElement("a");
      a.href = csvHref;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
      return;
    }
    setCsvBusy(true);
    try {
      const d = await getData();
      if (!d.rows.length) {
        toast.error("No data to export");
        return;
      }
      downloadTextFile(`${filename}.csv`, buildCsv(d.headers, d.rows));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export failed");
    } finally {
      setCsvBusy(false);
    }
  };
  const busy = csvBusy || sheets.busy;
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size={size} className={className ?? "h-8 gap-1.5"} disabled={disabled || busy}>
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
            {label}
            <ChevronDown className="size-3 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem onSelect={() => void downloadCsv()}>
            <FileSpreadsheet /> Download CSV
          </DropdownMenuItem>
          {sheets.available && (
            <DropdownMenuItem onSelect={() => void sheets.exportToSheets(title ?? filename, getData)}>
              <Sheet /> Google Sheets
            </DropdownMenuItem>
          )}
          {children && (
            <>
              <DropdownMenuSeparator />
              {children}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {sheets.dialog}
    </>
  );
}
