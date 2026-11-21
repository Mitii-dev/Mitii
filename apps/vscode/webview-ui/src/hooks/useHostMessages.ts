import { useEffect, useRef } from 'react';
import { type AppApi } from '../app/appApi';
import { onHostMessage, postToHost } from '../bridge';
import { handleComposerMessage } from '../hostMessages/composerMessages';
import { handleReviewMessage } from '../hostMessages/reviewMessages';
import { handleRunMessage } from '../hostMessages/runMessages';
import { handleSettingsMessage } from '../hostMessages/settingsMessages';
import { handleWorkspaceMessage } from '../hostMessages/workspaceMessages';

const HANDLERS = [
  handleSettingsMessage,
  handleRunMessage,
  handleWorkspaceMessage,
  handleReviewMessage,
  handleComposerMessage,
];

/**
 * Subscribes once to host messages and routes each to its domain handler,
 * always reading the latest hook API through a ref (no stale closures).
 */
export function useHostMessages(api: AppApi): void {
  const apiRef = useRef(api);
  apiRef.current = api;
  const readySentRef = useRef(false);

  useEffect(() => {
    const off = onHostMessage((msg) => {
      for (const handle of HANDLERS) {
        if (handle(msg, apiRef.current)) return;
      }
    });
    if (!readySentRef.current) {
      readySentRef.current = true;
      postToHost({ type: 'ready' });
    }
    return off;
  }, []);
}
