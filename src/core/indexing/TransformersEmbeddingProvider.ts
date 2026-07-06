import { createLogger } from '../telemetry/Logger';
import type { EmbeddingProvider } from './EmbeddingProvider';
import { summarizeHealthDetail, type ComponentHealth } from './ComponentHealth';

const log = createLogger('TransformersEmbedding');

type FeatureExtractor = (
  texts: string[],
  options: { pooling: string; normalize: boolean }
) => Promise<{ tolist(): number[][] }>;

let pipelinePromise: Promise<FeatureExtractor | null> | null = null;
let health: ComponentHealth = { status: 'unknown' };

async function loadPipeline(): Promise<FeatureExtractor | null> {
  if (pipelinePromise) return pipelinePromise;

  pipelinePromise = (async () => {
    try {
      // Optional dependency — dynamic import keeps extension load fast when not installed.
      const { pipeline, env } = await import('@xenova/transformers');
      env.allowLocalModels = true;
      env.allowRemoteModels = true;
      const extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
      health = { status: 'ready' };
      return extractor as FeatureExtractor;
    } catch (error) {
      const fullDetail = error instanceof Error ? error.message : String(error);
      health = { status: 'degraded', detail: summarizeHealthDetail(error) };
      log.warn('MiniLM embeddings unavailable, falling back to empty vectors for this session', { error: fullDetail });
      return null;
    }
  })();

  return pipelinePromise;
}

/** Local MiniLM embeddings via @xenova/transformers (Continue pattern). */
export class TransformersEmbeddingProvider implements EmbeddingProvider {
  readonly id = 'minilm';

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const extractor = await loadPipeline();
    if (!extractor) {
      log.debug('embed:skipped, pipeline unavailable', { textCount: texts.length, detail: health.detail });
      return texts.map(() => []);
    }

    const outputs: number[][] = [];
    for (let i = 0; i < texts.length; i++) {
      const text = texts[i].slice(0, 2000);
      try {
        const output = await extractor([text], { pooling: 'mean', normalize: true });
        const vectors = output.tolist();
        outputs.push(vectors[0] ?? []);
        // Yield to event loop so the extension host stays responsive.
        await new Promise((resolve) => setTimeout(resolve, 5));
      } catch (error) {
        const fullDetail = error instanceof Error ? error.message : String(error);
        health = { status: 'degraded', detail: summarizeHealthDetail(error) };
        log.warn('MiniLM embed failed', { error: fullDetail });
        outputs.push([]);
      }
    }
    return outputs;
  }

  getHealth(): ComponentHealth {
    return health;
  }
}

export function isTransformersEmbeddingAvailable(): boolean {
  try {
    require.resolve('@xenova/transformers');
    return true;
  } catch {
    return false;
  }
}
