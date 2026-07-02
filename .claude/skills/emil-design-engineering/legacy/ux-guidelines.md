# UI Design Guide for Claude Code

## Practical Principles from Refactoring UI

> **Purpose:** Reference this when building interfaces. Focus on
> decision-making, not specific values—your theme handles tokens.

---

# HIERARCHY: THE MOST IMPORTANT SKILL

## The Three-Level Text System

Every interface needs exactly three levels of text emphasis:

| Level         | Use For                        | How                        |
| ------------- | ------------------------------ | -------------------------- |
| **Primary**   | Headlines, key data, CTAs      | Dark color, heavier weight |
| **Secondary** | Body text, descriptions        | Medium gray, normal weight |
| **Tertiary**  | Metadata, timestamps, captions | Light gray, smaller size   |

```jsx
// ✅ Good: Clear hierarchy
<div>
  <h2 className="text-gray-900 font-semibold">Monthly Revenue</h2>
  <p className="text-3xl text-gray-900 font-bold">$45,231</p>
  <p className="text-sm text-gray-500">+12% from last month</p>
</div>

// ❌ Bad: Everything fights for attention
<div>
  <h2 className="text-gray-900 font-bold text-xl">Monthly Revenue</h2>
  <p className="text-xl text-gray-900 font-bold">$45,231</p>
  <p className="text-gray-900">+12% from last month</p>
</div>
```

## Size Isn't Everything

Don't rely on font size alone for hierarchy. Combine:

- **Weight:** Semibold/bold for emphasis, normal for body
- **Color:** Dark for primary, progressively lighter for secondary/tertiary
- **Size:** Use sparingly—big size differences look amateur

```jsx
// ✅ Good: Weight and color do the work
<div>
  <span className="font-semibold text-gray-900">Amanda Chen</span>
  <span className="text-gray-500">commented on your post</span>
</div>

// ❌ Bad: Only size differentiates
<div>
  <span className="text-lg">Amanda Chen</span>
  <span className="text-xs">commented on your post</span>
</div>
```

## Emphasize by De-emphasizing

Can't make something stand out? **Make everything else recede.**

```jsx
// Navigation: Don't just style the active item—fade the inactive ones
<nav>
  <a className="text-gray-400 hover:text-gray-600">Dashboard</a>
  <a className="text-primary-600 font-medium">Projects</a>  {/* Active */}
  <a className="text-gray-400 hover:text-gray-600">Settings</a>
</nav>

// Sidebar competing with content? Remove its background
<aside className="border-r border-gray-200">  {/* Not bg-gray-100 */}
  ...
</aside>
```

---

# BUTTONS & ACTIONS

## Hierarchy First, Semantics Second

Design buttons by importance, not just by what they do:

| Level         | Style                           | Use For                      |
| ------------- | ------------------------------- | ---------------------------- |
| **Primary**   | Solid background, high contrast | Main action per page/section |
| **Secondary** | Outline or muted background     | Alternative actions          |
| **Tertiary**  | Text-only, link-style           | Minor/optional actions       |

```jsx
// ✅ Good: Clear action hierarchy
<div className="flex gap-3">
  <button className="bg-primary-600 text-white px-4 py-2 rounded">
    Save Changes
  </button>
  <button className="border border-gray-300 text-gray-700 px-4 py-2 rounded">
    Cancel
  </button>
</div>

// ❌ Bad: Two competing primary buttons
<div className="flex gap-3">
  <button className="bg-primary-600 text-white px-4 py-2 rounded">
    Save Changes
  </button>
  <button className="bg-gray-600 text-white px-4 py-2 rounded">
    Cancel
  </button>
</div>
```

## Destructive Actions

**Don't make delete buttons big and red by default.**

- On the main page: Use secondary or tertiary styling
- In confirmation modal: NOW it can be primary and red

