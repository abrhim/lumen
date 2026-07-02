# Part 3: Advanced Interactions

Source: Josh Comeau's *Whimsical Animations* course.

## Cursor Interactions

Building interactions that respond to cursor position using distance calculations.

### Distance-Based Scaling

Two pieces needed: cursor's on-screen position + element's center point. Use Pythagorean theorem:

```js
const deltaX = cursorX - centerX;
const deltaY = cursorY - centerY;
const distance = Math.sqrt(deltaX ** 2 + deltaY ** 2);
```

Get element position with `getBoundingClientRect()`. Map distance to scale with `clampedNormalize`.

### Golden Rule: "Don't Change What You Measure"

When creating cursor-based animations, don't measure the element you're animating. Find a stable parent element to measure. Otherwise: the interaction changes the element's position based on cursor position, creating a feedback loop.

### Three Flashes Rule (WCAG)

Measuring a changing element can create rapid flickering (>3x/sec). Following the "don't change what you measure" rule eliminates this risk.

## Performance Optimizations

`getBoundingClientRect()` forces DOM layout calculation (1-3ms on low-end devices).

### Solution: Throttle Measurements, Not UI Response

```js
import { throttle } from 'lodash';
const getThrottledBoundingBox = throttle(() => socket.getBoundingClientRect(), 500);

window.addEventListener('pointermove', (event) => {
  const boundingBox = getThrottledBoundingBox(); // Cached for 500ms
  // ... UI updates still happen on every pointermove event
});
```

Don't throttle the pointermove response itself (makes UI laggy). Only throttle the expensive `getBoundingClientRect()`.

## Cursor React Hook: `useRelativeMousePosition`

Provides mouse coordinates relative to center of a specified DOM node, plus bounding box. Uses throttling optimization internally.

```jsx
const ref = React.useRef(null);
const [mousePosition, boundingBox] = useRelativeMousePosition(ref);
```

## Googly Eyes (Polar Coordinates)

For direction-based effects, convert Cartesian to polar, clamp the distance, convert back:

```js
const [angle, distance] = convertCartesianToPolar(relativeX, relativeY);
const modifiedDistance = clamp(distance * 0.1, -15, 15);
const [x, y] = convertPolarToCartesian(angle, modifiedDistance);
```

Polar produces a circular constraint (correct). Clamping X/Y independently produces a square constraint (wrong).

Trigonometry costs ~0.02ms per frame on low-end hardware — negligible.

## Springy Motion with `springValue`

### The Problem

Adding a distance limit causes abrupt snapping when cursor leaves range. CSS transitions don't work for per-frame updates (constantly starting new transitions). `animate()` also isn't designed for per-frame calls.

### The Solution

```js
import { springValue } from 'motion';
const springX = springValue(0, { type: 'spring', stiffness: 200, damping: 20 });
const springY = springValue(0, { type: 'spring', stiffness: 200, damping: 20 });

springX.on('change', (x) => {
  pupil.style.transform = `translate(${x}px, ${springY.get()}px)`;
});
springY.on('change', (y) => {
  pupil.style.transform = `translate(${springX.get()}px, ${y}px)`;
});

// On every pointermove:
springX.set(newX);
springY.set(newY);
```

`springValue` handles interpolation with physics-based easing. More performant than constantly starting new animations.

## Wipe Effects (clip-path)

Using `clip-path: polygon()` for reveal transitions. Pixels inside the polygon are shown, outside are hidden.

```css
/* Hidden: */  clip-path: polygon(0% 100%, 100% 100%, 100% 100%, 0% 100%);
/* Visible: */ clip-path: polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%);
```

Supports CSS transitions between polygons with matching point counts.

### Gotchas

1. **Intangible pixels** — clipped pixels don't respond to pointer events. Lift `:hover` to a parent element (preferably `<button>` for keyboard focus).
2. **Paint order with `drop-shadow`** — put `filter: drop-shadow()` on parent, `clip-path` on child.

### Combining clip-path with transforms

