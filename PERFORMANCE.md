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
  searching a slide for every note. Oversized sprites draw directly.
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
their original group opacity. Native device resolution, note/flick/fake cues,
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