```jsx
// Main page: Destructive action is de-emphasized
<div className="flex gap-3">
  <button className="bg-primary-600 text-white ...">Update</button>
  <button className="text-gray-500 hover:text-red-600 ...">Delete</button>
</div>

// Confirmation modal: NOW it's primary
<dialog>
  <p>Are you sure you want to delete this?</p>
  <div className="flex gap-3">
    <button className="bg-red-600 text-white ...">Delete</button>
    <button className="border border-gray-300 ...">Cancel</button>
  </div>
</dialog>
```

---

# LABELS & DATA DISPLAY

## Labels Are a Last Resort

Data often speaks for itself:

| Data               | Self-Identifying?     |
| ------------------ | --------------------- |
| `jane@example.com` | ✅ Obviously an email |
| `(555) 123-4567`   | ✅ Obviously a phone  |
| `$49.99`           | ✅ Obviously a price  |
| `March 15, 2024`   | ✅ Obviously a date   |

```jsx
// ✅ Good: Format is obvious, no label needed
<p className="text-gray-900">jane@example.com</p>

// ❌ Unnecessary
<p><span className="text-gray-500">Email:</span> jane@example.com</p>
```

## Combine Labels with Values

Instead of `Label: Value`, integrate them:

```jsx
// ✅ Good: Natural reading
<p>12 left in stock</p>
<p>3 bedrooms · 2 baths</p>
<p>Posted 2 hours ago</p>

// ❌ Robotic
<p>In Stock: 12</p>
<p>Bedrooms: 3, Bathrooms: 2</p>
<p>Posted: 2 hours ago</p>
```

## When You Need Labels

For scannable data (dashboards, spec tables), add labels but de-emphasize them:

```jsx
// Label is supporting, data is the focus
<div>
  <dt className="text-xs text-gray-500 uppercase tracking-wide">Revenue</dt>
  <dd className="text-2xl font-semibold text-gray-900">$45,231</dd>
</div>
```

For spec sheets where users scan for labels (not data):

```jsx
// Label emphasized, data secondary
<tr>
  <th className="text-gray-900 font-medium">Dimensions</th>
  <td className="text-gray-600">146.7 × 71.5 × 7.8 mm</td>
</tr>
```

---

# LAYOUT PRINCIPLES

## Don't Fill the Screen

Just because you have 1400px doesn't mean you should use it.

```jsx
// ✅ Good: Content determines width
<main className="max-w-2xl mx-auto">  {/* ~672px */}
  <article>...</article>
</main>

// ❌ Bad: Stretched to fill space
<main className="w-full px-4">
  <article>...</article>
</main>
```

## Fixed vs. Fluid

**Sidebars:** Fixed width (they have optimal content width) **Main content:**
Fluid (fills remaining space)

```jsx
// ✅ Good: Sidebar is fixed, content flexes
<div className="flex">
  <aside className="w-64 shrink-0">...</aside>
  <main className="flex-1">...</main>
</div>

// ❌ Bad: Both fluid (sidebar grows/shrinks awkwardly)
<div className="flex">
  <aside className="w-1/4">...</aside>
  <main className="w-3/4">...</main>
</div>
```

## Line Length for Readability

Prose should be 45-75 characters per line (~20-35em).

```jsx
// ✅ Good: Constrained prose width even in wide container
<div className="max-w-4xl">
  <img className="w-full" />
  <p className="max-w-prose">Long paragraph text here...</p>
</div>
```

## Spacing Creates Relationships

Elements that are related should be closer together than unrelated elements.

```jsx
// ✅ Good: Label clearly belongs to its input
<div className="space-y-6">  {/* Large gap between groups */}
  <div className="space-y-1">  {/* Small gap within group */}
    <label>Email</label>
    <input />
  </div>
  <div className="space-y-1">
    <label>Password</label>
    <input />
  </div>
</div>

// ❌ Bad: Ambiguous—which label goes with which input?
<div className="space-y-4">
  <label>Email</label>
  <input />
  <label>Password</label>
  <input />
</div>
```

