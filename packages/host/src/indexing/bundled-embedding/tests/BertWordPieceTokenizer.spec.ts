import { describe, expect, it } from 'vitest';

import { BertWordPieceTokenizer } from '../adapters/BertWordPieceTokenizer.js';

const tokenizer = new BertWordPieceTokenizer({
  vocab: {
    '[PAD]': 0,
    '[UNK]': 1,
    '[CLS]': 2,
    '[SEP]': 3,
    hello: 4,
    world: 5,
    he: 6,
    '##llo': 7,
    '!': 8,
  },
});

describe('BertWordPieceTokenizer', () => {
  it('wraps sentences with CLS/SEP and pads batches', () => {
    const batch = tokenizer.encodeBatch(['hello world', 'hello'], {
      maxLength: 8,
    });
    expect(batch.inputIds[0]).toEqual([2, 4, 5, 3]);
    expect(batch.inputIds[1]).toEqual([2, 4, 3, 0]);
    expect(batch.attentionMask[1]).toEqual([1, 1, 1, 0]);
    expect(batch.sequenceLength).toBe(4);
  });

  it('applies WordPiece continuation and unknown fallback', () => {
    expect(tokenizer.encode('hello', 8).inputIds).toEqual([2, 4, 3]);
    expect(tokenizer.encode('xyz', 8).inputIds).toEqual([2, 1, 3]);
    expect(tokenizer.encode('hello!', 8).inputIds).toEqual([2, 4, 8, 3]);
  });

  it('loads tokenizer.json vocab and special tokens', () => {
    const loaded = BertWordPieceTokenizer.fromTokenizerJson(
      JSON.stringify({
        normalizer: { lowercase: true, strip_accents: true },
        model: {
          unk_token: '[UNK]',
          continuing_subword_prefix: '##',
          vocab: {
            '[PAD]': 0,
            '[UNK]': 1,
            '[CLS]': 2,
            '[SEP]': 3,
            hi: 4,
          },
        },
      }),
    );
    expect(loaded.encode('HI', 8).inputIds).toEqual([2, 4, 3]);
  });
});
