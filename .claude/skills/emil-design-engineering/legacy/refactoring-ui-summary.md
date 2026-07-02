# Refactoring UI: Complete Analysis & Guide

## By Adam Wathan & Steve Schoger

---

# Executive Summary

**Refactoring UI** is a 218-page design book specifically crafted for developers
who want to create professional-looking interfaces without formal design
training. The core philosophy is that good design isn't about artistic
talent—it's about **understanding systems, constraints, and specific tactical
decisions** that anyone can learn.

The book dismantles the myth that design is purely subjective or requires innate
talent, replacing it with concrete, actionable frameworks across eight major
areas: starting from scratch, hierarchy, layout and spacing, typography, color,
depth, images, and finishing touches.

---

# PART 1: STARTING FROM SCRATCH

## 1.1 Start with a Feature, Not a Layout

### The Problem

When designers begin a new project, they often make the mistake of starting with
the "shell"—the navigation bar, sidebar placement, logo position, and overall
page structure. This leads to frustration because you're making decisions
without enough context.

### The Solution

Start with a specific piece of functionality instead.

**Example: Flight Booking Service** Instead of designing a header and sidebar
first, start with the core feature: "searching for a flight."

Your initial design needs only:

- Departure city field
- Destination city field
- Departure date field
- Return date field
- Search button

This focused approach mirrors how Google works—just a search box and a button.
You might not even need navigation, sidebars, or complex layouts until you've
designed several features and understand how they connect.

### Key Principle

> "An 'app' is actually a collection of features. Before you've designed a few
> features, you don't even have the information you need to make a decision
> about how the navigation should work."

---

## 1.2 Detail Comes Later

### The Sharpie Technique

In early design stages, don't obsess over typefaces, shadows, icons, or
pixel-perfect details. Jason Fried of Basecamp recommends designing on paper
with a **thick Sharpie**—the imprecision makes it impossible to obsess over
details and forces you to explore different layout ideas quickly.

### Hold the Color

When moving to higher fidelity, **resist color**. Design in grayscale first.

**Why grayscale works:**

- Forces you to use spacing, contrast, and size for hierarchy
- Creates clearer interfaces with stronger visual structure
- Makes it easier to enhance with color later

**Example:** A form designed in grayscale relies on:

- Size differences between headings and body text
- Spacing to group related fields
- Contrast (dark vs. light gray) for emphasis

When you add color afterward, it enhances rather than carries the design.

### Don't Over-invest

Sketches and wireframes are disposable. Users can't interact with static
mockups—use them to explore ideas, then move on.

---

## 1.3 Don't Design Too Much

### Work in Cycles

Rather than designing every feature upfront (which leads to endless edge case
debates), work in short cycles:

1. Design a simple version of the next feature
2. Build it
3. Iterate on the working design
4. Repeat

**The Problem with Upfront Design:**

- How should this screen look with 2,000 contacts?
- Where should the error message go?
- How does this calendar show overlapping events?

These questions are nearly impossible to answer abstractly—it's much easier to
solve them when you have a working interface.

### Be a Pessimist

**Don't imply functionality you aren't ready to build.**

**Example: Comments System** You're designing a comment system and include an
"attachments" section because you plan to add it eventually. But implementing
attachments proves too complex, so the entire commenting feature sits
unfinished.

A comment system without attachments would have been better than no comment
system at all.

> "Expect it to be hard to build. Designing the smallest useful version you can
> ship reduces that risk considerably."

---

## 1.4 Choose a Personality

Every design communicates a personality—secure, playful, formal, friendly. This
isn't abstract; it's determined by concrete factors:

### Font Choice

| Personality     | Font Type          | Example Use                      |
| --------------- | ------------------ | -------------------------------- |
| Elegant/Classic | Serif              | Law firms, luxury brands         |
| Playful         | Rounded sans-serif | Children's apps, casual products |
| Neutral/Plain   | Neutral sans-serif | Utility apps, tools              |

### Color Psychology

| Color | Feeling                   |
| ----- | ------------------------- |
| Blue  | Safe, familiar, corporate |
| Gold  | Expensive, sophisticated  |
| Pink  | Fun, not too serious      |

### Border Radius

