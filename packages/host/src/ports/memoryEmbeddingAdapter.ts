import type { EmbeddingProvider, MemoryEmbeddingPort } from '@mitii/v8';

/**
 * Adapt the workspace EmbeddingProvider (MiniLM / OpenAI-compatible)
 * into Memory's single-text embed port. Model runtimes stay in the host.
 */
export function createMemoryEmbeddingPort(
  provider: EmbeddingProvider,
): MemoryEmbeddingPort {
  return {
    dimensions: provider.profile.dimensions,
    async embed(text: string): Promise<Float32Array> {
      const [vector] = await provider.embed([text]);
      if (!vector) {
        return new Float32Array(provider.profile.dimensions);
      }
      return Float32Array.from(vector);
    },
  };
}
