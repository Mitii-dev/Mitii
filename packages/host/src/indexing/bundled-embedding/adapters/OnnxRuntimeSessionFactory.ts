import { existsSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import { resolveRuntimeFilename } from '../../../internal/resolveRuntimeFilename.js';
import {
  describeOnnxExecutionProvider,
} from '../actions/ResolveOnnxExecutionProvider.js';
import {
  ONNX_RUNTIME_NODE_PACKAGE,
  ONNX_RUNTIME_WEB_PACKAGE,
} from '../constants.js';
import type {
  CreatedOnnxSession,
  CreateOnnxSessionInput,
  OnnxInferenceSession,
  OnnxRuntimeSessionFactory,
  OnnxTensorLike,
} from '../contracts.js';

type OrtTensorConstructor = new (
  type: string,
  data: BigInt64Array | Float32Array,
  dims: number[],
) => unknown;

interface OrtModule {
  Tensor?: OrtTensorConstructor;
  InferenceSession?: {
    create(
      path: string,
      options?: { executionProviders?: string[] },
    ): Promise<{
      inputNames: string[];
      outputNames: string[];
      run(feeds: Record<string, unknown>): Promise<Record<string, OnnxTensorLike>>;
    }>;
  };
  env?: {
    wasm?: {
      numThreads?: number;
      simd?: boolean;
      wasmPaths?: string;
    };
  };
}

function moduleRoots(): string[] {
  const filename = resolveRuntimeFilename();
  const dir = dirname(filename);
  return [
    join(dir, 'native', 'onnxruntime', 'node_modules'),
    join(dir, '..', 'dist', 'native', 'onnxruntime', 'node_modules'),
    join(dir, '..', '..', 'dist', 'native', 'onnxruntime', 'node_modules'),
    join(process.cwd(), 'node_modules'),
  ];
}

function tryLoadOrt(packageId: string): OrtModule | undefined {
  const filename = resolveRuntimeFilename();
  const packageRoots = [
    ...moduleRoots().map((root) => join(root, packageId)),
  ];
  const requirers = [
    ...packageRoots
      .filter((root) => existsSync(join(root, 'package.json')))
      .map((root) => ({ from: join(root, 'package.json'), id: root })),
    { from: filename, id: packageId },
    { from: join(process.cwd(), 'package.json'), id: packageId },
  ];
  for (const candidate of requirers) {
    try {
      const loaded = createRequire(candidate.from)(candidate.id) as OrtModule;
      if (loaded?.InferenceSession && loaded.Tensor) {
        return loaded;
      }
    } catch {
      continue;
    }
  }
  return undefined;
}

function configureWasmPaths(ort: OrtModule, packageId: string): void {
  if (!ort.env?.wasm) return;
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.simd = true;
  for (const root of moduleRoots()) {
    const dist = join(root, packageId, 'dist');
    if (!existsSync(dist)) continue;
    const wasm = readdirSync(dist).find((name) => name.endsWith('.wasm'));
    if (wasm) {
      ort.env.wasm.wasmPaths = `${dist}/`;
      return;
    }
  }
}

function wrapSession(
  raw: {
    inputNames: string[];
    outputNames: string[];
    run(feeds: Record<string, unknown>): Promise<Record<string, OnnxTensorLike>>;
  },
): OnnxInferenceSession {
  return {
    inputNames: raw.inputNames,
    outputNames: raw.outputNames,
    run: (feeds) => raw.run(feeds),
  };
}

export class HostOnnxRuntimeSessionFactory implements OnnxRuntimeSessionFactory {
  constructor(
    private readonly loadModule: (packageId: string) => OrtModule | undefined = tryLoadOrt,
  ) {}

  async create(input: CreateOnnxSessionInput): Promise<CreatedOnnxSession> {
    input.abortSignal?.throwIfAborted();
    const native = this.loadModule(ONNX_RUNTIME_NODE_PACKAGE);
    if (native?.InferenceSession && native.Tensor && input.preferredKind !== 'wasm') {
      const raw = await native.InferenceSession.create(input.modelPath, {
        executionProviders: ['cpu'],
      });
      return {
        session: wrapSession(raw),
        resolution: describeOnnxExecutionProvider({
          kind: 'native',
          packageId: ONNX_RUNTIME_NODE_PACKAGE,
        }),
        createInt64Tensor: (values, dims) =>
          new native.Tensor!(
            'int64',
            BigInt64Array.from(values.map((value) => BigInt(value))),
            [...dims],
          ),
      };
    }

    const wasm = this.loadModule(ONNX_RUNTIME_WEB_PACKAGE);
    if (!wasm?.InferenceSession || !wasm.Tensor) {
      throw new Error(
        'ONNX Runtime is unavailable. Install optional native modules onnxruntime-node (preferred) or onnxruntime-web (WASM fallback) for this OS/CPU.',
      );
    }
    configureWasmPaths(wasm, ONNX_RUNTIME_WEB_PACKAGE);
    const raw = await wasm.InferenceSession.create(input.modelPath, {
      executionProviders: ['wasm'],
    });
    return {
      session: wrapSession(raw),
      resolution: describeOnnxExecutionProvider({
        kind: 'wasm',
        packageId: ONNX_RUNTIME_WEB_PACKAGE,
      }),
      createInt64Tensor: (values, dims) =>
        new wasm.Tensor!(
          'int64',
          BigInt64Array.from(values.map((value) => BigInt(value))),
          [...dims],
        ),
    };
  }
}
