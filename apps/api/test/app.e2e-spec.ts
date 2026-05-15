import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import type { FastifyInstance } from 'fastify';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/common/prisma/prisma.service';

describe('App (e2e)', () => {
  let app: INestApplication;

  const prismaMock = {
    onModuleInit: () => Promise.resolve(),
    onModuleDestroy: () => Promise.resolve(),
  };

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prismaMock)
      .compile();

    app = moduleFixture.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    await app.init();
  });

  it('GET /', async () => {
    const instance: FastifyInstance = app
      .getHttpAdapter()
      .getInstance() as FastifyInstance;
    const res = await instance.inject({ method: 'GET', url: '/' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({
      name: 'aptos-translate-api',
      version: '0.0.1',
    });
  });

  afterEach(async () => {
    await app.close();
  });
});
