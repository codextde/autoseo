"use client";

import type { DataBundle } from "../lib/bundle";
import type { ResolvedData } from "../lib/catalog";
import type { Deck } from "../lib/types";

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function loadImage(src: string): Promise<string | null> {
  try {
    const res = await fetch(src, { credentials: "same-origin" });
    if (!res.ok) return null;
    const blob = await res.blob();
    if (!blob.type.startsWith("image/")) return null;
    if (blob.type === "image/svg+xml") return svgToPng(await blob.text(), 1024, 1024);
    return await blobToDataUrl(blob);
  } catch {
    return null;
  }
}

/** Rasterizes SVG markup to a PNG data URL (PowerPoint/Keynote/Slides all read PNG). */
function svgToPng(svg: string, w: number, h: number): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const iw = img.naturalWidth || w;
      const ih = img.naturalHeight || h;
      const scale = Math.min(4, Math.max(w / iw, h / ih, 1));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(iw * scale);
      canvas.height = Math.round(ih * scale);
      const ctx2 = canvas.getContext("2d");
      if (!ctx2) return resolve(`data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`);
      ctx2.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/png"));
    };
    img.onerror = () => resolve(`data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`);
    img.src = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
  });
}

/** Builds the PPTX in the browser and triggers a download. */
export async function downloadPptx(opts: { deck: Deck; bundle: DataBundle | null; resolved?: ResolvedData | null; title: string; subtitle?: string | null; assetUrl: (id: string) => string }) {
  const [{ default: PptxGenJS }, { buildPptx, pptxFileName }] = await Promise.all([import("pptxgenjs"), import("../lib/pptx")]);
  const pptx = await buildPptx(
    PptxGenJS,
    opts.deck,
    { bundle: opts.bundle, resolved: opts.resolved ?? null, report: { title: opts.title, subtitle: opts.subtitle } },
    { loadImage, svgToImage: svgToPng, assetUrl: opts.assetUrl },
    { title: opts.title, company: opts.bundle?.agency.name ?? "" },
  );
  const blob = (await pptx.write({ outputType: "blob", compression: true })) as Blob;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = pptxFileName(opts.title);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
