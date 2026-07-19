import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import type { OAuthClientInformation, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';

export class StaticTokenOAuthProvider implements OAuthClientProvider {
  constructor(
    private readonly tokensValue: OAuthTokens,
    private readonly clientInfo: OAuthClientInformation = { client_id: 'mitii-mcp-client' }
  ) {}

  get redirectUrl(): string {
    return 'http://127.0.0.1:33445/callback';
  }

  get clientMetadata() {
    return { client_name: 'Mitii AI Agent', redirect_uris: [this.redirectUrl] };
  }

  async clientInformation(): Promise<OAuthClientInformation | undefined> {
    return this.clientInfo;
  }

  async tokens(): Promise<OAuthTokens | undefined> {
    return this.tokensValue;
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    Object.assign(this.tokensValue, tokens);
  }

  async saveClientInformation(info: OAuthClientInformation): Promise<void> {
    Object.assign(this.clientInfo, info);
  }

  async redirectToAuthorization(_url: URL): Promise<void> {
    throw new Error('Interactive OAuth not configured — set oauth.accessToken or headers.Authorization');
  }

  async saveCodeVerifier(_verifier: string): Promise<void> {
    // No-op for static token flow
  }

  async codeVerifier(): Promise<string> {
    return '';
  }
}

export function resolveMcpAuthProvider(
  headers: Record<string, string>,
  oauth?: { accessToken?: string; clientId?: string; clientSecret?: string }
): StaticTokenOAuthProvider | undefined {
  const bearer = headers.Authorization?.replace(/^Bearer\s+/i, '') ?? oauth?.accessToken?.trim();
  if (!bearer) return undefined;

  return new StaticTokenOAuthProvider({
    access_token: bearer,
    token_type: 'Bearer',
  }, {
    client_id: oauth?.clientId?.trim() || 'mitii-mcp-client',
    client_secret: oauth?.clientSecret?.trim(),
  });
}
