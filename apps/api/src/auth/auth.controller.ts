import { Body, Controller, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, MinLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

class GoogleCallbackBodyDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  idToken?: string;
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  @Post('google/callback')
  @ApiOperation({
    summary: 'Google OAuth (Auth.js) — wire Passport JWT in a later slice',
  })
  postGoogleCallback(@Body() body: GoogleCallbackBodyDto) {
    void body;
    // Stub: return shape expected by the web client. Replace with real OAuth + user→tenant map.
    return {
      accessToken: 'stub-access-token',
      tenantId: '00000000-0000-0000-0000-000000000000',
    };
  }
}
