import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ trustProxy: true }),
  );
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
