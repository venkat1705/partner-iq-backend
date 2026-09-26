import {
  IsString,
  IsOptional,
  IsNumber,
  IsBoolean,
  IsEmail,
  IsUrl,
  IsIn,
  Min,
  Max,
  IsArray,
} from 'class-validator';
import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import type {
  AttributionModelType,
  CommissionCalculationType,
  PayoutScheduleType,
  WeekStartDay,
} from '../../../../database/schema-organization-settings';

export class UpdateGeneralSettingsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  slug?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  website?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  industry?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  companySize?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  supportEmail?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  contactEmail?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  phone?: string;
}

export class UpdateProfileSettingsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  legalName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  addressLine1?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  addressLine2?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  city?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  state?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  postalCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  country?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  taxId?: string;
}

export class UpdateLocalizationSettingsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  defaultCurrency?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  language?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  timezone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  dateFormat?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  numberFormat?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsIn(['MONDAY', 'SUNDAY'])
  weekStartsOn?: WeekStartDay;
}

export class UpdateTrackingSettingsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsIn(['LAST_TOUCH', 'FIRST_TOUCH', 'LINEAR', 'POSITION_BASED'])
  defaultAttributionModel?: AttributionModelType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(365)
  cookieDurationDays?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(180)
  attributionWindowDays?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  referralParam?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  trackingDomain?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  crossDomainTracking?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(168)
  deduplicationWindowHours?: number;
}

export class UpdateCommissionSettingsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsIn(['PERCENTAGE', 'FIXED'])
  defaultCommissionType?: CommissionCalculationType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  defaultCommissionValue?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(365)
  holdPeriodDays?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  minimumThreshold?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  refundDeduction?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  reversalPolicy?: string;
}

export class UpdatePayoutSettingsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsIn(['MONTHLY', 'BIWEEKLY', 'WEEKLY', 'MANUAL'])
  defaultPayoutSchedule?: PayoutScheduleType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  minimumPayoutAmount?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  autoApprovePayouts?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(90)
  payoutHoldingDays?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  supportedPayoutMethods?: string[];
}

export class UpdateEmailSettingsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  fromName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  fromEmail?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  replyToEmail?: string;
}

export class UpdateDocumentsSettingsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  legalEntityName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  registeredAddress?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  taxNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  invoiceFooterNote?: string;
}

export class UpdateDomainsSettingsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  customDomain?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  trackingCustomDomain?: string;
}

export class UpdateDeveloperSettingsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  apiAccessEnabled?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(60)
  @Max(10000)
  apiRateLimitPerMinute?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(60)
  webhookDefaultTimeoutSeconds?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(20)
  webhookRetryLimit?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  webhookSignatureRequired?: boolean;
}

export class UpdateSecuritySettingsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  allowGoogleLogin?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  allowPasswordLogin?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  singleSessionOnly?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(15)
  @Max(43200)
  sessionTimeoutMinutes?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  require2fa?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  securityAlertEmail?: string;
}

export class UpdatePrivacySettingsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  dataRetentionDays?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  analyticsCollection?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  ipLoggingEnabled?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  deviceMetadataEnabled?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  privacyContactEmail?: string;
}

export class ExportDataDto {
  @ApiProperty({ example: 'json' })
  @IsIn(['json', 'csv'])
  format!: 'json' | 'csv';
}

export class DeactivateOrgDto {
  @ApiProperty({ example: 'Temporary business hiatus' })
  @IsString()
  reason!: string;
}

export class DeleteOrgDto {
  @ApiProperty({ description: 'Must match the organization slug exactly' })
  @IsString()
  confirmSlug!: string;
}

