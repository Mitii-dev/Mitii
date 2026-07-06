#!/usr/bin/env node
// Generates the tools/benchmark/fixtures/saas-api fixture: a synthetic but
// realistic ~100-file modular TypeScript API used to stress-test retrieval
// (HybridRetriever) against a codebase big enough that keyword/file-name
// collisions actually matter. Run once; output is committed like the other
// fixtures under tools/benchmark/fixtures/.
//
//   node tools/benchmark/scripts/generate-large-fixture.mjs

import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = join(__dirname, '../fixtures/saas-api');

function pascal(slug) {
  return slug.replace(/(^|-)([a-z])/g, (_, __, c) => c.toUpperCase());
}

function camel(slug) {
  const p = pascal(slug);
  return p.charAt(0).toLowerCase() + p.slice(1);
}

/** Each module models one domain of the SaaS API. `specialMethods` are the
 * behaviors we hand-label retrieval queries against later — keep them
 * specific and non-generic so keyword/FTS retrieval has real signal. */
const MODULES = [
  {
    slug: 'auth',
    entity: 'User',
    fields: [['email', 'string'], ['passwordHash', 'string'], ['role', 'string']],
    createDto: { name: 'RegisterDto', fields: [['email', 'string'], ['password', 'string']] },
    secondaryDto: { name: 'LoginDto', fields: [['email', 'string'], ['password', 'string']] },
    specialMethods: [
      {
        name: 'hashPassword',
        signature: '(plainText: string): Promise<string>',
        doc: 'Hashes a plaintext password with bcrypt before it is persisted. Never store plaintext passwords.',
        body: 'return bcryptHash(plainText, BCRYPT_SALT_ROUNDS);',
      },
      {
        name: 'generateAccessToken',
        signature: '(userId: string): string',
        doc: 'Signs a short-lived JWT access token for the given user id. Refresh tokens are handled separately in refreshAccessToken.',
        body: 'return signJwt({ sub: userId }, ACCESS_TOKEN_TTL_SECONDS);',
      },
      {
        name: 'refreshAccessToken',
        signature: '(refreshToken: string): Promise<string>',
        doc: 'Validates a refresh token and issues a new access token, rotating the refresh token to prevent replay.',
        body: 'const claims = verifyJwt(refreshToken);\n    return this.generateAccessToken(claims.sub);',
      },
    ],
  },
  {
    slug: 'users',
    entity: 'User',
    fields: [['name', 'string'], ['email', 'string'], ['status', 'string']],
    createDto: { name: 'CreateUserDto', fields: [['name', 'string'], ['email', 'string']] },
    secondaryDto: { name: 'UpdateUserDto', fields: [['name', 'string'], ['email', 'string']] },
    specialMethods: [
      {
        name: 'deactivateUser',
        signature: '(id: string, reason: string): Promise<User>',
        doc: 'Soft-deletes a user account by flipping status to "deactivated" and recording the deactivation reason. Does not remove the row.',
        body: 'return this.repository.update(id, { status: \'deactivated\', deactivationReason: reason });',
      },
      {
        name: 'mergeDuplicateAccounts',
        signature: '(primaryId: string, duplicateId: string): Promise<User>',
        doc: 'Merges a duplicate account into the primary account, reassigning orders and subscriptions before deleting the duplicate.',
        body: 'await this.repository.reassignOwnership(duplicateId, primaryId);\n    await this.repository.delete(duplicateId);\n    return this.repository.findById(primaryId);',
      },
    ],
  },
  {
    slug: 'products',
    entity: 'Product',
    fields: [['name', 'string'], ['priceCents', 'number'], ['sku', 'string']],
    createDto: { name: 'CreateProductDto', fields: [['name', 'string'], ['priceCents', 'number'], ['sku', 'string']] },
    secondaryDto: { name: 'UpdateProductDto', fields: [['name', 'string'], ['priceCents', 'number']] },
    specialMethods: [
      {
        name: 'adjustPrice',
        signature: '(id: string, newPriceCents: number): Promise<Product>',
        doc: 'Changes a product\'s price and writes a price-history row so past invoices keep referencing the price at time of purchase.',
        body: 'await this.repository.recordPriceHistory(id, newPriceCents);\n    return this.repository.update(id, { priceCents: newPriceCents });',
      },
      {
        name: 'discontinueProduct',
        signature: '(id: string): Promise<Product>',
        doc: 'Marks a product as discontinued so it stops appearing in search and catalog listings, without deleting historical order references.',
        body: 'return this.repository.update(id, { status: \'discontinued\' });',
      },
    ],
  },
  {
    slug: 'orders',
    entity: 'Order',
    fields: [['userId', 'string'], ['status', 'string'], ['totalCents', 'number']],
    createDto: { name: 'CreateOrderDto', fields: [['userId', 'string'], ['items', 'string[]']] },
    secondaryDto: { name: 'UpdateOrderStatusDto', fields: [['status', 'string']] },
    specialMethods: [
      {
        name: 'convertCartToOrder',
        signature: '(cartId: string): Promise<Order>',
        doc: 'Converts a checked-out cart into an order: snapshots line-item prices, reserves inventory, and clears the cart. Called from CartService.checkoutCart.',
        body: 'const cart = await this.cartRepository.findById(cartId);\n    const order = await this.repository.insert({ userId: cart.userId, status: \'pending\', items: cart.items });\n    await this.cartRepository.clear(cartId);\n    return order;',
      },
      {
        name: 'cancelOrder',
        signature: '(id: string, reason: string): Promise<Order>',
        doc: 'Cancels a pending order, releasing any reserved inventory back to stock and recording the cancellation reason.',
        body: 'return this.repository.update(id, { status: \'cancelled\', cancellationReason: reason });',
      },
    ],
  },
  {
    slug: 'payments',
    entity: 'Payment',
    fields: [['orderId', 'string'], ['amountCents', 'number'], ['status', 'string']],
    createDto: { name: 'CreatePaymentDto', fields: [['orderId', 'string'], ['amountCents', 'number']] },
    secondaryDto: { name: 'RefundPaymentDto', fields: [['reason', 'string']] },
    specialMethods: [
      {
        name: 'retryPayment',
        signature: '(id: string): Promise<Payment>',
        doc: 'Retries a failed payment against the configured payment gateway with exponential backoff. Marks the payment permanently failed after MAX_RETRY_ATTEMPTS.',
        body: 'const payment = await this.findById(id);\n    if (payment.status !== \'failed\') throw new Error(\'Only failed payments can be retried\');\n    const attempt = (payment.retryCount ?? 0) + 1;\n    return this.repository.update(id, { status: attempt >= MAX_RETRY_ATTEMPTS ? \'failed_permanently\' : \'retrying\', retryCount: attempt });',
      },
      {
        name: 'processRefund',
        signature: '(id: string, dto: RefundPaymentDto): Promise<Payment>',
        doc: 'Issues a full refund for a completed payment and records the refund reason for audit purposes.',
        body: 'return this.repository.update(id, { status: \'refunded\', refundReason: dto.reason });',
      },
    ],
  },
  {
    slug: 'inventory',
    entity: 'StockItem',
    fields: [['productId', 'string'], ['quantityOnHand', 'number'], ['quantityReserved', 'number']],
    createDto: { name: 'AdjustStockDto', fields: [['productId', 'string'], ['delta', 'number']] },
    secondaryDto: { name: 'ReserveStockDto', fields: [['productId', 'string'], ['quantity', 'number']] },
    specialMethods: [
      {
        name: 'reserveStock',
        signature: '(dto: ReserveStockDto): Promise<void>',
        doc: 'Reserves stock for an in-progress checkout so two concurrent carts cannot both claim the last unit. Reservations expire after RESERVATION_TTL_MINUTES.',
        body: 'await this.repository.incrementReserved(dto.productId, dto.quantity);',
      },
      {
        name: 'releaseStock',
        signature: '(productId: string, quantity: number): Promise<void>',
        doc: 'Releases previously reserved stock back to available inventory, used when a cart expires or an order is cancelled.',
        body: 'await this.repository.decrementReserved(productId, quantity);',
      },
    ],
  },
  {
    slug: 'cart',
    entity: 'Cart',
    fields: [['userId', 'string'], ['items', 'string[]'], ['status', 'string']],
    createDto: { name: 'AddCartItemDto', fields: [['productId', 'string'], ['quantity', 'number']] },
    secondaryDto: { name: 'RemoveCartItemDto', fields: [['productId', 'string']] },
    specialMethods: [
      {
        name: 'mergeGuestCart',
        signature: '(guestCartId: string, userId: string): Promise<Cart>',
        doc: 'Merges an anonymous guest cart into a newly-authenticated user\'s cart after login, combining line items and deduping quantities.',
        body: 'const guestCart = await this.repository.findById(guestCartId);\n    return this.repository.mergeInto(userId, guestCart.items);',
      },
      {
        name: 'checkoutCart',
        signature: '(cartId: string): Promise<{ orderId: string }>',
        doc: 'Kicks off checkout for a cart by handing it to OrdersService.convertCartToOrder, then marks the cart as checked out.',
        body: 'const order = await this.ordersService.convertCartToOrder(cartId);\n    await this.repository.update(cartId, { status: \'checked_out\' });\n    return { orderId: order.id };',
      },
    ],
  },
  {
    slug: 'shipping',
    entity: 'Shipment',
    fields: [['orderId', 'string'], ['carrier', 'string'], ['trackingNumber', 'string']],
    createDto: { name: 'CreateShipmentDto', fields: [['orderId', 'string'], ['carrier', 'string']] },
    secondaryDto: { name: 'UpdateTrackingDto', fields: [['trackingNumber', 'string'], ['status', 'string']] },
    specialMethods: [
      {
        name: 'calculateShippingRate',
        signature: '(destinationZip: string, weightGrams: number): number',
        doc: 'Computes a shipping rate in cents using a flat base rate plus a per-gram surcharge, banded by destination zone.',
        body: 'const zone = resolveShippingZone(destinationZip);\n    return BASE_RATE_CENTS[zone] + weightGrams * PER_GRAM_SURCHARGE_CENTS;',
      },
      {
        name: 'trackShipment',
        signature: '(trackingNumber: string): Promise<{ status: string; lastUpdate: string }>',
        doc: 'Polls the carrier tracking API for the latest status of a shipment and caches the result for TRACKING_CACHE_TTL_MINUTES.',
        body: 'return this.repository.getCachedOrFetchTracking(trackingNumber);',
      },
    ],
  },
  {
    slug: 'reviews',
    entity: 'Review',
    fields: [['productId', 'string'], ['rating', 'number'], ['body', 'string']],
    createDto: { name: 'CreateReviewDto', fields: [['productId', 'string'], ['rating', 'number'], ['body', 'string']] },
    secondaryDto: { name: 'ModerateReviewDto', fields: [['action', 'string']] },
    specialMethods: [
      {
        name: 'flagReview',
        signature: '(id: string, flaggedBy: string): Promise<Review>',
        doc: 'Flags a review for moderator attention when it is reported by another user; hides it from public listing once FLAG_THRESHOLD is reached.',
        body: 'const review = await this.repository.incrementFlagCount(id, flaggedBy);\n    if (review.flagCount >= FLAG_THRESHOLD) return this.repository.update(id, { status: \'hidden\' });\n    return review;',
      },
      {
        name: 'computeAverageRating',
        signature: '(productId: string): Promise<number>',
        doc: 'Computes the rolling average rating for a product across all published (non-hidden) reviews.',
        body: 'return this.repository.averageRatingForProduct(productId);',
      },
    ],
  },
  {
    slug: 'notifications',
    entity: 'Notification',
    fields: [['userId', 'string'], ['channel', 'string'], ['body', 'string']],
    createDto: { name: 'SendNotificationDto', fields: [['userId', 'string'], ['channel', 'string'], ['body', 'string']] },
    secondaryDto: { name: 'NotificationPreferenceDto', fields: [['channel', 'string'], ['enabled', 'boolean']] },
    specialMethods: [
      {
        name: 'sendEmail',
        signature: '(userId: string, subject: string, body: string): Promise<void>',
        doc: 'Sends a transactional email via the configured email provider, skipping delivery if the user has opted out of the "email" channel.',
        body: 'const prefs = await this.repository.getPreferences(userId);\n    if (!prefs.email) return;\n    await this.emailProvider.send(userId, subject, body);',
      },
      {
        name: 'sendPush',
        signature: '(userId: string, body: string): Promise<void>',
        doc: 'Sends a push notification to all of a user\'s registered devices, batching by device token.',
        body: 'const tokens = await this.repository.getDeviceTokens(userId);\n    await Promise.all(tokens.map((t) => this.pushProvider.send(t, body)));',
      },
    ],
  },
  {
    slug: 'subscriptions',
    entity: 'Subscription',
    fields: [['userId', 'string'], ['planId', 'string'], ['status', 'string']],
    createDto: { name: 'CreateSubscriptionDto', fields: [['userId', 'string'], ['planId', 'string']] },
    secondaryDto: { name: 'CancelSubscriptionDto', fields: [['reason', 'string']] },
    specialMethods: [
      {
        name: 'renewSubscription',
        signature: '(id: string): Promise<Subscription>',
        doc: 'Renews a subscription for another billing period, charging the stored payment method and extending currentPeriodEnd.',
        body: 'await this.paymentsService.retryPayment(id);\n    return this.repository.extendPeriod(id, BILLING_PERIOD_DAYS);',
      },
      {
        name: 'prorateUpgrade',
        signature: '(id: string, newPlanId: string): Promise<Subscription>',
        doc: 'Calculates a prorated credit for the remaining days on the current plan when a user upgrades mid-cycle, then applies it to the new plan\'s first invoice.',
        body: 'const credit = this.repository.computeProrationCredit(id);\n    return this.repository.update(id, { planId: newPlanId, creditCents: credit });',
      },
    ],
  },
  {
    slug: 'support-tickets',
    entity: 'SupportTicket',
    fields: [['userId', 'string'], ['subject', 'string'], ['status', 'string']],
    createDto: { name: 'CreateTicketDto', fields: [['userId', 'string'], ['subject', 'string'], ['body', 'string']] },
    secondaryDto: { name: 'AssignTicketDto', fields: [['agentId', 'string']] },
    specialMethods: [
      {
        name: 'escalateTicket',
        signature: '(id: string, reason: string): Promise<SupportTicket>',
        doc: 'Escalates a support ticket to tier-2 support when it has been unresolved for longer than ESCALATION_THRESHOLD_HOURS.',
        body: 'return this.repository.update(id, { priority: \'escalated\', escalationReason: reason });',
      },
      {
        name: 'closeTicket',
        signature: '(id: string, resolutionNotes: string): Promise<SupportTicket>',
        doc: 'Closes a resolved support ticket and records resolution notes for future reference.',
        body: 'return this.repository.update(id, { status: \'closed\', resolutionNotes });',
      },
    ],
  },
  {
    slug: 'webhooks',
    entity: 'WebhookEndpoint',
    fields: [['url', 'string'], ['secret', 'string'], ['events', 'string[]']],
    createDto: { name: 'RegisterWebhookDto', fields: [['url', 'string'], ['events', 'string[]']] },
    secondaryDto: { name: 'WebhookEventDto', fields: [['type', 'string'], ['payload', 'string']] },
    specialMethods: [
      {
        name: 'verifySignature',
        signature: '(rawBody: string, signatureHeader: string, secret: string): boolean',
        doc: 'Verifies an inbound webhook\'s HMAC-SHA256 signature against the endpoint\'s stored secret using a constant-time comparison to prevent timing attacks.',
        body: 'const expected = computeHmacSha256(rawBody, secret);\n    return timingSafeEqual(expected, signatureHeader);',
      },
      {
        name: 'retryDelivery',
        signature: '(eventId: string): Promise<void>',
        doc: 'Retries delivery of a webhook event that previously failed, using an exponential backoff schedule capped at MAX_DELIVERY_ATTEMPTS.',
        body: 'const event = await this.repository.findEventById(eventId);\n    await this.deliverWithBackoff(event);',
      },
    ],
  },
  {
    slug: 'admin',
    entity: 'AdminAction',
    fields: [['adminId', 'string'], ['action', 'string'], ['targetId', 'string']],
    createDto: { name: 'ImpersonateUserDto', fields: [['targetUserId', 'string']] },
    secondaryDto: { name: 'AuditActionDto', fields: [['action', 'string'], ['targetId', 'string']] },
    specialMethods: [
      {
        name: 'impersonateUser',
        signature: '(adminId: string, dto: ImpersonateUserDto): Promise<string>',
        doc: 'Generates a short-lived impersonation token letting a support admin act as a user for debugging, and writes an audit-log entry recording who impersonated whom.',
        body: 'await this.auditLogService.recordAuditEntry({ actorId: adminId, action: \'impersonate\', targetId: dto.targetUserId });\n    return this.authService.generateAccessToken(dto.targetUserId);',
      },
      {
        name: 'suspendAccount',
        signature: '(targetUserId: string, reason: string): Promise<void>',
        doc: 'Immediately suspends a user account for policy violations, revoking active sessions.',
        body: 'await this.usersService.deactivateUser(targetUserId, reason);',
      },
    ],
  },
  {
    slug: 'analytics',
    entity: 'AnalyticsEvent',
    fields: [['userId', 'string'], ['eventName', 'string'], ['properties', 'string']],
    createDto: { name: 'TrackEventDto', fields: [['userId', 'string'], ['eventName', 'string']] },
    secondaryDto: { name: 'ReportQueryDto', fields: [['metric', 'string'], ['rangeDays', 'number']] },
    specialMethods: [
      {
        name: 'computeDailyActiveUsers',
        signature: '(rangeDays: number): Promise<number[]>',
        doc: 'Computes daily active user counts over a rolling window by counting distinct userIds per calendar day from the raw event stream.',
        body: 'return this.repository.countDistinctUsersPerDay(rangeDays);',
      },
      {
        name: 'computeConversionFunnel',
        signature: '(steps: string[]): Promise<number[]>',
        doc: 'Computes drop-off counts across an ordered sequence of funnel steps (e.g. view -> add_to_cart -> checkout -> purchase).',
        body: 'return this.repository.countUsersCompletingEachStep(steps);',
      },
    ],
  },
  {
    slug: 'search',
    entity: 'SearchDocument',
    fields: [['entityType', 'string'], ['entityId', 'string'], ['text', 'string']],
    createDto: { name: 'SearchQueryDto', fields: [['query', 'string'], ['entityType', 'string']] },
    secondaryDto: { name: 'IndexDocumentDto', fields: [['entityType', 'string'], ['entityId', 'string'], ['text', 'string']] },
    specialMethods: [
      {
        name: 'rebuildSearchIndex',
        signature: '(entityType: string): Promise<number>',
        doc: 'Rebuilds the full-text search index for one entity type from scratch, used after a schema change or index corruption.',
        body: 'const rows = await this.repository.streamAllForType(entityType);\n    return this.repository.reindexAll(entityType, rows);',
      },
      {
        name: 'search',
        signature: '(dto: SearchQueryDto): Promise<SearchDocument[]>',
        doc: 'Runs a ranked full-text search query scoped to an optional entity type, returning results ordered by relevance score.',
        body: 'return this.repository.fullTextSearch(dto.query, dto.entityType);',
      },
    ],
  },
  {
    slug: 'audit-log',
    entity: 'AuditEntry',
    fields: [['actorId', 'string'], ['action', 'string'], ['targetId', 'string']],
    createDto: { name: 'CreateAuditEntryDto', fields: [['actorId', 'string'], ['action', 'string'], ['targetId', 'string']] },
    secondaryDto: { name: 'QueryAuditLogDto', fields: [['actorId', 'string'], ['fromDate', 'string']] },
    specialMethods: [
      {
        name: 'recordAuditEntry',
        signature: '(dto: CreateAuditEntryDto): Promise<AuditEntry>',
        doc: 'Writes an immutable audit-log entry recording who did what to which resource. Called by AdminService.impersonateUser and other sensitive actions.',
        body: 'return this.repository.insert({ ...dto, recordedAt: new Date().toISOString() });',
      },
      {
        name: 'purgeOldEntries',
        signature: '(olderThanDays: number): Promise<number>',
        doc: 'Purges audit-log entries older than the configured retention window to satisfy data-retention policy.',
        body: 'return this.repository.deleteOlderThan(olderThanDays);',
      },
    ],
  },
];

