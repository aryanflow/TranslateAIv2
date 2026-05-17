import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';

/**
 * Prototype: requires `X-Tenant-Id`, or `tenantId` query (for SSE/EventSource).
 * Multi-tenant queries use `req.tenantId` in services.
 */
@Injectable()
export class TenantGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<
      {
        headers: Record<string, string | string[] | undefined>;
        query?: Record<string, string | string[] | undefined>;
      } & {
        tenantId?: string;
      }
    >();
    const rawHeader = req.headers['x-tenant-id'];
    const headerVal = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
    const rawQ = req.query?.['tenantId'];
    const qVal = Array.isArray(rawQ) ? rawQ[0] : rawQ;
    const value = headerVal ?? qVal;
    if (!value || !value.length) {
      throw new UnauthorizedException('Missing X-Tenant-Id');
    }
    req.tenantId = value;
    return true;
  }
}
