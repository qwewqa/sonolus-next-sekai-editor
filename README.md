# Sonolus Next SEKAI Editor

Public test site: https://next-sekai-editor-test.qwewqa.xyz/

Upstream site: https://next-sekai-editor.sonolus.com

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
The settings panel can be minimized with its header button and reopened with the
gear button. It starts minimized on narrow screens and touch devices, and remembers
your choice across reloads.

Tap the preview to show a compact bottom bar with play/pause and paired 1, 10,
and 100 ms step buttons, ordered −100/−10/−1/+1/+10/+100. The image shifts upward
when needed to fit the bar beneath it, or overlaps the bar if space is still limited.
Narrow panels put the steps in two rows.
While paused, narrow previews show the timestamp in the top-left corner.
A tap makes one exact step; holding for a quarter second moves continuously at
0.1×, 1×, or 10× speed, respectively, forward or backward. Stepping pauses playback,
and a hold auditions the final position when released. Controls stay visible when
there is room below the image. When they overlap it, tap the preview to toggle them;
they never hide automatically during playback.
Mouse-wheel scrolling over the preview also moves backward or forward, pausing
playback and auditioning the final position when scrolling stops. Its direction
matches editor scrolling, and additionally moves the play cursor. With Follow
enabled, taps smoothly bring the timeline to the configured follow position;
holding a step button or scrolling the wheel locks the timeline to that position.

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

## Public deployment

Pushes to `preview` in `qwewqa/sonolus-next-sekai-editor` run the Pages release
workflow. Deployment follows successful unit, browser, production, type, lint,
format and artifact checks. Pull requests run checks without publishing.

To build and smoke-test the exact release artifact locally:

```sh
npm ci
npx playwright install chromium
npm run test:release
npm run build:release
npm run test:production
npm run check:release
```

The release build uses the versioned packages in `deployment/assets`, validates
their checksums, and excludes local `public/resource` files. It includes a
`release-manifest.json` manifest and license notices. Local development can continue using
its own packages. See [release assets](deployment/ASSETS.md) for provenance and
[deployment instructions](DEPLOYMENT_PLAN.md) for hosting setup and rollback.
