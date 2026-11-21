# Theming Mamba

A Mamba theme is a JSON file (`*.mamba-theme.json`) that controls **colors, effects, fonts and
layout**. Mamba supplies everything else: components, game data, artwork, links, downloads and
actions. Because a theme only arranges and styles what Mamba provides, a shared theme can't run
code, open links or change what a button does.

Anything a theme leaves out falls back to the original Mamba design, so a theme can be as small
as one setting.

Create themes in **Settings → Appearance**: use the color sections, **Fonts** and **Layout**, then
save or export. Exported files can be edited in any text editor and imported again.

## File structure

```json
{
  "schemaVersion": 1,
  "name": "Compact rows",
  "colors": {
    "background": "#181818",
    "foreground": "#202020",
    "input": "#303030",
    "icons": "#dedee3",
    "text": "#eeeeee"
  },
  "glass": { "opacity": 0.88, "blur": 22 },
  "layout": {
    "version": 1,
    "components": {
      "result-card": {
        "variant": "row",
        "slots": ["artwork", "title", "meta", "action"],
        "style": { "radius": 6, "titleLines": 1, "action": "icon" }
      },
      "result-grid": { "style": { "columns": 2, "gap": 16 } }
    }
  }
}
```

| Section                | Purpose                                                                           |
| ---------------------- | --------------------------------------------------------------------------------- |
| `colors`               | The theme roles: Background, Foreground, Input, Icons, Text (and Supporting Text) |
| `glass` / `effects`    | Opacity and blur for each role                                                    |
| `fonts` / `typography` | Embedded fonts and which interface roles use them                                 |
| `artworkIntensity`     | `subtle`, `balanced` or `immersive` artwork treatment                             |
| `navigation`           | Where page navigation appears                                                     |
| `layout`               | Component variants, slot order and style tokens (below)                           |

Themes contain appearance only. They never include API keys, source URLs, folders or other
settings.

## Layout

`layout.components` maps a component name to three optional fields:

- `variant`: one of the component's variants.
- `slots`: the parts to show, in order. Parts left out of the list are hidden.
- `style`: tokens with fixed ranges or keywords. Raw CSS isn't accepted.

### `result-card`: games in search results

| Slots      | Meaning                               |
| ---------- | ------------------------------------- |
| `artwork`  | Game artwork (opens details)          |
| `title`    | Game name (opens details)             |
| `meta`     | Release year and download size        |
| `services` | Download services that offer the game |
| `action`   | Play, Download, Resume or View button |

Default slots: `artwork, title, meta, services, action`. At least one of `artwork` or `title` is
required so every card can be opened.

Variants: `stacked` (default), `overlay` (title over the artwork), `row` (artwork on the left).

| Style token  | Values                        | Default      |
| ------------ | ----------------------------- | ------------ |
| `radius`     | 0–24 px                       | 8            |
| `padding`    | 0–32 px                       | 16           |
| `gap`        | 0–24 px                       | 8            |
| `titleLines` | 1–3                           | 2            |
| `surface`    | `foreground`, `input`, `none` | `foreground` |
| `border`     | `none`, `line`                | `line`       |
| `action`     | `label`, `icon`               | `label`      |

### `result-grid`: search results arrangement

| Style token | Values     | Default |
| ----------- | ---------- | ------- |
| `columns`   | 1–5        | 5       |
| `minWidth`  | 160–480 px | 240     |
| `gap`       | 0–48 px    | 24      |

### `game-details`: sections of a game page

| Slots          | Meaning                                         |
| -------------- | ----------------------------------------------- |
| `back`         | Back to Home or Library                         |
| `hero`         | Artwork, title and actions (see `detail-hero`)  |
| `metadata`     | Release date, developer, publisher, genre, size |
| `overview`     | Store description                               |
| `media`        | Screenshots and trailers                        |
| `installation` | Installation details and Manage Installation    |
| `content`      | DLC and demos                                   |
| `downloads`    | Available Downloads and release filters         |

All slots are shown by default in the order above; `hero` is required. Sections with nothing to
show (for example no screenshots) are skipped automatically. Esc, Alt+← and the mouse Back button
still work when `back` is hidden. Hiding `downloads` also removes the target of the Install
button, so keep it for themes meant for downloading games.

| Style token  | Values      | Default |
| ------------ | ----------- | ------- |
| `width`      | 640–1600 px | 900     |
| `sectionGap` | 0–64 px     | 0       |

### `detail-hero`: game page header

Slots: `artwork`, `eyebrow` (Steam game / Your game), `title`, `status` (install state and
last played), `actions`. `title` is required. Variants: `cinematic` (default, title and actions
over the bottom of centered artwork) and `split` (artwork on the left, details on the right).

| Style token | Values      | Default |
| ----------- | ----------- | ------- |
| `artWidth`  | 320–1600 px | 900     |
| `radius`    | 0–24 px     | 8       |

### `sidebar`: the side panel

Slots: `brand` (Mamba name and version) and `navigation` (pages and Recently Played), in that
order by default. `navigation` is required. Variants: `labeled` (default, icons with labels) and
`icons` (a narrow icon-only bar; labels appear as tooltips and Recently Played is hidden).

| Style token  | Values     | Default |
| ------------ | ---------- | ------- |
| `panelWidth` | 160–280 px | 192     |
| `itemHeight` | 36–56 px   | 44      |
| `iconSize`   | 16–24 px   | 20      |
| `radius`     | 0–12 px    | 6       |

Narrow windows still cap the width at 180 px (under 1100 px wide) and 160 px (under 640 px).
The `navigation` theme setting still chooses where the page buttons appear.

### `sidebar-nav`: page buttons and Recently Played

Slots: `home`, `library`, `activity`, `recent` (Recently Played), shown in that order by
default. At least one of `home`, `library` or `activity` is required. Settings always stays at
the bottom. Hidden pages are still reachable with Ctrl+1/2/3, and Recently Played fills whatever
height is left above Settings.

| Style token | Values   | Default |
| ----------- | -------- | ------- |
| `recentArt` | 24–48 px | 34      |

### `library-card`: games in the Library grid

Slots: `artwork`, `title`. Variants: `cover` (default, title appears over the artwork on hover
and focus) and `captioned` (title always shown below).

| Style token  | Values  | Default |
| ------------ | ------- | ------- |
| `radius`     | 0–24 px | 8       |
| `titleLines` | 1–3     | 2       |

## Compatibility

- Unknown components, slots and tokens are ignored, so themes made for newer versions of Mamba
  still load with the parts this version understands.
- Values of the wrong type or outside their range are rejected with a message naming the setting.
- A `layout.version` newer than this version of Mamba supports is rejected.

## For contributors: adding a component

1. Describe it in `src/shared/layout-model.js` with its slots, variants and style tokens. The
   defaults must reproduce the current design exactly.
2. Build it with `MambaComponents.render(name, builders)` from `src/renderer/scripts/components.js`,
   with one builder per slot that returns an element or `null`.
3. Style it in `src/renderer/styles/components.css` using `var(--<component>-<token>, default)` and
   `[data-variant]` / `[data-<token>]` selectors, with colors from the theme roles only.
4. Document it here and add cases to `test/layout-model.test.cjs`.
