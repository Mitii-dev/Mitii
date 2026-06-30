import { readFileSync, statSync } from 'fs';
import type { ThunderDb } from './ThunderDb';
import { ChunkingService } from './ChunkingService';
import { FtsIndex } from './FtsIndex';
import { getExtractor, extractSymbolRefs, extractSymbolRefsWithTreeSitter } from './SymbolExtractor';
import { hasWasmGrammar } from './languageRegistry';
import { preloadWasmLanguage } from './TreeSitterService';
import { extractImports, resolveImportTarget } from './ImportExtractor';
import { createLogger } from '../telemetry/Logger';

import type { VectorIndexService } from './VectorIndex';

const log = createLogger('IndexQueue');

export interface IndexJob {
  fileId: number;
  relPath: string;
  absPath: string;
  language: string | null;
}

export interface IndexingStatus {
  indexed: number;
  queued: number;
  running: boolean;
  failed: number;
  total: number;
  activeWorkers: number;
  processed: number;
  runTotal: number;
}

export interface IndexQueueOptions {
  maxConcurrency?: number;
  maxFileSizeBytes?: number;
}

type ProgressCallback = (status: IndexingStatus) => void;

export class IndexQueue {
  private queue: IndexJob[] = [];
  private running = false;
  private cancelled = false;
  private failed = 0;
  private activeWorkers = 0;
  private processed = 0;
  private runTotal = 0;
  private maxConcurrency = 2;
  private maxFileSizeBytes = 512_000;
  private readonly chunker = new ChunkingService();
  private readonly fts: FtsIndex;
  private knownSymbols = new Set<string>();
  private onProgress?: ProgressCallback;
  private onComplete?: () => void;
  private vectorService: VectorIndexService | undefined;
  private workspace = '';

  constructor(
    private readonly db: ThunderDb,
    options?: IndexQueueOptions
  ) {
    this.fts = new FtsIndex(db);
    this.loadKnownSymbols();
    if (options?.maxConcurrency) {
      this.maxConcurrency = Math.max(1, options.maxConcurrency);
    }
    if (options?.maxFileSizeBytes) {
      this.maxFileSizeBytes = options.maxFileSizeBytes;
    }
  }

  onStatusChange(cb: ProgressCallback): void {
    this.onProgress = cb;
  }

  onIndexingComplete(cb: () => void): void {
    this.onComplete = cb;
  }

  setVectorService(workspace: string, service: VectorIndexService | undefined): void {
    this.workspace = workspace;
    this.vectorService = service;
  }

  enqueue(jobs: IndexJob[]): void {
    const existing = new Set(this.queue.map((j) => j.relPath));
    const wasIdle = !this.running && this.queue.length === 0;
    let enqueued = 0;
    for (const job of jobs) {
      if (!existing.has(job.relPath)) {
        this.queue.push(job);
        existing.add(job.relPath);
        enqueued += 1;
      }
    }
    if (wasIdle) {
      this.failed = 0;
      this.processed = 0;
      this.runTotal = enqueued;
    } else {
      this.runTotal += enqueued;
    }
    this.onProgress?.(this.getStatus());
    void this.process();
  }

  cancel(): void {
    this.cancelled = true;
    this.queue = [];
  }

  getStatus(): IndexingStatus {
    const indexed = (this.db.raw
      .prepare('SELECT COUNT(*) as c FROM files WHERE indexed_at IS NOT NULL')
      .get() as { c: number }).c;
    const total = (this.db.raw
      .prepare('SELECT COUNT(*) as c FROM files WHERE workspace = ?')
      .get(this.workspace || '') as { c: number }).c;
    return {
      indexed,
      queued: this.queue.length,
      running: this.running,
      failed: this.failed,
      total: this.workspace ? total : indexed,
      activeWorkers: this.activeWorkers,
      processed: this.processed,
      runTotal: this.runTotal,
    };
  }

  private async process(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.cancelled = false;

    const workerCount = Math.max(1, this.maxConcurrency);
    const workers = Array.from({ length: workerCount }, () => this.runWorker());
    await Promise.all(workers);

    this.running = false;
    this.onProgress?.(this.getStatus());
    this.onComplete?.();
  }

