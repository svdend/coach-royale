# CoachRoyale Branding

Five logo concepts for **CoachRoyale**, the Clash Royale coaching and analysis web app. Each concept ships in two variants — full-color (using the OKLCH brand palette converted to hex equivalents) and monochrome (using `currentColor` so the mark inherits whatever ink color the host element uses).

The brand promise the mark has to carry: _premium, expert, thoughtful coaching for the ladder Clash Royale player._ It is not a fan tool, leaderboard, or tier-list app. The mark needs to feel closer to a chess club crest or a sports-performance brand than to a mobile-game splash screen.

All marks are pure path-based SVG, no embedded images, no external fonts in the icon marks. They use either `viewBox="0 0 64 64"` (icon marks) or `viewBox="0 0 280 64"` (lockups) and scale crisply from 16 px favicon to 512 px home-screen icon.

## Palette (hex equivalents of the OKLCH tokens in `apps/web/src/index.css`)

| Token           | OKLCH                  | Hex used here            |
| --------------- | ---------------------- | ------------------------ |
| `--background`  | `oklch(0.18 0.04 285)` | `#0a0a23` (deep navy)    |
| `--gold`        | `oklch(0.82 0.16 85)`  | `#f0c544` (primary gold) |
| `--gold` shadow | `oklch(0.75 0.14 65)`  | `#d4a017` (deeper gold)  |
| accent purple   | `oklch(0.6 0.15 285)`  | `#6b46c1` (royal purple) |
| ink on plate    |                        | `#1a1a3a` (subtle bevel) |
| paper white     |                        | `#f5f5f0` (wordmark)     |
| muted text      |                        | `#9c9cb5` (taglines)     |

Palette swap to true OKLCH in CSS at integration time is fine — the structural choices in each mark are colorblind-safe (silhouette and weight do the work, color reinforces).

---

## Concept 1 — Sigil

`concept-1-sigil.svg`, `concept-1-sigil-mono.svg`

**Metaphor.** A royal sigil. A three-peak crown on a navy plate, with a coaching check-mark embedded in the negative space of the crown body. Reads as both _crown_ (royal / Royale) and _correct_ (the coach approves your line of play).

**Why it works.** The check-mark is a coaching primitive — every coaching surface in the app, from `CoachChat` to `WeeklyPlan`, is essentially "here is the corrected move." Putting that gesture _inside_ the crown means the coaching meaning isn't bolted on; it's the structural center of the mark. The plate gives the mark a contained iOS-style icon silhouette out of the box, so we get a free Add-to-Home-Screen lookalike.

**Risks.** Three-peak crowns are common. We mitigate by making this crown angular and slightly art-deco rather than the rounded cartoon crown shape associated with Supercell's IP. The mono variant uses a mask to punch out the check, jewels, and a base gem so the result is one solid silhouette — careful test it at 16 px before committing.

**When to use.** Strong general-purpose mark; works on light and dark, square and round. First choice if we want the icon to feel "stamped" / "official."

---

## Concept 2 — Sentinel

`concept-2-sentinel.svg`, `concept-2-sentinel-mono.svg`

**Metaphor.** A magnifying lens (analysis, review, scrutiny) crowned with a small royal coronet. The handle of the lens is angled at 45 degrees so the silhouette doubles as a scepter. A small upward chevron sits inside the lens to reinforce _coaching = improvement_.

**Why it works.** Of the five concepts this is the most explicitly _analytical_. CoachRoyale's primary differentiator is post-match analysis and AI-assisted review; a magnifier is the most universal symbol for that activity. The crown perched on top categorically frames it: this analysis is for Royale players specifically.

**Risks.** "Magnifier with thing on top" is a saturated visual idiom (every analytics SaaS in 2020 used one). The crown helps, but the mark is also the most visually busy of the five at small sizes — the chevron-inside-the-lens decoration disappears at 16 px and the silhouette starts to look like a generic search icon. Less premium feeling than Concept 3 or 4.

**When to use.** Best as the marketing-site hero mark or the "Analysis" tab icon in-app. Probably not the right call for the favicon because it loses its meaning at 16 px.

---

## Concept 3 — Pathway _(recommended)_

