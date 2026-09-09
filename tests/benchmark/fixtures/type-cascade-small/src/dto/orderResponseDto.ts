import type { Order } from '../types/domain.js';

export interface OrderResponseDto {
  id: string;
  total: number;
}

export function toOrderResponseDto(order: Order): OrderResponseDto {
  return { id: order.id, total: order.total };
}
