# Rendering performance

## Canvas editor migration

The editor chart now uses two demand-driven Canvas 2D surfaces: chart artwork
and interaction overlays. The toolbar, markers and controls remain DOM elements.
The existing coordinate-based mouse/touch handling, hit testing, edit tools,
history, chart format and preview WebGL renderer remain in use. Preview note
speed now defaults to **10**.

The migration follows these performance constraints:

- Capture reactive inputs and coalesce invalidations into the next animation
  frame. Moving the hover line or selection box redraws the overlay; it does not
  redraw the underlying chart. Static selection dashes avoid idle repainting.
- Keep the existing viewport index, selection set, visibility rules and painter
  order, including selected objects and connectors above notes. Culling includes
  flick arrows and strokes whose centers lie just outside the viewport. Creation
  and paste drawing is culled without changing the entities used by editing tools.
- Cache complete note artwork at device resolution, bounded to 512 sprites and
  approximately 16 MiB of RGBA pixels. Index immutable slide metadata instead of
  searching a slide for every note. Sprites used in the current animation frame
  remain resident; oversized sprites and cache overflow draw directly.
- Weakly cache connector paths, gradients and event paths by entity, invalidating
  for BPM or zoom changes. Constant-alpha guides use flat fills; authored fading
  guides retain their gradients. Batch disjoint grid lines by opacity.
- Reuse Canvas backing storage and decoded waveform images. Allocate a temporary
  viewport-sized surface only while creating/pasting, preserving opacity across
  the entire overlapping preview. Handle resizing, display-density changes,
  loaded fonts and restored Canvas contexts without continuous rendering.

The visible compromises are static dashes and small rasterization changes.
Faded event markers, connector fake crosses and labels can blend slightly
differently at their intersections because those primitives are no longer
isolated SVG groups. Cached note artwork and the whole creation/paste group keep
their original group opacity. Faded multipart notes drawn directly because of
size or cache limits can also blend slightly differently at their intersections.
Native device resolution, note/flick/fake cues,
curved connector geometry, authored fades and draw ordering are preserved.

### Alignment verification

A follow-up comparison found a consistent one- or two-device-pixel downward
shift in some labels: Canvas and SVG use different definitions of a middle text
baseline. Text now uses SVG's half-x-height offset from the alphabetic baseline,
measured once on mount and when fonts load, with explicit kerning and fonts
shaped at their displayed CSS size. ASCII whitespace collapses as it did in SVG;
nonbreaking spaces remain intact. Logical start/end anchors retain paired-label
and text-direction behavior.

Rounded Canvas backing dimensions also caused a small drift from pointer and DOM
coordinates at fractional dimensions/DPR. Transforms now use the actual backing
width and height ratios, keeping CSS positions exact without snapping geometry.

Browser tests compare 27 text renderings with independent SVG raster references
at DPR 1, 1.25 and 2, including fractional zoom, numeric labels, paired stage/group
names, kerning, whitespace, CJK and RTL anchors. All pass with at most one backing
pixel of ink-edge variation and less than 0.6 backing pixels of centroid drift;
substituting the previous text renderer makes all three tests fail. The wider
scene audit also checked 153 labels across five viewport/zoom/DPR combinations.
Text advances agree within 0.016 CSS pixels; all 33 labels at normal DPR 1 have
identical ink bounds. An independent geometry audit compared 21 scene pairs and
105 note artworks at DPR 1, 1.25 and 2, including fractional dimensions and pan.
Note decorations, hitboxes, waveform placement and connector endpoints match the
SVG geometry. Remaining edge differences come from rasterization.

### Stutter and correctness audit

A follow-up audit against `2162df9` found a recurring allocation spike when the
visible note widths exceeded the sprite cache capacity. Ordinary LRU eviction
discarded artwork earlier in the same frame, so every subsequent frame missed
the cache again. Chart and creation layers now share the browser's animation-frame
timestamp and retain sprites used in that frame. Overflow draws directly within
the same cache limits, allowing unused older sprites to be replaced on scroll.

In a deliberately dense browser fixture with 1,200 simultaneously visible,
distinct-width notes, 39 steady scroll redraws measured:

