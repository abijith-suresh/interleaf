# PLAN.md

## Goal

Port the winning design — **Ashlight (Design 5)** — into the real app. This
means replacing the existing color tokens and typography with the Ashlight
system, updating every component that has opinionated visual styling, updating
all static sub-pages, and removing the five mockup pages entirely.

Functionality is **not** the focus of this phase. Existing stores, IndexedDB
logic, and keyboard handling stay untouched. Only the visual layer changes.

## Reference

- Token source of truth: `src/styles/design5.css`
- Component reference: `src/pages/Design5.tsx`

### Ashlight token values

**Light mode:**

| Token                    | Value     |
| ------------------------ | --------- |
| `--color-bg`             | `#fafaf8` |
| `--color-surface`        | `#f3f2ef` |
| `--color-surface-hover`  | `#eceae6` |
| `--color-border`         | `#e2e0db` |
| `--color-border-subtle`  | `#eeece8` |
| `--color-text-primary`   | `#1a1917` |
| `--color-text-secondary` | `#6b6660` |
| `--color-text-tertiary`  | `#a8a39d` |
| `--color-accent`         | `#9b7f6a` |
| `--color-accent-subtle`  | `#f0e8e0` |
| `--color-danger`         | `#c0392b` |

**Dark mode:**

| Token                    | Value     |
| ------------------------ | --------- |
| `--color-bg`             | `#111110` |
| `--color-surface`        | `#191917` |
| `--color-surface-hover`  | `#222220` |
| `--color-border`         | `#2e2d2a` |
| `--color-border-subtle`  | `#252420` |
| `--color-text-primary`   | `#f0ede8` |
| `--color-text-secondary` | `#7a7570` |
| `--color-text-tertiary`  | `#4a4844` |
| `--color-accent`         | `#c4a882` |
| `--color-accent-subtle`  | `#2a241e` |
| `--color-danger`         | `#e74c3c` |

### Ashlight typography

| Role                | Font       | Size | Weight      | Notes                            |
| ------------------- | ---------- | ---- | ----------- | -------------------------------- |
| UI chrome           | Outfit     | —    | 300/400/500 | All buttons, labels, titles      |
| Wordmark            | Newsreader | 20px | 400         | Italic only                      |
| Group date labels   | Outfit     | 10px | 500         | Uppercase, letter-spacing 0.12em |
| Sidebar footer btns | Outfit     | 11px | 400         | Lowercase, no underline          |
| Editor content      | Newsreader | 17px | 300         | Line-height 1.8                  |

### Ashlight interaction specifics

- **Sidebar width:** 232px
- **Active note:** `color: var(--color-accent)`, `font-weight: 500` — no
  background fill, no left border
- **Inactive note hover:** underline only (`text-decoration-color:
var(--color-border); text-underline-offset: 3px`) — no background fill
- **Editor:** borderless `textarea` directly on `--color-bg`; zero chrome
- **Tab bar:** background is `--color-surface`; active tab uses
  `box-shadow: inset 0 -2px 0 var(--color-accent)` instead of a filled bg
- **Tab close:** `×` character (not a plain "x")
- **New note button:** plain `+`, color tertiary, hover → accent
- **Sidebar footer:** text-only, lowercase, Outfit 11px
- **Scrollbar:** 4px, thumb = `--color-border`, hover = `--color-text-tertiary`
- **Textarea caret:** `--color-accent`
- **Textarea placeholder:** `--color-text-tertiary`

---

## Steps

### 1 — Install fonts

Install `@fontsource-variable/outfit` and `@fontsource/newsreader` via bun.
Remove (or keep but stop importing) `@fontsource/geist`.

### 2 — Update global CSS tokens (`src/index.css`)

- Replace all `--color-*` values in the `@theme {}` block with the Ashlight
  light-mode values listed above.
- Replace the dark-mode overrides in `[data-theme="dark"]` with the Ashlight
  dark-mode values.
- Replace `--font-sans` with `"Outfit", ui-sans-serif, sans-serif`.
- Add a `--font-serif` entry: `"Newsreader", Georgia, serif`.
- Adjust `--font-weight-light: 300` (add) alongside existing weight tokens.
- Add Ashlight global rules below the existing base block:
  - Scrollbar (4px, transparent track, `--color-border` thumb)
  - `textarea { caret-color: var(--color-accent); }`
  - `textarea::placeholder { color: var(--color-text-tertiary); }`

