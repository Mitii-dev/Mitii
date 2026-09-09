import type { Order } from '../../types/domain.js';

export interface SubscriptionsResponseDto {
  id: string;
  total: number;
}

export function toSubscriptionsResponseDto(order: Order): SubscriptionsResponseDto {
  return { id: order.id, total: order.total };
}