| Work                                    |   Before |   After |
| --------------------------------------- | -------: | ------: |
| New sprite canvases                     |   46,800 |       0 |
| Canvas backing-size writes              |  187,200 |       0 |
| Chart callback mean                     |  73.8 ms | 4.58 ms |
| Chart callback 95th percentile          |   150 ms | 5.70 ms |
| Chart callback maximum                  | 213.3 ms | 5.80 ms |
| Main-thread long tasks (at least 50 ms) |       39 |       0 |

These are warmed redraws; the initial frame still fills the bounded cache.
The workload is intentionally more demanding than ordinary chart density. In the
ordinary 6,000-note fixture, scrolling was already inexpensive (0.60 ms chart
callback p95), and idle/hover behavior remained demand-driven. Zoom and resize
still need sprites at the new scale; their measured callbacks stayed below 3 ms.
Headless Edge uses software rendering, so these measurements demonstrate removed
CPU/allocation spikes, not a hardware GPU frame-rate guarantee.

Other fixes target work or behavior that can become visible as pauses or jumps:

- Selection movement and resizing classify the selected entity types once per
  gesture instead of scanning the full selection for each entity. Paste applies
  the same linear classification. Moving a selection no longer sorts the previous
  history state's selection array in place.
- Preview hold heads and particles binary-search cached connector end indexes
  instead of repeatedly walking completed segments. A 10,000-segment isolated
  lookup benchmark with nine samples per frame fell from 47.09 to 0.267 ms across
  1,000 frames; this excludes the rest of rendering. Tests cover ordering, tied
  ends, overlaps, backward seeks and a 100,000-segment work bound.
- Offscreen waveform image completions no longer redraw the entire chart.
  Visible image completions still invalidate normally.
- Inertial scrolling integrates only until its stopping time. A delayed frame
  therefore cannot turn a small flick into a large overshoot, and finishing a
  horizontal ease no longer delays the vertical update by one frame.
- Audio catch-up skips cues whose playback deadlines have passed, bounding the
  delayed-frame scan to the scheduling lead (originally 200 ms; see below). Holds that
  span the gap resume, including when an expired source's end event is still
  queued. Short overlapping holds cannot truncate longer ones. Stopping/replacing
  playback and scrub previews now stops and releases sources, not just their
  gain connections; natural completion also releases both nodes.
- Preview resource downloads cancel on close, late decoded bitmaps are released,
  and a particle load no longer uploads the skin texture a second time. WebGL
  context restoration rebuilds textures and redraws even when paused.
- Touch cancellation discards pending edits and previews, aligned pinch gestures
  avoid zero-span zoom jumps, and leaving the editor restores a temporary mouse
  tool. Hit-test broad-phase bounds now include the full note/BPM height at beat
  bucket boundaries.

Validation passes 104 unit tests and 13 browser tests, including the existing
SVG text-alignment comparisons at DPR 1, 1.25 and 2, plus type, lint, formatting
and production-build checks. Normal cached artwork retains its geometry; the
direct-draw overflow opacity tradeoff is described above.

### Audio resilience under editor stalls

BGM remains one native Web Audio buffer during uninterrupted playback. The
cursor and hit-sound scheduler now use `AudioContext.currentTime`, so a delayed
resume or audio-only suspension freezes the timeline instead of leaving the
preview ahead of the music. Explicit pause captures the current audio position;
fine-step controls and editing still operate on the displayed position.

Hit sounds are queued 750 ms ahead by a 25 ms timer while audio is running,
independently of animation frames. The initial playback delay remains 200 ms.
The scheduler scans only new audio time, skips expired cues after longer stalls,
and restores holds spanning a gap. It stops when playback pauses or the audio
context suspends. Muting keeps scheduled cues available for an immediate unmute.

BGM and holds have 5 ms attacks; note auditions have a 3 ms attack followed by
their existing decay within the requested duration. Replacements and stops fade
playing sources out over 5 ms, while future or suspended sources cancel
immediately. Hit-sound attacks are unchanged. Gain automation uses tracked linear
ramps without requiring `cancelAndHoldAtTime`. Speed changes restart at the current
audio position with overlapping fades and no extra preroll.

Native Edge regression tests inject a 300 ms resume delay, audio-only suspension,
500 ms and 1.2 s main-thread stalls, and cancellation while resume is pending.
The 500 ms stall retains all tested cues (the previous scheduler omitted roughly
300 ms of them); longer stalls skip expired cues without a burst. Offline rendered
PCM checks verify smooth gain transitions and unchanged hit-sound onsets. These
tests measure scheduling and rendered samples, not audio-device underruns.

