# Manuscript small-action frame

`manuscript-frame.png` is the generated ornament for the user-selected “古书页签” direction (2026-09-17).

- Generated with the built-in Image Gen tool; background removal, cropping and resizing were applied to obtain a 256 × 96 transparent PNG.
- Use as a nine-slice border image: slice 12, rendered width 8 CSS px (16rpx in the mini program), stretch edges, no center fill.
- Web controls use the file directly. The native mini program embeds the same PNG as a data URL in `miniprogram/app.wxss` because WXSS local image references are restricted.
- Standard action icons remain the project's existing icon assets.
