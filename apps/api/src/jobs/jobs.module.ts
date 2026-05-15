import { Module } from '@nestjs/common';
import { JobsController } from './jobs.controller';
import { JobsService } from './jobs.service';
import {
  TranslateQueueService,
  TranslateWorkerService,
} from './translate-queue.service';
import { TranslationModule } from '../translation/translation.module';
import { JobEventsModule } from '../common/job-events/job-events.module';

@Module({
  imports: [TranslationModule, JobEventsModule],
  controllers: [JobsController],
  providers: [JobsService, TranslateQueueService, TranslateWorkerService],
  exports: [JobsService, TranslateQueueService],
})
export class JobsModule {}
