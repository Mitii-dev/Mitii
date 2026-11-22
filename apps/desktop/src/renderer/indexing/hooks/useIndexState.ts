/** Repository index status state. */

import { useState, useRef } from 'react';
import { type DesktopIndexSnapshot } from '../IndexStatusChip.js';

export function useIndexState() {
  const [indexStatus, setIndexStatus] = useState<{
    indexed: boolean;
    fileCount: number;
    truncated: boolean;
    lastIndexedAt?: string;
    message: string;
    embeddingError?: string;
    running?: boolean;
    lexicalReady?: boolean;
    embeddingPhase?: string;
    health?: DesktopIndexSnapshot['health'];
  } | null>(null);

  const [indexIndexing, setIndexIndexing] = useState(false);

  const [indexEmbeddingBg, setIndexEmbeddingBg] = useState(false);

  const [indexProgress, setIndexProgress] = useState<number | null>(null);

  const [indexStream, setIndexStream] = useState<string[]>([]);

  const reindexInFlightRef = useRef(false);

  const indexSaveTimerRef = useRef<number | null>(null);

  return {
    setIndexStatus,
    setIndexIndexing,
    setIndexProgress,
    setIndexStream,
    setIndexEmbeddingBg,
    reindexInFlightRef,
    indexSaveTimerRef,
    indexIndexing,
    indexStatus,
    indexEmbeddingBg,
    indexProgress,
    indexStream,
  };
}
