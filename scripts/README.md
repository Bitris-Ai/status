# Bitris Graph Rendering Scripts

This folder contains tooling for generating bespoke Bitris-branded availability graphs. The current prototype reads the Upptime-generated `history/summary.json` file and emits SVG cards into `graphs/` so the public status page can display visuals that match our branding.

## Scripts

| Script | Description |
| --- | --- |
| `generate-bitris-graphs.mjs` | Reads the latest summary data and renders 30-day uptime sparklines for every monitored service. |

### Usage

```bash
cd status
node scripts/generate-bitris-graphs.mjs
```

The command regenerates `graphs/bitris-<slug>.svg` files. Because the script only depends on built-in Node modules, no additional packages are required. GitHub-hosted runners already ship with Node 20+, so the workflow integration is seamless.

### Integration Notes

1. The script expects `history/summary.json` to exist. Running `Bitris Uptime Sweep` and `Bitris Latency Audit` prior to the graph workflow guarantees fresh data.
2. The SVG dimensions (360×140) and palette align with `assets/theme.css`. Adjust the script to change typography, gradients, or lookback windows.
3. After generation, point the status site (or custom components) to the `bitris-*.svg` files instead of the stock PNGs to remove any lingering template visuals.
