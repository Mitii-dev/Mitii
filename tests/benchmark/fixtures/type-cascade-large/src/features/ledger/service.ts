import type { Order } from '../../types/domain.js';
import { formatCurrency } from '../../utils/currency.js';
import { saveLedgeRecord, listLedgeRecords } from './repository.js';

export function createLedgeEntry(customerId: string, total: number): Order {
  const id = `ledger-${Date.now()}`;
  return saveLedgeRecord(id, customerId, total);
}

export function totalLedgeAmount(): number {
  return listLedgeRecords().reduce((sum, order) => sum + order.total, 0);
}

export function describeLedge(order: Order): string {
  return `${order.id}: ${formatCurrency(order.total)}`;
}