| Radius        | Effect                |
| ------------- | --------------------- |
| Small (2-4px) | Neutral, professional |
| Large (8px+)  | Playful, friendly     |
| None (0px)    | Formal, serious       |

**Critical Rule:** Stay consistent. Mixing square corners with rounded corners
in the same interface looks unprofessional.

### Language

Words matter as much as visuals:

**Formal:** "We have sent an activation link to your email address" **Casual:**
"Check your email for the magic link!"

---

## 1.5 Limit Your Choices

### The Decision Paralysis Problem

With millions of colors and thousands of fonts, every minor decision becomes
torture:

- Should this text be 12px or 13px?
- Should this shadow have 10% or 15% opacity?
- Should this button use medium or semibold weight?

### Define Systems in Advance

Instead of picking from infinite options, create constrained sets:

**Color System:** Don't use the color picker for every shade of blue—choose 8-10
shades ahead of time.

**Type Scale:** Don't adjust fonts pixel by pixel—define sizes like: 12, 14, 16,
18, 20, 24, 30, 36, 48, 60px

### Design by Process of Elimination

With a constrained system, choosing becomes simple:

**Example: Icon Sizing** Your scale has: 12px, 16px, 24px, 32px

1. Guess 16px might work
2. Try 12px and 24px for comparison
3. Two will look obviously wrong
4. If the outer option looks best, compare it to its neighbors
5. Done—no more agonizing

### What to Systematize

- Font size, weight, line height
- Colors
- Margin, padding
- Width, height
- Box shadows
- Border radius, border width
- Opacity

---

# PART 2: HIERARCHY IS EVERYTHING

## 2.1 Visual Hierarchy Fundamentals

Visual hierarchy is **the most effective tool** for making something feel
"designed"—it determines how important elements appear relative to one another.

### The Problem

When everything in an interface competes for attention, it feels noisy and
chaotic—like a wall of content where nothing stands out.

### The Solution

Deliberately de-emphasize secondary and tertiary information while highlighting
what's most important.

**Example: Article Card** Without hierarchy: Title, author, date, description
all look the same With hierarchy: Title is larger and darker, date is smaller
and lighter gray, description is medium weight

---

## 2.2 Size Isn't Everything

### The Trap

Relying only on font size leads to:

- Primary content that's too large
- Secondary content that's too small and hard to read

### Better Tools for Hierarchy

**Font Weight:** Making a primary element **bolder** lets you use a reasonable
size while still communicating importance.

**Color:** Using softer colors for supporting text maintains readability while
showing it's secondary.

### The Rule of Threes

**Three colors for text:**

1. Dark color → Primary content (headlines)
2. Medium gray → Secondary content (dates, metadata)
3. Light gray → Tertiary content (footers, captions)

**Two font weights:**

1. Normal (400-500) → Most text
2. Bold (600-700) → Emphasized text

**Warning:** Stay away from font weights under 400 for UI work—they're too hard
to read at small sizes.

---

## 2.3 Grey Text on Colored Backgrounds

### The Problem

Grey text looks great on white but terrible on colored backgrounds because it
looks washed out.

### Why This Happens

The effect we see with grey on white is **reduced contrast**, not the color grey
itself. On a colored background, pure grey doesn't reduce contrast properly.

### The Solution

**Don't use white text with reduced opacity**—it looks dull and shows through on
images.

**Instead, hand-pick a new color:**

1. Match the hue of the background
2. Adjust saturation and lightness until it looks right