`concept-3-pathway.svg`, `concept-3-pathway-mono.svg`, `lockup-pathway.svg`, `lockup-pathway-mono.svg`

**Metaphor.** An abstract crown built from an upward-trending trend line — seven straight segments, three peaks, each peak taller than the last. Reads simultaneously as a _crown_ and as a _chart of ascent_. Three jewels mark the peaks; the center (the goal) is the brand purple, the flanks are gold.

**Why it works.** This is the only concept where the metaphor _is_ the product. CoachRoyale measures your progress over time and tells you how to climb. A crown made of an ascent line says exactly that, in a single shape, with no ornament. The asymmetry — peaks rising left to right rather than the symmetrical center-tallest cartoon-crown shape — actively pushes the mark away from Supercell's IP and toward something editorial / sports-analytics.

It also _survives_ the 16 px test better than any of the other four. At favicon scale all you can read is a zigzag with three dots on it, but a zigzag with three dots is unmistakably a chart, and that's still on-brand.

**Risks.** A jagged line is less "logo-y" than a contained sigil — if the team wants something that looks more like a crest stamped on a flag, this isn't it. The mono variant relies on the jewels (filled dots) for character; on hosts where the dots blow out (e.g. very low-resolution rendering) the mark reads as a plain zigzag. Worth a test at 16 px on the actual target browsers.

**When to use.** Everywhere. Use the full-color icon mark for favicon, iOS Add-to-Home-Screen, social og:image, and the SPA header on dark surfaces. Use the lockup on the marketing site and signed-out `/` empty state. Use the monochrome variant on print collateral, partner co-marketing, and any place where the mark needs to live inside a single-color block (e.g. a button, a stamp, or merchandise).

---

## Concept 4 — Tactician

`concept-4-tactician.svg`, `concept-4-tactician-mono.svg`

**Metaphor.** A chess rook with battlement crenellations and a royal crest. Reads as _tower_ (Clash-adjacent without infringing — every fortress has battlements), _chess piece_ (deliberate, tactical thinking), and _coat of arms_ (premium, official).

**Why it works.** It's the most "premium" of the five. The chess-piece silhouette skews older / more serious than a crown, which suits the "thoughtful coaching, not a fan tool" positioning. The mid-body crest with a purple gem gives the mark a single ornamental focal point without piling on.

**Risks.** Chess-piece silhouettes are heavily owned by chess.com / lichess and several productivity apps. Even with the crenellations and crest, this might read as "chess product, also somehow Clash" rather than the other way around. It's also the most masculine of the five — worth a sense-check against the actual target user.

**When to use.** Strong as a secondary "Pro tier" badge or as the mark on premium subscription marketing. Could work as the primary mark if the brand wants to lean fully editorial. Less suited to the in-app favicon because the tall vertical silhouette wastes space inside a square plate at 16 px.

---

## Concept 5 — Pulse

`concept-5-pulse.svg`, `concept-5-pulse-mono.svg`

**Metaphor.** A crown silhouette assembled from a battle telemetry / heartbeat waveform. Flat baseline, three rising spikes, return to baseline. The tallest spike is in the center and carries the brand-purple jewel. Subtle horizontal grid lines behind the waveform suggest a chart background.

**Why it works.** This is the most kinetic of the five. The waveform reads as both _crown_ (three peaks, jewels) and _match telemetry_ (the AI analyzes every battle and surfaces vital signs). It signals that the product is alive / live / responsive — useful framing for the AI Coach chat and weekly plan refresh features.

**Risks.** Heartbeat-line logos are also a saturated idiom (healthtech, fitness, gaming-overlay tools all use them). Without the crown jewels at the peaks, the silhouette would lean too generic. The grid lines do real work but cost a few path nodes — they're the first thing to drop if we ever need a smaller file.

**When to use.** Best for moments where we need motion / vitality — a loading state, a live-coach indicator, the "Sync" affordance. Could work as an alternate / "Live" badge alongside the primary mark. Less ideal as the only mark because it's the loosest fit to the "thoughtful" half of the positioning — it's energetic, not contemplative.

---

## Recommendation: **Concept 3 — Pathway**

