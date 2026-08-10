import { IsString, IsArray, IsEnum, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateApiKeyDto {
  @ApiProperty({ example: 'Production Node.js Backend Key' })
  @IsString()
  name!: string;

  @ApiProperty({ example: ['conversions:write', 'conversions:read'] })
  @IsArray()
  @IsString({ each: true })
  scopes!: string[];

  @ApiPropertyOptional({ enum: ['live', 'test'], example: 'live' })
  @IsOptional()
  @IsEnum(['live', 'test'])
  environment?: 'live' | 'test';
}