Installed Firefox 156.0 also passed native PCM envelope checks, a 300 ms delayed
resume, mid-playback suspension/resume, and cancellation during pending resume,
with no measured clock drift or BGM restart after suspension.

### Inactive windows and live edits

Hidden tabs and unfocused windows suspend the shared visual clock, editor Canvas
draws, preview WebGL frames, chart compilation, texture uploads and CSS
animations. Focus resumes from current state without applying the inactive time
as a large scrolling/gesture delta. The editor retains its pause-on-blur playback
behavior and also pauses when the tab becomes hidden. Background windows need no
recurring application timer.

Dragging/resizing and valid numeric property input publish temporary edits.
Only the latest request is resolved when the preview actually draws, so hidden
or closed previews never build those transactions. Edits enter undo history once
on completion. Cancellation restores the committed chart. Existing-object
interactions keep preview time fixed; empty-space clicks still seek.
Audio auditioning uses a separate time request: clicking a note still plays its
short BGM snippet, including repeated clicks, without invalidating the visual
preview. Dragging auditions new snapped beats and does not restart audio on
horizontal or sub-snap pointer movement.

The preview compiler reuses unchanged slide graphs, timing groups and stage
metadata. For synthetic one-note edits, compilation plus frame-index rebuilding
measured the following in Node (60 measured snapshots after 20 warmup snapshots):

| Total notes | Fresh median / p95 | Cached median / p95 |
| ----------: | -----------------: | ------------------: |
|       1,700 |     1.01 / 3.07 ms |      0.24 / 0.56 ms |
|       6,000 |     4.54 / 6.58 ms |      0.92 / 1.55 ms |
|      20,000 |   17.09 / 30.11 ms |      4.14 / 6.16 ms |

These measurements exclude edit transactions, rendering and GPU work. Flattening,
sorting and rebuilding frame indexes still scale with chart size; changing BPM or
timescale data invalidates more cached work than moving one note.
Preview transactions also skip automatic creation of a trailing empty group,
which otherwise invalidates every slide when editing a populated final group;
committing retains the editor's usual group creation behavior. Extremely large
bulk moves still cost more: the transaction alone measured 10.1 ms median /
13.9 ms p95 when moving all 6,000 notes of one slide, compared with 3.7 / 5.2 ms
for the same note count distributed among four-note slides.

Browser regressions verify zero visual callbacks/draws while inactive, playback
pausing, deferred preview compilation/uploads and recovery on focus.
Real pointer and property-input tests also compare uploaded WebGL geometry before
commit, after cancellation and after commit, alongside cursor/undo invariants.
The complete suite passes 126 unit tests and 63 browser tests, plus type, lint,
source-formatting and production-build checks.

### Timing-focused FFT waveforms

FFT generation reads decoded samples directly instead of depending on
`OfflineAudioContext.suspend()`, which Firefox does not implement. The previous
64-point, 100-row/s display sampled short, disjoint windows and then smoothed
their magnitudes over time. It could miss brief attacks and left long visual
tails. The new display uses centered, overlapping 1,024-sample Hann windows,
200 rows/s and no temporal smoothing. Its 124 logarithmic frequency bands cover
50 Hz through 16 kHz, capped at Nyquist. Four additional columns form a peak
strip covering each 5 ms interval, giving precise timing alongside the wider
spectral window. Bass detail is still limited by the approximately 21–23 ms
analysis window at 48/44.1 kHz; interpolated display bands do not add frequency
resolution.

Stereo channels share one complex transform and combine spectral power instead
of averaging samples, preserving sounds with opposite channel phases. Fixed
brightness thresholds keep quiet passages quiet. Pixel-center timestamps,
zero-padded endpoint windows and half-open peak intervals preserve attacks at
the beginning, end and tile boundaries. Enlarged rows use nearest-neighbor
rendering. Zooming out lazily builds cached reduced tiles, retaining the strongest
alpha in each adjacent row pair. This keeps narrow attacks visible even during
fractional scrolling; ordinary browser reduction could erase them, including in
Firefox where `imageSmoothingQuality` is unsupported. The tradeoff is slightly
thicker/brighter peaks at low zoom, with timing precision limited by screen pixels.

Import reuses FFT, row and tile buffers and yields after approximately 8 ms of
analysis work, checking every 16 rows. It avoids a second full-length audio buffer.
The local 151.185-second stereo BGM measured the following in headless Edge:

