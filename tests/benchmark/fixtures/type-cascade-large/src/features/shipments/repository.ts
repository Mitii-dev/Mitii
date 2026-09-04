import type { Order } from '../../types/domain.js';

const shipmentsLog = new Map<string, Order>();

export function recordShipmentsEvent(orderId: string, order: Order): void {
  shipmentsLog.set(orderId, order);
}

export function getShipmentsEvent(orderId: string): Order | undefined {
  return shipmentsLog.get(orderId);
}
