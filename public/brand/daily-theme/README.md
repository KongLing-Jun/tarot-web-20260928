# Daily card solar theme

Decorative assets for the mobile daily-card design, generated with the
user-requested `gpt-image-2.5-sunburst` model on 2026-09-19. The approved
reference is `output/imagegen/daily-sunburst-20260918/daily-card-revised.png`.

- `solar-corona.webp`: 768 × 768 RGBA, 173,454 bytes. Antique gold solar disk,
  fine radial rays and a dotted orbit. Dark inter-ray residue removed during
  alpha cleanup; a separately generated orbit was composited at 92% width.
- `starfield.webp`: 768 × 1536 RGB, 8,922 bytes. Near-black violet sky,
  sparse gold stars and faint lower-left clouds. Retained as design provenance;
  the daily page now reveals the shared animated background instead.

These contain no UI text, moon decoration or tarot card. The page renders
live content and existing card art above the decorative corona CSS background.
The thin dotted orbit is part of the raster asset.

Local generation prompts and metadata are retained under
`output/imagegen/daily-sunburst-20260918/assets/`; credentials are excluded
from production files. Existing ritual font, arrow and star assets are reused.

## Ink sun revision — 2026-09-21

- `solar-ink.webp`: 768 × 768 RGBA, 422,660 bytes, lossless WebP. Replaces
  the displayed mobile corona with a transparent, distressed ochre ink sun.
  The original `solar-corona.webp` remains retained.
- Generated with built-in Image Gen from the user's selected third tarot-style
  reference: `C:/Users/admin/.codex/generated_images/01a0c327-66de-7c41-8871-31a70110c2f6/exec-e2907e24-5b96-48bb-aea8-d34a4312cafd.png`.
- Generation brief: isolate and reconstruct the reference's ink-printed sun;
  preserve broad curved rays, rough pigment edges and sparse flecks; keep the
  center and surrounding space transparent; omit the card, UI and text.
  Generated PNG: `exec-da5a4a83-7ad6-4edc-a95e-a57db8972726.png` in the same folder.
  Resized and losslessly encoded using the project's existing Sharp dependency.
- CSS centers it behind the existing card at 185% of the card-stage width and
  0.62 opacity. No card artwork, font or content asset was regenerated.

## Retained botanical exploration

`botanical.png` is a decorative gold botanical sprig generated with the built-in
Image Gen tool for an earlier editorial Daily Card design on 2026-09-17.
The generated black background was removed and the result resized to a
transparent 180 × 200 PNG. It is retained from the main branch as provenance;
the current solar daily page does not render this sprig or the editorial
moon/cloud header. Tarot artwork continues to use the existing card data.
