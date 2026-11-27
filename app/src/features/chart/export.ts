/** Chart export (browser): standalone SVG with resolved theme colours, PNG via canvas. */
import { chartToSvg, DEFAULT_COLORS, type ChartColors, type ChartLayout, type SvgOptions } from '@/core/chart';
import { downloadFile, slugify } from '@/store/io';

/** The live theme tokens, resolved to colour values (so the file renders outside the app). */
export function readChartColors(): ChartColors {
  if (typeof document === 'undefined') return DEFAULT_COLORS;
  const cs = getComputedStyle(document.documentElement);
  const v = (name: string, fb: string) => cs.getPropertyValue(name).trim() || fb;
  const D = DEFAULT_COLORS;
  return {
    bg: v('--surface', D.bg), ink: v('--ink', D.ink), ink2: v('--ink-2', D.ink2), ink3: v('--ink-3', D.ink3),
    alt: v('--indigo', D.alt), band: v('--bg', D.band),
    flat: v('--shape-flat', D.flat), cup: v('--shape-cup', D.cup), ruffle: v('--shape-ruffle', D.ruffle),
    flatSoft: v('--shape-flat-soft', D.flatSoft), cupSoft: v('--shape-cup-soft', D.cupSoft), ruffleSoft: v('--shape-ruffle-soft', D.ruffleSoft),
  };
}

export function chartSvgString(layout: ChartLayout, opts: SvgOptions): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n${chartToSvg(layout, { colors: readChartColors(), ...opts })}\n`;
}

export function downloadChartSvg(layout: ChartLayout, opts: SvgOptions, title: string) {
  downloadFile({ name: `${slugify(title) || 'chart'}-chart.svg`, mime: 'image/svg+xml', content: chartSvgString(layout, opts) });
}

/** Rasterise the standalone SVG at `ratio`× (capped at 8192 px a side) and download a PNG. */
export async function downloadChartPng(layout: ChartLayout, opts: SvgOptions, title: string, ratio = 2.5): Promise<void> {
  const svg = chartSvgString(layout, opts);
  const w = Number(/width="(\d+)"/.exec(svg)?.[1] ?? 1000), h = Number(/height="(\d+)"/.exec(svg)?.[1] ?? 1000);
  const k = Math.min(ratio, 8192 / Math.max(w, h));
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.decoding = 'async';
    await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error('Could not render the chart image.')); img.src = url; });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(w * k); canvas.height = Math.round(h * k);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas is not available in this browser.');
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'));
    if (!blob) throw new Error('The browser could not encode the PNG.');
    const a = document.createElement('a');
    const purl = URL.createObjectURL(blob);
    a.href = purl; a.download = `${slugify(title) || 'chart'}-chart.png`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(purl), 1000);
  } finally {
    URL.revokeObjectURL(url);
  }
}
