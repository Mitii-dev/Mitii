import { useState } from 'react';

/** Simple counter with a seeded off-by-one bug in increment. */
export default function Counter({ initial = 0 }: { initial?: number }) {
  const [value, setValue] = useState(initial);
  return (
    <div>
      <span data-testid="count">{value}</span>
      <button type="button" onClick={() => setValue((current) => current + 2)}>
        Increment
      </button>
    </div>
  );
}
