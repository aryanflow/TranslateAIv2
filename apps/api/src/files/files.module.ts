import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ExtractorsModule } from '../extractors/extractors.module';
import { FilesController } from './files.controller';
import { FilesService } from './files.service';

@Module({
  imports: [ConfigModule, ExtractorsModule],
  controllers: [FilesController],
  providers: [FilesService],
  exports: [FilesService],
})
export class FilesModule {}
