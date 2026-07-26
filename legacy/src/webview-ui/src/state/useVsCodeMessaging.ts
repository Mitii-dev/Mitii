import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type {
  ContextPathSuggestion,
  ExtensionToWebviewMessage,
  SkillAnalyzerResultView,
  SkillCatalogItem,
  SkillDocumentView,
  SkillDraftAnalysis,
  SkillTestRunResult,
  SkillUsageMetric,
  WebviewToExtensionMessage,
} from '../../../vscode/webview/messages';
import { initialState, webviewReducer } from './store';

declare function acquireVsCodeApi(): {
  postMessage(message: WebviewToExtensionMessage): void;
  getState(): unknown;
  setState(state: unknown): void;
};

const vscode = typeof acquireVsCodeApi !== 'undefined' ? acquireVsCodeApi() : undefined;

export function useVsCodeMessaging() {
  const [state, dispatch] = useReducer(webviewReducer, initialState);
  const [pathSuggestions, setPathSuggestions] = useState<ContextPathSuggestion[]>([]);
  const [pathSearchRequestId, setPathSearchRequestId] = useState<string | null>(null);
  const [skillCatalog, setSkillCatalog] = useState<{ items: SkillCatalogItem[]; total: number; error?: string }>({ items: [], total: 0 });
  const [skillDocument, setSkillDocument] = useState<SkillDocumentView | undefined>();
  const [skillDraftAnalysis, setSkillDraftAnalysis] = useState<SkillDraftAnalysis | undefined>();
  const [skillAnalyzerResult, setSkillAnalyzerResult] = useState<SkillAnalyzerResultView | undefined>();
  const [skillTestResult, setSkillTestResult] = useState<SkillTestRunResult | undefined>();
  const [skillAnalytics, setSkillAnalytics] = useState<SkillUsageMetric[]>([]);
  const [skillOperationError, setSkillOperationError] = useState<string | undefined>();
  const pathSearchRequestIdRef = useRef<string | null>(null);

  useEffect(() => {
    pathSearchRequestIdRef.current = pathSearchRequestId;
  }, [pathSearchRequestId]);

  useEffect(() => {
    const handler = (event: MessageEvent<ExtensionToWebviewMessage>) => {
      const message = event.data;
      switch (message.type) {
        case 'state':
          dispatch({ type: 'SET_STATE', payload: message.payload });
          break;
        case 'appendMessage':
          dispatch({ type: 'APPEND_MESSAGE', payload: message.payload });
          break;
        case 'updateLastAssistant':
          dispatch({ type: 'UPDATE_LAST_ASSISTANT', payload: message.payload });
          break;
        case 'setError':
          dispatch({ type: 'SET_ERROR', payload: message.payload });
          break;
        case 'setLoading':
          dispatch({ type: 'SET_LOADING', payload: message.payload });
          break;
        case 'setMode':
          dispatch({ type: 'SET_MODE', payload: message.payload });
          break;
        case 'setTab':
          dispatch({ type: 'SET_TAB', payload: message.payload });
          break;
        case 'setIndexing':
          dispatch({ type: 'SET_INDEXING', payload: message.payload });
          break;
        case 'setApprovals':
          dispatch({ type: 'SET_APPROVALS', payload: message.payload });
          break;
        case 'setContextPreview':
          dispatch({ type: 'SET_CONTEXT_PREVIEW', payload: message.payload });
          break;
        case 'setPlan':
          dispatch({ type: 'SET_PLAN', payload: message.payload });
          break;
        case 'setAgentActivity':
          dispatch({ type: 'SET_AGENT_ACTIVITY', payload: message.payload });
          break;
        case 'setAgentLiveStatus':
          dispatch({ type: 'SET_AGENT_LIVE_STATUS', payload: message.payload });
          break;
        case 'setSubagents':
          dispatch({ type: 'SET_SUBAGENTS', payload: message.payload });
          break;
        case 'setTokenUsage':
          dispatch({ type: 'SET_TOKEN_USAGE', payload: message.payload });
          break;
        case 'setReviewDiff':
          dispatch({ type: 'SET_REVIEW_DIFF', payload: message.payload });
          break;
        case 'setContextPaths':
          if (message.payload.requestId === pathSearchRequestIdRef.current) {
            setPathSuggestions(message.payload.paths);
          }
          break;
        case 'skillCatalogResult':
          setSkillCatalog({ items: message.payload.items, total: message.payload.total, error: message.payload.error });
          setSkillOperationError(message.payload.error);
          break;
        case 'skillDocumentResult':
          setSkillDocument(message.payload.document);
          setSkillOperationError(message.payload.error);
          break;
        case 'skillMutationResult':
          if (message.payload.document) setSkillDocument(message.payload.document);
          if (message.payload.deletedId) setSkillDocument(undefined);
          setSkillOperationError(message.payload.error);
          break;
        case 'skillDraftAnalysisResult':
          setSkillDraftAnalysis(message.payload.analysis);
          setSkillOperationError(message.payload.error);
          break;
        case 'skillAnalyzerResult':
          setSkillAnalyzerResult(message.payload.result);
          setSkillOperationError(message.payload.error);
          break;
        case 'skillTestResult':
          setSkillTestResult(message.payload.result);
          setSkillOperationError(message.payload.error);
          break;
        case 'skillAnalyticsResult':
          setSkillAnalytics(message.payload.metrics);
          setSkillOperationError(message.payload.error);
          break;
      }
    };

    window.addEventListener('message', handler);
    postMessage({ type: 'ready' });
    return () => window.removeEventListener('message', handler);
  }, []);

  const postMessage = useCallback((message: WebviewToExtensionMessage) => {
    if (message.type === 'searchContextPaths') {
      setPathSearchRequestId(message.payload.requestId);
    }
    vscode?.postMessage(message);
  }, []);

  return {
    state,
    dispatch,
    postMessage,
    pathSuggestions,
    pathSearchRequestId,
    skillCatalog,
    skillDocument,
    skillDraftAnalysis,
    skillAnalyzerResult,
    skillTestResult,
    skillAnalytics,
    skillOperationError,
  };
}