  private async runWorker(): Promise<void> {
    while (!this.cancelled) {
      const job = this.queue.shift();
      if (!job) break;

      this.activeWorkers += 1;
      try {
        if (job.language && hasWasmGrammar(job.language)) {
          await preloadWasmLanguage(job.language);
        }
        this.indexFile(job);
      } catch (e) {
        this.failed++;
        log.error('Index failed', { path: job.relPath, error: String(e) });
      } finally {
        this.processed += 1;
        this.activeWorkers -= 1;
        this.onProgress?.(this.getStatus());
      }
    }
  }

  private indexFile(job: IndexJob): void {
    let fileSize = 0;
    try {
      fileSize = statSync(job.absPath).size;
    } catch {
      return;
    }

    const content = readFileSync(job.absPath, 'utf-8');
    const signatureOnly = fileSize > this.maxFileSizeBytes;
    const indexContent = signatureOnly
      ? content.split('\n').slice(0, 80).join('\n')
      : content;
    const chunks = signatureOnly
      ? this.chunker.chunkFile(indexContent, job.language).slice(0, 3)
      : this.chunker.chunkFile(indexContent, job.language);

    this.db.transaction(() => {
      this.vectorService?.deleteFileChunks(job.fileId);
      this.db.raw.prepare('DELETE FROM chunks WHERE file_id = ?').run(job.fileId);
      this.db.raw.prepare('DELETE FROM symbols WHERE file_id = ?').run(job.fileId);
      this.db.raw.prepare('DELETE FROM symbol_refs WHERE file_id = ?').run(job.fileId);
      this.db.raw.prepare('DELETE FROM file_imports WHERE from_file_id = ?').run(job.fileId);
      this.fts.deleteByFile(job.relPath);

      const insertChunk = this.db.raw.prepare(`
        INSERT INTO chunks (file_id, chunk_index, start_line, end_line, content, token_estimate, hash)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      for (const chunk of chunks) {
        const result = insertChunk.run(
          job.fileId, chunk.chunkIndex, chunk.startLine, chunk.endLine,
          chunk.content, chunk.tokenEstimate, chunk.hash
        );
        this.fts.insertChunk(job.relPath, chunk.content);
        if (this.vectorService && this.workspace) {
          void this.vectorService.indexChunk(
            this.workspace,
            Number(result.lastInsertRowid),
            job.relPath,
            chunk.content
          );
        }
      }

      const extractor = getExtractor(job.language);
      if (extractor && job.language) {
        const symbols = extractor.extract(content);
        const insertSymbol = this.db.raw.prepare(`
          INSERT INTO symbols (file_id, name, kind, signature, start_line, end_line)
          VALUES (?, ?, ?, ?, ?, ?)
        `);
        for (const sym of symbols) {
          insertSymbol.run(job.fileId, sym.name, sym.kind, sym.signature, sym.startLine, sym.endLine);
          this.knownSymbols.add(sym.name);
        }

        const defLines = new Set(symbols.map((s) => s.startLine));
        const treeSitterRefs = extractSymbolRefsWithTreeSitter(content, job.language, this.knownSymbols, defLines);
        const refs = treeSitterRefs.length > 0
          ? treeSitterRefs
          : extractSymbolRefs(content, this.knownSymbols);
        const insertRef = this.db.raw.prepare(
          'INSERT INTO symbol_refs (file_id, symbol_name, line) VALUES (?, ?, ?)'
        );
        for (const ref of refs) {
          insertRef.run(job.fileId, ref.name, ref.line);
        }
      }

      if (!signatureOnly) {
        const imports = extractImports(content);
        const insertImport = this.db.raw.prepare(
          'INSERT INTO file_imports (from_file_id, to_rel_path, specifier, line) VALUES (?, ?, ?, ?)'
        );
        for (const imp of imports) {
          const target = resolveImportTarget(job.relPath, imp.specifier);
          if (target) {
            insertImport.run(job.fileId, target, imp.specifier, imp.line);
          }
        }
      }

      this.db.raw.prepare('UPDATE files SET indexed_at = ? WHERE id = ?').run(Date.now(), job.fileId);
    });
  }

  private loadKnownSymbols(): void {
    const rows = this.db.raw.prepare('SELECT DISTINCT name FROM symbols').all() as Array<{ name: string }>;
    this.knownSymbols = new Set(rows.map((r) => r.name));
  }
}
