# type-cascade-small

Small TypeScript fixture (~13 source files). `Order.total` (`src/types/domain.ts`) has
**already** been widened from `number` to `{ amount: number; currency: string }` in the
committed baseline — six downstream consumers (a repository, two services, one DTO, and
a test) still treat it as a plain number, so `npm run typecheck` (`tsc --noEmit`) fails
out of the box. Used for the medium-tier case in `backend/cases/type-cascade.jsonl`: fix
every downstream consumer so the project typechecks and tests pass again, without
casting to `any` or adding `@ts-ignore`.

`npm run typecheck` is the primary signal; `npm test` builds and runs the two runtime
tests against compiled output.