function tsField([name, type]) {
  return `  ${name}: ${type};`;
}

function dtoFile(moduleSlug, dto) {
  const kebab = dto.name.replace(/Dto$/, '').replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
  return {
    path: `src/modules/${moduleSlug}/dto/${kebab}.dto.ts`,
    content: `export interface ${dto.name} {\n${dto.fields.map(tsField).join('\n')}\n}\n`,
  };
}

function repositoryFile(m) {
  const Entity = m.entity;
  const cls = `${pascal(m.slug)}Repository`;
  return `import type { ${Entity} } from './${m.slug}.service';

/** In-memory-style persistence layer for ${Entity} rows. Swap for a real DB client in production. */
export class ${cls} {
  private rows = new Map<string, ${Entity}>();

  async insert(data: Partial<${Entity}>): Promise<${Entity}> {
    const id = \`${camel(m.slug)}_\${this.rows.size + 1}\`;
    const row = { id, ...data } as ${Entity};
    this.rows.set(id, row);
    return row;
  }

  async findById(id: string): Promise<${Entity} | undefined> {
    return this.rows.get(id);
  }

  async findAll(): Promise<${Entity}[]> {
    return Array.from(this.rows.values());
  }

  async update(id: string, patch: Partial<${Entity}>): Promise<${Entity}> {
    const existing = this.rows.get(id);
    if (!existing) throw new Error(\`${Entity} \${id} not found\`);
    const updated = { ...existing, ...patch };
    this.rows.set(id, updated);
    return updated;
  }

  async delete(id: string): Promise<void> {
    this.rows.delete(id);
  }
}
`;
}

