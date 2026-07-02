# Part 1: Particles

Source: Josh Comeau's *Whimsical Animations* course.

## Containment Strategies

When generating particles by selecting random `top`/`left` values between 0% and 100%, particles overflow on the right and bottom sides. The reason: `top` and `left` control the position of the element's top-left corner, not center. Percentages for `top`/`left` refer to the size of the container.

### Solution 1: Adjusting the Anchor Point

Use `transform: translate(-50%, -50%)` to shift the element so its center becomes the anchor point. With transforms, percentages refer to the element's own size, not the container's size.

### Solution 2: Perfect Containment (Inverse Transforms)

Use CSS custom properties with inverse transforms:

```css
.star {
  --top: 0%;
  --left: 100%;
  position: absolute;
  top: var(--top);
  left: var(--left);
  transform: translate(
    calc(var(--left) * -1),
    calc(var(--top) * -1)
  );
}
```

At `--left: 100%`, the element shifts 100% of the container to the right via `left`, then -100% of its own width back via transform. The compensation scales linearly with position.

## Partial Keyframes

### Omitting `from`

```css
@keyframes fadeToTransparent {
  to { opacity: 0; }
}
```

When you omit the `from` value, the animation starts from the element's current value. Elements at opacity 0.6 fade from 0.6 to 0. Makes keyframes adaptive.

### Omitting `to`

Animates FROM a specified value TO the element's current value. Useful for enter animations that need to respect the element's target state.

### Stacking Keyframes

Multiple keyframe animations on the same property multiply their values. A `twinkle` oscillation + `fadeFromTransparent` gradually introduces twinkling.

**Gotcha:** Partial keyframe must come after the full keyframe in the `animation` shorthand.

**Browser support:** Stacking trick doesn't work in mobile Safari before iOS 17 (Sept 2023). Workaround: use a wrapper `<div>` so each keyframe applies to a separate element.

## Dispersion

Particles need to fly outward from center. Two approaches:

**Rejected: CSS Transitions + setTimeout** — transitions are for state changes, not enter animations.

**Used: Partial Keyframes** — keyframe specifies only `from` position (center), `to` is inherited from inline styles:

```css
@keyframes fromCenter {
  from { top: 50%; left: 50%; }
}
```

Use CSS custom properties for different animation durations:

```css
.particle {
  animation:
    fadeToTransparent var(--fade-duration) forwards,
    fromCenter var(--disperse-duration);
}
```

**Note:** Comeau explicitly recommends against using `@starting-style` — he removed the lesson and wrote about the "big gotcha" instead.

## Timing Functions (Easings)

The timing function determines how interpolation is distributed over time. Different routes from A to B produce very different character.

### Built-in Functions

| Function | Best for | Character |
|---|---|---|
| `linear` | Continuous rotation (spinners) | Robotic, mechanical |
| `ease` | General-purpose default | Snappy start, gradual stop (asymmetrical) |
| `ease-in` | Exit animations (leaving screen) | Slow start, accelerating away |
| `ease-out` | Enter animations (arriving) | Fast arrival, gentle stop |
| `ease-in-out` | Oscillating/alternating animations | Symmetrical, graceful |

**Naming confusion:** "ease" is both a generic term and a specific CSS keyword. The default `ease-in` and `ease-out` curves are too subtle — custom curves fix this.

## Custom Curves

All built-in timing functions use Bezier curves via `cubic-bezier()`. The keywords are syntactic sugar.

### Technique 1: Exaggerate Built-in Presets

1. Identify the right curve type for your animation
2. Start with that built-in preset
3. Drag the handles further in the direction they're already going

**Warning:** Over-exaggeration causes elements to appear to jump/teleport. No frames painted in the middle of the transition.

### Technique 2: Exaggerate + Compensate with Duration

For maximum drama, exaggerate the curve aggressively AND increase the duration. With super-exaggerated ease-out, 90% of motion happens in the first few hundred ms. Despite 1500ms total, it feels zippy.

**Key insight:** Perceived speed matters more than technical duration. Animation guidelines say 300ms is normal and 500ms+ is glacially slow. But with exaggerated curves, 1500ms can still feel fast.

### Design System Approach

- Small/subtle animations: reusable global easing curves as design tokens (~80%)
- Big splashy animations: custom one-off curves (~20%)

**Tool:** [Easing Wizard](https://easingwizard.com/) — Comeau's go-to.

## Dynamic Keyframes

CSS variables can be read from within keyframe animations:

```css
@keyframes oscillate {
  from { transform: translateX(calc(var(--amount) * -1)); }
  to { transform: translateX(var(--amount)); }
}
```

Set `--amount` per element via inline styles. This was "the final puzzle piece that fully unlocked keyframe animations."

### Dynamic Destinations

```css
@keyframes disperse {
  to { transform: translate(var(--x), var(--y)); }
}
```

Set `--x` and `--y` per particle in JavaScript.

## Object Pooling

Game-development optimization: reuse DOM elements instead of creating new ones. Maintain an array of "spent" particles.

### Performance Analysis

Both approaches (create new vs. pool) are nearly identical. Modern browsers' garbage collectors handle cleanup without affecting frame rate. Both use ~2.4% of scripting time.

### Why NOT to do this

1. **Complexity breeds bugs** — recycled nodes carry over CSS variables, styles, attributes
2. **Can block garbage collection** — pool array prevents GC of hundreds of nodes
3. **Premature optimization** — simple approach is equally performant

> "The more time I spend programming, the more I value simplicity."

## Particle Distribution

True randomness is "clumpy" — all 5 particles land in the same 180-degree band ~30% of the time.

### Solution: Derived Angles with Jitter

1. Divide 360 degrees into equally-sized wedges based on particle count
2. Assign each particle to its wedge
3. Add controlled randomness (JITTER = +/-40 degrees)

```js
const JITTER = 40;
const angle = 360 / NUM_OF_PARTICLES * index + random(-JITTER, JITTER);
const distance = random(32, 64);
```

Feels more random than true randomness because it guarantees no clumping.

## Linear Interpolation (normalize)

Transposing a value from one scale to another:

```js
const normalize = (number, currentScaleMin, currentScaleMax, newScaleMin = 0, newScaleMax = 1) => {
  const standardNormalization = (number - currentScaleMin) / (currentScaleMax - currentScaleMin);
  return (newScaleMax - newScaleMin) * standardNormalization + newScaleMin;
};
```

### Utility Functions

```js
export const clamp = (val, min = 0, max = 1) => {
  if (min > max) { [min, max] = [max, min]; }
  return Math.max(min, Math.min(max, val));
};

export const clampedNormalize = (number, currentScaleMin, currentScaleMax, newScaleMin = 0, newScaleMax = 1) => {
  return clamp(normalize(number, currentScaleMin, currentScaleMax, newScaleMin, newScaleMax), newScaleMin, newScaleMax);
};
```

Custom `clamp` auto-swaps min/max to handle inverse mappings correctly (unlike Lodash's `_.clamp`).

## Juice

Reference: "Juice it or lose it" talk by Martin Jonasson and Petri Purho.

### The Core Principle

> "Whimsy can't be npm install-ed."

Generic effects like `canvas-confetti` (3M+ monthly npm installs) lose charm through ubiquity. Effects that spark joy must be custom and bespoke, tailored for the specific product. When an effect becomes predictable, it stops being whimsical.