| Work                           | Previous FFT | Timing-focused FFT |
| ------------------------------ | -----------: | -----------------: |
| Complete generation, warm runs |  0.36–0.37 s |        1.07–1.09 s |
| Decoded RGBA for all 16 tiles  |      2.05 MB |           16.38 MB |
| Encoded PNG tiles              |      0.39 MB |            4.07 MB |

The new FFT calculation used 620–632 ms of CPU work. The largest analysis slice
was 8.5–8.7 ms warm and 9.8 ms cold; no main-thread task exceeded 50 ms in that
run. These are local import measurements, not rendering or hardware GPU timings.
The clearer raster costs more once during import; scrolling still draws two
mirrored images per visible tile. Retained decoded tiles are bounded to 16 MiB
and 32 images, including cached reductions, except when the visible working set
itself is larger. Visible
tiles stay resident to avoid repeated eviction and decoding, and offscreen load
completions do not trigger chart draws. Failed or cancelled PNG generation revokes
URLs already created for that attempt. Cancelling/replacing a BGM import or
resetting the chart stops generation at its next yield and prevents stale results
from replacing newer audio. Discarded BGM drafts release their waveform URLs;
committed waveforms remain available to undo history.

Installed Firefox 155.0.1 also decoded the actual stereo BGM and generated all 16
nonempty tiles without uncaught errors. One warm headless run took 1.05 seconds
for FFT and PNG generation, with a largest 10 ms timer interval of 26 ms. This
confirms compatibility and cooperative import behavior, not hardware presentation
performance.

The production Canvas renderer also preserves every tested one-row attack during
fractional scrolling in Firefox. For the first real BGM tile, its initial cached
reduction took 4 ms; 100 subsequent draws averaged 0.24 ms with no further
readbacks. Enlarging the waveform uses the original image again.

### Preview aspect presets

Preview offers the engine's 16:9, 21:9 and 4:3 test aspect ratios, defaulting to
16:9. The selected viewport is centered inside its panel, while the locked 16:9
engine field scales uniformly to fit that viewport. The engine's smaller debug
guide scale is not applied. Logical dimensions preserve the selected ratio;
backing pixels round independently for DPR and quality, so lower quality does
not distort geometry. Controls remain outside the fitted viewport so a short
21:9 viewport cannot clip them.

Regression coverage checks engine field and full-screen geometry, fractional
DPR, resizing, radio keyboard navigation, quality changes, idle drawing and
inactive changes. FFT checks cover an independent scalar DFT reference,
opposite-phase stereo, silence, transient timing, both audio endpoints and tile
boundaries at 44.1/48 kHz, import failures and decoded cache limits.

The complete suite passes 139 unit tests and 93 browser tests, including the
existing editor interaction and text-alignment checks, plus type checking,
lint, source formatting and production build.

### Additional review of scaling and cancellation

Reduction selection now uses the actual Canvas transform after backing-size
rounding. At fractional DPR, estimating that scale from CSS size and requested
DPR could keep a 2,000-row tile even when it occupied slightly fewer than 2,000
physical pixels, allowing nearest-neighbor rendering to skip an attack. An
independent 2,000-row sweep went from five missing attacks to zero. Firefox also
preserves the tested attacks with at most approximately half a pixel of alignment
error in the fractional-size case.

Cancellation checks now extend beyond BGM import to chart import, autosave
restoration, cover/audio utilities and saving. A cancelled chart import could
previously resume after its final wait and replace a later edit. Cancelled native
save pickers no longer become fallback downloads, and cancelled pending file
writes abort their stream before committing. Tests verify the original contents
of a real browser-managed file remain intact. Ordinary native saves and download
fallbacks still work. Already-running native decodes, PNG encodes and file commits
cannot necessarily be interrupted; their late results are discarded where the
operation has not already committed.

### Comparison with optimized SVG (`2a96ffa`)

A 6,000-note fixture with approximately 100 visible notes, a 1,600 x 1,000
viewport and a 640 x 360 paused preview produced the following results:

| Operation                                    |       SVG | Canvas |
| -------------------------------------------- | --------: | -----: |
| Editor descendants, normal / all selected    | 536 / 623 |  2 / 2 |
| Main-thread work, 120 normal scroll frames   |    174 ms | 177 ms |
| Main-thread work, 120 selected scroll frames |    352 ms | 254 ms |
| Style work, 120 selected scroll frames       |   81.8 ms | 6.4 ms |
| Select all 6,000 notes                       |     29 ms |  28 ms |

