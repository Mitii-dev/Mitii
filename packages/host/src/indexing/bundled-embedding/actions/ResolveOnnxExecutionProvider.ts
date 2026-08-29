import { BUNDLED_EMBEDDING_SCHEMA_VERSION, ONNX_NATIVE_TARGETS, ONNX_RUNTIME_REASON_CODES } from '../constants.js';
import {
  OnnxExecutionProviderResolutionSchema,
  type OnnxExecutionProviderResolution,
  type OnnxNativeTarget,
} from '../contracts.js';

export function resolveOnnxNativeTarget(
  platform: string = process.platform,
  arch: string = process.arch,
): OnnxNativeTarget | undefined {
  return ONNX_NATIVE_TARGETS.find(
    (target) => target.platform === platform && target.arch === arch,
  );
}

export function describeOnnxExecutionProvider(options: {
  kind: 'native' | 'wasm';
  packageId: string;
  platform?: string;
  arch?: string;
}): Extract<OnnxExecutionProviderResolution, { status: 'ready' }> {
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  return OnnxExecutionProviderResolutionSchema.parse({
    schemaVersion: BUNDLED_EMBEDDING_SCHEMA_VERSION,
    status: 'ready',
    kind: options.kind,
    packageId: options.packageId,
    platform,
    arch,
    reasonCode:
      options.kind === 'native'
        ? ONNX_RUNTIME_REASON_CODES.native
        : ONNX_RUNTIME_REASON_CODES.wasm,
  }) as Extract<OnnxExecutionProviderResolution, { status: 'ready' }>;
}

export function unsupportedOnnxPlatform(
  platform: string = process.platform,
  arch: string = process.arch,
): Extract<OnnxExecutionProviderResolution, { status: 'unavailable' }> {
  return OnnxExecutionProviderResolutionSchema.parse({
    schemaVersion: BUNDLED_EMBEDDING_SCHEMA_VERSION,
    status: 'unavailable',
    reasonCode: ONNX_RUNTIME_REASON_CODES.unsupported_platform,
    message: `No ONNX Runtime native target is registered for ${platform}-${arch}. WASM fallback may still load.`,
  }) as Extract<OnnxExecutionProviderResolution, { status: 'unavailable' }>;
}
