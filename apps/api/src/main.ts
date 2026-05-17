import { ValidationPipe } from '@nestjs/common';
import { NestFactory, HttpAdapterHost } from '@nestjs/core';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';

async function bootstrap() {
  const adapter = new FastifyAdapter({ trustProxy: true });
  const fastify = adapter.getInstance();
  /** Fastify rejects `Content-Type: application/json` with an empty body before Nest runs. */
  fastify.addHook('onRequest', async (req) => {
    const m = req.method;
    if (m !== 'POST' && m !== 'PUT' && m !== 'PATCH' && m !== 'DELETE') return;
    const rawCt = req.headers['content-type'];
    const ct = Array.isArray(rawCt) ? rawCt[0] : rawCt;
    if (!ct || !String(ct).toLowerCase().includes('application/json')) return;

    const path = (req.url ?? '').split('?')[0] ?? '';
    if (m === 'POST' && /\/jobs\/[^/]+\/cancel$/.test(path)) {
      delete req.headers['content-type'];
      return;
    }

    const rawLen = req.headers['content-length'];
    const lenStr = Array.isArray(rawLen) ? rawLen[0] : rawLen;
    const len = lenStr != null ? Number.parseInt(String(lenStr), 10) : NaN;
    if (len === 0) {
      delete req.headers['content-type'];
    }
  });

  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter);
  const httpAdapterHost = app.get(HttpAdapterHost);
  app.useGlobalFilters(new GlobalExceptionFilter(httpAdapterHost));
  app.enableCors({ origin: true, credentials: true });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: false,
      transform: true,
    }),
  );
  const config = new DocumentBuilder()
    .setTitle('Aptos Translate API')
    .setDescription(
      'OpenAPI for openapi-typescript + openapi-fetch on the web app.',
    )
    .setVersion('0.0.1')
    .addApiKey(
      {
        type: 'apiKey',
        in: 'header',
        name: 'X-Tenant-Id',
        description: 'Tenant scope (dev header)',
      },
      'tenant-id',
    )
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);
  const port = Number(process.env.PORT ?? 3001);
  await app.listen({ port, host: '0.0.0.0' });
}

bootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});
