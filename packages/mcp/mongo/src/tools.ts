import { MongoClient, ObjectId, type Document } from 'mongodb';

import {
  WRITE_TOOL_NAMES,
  assertWriteAllowed,
  resolveDbAccessMode,
  type DbAccessMode,
} from './access.js';

const COLLECTION_NAME_RE = /^[A-Za-z_][A-Za-z0-9_.-]*$/;
const OBJECT_ID_RE = /^[a-fA-F0-9]{24}$/;
const MAX_OBJECT_DEPTH = 100;

const FORBIDDEN_AGG_OPERATORS = new Set([
  '$out',
  '$merge',
  '$function',
  '$accumulator',
  '$where',
]);

/** Read tools always available (Mitii discovery + query ladder). */
const READ_TOOL_DEFINITIONS = [
  {
    name: 'list_collections',
    description: 'List collection names in the connected MongoDB database.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'describe_collection',
    description:
      'Infer a field schema by sampling documents from a collection.',
    inputSchema: {
      type: 'object',
      properties: {
        collection: { type: 'string', description: 'Collection name' },
        sample_size: {
          type: 'number',
          description: 'Docs to sample for schema inference (capped)',
          default: 20,
        },
      },
      required: ['collection'],
    },
  },
  {
    name: 'query',
    description:
      'Find documents with optional filter/projection/sort/limit/skip.',
    inputSchema: {
      type: 'object',
      properties: {
        collection: { type: 'string' },
        filter: { type: 'object', description: 'MongoDB filter document' },
        projection: { type: 'object' },
        sort: { type: 'object' },
        skip: { type: 'number', default: 0 },
        limit: { type: 'number', default: 50 },
      },
      required: ['collection'],
    },
  },
  {
    name: 'aggregate',
    description:
      'Run an aggregation pipeline. Rejects $out/$merge and server-side JS operators.',
    inputSchema: {
      type: 'object',
      properties: {
        collection: { type: 'string' },
        pipeline: {
          type: 'array',
          description: 'Aggregation pipeline stages',
          items: { type: 'object' },
        },
        limit: {
          type: 'number',
          description: 'Max documents returned after pipeline (capped)',
          default: 50,
        },
      },
      required: ['collection', 'pipeline'],
    },
  },
  {
    name: 'count',
    description: 'Count documents matching an optional filter.',
    inputSchema: {
      type: 'object',
      properties: {
        collection: { type: 'string' },
        filter: { type: 'object' },
      },
      required: ['collection'],
    },
  },
  {
    name: 'server_info',
    description: 'MongoDB server version and basic build info (read-only).',
    inputSchema: {
      type: 'object',
      properties: {
        include_debug: {
          type: 'boolean',
          description: 'Include connection host string (no credentials)',
        },
      },
    },
  },
] as const;

/** Write tools — only when MCP_DB_ACCESS=readwrite. */
const WRITE_TOOL_DEFINITIONS = [
  {
    name: 'insert',
    description: 'Insert one or more documents into a collection (write).',
    inputSchema: {
      type: 'object',
      properties: {
        collection: { type: 'string' },
        documents: {
          type: 'array',
          description: 'Documents to insert',
          items: { type: 'object' },
        },
        ordered: {
          type: 'boolean',
          description: 'Ordered insert (default true)',
        },
      },
      required: ['collection', 'documents'],
    },
  },
  {
    name: 'update',
    description:
      'Update documents matching a filter ($set / $unset / $inc, etc.).',
    inputSchema: {
      type: 'object',
      properties: {
        collection: { type: 'string' },
        filter: { type: 'object' },
        update: {
          type: 'object',
          description: 'Update operators document',
        },
        upsert: { type: 'boolean', default: false },
        multi: {
          type: 'boolean',
          description: 'Update many matching documents (default false)',
          default: false,
        },
      },
      required: ['collection', 'filter', 'update'],
    },
  },
  {
    name: 'delete',
    description: 'Delete documents matching a filter (write).',
    inputSchema: {
      type: 'object',
      properties: {
        collection: { type: 'string' },
        filter: { type: 'object' },
        multi: {
          type: 'boolean',
          description: 'Delete many matching documents (default false)',
          default: false,
        },
      },
      required: ['collection', 'filter'],
    },
  },
  {
    name: 'create_index',
    description: 'Create one or more indexes on a collection (write).',
    inputSchema: {
      type: 'object',
      properties: {
        collection: { type: 'string' },
        indexes: {
          type: 'array',
          description: 'Index specs: { key, unique?, name? }',
          items: { type: 'object' },
        },
      },
      required: ['collection', 'indexes'],
    },
  },
] as const;

