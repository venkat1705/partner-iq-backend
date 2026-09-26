import { IsArray, IsBoolean, IsEnum, IsNumber, IsOptional, IsString } from 'class-validator';

export class TriggerSyncDto {
  @IsOptional()
  @IsString()
  entityType?: string;

  @IsOptional()
  @IsString()
  direction?: 'INBOUND' | 'OUTBOUND';

  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;
}

export class RetryOperationDto {
  @IsString()
  operationId!: string;

  @IsEnum(['SYNC', 'EVENT'])
  operationType!: 'SYNC' | 'EVENT';
}

export class FieldMappingItemDto {
  @IsString()
  partnerIqField!: string;

  @IsString()
  externalField!: string;

  @IsOptional()
  @IsBoolean()
  required?: boolean;

  @IsOptional()
  @IsString()
  transformation?: string;
}

export class UpdateFieldMappingsDto {
  @IsArray()
  mappings!: FieldMappingItemDto[];
}

export class UpdateConnectionStatusDto {
  @IsEnum(['CONNECTED', 'PAUSED', 'DISCONNECTED'])
  status!: 'CONNECTED' | 'PAUSED' | 'DISCONNECTED';
}

