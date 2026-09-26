"use client";

import { useEffect } from "react";
import Link from "next/link";
import "./globals.css";

/**
 * Last-resort boundary (errors in the root layout). Renders its own document, so it avoids app
 * providers and uses inline fallbacks in case the stylesheet failed to load.
 */
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <html lang="en">
      <body
        className="min-h-dvh bg-background font-sans text-foreground antialiased"
        style={{ margin: 0, fontFamily: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" }}
      >
        <title>Something went wrong</title>
        <div
          className="flex min-h-dvh items-center justify-center px-5"
          style={{ display: "flex", minHeight: "100dvh", alignItems: "center", justifyContent: "center", padding: "0 20px" }}
        >
          <div className="w-full max-w-md text-center" style={{ maxWidth: 440, textAlign: "center" }}>
            <div
              aria-hidden
              className="mx-auto mb-5 flex size-12 items-center justify-center rounded-2xl bg-destructive/10 text-destructive"
              style={{ fontSize: 22 }}
            >
              !
            </div>
            <h1 className="text-2xl font-semibold tracking-tight" style={{ fontSize: 24, fontWeight: 600, margin: 0 }}>
              Something went wrong
            </h1>
            <p className="mt-2 text-sm text-muted-foreground" style={{ marginTop: 8, opacity: 0.7, lineHeight: 1.6 }}>
              The application hit an unexpected error. Try again, or reload the page in a moment.
            </p>
            <div style={{ marginTop: 28, display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={() => retry()}
                className="h-10 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground"
                style={{ height: 40, padding: "0 16px", borderRadius: 10, cursor: "pointer" }}
              >
                Try again
              </button>
              <Link
                href="/"
                className="inline-flex h-10 items-center rounded-lg border px-4 text-sm font-medium"
                style={{ height: 40, padding: "0 16px", borderRadius: 10, display: "inline-flex", alignItems: "center" }}
              >
                Go to dashboard
              </Link>
            </div>
            {error.digest && (
              <p className="mt-8 font-mono text-xs text-muted-foreground" style={{ marginTop: 32, fontSize: 12, opacity: 0.6 }}>
                Reference {error.digest}
              </p>
            )}
          </div>
        </div>
      </body>
    </html>
  );
}
