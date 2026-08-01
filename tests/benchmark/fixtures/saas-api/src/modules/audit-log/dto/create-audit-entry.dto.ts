export interface CreateAuditEntryDto {
  actorId: string;
  action: string;
  targetId: string;
}
