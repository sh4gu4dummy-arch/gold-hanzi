# TracePad stroke-centric grading (Chinese)

PASS is the AND of per-stroke median checks only (checked after every finger move).
Fat-mask COVER and 3×3 CELL are computed for stamp bookkeeping / diagnostics but
**must not block pass**.

## Per-stroke checks (decisive)

For every numbered stroke (hanzi-writer medians, same transform as guides):

1. **Sample hit fraction** ≥ `STROKE_COVER` (0.40) — tip-only scribble fails.
2. **End-of-stroke band** — at least one sample with arc-length `t ≥ STROKE_END_T` (0.88) must be hit — early stop fails.

Samples: `t = 0.12 .. 0.96` step `0.08` (arc-length along the median).
Hit if ink within `rad = max(8, round(inkWidthCss() * STROKE_HIT_INK_FACTOR * dpr))` with `STROKE_HIT_INK_FACTOR = 0.55` (more lateral fuzzy than the old `/2.4`; still tight enough not to merge neighbors on 的/是).

## UI

- Progress meter = **X/Y strokes** completed (`doneCount` / stroke count), not cover %.
- `evaluateGrade` exposes `strokeDone: boolean[]` (+ `doneCount`); TracePad greens each passed stroke’s guide path fill.
- Failing copy (learner language): **follow the stroke** / **finish the stroke**.
  No “need regions/cover” pass-blocker wording.

## Still true

- Outside-letter ink is drawn for feel but NEVER counted (`stampInk` only on letter pixels).
- `inkWidthCss()` ≈ clamp(16, 4vw, 22) (fallback `INK_WIDTH = 18`).
- Letter mask: rasterize vendored Make-Me-a-Hanzi stroke Path2D fills onto an offscreen canvas (hanzi 1024 viewBox, `HANZI_PADDING`, y-flip + content-center — same transform as TracePad guides / hanzi-writer).
- `finish()` when stroke checks pass: `done=true`, `onDone()`, mark level beaten.
