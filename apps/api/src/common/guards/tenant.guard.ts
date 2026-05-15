import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';

/**
 * Prototype: requires `X-Tenant-Id` (wire to Auth.js / JWT + membership later).
 * Multi-tenant queries use `req.tenantId` in services.
 */
@Injectable()
export class TenantGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<
      { headers: Record<string, string | string[] | undefined> } & {
        tenantId?: string;
      }
    >();
    const raw = req.headers['x-tenant-id'];
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (!value || !value.length) {
      throw new UnauthorizedException('Missing X-Tenant-Id');
    }
    req.tenantId = value;
    return true;
  }
}
