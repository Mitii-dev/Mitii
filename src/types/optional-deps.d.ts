declare module '@xenova/transformers' {
  export const pipeline: (
    task: string,
    model: string
  ) => Promise<
  (
    texts: string[],
    options: { pooling: string; normalize: boolean }
  ) => Promise<{ tolist(): number[][] }>
  >;

  export const env: {
    allowLocalModels: boolean;
    allowRemoteModels: boolean;
  };
}

declare module 'lancedb' {
  export function connect(uri: string): Promise<{
    openTable(name: string): Promise<LanceTable>;
    createTable(name: string, rows: unknown[]): Promise<LanceTable>;
  }>;

  interface LanceTable {
    add(rows: unknown[]): Promise<void>;
    delete(predicate: string): Promise<void>;
    search(vector: number[]): { limit(n: number): { toArray(): Promise<unknown[]> } };
    countRows(): Promise<number>;
  }
}
