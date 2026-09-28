# Profile option 2 — journal

Branch: codex/profile-journal
Base: 364c372ac47fe330a505ed3aff7a1781835a1eb3
Worktree: D:/tarot-web-profile-journal
Preview: http://127.0.0.1:4112/profile

The app keeps its existing authentication, ProfileEditor, user statistics, avatar route and MainNav. Changes cover profile presentation/static artwork plus an explicit optional compact presentation on ProfileEditor; its default mode and editing handlers are unchanged. Four original journey links remain present.

## Run the isolated visual preview
Use Node 24 as specified by .nvmrc.
1. Run npm ci.
2. For a fresh worktree, copy model.config.example.json to the gitignored model.config.json and disable PAYMENT_V3_POLL_ENABLED. Never copy production secrets into the preview.
3. Run npx next build --webpack.
4. Run node tests/helpers/profile-preview.mjs 4112 4212 --production.
For development omit --production.

This harness binds to 127.0.0.1, starts a separate Next process, serves in-memory sample account data, and intercepts all /api requests. It strips cookies and authorization before proxying page/assets. It is not imported by the production application. Nickname changes in the preview affect only fixture memory and reset on restart. Unknown APIs return 501, so this is a profile design preview, not an end-to-end backend test. Do not expose the harness externally.

POST JSON to /__fixture to select signed-in, signed-out, loading or error scenario; set reset: true to restore defaults; failSave: true injects one nickname-save failure. These controls belong only to the fixture server.

## Architecture review
Consulted ChatGPT Latest with Pro before implementation:
https://chatgpt.com/c/6aaa58ba-76c8-83e8-a6e3-2f889642aa29

Adopted: two worktrees from the same commit; presentation-only JSX/local CSS/assets; unchanged shared ProfileEditor/UserSession/MainNav; semantic native links; natural scrolling and readable text; independent dependencies/build output; local fixture isolation; tests and browser QA.
Corrective review removed unused feedback space only in compact mode. Name/input/badge anchors stay stable; visible errors expand downstream in normal flow. The extra English caption was removed to match the reference. The grid falls back to one column below 340px. No backend or shared-style changes were needed.
See design-qa.md for visual evidence, accepted differences and verification limits.

Corrective review: the prior density exception was rejected by the user. The revision matches the reference section landmarks, centers grid text and gives the encyclopedia a distinct book silhouette. See the latest design-qa.md for actual measurements.

## Identity edit affordances
Avatar and 更换头像 now form one left-side target; 修改昵称 is visible inside the existing compact nickname trigger. Both action labels use the same sans type and gold token; compact nickname display/input share a system serif stack. The comfortable editor mode is unchanged. The Latest + Pro follow-up recommended this arrangement and preserving mobile density; existing disabled avatar-button behavior was retained as a scoped compatibility choice. See design-qa.md for final production comparisons, regression evidence, and platform limits.

## Adaptive screen height
The profile uses page-local viewport min-height and flexible equal rows. Avatar label spacing is6px above and8px below. Surplus height expands the four entry areas; footer clearance above the existing safe-area-aware navigation is10px. At720px height and below, the footer brand/tagline share a row; grid below340px keeps one column with compact decoration. Text sizes and nickname validation are unchanged.

The content layout fits at40 sampled combinations of320/375/390/430px widths and660–844px heights (including breakpoint checks). Per the latest user preference, the outer mobile surface now adds24px of native document scroll travel without changing that layout.600px-high screens retain their natural overflow plus24px (approximately70–76px total). Very short screens, expanded errors, keyboard and enlarged text may scroll naturally. Latest + Pro reviewed this approach before changes. See design-qa.md for screenshots, exact checks and physical-device limitations.

## Main integration for PR36
Merged main2a31ddb and retained its available-draw balance and purchase route in a compact strip after statistics. Payment/backend code matches main. The fixture account includes300 draws; /__fixture accepts nonnegative safe-integer creditBalance. Wallet preview returns that same balance with purchases disabled, no plans, and empty order/refund records.

131 tests in8 suites, lint, final production build and browser navigation/layout checks passed. The44px purchase link and all four journey routes remain available. See the latest design-qa.md for changed short-screen limits and integration evidence.

## Gentle native scrolling
The user approved the current layout but requested some scroll movement. Mobile outer surface padding adds24px outside the viewport-sized main. At the top, all content coordinates stay unchanged; at the bottom, footer/navigation clearance is approximately34px. Scroll back normally; there is no forced snap, synthetic bounce or nested scroller. Desktop is unchanged. Latest + Pro reviewed the approach; production wheel interaction, geometry comparison,82 focused regressions, lint and build passed.
