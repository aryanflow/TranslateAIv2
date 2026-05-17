import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';

/**
 * Ensures unhandled errors return JSON with a readable `message` (not an empty 500 body).
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  constructor(private readonly httpAdapterHost: HttpAdapterHost) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const { httpAdapter } = this.httpAdapterHost;
    const ctx = host.switchToHttp();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      httpAdapter.reply(ctx.getResponse(), body, status);
      return;
    }

    const msg =
      exception instanceof Error ? exception.message : String(exception);
    this.logger.error(msg, exception instanceof Error ? exception.stack : undefined);

    httpAdapter.reply(
      ctx.getResponse(),
      {
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: msg,
        error: 'Internal Server Error',
      },
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }
}
