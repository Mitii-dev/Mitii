import type { Order } from '../../types/domain.js';

const ledgerStore = new Map<string, Order>();

export function saveLedgeRecord(id: string, customerId: string, total: number): Order {
  const order: Order = { id, customerId, total, createdAt: new Date().toISOString() };
  ledgerStore.set(id, order);
  return order;
}

export function listLedgeRecords(): Order[] {
  return [...ledgerStore.values()];
}
