/** Profile row shape used by the desktop shell. */



export interface ProfileRow {
  id: string;
  name: string;
  provider: {
    type?: string;
    model: string;
    preset?: string;
    baseUrl?: string;
    contextWindow?: number;
    maximumOutputTokens?: number;
  };
  hasSecret?: boolean;
}
