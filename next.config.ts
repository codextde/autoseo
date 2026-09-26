import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), geolocation=(), microphone=(self), payment=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  // Baseline CSP that doesn't interfere with Next.js inline bootstrapping.
  { key: "Content-Security-Policy", value: "frame-ancestors 'self'; base-uri 'self'; object-src 'none'" },
];

const nextConfig: NextConfig = {
  output: "standalone",
  turbopack: { root: __dirname },
  poweredByHeader: false,
  reactStrictMode: true,
  experimental: {
    authInterrupts: true,
    // Many files change concurrently during development; the persistent dev cache has proven fragile.
    turbopackFileSystemCacheForDev: false,
    serverActions: { bodySizeLimit: "25mb" },
  },
  serverExternalPackages: ["postgres", "nodemailer", "pptxgenjs"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          ...securityHeaders,
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
        ],
      },
      {
        // Public, embeddable assets (attribution snippet, agent installer)
        source: "/api/public/:path*",
        headers: [{ key: "Access-Control-Allow-Origin", value: "*" }],
      },
    ];
  },
};

export default nextConfig;
