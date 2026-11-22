declare module "tree-sitter" {
  const Parser: new () => {
    setLanguage: (language: unknown) => void;
    parse: (content: string) => { rootNode: unknown };
  };
  export default Parser;
  export { Parser };
  export class Query {
    constructor(language: unknown, source: string);
    captures(node: unknown): Array<{ name: string; node: unknown }>;
  }
}
