import type { Order } from '../../types/domain.js';
import { formatCurrency } from '../../utils/currency.js';
import { saveSubscriptionsRecord, listSubscriptionsRecords } from './repository.js';

export function createSubscriptionsEntry(customerId: string, total: number): Order {
  const id = `subscriptions-${Date.now()}`;
  return saveSubscriptionsRecord(id, customerId, total);
}

export function totalSubscriptionsAmount(): number {
  return listSubscriptionsRecords().reduce((sum, order) => sum + order.total, 0);
}

export function describeSubscriptions(order: Order): string {
  return `${order.id}: ${formatCurrency(order.total)}`;
}
