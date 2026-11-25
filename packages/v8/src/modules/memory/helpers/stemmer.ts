/**
 * Porter-style stemmer for English retrieve terms.
 * Adapted for coding tokens (keeps short identifiers intact).
 */
const STEP2: ReadonlyArray<readonly [string, string]> = [
  ["ational", "ate"],
  ["tional", "tion"],
  ["enci", "ence"],
  ["anci", "ance"],
  ["izer", "ize"],
  ["iser", "ise"],
  ["abli", "able"],
  ["alli", "al"],
  ["entli", "ent"],
  ["eli", "e"],
  ["ousli", "ous"],
  ["ization", "ize"],
  ["isation", "ise"],
  ["ation", "ate"],
  ["ator", "ate"],
  ["alism", "al"],
  ["iveness", "ive"],
  ["fulness", "ful"],
  ["ousness", "ous"],
  ["aliti", "al"],
  ["iviti", "ive"],
  ["biliti", "ble"],
];

const STEP3: ReadonlyArray<readonly [string, string]> = [
  ["icate", "ic"],
  ["ative", ""],
  ["alize", "al"],
  ["alise", "al"],
  ["iciti", "ic"],
  ["ical", "ic"],
  ["ful", ""],
  ["ness", ""],
];

const STEP4 =
  /(ement|ment|tion|sion|ance|ence|able|ible|ism|ate|iti|ous|ive|ize|ise|ant|ent|al|er|ic|ou)$/;

function hasVowel(value: string): boolean {
  return /[aeiou]/.test(value);
}

function measure(value: string): number {
  const reduced = value
    .replace(/[^aeiouy]+/g, "C")
    .replace(/[aeiouy]+/g, "V");
  return reduced.match(/VC/g)?.length ?? 0;
}

function endsDoubleConsonant(value: string): boolean {
  return (
    value.length >= 2 &&
    value[value.length - 1] === value[value.length - 2] &&
    !/[aeiou]/.test(value[value.length - 1] ?? "")
  );
}

function endsCvc(value: string): boolean {
  if (value.length < 3) {
    return false;
  }
  const c1 = value[value.length - 3] ?? "";
  const vowel = value[value.length - 2] ?? "";
  const c2 = value[value.length - 1] ?? "";
  return !/[aeiou]/.test(c1) && /[aeiou]/.test(vowel) && !/[aeiouwxy]/.test(c2);
}

function applyEdIng(stemmed: string): string {
  if (stemmed.endsWith("at") || stemmed.endsWith("bl") || stemmed.endsWith("iz")) {
    return `${stemmed}e`;
  }
  if (endsDoubleConsonant(stemmed) && !/[lsz]$/.test(stemmed)) {
    return stemmed.slice(0, -1);
  }
  if (measure(stemmed) === 1 && endsCvc(stemmed)) {
    return `${stemmed}e`;
  }
  return stemmed;
}

export function stem(word: string): string {
  if (word.length <= 2) {
    return word;
  }

  let current = word;

  if (current.endsWith("sses")) {
    current = current.slice(0, -2);
  } else if (current.endsWith("ies")) {
    current = current.slice(0, -2);
  } else if (!current.endsWith("ss") && current.endsWith("s")) {
    current = current.slice(0, -1);
  }

  if (current.endsWith("eed")) {
    if (measure(current.slice(0, -3)) > 0) {
      current = current.slice(0, -1);
    }
  } else if (current.endsWith("ed") && hasVowel(current.slice(0, -2))) {
    current = applyEdIng(current.slice(0, -2));
  } else if (current.endsWith("ing") && hasVowel(current.slice(0, -3))) {
    current = applyEdIng(current.slice(0, -3));
  }

  if (current.endsWith("y") && hasVowel(current.slice(0, -1))) {
    current = `${current.slice(0, -1)}i`;
  }

  for (const [suffix, replacement] of STEP2) {
    if (current.endsWith(suffix)) {
      const base = current.slice(0, -suffix.length);
      if (measure(base) > 0) {
        current = `${base}${replacement}`;
      }
      break;
    }
  }

  for (const [suffix, replacement] of STEP3) {
    if (current.endsWith(suffix)) {
      const base = current.slice(0, -suffix.length);
      if (measure(base) > 0) {
        current = `${base}${replacement}`;
      }
      break;
    }
  }

  const step4 = current.match(STEP4)?.[0];
  if (step4) {
    const base = current.slice(0, -step4.length);
    if (measure(base) > 1) {
      current = base;
    }
  }

  if (current.endsWith("e")) {
    const base = current.slice(0, -1);
    if (measure(base) > 1 || (measure(base) === 1 && !endsCvc(base))) {
      current = base;
    }
  }

  if (
    endsDoubleConsonant(current) &&
    current.endsWith("l") &&
    measure(current.slice(0, -1)) > 1
  ) {
    current = current.slice(0, -1);
  }

  return current;
}
