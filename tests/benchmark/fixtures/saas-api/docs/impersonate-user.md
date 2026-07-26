# Impersonate User

## Overview

The `impersonateUser` method in `AdminService` (`src/modules/admin/admin.service.ts`) allows a support administrator to act as another user for debugging purposes. It is exposed through `AdminController.impersonateUserRoute()` at the `/admin` mount point.

### DTO Shape

```typescript
// src/modules/admin/dto/impersonate-user.dto.ts
export interface ImpersonateUserDto {
  targetUserId: string;
}
```

## Current (Authenticated) Behavior

When called, `impersonateUser` performs two privileged operations:

1. **Audit logging** — Records who impersonated whom via `auditLogService.recordAuditEntry()`.
2. **Token generation** — Issues a short-lived JWT access token for the target user via `authService.generateAccessToken()`.

```typescript
// src/modules/admin/admin.service.ts (current)
async impersonateUser(adminId: string, dto: ImpersonateUserDto): Promise<string> {
  await this.auditLogService.recordAuditEntry({
    actorId: adminId,
    action: 'impersonate',
    targetId: dto.targetUserId,
  });
  return this.authService.generateAccessToken(dto.targetUserId);
}
```

| Step | Service Called | Purpose |
| --- | --- | --- |
| 1 | `auditLogService.recordAuditEntry()` | Creates an immutable audit trail entry recording the impersonation event. |
| 2 | `authService.generateAccessToken()` | Mints a JWT bound to `targetUserId` so the admin can make authenticated requests as that user. |

The method returns a `Promise<string>` — the raw JWT token ready for use in an `Authorization: Bearer …` header.

## Hypothetical No-Auth Behavior

In a hypothetical no-auth version, the method would skip both audit logging and token generation. Instead it would return a plain acknowledgment string confirming the impersonation intent without producing any credential.

```typescript
// src/modules/admin/admin.service.ts (hypothetical no-auth)
/**
 * Hypothetical: skips audit log and JWT generation.
 * Returns a plain acknowledgment string instead of a credential.
 */
async impersonateUser(adminId: string, dto: ImpersonateUserDto): Promise<string> {
  return `impersonation-ok:${dto.targetUserId}`;
}
```

### Comparison

| Aspect | Current (authenticated) | Hypothetical (no-auth) |
| --- | --- | --- |
| Audit log written | Yes (`auditLogService`) | No |
| JWT token issued | Yes (`authService`) | No |
| Return value | JWT string | Plain acknowledgment string |
| Downstream auth required | Yes — caller must present the token | No — no credential produced |
| Security risk | Low — audited + scoped token | High — no trail, no credential scope |

## Security Notes

- The current implementation is auditable because every impersonation event is logged before a token is issued.
- The hypothetical no-auth version removes both the audit trail and the scoped credential. It should **never** be used in production environments where accountability or least-privilege access matters.
- If a no-auth variant is needed for testing, isolate it behind a feature flag or a dedicated test-only service class so that it cannot accidentally replace the production path.
