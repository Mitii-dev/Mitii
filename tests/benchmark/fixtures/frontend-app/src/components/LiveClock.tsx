import { useEffect, useState } from 'react';

export default function LiveClock() {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setSeconds((current) => current + 1);
    }, 1000);
    // BUG: missing cleanup — the interval is never cleared on unmount, so it
    // keeps firing and updating state after the component is gone.
  }, []);

  return <span data-testid="live-clock">{seconds}s</span>;
}
