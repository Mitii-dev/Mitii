import type { Order } from '../../types/domain.js';

const notificationsLog = new Map<string, Order>();

export function recordNotificationsEvent(orderId: string, order: Order): void {
  notificationsLog.set(orderId, order);
}

export function getNotificationsEvent(orderId: string): Order | undefined {
  return notificationsLog.get(orderId);
}