---

# TYPOGRAPHY DECISIONS

## Alignment

- **Default:** Left-align everything
- **Center:** Only for short text (1-3 lines), headlines, or hero sections
- **Right:** Numbers in tables (aligns decimals)
- **Justify:** Only with hyphenation enabled, for print-like layouts

```jsx
// ✅ Good: Numbers right-aligned for easy comparison
<table>
  <td className="text-right tabular-nums">$1,234.56</td>
  <td className="text-right tabular-nums">$987.00</td>
</table>
```

## Letter Spacing

- **All-caps text:** Increase letter spacing (improves legibility)
- **Large headlines:** Slightly tighten letter spacing

```jsx
<span className="uppercase tracking-wide text-xs">Category</span>
<h1 className="text-5xl tracking-tight">Welcome Back</h1>
```

## Mixed Font Sizes

Align by baseline, not center:

```jsx
// ✅ Good: Baseline alignment
<div className="flex items-baseline gap-2">
  <h2 className="text-2xl font-bold">Dashboard</h2>
  <span className="text-sm text-gray-500">Last updated 5m ago</span>
</div>

// ❌ Bad: Vertically centered looks misaligned
<div className="flex items-center gap-2">
  <h2 className="text-2xl font-bold">Dashboard</h2>
  <span className="text-sm text-gray-500">Last updated 5m ago</span>
</div>
```

---

# COLOR USAGE

## Use Semantic Theme Tokens

**Always use semantic color tokens from the theme instead of hardcoded colors.**
This ensures consistency, supports dark mode, and allows theme customization.

### Available Semantic Tokens

| Token                   | Use For                                | Tailwind Class                       |
| ----------------------- | -------------------------------------- | ------------------------------------ |
| `background`            | Page/section backgrounds               | `bg-background`                      |
| `foreground`            | Primary text                           | `text-foreground`                    |
| `muted`                 | Subtle backgrounds                     | `bg-muted`                           |
| `muted-foreground`      | Secondary/tertiary text                | `text-muted-foreground`              |
| `card`                  | Card backgrounds                       | `bg-card`                            |
| `card-foreground`       | Text on cards                          | `text-card-foreground`               |
| `primary`               | Primary actions, links, accents        | `bg-primary`, `text-primary`         |
| `primary-foreground`    | Text on primary backgrounds            | `text-primary-foreground`            |
| `secondary`             | Secondary buttons, subtle accents      | `bg-secondary`                       |
| `secondary-foreground`  | Text on secondary backgrounds          | `text-secondary-foreground`          |
| `accent`                | Hover states, highlights               | `bg-accent`                          |
| `accent-foreground`     | Text on accent backgrounds             | `text-accent-foreground`             |
| `destructive`           | Error states, delete actions           | `bg-destructive`, `text-destructive` |
| `border`                | Borders, dividers                      | `border-border`                      |
| `input`                 | Input borders                          | `border-input`                       |
| `ring`                  | Focus rings                            | `ring-ring`                          |

```jsx
// ✅ Good: Semantic tokens
<div className="bg-card text-card-foreground rounded-lg border border-border">
  <h3 className="text-foreground font-semibold">Title</h3>
  <p className="text-muted-foreground">Secondary text</p>
  <button className="bg-primary text-primary-foreground">Action</button>
</div>

// ❌ Bad: Hardcoded colors break theming and dark mode
<div className="bg-white text-gray-900 rounded-lg border border-gray-200">
  <h3 className="text-gray-900 font-semibold">Title</h3>
  <p className="text-gray-500">Secondary text</p>
  <button className="bg-purple-600 text-white">Action</button>
</div>
```

## Text Hierarchy with Theme Tokens

Use the semantic tokens for the three-level text system:

