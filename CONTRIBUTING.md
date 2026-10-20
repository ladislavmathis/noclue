# Contributing to noclue

Thank you for helping. Small, focused pull requests are easiest to review.

1. Read [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) and run `npm install`.
2. Before opening a pull request, run `npm run format`, `npm run typecheck`, `npm test` and,
   for UI or audio changes, `npm run test:browser`.
3. Keep the brand rules in [docs/BRAND.md](docs/BRAND.md): orange is the only accent, no shadows
   or glows, Manrope for UI text, Anta only for the logo and short display headlines.
4. Write UI text in the noclue tone: short sentences, calm, no exclamation marks, no blame.

Never commit API keys, real meeting transcripts or private project material. `npm run
secrets:check` runs in CI.

By contributing you agree that your contribution is licensed under the MIT License.
