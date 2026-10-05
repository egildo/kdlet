# Logo brief: kdlet

Pronounced "kay-dee-let". Lowercase everywhere.

## What it is

kdlet is a small template language written in KDL: "Pug for any tree". A file says where values go and what repeats; a renderer brings the words (HTML, a design tool's frames), and the output is a tree in which every node can be found again.

## Personality

Small, strict, quiet, honest. A well-made hand tool, not a platform. Plain geometry, even weight, nothing decorative.

Not playful-startup (mascots, blobs, bright gradients), not enterprise (shields, swooshes, globes), not clever (puns that need explaining). No leaves, no literal oak trees.

## Directions

1. **Tree.** Three or four nodes joined by right-angle edges, the root filled, the rest outlined.
2. **Stencil.** A square with a shape cut out: the template is the hole, the data fills it.
3. **Braces.** KDL's `{ }` reduced to two corner marks framing a dot: a node and its block.
4. **Node with identity.** One circle with a small square inside, or a dot with a short tag line: a node that can be named and found again.
5. **Let.** Wordmark only, "let" in the second colour: the thing that is supplied.

Pick 1, borrowing from 3: nodes as small squares or circles on straight edges, the root distinct. It is the one idea true of every renderer, it survives 16px, and it needs no knowledge of KDL.

## Constraints

- Favicon at 16px and README header at about 260px wide.
- Light and dark backgrounds: one SVG, colour swapped by `prefers-color-scheme`, as now.
- One colour, two at most. Near-black on light, light grey on dark; one accent if the mark needs it.
- SVG-native: flat fills, simple geometry, no gradients, shadows, blur or masks.
- Wordmark "kdlet", lowercase, geometric sans near the current weight.
- The mark stands alone without the word.

## From the current logo.svg

Keep: the heavy geometric lowercase, the single fill (`#333`, `#d0d0d0` in dark mode) with the media-query swap, the restraint. The tone is right.

Drop: the name, and the wordmark-only approach: with no mark it cannot be a favicon. Redraw the letters rather than stretching the old paths to fit an "e".

## Deliverables

1. SVG mark, alone, square viewBox.
2. SVG lockup, mark plus wordmark, for the README header.
3. Monochrome variant of both (single fill, no accent).
4. 32px and 16px renders of the mark, checked on a light and a dark page.

## Exploration prompt (image model, exploration only)

Final artwork must be hand-built SVG; this is for sketching.

> Minimal logo mark for a small programming tool named "kdlet". Flat vector, single near-black colour on white, no gradients, no shadows, no text. A tiny tree: three to four nodes drawn as small circles or squares joined by straight right-angle lines, the root node filled, the others outlined. Geometric, even stroke, lots of whitespace, legible at 16 pixels. Quiet and precise, like a Swiss technical mark. Four variations on one sheet.
