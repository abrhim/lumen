# Animation Performance Guide

Source: Josh Comeau's *Whimsical Animations* course (complete extraction).

## Safe vs Expensive Properties

### GPU-Accelerated (Safe to animate freely)

| Property | Notes |
|---|---|
| `transform` (translate, scale, rotate) | Gold standard. Sub-pixel rendering in Chromium. Skips layout + paint. |
| `opacity` | Composited on GPU. Ideal for fades. |
| `filter` (blur, brightness, etc.) | GPU-composited in modern browsers. |
| `clip-path` | GPU-composited. Supports CSS transitions between polygons with matching point counts. |

### Layout-Triggering (Animate with caution)

| Property | Notes |
|---|---|
| `width`, `height` | Triggers layout recalculation every frame. OK for isolated elements, bad at scale. |
| `top`, `left`, `right`, `bottom` | Triggers layout. Use `transform: translate()` instead. |
| `padding`, `margin` | Triggers layout. Avoid animating. |
| `border-width` | Triggers layout. Use `outline` or `box-shadow` for animated borders. |
| `font-size` | Triggers layout + reflow. Never animate. |

### The "Transforms or Bust" Myth

Comeau's position: **transforms are preferred but not mandatory.** Animating `width` or `height` is acceptable when:
- The element is isolated (not in a complex layout)
- You've tested on low-end devices and it's smooth
- The animation requires text reflow (transforms squash text like an image)

**Always test on real devices.** CPU throttling in DevTools doesn't fully represent real-world performance.

## Sub-Pixel Rendering

CSS `transform` enables sub-pixel rendering in Chromium browsers — pixels fade in/out to simulate movement at a fraction-of-a-pixel granularity. This makes animations appear significantly smoother, especially on:
- Low-DPI (1x) displays where each pixel is larger
- Small movements (2-4px range) where steppiness is most visible

**Not available when animating layout properties** (`width`, `height`, `top`, `left`), which snap to integer pixel boundaries.

Firefox: adding a negligible `rotateZ(0.1deg)` to the transform can trigger similar smoothing.

Canvas also implements sub-pixel rendering — don't round to nearest pixel.

## The 16.6ms Frame Budget

At 60fps (standard refresh rate), each frame has **16.6ms** to complete all work:

```
Scripting → Style Recalc → Layout → Paint → Composite = must complete in <16.6ms
```

**Guidelines:**
- Aim to use <5ms per frame for animation work, leaving headroom for other page activity
- CSS transforms skip Layout and Paint steps entirely (go straight to Composite)
- Layout-triggering properties force the browser through all steps every frame
- Trigonometry (sin, cos, atan2, sqrt) costs ~0.02ms per frame on low-end hardware — negligible

## CSS vs JS Animation Threading

| Approach | Thread | Interrupted by main thread? |
|---|---|---|
| CSS transitions/keyframes | Compositor thread (separate) | No — continues smoothly |
| Motion library (WAAPI-based) | Compositor thread | No — Matt Perry's achievement |
| GSAP / most JS libraries | Main thread | Yes — freezes when thread is busy |
| `requestAnimationFrame` loop | Main thread | Yes |
| Canvas `requestAnimationFrame` | Main thread | Yes (use OffscreenCanvas + Worker to fix) |

**Comeau's rule:** Use native CSS whenever possible. When CSS can't handle it, use Motion (which uses WAAPI). Avoid libraries that only wrap CSS functionality without enabling new capabilities.

## Chrome Performance Tab Quick Reference

| Row | What it shows |
|---|---|
| **Frames** | Duration of each painted frame. Green = good. Red = exceeded budget. |
| **Animations** | Every running CSS keyframe animation. |
| **Main** | All tasks. Color coded: yellow=JS, purple=style/layout, green=paint, grey=system. |

**Red flags in the timeline** indicate a task exceeded the frame budget.

### Profiling checklist
1. Record a 5-6 second performance timeline
2. Check Frames row — each frame should be ~16ms
3. Check Main thread — look for large blocks with little empty space
4. Enable Memory checkbox to track DOM node count
5. Repeat on lowest-end device available
6. **Firefox is NOT representative** — its WebRender engine is far more efficient. Always test in Chromium.

## DOM Node Cleanup

When creating elements dynamically (particles, notifications, list items):
- **Always clean up** — remove DOM nodes after their animation completes
- Use `setTimeout` to remove after `animationDuration + buffer`
- Uncleaned nodes accumulate, consuming memory until GC runs
- Modern V8 GC is non-blocking but still costs CPU (~5ms per 2000 nodes)
- **Object pooling is premature optimization** — modern GC handles cleanup fine; simplicity wins

