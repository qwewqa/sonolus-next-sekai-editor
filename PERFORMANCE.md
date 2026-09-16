# Rendering performance

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

## SVG compositing and fidelity

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

## Validation

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
environment cannot establish a hardware-GPU frame rate or justify a larger
compositing rewrite.

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
