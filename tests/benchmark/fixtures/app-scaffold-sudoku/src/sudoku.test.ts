import { describe, it, expect } from 'vitest';
import { isValidSudoku } from './sudoku';

const VALID_COMPLETE = [
  [5, 3, 4, 6, 7, 8, 9, 1, 2],
  [6, 7, 2, 1, 9, 5, 3, 4, 8],
  [1, 9, 8, 3, 4, 2, 5, 6, 7],
  [8, 5, 9, 7, 6, 1, 4, 2, 3],
  [4, 2, 6, 8, 5, 3, 7, 9, 1],
  [7, 1, 3, 9, 2, 4, 8, 5, 6],
  [9, 6, 1, 5, 3, 7, 2, 8, 4],
  [2, 8, 7, 4, 1, 9, 6, 3, 5],
  [3, 4, 5, 2, 8, 6, 1, 7, 9],
];

function emptyBoard(): (number | null)[][] {
  return Array.from({ length: 9 }, () => Array<number | null>(9).fill(null));
}

describe('isValidSudoku', () => {
  it('accepts a valid complete board', () => {
    expect(isValidSudoku(VALID_COMPLETE)).toBe(true);
  });

  it('accepts an empty board', () => {
    expect(isValidSudoku(emptyBoard())).toBe(true);
  });

  it('accepts a valid partial board', () => {
    const board = emptyBoard();
    board[0][0] = 5;
    board[0][1] = 3;
    board[4][4] = 7;
    expect(isValidSudoku(board)).toBe(true);
  });

  it('rejects a duplicate in a row', () => {
    const board = emptyBoard();
    board[0][0] = 5;
    board[0][3] = 5;
    expect(isValidSudoku(board)).toBe(false);
  });

  it('rejects a duplicate in a column', () => {
    const board = emptyBoard();
    board[0][0] = 5;
    board[5][0] = 5;
    expect(isValidSudoku(board)).toBe(false);
  });

  it('rejects a duplicate in a 3x3 box', () => {
    const board = emptyBoard();
    board[0][0] = 5;
    board[2][2] = 5;
    expect(isValidSudoku(board)).toBe(false);
  });
});