### 3 — Update font imports in all entry files

In each entry file (`src/main.tsx`, `src/about.tsx`, `src/changelog.tsx`,
`src/features.tsx`, `src/keyboard-shortcuts.tsx`, `src/privacy.tsx`):

- Remove the Geist font imports.
- Add imports for Outfit variable font and Newsreader.

### 4 — Update `AppShell.tsx`

- Set sidebar width to 232px (wherever it's currently hardcoded or set via a
  class).
- Ensure no background color or border class on the app shell wrapper
  conflicts with the new token values (most will resolve automatically via
  token cascade).

### 5 — Update `Sidebar.tsx`

**Note list — active state:**

- Remove `border-l-2 border-l-accent` and any active background class.
- Apply `text-accent font-medium` on the active note item instead.

**Note list — hover state:**

- Replace any hover background class with an underline-only approach:
  `hover:underline decoration-border underline-offset-[3px]` (or equivalent
  inline style if Tailwind classes are insufficient).

**Group date labels:**

- Apply Outfit 10px, weight 500, uppercase, letter-spacing 0.12em.
  Use `text-xs tracking-[0.12em] uppercase font-medium` or equivalent.

**Wordmark:**

- Apply `font-serif italic text-lg font-normal` (Newsreader italic 20px).

**New note button:**

- Render a plain `+` character (no icon SVG needed).
- Color tertiary by default, accent on hover.

**Footer buttons:**

- Plain lowercase text labels (Search, theme, export, about).
- Outfit 11px, color tertiary, no underline, hover → accent color.
- No icons required for this phase.

### 6 — Update `TabBar.tsx`

- Set tab bar background to `bg-surface`.
- Replace the active tab's filled background with a bottom shadow:
  `box-shadow: inset 0 -2px 0 var(--color-accent)` (inline style or a
  custom Tailwind utility in `index.css`).
- Change tab close button character from `x` to `×`.

### 7 — Update `Editor.tsx`

- Remove all border/box classes from the textarea wrapper and the textarea
  itself.
- Set the textarea to sit directly on `bg-bg` with no border, no radius,
  no shadow.
- Apply `font-serif text-md font-light leading-relaxed` to the textarea
  (Newsreader 17px weight 300 line-height 1.8).
- Ensure the markdown preview section (if rendered) also uses Newsreader
  for body text.

### 8 — Update `SimplePage.tsx`

- Remove the bordered card wrapper.
- Use an open, document-style layout: generous horizontal padding, no
  outer border, max-width constrained readable line measure (~680px),
  centered.
- Section headings: Outfit, slightly larger than body.
- Body text: Newsreader 17px weight 300 line-height 1.8.
- Links: `color-accent`, no underline by default, underline on hover.

### 9 — Update `index.html` and sub-page HTML files

In `index.html` and each of `about/index.html`, `changelog/index.html`,
`features/index.html`, `keyboard-shortcuts/index.html`,
`privacy/index.html`:

- Update `<meta name="theme-color">` to `#fafaf8` (light) / `#111110`
  (dark) if present; or add it if absent.

### 10 — Remove mockup pages

Delete the following files and directories:

- `/1/`, `/2/`, `/3/`, `/4/`, `/5/` — HTML entry directories
- `src/1.tsx`, `src/2.tsx`, `src/3.tsx`, `src/4.tsx`, `src/5.tsx` — entry files
- `src/styles/design1.css` through `src/styles/design5.css`
- `src/pages/Design1.tsx` through `src/pages/Design5.tsx`

### 11 — Clean up `vite.config.ts`

Remove the five `design-1` through `design-5` entries from
`rollupOptions.input`.

### 12 — Verify

- Run `bun run verify` (typecheck + lint + format check) — must pass clean.
- Run `bun run build` — must complete without errors; dist must contain only
  the real app pages (no `/1/`–`/5/`).
- Spot-check in the browser: light mode and dark mode both render correctly;
  editor uses Newsreader; sidebar footer is text-only; active note has no
  left border.

---

## Completed phases

### Mockup exploration (done)

Five standalone design mockup pages (`/1`–`/5`) were built as self-contained
SolidJS components to explore different visual directions. **Ashlight
(Design 5)** was selected as the winner.

## Current Step

Step 1 — Install fonts.