function constDeclarationFor(name) {
  if (/(SECONDS|MINUTES|HOURS|DAYS|ROUNDS|THRESHOLD|ATTEMPTS|CENTS)$/.test(name)) {
    return `const ${name} = ${/CENTS$/.test(name) ? 250 : 5};`;
  }
  return `const ${name} = 5;`;
}

function serviceFile(m) {
  const Entity = m.entity;
  const cls = `${pascal(m.slug)}Service`;
  const repoCls = `${pascal(m.slug)}Repository`;
  const bodyText = m.specialMethods.map((fn) => fn.body).join('\n');
  const constants = Array.from(new Set(bodyText.match(/\b[A-Z][A-Z0-9_]{2,}\b/g) ?? []))
    .map(constDeclarationFor)
    .join('\n');
  const methods = m.specialMethods
    .map(
      (fn) => `
  /**
   * ${fn.doc}
   */
  async ${fn.name}${fn.signature} {
    ${fn.body}
  }`
    )
    .join('\n');

  return `import { ${repoCls} } from './${m.slug}.repository';
import type { ${m.createDto.name} } from './dto/${dtoFile(m.slug, m.createDto).path.split('/').pop().replace('.dto.ts', '')}.dto';
import type { ${m.secondaryDto.name} } from './dto/${dtoFile(m.slug, m.secondaryDto).path.split('/').pop().replace('.dto.ts', '')}.dto';

${constants ? constants + '\n' : ''}export interface ${Entity} {
  id: string;
${m.fields.map(tsField).join('\n')}
}

export class ${cls} {
  constructor(private readonly repository: ${repoCls}) {}

  async create(dto: ${m.createDto.name}): Promise<${Entity}> {
    return this.repository.insert(dto as Partial<${Entity}>);
  }

  async findById(id: string): Promise<${Entity}> {
    const row = await this.repository.findById(id);
    if (!row) throw new Error(\`${Entity} \${id} not found\`);
    return row;
  }

  async list(): Promise<${Entity}[]> {
    return this.repository.findAll();
  }
${methods}
}
`;
}

