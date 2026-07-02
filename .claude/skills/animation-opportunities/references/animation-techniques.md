# Animation Techniques Reference

Source: Josh Comeau's *Whimsical Animations* course (complete extraction).

## Technique Selection Guide

| Technique | When to use | When NOT to use | Comeau's preference |
|---|---|---|---|
| **CSS Transitions** | Simple property changes between two states (hover, focus, active) | Enter/exit animations; layout changes; spring physics | Default choice for tangible hover effects |
| **CSS Keyframe Animations** | Multi-step sequences, looping animations, partial keyframes, scroll-driven | Simple A→B transitions (use transitions instead) | Use for attention-grabbers, loading states, scroll animations |
| **Spring Physics (linear())** | Organic, physical-feeling motion; boops; interactive elements | Precise timed sequences; frequently interrupted transitions | Preferred over cubic-bezier for most motion |
| **Motion (motion/react)** | Enter/exit, layout animations, shared layout, spring physics, SVG path morphing | Simple hover effects (CSS transitions are simpler) | Go-to for anything CSS can't do alone |
| **View Transitions API** | Route transitions, cross-document transitions, animating conditional rendering, DOM reordering | Drag interactions; elements that must stay interactive during transition | Modern replacement for react-transition-group |
| **CSS `animation-timeline`** | Scroll-driven animations, parallax, reading progress | Hover/click interactions | New native API; replaces JS scroll listeners |
| **Canvas** | Hundreds+ of animated elements, particle systems, generative art, trails | UI elements with text, interactive components needing hover/focus | When DOM node count would be too high (50x more performant than SVG) |
| **SVG Animations** | Animated icons, self-drawing effects, path morphing, masks | Full-page layout animations | Great for icon micro-interactions |
| **IntersectionObserver** | Scroll-triggered (not scroll-driven) animations | Continuous scroll-progress mapping | When animation should play independently once triggered |

## CSS Transitions

**Use for:** Hover effects, focus states, active states, simple state toggles.

```css
.button {
  transition: transform 200ms;
}
.button:hover {
  transform: scale(1.05);
}
```

### Key patterns

**Button scaling trick** — Scale only the border (via `::before` pseudo-element), not the text:

```css
.btn {
  position: relative;
  isolation: isolate;
  border: none;
  background: transparent;
}
.btn::before {
  content: '';
  position: absolute;
  z-index: -1;
  inset: 0;
  border: 1px solid hsl(210deg 15% 25%);
  border-radius: 4px;
  transition: all 200ms;
}
.btn:hover::before {
  width: calc(100% + 10px);
  height: calc(100% + 10px);
  inset: -5px;
}
```

**Asymmetrical transitions** — Different durations/easings for enter vs exit:

```css
.navlink {
  /* Exit: slow, relaxed ease-in */
  transition: background 400ms;
}
.navlink:hover {
  /* Enter: fast, snappy spring */
  transition: background 100ms;
}
.navlink::before {
  transform: scaleY(0);
  transition: transform var(--ease-in) 400ms;
}
.navlink:hover::before {
  transform: scaleY(1);
  transition: transform var(--spring-easing) var(--spring-duration);
}
```

Comeau's rule: exit animations should be ~2x faster than enter animations. Also vary easing curves — spring on enter, ease-in on exit.

**Asymmetrical spring parameters** — Different damping per state creates slingshot effects:

```js
// On hover: high damping (no oscillation)
animate(path, { d: hoveredPath }, { type: 'spring', stiffness: 250, damping: 30 });
// On leave: low damping (elastic wobble)
animate(path, { d: defaultPath }, { type: 'spring', stiffness: 250, damping: 5 });
```

## Entrance reveals (mount) — use `@starting-style`, not a persistent hidden base

**Pitfall (learned on the 7q /pricing redesign):** revealing an element with a
persistent `opacity: 0` base + a keyframe that fades it in **flashes the element
out** under SSR + dev. Route CSS is injected *after* first paint (Vite dev, and
any late stylesheet), so the element paints **visible**, then the stylesheet
lands and slams it to `opacity: 0`, then the keyframe fades it back in.
Visible → gone → in = a flicker.

```css
/* ❌ flashes: opacity:0 is a persistent base style applied whenever CSS loads */
.card { opacity: 0; animation: enter 200ms forwards; }
@keyframes enter { to { opacity: 1; } }
```