```jsx
// ✅ Good: Theme-aware text hierarchy
<div>
  <h2 className="text-foreground font-semibold">Primary Text</h2>
  <p className="text-muted-foreground">Secondary description</p>
  <span className="text-sm text-muted-foreground/70">Tertiary metadata</span>
</div>
```

## Text on Colored Backgrounds

When using semantic colored backgrounds, use the matching foreground token:

```jsx
// ✅ Good: Use foreground tokens for colored backgrounds
<div className="bg-primary p-4 rounded-lg">
  <h3 className="text-primary-foreground">Title</h3>
  <p className="text-primary-foreground/80">Secondary text with opacity</p>
</div>

<div className="bg-destructive p-4 rounded-lg">
  <h3 className="text-destructive-foreground">Error Title</h3>
</div>

<div className="bg-muted p-4 rounded-lg">
  <h3 className="text-foreground">Muted Section Title</h3>
  <p className="text-muted-foreground">Description text</p>
</div>

// ❌ Bad: Hardcoded colors on themed backgrounds
<div className="bg-primary p-4">
  <h3 className="text-white">Title</h3>
  <p className="text-gray-300">Doesn't adapt to theme</p>
</div>
```

## Status Colors

For status indicators (success, warning, error), you may use Tailwind's color
palette but **always pair with an icon for accessibility** and include dark mode
variants:

```jsx
// ✅ Good: Status color + icon + dark mode support
<div className="flex items-center gap-1 text-green-600 dark:text-green-400">
  <ArrowUpIcon className="w-4 h-4" />
  <span>+12%</span>
</div>

// Use destructive token for errors when available
<div className="flex items-center gap-1 text-destructive">
  <AlertCircleIcon className="w-4 h-4" />
  <span>Error occurred</span>
</div>

// ❌ Bad: Color alone without icon, no dark mode
<span className="text-green-600">+12%</span>
<span className="text-red-600">-5%</span>
```

## Chart Colors

Use the dedicated chart tokens for data visualization:

```jsx
// ✅ Good: Chart color tokens (automatically themed)
const chartConfig = {
  revenue: { color: 'var(--chart-1)' },
  expenses: { color: 'var(--chart-2)' },
  profit: { color: 'var(--chart-3)' },
  users: { color: 'var(--chart-4)' },
  sessions: { color: 'var(--chart-5)' },
}

// Or with Tailwind classes
<div className="bg-chart-1" />
<div className="bg-chart-2" />
<div className="text-chart-3" />
```

## Dark Mode Compatibility

Semantic tokens automatically adapt to dark mode. Avoid hardcoded colors:

```jsx
// ❌ Bad: Breaks in dark mode
<div className="bg-white text-black">...</div>
<div className="border-gray-200">...</div>
<div className="bg-gray-100">...</div>

// ✅ Good: Works in both light and dark modes
<div className="bg-background text-foreground">...</div>
<div className="border-border">...</div>
<div className="bg-muted">...</div>
```

## Quick Reference: Color Token Mapping

| Old Hardcoded          | New Semantic Token         |
| ---------------------- | -------------------------- |
| `bg-white`             | `bg-background` or `bg-card` |
| `text-gray-900`        | `text-foreground`          |
| `text-gray-500/600`    | `text-muted-foreground`    |
| `border-gray-200/300`  | `border-border`            |
| `bg-gray-50/100`       | `bg-muted`                 |
| `bg-purple-600` (brand)| `bg-primary`               |
| `text-red-600` (error) | `text-destructive`         |
| `hover:bg-gray-100`    | `hover:bg-accent`          |

---

# DEPTH & SHADOWS

## Shadow = Elevation = Importance

| Elevation | Shadow Size    | Use For             |
| --------- | -------------- | ------------------- |
| Low       | Small, subtle  | Buttons, cards      |
| Medium    | Moderate       | Dropdowns, popovers |
| High      | Large, diffuse | Modals, dialogs     |

```jsx
<button className="shadow-sm">Regular button</button>
<div className="shadow-md">Dropdown menu</div>
<dialog className="shadow-xl">Modal dialog</dialog>
```

