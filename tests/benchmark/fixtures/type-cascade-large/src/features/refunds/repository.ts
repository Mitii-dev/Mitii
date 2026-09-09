import type { Order } from '../../types/domain.js';

const refundsStore = new Map<string, Order>();

export function saveRefundsRecord(id: string, customerId: string, total: number): Order {
  const order: Order = { id, customerId, total, createdAt: new Date().toISOString() };
  refundsStore.set(id, order);
  return order;
}

export function listRefundsRecords(): Order[] {
  return [...refundsStore.values()];
}
