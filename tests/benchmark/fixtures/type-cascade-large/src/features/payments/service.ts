import type { Order } from '../../types/domain.js';
import { formatCurrency } from '../../utils/currency.js';
import { savePaymentsRecord, listPaymentsRecords } from './repository.js';

export function createPaymentsEntry(customerId: string, total: number): Order {
  const id = `payments-${Date.now()}`;
  return savePaymentsRecord(id, customerId, total);
}

export function totalPaymentsAmount(): number {
  return listPaymentsRecords().reduce((sum, order) => sum + order.total, 0);
}

export function describePayments(order: Order): string {
  return `${order.id}: ${formatCurrency(order.total)}`;
}