## Interactive Shadows

- **Click/drag:** Increase shadow (element "lifts")
- **Press:** Decrease or remove shadow (element "pushes in")

```jsx
<button className="shadow hover:shadow-md active:shadow-sm transition-shadow">
  Click me
</button>
```

## Flat Design Depth

No shadows? Use color for depth:

- Lighter than background = raised
- Darker than background = inset

```jsx
<div className="bg-gray-100">
  <div className="bg-white p-4">Raised card</div>
  <div className="bg-gray-200 p-4">Inset well</div>
</div>
```

---

# BORDERS & SEPARATION

## Alternatives to Borders

Before adding a border, try:

1. **Box shadow** (softer separation)
2. **Background color difference** (often enough alone)
3. **More spacing** (no visual element needed)

```jsx
// Option 1: Shadow instead of border
<div className="shadow-sm rounded-lg">...</div>

// Option 2: Background difference
<div className="bg-gray-50">
  <div className="bg-white">...</div>
</div>

// Option 3: Just spacing
<div className="space-y-8">
  <section>...</section>
  <section>...</section>
</div>
```

---

# IMAGES & ICONS

## Control User-Uploaded Images

Never let user images dictate your layout:

```jsx
// ✅ Good: Fixed container, image fills it
<div className="w-24 h-24 rounded-full overflow-hidden">
  <img className="w-full h-full object-cover" src={user.avatar} />
</div>

// ❌ Bad: Image determines size
<img className="rounded-full" src={user.avatar} />
```

## Prevent Image Bleed

When user images might match your background:

```jsx
// ✅ Good: Inner shadow defines edge without harsh border
<div className="relative">
  <img src={...} />
  <div className="absolute inset-0 ring-1 ring-inset ring-black/5" />
</div>
```

## Icon Sizing

Icons designed for 16-24px look chunky when scaled up. For large icon needs:

```jsx
// ✅ Good: Icon stays intended size, container provides scale
<div className="w-12 h-12 bg-primary-100 rounded-lg flex items-center justify-center">
  <CheckIcon className="w-6 h-6 text-primary-600" />
</div>

// ❌ Bad: Scaled-up icon looks unprofessional
<CheckIcon className="w-12 h-12 text-primary-600" />
```

---

# COMPONENT PATTERNS

## Empty States

Never show a blank screen. Empty states need:

1. Illustration or icon
2. Explanatory text
3. Clear call-to-action

```jsx
<div className="text-center py-12">
  <FolderIcon className="mx-auto h-12 w-12 text-gray-400" />
  <h3 className="mt-2 text-sm font-semibold text-gray-900">No projects</h3>
  <p className="mt-1 text-sm text-gray-500">
    Get started by creating a new project.
  </p>
  <button className="mt-6 bg-primary-600 text-white ...">New Project</button>
</div>
```

Hide supporting UI (filters, tabs, sorting) until content exists.

## Forms

```jsx
// Standard form layout
<form className="space-y-6">
  {/* Group label tight with input */}
  <div className="space-y-1">
    <label className="block text-sm font-medium text-gray-700">Email</label>
    <input
      type="email"
      className="block w-full rounded-md border-gray-300 shadow-sm"
    />
  </div>

  {/* Help text below input, also tight */}
  <div className="space-y-1">
    <label className="block text-sm font-medium text-gray-700">Password</label>
    <input type="password" className="..." />
    <p className="text-sm text-gray-500">Must be at least 8 characters</p>
  </div>
</form>
```

## Cards

```jsx
<div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
  {/* Optional accent border */}
  <div className="border-t-4 border-primary-500" />

  <div className="p-6">
    <h3 className="text-lg font-semibold text-gray-900">Card Title</h3>
    <p className="mt-2 text-gray-600">Card description text...</p>
  </div>

  {/* Footer with different background */}
  <div className="bg-gray-50 px-6 py-4">
    <button>Action</button>
  </div>
</div>
```

