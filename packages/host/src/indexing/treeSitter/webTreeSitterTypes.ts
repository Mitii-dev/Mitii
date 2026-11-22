export type TreeSitterPoint = {
  row: number;
  column: number;
};

export type TreeSitterNode = {
  type: string;
  text: string;
  startIndex: number;
  endIndex: number;
  startPosition: TreeSitterPoint;
  endPosition: TreeSitterPoint;
  parent: TreeSitterNode | null;
  childCount?: number;
  child?: (index: number) => TreeSitterNode | null;
  isMissing?: boolean | (() => boolean);
  hasError?: boolean | (() => boolean);
  isError?: boolean | (() => boolean);
};

export type TreeSitterQueryCapture = {
  name: string;
  node: TreeSitterNode;
};

export type TreeSitterQueryMatch = {
  captures: TreeSitterQueryCapture[];
};

export type TreeSitterQuery = {
  matches(
    node: TreeSitterNode,
    options?: { matchLimit?: number },
  ): TreeSitterQueryMatch[];
  didExceedMatchLimit?: () => boolean;
  delete?: () => void;
};

export type TreeSitterLanguage = {
  query?: (source: string) => TreeSitterQuery;
};

export type TreeSitterTree = {
  rootNode: TreeSitterNode;
  delete?: () => void;
};

export type TreeSitterParser = {
  setLanguage(language: TreeSitterLanguage): void;
  parse(content: string): TreeSitterTree | null;
  delete?: () => void;
};

export type TreeSitterParserConstructor = {
  new (): TreeSitterParser;
  init(moduleOptions?: {
    locateFile?: (
      scriptName: string,
      scriptDirectory: string,
    ) => string;
  }): Promise<void>;
  Language?: {
    load(input: string | Uint8Array): Promise<TreeSitterLanguage>;
  };
};

export type TreeSitterQueryConstructor = {
  new (
    language: TreeSitterLanguage,
    source: string,
  ): TreeSitterQuery;
};

export type WebTreeSitterModule = {
  default?: TreeSitterParserConstructor;
  Parser?: TreeSitterParserConstructor;
  Language?: {
    load(input: string | Uint8Array): Promise<TreeSitterLanguage>;
  };
  Query?: TreeSitterQueryConstructor;
};