**Example:** On a blue background (#3B82F6), instead of white at 70% opacity,
use a custom light blue (#BFDBFE).

---

## 2.4 Emphasize by De-emphasizing

### The Counterintuitive Technique

Sometimes you can't make an element stand out more—nothing you add gives it
enough emphasis.

**Solution:** De-emphasize everything else instead.

**Example: Active Navigation Item** If the active item doesn't pop despite
different colors, give the inactive items a softer color so they recede.

**Example: Sidebar Competing with Content** Don't give the sidebar a background
color—let the content sit directly on the page background.

---

## 2.5 Labels Are a Last Resort

### When You Don't Need Labels

Many pieces of data are self-identifying:

| Data                            | Format Reveals It |
| ------------------------------- | ----------------- |
| janedoe@example.com             | Email address     |
| (555) 765-4321                  | Phone number      |
| $19.99                          | Price             |
| Customer Support (under a name) | Department        |

### Combine Labels and Values

Instead of "In stock: 12" → "12 left in stock" Instead of "Bedrooms: 3" → "3
bedrooms"

### When You Need Labels

For dashboards where similar data needs to be scannable, add labels but
**de-emphasize them**:

- Smaller font size
- Reduced contrast
- Lighter font weight

### When to Emphasize Labels

On technical specification pages where users **scan for labels** (like "depth"
or "battery life"), emphasize the label and slightly de-emphasize the data.

---

## 2.6 Visual vs. Document Hierarchy

### The Trap

HTML semantics (h1, h2, h3) assign progressively smaller sizes, which can
mislead your design.

### The Reality

A page title like "Manage Account" deserves an h1 semantically but doesn't need
to be the largest thing on the page. Section titles often act more like
labels—they're **supportive content**, not the focus.

**Solution:** Choose HTML elements for semantics, then style them according to
visual hierarchy needs. You might even hide a title visually while keeping it
for accessibility.

---

## 2.7 Balance Weight and Contrast

### Why Bold Text Feels Emphasized

Bold text covers more **surface area**—more pixels are used for text than
background.

### The Icon Problem

Icons (especially solid ones) are "heavy"—they cover a lot of surface area and
feel over-emphasized next to text.

**Solution:** Reduce icon contrast by giving them a softer color.

### The Reverse

Thin 1px borders can look too subtle with soft colors, but darkening them makes
designs feel harsh.

**Solution:** Make the border heavier (2px) instead of darker—maintains the soft
look while providing definition.

---

## 2.8 Semantics Are Secondary

### The Button Hierarchy Problem

Don't design buttons based purely on semantics (primary, secondary,
destructive). Design them based on **hierarchy**.

**Primary Actions:** Solid, high-contrast backgrounds—obviously the main action
**Secondary Actions:** Outline styles or lower-contrast backgrounds—clear but
not prominent **Tertiary Actions:** Link-style—discoverable but unobtrusive

### Destructive Actions

Being "destructive" doesn't mean big, red, and bold automatically.

**Better Pattern:**

1. Give the destructive action secondary styling on the main page
2. Show a confirmation dialog where the destructive action IS the primary action
3. Use big, red, bold styling only in the confirmation

---

# PART 3: LAYOUT AND SPACING

## 3.1 Start with Too Much White Space

### The Problem

We typically **add** white space only when something looks cramped—elements get
the minimum breathing room to not look bad.

### The Solution

Start with **way too much** space, then remove until satisfied.

What seems like "a little too much" on an individual element is often "just
enough" in a complete UI.

### Dense UIs Have Their Place

Dashboards where lots of information must be visible simultaneously may need
compact designs. But make this a **deliberate decision**, not the default.

---

## 3.2 Establish a Spacing and Sizing System

### Why Linear Scales Fail

"Make everything a multiple of 4px" doesn't help you choose between 120px and
125px.

**The Key Insight:** At the small end, a few pixels matter a lot (12px → 16px is
33% bigger) At the large end, a few pixels are imperceptible (500px → 520px is
only 4%)

**Rule:** No two values should be closer than about 25%.

### Building the System

Start with a base value (16px is ideal—it's the browser default).

**Example Scale:** 4, 8, 12, 16, 24, 32, 48, 64, 96, 128, 192, 256, 384, 512,
640, 768

Values are packed at the small end and spread out at the large end.

### Using the System

Need space under an element?

1. Grab a value from your scale
2. Not quite enough? Try the next value
3. Done in seconds

---

## 3.3 You Don't Have to Fill the Whole Screen

### The 960px Mindset

Modern screens are huge, but that doesn't mean you should fill them.

**If you only need 600px, use 600px.**

Spreading things out makes interfaces harder to interpret. A little extra space
around the edges never hurts.

### Shrink the Canvas

Having trouble designing small interfaces on a large canvas? Make the canvas
smaller—real constraints help.

**Mobile-first tip:** Start with a ~400px canvas. Most designs need fewer
changes when expanding than you'd think.

### Think in Columns

A narrow form feels unbalanced in a wide layout? Split it into columns instead
of making the form wider.

**Example:** Put a form in one column and supporting text in another—the layout
feels balanced without compromising the form's optimal width.

---

## 3.4 Grids Are Overrated

### The Problem with Grid Religion

A 12-column grid is useful but not for everything.

**Example: Sidebar Layout** A 3-column (25%) sidebar and 9-column (75%) content
area seems sensible, but:

- On wider screens, the sidebar wastes space growing unnecessarily
- On narrower screens, the sidebar shrinks below its minimum readable width

### The Solution

Give the sidebar a **fixed width** optimized for its contents. Let the content
area flex to fill remaining space with its own internal grid.

### Don't Shrink Until You Need To

**Example: Login Card** A login card shouldn't shrink just because the grid says
so. Give it a max-width (e.g., 500px) and let it stay that width until the
screen is actually smaller.

---

## 3.5 Relative Sizing Doesn't Scale

### The 2.5em Headline Myth

If body copy is 18px and headlines are 45px (2.5em), that ratio might be perfect
on desktop.

But if you reduce body copy to 14px on mobile, 2.5em gives you 35px
headlines—**way too big**.

A better mobile headline might be 20-24px (only 1.5em of 14px body copy).

### There Is No Universal Ratio

Elements that are large on large screens need to shrink **faster** than elements
that are already small. The difference between small and large should be less
extreme on smaller screens.

### Component Properties Scale Differently Too

**Button Example:** A button with 16px font, 16px horizontal padding, 12px
vertical padding looks balanced.

If you simply scale everything proportionally for a larger button, it looks
zoomed-in, not "bigger."

**Better approach:** Make padding more generous at larger sizes, tighter at
smaller sizes. Large buttons should **feel** larger, not just be magnified
versions of small buttons.

---

## 3.6 Avoid Ambiguous Spacing

### The Proximity Problem

When elements lack visible separators (borders, backgrounds), spacing determines
relationships.

**Example: Form Labels and Inputs** If the margin below a label equals the
margin below the input, it's unclear which label belongs to which input.

**Fix:** Increase space between form groups so labels clearly associate with
their inputs.

### Other Common Ambiguity Problems

- Section headings with equal space above and below (should have more space
  above)
- Bulleted lists where space between bullets equals line-height within
  multi-line bullets

**Rule:** Space **around** groups should always exceed space **within** groups.

---

# PART 4: DESIGNING TEXT

## 4.1 Establish a Type Scale

### The Problem

Most interfaces use too many font sizes—every value from 10px to 24px appears
somewhere, creating inconsistency.

### Modular Scales

Mathematical ratios (4:5, 2:3, golden ratio) sound appealing but have problems:

1. Fractional values (31.25px, 39.063px)
2. Too few practical options (12, 16, 21, 28... but nothing between 12 and 16?)

### Handcrafted Scale

Pick values manually with enough options but not infinite choice:

**Example Scale:** 12, 14, 16, 18, 20, 24, 30, 36, 48, 60, 72

### Avoid `em` Units

Because `em` is relative to current font size, nested elements compute to values
outside your scale.

**Example:** 1.25em (20px) containing .875em calculates to 17.5px—not in your
scale.

**Use `px` or `rem` instead.**

---

## 4.2 Use Good Fonts

### Safe Choices

For UI design, neutral sans-serifs are safest. The system font stack is always a
reliable option:

```css
font-family:
  -apple-system,
  Segoe UI,
  Roboto,
  Noto Sans,
  Ubuntu,
  Cantarell,
  Helvetica Neue;
```

### Quality Indicators

**Filter by weight count:** Typefaces with 5+ weights tend to be crafted with
more care. On Google Fonts, filtering by "10+ styles" cuts 85% of options.

### Optimize for Legibility

Fonts designed for headlines have tighter letter-spacing and shorter
x-heights—they're hard to read at small sizes. Use fonts designed for body text.

### Wisdom of the Crowd

Popular fonts are usually popular for good reasons. Sort by popularity on font
directories.

### Steal from Good Sites

Inspect sites you admire—strong design teams have strong opinions about
typography.

---

## 4.3 Line Length

### The Magic Range

**45-75 characters per line** for optimal readability.

On the web, use `em` units for width: **20-35em** gets you in the right range.

### Why This Matters

Lines that are too long make it hard to find the next line after finishing
one—your eyes must travel too far horizontally.

### Mixing Widths

If you're combining paragraph text with wider elements (images, code blocks),
**still constrain paragraph width**. Different widths in the same content area
look more polished, not less.

---

## 4.4 Baseline, Not Center

### The Problem

When mixing font sizes on one line (a title and a button, for example), vertical
centering creates awkward misalignment.

### The Solution

Align by **baseline**—the imaginary line letters rest on.

This uses an alignment reference your eyes already perceive, creating a simpler,
cleaner result.

---

## 4.5 Line-height Is Proportional

### Two Factors

**1. Line Length:**

- Narrow content: 1.5 line-height is fine
- Wide content: May need line-height as tall as 2

Why? The further your eyes travel horizontally, the easier it is to lose your
place when jumping to the next line.

**2. Font Size:**

- Small text: Needs more line-height for readability
- Large headlines: May need no extra line-height (1.0 is fine)

**Key insight:** Line-height and font size are **inversely proportional**.

---

## 4.6 Link Styling

### Not Every Link Needs Color

In content where almost everything is a link (navigation, menus), colored links
are overbearing.

**Alternatives:**

- Heavier font weight
- Darker color
- Underline on hover only

Ancillary links can skip emphasis entirely—users who think to try will discover
them.

---

## 4.7 Text Alignment

### Default to Left

Left-alignment matches Western reading direction and should be your default.

### Center Alignment Rules

- Great for headlines and short blocks (2-3 lines max)
- Never for long-form text
- If one block in a centered group is too long, rewrite it shorter

### Right-Align Numbers

In tables, right-aligned numbers align decimals, making comparison much easier.

### Hyphenate Justified Text

Justified text can create awkward gaps. Enable hyphenation:

```css
hyphens: auto;
```

---

## 4.8 Letter-spacing

### Trust the Designer (Usually)

Typeface designers set letter-spacing for specific uses.

### When to Tighten

Headlines using body-text fonts often benefit from reduced letter-spacing to
mimic dedicated headline fonts.

### All-Caps Legibility

All-caps text has less variety (no ascenders/descenders), making the default
letter-spacing feel cramped. **Increase letter-spacing for all-caps text.**

---

# PART 5: WORKING WITH COLOR

## 5.1 Ditch Hex for HSL

### Why HSL?

In hex/RGB, visually similar colors look nothing alike in code.

HSL represents colors by attributes humans perceive:

- **Hue:** Position on color wheel (0° = red, 120° = green, 240° = blue)
- **Saturation:** Vividness (0% = grey, 100% = vibrant)
- **Lightness:** Proximity to black/white (0% = black, 100% = white, 50% = pure
  color)

### HSL vs. HSB

HSL's lightness ≠ HSB's brightness. At 100% brightness in HSB with 100%
saturation, you get a pure color, not white. Use HSL for web design.

---

## 5.2 You Need More Colors Than You Think

### The Palette Generator Trap

Five hex codes from a generator build this... and nothing else:

- A pretty color swatch

Real applications need comprehensive color systems.

### What You Actually Need

**Greys (8-10 shades):** Text, backgrounds, panels, form controls—nearly
everything. Start with a dark grey (not pure black) and work up to white.

**Primary Colors (5-10 shades each):** For primary actions, active states,
branding. You need ultra-light tints (alert backgrounds) through dark shades
(text).

**Accent Colors (multiple shades each):**

- Yellow/pink/teal for feature highlights
- Red for destructive actions
- Yellow for warnings
- Green for positive trends

**Total:** Not uncommon to need 10 different colors with 5-10 shades each.

---

## 5.3 Define Your Shades Up Front

### Don't Use CSS Functions

`lighten()` and `darken()` create 35 slightly different blues. Define shades
manually.

### Building a Color Scale

**Step 1: Pick the Base** Choose a shade that works as a button background—this
becomes your 500.

**Step 2: Find the Edges**

- Darkest (900): Text on light backgrounds
- Lightest (100): Tinted backgrounds

**Step 3: Fill the Gaps** Pick 700 and 300 (midpoints), then 800, 600, 400, 200.

You end up with 9 shades per color.

### Greys

Same process—pick darkest (body text) and lightest (subtle backgrounds), then
fill in.

---

## 5.4 Don't Let Lightness Kill Saturation

### The Problem

As lightness approaches 0% or 100%, saturation's impact weakens. A 50%
saturation color at 90% lightness looks washed out.

### The Fix

Increase saturation as lightness moves away from 50%.

### Perceived Brightness and Hue Rotation

Different hues have different inherent brightness:

- **Bright hues:** Yellow (60°), Cyan (180°), Magenta (300°)
- **Dark hues:** Red (0°), Green (120°), Blue (240°)

**Technique:** Rotate hue toward bright hues to lighten colors while maintaining
intensity, or toward dark hues to darken.

**Example:** Creating darker yellow shades? Rotate toward orange instead of just
lowering lightness—you get warm, rich tones instead of dull brown.

**Limit:** Don't rotate more than 20-30° or it looks like a different color.

---

## 5.5 Greys Don't Have to Be Grey

### True Grey vs. Saturated Grey

True grey has 0% saturation, but most "greys" are actually saturated, giving
them warmth or coolness.

### Creating Temperature

**Cool greys:** Saturate with blue **Warm greys:** Saturate with yellow or
orange

Remember to increase saturation for lighter and darker shades to maintain
consistent temperature.

---

## 5.6 Accessibility

### WCAG Requirements

- Normal text (<18px): 4.5:1 contrast ratio minimum
- Large text: 3:1 contrast ratio minimum

### Flip the Contrast

White text on colored backgrounds often requires very dark colors, creating
unwanted emphasis.

**Solution:** Use dark colored text on light colored backgrounds instead—the
color is present but less dominant.

### Rotate Hue for Better Contrast

Colored text on colored backgrounds is tough. Rotating toward a brighter hue
(cyan, magenta, yellow) increases contrast without approaching white.

---

## 5.7 Don't Rely on Color Alone

### The Colorblind Problem

Red-green colorblind users can't distinguish positive vs. negative trends if
color is the only indicator.

**Example Fix:** Add icons (↑ for positive, ↓ for negative) alongside color.

### For Complex Visualizations

Use **contrast** (light vs. dark) instead of hue differences—it's easier for
colorblind users to distinguish.

**Rule:** Color should support what design already says, not be the sole means
of communication.

---

# PART 6: CREATING DEPTH

## 6.1 Emulate a Light Source

### Light Comes from Above

This simple principle explains all depth effects:

- Top edges facing the sky are lighter (receiving more light)
- Bottom edges facing down are darker (receiving less light)

### Raised Elements

**Button Example:**

1. Top edge: Slightly lighter than face (inset box-shadow or top border)
2. Face: The button color
3. Shadow below: Small dark box-shadow with slight vertical offset

**Pro tip:** Hand-pick the lighter color instead of using semi-transparent
white—white overlays can desaturate the underlying color.

### Inset Elements

**Well/Input Example:**

1. Bottom lip: Slightly lighter (facing upward toward light)
2. Top: Small dark inset shadow (area above blocks light)

---

## 6.2 Shadows Convey Elevation

### The Depth System

Shadows place elements on a virtual z-axis:

- **Small shadows:** Slightly raised (buttons)
- **Medium shadows:** Higher up (dropdowns)
- **Large shadows:** Closest to user (modals)

### Building a Shadow Scale

Define 5 shadow sizes (similar to spacing scales):

1. Smallest shadow 2-4. Linear progression
2. Largest shadow

### Interactive Shadows

- **Drag items:** Add shadow when clicked to show they're "lifted"
- **Pressed buttons:** Remove or reduce shadow to feel pressed into page

---

## 6.3 Two-Part Shadows

### Why Two Shadows?

Professional shadows often combine:

1. **Large, soft shadow:** Direct light source casting behind object
2. **Tight, dark shadow:** Ambient light blocked directly underneath

### The Benefit

You get subtle large shadows with well-defined edges near the element.

### Elevation Adjustment

At higher elevations, the tight dark shadow should become more subtle (ambient
light still reaches underneath objects that are far from surfaces).

---

## 6.4 Flat Design Can Have Depth

### Depth Without Shadows

**Color:**

- Lighter than background = raised
- Darker than background = inset

**Solid Shadows:** Short, vertical offset, no blur—creates depth while
maintaining flat aesthetic.

---

## 6.5 Overlap Elements

### Creating Layers

Offset elements so they cross boundaries between backgrounds or parent
containers.

**Examples:**

- Cards that overlap two background sections
- Elements taller than their parent (overlapping top and bottom)
- Carousel controls that overlap the image

### Overlapping Images

Images can clash when overlapping. Add an "invisible border" matching the
background color to create gaps without visible borders.

---

# PART 7: WORKING WITH IMAGES

## 7.1 Use Good Photos

### The Rule

Bad photos ruin good designs. Period.

**Options:**

1. Hire a professional photographer
2. Use high-quality stock photography (Unsplash, paid stock sites)

**Never:** Design with placeholders expecting to replace with smartphone photos
later.

---

## 7.2 Text Needs Consistent Contrast

### The Problem

Photos have dynamic ranges—light and dark areas. White text works in dark areas
but disappears in light areas.

### Solutions

**Add an Overlay:** Semi-transparent black for light text, white for dark text.

**Lower Image Contrast:** Reduces the dynamic range. Adjust brightness to
compensate.

**Colorize the Image:**

1. Lower contrast
2. Desaturate
3. Add solid fill with "multiply" blend mode

**Text Shadow:** Large blur radius, no offset—creates a subtle glow. Combine
with reduced contrast.

---

## 7.3 Everything Has an Intended Size

### Don't Scale Up Icons

Icons drawn at 16-24px look chunky at 3-4x their size—they lack detail.

**Fix:** Enclose small icons in shaped containers with background colors.

### Don't Scale Down Screenshots

Full-size screenshots at 70% reduction cram too much detail into too little
space (16px fonts become 4px).

**Alternatives:**

- Take screenshots at smaller screen sizes
- Show partial screenshots
- Draw simplified UI diagrams

### Don't Scale Down Icons Either

128px logos scaled to favicon size (16px) become mush.

**Fix:** Redraw a simplified version specifically for the target size.

---

## 7.4 User-Uploaded Content

### Control Shape and Size

Don't let user images break your layout with varied aspect ratios.

**Solution:** Center images in fixed containers, cropping what doesn't fit:

```css
background-size: cover;
```

### Prevent Background Bleed

Images with backgrounds similar to your UI can lose their edges.

**Solution:** Use a subtle inner box-shadow (not a border—borders clash with
image colors).

---

# PART 8: FINISHING TOUCHES

## 8.1 Supercharge the Defaults

### Replace Boring Defaults with Custom Elements

**Bullets → Icons:** Replace standard bullets with checkmarks, arrows, or
content-specific icons (padlocks for security features).

**Quotation Marks:** Promote them to visual elements—increase size, change
color.

**Links:** Custom underlines with color and thickness that partially overlap
text.

**Form Controls:** Custom checkboxes and radio buttons with brand colors instead
of browser defaults.

---

## 8.2 Add Color with Accent Borders

### Where to Add Them

- Top of cards
- Side of active navigation items
- Left edge of alert messages
- Short underline beneath headlines
- Top of entire page layout

### Why This Works

It takes zero graphic design talent to add a colored rectangle—but it makes
interfaces feel significantly more "designed."

---

## 8.3 Decorate Backgrounds

### Background Colors

- Individual panel emphasis
- Page section distinction
- Gradients for energy (keep hues within 30° of each other)

### Repeating Patterns

Subtle patterns from resources like Hero Patterns. Keep contrast low for
readability.

### Shapes and Illustrations

Position geometric shapes or simplified graphics (like world maps) in specific
areas. Low contrast keeps them from interfering with content.

---

## 8.4 Don't Overlook Empty States

### The Problem

You design beautiful interfaces with realistic sample data, then real users
see... nothing. Empty states should be priorities, not afterthoughts.

### Making Empty States Great

- Add images or illustrations
- Emphasize the call-to-action (first step)
- Consider hiding supporting UI (tabs, filters) until content exists

---

## 8.5 Use Fewer Borders

### Alternatives to Borders

**Box Shadows:** Outline elements subtly without being as distracting as
borders.

**Background Colors:** Different backgrounds create distinction without
additional elements.

**Extra Spacing:** More separation = obvious groupings without any new UI.

---

## 8.6 Think Outside the Box

### Challenge Conventions

**Dropdowns:** Who says they must be boring link lists? Add sections, columns,
icons, supporting text.

**Tables:** Combine related columns, add images, introduce color, vary hierarchy
within cells.

**Radio Buttons:** Replace with selectable cards for important choices.

**The Principle:** Constraints are powerful, but occasional freedom takes
interfaces to the next level.

---

# PART 9: LEVELING UP

## 9.1 Look for Unintuitive Decisions

When you find a design you love, ask:

> "Did the designer do anything here I never would have thought to do?"

**Examples to notice:**

- Inverted background color on a datepicker
- Button positioned inside a text input
- Two different font colors in one headline

These unintuitive choices become your new toolkit.

## 9.2 Rebuild Your Favorites

The best way to notice what makes designs polished: **recreate them from scratch
without peeking at dev tools**.

When your version looks different, you'll discover tricks on your own:

- "Reduce line-height for headings"
- "Add letter-spacing to uppercase text"
- "Combine multiple shadows"

---

# Quick Reference: The 50 Most Important Rules

1. Start with a feature, not the layout shell
2. Design in grayscale before adding color
3. Work in short cycles: design → build → iterate
4. Design the smallest useful version first
5. Choose a consistent personality (fonts, colors, radius, language)
6. Define constrained systems for colors, spacing, typography
7. Create hierarchy through size, weight, and color—not just size
8. Use three text colors and two font weights maximum
9. On colored backgrounds, hand-pick text colors (don't use grey)
10. De-emphasize competing elements to make the focus pop
11. Avoid labels when format or context is sufficient
12. Style semantic elements (h1, h2) based on visual needs, not defaults
13. Balance icon weight with reduced contrast
14. Design button hierarchy (primary/secondary/tertiary) before semantics
15. Start with too much white space, then remove
16. Build a spacing scale with 25%+ differences between adjacent values
17. Don't fill the whole screen—use only what you need
18. Give sidebars fixed widths; let content areas flex
19. Don't shrink elements until the screen requires it
20. Elements scale at different rates—large items shrink faster
21. Space around groups > space within groups
22. Create a handcrafted type scale (not modular)
23. Use px or rem, not em
24. Filter fonts by weight count (5+ weights = higher quality)
25. 45-75 characters per line for readability
26. Align mixed font sizes by baseline, not center
27. Line-height is inversely proportional to font size
28. Not every link needs special color treatment
29. Right-align numbers in tables
30. Tighten letter-spacing for headlines, loosen for all-caps
31. Use HSL instead of hex/RGB
32. Build comprehensive palettes: greys + primary + accents
33. Define all shades upfront (don't use lighten/darken functions)
34. Increase saturation as lightness moves from 50%
35. Rotate hue for brightness changes without losing intensity
36. Saturate greys slightly for temperature (warm/cool)
37. Flip contrast for accessible colored backgrounds
38. Never rely on color alone—add icons or contrast
39. Light comes from above—lighter tops, darker bottoms
40. Use shadow size to indicate element elevation
41. Combine two shadows (large soft + tight dark) for professional depth
42. Use color and solid shadows for depth in flat designs
43. Overlap elements to create layers
44. Use good photos or none at all
45. Ensure text contrast on images with overlays, colorization, or shadows
46. Never scale elements beyond their intended size
47. Control user-uploaded image dimensions; prevent background bleed
48. Supercharge defaults (bullets → icons, custom form controls)
49. Add accent borders for visual interest without graphics skills
50. Design empty states as carefully as populated states

---

_This analysis was created from "Refactoring UI" by Adam Wathan & Steve Schoger.
The book is essential reading for developers who want to create professional
interfaces without formal design training._
