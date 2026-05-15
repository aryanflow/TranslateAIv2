import {
  type ArgumentMetadata,
  type PipeTransform,
  Injectable,
} from '@nestjs/common';

@Injectable()
export class DefaultPagePipe implements PipeTransform<
  string | undefined,
  number
> {
  transform(value: string | undefined, metadata: ArgumentMetadata): number {
    void metadata;
    const n = value != null && value.length ? Number(value) : 1;
    if (!Number.isFinite(n) || n < 1) {
      return 1;
    }
    if (n > 10_000) {
      return 10_000;
    }
    return Math.floor(n);
  }
}
