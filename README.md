# Bitris AI System Status

This repository powers the public status portal at https://status.bitris.ai. Workflows check our production entry points, log response times, and publish the static site that reflects Bitris branding only.

## Monitored Surfaces

| Service | Endpoint | Purpose |
| --- | --- | --- |
| Bitris AI Platform | https://www.bitris.ai/api/status | Core API health & dependency rollups |
| Voice Services | https://www.bitris.ai/api/voice/status | Latency + availability for voice synthesis |

## Automation Cadence

| Workflow | Interval | Notes |
| --- | --- | --- |
| `uptime.yml` | */5 * * * * | Availability + incident tracking |
| `response-time.yml` | 0 */6 * * * | Latency sampling |
| `graphs.yml` | 0 0 * * * | Generate historical charts |
| `site.yml` | 0 1 * * * | Build & deploy static site |
| `summary.yml` | 0 0 * * * | Update repo summaries |

## Branding Assets

- `assets/theme.css`: matches Bitris web aesthetic (dark, electric accents)
- `assets/bitris-logo.svg` and `assets/bitris-icon.svg`: used for logo + favicon
- `.upptimerc.yml`: references only Bitris endpoints, copy, and assets

## Custom Graph Renderer

- `scripts/generate-bitris-graphs.mjs`: converts `history/summary.json` data into Bitris-branded SVG sparklines inside `graphs/bitris-*.svg`.
- `scripts/README.md`: usage details for running the renderer locally or inside GitHub Actions.
- Workflow integration: `Bitris Graphs Sync` now runs the script after the default Upptime step so the published site can reference bespoke visuals.

## Local Notes

1. Node 20+ (GitHub runners already satisfy this).
2. Edit `.upptimerc.yml` for new monitors/branding tweaks.
3. Run `Static Site CI` in Actions to redeploy immediately after config changes.

---
© 2025 Bitris AI. All monitoring data, branding, and copy remain internal—no external attribution or vendor disclosure anywhere on the portal.
