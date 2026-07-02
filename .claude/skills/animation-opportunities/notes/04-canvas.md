# Part 4: HTML Canvas

Source: Josh Comeau's *Whimsical Animations* course.

## Canvas Animation

Canvas uses **immediate mode** — every frame drawn from scratch (vs DOM's retained mode). Despite seeming inefficient, canvas paint operations are orders of magnitude faster than DOM changes.

### Animation Loop

```js
function draw() {
  ctx.clearRect(0, 0, canvasWidth, canvasHeight);
  // paint stuff
  window.requestAnimationFrame(draw);
}
draw();
```

Never use `setInterval` — it assumes 60Hz and callbacks pile up. `requestAnimationFrame` auto-syncs to display refresh rate.

### Velocity Model

Store objects as JS data: `{ x, y, size, velocity }`. Bounce by flipping velocity sign at boundaries. Friction: `velocity *= 0.99` per frame.

### DPR-Aware Setup

```js
export function setupCanvas(canvas) {
  const dpr = window.devicePixelRatio;
  const { width, height } = canvas.getBoundingClientRect();
  canvas.setAttribute('width', width * dpr);
  canvas.setAttribute('height', height * dpr);
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  return { ctx, canvasWidth: width, canvasHeight: height };
}
```

## Delta Time

Express velocity in pixels per second, not per frame, for refresh-rate independence:

```js
let lastTimestamp = performance.now();
function draw() {
  const now = performance.now();
  const deltaTime = Math.min(now - lastTimestamp, 250) / 1000;
  lastTimestamp = now;
  box.x += box.velocity * deltaTime;
}
```

Cap at 250ms to handle background tab throttling. Canvas implements sub-pixel rendering — don't round to nearest pixel.

## Canvas vs SVG

### Performance Benchmarks

| Technique | Avg threshold before choppiness | Low-end (10th percentile) |
|---|---|---|
| Vanilla SVG | ~3,600 elements | 256 elements |
| React SVG | ~6,900 elements | — |
| Canvas | ~25,600 draw calls | 13,924 draw calls |

Canvas is ~50x more performant on low-end devices.

### Decision Framework

1. Thousands of moving shapes? → Canvas
2. Accessible text needed? → SVG
3. Neither? → SVG (better DX: CSS pseudo-classes, transitions work)

## Trails

### Simple Hack

Semi-transparent `fillRect` instead of `clearRect`:

```js
ctx.fillStyle = 'hsl(0deg 0% 0% / 0.1)';
ctx.fillRect(0, 0, canvasWidth, canvasHeight);
```

Previous frames fade gradually. **Caveat:** persistent residue (never reaches full black).

### Programmatic Approach

Store N previous positions, repaint with decreasing lightness. More complex but no residue.

## Sine Motion

`Math.sin(timestamp)` produces values -1 to 1 with organic oscillation. Use `Math.cos()` for Y axis = circular motion. Different speed multipliers for X/Y = worm-like motion.

```js
const x = normalize(Math.sin(totalTime), -1, 1, minX, maxX);
const y = normalize(Math.cos(totalTime), -1, 1, minY, maxY);
```

Per-item time offsets create orbital patterns.

## Simplex Noise

Nearby inputs produce nearby outputs (unlike `Math.random()`). Always prefer simplex over Perlin noise.

```js
import createNoiseGenerator from './noise.vendor';
const { simplex2 } = createNoiseGenerator(1);
const y = normalize(simplex2(x / 200, 1), -1, 1, 0, canvasHeight);
```

Divide inputs by 100-200 for smooth curves. Pass timestamp as additional argument to animate. Use `simplex3` for animated 2D grids.

## Offscreen Canvas

Transfer rendering to Web Worker for heavy computations:

```js
// Main thread:
const offscreenCanvas = canvas.transferControlToOffscreen();
worker.postMessage({ type: 'init', offscreenCanvas }, [offscreenCanvas]);

// Worker:
self.onmessage = function(e) {
  const ctx = e.data.offscreenCanvas.getContext('2d');
};
```

~96% browser support. Main thread sends dimensions on resize.

## Canvas in React

### Reusable `Canvas` Component Pattern

Consumer passes a `draw` function. Component handles DPR, responsiveness, delta time.

```jsx
const boxRef = React.useRef({ x: 0, y: 0, velocity: 110 });
const draw = React.useCallback(({ ctx, width, height, deltaTime }) => {
  const box = boxRef.current;
  box.x += box.velocity * deltaTime;
  // ... draw
}, []);
return <Canvas draw={draw} />;
```

**Key:** Use `useRef` not `useState` for animation state. React re-renders provide no benefit for canvas. On 240Hz displays, `draw()` runs hundreds of times/sec — React's render loop isn't designed for that frequency.