## Canvas vs DOM Performance

Quantitative benchmarks from community testing:

| Technique | Avg threshold before choppiness | Low-end device (10th percentile) |
|---|---|---|
| Vanilla SVG | ~3,600 elements | 256 elements |
| React-managed SVG | ~6,900 elements | — |
| Canvas | ~25,600 draw calls | 13,924 draw calls |

**Canvas is ~50x more performant than SVG on low-end devices.** Use Canvas for hundreds+ of simultaneously animated elements.

### Canvas decision framework
1. Will it be computationally expensive (thousands of moving shapes)? → Canvas
2. Does it contain accessible text that should be announced? → SVG
3. Neither? → SVG (better DX: CSS pseudo-classes, transitions work natively)

### Canvas performance patterns
- **Delta time** — express velocity in px/sec, not px/frame, for refresh-rate independence: `distance = velocity * deltaTime`
- **Cap deltaTime** — `Math.min(elapsed, 250) / 1000` to handle background tab throttling
- **OffscreenCanvas + Web Worker** — transfer rendering to separate thread for heavy computations (~96% browser support)
- **requestAnimationFrame** — never `setInterval` for animation loops

## Device Testing Arsenal

Comeau recommends maintaining low-end devices for testing:
- One cheap Windows laptop (~$100 — low-end CPU, no GPU)
- One budget Android phone (~$90 — 2-3 year old budget model)
- One older iPhone (previous generation)

Check local classifieds for $10-50 used devices. You want the *worst* devices possible.

## Reduced Motion Accessibility

### CSS: Default to motion-free

```css
@media (prefers-reduced-motion: no-preference) {
  .element {
    transition: transform 300ms;
  }
}
```

Safer than the inverse pattern — unsupported browsers show no animation rather than potentially triggering vestibular issues.

### JavaScript: Check motion preference

```js
function prefersMotion() {
  return window.matchMedia('(prefers-reduced-motion: no-preference)').matches;
}
```

### React: `<MotionConfig>` wrapper

```jsx
<MotionConfig reducedMotion="user">
  <App />
</MotionConfig>
```

Single wrapper respects system motion preferences across entire app.

### React hook

```tsx
function usePrefersReducedMotion() {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(true);
  useEffect(() => {
    const mql = window.matchMedia('(prefers-reduced-motion: no-preference)');
    setPrefersReducedMotion(!mql.matches);
    const handler = (event) => setPrefersReducedMotion(!event.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);
  return prefersReducedMotion;
}
```

### What to disable vs keep

| Disable for reduced-motion | Keep for reduced-motion |
|---|---|
| Anything that appears to move (translate, rotate, scale) | Opacity fades (unless they create illusion of motion) |
| Parallax scroll effects (top of the hazard list) | Color transitions |
| Bouncing/shaking attention animations | Instant state changes (no transition) |
| Decorative particle effects | Static alternatives to animated explanations |
| Sequential fading that creates illusion of motion | View Transitions with cross-fade only (no sliding keyframes) |
| Smooth scrolling / scrolljacking | |

### Give users control

For pages where motion is a core feature, offer an opt-in toggle that overrides the system `prefers-reduced-motion` setting. Don't rely solely on the media query.

### Testing

Chrome DevTools: Command Palette (⌘+Shift+P) → "Emulate CSS prefers-reduced-motion: reduce". Emulation only active while devtools are open.

### Three flashes rule (WCAG)

Never flicker between two states faster than 3 times per second. Cursor-based animations that measure the element they're animating can create feedback loops that violate this.

## Motion Library Performance Notes

- Layout animations use CSS transforms internally (layout projection) — performant by default
- `layout={true}` triggers per-frame style recalculation for nested content — limit nesting depth
- `AnimatePresence` keeps DOM nodes alive during exit animations — cleaned up after completion
- Spring physics are computed in JS but applied via transforms — GPU-composited
- Motion uses WAAPI under the hood — runs on compositor thread, not main thread
- For 50+ simultaneously animating elements, consider Canvas instead of Motion
- `springValue` for per-frame cursor tracking (not `animate()` which isn't designed for per-frame calls)
- Bundle size: ~30.6kB gzip. React Spring is lighter at ~19.2kB if you only need spring interpolation.

## `linear()` Performance

- ~1.2kB gzip for 3 spring definitions — negligible
- No framerate impact — browser resolves timing functions natively
- 50 data points is sufficient for convincing spring approximation
- Strategic point clustering (more points near fast motion) halves the needed total
