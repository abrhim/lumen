# Bonus: Animation Design

Source: Josh Comeau's *Whimsical Animations* course.

## Animation Categories

Four categories — every animation must serve at least one:

1. **Tangible** — make the UI feel physical/real (hover effects, transitions, skeuomorphic hints). Works on a subconscious level. Most common type.
2. **Informative** — "show don't tell" (product feature demos, animated diagrams). Simple concepts, extremely complex orchestration. Requires a11y fallback.
3. **Attention-focusing** — direct user attention (form errors, CTA shimmer, notification bounces). High annoyance risk if overused.
4. **Joyful** — spark positive emotion (confetti, decorative effects). Strong business case for brand differentiation.

Categories are not mutually exclusive. If an animation doesn't match any category, remove it.

## The Big Mistake

Animations without intent — a hodgepodge of cool effects without a core vision.

**Rules:**
- Derive animations from a core design concept (e.g., Linear → monochromatic, elements get brighter on hover)
- Share concepts, not code — same idea across components but varied implementation
- Consistency > novelty

## Hover Transitions

Only add hover transitions to interactive elements (buttons, links, form fields). Hover on non-interactive elements implies clickability and feels unprofessional.

**Exception:** If hover serves a secondary purpose (informative), it's OK on non-interactive elements.

## Button Scaling Trick

Scale only the `::before` pseudo-element (border), not the text:

```css
.btn { position: relative; isolation: isolate; }
.btn::before { content: ''; position: absolute; z-index: -1; inset: 0; border: 1px solid; transition: all 200ms; }
.btn:hover::before { width: calc(100% + 10px); height: calc(100% + 10px); inset: -5px; }
```

Avoids text blurriness from GPU transfer during scale.

## Boops

Temporarily apply transform on hover, undo after 150ms timeout. Spring easing handles bounce-back. Like wind chimes — runs to completion even on brief contact.

Works with `rotate()`, `scale()`, `translateY()`. Always check `prefers-reduced-motion`.

## Squash and Stretch

Disney's first principle. When compressing one axis, expand the other (conservation of volume). Best at 25-50% range. Small icons (16px) need more exaggeration. `transform-origin: center bottom` keeps element grounded.

## Asymmetrical Animations

Use different transition settings for enter vs leave. Lowest-hanging fruit: fast/snappy on hover (100-200ms), slow/relaxed on leave (400-600ms). Also vary easing curves and spring damping per state.

## Action-Driven Animations

Animate based on user action, not just state. Dialog confirm → bounces away. Dialog cancel → evaporates. Communicates which button was clicked. Use `data-action` attributes.

## Nested Transforms

Parent rotation + child rotation compound. Different spring settings per nesting level (parent = stiff, child = wobbly). Delay child by 100ms for causal feel. Creates joint/finger-like bending.

## Staggered Animations

Sequence: parent fades in → content after delay → decorative elements last. Total duration <500ms. Delay = 30-70% of parent duration. Reverse order on exit. Exit 2x faster than enter.

## Personalized Animations

Check Local Storage for visit count. Full animation on first visit; skip on return. Never force users to sit through the same long animation repeatedly.

## Sound Effects

Subtle SFX make UIs feel tactile. Play at 10-50% volume, keep under 1 second, always include mute button. Multiple sample variants with random selection. Pitch variation via `sound.rate()`.
