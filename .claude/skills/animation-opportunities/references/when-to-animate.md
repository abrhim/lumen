# When to Animate — Decision Matrix

Source: Josh Comeau's *Whimsical Animations* course (complete extraction).

## The Four Animation Categories

Every animation must serve at least one of these purposes. If it doesn't fit any category, remove it.

| Category | Purpose | Typical triggers | Impact | Risk |
|---|---|---|---|---|
| **Tangible** | Make the UI feel physical, polished, real | Hover on interactive elements, click/tap feedback, state transitions, drawer/modal open-close | High — subconscious; builds cumulative polish | Low if subtle; high if applied to non-interactive elements |
| **Informative** | Show don't tell — demonstrate how something works | Product feature demos, data visualization, onboarding flows, complex process explanation | High — replaces paragraphs of explanation | Requires a11y fallback (static content for reduced-motion users) |
| **Attention-focusing** | Direct user attention to a specific UI element | Form validation errors, notification badges, CTA shimmer, toast entry, new content indicators | High — feedback reduces confusion; CTA drives action | Very high annoyance risk if overused or looping |
| **Joyful** | Spark positive emotion, build brand affinity | Confetti on achievement, playful hover effects, decorative hero animations, easter eggs | Medium — memorable but not functionally necessary | Business case exists (brand differentiation, memorability) but must not delay tasks |

Categories are **not mutually exclusive**. An animation can be tangible *and* attention-focusing. Multi-category animations tend to be the most justified.

Also valid (Rachel Nabors' framework from *Animation At Work*): Transitions, Supplements, Feedback, Demonstrations, Decorations.

## The Big Mistake

> Animations without intent — a hodgepodge of cool effects and borrowed ideas, without any core vision.

### Rules derived from this principle

1. **Derive animations from a core design concept.** Define 2-3 words describing your product's aesthetic (e.g., Linear → "sleek monochromatic tech"). All animations should feel natural within that concept.
2. **Share concepts, not code.** Reuse the same *idea* (e.g., "elements get brighter on hover") across components, but allow implementation to vary. A single `<AnimatedButton>` used everywhere grows stale.
3. **Consistency > novelty.** Two consistent animation patterns across 20 components beats 20 unique effects.
4. **If the animation doesn't match any category, remove it.** This is the litmus test.

## The Juice Principle

> "Whimsy can't be npm install-ed."

Generic effects (`canvas-confetti`, off-the-shelf libraries with 3M+ downloads) lose charm through ubiquity. Effects that spark joy must be **custom and bespoke**, tailored for the specific product and use case. When an effect becomes predictable, it stops being whimsical.

## Trigger Pattern → Animation Decision

| Trigger pattern | Recommended category | When to animate | When NOT to animate |
|---|---|---|---|
| **Hover on interactive element** (button, link, card with action) | Tangible | Always — signals interactivity | Never hover-animate non-interactive elements (images, logos, text) |
| **Hover on non-interactive element** | Tangible + Informative | Only if it serves a secondary purpose (e.g., demonstrating product feature) | Purely decorative hover on static content misleads users |
| **Component mount/unmount** | Tangible | Enter/exit animations smooth jarring layout shifts | Don't animate if the component appears above the fold on initial load (delays LCP) |
| **Route transition** | Tangible | View Transitions or cross-fade to maintain spatial context | Don't if it adds perceived latency to navigation |
| **Data loading / skeleton → content** | Tangible | Fade or slide content in to avoid harsh pop-in | Don't animate individual list items if there are 50+ (stagger cap at ~10) |
| **Form validation error** | Attention-focusing | Shake, border flash, or icon animation to draw eye | Don't animate the error *text* — that needs to be immediately readable |
| **Dialog open/close** | Tangible + Action-driven | Different exit animations for confirm vs cancel | Don't delay the action — animation must not block the confirmed operation |
| **Success/achievement** | Joyful | Custom celebratory animation (NOT generic confetti) | Don't use for routine actions (saving a form field shouldn't trigger confetti) |
| **CTA button** | Attention-focusing | Subtle shimmer or pulse to draw first-time attention | Don't loop indefinitely — one-shot or very slow cycle |
| **Scroll-into-view** | Tangible or Informative | Fade-in, slide-up for content entering viewport | Don't animate *every* element — pick hero content only |
| **Scroll progress** | Informative | Reading progress bar, parallax layers, reveal animations | NEVER use smooth scrolling libraries (Lenis etc.) — subverts user control |
| **User drag/resize** | Tangible | Spring physics for natural feel during and after interaction | Don't animate if precision matters (e.g., pixel-exact positioning) |
| **Toast/notification entry** | Attention-focusing | Slide in from edge, brief highlight | Don't persist the animation — static after entry |
| **Cursor proximity** | Tangible or Joyful | Distance-based scaling, rotation toward cursor, googly eyes | Follow "don't change what you measure" rule to avoid feedback loops |
| **First visit vs returning** | Joyful | Full loading animation on first visit; skip on return | Never force users to sit through the same long animation repeatedly |

## Anti-Patterns

| Anti-pattern | Why it fails | Fix |
|---|---|---|
| Hover effects on non-interactive elements | Implies clickability; confuses users | Remove, or make the element actually interactive |
| Animation that delays task completion | Users feel blocked; frustration outweighs polish | Animation must not prevent interaction; use non-blocking transitions |
| Animating content the user is trying to read | Motion competes with reading comprehension | Settle text instantly; animate containers only |
| Inconsistent animation language | Different hover effects per component; feels random | Define 2-3 core patterns and reference them everywhere |
| Looping attention-grabbers | Subconsciously distracting; erodes focus | One-shot, or very slow cycle (>10s), or user-dismissible |
| Motion without reduced-motion fallback | Excludes users with vestibular disorders | Always implement `prefers-reduced-motion` handling |
| Copying cool effects without purpose | "Hodge podge" of borrowed animations | Ask: which category does this serve? If none, cut it |
| Smooth scrolling / scrolljacking | Subverts user control, causes vestibular issues, replaces native behavior | Never use. Let the browser handle scrolling natively |
| Parallax without reduced-motion guard | Top-of-list trigger for vestibular disorders | Always behind `@media (prefers-reduced-motion: no-preference)` |
| Generic npm-installed effects | Predictable, no longer surprising | Build custom bespoke effects for your specific product |
| Measuring the element you're animating (cursor) | Creates feedback loops, potential flickering >3/sec (WCAG violation) | Measure a stable parent element instead |

## Impact Tiers

Use these to prioritize which animations to implement first.

| Tier | Criteria | Examples |
|---|---|---|
| **High** | Reduces perceived latency, prevents disorientation, provides critical feedback | Route transitions, dialog open/close, form error feedback, skeleton→content, loading states |
| **Medium** | Adds polish, communicates interactivity, builds brand | Hover transitions on buttons/links, enter animations, staggered list entry, action-driven exit variants |
| **Low** | Purely decorative, joyful, brand flourish | Custom particle effects, hero animations, easter eggs, sound effects |

Implement high-tier first. Medium-tier during polish phase. Low-tier only when the product is otherwise solid.

## Animation Duration Guidelines

- **100ms–500ms** is the valid range for UI animations
- Below 100ms: too fast to register as motion
- Above 500ms: feels like a pause the user has to wait for
- Perceived speed matters more than technical duration — aggressive ease-out curves can make 1500ms feel zippy
- **Exit animations should be ~2x faster than enter animations** (asymmetrical timing)
- Staggered animation total (including delays) should stay under 500ms
- View Transitions: keep under 500ms to avoid scroll-lag issues
