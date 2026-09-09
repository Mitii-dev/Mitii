import type { Order } from '../../types/domain.js';
import { formatCurrency } from '../../utils/currency.js';
import { saveRefundsRecord, listRefundsRecords } from './repository.js';

export function createRefundsEntry(customerId: string, total: number): Order {
  const id = `refunds-${Date.now()}`;
  return saveRefundsRecord(id, customerId, total);
}

export function totalRefundsAmount(): number {
  return listRefundsRecords().reduce((sum, order) => sum + order.total, 0);
}

export function describeRefunds(order: Order): string {
  return `${order.id}: ${formatCurrency(order.total)}`;
}
