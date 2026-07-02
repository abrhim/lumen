# Part 2: The Magic of SVG

Source: Josh Comeau's *Whimsical Animations* course.

## SVG Animations

Many SVG attributes are secretly CSS properties — CSS transitions work for presentational attributes (strokes, fills).

**What works:** Most single-value geometric attributes like `x`, `ry` on `<ellipse>`.

**What doesn't work:** `x1`/`y1`/`x2`/`y2` on `<line>`, `points` on `<polygon>`/`<polyline>` — not available in CSS.

### Path Animation

Path `d` attribute can be transitioned in CSS (~79% support, NOT Safari as of April 2026):

```css
path {
  transition: d 300ms;
}
button:hover path {
  d: path("M 20,50 C 80,0 140,100 180,50");
}
```

**Critical:** Both states must use the same command sequence — only values change. Mismatched commands can't be interpolated.

**Escaped newlines:** In `path()`, each line must end in `\` (CSS strings must start and end on same line).

**SMIL:** Quasi-deprecated 90s technology. Only use case: animation must run with JS disabled.

## Motion Library

The course uses [Motion](https://motion.dev/) (amalgamation of Motion.One and Framer Motion).

```js
import { animate } from 'motion';
animate(path, { d: `M 20,50 C 80,0 140,100 180,50` }, { duration: 1 });
```

**Accessibility:** Motion does NOT auto-disable for motion-sensitive users. Handle manually:

```js
const prefersReducedMotion = !window.matchMedia('(prefers-reduced-motion: no-preference)').matches;
animate(path, { d: '...' }, { duration: prefersReducedMotion ? 0 : 1 });
```

**Why not GSAP?** Motion is tiny, uses WAAPI (runs on compositor thread). GSAP is enormous and runs on main thread.

## CSS vs JavaScript

**The significant difference:** JS animations run on the main thread. CSS transitions/keyframes run on a separate compositor thread — not disrupted when the main thread is busy.

**Motion's secret:** Uses the Web Animations API (WAAPI) under the hood — runs on compositor thread like CSS animations.

**GSAP sync issue:** When main thread is busy, GSAP animations continue from current position rather than snapping to correct time-based position. Can cause desync.

**Comeau's rule:**
1. Use native CSS whenever possible
2. When CSS can't handle it, use Motion (WAAPI)
3. Don't use libraries that only wrap CSS without enabling new capabilities

## Self-Drawing Trick

Making a path appear to draw itself using `stroke-dasharray` and `stroke-dashoffset`.

### Recommended: Sliding the Dash with `stroke-dashoffset`

```css
.scribble {
  stroke-dasharray: 100, 1000;
  stroke-dashoffset: 100px;
  transition: stroke-dashoffset 1000ms;
}
button:hover .scribble {
  stroke-dashoffset: 0px;
}
```

Fixes the linecap bug that occurs with the "grow the dash" approach (0px dash still renders a circle with round linecap).

### Getting Path Length

```js
const pathLength = elem.getTotalLength(); // e.g., 365.54931640625
```

### Custom Scale with `pathLength` Attribute

```html
<path pathLength="100" d="..." />
```

Now CSS treats the path as 100px long regardless of actual geometry. Use `0` to `100px` as the dashoffset range.

## Spring Physics and linear()

### Non-Bezier Easings (Introduction)

Spring physics produce "incredibly lush motion" that Bezier curves can't match. The `linear()` timing function is the CSS solution.

### Spring Parameters

- **Stiffness** — energy/coiling. Higher = snappier.
- **Damping** — friction. Higher = less oscillation.
- **Mass** — leave at 1.

**Tuning strategy:** Set damping to 20, dial stiffness for speed, then adjust damping for vibe. Springs only model "ease"-type curves (can't do ease-in).

### linear() Function

Connect-the-dots with straight line segments between data points. Values outside 0-1 enable spring overshooting.

- 11 points = robotic
- 50 points = convincing
- Strategic point clustering halves needed points

Two syntax forms: flat list (`linear(0, 0.5, 1)`) or value+percentage pairs (`linear(0 0%, 0.5 50%, 1 100%)`).

**Tools:** Linear() Easing Generator (Jake Archibald), Easing Wizard.

### linear() Limitations

1. **Time-based** — can't do infinite springs
2. **Interrupts are the biggest issue** — CSS reversing shortening factor compresses the timing function, making interrupted springs feel unnatural
3. **Performance is fine** — ~1.2kB gzip for 3 springs

**Comeau's rule:** `linear()` for most things, JS library for important interruptible transitions.

### Comeau's Favourite Pattern — Spring Design Tokens

Define 3-4 global springs as CSS custom properties:

```css
:root {
  --spring-default: linear(/* ... */);
  --spring-default-duration: 0.633s;
  --spring-bouncy: linear(/* ... */);
  --spring-bouncy-duration: 0.833s;
}
```

Use globally for ~80%. Create bespoke springs for ~20%.

**Fallback:**

```css
@supports not (transition-timing-function: linear(0, 1)) {
  :root {
    --spring-default: cubic-bezier(0.25, 0.1, 0.25, 1);
    --spring-default-duration: 300ms;
  }
}
```

## Transforms in SVG

SVG transform-origin is relative to the viewBox, not the element. All SVG nodes share the same reference box.

**Fix:** Use pixel values matching the element's geometry:

```css
text {
  transform: rotate(45deg);
  transform-origin: 150px 100px;
}
```

Different shapes need different calculations:
- Elements positioned by center (`<text>`, `<circle>`): use position coordinates directly
- Elements positioned by top-left (`<rect>`): calculate center (`x + width/2`)
- Paths/polygons: no formula — depends on the specific shape

## SVG Masks

White = visible, Black = hidden. Semi-transparent grays produce partial transparency.

```html
<svg viewBox="0 0 32 32">
  <defs>
    <mask id="moon">
      <rect x="0" y="0" width="32" height="32" fill="white" />
      <circle cx="24" cy="8" r="12" fill="black" />
    </mask>
  </defs>
  <circle cx="16" cy="16" r="12" fill="hotpink" mask="url(#moon)" />