Most polished technique: `clip-path` wipe + subtle `transform: scale(1.05)` or `translateY(10px)`.

Comeau calls clip-path a "secret weapon" — relatively easy but obscure enough that very few sites use it.

## Scroll Animations

### Scroll Progress Timeline

```css
.element {
  animation: spin linear;
  animation-timeline: scroll();
}
```

Maps browser scroll position onto keyframes. 0% at top, 100% at bottom.

### View Progress Timeline

```css
.element {
  animation: fadeIn linear both;
  animation-timeline: view();
  animation-range: entry 0% entry 100%;
}
```

Uses element's position within viewport. Range keywords: `cover` (default), `contain`, `entry`, `exit`.

### Linked Timelines

Animate one element based on another's scroll position:

```css
main { timeline-scope: --content; }
.content { view-timeline: --content; }
.sidebar { animation-timeline: --content; animation-range: contain; }
```

`timeline-scope` reserves the variable at a common ancestor.

### Scroll-Triggered vs Scroll-Driven

- **Scroll-driven:** Maps to scroll position continuously (reading progress, parallax)
- **Scroll-triggered:** Plays independently once threshold crossed (mascot sliding in)

Use `IntersectionObserver` for triggered animations:

```js
const observer = new IntersectionObserver((entries) => {
  const [entry] = entries;
  if (entry.isIntersecting) elem.classList.add('visible');
});
observer.observe(elem);
```

### Parallax

Must ALWAYS be behind `prefers-reduced-motion`. Top of the vestibular hazard list.

```css
@media (prefers-reduced-motion: no-preference) {
  .wrapper img {
    animation: parallax linear;
    animation-timeline: scroll();
  }
}
```

### Smooth Scrolling: DON'T DO IT

Comeau's strong position: smooth scrolling libraries (Lenis etc.) are bad. They subvert user control, hurt accessibility (vestibular disorders), and are "designed to impress other designers." Never use scrolljacking.

### Sticky Blocker Trick

Transparent header + section-colored sticky blockers for seamless background transitions, pure CSS. Each section has a "blocker" element with `position: sticky; top: 0` and matching background color. Sticky elements are contained by their parent, creating natural handoffs.

## View Transitions

### Minimal Implementation

```js
document.startViewTransition(() => {
  // DOM changes here
});
```

Each element needs a unique `view-transition-name`. Browser captures before/after snapshots, animates between them.

### Essential Setup

```css
:root { view-transition-name: none; }
.element { view-transition-name: my-elem; }
.element { view-transition-class: my-class; }
```

### How It Works

1. Capture pixel snapshot of current state
2. Run callback (DOM updates)
3. Capture new state
4. Stack both as pseudo-elements, cross-fade
5. Cleanup when animation ends

### Key Gotchas

1. **Transforms on `::view-transition-group`** — it already uses `transform: matrix()`. Apply custom transforms to `::view-transition-image-pair` instead, or use `animation-composition: add`.
2. **Interrupts** — elements skip hit-testing during transitions. Set `view-transition-name: none` on `:root`. Use aggressive ease-out curves for smoother interrupts.
3. **Clipped elements** — use `view-transition-group: contain` (Chromium-only).
4. **Scroll lag** — keep durations ≤500ms.

### Different Elements

View Transitions can animate between completely different DOM nodes — just needs matching `view-transition-name`. The API doesn't check if it's the same node.

### Cross-Document Transitions

```css
@view-transition { navigation: auto; }
```

Must be on both pages. Put in `<style>` tag, not external stylesheet. Same-origin only. ~81% browser support.

### React Integration

All View Transitions in React are same-document (single HTML file):

```jsx
// Direct API (stable React):
document.startViewTransition(() => {
  React.startTransition(() => setState(newValue));
});

// React Router v7:
<Link to="/" viewTransition>Home</Link>
navigate("/path", { viewTransition: true });
```

`<React.ViewTransition>` component exists in canary only. It queues transitions (no spam-clicking).
