import type { Order } from '../../types/domain.js';

export interface LedgeResponseDto {
  id: string;
  total: number;
}

export function toLedgeResponseDto(order: Order): LedgeResponseDto {
  return { id: order.id, total: order.total };
}
