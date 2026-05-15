import { Module } from '@nestjs/common';
import { RegeneratorsService } from './regenerators.service';

@Module({
  providers: [RegeneratorsService],
  exports: [RegeneratorsService],
})
export class RegeneratorsModule {}
