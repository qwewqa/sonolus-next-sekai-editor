# Sonolus Next SEKAI Editor

https://next-sekai-editor.sonolus.com

## Local preview

```sh
npm ci
npm run dev
```

The preview branch includes upstream editor 0.5.21 (`9b753b2`) and follows
`sonolus-next-sekai-engine` at `a338b98`. It supports quadratic timescale easing,
mixed timescale and scroll transitions, stage note masking, and stage elevation.

Place a skin package at `public/resource/skin.scp` and optionally a particle package
at `public/resource/particle.scp` to enable the preview. These local assets are
ignored by Git; see [preview packages](public/resource/README.md).

Preview defaults to note speed 10. Its aspect controls select the engine's 16:9,
21:9, or 4:3 test viewport, with the playfield scaled uniformly to fit.

FFT waveforms emphasize timing with 5 ms rows, logarithmic frequency bands
(bass near the center, treble toward the outside), and a narrow peak-amplitude
strip at the center. Reselect the BGM file to regenerate an existing waveform.

```sh
npm test
npm run check-type
npm run check-lint
npm run check-format
npm run build
```

Canvas editor browser regressions run against a local Vite server and do not
require preview packages:

```sh
npx playwright install chromium
npm run test:browser
```

To use an installed Chromium browser instead, set
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to its executable path. See
[rendering performance](PERFORMANCE.md) for the migration design, visual tradeoffs
and measurements.
