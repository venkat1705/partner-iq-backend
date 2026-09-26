import { IsArray, IsBoolean, IsIn, IsObject, IsOptional, IsString, IsUrl } from 'class-validator';
import { IntegrationEnvironment } from '../../../../common/enums';

export const HUBSPOT_SYNC_DIRECTIONS = ['bidirectional', 'outbound', 'inbound'] as const;
export type HubSpotSyncDirection = typeof HUBSPOT_SYNC_DIRECTIONS[number];

export class UpdateHubSpotSyncSettingsDto {
  @IsOptional()
  @IsIn(HUBSPOT_SYNC_DIRECTIONS)
  syncDirection?: HubSpotSyncDirection;

  @IsOptional()
  @IsBoolean()
  autoConvertOnWon?: boolean;

  @IsOptional()
  @IsBoolean()
  autoCreateDealInCrm?: boolean;

  @IsOptional()
  @IsBoolean()
  tagPartnerAttribution?: boolean;
}

export class UpsertHubSpotPlatformConfigDto {
  // Optional here: the admin UI only ever displays a masked Client ID/Secret and lets the
  // admin leave the field blank to keep the existing stored value on an update. Whether it's
  // actually required (first-time setup) is enforced in HubSpotService.upsertPlatformConfig.
  @IsOptional()
  @IsString()
  clientId?: string;

  @IsOptional()
  @IsString()
  clientSecret?: string;

  @IsOptional()
  @IsString()
  webhookSecret?: string;

  @IsOptional()
  @IsUrl({ require_tld: false })
  redirectUri?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  requiredScopes?: string[];

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

  @IsObject()
  stageMappings!: Record<string, string>;

  @IsString()
  closedWonStageId!: string;

  @IsString()
  closedLostStageId!: string;
}
