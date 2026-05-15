import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { type Observable } from 'rxjs';

type Req = {
  headers: Record<string, string | string[] | undefined>;
  tenantId?: string;
};

/**
 * Normalizes `X-Tenant-Id` into `req.tenantId` (non-throwing; pair with `TenantGuard` to enforce).
 * Useful for public routes that still want tenant scoping, or to log tenant early.
 * @see docs/ARCHITECTURE.md — "TenantGuard, extract-tenant interceptor"
 */
@Injectable()
export class ExtractTenantInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest<Req>();
    const raw = req.headers['x-tenant-id'];
    const v = Array.isArray(raw) ? raw[0] : raw;
    if (v && v.length) {
      req.tenantId = v;
    }
    return next.handle();
  }
}
