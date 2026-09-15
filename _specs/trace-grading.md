# TracePad three-gate grading (port for Chinese)

PASS needs ALL three (check after every finger move):
1. COVER_THRESHOLD = 0.5 — 50% of letter pixels inked (alpha > 24 on fillText glyph mask)
2. 3×3 regions: every cell with ≥ CELL_MIN_SHARE (0.04) of letter pixels must be ≥ CELL_COVER (0.32) inked
3. Every numbered stroke ≥ STROKE_COVER (0.40) hit — sample t=0.12..0.92 step 0.08; hit if ink within rad = max(6, round((inkWidthCss()/2.4)*dpr))

Outside-letter ink drawn for feel but NEVER counted.
inkWidthCss() ≈ clamp(16, 4vw, 22) (fallback INK_WIDTH = 18); GRID 3×3.

Letter mask: offscreen fillText of the Chinese character with handwriting font; letterBits where alpha > 24; GlyphBox from those pixels; guide/median points map onto GlyphBox.

For Chinese strokes: use hanzi-writer medians (or stroke paths) as the numbered strokes for gate 3 — same strokesReady logic.

finish() when all three pass: done=true, onDone(), mark level beaten.

Do NOT skip gates 2 or 3.
