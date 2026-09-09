import type { Order } from '../../types/domain.js';

const invoicesStore = new Map<string, Order>();

export function saveInvoicesRecord(id: string, customerId: string, total: number): Order {
  const order: Order = { id, customerId, total, createdAt: new Date().toISOString() };
  invoicesStore.set(id, order);
  return order;
}

export function listInvoicesRecords(): Order[] {
  return [...invoicesStore.values()];
}
