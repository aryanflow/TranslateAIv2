import { Module } from '@nestjs/common';
import { ExtractorsService } from './extractors.service';

@Module({
  providers: [ExtractorsService],
  exports: [ExtractorsService],
})
export class ExtractorsModule {}
