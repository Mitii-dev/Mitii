import type { Order } from '../../types/domain.js';
import { formatCurrency } from '../../utils/currency.js';
import { saveOrdersRecord, listOrdersRecords } from './repository.js';

export function createOrdersEntry(customerId: string, total: number): Order {
  const id = `orders-${Date.now()}`;
  return saveOrdersRecord(id, customerId, total);
}

export function totalOrdersAmount(): number {
  return listOrdersRecords().reduce((sum, order) => sum + order.total, 0);
}

export function describeOrders(order: Order): string {
  return `${order.id}: ${formatCurrency(order.total)}`;
}