**Fix:** `@starting-style`. The element's *normal* state is visible; the hidden
from-state applies **only on insertion**, so there is no persistent hidden base
to flash. Pure CSS, off the main thread. Stagger via `transition-delay` per
`:nth-child`. Always gate behind `prefers-reduced-motion` (default = visible).

```css
@media (prefers-reduced-motion: no-preference) {
  .card {
    opacity: 1;
    transform: translateY(0);
    transition:
      opacity 200ms cubic-bezier(0.23, 1, 0.32, 1),
      transform 200ms cubic-bezier(0.23, 1, 0.32, 1);
  }
  .card:nth-child(2) { transition-delay: 50ms; }
  .card:nth-child(3) { transition-delay: 100ms; }
  @starting-style {
    .card { opacity: 0; transform: translateY(8px); }
  }
}
```

Support: Chrome 117+, Safari 17.5+, Firefox 129+; older browsers skip the
animation and render the element visible (graceful). If you need the hidden
initial state rendered inline *on the server* (no JS-gated reveal), Motion's
`initial` prop is the alternative — it emits the start style inline so there's
no FOUC, at the cost of being JS-gated.

## CSS Keyframe Animations

### Partial keyframes

Omit `from` or `to` to animate from/to the element's current value:

```css
@keyframes fadeToTransparent {
  to { opacity: 0; }
}
```

Adaptive — elements at opacity 0.6 fade from 0.6 to 0, elements at 1 fade from 1 to 0.

### Dynamic keyframes via CSS variables

```css
@keyframes disperse {
  to {
    transform: translate(var(--x), var(--y));
  }
}
```

Set `--x` and `--y` per element in JS. This was "the final puzzle piece that fully unlocked keyframe animations."

### Stacking keyframes

Multiple keyframe animations on the same property multiply their values. A `twinkle` oscillation + `fadeFromTransparent` gradually introduces twinkling.

**Gotcha:** Partial keyframe must come after the full keyframe in the `animation` shorthand.

### Fill modes

- `forwards` — persists final keyframe state after animation ends
- `backwards` — applies initial keyframe state during delay period
- `both` — combines both
- **Tradeoff:** fill modes create high-priority persistent styles that block later CSS/JS changes. Don't blindly apply `both` everywhere.

## Spring Physics

**Use for:** Any motion that should feel organic and physical.

### Spring parameters

