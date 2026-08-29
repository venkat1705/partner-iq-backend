import { IsArray, IsIn, IsOptional, IsString, IsUrl } from 'class-validator';
import { IntegrationEnvironment } from '../../../../common/enums';

export class UpsertHubSpotPlatformConfigDto {
  @IsString()
  clientId!: string;

  @IsOptional()
  @IsString()
  clientSecret?: string;

  @IsOptional()
  @IsString()
  webhookSecret?: string;

  @IsUrl({ require_tld: false })
  redirectUri!: string;

  @IsArray()
  @IsString({ each: true })
  requiredScopes!: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  optionalScopes?: string[];

  @IsOptional()
  @IsString()
  appId?: string;

  @IsOptional()
  @IsIn([IntegrationEnvironment.TEST, IntegrationEnvironment.LIVE])
  environment?: IntegrationEnvironment;
}

export class UpdateHubSpotFieldMappingsDto {
  @IsArray()
  mappings!: Array<{ partnerIqField: string; externalField: string; required?: boolean }>;
}

export class UpdateHubSpotPipelineMappingDto {
  @IsString()
  externalPipelineId!: string;

  @IsString()
  externalPipelineLabel!: string;

  stageMappings!: Record<string, string>;

  @IsString()
  closedWonStageId!: string;

  @IsString()
  closedLostStageId!: string;
}
