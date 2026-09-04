import type { Order } from '../../types/domain.js';
import { formatCurrency } from '../../utils/currency.js';
import { saveInvoicesRecord, listInvoicesRecords } from './repository.js';

export function createInvoicesEntry(customerId: string, total: number): Order {
  const id = `invoices-${Date.now()}`;
  return saveInvoicesRecord(id, customerId, total);
}

export function totalInvoicesAmount(): number {
  return listInvoicesRecords().reduce((sum, order) => sum + order.total, 0);
}

export function describeInvoices(order: Order): string {
  return `${order.id}: ${formatCurrency(order.total)}`;
}