</svg>
```

### Mask Gotchas

1. **Masks apply before transforms** — wrap in `<g>` and lift mask to the group
2. **Strokes on masked shapes don't work** — strokes apply before masks
3. **Horizontal/vertical lines disappear** — add `maskUnits="userSpaceOnUse"` to fix

## SVGs in React

JSX is excellent for dynamic SVGs. React handles SVG namespacing automatically (unlike vanilla JS which needs `document.createElementNS()`).

### Unique IDs with `React.useId()`

SVG features use `id` for linking (`<use>`, `<mask>`). Multiple instances create duplicate IDs.

```jsx
function MoonCutout({ maskCenter }) {
  const id = React.useId();
  const maskId = `${id}-moon-mask`;
  return (
    <svg viewBox="0 0 32 32">
      <defs><mask id={maskId}>...</mask></defs>
      <circle mask={`url(#${maskId})`} ... />
    </svg>
  );
}
```

### motion/react

```jsx
import { motion } from 'motion/react';
<motion.path
  initial={false}
  animate={{ d: isPlaying ? squarePath : trianglePath }}
/>
```

Uses JS Proxies. `initial={false}` disables enter animation.

### React Spring vs Motion

| Feature | Motion | React Spring |
|---------|--------|-------------|
| Scope | Broad, batteries-included | Narrow, spring interpolation focus |
| Layout animations | Yes (killer feature) | No |
| Interrupt handling | Decent | Excellent |
| `clamp` | No | Yes |
| Bundle size | 30.6kB | 19.2kB |

React Spring uses "tension" (= stiffness) and "friction" (= damping).
