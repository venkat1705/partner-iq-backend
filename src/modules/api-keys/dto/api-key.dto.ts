import { IsString, IsArray, IsEnum, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export const API_KEY_SCOPES = [
  'programs:read',
  'affiliates:read',
  'affiliates:write',
  'tracking_links:read',
  'tracking_links:write',
  'customers:write',
  'attributions:write',
  'conversions:read',
  'conversions:write',
  'refunds:write',
  'webhooks:read',
  'webhooks:write',
] as const;

export const API_KEY_SCOPE_PRESETS = {
  READ_ONLY: ['programs:read', 'affiliates:read', 'tracking_links:read', 'conversions:read', 'webhooks:read'],
  CONVERSION_TRACKING: ['customers:write', 'attributions:write', 'conversions:write', 'refunds:write'],
  FULL_SERVER_INTEGRATION: [...API_KEY_SCOPES],
} as const;

export class CreateApiKeyDto {
  @ApiProperty({ example: 'Production Node.js Backend Key' })
  @IsString()
  name!: string;

  @ApiProperty({ example: ['conversions:write', 'conversions:read'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  scopes?: string[];

  @ApiPropertyOptional({ enum: Object.keys(API_KEY_SCOPE_PRESETS), example: 'CONVERSION_TRACKING' })
  @IsOptional()
  @IsEnum(Object.keys(API_KEY_SCOPE_PRESETS))
  preset?: keyof typeof API_KEY_SCOPE_PRESETS;

  @ApiPropertyOptional({ enum: ['live', 'test'], example: 'live' })
  @IsOptional()
  @IsEnum(['live', 'test'])
  environment?: 'live' | 'test';
}
