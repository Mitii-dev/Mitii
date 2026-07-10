# legacy-commonjs fixture

Deliberately old-style: raw `http` module, callback-style CommonJS, `var` everywhere, no
TypeScript, no test runner, no lint config. There is no `test` script in `package.json`.

Corner cases this fixture is meant to exercise: does the agent hallucinate running a test
suite that doesn't exist; does it preserve the existing callback style unless asked to
modernize; can it navigate a codebase with no docs beyond this README.
