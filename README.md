# 汉字描红 · Chinese Trace

A small handwriting practice app for the 10 most common Simplified Chinese characters. Tap a character, then walk through its strokes in standard order and trace them on a canvas.

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

1. The homepage lists 的 一 是 了 我 不 在 人 有 他.
2. Tap a tile to open the practice screen.
3. Practice starts at **stroke 1**. A guide highlights/animates the current stroke (completed strokes stay visible and dimmer via the outline).
4. Draw the highlighted stroke on the pad (stroke matching is lenient), or tap **Next stroke** to advance. Use **Previous**, **Replay**, and **Clear** as needed.
5. When you finish the walkthrough, tap **Done**. **Home** returns to the list.

## Stroke-order guide

Stroke order and animation come from [hanzi-writer](https://chanind.github.io/hanzi-writer/) with character data vendored from [hanzi-writer-data](https://github.com/chanind/hanzi-writer-data) (Make Me a Hanzi). The React `TracePad` wraps Hanzi Writer’s quiz mode for sequential reveal, stroke highlighting, and optional drawn-stroke matching.

## Stack

Vite + React + TypeScript + react-router-dom + hanzi-writer. The `TracePad` API is:

```tsx
<TracePad character="的" accent="#7C5CBF" onDone={() => {}} />
```
