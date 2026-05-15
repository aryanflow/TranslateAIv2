import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';

describe('AppController', () => {
  let app: AppController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
    }).compile();

    app = module.get<AppController>(AppController);
  });

  it('root returns api metadata', () => {
    expect(app.root()).toEqual({
      name: 'aptos-translate-api',
      version: '0.0.1',
    });
  });
});