/** @deprecated Prefer listToolDefinitions(access) — all tools including writes. */
export const TOOL_DEFINITIONS = [
  ...READ_TOOL_DEFINITIONS,
  ...WRITE_TOOL_DEFINITIONS,
] as const;

export function listToolDefinitions(
  access: DbAccessMode = resolveDbAccessMode(),
): ReadonlyArray<{
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}> {
  if (access === 'readwrite') {
    return TOOL_DEFINITIONS;
  }
  return READ_TOOL_DEFINITIONS;
}

export function resolveMongoUri(env: NodeJS.ProcessEnv = process.env): string {
  const uri =
    env.MCP_MONGODB_URI?.trim() ||
    env.MONGODB_URI?.trim() ||
    '';
  if (!uri) {
    throw new Error('MCP_MONGODB_URI (or MONGODB_URI) is required');
  }
  if (
    !uri.startsWith('mongodb://') &&
    !uri.startsWith('mongodb+srv://')
  ) {
    throw new Error(
      'MongoDB URI must start with mongodb:// or mongodb+srv://',
    );
  }
  return uri;
}

export function resolveMaxDocs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.MONGO_MAX_DOCS?.trim();
  if (!raw) return 50;
  const n = Number(raw);
  if (!Number.isFinite(n)) return 50;
  return Math.max(1, Math.min(200, Math.floor(n)));
}

/**
 * Reject aggregation stages that write or run server-side JS
 * (readonly / readwrite safety for Mitii Database mode).
 */
export function rejectForbiddenPipeline(pipeline: unknown[]): void {
  const found = findAggOperator(pipeline, FORBIDDEN_AGG_OPERATORS);
  if (found) {
    throw new Error(
      `Aggregation operator ${found} is not allowed`,
    );
  }
  const cross = findCrossDbTarget(pipeline);
  if (cross) {
    throw new Error(
      `Cross-database aggregation target "${cross}" is not allowed`,
    );
  }
}

