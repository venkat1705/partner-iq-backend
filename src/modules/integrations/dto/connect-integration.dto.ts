import { IsIn, IsObject, IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ConnectIntegrationDto {
  @ApiPropertyOptional({ example: 'pat-na1-12345678-...' })
  @IsOptional()
  @IsString()
  privateAppToken?: string;

  @ApiPropertyOptional({ example: 'rzp_test_1234567890' })
  @IsOptional()
  @IsString()
  keyId?: string;

  @ApiPropertyOptional({ example: 'a1b2c3d4e5f6g7h8i9j0' })
  @IsOptional()
  @IsString()
  keySecret?: string;

  @ApiPropertyOptional({ example: 'cf_app_123456' })
  @IsOptional()
  @IsString()
  appId?: string;

  @ApiPropertyOptional({ example: 'cf_secret_7890' })
  @IsOptional()
  @IsString()
  secretKey?: string;

  @ApiPropertyOptional({ example: 'api_key_or_token' })
  @IsOptional()
  @IsString()
  apiKey?: string;

  @ApiPropertyOptional({ example: 'api_secret' })
  @IsOptional()
  @IsString()
  apiSecret?: string;

  @ApiPropertyOptional({ enum: ['TEST', 'LIVE'], example: 'TEST' })
  @IsOptional()
  @IsIn(['TEST', 'LIVE'])
  environment?: 'TEST' | 'LIVE';

  @ApiPropertyOptional({ description: 'Optional dynamic credentials key-value dictionary' })
  @IsOptional()
  @IsObject()
  credentials?: Record<string, string>;

  @ApiPropertyOptional({ description: 'Webhook signing secret from the provider dashboard' })
  @IsOptional()
  @IsString()
  webhookSecret?: string;
}

export class TestIntegrationDto {
  @ApiPropertyOptional({ example: 'pat-na1-12345678-...' })
  @IsOptional()
  @IsString()
  privateAppToken?: string;

  @ApiPropertyOptional({ example: 'rzp_test_1234567890' })
  @IsOptional()
  @IsString()
  keyId?: string;

  @ApiPropertyOptional({ example: 'a1b2c3d4e5f6g7h8i9j0' })
  @IsOptional()
  @IsString()
  keySecret?: string;

  @ApiPropertyOptional({ example: 'cf_app_123456' })
  @IsOptional()
  @IsString()
  appId?: string;

  @ApiPropertyOptional({ example: 'cf_secret_7890' })
  @IsOptional()
  @IsString()
  secretKey?: string;

  @ApiPropertyOptional({ example: 'api_key_or_token' })
  @IsOptional()
  @IsString()
  apiKey?: string;

  @ApiPropertyOptional({ example: 'api_secret' })
  @IsOptional()
  @IsString()
  apiSecret?: string;

  @ApiPropertyOptional({ enum: ['TEST', 'LIVE'], example: 'TEST' })
  @IsOptional()
  @IsIn(['TEST', 'LIVE'])
  environment?: 'TEST' | 'LIVE';

  @ApiPropertyOptional({ description: 'Optional dynamic credentials key-value dictionary' })
  @IsOptional()
  @IsObject()
  credentials?: Record<string, string>;
}

// Keep backward compatibility
export class ConnectApiKeyIntegrationDto extends ConnectIntegrationDto { }
