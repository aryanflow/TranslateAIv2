import {
  BadRequestException,
  createParamDecorator,
  type ExecutionContext,
} from '@nestjs/common';

type ReqWithTenant = { tenantId?: string };

/**
 * Injected after `TenantGuard` sets `X-Tenant-Id` on the request.
 */
export const TenantId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const req = ctx.switchToHttp().getRequest<ReqWithTenant>();
    if (!req.tenantId) {
      throw new BadRequestException('Missing tenant context (use TenantGuard)');
    }
    return req.tenantId;
  },
);
