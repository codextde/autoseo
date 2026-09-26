import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { site } from "@/lib/site";

const fontDir = join(process.cwd(), "src/components/marketing/og");

/** Shared 1200×630 social card: dark brand background, logo, headline and the three offers. */
export async function renderOgImage({ title, eyebrow }: { title: string; eyebrow?: string }) {
  const [regular, semibold] = await Promise.all([
    readFile(join(fontDir, "Geist-Regular.ttf")),
    readFile(join(fontDir, "Geist-SemiBold.ttf")),
  ]);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "72px 80px",
          color: "#ffffff",
          fontFamily: "Geist",
          backgroundColor: "#141413",
          backgroundImage:
            "radial-gradient(circle at 88% 0%, rgba(34,197,94,0.32), transparent 45%), radial-gradient(circle at 0% 100%, rgba(59,130,246,0.14), transparent 40%)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
            <rect width="64" height="64" rx="16" fill="#1f1f1d" stroke="rgba(255,255,255,0.18)" strokeWidth="2" />
            <path d="M18 44 L29 20 h6 L46 44" stroke="#fff" strokeWidth="5.5" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M24 35 h16" stroke="#22c55e" strokeWidth="5.5" strokeLinecap="round" />
            <circle cx="46" cy="18" r="4" fill="#22c55e" />
          </svg>
          <div style={{ fontSize: 36, fontWeight: 600, letterSpacing: -0.5 }}>{site.name}</div>
          {eyebrow && (
            <div
              style={{
                marginLeft: 12,
                padding: "8px 18px",
                borderRadius: 999,
                border: "1px solid rgba(255,255,255,0.18)",
                fontSize: 22,
                color: "rgba(255,255,255,0.8)",
              }}
            >
              {eyebrow}
            </div>
          )}
        </div>

        <div
          style={{
            display: "flex",
            fontSize: title.length > 48 ? 64 : 76,
            fontWeight: 600,
            lineHeight: 1.08,
            letterSpacing: -2,
            maxWidth: 1000,
          }}
        >
          {title}
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", gap: 14 }}>
            {["Open source", "Self-host free", `Cloud $${site.priceMonthlyUsd}/mo`].map((label, i) => (
              <div
                key={label}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "12px 22px",
                  borderRadius: 999,
                  fontSize: 26,
                  backgroundColor: i === 2 ? "#22c55e" : "rgba(255,255,255,0.08)",
                  color: i === 2 ? "#0b2a16" : "#ffffff",
                  fontWeight: i === 2 ? 600 : 400,
                }}
              >
                {label}
              </div>
            ))}
          </div>
          <div style={{ fontSize: 26, color: "rgba(255,255,255,0.6)" }}>{site.host}</div>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
      fonts: [
        { name: "Geist", data: regular, weight: 400, style: "normal" },
        { name: "Geist", data: semibold, weight: 600, style: "normal" },
      ],
    },
  );
}