function controllerFile(m) {
  const Entity = m.entity;
  const cls = `${pascal(m.slug)}Controller`;
  const svcCls = `${pascal(m.slug)}Service`;
  const svcVar = camel(m.slug) + 'Service';
  const routeMethods = m.specialMethods
    .map(
      (fn) => `
  async ${fn.name}Route(req: { params: { id?: string }; body: unknown }) {
    return this.${svcVar}.${fn.name}(req.params.id as string, req.body as never);
  }`
    )
    .join('\n');

  return `import { ${svcCls} } from './${m.slug}.service';
import type { ${m.createDto.name} } from './dto/${dtoFile(m.slug, m.createDto).path.split('/').pop().replace('.dto.ts', '')}.dto';

/** HTTP entry points for the ${pascal(m.slug)} module, mounted at /${m.slug}. */
export class ${cls} {
  constructor(private readonly ${svcVar}: ${svcCls}) {}

  async create(req: { body: ${m.createDto.name} }) {
    return this.${svcVar}.create(req.body);
  }

  async findOne(req: { params: { id: string } }) {
    return this.${svcVar}.findById(req.params.id);
  }

  async findAll() {
    return this.${svcVar}.list();
  }
${routeMethods}
}
`;
}

function moduleFile(m) {
  const cls = `${pascal(m.slug)}Module`;
  return `import { ${pascal(m.slug)}Controller } from './${m.slug}.controller';
import { ${pascal(m.slug)}Service } from './${m.slug}.service';
import { ${pascal(m.slug)}Repository } from './${m.slug}.repository';

/** Wires the ${pascal(m.slug)} controller/service/repository together for the app module. */
export class ${cls} {
  readonly repository = new ${pascal(m.slug)}Repository();
  readonly service = new ${pascal(m.slug)}Service(this.repository);
  readonly controller = new ${pascal(m.slug)}Controller(this.service);
}
`;
}

