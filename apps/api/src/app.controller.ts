import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

@ApiTags('meta')
@Controller()
export class AppController {
  @Get()
  @ApiOperation({ summary: 'API root' })
  root() {
    return { name: 'aptos-translate-api', version: '0.0.1' };
  }
}
