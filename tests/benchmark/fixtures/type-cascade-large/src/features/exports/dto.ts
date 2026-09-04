import type { Order } from '../../types/domain.js';

export interface ExportsResponseDto {
  id: string;
  total: number;
}

export function toExportsResponseDto(order: Order): ExportsResponseDto {
  return { id: order.id, total: order.total };
}