function commonFiles() {
  return [
    {
      path: 'src/common/errors.ts',
      content: `export class NotFoundError extends Error {}\nexport class ValidationError extends Error {}\nexport class UnauthorizedError extends Error {}\n`,
    },
    {
      path: 'src/common/pagination.ts',
      content: `export interface PageRequest {\n  page: number;\n  pageSize: number;\n}\n\nexport function paginate<T>(items: T[], { page, pageSize }: PageRequest): T[] {\n  const start = (page - 1) * pageSize;\n  return items.slice(start, start + pageSize);\n}\n`,
    },
    {
      path: 'src/common/validation.ts',
      content: `export function isEmail(value: string): boolean {\n  return /.+@.+\\..+/.test(value);\n}\n\nexport function assertRequired<T>(value: T | undefined | null, field: string): T {\n  if (value === undefined || value === null) throw new Error(\`Missing required field: \${field}\`);\n  return value;\n}\n`,
    },
    {
      path: 'src/common/http-exception.filter.ts',
      content: `import { NotFoundError, ValidationError, UnauthorizedError } from './errors';\n\n/** Maps domain errors to HTTP status codes for the API's global error handler. */\nexport function mapErrorToStatus(error: unknown): number {\n  if (error instanceof NotFoundError) return 404;\n  if (error instanceof ValidationError) return 400;\n  if (error instanceof UnauthorizedError) return 401;\n  return 500;\n}\n`,
    },
    {
      path: 'src/common/logger.ts',
      content: `export function createModuleLogger(scope: string) {\n  return {\n    info: (msg: string) => console.log(\`[\${scope}] \${msg}\`),\n    error: (msg: string) => console.error(\`[\${scope}] \${msg}\`),\n  };\n}\n`,
    },
  ];
}

