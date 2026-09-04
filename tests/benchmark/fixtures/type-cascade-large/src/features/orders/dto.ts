import type { Order } from '../../types/domain.js';

export interface OrdersResponseDto {
  id: string;
  total: number;
}

export function toOrdersResponseDto(order: Order): OrdersResponseDto {
  return { id: order.id, total: order.total };
}
