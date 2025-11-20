import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SUMMARY_PATH = resolve(__dirname, "..", "history", "summary.json");
const OUTPUT_DIR = resolve(__dirname, "..", "graphs");
const LOOKBACK_DAYS = 30;
const MINUTES_PER_DAY = 24 * 60;

function parseSummary() {
  const raw = readFileSync(SUMMARY_PATH, "utf8");
  const data = JSON.parse(raw);
  if (!Array.isArray(data)) {
    throw new Error("summary.json must contain an array of service objects");
  }
  return data;
}

function buildDailySeries(service) {
  const series = [];
  const today = new Date();
  for (let i = LOOKBACK_DAYS - 1; i >= 0; i -= 1) {
    const day = new Date(today);
    day.setUTCHours(0, 0, 0, 0);
    day.setUTCDate(day.getUTCDate() - i);
    const key = day.toISOString().slice(0, 10);
    const minutesDown = service.dailyMinutesDown?.[key] ?? 0;
    const uptimeRatio = Math.max(
      0,
      Math.min(1, 1 - minutesDown / MINUTES_PER_DAY)
    );
    series.push({ key, uptimeRatio });
  }
  return series;
}

function seriesToSvg({ name, slug }, series) {
  const width = 360;
  const height = 140;
  const padding = 24;
  const chartWidth = width - padding * 2;
  const chartHeight = height - padding * 2;
  const lastPoint = series[series.length - 1];

  const points = series
    .map((point, index) => {
      const x = padding + (chartWidth * index) / (series.length - 1);
      const y = padding + (1 - point.uptimeRatio) * chartHeight;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");

  const gradientStops = [
    { offset: 0, color: "#24ddb6", opacity: 0.35 },
    { offset: 1, color: "#4f63ff", opacity: 0.05 },
  ]
    .map(
      ({ offset, color, opacity }) =>
        `<stop offset="${offset * 100}%" stop-color="${color}" stop-opacity="${opacity}" />`
    )
    .join("");

  const areaPath = `M ${points} L ${
    padding + chartWidth
  },${height - padding} L ${padding},${height - padding} Z`;

  const latestPercent = (lastPoint.uptimeRatio * 100).toFixed(2);
  const latestLabel = `${latestPercent}% avg availability`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="gradient-${slug}" x1="0%" y1="0%" x2="0%" y2="100%">
      ${gradientStops}
    </linearGradient>
  </defs>
  <rect width="${width}" height="${height}" rx="18" fill="#0a0f1c" stroke="#1f2a44" stroke-width="2" />
  <text x="${padding}" y="32" fill="#9fd1ff" font-family="'Segoe UI',sans-serif" font-size="14" font-weight="500">${name}</text>
  <text x="${padding}" y="52" fill="#ffffff" font-family="'Segoe UI',sans-serif" font-size="20" font-weight="600">${latestLabel}</text>
  <polyline points="${points}" fill="none" stroke="#6ea8ff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
  <path d="${areaPath}" fill="url(#gradient-${slug})" stroke="none" />
  <circle cx="${padding + chartWidth}" cy="${padding + (1 - lastPoint.uptimeRatio) * chartHeight}" r="5" fill="#ffffff" stroke="#6ea8ff" stroke-width="3" />
</svg>`;
}

function ensureOutputDir() {
  mkdirSync(OUTPUT_DIR, { recursive: true });
}

function main() {
  ensureOutputDir();
  const services = parseSummary();
  services.forEach((service) => {
    const slug = service.slug || service.name.toLowerCase().replace(/\s+/g, "-");
    const series = buildDailySeries(service);
    const svg = seriesToSvg({ name: service.name, slug }, series);
    const outputPath = join(OUTPUT_DIR, `bitris-${slug}.svg`);
    writeFileSync(outputPath, svg, "utf8");
    console.log(`Generated ${outputPath}`);
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
