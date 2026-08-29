import type { TextTokenizer, TokenizedEmbeddingBatch } from '../contracts.js';

interface TokenizerJson {
  added_tokens?: Array<{
    content?: string;
    id?: number;
    special?: boolean;
  }>;
  normalizer?: {
    lowercase?: boolean;
    strip_accents?: boolean | null;
  };
  model?: {
    vocab?: Record<string, number>;
    unk_token?: string;
    continuing_subword_prefix?: string;
    max_input_chars_per_word?: number;
  };
}

const CJK =
  /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/u;
const WHITESPACE = /\s+/u;
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu;

function isPunctuation(char: string): boolean {
  if (char.length === 0) return false;
  const code = char.charCodeAt(0);
  if (
    (code >= 33 && code <= 47) ||
    (code >= 58 && code <= 64) ||
    (code >= 91 && code <= 96) ||
    (code >= 123 && code <= 126)
  ) {
    return true;
  }
  return /\p{P}/u.test(char);
}

function stripAccents(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '');
}

function isolateChinese(value: string): string {
  return value.replace(CJK, (char) => ` ${char} `);
}

export class BertWordPieceTokenizer implements TextTokenizer {
  private readonly vocab: Map<string, number>;

  private readonly unkId: number;

  private readonly clsId: number;

  private readonly sepId: number;

  private readonly padId: number;

  private readonly prefix: string;

  private readonly maxChars: number;

  private readonly lowercase: boolean;

  private readonly strip: boolean;

  constructor(options: {
    vocab: Record<string, number>;
    unkToken?: string;
    clsToken?: string;
    sepToken?: string;
    padToken?: string;
    continuingSubwordPrefix?: string;
    maxInputCharsPerWord?: number;
    lowercase?: boolean;
    stripAccents?: boolean;
  }) {
    this.vocab = new Map(Object.entries(options.vocab));
    this.unkId = this.idOf(options.unkToken ?? '[UNK]');
    this.clsId = this.idOf(options.clsToken ?? '[CLS]');
    this.sepId = this.idOf(options.sepToken ?? '[SEP]');
    this.padId = this.vocab.get(options.padToken ?? '[PAD]') ?? 0;
    this.prefix = options.continuingSubwordPrefix ?? '##';
    this.maxChars = options.maxInputCharsPerWord ?? 100;
    this.lowercase = options.lowercase !== false;
    this.strip = options.stripAccents !== false;
  }

  static fromTokenizerJson(json: string): BertWordPieceTokenizer {
    const parsed = JSON.parse(json) as TokenizerJson;
    const vocab = { ...(parsed.model?.vocab ?? {}) };
    for (const token of parsed.added_tokens ?? []) {
      if (token.content && typeof token.id === 'number') {
        vocab[token.content] = token.id;
      }
    }
    if (Object.keys(vocab).length === 0) {
      throw new Error('tokenizer.json does not contain a WordPiece vocabulary.');
    }
    return new BertWordPieceTokenizer({
      vocab,
      unkToken: parsed.model?.unk_token ?? '[UNK]',
      continuingSubwordPrefix: parsed.model?.continuing_subword_prefix ?? '##',
      maxInputCharsPerWord: parsed.model?.max_input_chars_per_word ?? 100,
      lowercase: parsed.normalizer?.lowercase !== false,
      stripAccents: parsed.normalizer?.strip_accents !== false,
    });
  }

  encodeBatch(
    texts: readonly string[],
    options?: { maxLength?: number },
  ): TokenizedEmbeddingBatch {
    const maxLength = options?.maxLength ?? 256;
    const encoded = texts.map((text) => this.encode(text, maxLength));
    const sequenceLength = encoded.reduce(
      (max, item) => Math.max(max, item.inputIds.length),
      0,
    );
    const inputIds: number[][] = [];
    const attentionMask: number[][] = [];
    const tokenTypeIds: number[][] = [];
    for (const item of encoded) {
      const pad = sequenceLength - item.inputIds.length;
      inputIds.push([...item.inputIds, ...Array(pad).fill(this.padId)]);
      attentionMask.push([...item.attentionMask, ...Array(pad).fill(0)]);
      tokenTypeIds.push([...item.tokenTypeIds, ...Array(pad).fill(0)]);
    }
    return { inputIds, attentionMask, tokenTypeIds, sequenceLength };
  }

  encode(
    text: string,
    maxLength: number,
  ): {
    inputIds: number[];
    attentionMask: number[];
    tokenTypeIds: number[];
  } {
    const pieces = this.basicTokens(text).flatMap((token) =>
      this.wordPieces(token),
    );
    const truncated = pieces.slice(0, Math.max(maxLength - 2, 0));
    const inputIds = [this.clsId, ...truncated, this.sepId];
    return {
      inputIds,
      attentionMask: inputIds.map(() => 1),
      tokenTypeIds: inputIds.map(() => 0),
    };
  }

  private idOf(token: string): number {
    const id = this.vocab.get(token);
    if (id === undefined) {
      throw new Error(`Tokenizer vocabulary is missing required token ${token}.`);
    }
    return id;
  }

  private basicTokens(text: string): string[] {
    let cleaned = text.replace(CONTROL, ' ');
    cleaned = isolateChinese(cleaned);
    if (this.lowercase) {
      cleaned = cleaned.toLowerCase();
    }
    if (this.strip) {
      cleaned = stripAccents(cleaned);
    }
    const tokens: string[] = [];
    for (const part of cleaned.split(WHITESPACE).filter(Boolean)) {
      tokens.push(...this.splitPunctuation(part));
    }
    return tokens;
  }

  private splitPunctuation(token: string): string[] {
    const pieces: string[] = [];
    let current = '';
    for (const char of token) {
      if (isPunctuation(char)) {
        if (current) {
          pieces.push(current);
          current = '';
        }
        pieces.push(char);
      } else {
        current += char;
      }
    }
    if (current) {
      pieces.push(current);
    }
    return pieces;
  }

  private wordPieces(token: string): number[] {
    if (token.length > this.maxChars) {
      return [this.unkId];
    }
    const chars = Array.from(token);
    const ids: number[] = [];
    let start = 0;
    while (start < chars.length) {
      let end = chars.length;
      let found: string | undefined;
      while (start < end) {
        let candidate = chars.slice(start, end).join('');
        if (start > 0) {
          candidate = `${this.prefix}${candidate}`;
        }
        if (this.vocab.has(candidate)) {
          found = candidate;
          break;
        }
        end -= 1;
      }
      if (!found) {
        return [this.unkId];
      }
      ids.push(this.vocab.get(found) ?? this.unkId);
      start = end;
    }
    return ids;
  }
}
