import type { Order } from '../../types/domain.js';
import { processCustomers } from './service.js';
import { toCustomersEventDto, type CustomersEventDto } from './dto.js';

export function handleCustomersEvent(order: Order): CustomersEventDto {
  processCustomers(order);
  return toCustomersEventDto(order);
}
