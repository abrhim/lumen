# Bonus: Layout Animations with Motion

Source: Josh Comeau's *Whimsical Animations* course.

## Getting Started with Motion

```jsx
import { motion } from 'motion/react';

<motion.div animate={{ y: isEnabled ? 0 : 60 }} transition={{ type: 'spring', stiffness: 200, damping: 25 }} />
```

- Default physics are spring-based (preferred over tween/bezier)
- `initial={false}` disables enter animation on mount
- Styled-components: `styled(motion.button)`
- Uses JS Proxies — `motion.div`, `motion.path`, `motion.anything` all work

## Layout Animations

The `layout` prop animates CSS layout changes that CSS transitions can't handle (property swaps, position changes, reflow):

```jsx
<motion.div layout={true} transition={SPRING} className={isMaximized ? 'maximized' : 'default'}>
  <motion.p layout="position" transition={SPRING}>Content</motion.p>
</motion.div>
```

**`layout` values:** `true` (position + size), `"position"` (translate only), `"size"` (scale only).

Uses layout projection (successor to FLIP technique) — measures before/after bounding boxes, tweens with CSS transforms.

### Critical Gotchas

1. **Text distortion** — transforms treat elements as flat textures. Nest `<motion.p layout="position">` to cancel parent's scale.
2. **Transition inheritance** — settings don't inherit. Copy `transition` prop to all children.
3. **Shrinkwrap text** — use flexbox `justify-content: center` on parent.

## Shared Layout

```jsx
<motion.div layoutId="highlight" />
```

Elements with same `layoutId` animate between positions across renders. Use `React.useId()` for unique IDs. Always use same value for `layoutId` and `key`.

**`layoutId` must be globally unique and truthy** (0 is falsy, gets ignored).

Wrap related animations in `<LayoutGroup>` to batch calculations.

## Motion Accessibility

```jsx
<MotionConfig reducedMotion="user">
  <App />
</MotionConfig>
```

Single wrapper respects system `prefers-reduced-motion`. Use `useReducedMotion` hook for finer control (e.g., fade instead of slide).

## Troubleshooting

| Problem | Fix |
|---|---|
| Stretched text | Wrap in `<motion.p layout="position">` |
| Text snapping | Shrinkwrap with flex/justify-center |
| Jiggling | Same `transition` on parent + child |
| Twitchy corners | `initial={{ borderRadius: 32 }}` |
| Teleporting | Wrap in `<LayoutGroup>` |
| Disappearing | Same value for `layoutId` and `key` |
| No animation | Check for `display: inline` (needs `inline-block`) |
| Unwanted layout animation | Use `layoutRoot` |