function findAggOperator(
  value: unknown,
  operators: Set<string>,
  depth = 0,
): string | null {
  if (depth > MAX_OBJECT_DEPTH) {
    throw new Error(
      `Object nesting exceeds the maximum depth of ${MAX_OBJECT_DEPTH}`,
    );
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findAggOperator(item, operators, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (value && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (operators.has(key)) return key;
      const found = findAggOperator(nested, operators, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

function findCrossDbTarget(pipeline: unknown[]): string | null {
  const foreignDb = (target: unknown): string | null => {
    if (target && typeof target === 'object' && 'db' in target) {
      const db = (target as { db?: unknown }).db;
      if (typeof db === 'string' && db) return db;
    }
    return null;
  };
  for (const stage of pipeline) {
    if (!stage || typeof stage !== 'object') continue;
    const s = stage as Record<string, unknown>;
    const out = foreignDb(s.$out);
    if (out) return out;
    const merge = s.$merge as { into?: unknown } | undefined;
    const mergeInto = foreignDb(merge?.into ?? s.$merge);
    if (mergeInto) return mergeInto;
    const lookup = s.$lookup as { from?: unknown } | undefined;
    const lookupFrom = foreignDb(lookup?.from);
    if (lookupFrom) return lookupFrom;
  }
  return null;
}

function validateCollectionName(name: string): string {
  if (!COLLECTION_NAME_RE.test(name)) {
    throw new Error('Invalid collection name');
  }
  return name;
}

/** Convert 24-char hex strings to ObjectId when auto-detecting ids. */
function convertObjectIds(value: unknown, depth = 0): unknown {
  if (depth > MAX_OBJECT_DEPTH) return value;
  if (typeof value === 'string' && OBJECT_ID_RE.test(value)) {
    try {
      return ObjectId.createFromHexString(value);
    } catch {
      return value;
    }
  }
  if (Array.isArray(value)) {
    return value.map((item) => convertObjectIds(item, depth + 1));
  }
  if (value && typeof value === 'object' && !(value instanceof Date) && !(value instanceof ObjectId)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = convertObjectIds(v, depth + 1);
    }
    return out;
  }
  return value;
}

function inferSchema(docs: Document[]): Record<string, string[]> {
  const fields: Record<string, Set<string>> = {};
  for (const doc of docs) {
    walkDoc(doc, '', fields, 0);
  }
  const out: Record<string, string[]> = {};
  for (const [path, types] of Object.entries(fields)) {
    out[path] = [...types].sort();
  }
  return out;
}

function walkDoc(
  value: unknown,
  path: string,
  fields: Record<string, Set<string>>,
  depth: number,
): void {
  if (depth > 6) return;
  const typeName = typeOf(value);
  if (path) {
    if (!fields[path]) fields[path] = new Set();
    fields[path]!.add(typeName);
  }
  if (value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date) && !(value instanceof ObjectId)) {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      walkDoc(v, path ? `${path}.${k}` : k, fields, depth + 1);
    }
  } else if (Array.isArray(value) && value.length > 0) {
    walkDoc(value[0], path ? `${path}[]` : '[]', fields, depth + 1);
  }
}

function typeOf(value: unknown): string {
  if (value === null) return 'null';
  if (value instanceof ObjectId) return 'ObjectId';
  if (value instanceof Date) return 'Date';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function textResult(
  text: string,
  isError = false,
): { content: Array<{ type: 'text'; text: string }>; isError?: boolean } {
  return {
    content: [{ type: 'text', text }],
    ...(isError ? { isError: true } : {}),
  };
}

async function withDb<T>(
  env: NodeJS.ProcessEnv,
  fn: (db: ReturnType<MongoClient['db']>, client: MongoClient) => Promise<T>,
): Promise<T> {
  const uri = resolveMongoUri(env);
  const client = new MongoClient(uri);
  try {
    await client.connect();
    return await fn(client.db(), client);
  } finally {
    await client.close().catch(() => undefined);
  }
}

export async function handleToolCall(
  name: string,
  args: Record<string, unknown>,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
  try {
    const access = resolveDbAccessMode(env);
    if (WRITE_TOOL_NAMES.has(name)) {
      assertWriteAllowed(access, name);
    }

    if (name === 'list_collections') {
      return await withDb(env, async (db) => {
        const cols = await db.listCollections({}, { nameOnly: true }).toArray();
        const names = cols.map((c) => c.name).sort();
        return textResult(JSON.stringify(names, null, 2));
      });
    }

    if (name === 'describe_collection') {
      const collection =
        typeof args.collection === 'string' ? args.collection.trim() : '';
      if (!collection) return textResult('collection is required', true);
      const safe = validateCollectionName(collection);
      const maxDocs = resolveMaxDocs(env);
      const requested =
        typeof args.sample_size === 'number' && Number.isFinite(args.sample_size)
          ? Math.floor(args.sample_size)
          : 20;
      const sampleSize = Math.max(1, Math.min(requested, maxDocs, 50));
      return await withDb(env, async (db) => {
        const docs = await db
          .collection(safe)
          .find({})
          .limit(sampleSize)
          .toArray();
        const schema = inferSchema(docs);
        return textResult(
          JSON.stringify(
            {
              collection: safe,
              sampleSize: docs.length,
              estimatedFields: schema,
            },
            null,
            2,
          ),
        );
      });
    }

    if (name === 'query') {
      const collection =
        typeof args.collection === 'string' ? args.collection.trim() : '';
      if (!collection) return textResult('collection is required', true);
      const safe = validateCollectionName(collection);
      const maxDocs = resolveMaxDocs(env);
      const requested =
        typeof args.limit === 'number' && Number.isFinite(args.limit)
          ? Math.floor(args.limit)
          : maxDocs;
      const limit = Math.max(0, Math.min(requested, maxDocs));
      const skip =
        typeof args.skip === 'number' && Number.isFinite(args.skip)
          ? Math.max(0, Math.floor(args.skip))
          : 0;
      const filter = convertObjectIds(
        args.filter && typeof args.filter === 'object' ? args.filter : {},
      ) as Document;
      const projection =
        args.projection && typeof args.projection === 'object'
          ? (args.projection as Document)
          : undefined;
      const sort =
        args.sort && typeof args.sort === 'object'
          ? (args.sort as Document)
          : undefined;
      return await withDb(env, async (db) => {
        let cursor = db.collection(safe).find(filter);
        if (projection) cursor = cursor.project(projection);
        if (sort) cursor = cursor.sort(sort);
        if (skip > 0) cursor = cursor.skip(skip);
        const docs = await cursor.limit(limit).toArray();
        return textResult(
          JSON.stringify(
            { collection: safe, skip, limit, count: docs.length, docs },
            null,
            2,
          ),
        );
      });
    }

    if (name === 'aggregate') {
      const collection =
        typeof args.collection === 'string' ? args.collection.trim() : '';
      if (!collection) return textResult('collection is required', true);
      const safe = validateCollectionName(collection);
      if (!Array.isArray(args.pipeline)) {
        return textResult('pipeline must be an array', true);
      }
      rejectForbiddenPipeline(args.pipeline);
      const maxDocs = resolveMaxDocs(env);
      const requested =
        typeof args.limit === 'number' && Number.isFinite(args.limit)
          ? Math.floor(args.limit)
          : maxDocs;
      const limit = Math.max(0, Math.min(requested, maxDocs));
      const pipeline = convertObjectIds(args.pipeline) as Document[];
      const capped = [...pipeline, { $limit: limit }];
      return await withDb(env, async (db) => {
        const docs = await db.collection(safe).aggregate(capped).toArray();
        return textResult(
          JSON.stringify({ collection: safe, limit, count: docs.length, docs }, null, 2),
        );
      });
    }

    if (name === 'count') {
      const collection =
        typeof args.collection === 'string' ? args.collection.trim() : '';
      if (!collection) return textResult('collection is required', true);
      const safe = validateCollectionName(collection);
      const filter = convertObjectIds(
        args.filter && typeof args.filter === 'object' ? args.filter : {},
      ) as Document;
      return await withDb(env, async (db) => {
        const n = await db.collection(safe).countDocuments(filter);
        return textResult(JSON.stringify({ collection: safe, count: n }, null, 2));
      });
    }

    if (name === 'server_info') {
      return await withDb(env, async (_db, client) => {
        const info = await client.db().admin().serverInfo();
        const payload: Record<string, unknown> = {
          version: info.version,
          gitVersion: info.gitVersion,
          modules: info.modules,
        };
        if (args.include_debug === true) {
          const uri = resolveMongoUri(env);
          payload.host = uri.replace(/\/\/([^@/]+)@/, '//***@');
        }
        return textResult(JSON.stringify(payload, null, 2));
      });
    }

    if (name === 'insert') {
      const collection =
        typeof args.collection === 'string' ? args.collection.trim() : '';
      if (!collection) return textResult('collection is required', true);
      const safe = validateCollectionName(collection);
      if (!Array.isArray(args.documents) || args.documents.length === 0) {
        return textResult('documents must be a non-empty array', true);
      }
      const documents = convertObjectIds(args.documents) as Document[];
      const ordered = args.ordered !== false;
      return await withDb(env, async (db) => {
        const result = await db
          .collection(safe)
          .insertMany(documents, { ordered });
        return textResult(
          JSON.stringify(
            {
              collection: safe,
              insertedCount: result.insertedCount,
              insertedIds: Object.values(result.insertedIds).map(String),
            },
            null,
            2,
          ),
        );
      });
    }

    if (name === 'update') {
      const collection =
        typeof args.collection === 'string' ? args.collection.trim() : '';
      if (!collection) return textResult('collection is required', true);
      const safe = validateCollectionName(collection);
      if (!args.filter || typeof args.filter !== 'object') {
        return textResult('filter is required', true);
      }
      if (!args.update || typeof args.update !== 'object') {
        return textResult('update is required', true);
      }
      const filter = convertObjectIds(args.filter) as Document;
      const update = convertObjectIds(args.update) as Document;
      const upsert = args.upsert === true;
      const multi = args.multi === true;
      return await withDb(env, async (db) => {
        const col = db.collection(safe);
        const result = multi
          ? await col.updateMany(filter, update, { upsert })
          : await col.updateOne(filter, update, { upsert });
        return textResult(
          JSON.stringify(
            {
              collection: safe,
              matchedCount: result.matchedCount,
              modifiedCount: result.modifiedCount,
              upsertedCount: result.upsertedCount,
              upsertedId: result.upsertedId
                ? String(result.upsertedId)
                : undefined,
            },
            null,
            2,
          ),
        );
      });
    }

    if (name === 'delete') {
      const collection =
        typeof args.collection === 'string' ? args.collection.trim() : '';
      if (!collection) return textResult('collection is required', true);
      const safe = validateCollectionName(collection);
      if (!args.filter || typeof args.filter !== 'object') {
        return textResult('filter is required', true);
      }
      const filter = convertObjectIds(args.filter) as Document;
      if (Object.keys(filter).length === 0) {
        return textResult(
          'Refusing delete with empty filter (would match all documents)',
          true,
        );
      }
      const multi = args.multi === true;
      return await withDb(env, async (db) => {
        const col = db.collection(safe);
        const result = multi
          ? await col.deleteMany(filter)
          : await col.deleteOne(filter);
        return textResult(
          JSON.stringify(
            { collection: safe, deletedCount: result.deletedCount },
            null,
            2,
          ),
        );
      });
    }

    if (name === 'create_index') {
      const collection =
        typeof args.collection === 'string' ? args.collection.trim() : '';
      if (!collection) return textResult('collection is required', true);
      const safe = validateCollectionName(collection);
      if (!Array.isArray(args.indexes) || args.indexes.length === 0) {
        return textResult('indexes must be a non-empty array', true);
      }
      return await withDb(env, async (db) => {
        const names: string[] = [];
        for (const spec of args.indexes as Array<Record<string, unknown>>) {
          const key = spec.key;
          if (!key || typeof key !== 'object') {
            throw new Error('Each index requires a key object');
          }
          const name = await db.collection(safe).createIndex(key as Document, {
            ...(typeof spec.name === 'string' ? { name: spec.name } : {}),
            ...(spec.unique === true ? { unique: true } : {}),
          });
          names.push(name);
        }
        return textResult(
          JSON.stringify({ collection: safe, indexes: names }, null, 2),
        );
      });
    }

    return textResult(`Unknown tool: ${name}`, true);
  } catch (error) {
    return textResult(
      error instanceof Error ? error.message : String(error),
      true,
    );
  }
}
