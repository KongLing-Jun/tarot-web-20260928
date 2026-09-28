# 月映卡语

*English · [简体中文](./README.zh-CN.md)*

A Next.js tarot and AI reflection app, also available through a WeChat Mini Program web-view. It includes a 78-card deck, six spreads, streaming readings, and account-based history.

Project documentation is maintained in **[docs/](./docs/README.md)**.

Frontend branding lives in [`miniprogram/brand.js`](./miniprogram/brand.js), shared with the website through `lib/brand.ts`. Title case and uppercase wordmarks derive from `englishName`; the homepage keeps `Moonlit Tarot`. After edits, run `npm run brand:sync` before WeChat developer-tool preview/upload. Builds and tests run the read-only `brand:check` command to detect static navigation-title drift. Check font subsets/fallback rendering for new characters. This configuration controls frontend presentation only.

- [Getting started and project guide](./docs/GUIDE.en.md)
- [Backend configuration](./docs/CONFIG.md), [database and login](./docs/DATABASE.md), [OSS images](./docs/OSS.md)
- [WeChat setup and gesture acceptance](./docs/MINIAPP.md)
- [Architecture](./docs/ARCHITECTURE.md)
- [Current integration and verification record](./docs/tasks/integration-20260911.md)

Source code is released under the [MIT License](./LICENSE); card imagery has separate terms described in the project guide.
