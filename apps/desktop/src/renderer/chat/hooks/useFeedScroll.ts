/** Keep the chat feed scrolled to the latest message. */

import { useCallback, useEffect } from 'react';
import type { useChatThreadState } from './useChatThreadState.js';

export function useFeedScroll(deps: Pick<
    ReturnType<typeof useChatThreadState>,
    'feedEndRef' | 'messages' | 'suspension'
  >) {
  const {
    feedEndRef,
    messages,
    suspension,
  } = deps;

  const scrollToBottom = useCallback((smooth = false) => {
    const end = feedEndRef.current;
    if (!end) return;
    end.scrollIntoView({
      behavior: smooth ? 'smooth' : 'auto',
      block: 'end',
    });
  }, []);

  useEffect(() => {
    scrollToBottom(false);
  }, [messages, suspension, scrollToBottom]);

  return {
    scrollToBottom,
  };
}
