# Corpus notes (`.mitii/corpus/`)

Drop markdown or plain-text notes under `.mitii/corpus/`, then run the host `runCorpusIndex` helper to write `.mitii/corpus/index.json`. When `createHostRepositoryContext({ corpusEnabled: true })` is set and that index exists, hybrid retrieval adds a host-side corpus source (provenance id `corpus`) so playbooks and runbooks can surface beside repo code context. Corpus RAG stays opt-in and defaults off.
