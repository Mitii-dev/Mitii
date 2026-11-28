# Established facts

Mid-run observation / compiler-queue facts that must survive compaction.

## Owns
- `extractEstablishedFact` / upsert / drop-by-path
- Compiler error queue parse + path helpers

## Does not own
- Compaction ladder reinject (`helpers/compaction`)
- Memory port refresh after compaction
