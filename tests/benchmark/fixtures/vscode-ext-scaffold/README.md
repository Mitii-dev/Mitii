# vscode-ext-scaffold

Minimal standalone VS Code extension (not the real `apps/vscode` extension —
patterned after its `vsce`-based packaging convention). `npm run build` compiles
`src/extension.ts` to `out/extension.js`, but `package.json`'s `main` field
points at `./dist/extension.js` (a directory the build never produces), and
`publisher`/`repository` are missing — so `npm run package` (`vsce package
--no-dependencies`) fails with a real "Extension entrypoint(s) missing" error.

Used for `cicd/cases/vscode-publish.jsonl`: fix the build/`main` mismatch so
packaging succeeds, and add the `publisher`/`repository` fields a real
marketplace release needs (vsce only warns about `repository` at package time,
but both are required for an actual `vsce publish`).
