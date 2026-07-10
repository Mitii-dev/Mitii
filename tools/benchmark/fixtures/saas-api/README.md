# SaaS API (retrieval benchmark fixture)

A synthetic, modular TypeScript API used only for retrieval evaluation (see `tools/benchmark/datasets/retrieval-eval.json`). It is not meant to run or ship — it exists to give `HybridRetriever` a codebase large and repetitive enough (17 domain modules, each with a controller/service/repository/DTOs) that keyword and file-name collisions actually matter.

## Modules

- `src/modules/auth/` — User
- `src/modules/users/` — User
- `src/modules/products/` — Product
- `src/modules/orders/` — Order
- `src/modules/payments/` — Payment
- `src/modules/inventory/` — StockItem
- `src/modules/cart/` — Cart
- `src/modules/shipping/` — Shipment
- `src/modules/reviews/` — Review
- `src/modules/notifications/` — Notification
- `src/modules/subscriptions/` — Subscription
- `src/modules/support-tickets/` — SupportTicket
- `src/modules/webhooks/` — WebhookEndpoint
- `src/modules/admin/` — AdminAction
- `src/modules/analytics/` — AnalyticsEvent
- `src/modules/search/` — SearchDocument
- `src/modules/audit-log/` — AuditEntry
