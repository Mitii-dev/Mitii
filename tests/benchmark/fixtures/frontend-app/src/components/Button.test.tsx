import { describe, it, expect } from 'vitest';
import Button from './Button';

describe('Button baseline', () => {
  it('exports a function component', () => {
    expect(typeof Button).toBe('function');
  });
});