- **Stiffness** — energy/coiling. Higher = snappier. 200-400 for UI, 100-150 for gentle.
- **Damping** — friction/resistance. Higher = less oscillation. 20-40 for standard UI, 10-15 for bouncy.
- **Mass** — leave at 1 (Comeau's recommendation).

**Tuning strategy:** Set damping to 20, dial stiffness for speed, then adjust damping for vibe.

Springs only model "ease"-type curves (fast start, decelerate to stop). They can't produce "ease-in" motion.

### CSS springs via `linear()`

The `linear()` timing function approximates spring physics in pure CSS by connecting data points with straight line segments. Values >1 enable spring overshooting.

```css
:root {
  --spring-easing: linear(0, 0.009, 0.037 1.5%, 0.151 3.3%, 0.77 9.4%, 0.994, 1.076, 1.136, 1.178, 1.202 17.6%, 1.207, 1.202, 1.192 21.1%, 1.16 23%, 1.055 27.9%, 1.009, 0.975 33.3%, 0.959 36.2%, 0.96 39.9%, 0.998 49.2%, 1.008 54.7%, 0.998 73%, 1);
  --spring-duration: 0.833s;
}
```

**Quality:** 11 points = robotic; 50 = convincing. Strategic point clustering halves needed points.

**Tools:** [Linear() Easing Generator](https://linear-easing-generator.netlify.app/) by Jake Archibald, [Easing Wizard](https://easingwizard.com/).

### `linear()` limitations

1. **Time-based** — can't do infinite springs (they must settle in a specific duration)
2. **Interrupts are the biggest issue** — CSS reversing shortening factor compresses the timing function, making interrupted springs feel unnatural and fast-forwarded
3. **Performance is fine** — ~1.2kB gzip for 3 springs, no framerate impact

**Comeau's rule:** `linear()` for most things, JS library (Motion) for important interruptible transitions.

### Comeau's favourite pattern — Spring design tokens

Define 3-4 global springs as CSS custom properties:

```css
:root {
  --spring-default: linear(/* ... */);
  --spring-default-duration: 0.633s;
  --spring-bouncy: linear(/* ... */);
  --spring-bouncy-duration: 0.833s;
  --spring-stiff: linear(/* ... */);
  --spring-stiff-duration: 0.4s;
}
```

Use globally for ~80% of animations. Create bespoke springs for the other ~20%.

**Fallback pattern:**

```css
@supports not (transition-timing-function: linear(0, 1)) {
  :root {
    --spring-default: cubic-bezier(0.25, 0.1, 0.25, 1);
    --spring-default-duration: 300ms;
  }
}
```

### Motion springs (React)

```jsx
<motion.div
  layout={true}
  transition={{ type: 'spring', stiffness: 200, damping: 40 }}
/>
```

### `springValue` for per-frame cursor tracking

```js
import { springValue } from 'motion';
const springX = springValue(0, { type: 'spring', stiffness: 200, damping: 20 });
springX.on('change', (x) => { elem.style.transform = `translate(${x}px, ...)`; });
// On every pointermove:
springX.set(newX);
```

Use `springValue` for cursor interactions — not `animate()` (which isn't designed for per-frame calls).

## Boops (Micro-Interaction Pattern)

**Use for:** Icon buttons, interactive elements that benefit from playful feedback.

Temporarily apply a transform on hover, then undo it after a short timeout. The spring easing handles the bounce-back. Like wind chimes — runs to completion even on brief contact.

```js
function attachBoop(triggerNode, applyBoop, removeBoop, boopDuration = 150) {
  triggerNode.addEventListener('mouseenter', () => {
    if (!window.matchMedia('(prefers-reduced-motion: no-preference)').matches) return;
    applyBoop();
    window.setTimeout(() => removeBoop(), boopDuration);
  });
}
```

Variants: `rotate(20deg)` for icon buttons, `scale(1.05)` for card/button borders, `translateY(-2px)` for lift effects.

## Layout Animations (Motion)

**Use for:** Animating between fundamentally different CSS layouts (grid→absolute, minimized→maximized, reordering).

```jsx
<motion.div layout={true} transition={SPRING} className={isMaximized ? 'maximized' : 'default'}>
  <motion.p layout="position" transition={SPRING}>Content</motion.p>
</motion.div>
```

**`layout` prop values:** `true` (position + size), `"position"` (translate only), `"size"` (scale only).

**Critical gotchas:**
1. **Text distortion** — Nest `<motion.p layout="position">` to cancel parent's scale
2. **Transition inheritance** — Copy `transition` prop to all nested motion children
3. **Shrinkwrap text** — Use flexbox `justify-content: center` on parent
4. **`initial={false}`** — Prevents unwanted enter animation on mount

**Troubleshooting checklist:** Stretched text → wrap in `layout="position"`; Jiggling → same transition on parent+child; Twitchy corners → `initial={{ borderRadius: 32 }}`; Teleporting → wrap in `<LayoutGroup>`; No animation → check for `display: inline`.

## Shared Layout (Motion)

```jsx
<motion.div layoutId="highlight" />
```

Elements with the same `layoutId` animate between positions across renders. Use `React.useId()` for unique IDs. Always use the same value for `layoutId` and `key`.

## View Transitions API

**Use for:** Route transitions, DOM reordering, animating conditional rendering.

```js
if (document.startViewTransition) {
  document.startViewTransition(() => { /* DOM changes */ });
} else {
  /* DOM changes (fallback) */
}
```

### Essential setup

```css
:root { view-transition-name: none; }        /* Disable root capture for interactivity */
.element { view-transition-name: my-elem; }   /* Create named group */
.element { view-transition-class: my-class; } /* Batch CSS targeting */
```

### Production checklist
1. Feature-detect `document.startViewTransition`
2. Respect `prefers-reduced-motion`
3. Disable root VT for interactivity
4. Use aggressive ease-out curves for smoother interrupts
5. Apply transforms to `::view-transition-image-pair`, NOT `::view-transition-group` (which already uses `transform: matrix()`)
6. Use `view-transition-group: contain` for clipped elements (Chromium-only)
7. Keep durations ≤500ms to avoid scroll-lag

### Cross-document transitions

```css
@view-transition { navigation: auto; }
```

Must be on both pages. Put in `<style>` tag, not external stylesheet. Same-origin only. ~81% browser support.

### React integration
- Official `<React.ViewTransition>` (canary only) — queues transitions, no spam-clicking
- Direct API (stable today) — `document.startViewTransition(() => React.startTransition(() => setState(...)))`
- React Router v7: `<Link viewTransition>`, `navigate(path, { viewTransition: true })`

## Scroll-Driven Animations

### Scroll progress timeline

```css
.element {
  animation: spin linear;
  animation-timeline: scroll();
}
```

### View progress timeline

```css
.element {
  animation: fadeIn linear both;
  animation-timeline: view();
  animation-range: entry 0% entry 100%;
}
```

**Animation range keywords:** `cover` (default), `contain`, `entry`, `exit`. Mix with percentages.

### Linked timelines (animate based on another element's scroll position)

```css
main { timeline-scope: --content; }
.content { view-timeline: --content; }
.sidebar { animation-timeline: --content; }
```

### Scroll-triggered (not scroll-driven)

Use `IntersectionObserver` for animations that should play independently once a threshold is crossed.

**Choosing:** Scroll-driven when you care about continuous progress. Scroll-triggered when animation has choreography that shouldn't pause halfway.

## Staggered Animations

Sequence: parent fades in → content fades in after delay → decorative elements last.

```css
.dropdown { transition: opacity 250ms; }
.dropdown .content { transition: opacity 250ms; transition-delay: 125ms; }
```

**Rules:** Total duration <500ms. Delay = 30-70% of parent duration. Reverse on exit. Exit 2x faster. For conditional rendering (Radix etc.), use keyframe animations instead of transitions.

## Action-Driven Animations

Apply different transitions based on which *action* triggered the state change (confirm vs cancel, not just open vs closed). Use `data-action` attributes.

## Squash and Stretch

Disney's first principle. When compressing one axis, expand the other. Best at 25-50% range. `transform-origin: center bottom` keeps element grounded.

## Nested Transforms

Parent rotation + child rotation compound. Set different `transform-origin` per element. Different spring settings: parent = stiff/damped, child = wobbly. Delay child by 100ms for causal feel.

## Wipe Effects (clip-path)

```css
/* Hidden: */  clip-path: polygon(0% 100%, 100% 100%, 100% 100%, 0% 100%);
/* Visible: */ clip-path: polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%);
```

Combinable with subtle `transform: scale(1.05)` or `translateY(10px)` for polished reveals. `clip-path` makes pixels intangible — lift `:hover` to a parent element.

## Self-Drawing SVG Paths

**Recommended approach:** `stroke-dashoffset` sliding (fixes linecap bug):

```css
.path {
  stroke-dasharray: 100, 1000;
  stroke-dashoffset: 100px;
  transition: stroke-dashoffset 1000ms;
}
.path.visible { stroke-dashoffset: 0px; }
```

Use `pathLength="100"` attribute for normalized 0-100 scale regardless of actual path length.

## Canvas Techniques

- **Trails** — semi-transparent `fillRect` instead of `clearRect`
- **Sine motion** — `Math.sin(time)` for organic oscillation; cos for Y axis = circular motion
- **Simplex noise** — always prefer over Perlin; divide inputs by 100-200 for smooth curves
- **Delta time** — express velocity in px/sec for refresh-rate independence
- **OffscreenCanvas** — transfer to Web Worker for heavy computations

## Sound Effects

Play at 10-50% volume, keep under 1 second, always include mute button. Multiple sample variants with random selection. Pitch variation via `sound.rate()`. Novelty matters — sound is rare on web, so even subtle SFX create moments of delight.

## Personalized Animations

Check Local Storage (or user DB) for visit count. Full animation on first visit; skip on return. Never force users to sit through the same long animation repeatedly.

## Timing Functions Quick Reference

| Function | Best for | Character |
|---|---|---|
| `linear` | Continuous rotation (spinners) | Robotic, mechanical |
| `ease` | General-purpose default | Snappy start, gradual stop |
| `ease-in` | Exit animations (leaving screen) | Slow start → accelerating away |
| `ease-out` | Enter animations (arriving) | Fast arrival → gentle stop |
| `ease-in-out` | Oscillating/alternating animations | Symmetrical, graceful |
| `linear()` spring | Most UI motion | Organic, physical, overshooting |
| Custom `cubic-bezier` | Exaggerated versions of above | Dramatic, opinionated |

**Technique:** Exaggerate built-in presets by dragging handles further. Compensate with longer duration for perceived speed.