## Tables

Think beyond boring columns—combine related data:

```jsx
// ✅ Good: Rich table cells with hierarchy
<tr>
  <td className="py-4">
    <div className="flex items-center gap-3">
      <img className="h-10 w-10 rounded-full" src={user.avatar} />
      <div>
        <div className="font-medium text-gray-900">{user.name}</div>
        <div className="text-sm text-gray-500">{user.email}</div>
      </div>
    </div>
  </td>
  <td>
    <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
      Active
    </span>
  </td>
  <td className="text-right text-gray-500">{user.lastSeen}</td>
</tr>
```

## Dropdowns

Don't limit to just a list of links:

```jsx
// Rich dropdown with sections
<div className="absolute shadow-lg rounded-lg bg-white ring-1 ring-black/5 p-2 w-64">
  <div className="px-3 py-2">
    <p className="text-sm font-medium text-gray-900">{user.name}</p>
    <p className="text-xs text-gray-500">{user.email}</p>
  </div>
  <hr className="my-2" />
  <a className="block px-3 py-2 text-sm rounded hover:bg-gray-100">Settings</a>
  <a className="block px-3 py-2 text-sm rounded hover:bg-gray-100">Help</a>
  <hr className="my-2" />
  <a className="block px-3 py-2 text-sm text-red-600 rounded hover:bg-red-50">
    Sign out
  </a>
</div>
```

---

# FINISHING TOUCHES

## Supercharge Defaults

| Default            | Upgrade                              |
| ------------------ | ------------------------------------ |
| Bullet points      | Icons (checkmarks, arrows, custom)   |
| Blockquotes        | Large styled quotation marks         |
| Plain links        | Custom underlines with accent colors |
| Browser checkboxes | Custom styled with brand colors      |

## Accent Borders

Add visual interest without graphic design skills:

```jsx
// Top of card
<div className="border-t-4 border-primary-500 ...">

// Side of alert
<div className="border-l-4 border-yellow-400 bg-yellow-50 p-4">

// Under heading
<h2 className="pb-2 border-b-2 border-primary-500 inline-block">

// Top of page
<div className="border-t-4 border-primary-500">
  <nav>...</nav>
</div>
```

## Background Decoration

Break up monotony with:

- Subtle gradient (two hues within 30° of each other)
- Faint repeating pattern
- Geometric shapes at low opacity
- Different background colors per section

---

# QUICK DECISION CHECKLIST

When building a component, ask:

- [ ] **Hierarchy:** Is it clear what's most important? (Use 3 levels max)
- [ ] **Spacing:** Is related content grouped tightly? Unrelated content
      separated?
- [ ] **Labels:** Can I remove any labels? Can I combine label + value?
- [ ] **Buttons:** Is there only ONE primary action? Are others clearly
      secondary?
- [ ] **Width:** Am I using only the space I need? (Don't fill for the sake of
      filling)
- [ ] **Color:** Am I relying on color alone for meaning? (Add icons/text)
- [ ] **Empty state:** What does this look like with no data?
- [ ] **Borders:** Can I use shadow, background, or spacing instead?

---

# COMMON MISTAKES TO AVOID

1. **Making everything equal** → Create clear hierarchy
2. **Using only size for emphasis** → Add weight and color
3. **Gray text on colored backgrounds** → Match the hue
4. **Two primary buttons** → One primary, rest secondary/tertiary
5. **Filling all available space** → Use only what content needs
6. **Percentage-based sidebars** → Use fixed widths
7. **Scaling icons beyond intended size** → Use containers
8. **Labels on self-evident data** → Let format speak
9. **Borders everywhere** → Try shadows, backgrounds, spacing
10. **Ignoring empty states** → Design them intentionally

---

_Reference: Refactoring UI by Adam Wathan & Steve Schoger_
