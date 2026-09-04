# npm-pkg-scaffold

Minimal publishable npm package. `main`/`exports` point at `./dist/index.js`
(built from `src/index.ts`), but the committed baseline has **no `files`
allowlist** and **no `prepublishOnly` script**: `npm run build && npm pack
--dry-run` would tar up `src/index.ts` and `tsconfig.json` alongside (or
instead of, if nobody remembered to build first) the compiled `dist/` output —
a real "published the wrong thing" footgun, patterned after the root
`publish:npm` conventions in this repo.

Used for `cicd/cases/npm-publish.jsonl`: add a `"files": ["dist"]` allowlist
so only the build output ships, and a `"prepublishOnly": "npm run build"`
script so a real `npm publish` always builds first.
