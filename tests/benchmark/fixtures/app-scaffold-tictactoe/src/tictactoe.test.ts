import { describe, it, expect } from 'vitest';
import { checkWinner } from './tictactoe';

describe('checkWinner', () => {
  it('detects a row win', () => {
    const board = ['X', 'X', 'X', null, 'O', 'O', null, null, null];
    expect(checkWinner(board)).toBe('X');
  });

  it('detects a column win', () => {
    const board = ['O', 'X', null, 'O', 'X', null, 'O', null, 'X'];
    expect(checkWinner(board)).toBe('O');
  });

  it('detects a diagonal win', () => {
    const board = ['X', 'O', 'O', null, 'X', null, null, null, 'X'];
    expect(checkWinner(board)).toBe('X');
  });

  it('returns null for an ongoing game', () => {
    const board = ['X', 'O', null, null, null, null, null, null, null];
    expect(checkWinner(board)).toBeNull();
  });

  it('returns null for a full board with no winner (draw)', () => {
    const board = ['X', 'O', 'X', 'X', 'O', 'O', 'O', 'X', 'X'];
    expect(checkWinner(board)).toBeNull();
  });
});
