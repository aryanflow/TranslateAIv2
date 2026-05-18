import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory, HttpAdapterHost } from '@nestjs/core';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';

/** OpenAPI UI + raw spec. Off in production unless `SWAGGER_ENABLED=true`. */
function isSwaggerEnabled(): boolean {
  const v = process.env.SWAGGER_ENABLED?.trim().toLowerCase();
  if (v === 'true' || v === '1' || v === 'yes') return true;
  if (v === 'false' || v === '0' || v === 'no') return false;
  return process.env.NODE_ENV !== 'production';
}

async function bootstrap() {
  const logger = new Logger('Bootstrap');
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
  const port = Number(process.env.PORT ?? 3001);

  if (isSwaggerEnabled()) {
    const config = new DocumentBuilder()
      .setTitle('Aptos Translate API')
      .setDescription(
        'REST surface for jobs, files, glossary, prompts, and health. Raw JSON: GET /api/openapi.json',
      )
      .setVersion('0.0.1')
      .addServer(`http://127.0.0.1:${port}`, 'Local (127.0.0.1)')
      .addServer(`http://localhost:${port}`, 'Local (localhost)')
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
    SwaggerModule.setup('api/docs', app, document, {
      jsonDocumentUrl: 'api/openapi.json',
      yamlDocumentUrl: 'api/openapi.yaml',
      explorer: true,
      customSiteTitle: 'Aptos Translate API — Swagger',
      swaggerOptions: {
        persistAuthorization: true,
      },
    });
    logger.log(`OpenAPI: UI /api/docs — spec /api/openapi.json`);
  } else {
    logger.log(
      'OpenAPI/Swagger disabled (set SWAGGER_ENABLED=true to enable in production)',
    );
  }

  await app.listen({ port, host: '0.0.0.0' });
}

bootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});