Ordinary scrolling uses roughly the same main-thread time; this migration does
not promise a universal CPU speedup. Selected scrolling used about 28% less
main-thread time. Wall time improved from 3.314 to 1.088 seconds for normal
scrolling and 14.512 to 8.710 seconds with selection, but these headless Edge runs
use software rendering/SwiftShader and have presentation stalls. These are
individual samples with run-to-run variability, not hardware-GPU FPS estimates.

A separate stress test draws 240 overlapping guides, including varying alpha and
faded groups. Across 40 scroll frames, the final Canvas implementation measured:

| Work                                   |              SVG |          Canvas |
| -------------------------------------- | ---------------: | --------------: |
| Main thread, normal / selected         |     146 / 496 ms |     93 / 179 ms |
| Paint, normal / selected               |  21.1 / 137.2 ms |    4.0 / 4.1 ms |
| Raster decode/flush, normal / selected | 191.5 / 920.2 ms | 60.0 / 273.5 ms |

That is about 69-70% less measured raster work, while overlapping translucent
pixels still need blending. The Canvas architecture reduces scene management,
painting and raster work; it does not eliminate fill-rate limits on a real GPU.

In the local real-chart fixture, the densest six-second window contains 114 of
1,679 notes. Sixty scroll frames used 148 to 74 ms of main-thread work normally,
and 318 to 121 ms with all 3,724 entities selected. Editor descendants fell from
946 to two in the selected view. These fixture measurements describe editor
rendering, separately from the earlier preview-engine CPU measurements below.

Regression tests cover layer/filter behavior, scheduled invalidation, surface
reuse and DPR, note roles and edit ghosts, connector geometry/alpha/cache
invalidation, event curves and infinity visibility. Browser checks compare
13 rendering scenes and 37 interaction/lifecycle assertions against the SVG
baseline, including mouse edits, touch pan, undo/redo, paste, resize, DPR changes,
context restoration and the preview speed default. An idle editor performed zero
chart/overlay draws; pointer-only movement drew four overlay frames and zero chart
frames in the tested interval.

`npm run test:browser` provides committed Playwright regressions for editing,
idle/hover invalidation, resize/DPR hit testing and clearing selection across chart
resets. The last case caught a Chromium deferred-Canvas clearing issue: a plain
`clearRect` could retain old outlines when subsequent drawing was offscreen.
Frames now use a transparent `copy` fill, which clears reliably without a pixel
readback or backing-storage reallocation. All tables above include this fix.

## Earlier SVG and preview optimizations

The main costs found in the editor were unnecessary work around the visible
geometry, rather than the number of SVG icons alone:

- Selection outlines were mounted for every selected entity, including offscreen
  notes. Selection membership also scanned the selected array for each visible
  entity. Outlines now use viewport candidates and a shared selection set.
- Fractional scrolling and hover changes repeatedly rebuilt and sorted the SVG
  entity list. The list now retains its identity until its members change, and
  hover highlighting does not invalidate the sort.
- An inherited dash animation on the SVG root invalidated styles across the
  scene. It now applies only to the interaction overlays. Editor bounds and
  screen width also update on resize/layout events instead of polling layout on
  every animation frame.
- Preview rendered and uploaded geometry even while paused. It now draws when
  chart time, chart data, resources, dimensions or rendering settings change.
  Selecting entities does not rebuild the preview chart.
- Preview scanned the entire chart for notes, connectors, slides and hit effects
  on every frame. Interval indexes now restrict those loops while preserving
  submission order and particle seeds. Historical stage properties are shared
  within a frame. Stops, reversals, scroll transitions and negative skips retain
  conservative future traversal because target time cannot safely bound their
  visibility.
- WebGL submission allocated a vertex array for every sprite and a packed array
  for every frame. Submission entries and CPU/GPU buffers now retain capacity;
  uploads contain only the current frame's vertices.
- Particle drawing repeatedly enumerated immutable expressions and regenerated
  seeded random/trigonometric inputs. Expression terms now use a weak cache, and
  a bounded 1,024-entry cache reuses random values. Animated values and layout
  transforms still evaluate for the current frame.

### Earlier SVG compositing and fidelity

