import type { Order } from '../../types/domain.js';
import { formatCurrency } from '../../utils/currency.js';
import { saveExportsRecord, listExportsRecords } from './repository.js';

export function createExportsEntry(customerId: string, total: number): Order {
  const id = `exports-${Date.now()}`;
  return saveExportsRecord(id, customerId, total);
}

export function totalExportsAmount(): number {
  return listExportsRecords().reduce((sum, order) => sum + order.total, 0);
}

export function describeExports(order: Order): string {
  return `${order.id}: ${formatCurrency(order.total)}`;
}