The recommendation is unambiguous, and the reason is unambiguous: it's the only concept where the _shape itself_ is the product story. The mark literally is a chart of you climbing the ladder, and it reads as a crown the moment your eye latches on to the three peaks and the jewels.

Three secondary reasons:

1. **It survives every size.** At 512 px (Add-to-Home-Screen) the jewels carry color and depth. At 64 px (header) the asymmetric ascent is visible and unique. At 16 px (favicon) it collapses to a zigzag with three dots, which still reads as "chart" — i.e. on-brand even when degraded. The other four concepts each lose meaning between two of those three sizes.
2. **It's defensibly original.** A crown made of a chart line is structurally different from any Supercell IP, from chess pieces, and from the magnifier-on-top idiom. We can use it on a marketing site without lawyer review.
3. **It composes well with the existing UI.** The trend-line aesthetic already shows up implicitly in the `StatsPanel` chart cards and the `gold-text` gradient. Concept 3 makes that visual language explicit and lets the rest of the UI feel intentional rather than "generic shadcn with a crown icon stuck on top" (which is the current state and the standing critique from the frontend-design review).

If the recommendation is rejected, the next-best choice is **Concept 1 — Sigil**, which is the safest, most generic-premium option and would be the right call if the team wants the mark to feel like an officially-stamped crest.

## Use guide (per surface)

| Surface                                                       | Asset                                                                                                              | Variant                                                                                    |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `favicon.svg` (browser tab, 16-32 px)                         | `concept-3-pathway.svg`                                                                                            | Full color, navy plate                                                                     |
| iOS Add-to-Home-Screen / `apple-touch-icon` (180 px)          | `concept-3-pathway.svg`                                                                                            | Full color, navy plate (matches dark theme)                                                |
| Android maskable icon                                         | `concept-3-pathway.svg`                                                                                            | Full color; safe zone is the inner 80% — the rounded-square plate handles the mask cleanly |
| SPA header (`apps/web/src/App.tsx`)                           | `lockup-pathway.svg` on xl breakpoints, `concept-3-pathway.svg` on sm                                              | Full color                                                                                 |
| Loading / splash                                              | `concept-3-pathway.svg`                                                                                            | Full color                                                                                 |
| Empty-state cards                                             | `concept-3-pathway-mono.svg` with `color: var(--muted-foreground)`                                                 | Mono                                                                                       |
| Email / transactional / receipts                              | `lockup-pathway-mono.svg` with `color: #0a0a23`                                                                    | Mono dark                                                                                  |
| Print / partner co-marketing                                  | `lockup-pathway-mono.svg` with `color: currentColor`                                                               | Mono, monospec                                                                             |
| Social `og:image`                                             | Full-color icon mark on the dark `#0a0a23` background — embed `concept-3-pathway.svg` centered on a 1200x630 plate |
| Button/icon nav slot (e.g. replace the lucide `Crown` import) | `concept-3-pathway-mono.svg`                                                                                       | Mono inheriting `color: currentColor`                                                      |

## Notes for the implementer

- All marks declare `<title>` for accessibility; pair with `role="img"` and `aria-label` on the host `<img>` if loaded externally.
- `currentColor` in the mono variants is intentional — drop them in via a React component or `<img>` with CSS `color` rather than a hard-coded fill, so dark/light/gold all work without rebuilding the asset.
- The lockup uses `font-family="Georgia, 'Times New Roman', serif"` with no embedded font. If we later choose a brand serif (e.g. EB Garamond or Source Serif), update the lockup file and re-export — the structural geometry of the mark itself is independent of the wordmark font.
- None of the marks rely on filters, gradients, or transparency tricks. They will render identically on every browser including ancient WebViews on cheap Android phones — which matters because 80% of CoachRoyale traffic is mobile.

## File index

- `concept-1-sigil.svg`, `concept-1-sigil-mono.svg`
- `concept-2-sentinel.svg`, `concept-2-sentinel-mono.svg`
- `concept-3-pathway.svg`, `concept-3-pathway-mono.svg` _(recommended)_
- `concept-4-tactician.svg`, `concept-4-tactician-mono.svg`
- `concept-5-pulse.svg`, `concept-5-pulse-mono.svg`
- `lockup-pathway.svg`, `lockup-pathway-mono.svg` _(bonus, for the recommended concept)_