function rootFiles() {
  const imports = MODULES.map((m) => `import { ${pascal(m.slug)}Module } from './modules/${m.slug}/${m.slug}.module';`).join('\n');
  const fields = MODULES.map((m) => `  readonly ${camel(m.slug)} = new ${pascal(m.slug)}Module();`).join('\n');

  return [
    {
      path: 'src/app.module.ts',
      content: `${imports}\n\n/** Root application module composing every domain module for the SaaS API. */\nexport class AppModule {\n${fields}\n}\n`,
    },
    {
      path: 'src/main.ts',
      content: `import { AppModule } from './app.module';\n\nasync function bootstrap() {\n  const app = new AppModule();\n  const port = process.env.PORT ?? 3000;\n  console.log(\`SaaS API listening on port \${port} with \${Object.keys(app).length} modules mounted\`);\n}\n\nbootstrap();\n`,
    },
    {
      path: 'package.json',
      content: JSON.stringify(
        {
          name: 'saas-api',
          version: '1.0.0',
          private: true,
          description: 'Synthetic modular SaaS API fixture used for retrieval benchmarking',
          scripts: { build: 'tsc -p tsconfig.json', start: 'node dist/main.js' },
          dependencies: {},
          devDependencies: { typescript: '^5.4.0' },
        },
        null,
        2
      ) + '\n',
    },
    {
      path: 'tsconfig.json',
      content: JSON.stringify(
        {
          compilerOptions: {
            target: 'ES2020',
            module: 'commonjs',
            outDir: 'dist',
            strict: true,
            esModuleInterop: true,
            skipLibCheck: true,
          },
          include: ['src/**/*'],
        },
        null,
        2
      ) + '\n',
    },
    {
      path: 'README.md',
      content: `# SaaS API (retrieval benchmark fixture)\n\nA synthetic, modular TypeScript API used only for retrieval evaluation (see \`tools/benchmark/datasets/retrieval-eval.json\`). It is not meant to run or ship — it exists to give \`HybridRetriever\` a codebase large and repetitive enough (${MODULES.length} domain modules, each with a controller/service/repository/DTOs) that keyword and file-name collisions actually matter.\n\n## Modules\n\n${MODULES.map((m) => `- \`src/modules/${m.slug}/\` — ${m.entity}`).join('\n')}\n`,
    },
  ];
}

function writeFile(relPath, content) {
  const abs = join(FIXTURE_ROOT, relPath);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content, 'utf-8');
}

function main() {
  if (existsSync(FIXTURE_ROOT)) {
    rmSync(FIXTURE_ROOT, { recursive: true, force: true });
  }
  mkdirSync(FIXTURE_ROOT, { recursive: true });

  let fileCount = 0;

  for (const m of MODULES) {
    writeFile(`src/modules/${m.slug}/${m.slug}.controller.ts`, controllerFile(m));
    writeFile(`src/modules/${m.slug}/${m.slug}.service.ts`, serviceFile(m));
    writeFile(`src/modules/${m.slug}/${m.slug}.repository.ts`, repositoryFile(m));
    writeFile(`src/modules/${m.slug}/${m.slug}.module.ts`, moduleFile(m));
    const createDto = dtoFile(m.slug, m.createDto);
    const secondaryDto = dtoFile(m.slug, m.secondaryDto);
    writeFile(createDto.path, createDto.content);
    writeFile(secondaryDto.path, secondaryDto.content);
    fileCount += 6;
  }

  for (const f of commonFiles()) {
    writeFile(f.path, f.content);
    fileCount += 1;
  }

  for (const f of rootFiles()) {
    writeFile(f.path, f.content);
    fileCount += 1;
  }

  console.log(`Generated ${fileCount} files across ${MODULES.length} modules at ${FIXTURE_ROOT}`);
}

main();
