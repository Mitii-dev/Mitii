import type { VerificationManifestReaderPort } from "../contracts";

/**
 * In-memory manifest reader for contract/unit tests.
 */
export class InMemoryManifestReader implements VerificationManifestReaderPort {
  private readonly files: Map<string, string>;

  constructor(files: Record<string, string> = {}) {
    this.files = new Map(
      Object.entries(files).map(([path, content]) => [
        normalize(path),
        content,
      ]),
    );
  }

  public async exists(relativePath: string): Promise<boolean> {
    return this.files.has(normalize(relativePath));
  }

  public async readText(relativePath: string): Promise<string | null> {
    return this.files.get(normalize(relativePath)) ?? null;
  }
}

function normalize(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "");
}
