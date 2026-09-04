import type { Order } from '../../types/domain.js';

const exportsStore = new Map<string, Order>();

export function saveExportsRecord(id: string, customerId: string, total: number): Order {
  const order: Order = { id, customerId, total, createdAt: new Date().toISOString() };
  exportsStore.set(id, order);
  return order;
}

export function listExportsRecords(): Order[] {
  return [...exportsStore.values()];
}
