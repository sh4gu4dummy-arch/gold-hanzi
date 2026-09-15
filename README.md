# 汉字描红 · Chinese Trace

A small handwriting practice app for the 10 most common Simplified Chinese characters. Tap a character, then trace it on a canvas overlay.

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
3. Trace the faint guide with a finger or mouse.
4. **Clear** wipes strokes. **Done** confirms and calls `onDone`.
5. **Home** returns to the character list.

## Stack

Vite + React + TypeScript + react-router-dom. The `TracePad` API is:

```tsx
<TracePad character="的" accent="#7C5CBF" onDone={() => {}} />
```
