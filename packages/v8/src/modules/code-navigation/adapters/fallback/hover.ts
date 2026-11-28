import type {
  CodeNavigationCallOptions,
  CodeNavigationHover,
  CodeNavigationPort,
  CodeNavigationQuery,
} from "../../contracts";
import type { FallbackProviderSink } from "./first-non-empty";

/** Port method: `hover` (primary → fallback). */
export async function fallbackHover(params: {
  primary: CodeNavigationPort;
  fallback: CodeNavigationPort;
  sink: FallbackProviderSink;
  input: CodeNavigationQuery;
  options?: CodeNavigationCallOptions;
}): Promise<CodeNavigationHover | undefined> {
  try {
    const hover = await params.primary.hover?.(params.input, params.options);
    if (hover) {
      params.sink.provider = params.primary.provider;
      return hover;
    }
  } catch {
    // Fall through to graph hover.
  }
  params.sink.provider = params.fallback.provider;
  return params.fallback.hover?.(params.input, params.options);
}
