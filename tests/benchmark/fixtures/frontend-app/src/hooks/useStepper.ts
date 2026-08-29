import { useState } from 'react';

/** Seeded bug: decrement subtracts 2 instead of 1. */
export function useStepper(initial = 0) {
  const [value, setValue] = useState(initial);
  return {
    value,
    increment: () => setValue((current) => current + 1),
    decrement: () => setValue((current) => current - 2),
  };
}
