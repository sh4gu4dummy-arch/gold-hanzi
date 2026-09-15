# TracePad stroke-centric grading (Chinese)

PASS is the AND of per-stroke median checks only (checked after every finger move).
Fat-mask COVER and 3×3 CELL are computed for stamp bookkeeping / diagnostics but
**must not block pass**.

## Per-stroke checks (decisive)

For every numbered stroke (hanzi-writer medians, same transform as guides):

1. **Sample hit fraction** ≥ `STROKE_COVER` (0.58) — tip-only / missing stroke / neighbor-bleed fails.
2. **End-of-stroke band** — among samples with arc-length `t ≥ STROKE_END_T` (0.90), require ≥50% hits and at least 2 when 2+ end samples exist — unfinished hook/tip fails.

Samples: `t = 0.12 .. 0.92` step `0.08`, plus tip samples `0.96` and `0.99` (arc-length along the median).
Hit if ink within `rad = max(8, round(inkWidthCss() * STROKE_HIT_INK_FACTOR * dpr))` with `STROKE_HIT_INK_FACTOR = 0.48` (tighter than 0.55 so neighbor ink is less likely to clear another stroke on 的/是).
Fat-mask COVER / cells remain informational and **must not** gate pass.

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
