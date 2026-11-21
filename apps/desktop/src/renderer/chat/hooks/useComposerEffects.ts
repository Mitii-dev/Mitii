/** Composer textarea auto-size and pin-menu dismissal. */

import { useEffect } from 'react';
import type { useComposerState } from './useComposerState.js';

export function useComposerEffects(deps: Pick<
    ReturnType<typeof useComposerState>,
    'textareaRef' | 'input' | 'pinMenu' | 'pinMenuRef' | 'setPinMenu' | 'setMention'
    | 'setPathHits' | 'setSuggestIndex' | 'setSuggestLoading'
  >) {
  const {
    textareaRef,
    input,
    pinMenu,
    pinMenuRef,
    setPinMenu,
    setMention,
    setPathHits,
    setSuggestIndex,
    setSuggestLoading,
  } = deps;

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${Math.min(160, Math.max(24, el.scrollHeight))}px`;
  }, [input]);

  useEffect(() => {
    if (!pinMenu) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!pinMenuRef.current?.contains(event.target as Node)) {
        setPinMenu(false);
        setMention(null);
        setPathHits([]);
        setSuggestIndex(0);
        setSuggestLoading(false);
      }
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, [pinMenu]);
}
