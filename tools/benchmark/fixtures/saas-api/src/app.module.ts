import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { ProductsModule } from './modules/products/products.module';
import { OrdersModule } from './modules/orders/orders.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { CartModule } from './modules/cart/cart.module';
import { ShippingModule } from './modules/shipping/shipping.module';
import { ReviewsModule } from './modules/reviews/reviews.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { SubscriptionsModule } from './modules/subscriptions/subscriptions.module';
import { SupportTicketsModule } from './modules/support-tickets/support-tickets.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';
import { AdminModule } from './modules/admin/admin.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { SearchModule } from './modules/search/search.module';
import { AuditLogModule } from './modules/audit-log/audit-log.module';

/** Root application module composing every domain module for the SaaS API. */
export class AppModule {
  readonly auth = new AuthModule();
  readonly users = new UsersModule();
  readonly products = new ProductsModule();
  readonly orders = new OrdersModule();
  readonly payments = new PaymentsModule();
  readonly inventory = new InventoryModule();
  readonly cart = new CartModule();
  readonly shipping = new ShippingModule();
  readonly reviews = new ReviewsModule();
  readonly notifications = new NotificationsModule();
  readonly subscriptions = new SubscriptionsModule();
  readonly supportTickets = new SupportTicketsModule();
  readonly webhooks = new WebhooksModule();
  readonly admin = new AdminModule();
  readonly analytics = new AnalyticsModule();
  readonly search = new SearchModule();
  readonly auditLog = new AuditLogModule();
}
