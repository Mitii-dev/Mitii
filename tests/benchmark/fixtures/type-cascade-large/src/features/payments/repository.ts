import type { Order } from '../../types/domain.js';

const paymentsStore = new Map<string, Order>();

export function savePaymentsRecord(id: string, customerId: string, total: number): Order {
  const order: Order = { id, customerId, total, createdAt: new Date().toISOString() };
  paymentsStore.set(id, order);
  return order;
}

export function listPaymentsRecords(): Order[] {
  return [...paymentsStore.values()];
}
