import { useState } from 'react';
import { type ChatThreadSummary, type CheckpointItemView, type MemoryItemView } from '../protocol';

export function useThreads() {
  const [history, setHistory] = useState<ChatThreadSummary[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | undefined>();
  const [memories, setMemories] = useState<MemoryItemView[]>([]);
  const [checkpoints, setCheckpoints] = useState<CheckpointItemView[]>([]);

  return {
    history,
    setHistory,
    activeThreadId,
    setActiveThreadId,
    memories,
    setMemories,
    checkpoints,
    setCheckpoints,
  };
}

export type ThreadsApi = ReturnType<typeof useThreads>;
