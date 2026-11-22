import { useCallback, useEffect, useRef, useState } from 'react';
import { type IndexStatusSnapshot, type SemanticIndexSource } from '../protocol';

export function useIndexStatus() {
  const maximumIndexFilesDraftRef = useRef<number | undefined>(undefined);
  const embeddingSourceDraftRef = useRef<SemanticIndexSource | undefined>(undefined);

  const [index, setIndex] = useState<IndexStatusSnapshot>({
    fileCount: 0,
    truncated: false,
  });

  const indexRef = useRef<IndexStatusSnapshot>(index);

  const applyIndexStatus = useCallback((incoming: IndexStatusSnapshot) => {
    const next = {
      ...incoming,
      ...(maximumIndexFilesDraftRef.current !== undefined
        ? { maximumIndexFiles: maximumIndexFilesDraftRef.current }
        : {}),
      ...(embeddingSourceDraftRef.current
        ? {
            embeddingSource: embeddingSourceDraftRef.current,
            embeddingEnabled: embeddingSourceDraftRef.current !== 'disabled',
          }
        : {}),
    };
    indexRef.current = next;
    setIndex(next);
  }, []);

  useEffect(() => {
    indexRef.current = index;
  }, [index]);

  return {
    maximumIndexFilesDraftRef,
    embeddingSourceDraftRef,
    index,
    setIndex,
    indexRef,
    applyIndexStatus,
  };
}

export type IndexStatusApi = ReturnType<typeof useIndexStatus>;
