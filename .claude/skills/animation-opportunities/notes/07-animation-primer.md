# Reference: Animation Primer

Source: Josh Comeau's *Whimsical Animations* course.

## Keyframe Animations

```css
@keyframes name { from { } to { } }
.element { animation: name 1000ms; }
```

Shorthand properties: name, duration, iteration-count, timing-function, direction. Order doesn't matter except delay must come after duration. `infinite` for loops, `alternate` for ping-pong. Percentages (0%-100%) for multi-step animations. Keyframe definitions are hoisted in CSS.

## Fill Modes

Keyframe CSS only applies while animation is running — evaporates when done.

- `forwards` — persists final keyframe state
- `backwards` — applies initial keyframe state during delay
- `both` — combines both

**Tradeoff:** Fill modes create high-priority persistent styles that block later CSS/JS changes. Don't blindly apply `both` everywhere.

## Transforms

- `translate(x, y)` — percentage is relative to element's own size (unique in CSS)
- `scale(n)` — treats element as texture (no re-layout)
- `rotate(deg)` — rotates around center by default
- `skew(deg)` — tilts; rarely used outside diagonal stripes
- Transforms happen after layout calculations, don't affect siblings
- Inline elements (`<span>`) can't be transformed — need `display: inline-block`

## Transform Origins

`transform-origin` sets the pivot point. Accepts keywords, percentages, or pixels. Multiple transforms apply right-to-left. Transforms don't move the pivot point — translate then rotate causes orbiting.

## Standalone Transform Functions

`scale`, `translate`, `rotate` as independent CSS properties:

- Key benefit: independent keyframe animations target different properties without overwriting
- Fixed application order: scale → rotate → translate (can't change)
- No 3D/skew, ~95% browser support
- Comeau's preference: default to `transform` except when standalone clearly simplifies

## CSS Variables (Custom Properties)

Defined with `--name: value`, accessed with `var(--name)`. Inheritable by default. Global: define on `html` or `:root`. JS access: `elem.style.setProperty('--name', value)`. Reactive — changing a variable updates all CSS using it. Unlike Sass, native CSS vars are dynamic and runtime-updateable.
