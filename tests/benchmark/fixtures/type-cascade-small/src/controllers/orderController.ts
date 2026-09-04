import { placeOrder } from '../services/orderService.js';
import { toOrderResponseDto, type OrderResponseDto } from '../dto/orderResponseDto.js';
import type { CreateOrderDto } from '../dto/createOrderDto.js';

export function handleCreateOrder(dto: CreateOrderDto): OrderResponseDto {
  const order = placeOrder(dto.customerId, dto.total);
  return toOrderResponseDto(order);
}
