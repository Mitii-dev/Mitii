export interface CreateOrderDto {
  customerId: string;
  total: number;
}

export function validateCreateOrderDto(dto: CreateOrderDto): boolean {
  return typeof dto.customerId === 'string' && dto.total >= 0;
}
