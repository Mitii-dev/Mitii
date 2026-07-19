type TiktokenEncoding = {
  encode(text: string): Uint32Array | number[];
  free(): void;
};

let encoding: TiktokenEncoding | null | undefined;
let encodingFailed = false;

function shouldUseTiktoken(): boolean {
  if (process.env.VITEST === 'true' || process.env.THUNDER_DISABLE_TIKTOKEN === '1') {
    return false;
  }
  return true;
}

function getEncoding(): TiktokenEncoding | null {
  if (!shouldUseTiktoken() || encodingFailed) return null;
  if (encoding !== undefined) return encoding;

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { get_encoding } = require('tiktoken') as {
      get_encoding: (name: string) => TiktokenEncoding;
    };
    encoding = get_encoding('cl100k_base');
  } catch {
    encoding = null;
    encodingFailed = true;
  }
  return encoding;
}

/** Accurate token count via tiktoken (cl100k_base), with chars/4 fallback. */
export function estimateTokens(text: string): number {
  const enc = getEncoding();
  if (enc) {
    return enc.encode(text).length;
  }
  return Math.ceil(text.length / 4);
}

export async function estimateTokensAsync(text: string): Promise<number> {
  return estimateTokens(text);
}
