# 汉字描红 · Chinese Trace

A small handwriting practice app for the 10 most common Simplified Chinese characters. Tap a character, watch a slow stroke-order guide, then freehand-trace until the three-gate grader passes.

## Run

```bash
cd /workspace/chinese-trace
npm install
npm run dev -- --host 0.0.0.0 --port 5173
```

Open [http://localhost:5173](http://localhost:5173).

## Build

```bash
npm run build
npm run preview -- --host 0.0.0.0 --port 5173
```

## Usage

1. Homepage lists 的 一 是 了 我 不 在 人 有 他 (progress pips show levels beaten).
2. Tap a tile to open practice. **Level count = stroke count** for that character.
3. **Level 1:** full stroke-path guide stays visible while you write.
4. **Level k (k>1):** after a slow whole-character demo, strokes 1..(k−1) are hidden (memory); later strokes still show a path guide.
5. Draw freely on the pad. A level is beaten only when the **app** grades a pass (cover + 3×3 regions + stroke medians) — then it auto-finishes. No Done button.
6. Bottom pips select/retry levels; unlocking is sequential (beat L1 to unlock L2). Progress persists in `localStorage`.

## Grading

Port of Latin TracePad three-gate grading (`_specs/trace-grading.md`):

1. **Cover** ≥ 50% of glyph pixels (stroke-path Path2D mask from vendored strokes JSON)
2. **Regions** — every 3×3 cell with ≥4% of letter mass ≥32% inked
3. **Strokes** — every hanzi-writer median ≥40% sample hits

Outside-letter ink is drawn for feel but never counted.

## Font

**Ma Shan Zheng** (Google Fonts) for UI titles / character display. TracePad guides + grading use Make-Me-a-Hanzi stroke paths (same as hanzi-writer).

## Stack

Vite + React + TypeScript + react-router-dom + hanzi-writer (slow demo animation). Freehand canvas + bitmap grading for pass detection. Stroke data vendored from hanzi-writer-data in `src/data/strokes/`.

```tsx
<TracePad character="的" accent="#7C5CBF" onDone={() => {}} />
```