Large overlapping translucent connectors and faded entity groups can still be
expensive to paint while scrolling. Group opacity must be preserved: applying
the same opacity to individual overlapping children changes the resulting
colors. The editor has no SVG filter or blend-mode effects to disable.

The optimizations preserve draw order, transparency, antialiasing and detail.
Constant-alpha guide gradients become equivalent flat translucent fills, saving
four SVG nodes per connector; varying-alpha gradients stay intact. Fully
transparent guides do not mount drawing components. The opacity of overlapping
notes and creation previews is unchanged.

Pixel comparisons of overlapping normal, faded and creation-preview guides found
small rasterization differences from replacing constant gradients: at most 2/255
per color channel normally and 3/255 in the creation preview. Changing only those
gradients in the original DOM reproduced the new screenshot exactly. This is the
visual tradeoff of the simpler fill; gradients with changing alpha, group opacity
and layer order are preserved.

The remaining SVG cost depends on visible geometry and overlap, especially when
zoomed far out. Preview's remaining cost includes visible connector tessellation,
particles and pixel fill at large render sizes. These costs are separate from
total chart length; a chart containing thousands of simultaneously visible
objects will still cost more than a sparse chart of the same duration.

### Earlier validation

`npm test` covers viewport boundaries, selection outline extents, stable visible
lists, arbitrary time-index seeks and overlapping intervals, conservative
visibility bounds, full rendered geometry comparisons, and WebGL vertex data,
sort order, blend runs and buffer growth. Run the type, lint, format and build
checks listed in the README as well.

Browser measurements use a deterministic 6,000-note chart, approximately 100
visible notes, a 1,600 × 1,000 viewport and a 640 × 360 preview. CPU preview
measurements also compare 24,000-note charts with the same visible density.
Headless Edge uses software WebGL (SwiftShader), so browser timings describe this
test environment rather than hardware-GPU performance. Frame counts, upload
counts and DOM counts establish the removed work independently of GPU speed.

Compared with `eb7d811`, the initial browser run measured:

| Operation                                          |                    Before |            After |
| -------------------------------------------------- | ------------------------: | ---------------: |
| Paused preview, two seconds                        | 57 draws, 9.1 MB uploaded | 0 draws, 0 bytes |
| Select all 6,000 notes                             |                    225 ms |            31 ms |
| Editor SVG descendants with all selected           |                     6,533 |              623 |
| Selection outline rectangles                       |                     6,001 |               90 |
| Main-thread work during 120 selected scroll frames |                  7,946 ms |           482 ms |
| Style recalculation during those frames            |                  6,149 ms |            90 ms |

These are work-reduction measurements, not an FPS guarantee: selected-scroll
wall time did not improve in that software-rendered run despite the lower
main-thread cost. The preview screenshot was byte-identical. An independent
comparison against the original renderer also matched 378 complete frames and
45,840 draw commands, including reverse/scroll timescales, masks, attachments,
particles and backward seeks.

An SVG-only stress test with 240 overlapping guides (constant/varying alpha and a
faded group) reduced gradient nodes from 240 to 60 and SVG descendants from 2,029
to 1,230. Across 40 fractional-scroll frames, Paint events fell from 55.8 to
16.1 ms and raster decode/flush work from 233.5 to 161.6 ms. These measurements
combine the SVG optimizations; they do not isolate gradient simplification alone.
The selected version remained limited by software presentation: the GPU process
spent 25.8 of 27.1 seconds in `NativeViewGLSurfaceEGL:RealSwapBuffers`. This
environment cannot establish a hardware-GPU frame rate.

The local `coconut-next-sekai-24887` fixture contains 1,679 notes, 600 connectors,
90 slides, six timescale groups and four dynamic stages. Its complex timescales
need conservative future traversal, so indexing alone did not measurably improve
its frame time. Disabling effects identified particle work as the larger cost.

After particle caching, a paired run with real skin/particle assets and 300 frames
distributed across the song measured **1.391 → 0.673 ms/frame** with effects,
using the median of five warmed rounds. Without effects it was essentially
unchanged, **0.370 → 0.377 ms/frame**. An additional 108 frames / 29,542 draws
matched the original exactly; each timed round also retained 107,564 draws.
These CPU measurements exclude WebGL submission and GPU work. Large synthetic
positive-speed charts benefit much more from the time indexes; these should not
be read as universal preview speedups.
