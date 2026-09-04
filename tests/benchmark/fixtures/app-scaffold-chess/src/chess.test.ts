import { describe, it, expect } from 'vitest';
import { getLegalMoves, type Board } from './chess';

function emptyBoard(): Board {
  return Array.from({ length: 8 }, () => Array(8).fill(null));
}

describe('getLegalMoves', () => {
  it('rook slides until blocked, captures the first enemy, cannot pass its own piece', () => {
    const board = emptyBoard();
    const rook = { type: 'rook' as const, color: 'white' as const };
    board[4][4] = rook;
    board[4][6] = { type: 'pawn', color: 'black' };
    board[4][2] = { type: 'pawn', color: 'white' };
    const moves = getLegalMoves(board, { row: 4, col: 4 }, rook);

    expect(moves).toContainEqual({ row: 4, col: 5 });
    expect(moves).toContainEqual({ row: 4, col: 6 }); // captures the enemy pawn
    expect(moves).not.toContainEqual({ row: 4, col: 7 }); // can't slide past a capture
    expect(moves).toContainEqual({ row: 4, col: 3 });
    expect(moves).not.toContainEqual({ row: 4, col: 2 }); // own piece blocks, no self-capture
    expect(moves).not.toContainEqual({ row: 4, col: 1 });
    expect(moves).toContainEqual({ row: 0, col: 4 });
    expect(moves).toContainEqual({ row: 7, col: 4 });
    expect(moves).not.toContainEqual({ row: 5, col: 5 }); // rooks don't move diagonally
  });

  it('bishop slides diagonally until blocked', () => {
    const board = emptyBoard();
    const bishop = { type: 'bishop' as const, color: 'white' as const };
    board[4][4] = bishop;
    board[6][6] = { type: 'knight', color: 'black' };
    const moves = getLegalMoves(board, { row: 4, col: 4 }, bishop);

    expect(moves).toContainEqual({ row: 5, col: 5 });
    expect(moves).toContainEqual({ row: 6, col: 6 }); // captures the enemy knight
    expect(moves).not.toContainEqual({ row: 7, col: 7 }); // can't slide past a capture
    expect(moves).toContainEqual({ row: 1, col: 1 });
    expect(moves).not.toContainEqual({ row: 4, col: 5 }); // bishops don't move orthogonally
  });

  it('knight jumps in an L-shape, ignoring pieces in between', () => {
    const board = emptyBoard();
    const knight = { type: 'knight' as const, color: 'white' as const };
    board[4][4] = knight;
    board[4][5] = { type: 'pawn', color: 'white' }; // adjacent piece, irrelevant to a knight
    board[6][5] = { type: 'pawn', color: 'white' }; // occupies one L-destination with an own piece
    const moves = getLegalMoves(board, { row: 4, col: 4 }, knight);

    expect(moves).toContainEqual({ row: 2, col: 3 });
    expect(moves).toContainEqual({ row: 2, col: 5 });
    expect(moves).not.toContainEqual({ row: 6, col: 5 }); // own piece there, can't land on it
    expect(moves).not.toContainEqual({ row: 4, col: 5 }); // not a legal knight destination at all
  });

  it('king moves one square in any direction, not onto its own piece', () => {
    const board = emptyBoard();
    const king = { type: 'king' as const, color: 'white' as const };
    board[4][4] = king;
    board[4][5] = { type: 'pawn', color: 'white' };
    board[5][5] = { type: 'pawn', color: 'black' };
    const moves = getLegalMoves(board, { row: 4, col: 4 }, king);

    expect(moves).toContainEqual({ row: 3, col: 4 });
    expect(moves).toContainEqual({ row: 5, col: 5 }); // capture
    expect(moves).not.toContainEqual({ row: 4, col: 5 }); // own piece
    expect(moves).not.toContainEqual({ row: 6, col: 4 }); // more than one square away
  });

  it('pawn moves forward one or two squares from its start row, and captures only diagonally', () => {
    const board = emptyBoard();
    const pawn = { type: 'pawn' as const, color: 'white' as const };
    board[6][4] = pawn;
    board[5][3] = { type: 'pawn', color: 'black' };
    const moves = getLegalMoves(board, { row: 6, col: 4 }, pawn);

    expect(moves).toContainEqual({ row: 5, col: 4 });
    expect(moves).toContainEqual({ row: 4, col: 4 });
    expect(moves).toContainEqual({ row: 5, col: 3 }); // diagonal capture
    expect(moves).not.toContainEqual({ row: 5, col: 5 }); // nothing to capture there
  });

  it('pawn cannot move two squares forward once off its start row, and cannot capture straight ahead', () => {
    const board = emptyBoard();
    const pawn = { type: 'pawn' as const, color: 'white' as const };
    board[4][4] = pawn;
    board[3][4] = { type: 'pawn', color: 'black' };
    const moves = getLegalMoves(board, { row: 4, col: 4 }, pawn);

    expect(moves).not.toContainEqual({ row: 2, col: 4 });
    expect(moves).not.toContainEqual({ row: 3, col: 4 }); // blocked straight ahead, can't capture forward
  });
});
