"use client";

import { useState } from "react";
import { Braces, ChevronDown, Download, FileSpreadsheet, Sheet } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { Cell } from "@/server/seo/lib/csv";
import { buildCsv } from "@/server/seo/lib/csv";
import { copyTableForSheets, downloadFile } from "../../lib/client";
import { useGoogleSheetsExport } from "@/components/app/export-menu";

export type ExportData = { headers: string[]; rows: Cell[][]; filename: string; json?: unknown };

/**
 * Export ▾ → Google Sheets (creates a real spreadsheet via the Sheets API in the user's linked Google
 * account; clipboard + sheets.new as fallback), Export CSV, optional Excel (.xls) and Copy JSON.
 * `getData` may be async (e.g. "export all rows matching the filters").
 */
export function ExportMenu({
  getData,
  disabled,
  label = "Export",
  excel,
  json,
  extra,
  size = "sm",
}: {
  getData: () => ExportData | Promise<ExportData>;
  disabled?: boolean;
  label?: string;
  excel?: boolean;
  json?: boolean;
  extra?: React.ReactNode;
  size?: "sm" | "default";
}) {
  const [sheetsOpen, setSheetsOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const sheets = useGoogleSheetsExport();
  const exportToGoogleSheets = () => {
    let name = "export";
    void sheets.exportToSheets(
      () => `${name} — ${new Date().toISOString().slice(0, 10)}`,
      async () => {
        const d = await getData();
        name = d.filename;
        return { headers: d.headers, rows: d.rows };
      },
    );
  };
  const withData = async (fn: (d: ExportData) => void | Promise<void>) => {
    setBusy(true);
    try {
      const d = await getData();
      if (!d.rows.length) {
        toast.error("No data to export");
        return;
      }
      await fn(d);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export failed");
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size={size} className="h-8 gap-1.5" disabled={disabled || busy || sheets.busy}>
            <Download className="size-3.5" />
            {label}
            <ChevronDown className="size-3 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          {sheets.available ? (
            <DropdownMenuItem onSelect={exportToGoogleSheets}>
              <Sheet /> Google Sheets
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem
              onSelect={() =>
                withData(async (d) => {
                  if (await copyTableForSheets(d.headers, d.rows)) setSheetsOpen(true);
                })
              }
            >
              <Sheet /> Export to Sheets
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={() => withData((d) => downloadFile(`${d.filename}.csv`, buildCsv(d.headers, d.rows)))}>
            <FileSpreadsheet /> Export CSV
          </DropdownMenuItem>
          {excel && (
            <DropdownMenuItem onSelect={() => withData((d) => downloadFile(`${d.filename}.xls`, buildCsv(d.headers, d.rows), "application/vnd.ms-excel"))}>
              <FileSpreadsheet /> Download Excel
            </DropdownMenuItem>
          )}
          {json && (
            <DropdownMenuItem
              onSelect={() =>
                withData(async (d) => {
                  await navigator.clipboard.writeText(JSON.stringify(d.json ?? d.rows, null, 2));
                  toast.success("Copied data");
                })
              }
            >
              <Braces /> Copy data (JSON)
            </DropdownMenuItem>
          )}
          {extra && (
            <>
              <DropdownMenuSeparator />
              {extra}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <SheetsDialog open={sheetsOpen} onOpenChange={setSheetsOpen} />
      {sheets.dialog}
    </>
  );
}

export function SheetsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Table copied</DialogTitle>
          <DialogDescription>Open a new Google Sheet and paste (⌘/Ctrl + V) — columns and links are preserved.</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button asChild onClick={() => onOpenChange(false)}>
            <a href="https://sheets.new" target="_blank" rel="noopener noreferrer">
              Open Google Sheets
            </a>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
