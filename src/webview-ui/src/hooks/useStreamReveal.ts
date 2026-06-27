import { useEffect, useRef, useState } from 'react';

/**
 * Smoothly reveals streamed assistant text so large chunks feel typed rather than popping in.
 */
export function useStreamReveal(content: string, streaming: boolean): string {
  const [revealed, setRevealed] = useState(content);
  const targetRef = useRef(content);

  targetRef.current = content;

  useEffect(() => {
    if (!streaming) {
      setRevealed(content);
      return;
    }

    if (content.length <= revealed.length) {
      setRevealed(content);
      return;
    }

    const timer = window.setInterval(() => {
      setRevealed((prev) => {
        const target = targetRef.current;
        if (prev.length >= target.length) {
          return target;
        }
        const backlog = target.length - prev.length;
        const step = Math.max(1, Math.min(16, Math.ceil(backlog / 12)));
        return target.slice(0, prev.length + step);
      });
    }, 20);

    return () => window.clearInterval(timer);
  }, [content, streaming, revealed.length]);

  return streaming ? revealed : content;
}
