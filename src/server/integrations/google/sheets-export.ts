import "server-only";
import { GOOGLE_SCOPE, GoogleReconnectRequiredError, GoogleScopeMissingError, getGoogleOAuthStatus } from "./core";
import { findSheetsAccount, getAccountAccessToken } from "./accounts";
import { createSpreadsheetFromRows, type SheetCell } from "./sheets";
import { googleApiErrorMessage } from "./oauth";
import { IntegrationHttpError } from "../http";

export type SheetExportResult =
  | { status: "created"; url: string; rows: number; account: string | null }
  | { status: "connect_required"; reason: "no_account" | "reconnect" | "not_configured"; message: string };

/**
 * Creates a Google Sheet from table rows in the Drive of the Google account the current user linked
 * for exports (scope `drive.file`). Returns `connect_required` when no such account exists yet.
 */
export async function exportRowsToGoogleSheet(input: {
  workspaceId: string;
  userId: string;
  title: string;
  headers: string[];
  rows: SheetCell[][];
}): Promise<SheetExportResult> {
  const oauth = await getGoogleOAuthStatus();
  if (!oauth.configured) {
    return {
      status: "connect_required",
      reason: "not_configured",
      message: "Google OAuth is not configured on this instance. An admin can add it in Admin → Data Providers.",
    };
  }
  const account = await findSheetsAccount(input.workspaceId, input.userId);
  if (!account) {
    return { status: "connect_required", reason: "no_account", message: "Connect your Google account to export to Google Sheets." };
  }
  try {
    const token = await getAccountAccessToken(account.id, { workspaceId: input.workspaceId, scope: GOOGLE_SCOPE.sheets });
    const res = await createSpreadsheetFromRows(token, { title: input.title, headers: input.headers, rows: input.rows });
    return { status: "created", url: res.url, rows: res.rows, account: account.email };
  } catch (err) {
    if (err instanceof GoogleReconnectRequiredError || err instanceof GoogleScopeMissingError) {
      return { status: "connect_required", reason: "reconnect", message: err.message };
    }
    if (err instanceof IntegrationHttpError && err.status === 401) {
      return { status: "connect_required", reason: "reconnect", message: `Google rejected the access of ${account.email ?? "your account"} — reconnect it.` };
    }
    throw new Error(googleApiErrorMessage(err, "sheets"));
  }
}
