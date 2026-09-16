import { IsString, IsUrl, IsOptional, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateTrackingLinkDto {
  @ApiProperty({ example: 'program_uuid' })
  @IsString()
  programId!: string;

  @ApiProperty({ example: 'affiliate_uuid' })
  @IsString()
  affiliateId!: string;

  @ApiProperty({ example: 'https://acme.com/pricing' })
  @IsUrl(
    { protocols: ['http', 'https'], require_protocol: true, require_tld: false },
    { message: 'destinationUrl must be a valid http:// or https:// URL' },
  )
  destinationUrl!: string;

  @ApiPropertyOptional({ example: 'summer2026' })
  @IsOptional()
  @IsString()
  campaignId?: string;

  @ApiPropertyOptional({ example: 'sarah' })
  @IsOptional()
  @IsString()
  customCode?: string;
}

export class BrowserClickDto {
  @ApiProperty({ example: 'pi_pub_live_xxxx' })
  @IsString()
  publicKey!: string;

  @ApiProperty({ example: 'sarah' })
  @IsString()
  shortCode!: string;

  @ApiPropertyOptional({ example: 'anon_123456789' })
  @IsOptional()
  @IsString()
  anonymousId?: string;

  @ApiPropertyOptional({ example: 'https://acme.com/pricing?utm_source=newsletter' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  landingUrl?: string;

  @ApiPropertyOptional({ example: 'newsletter' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  utmSource?: string;

  @ApiPropertyOptional({ example: 'email' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  utmMedium?: string;

  @ApiPropertyOptional({ example: 'summer_sale' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  utmCampaign?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  utmTerm?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  utmContent?: string;
}

export class IdentifyCustomerDto {
  @ApiProperty({ example: 'pi_pub_live_xxxx' })
  @IsString()
  publicKey!: string;

  @ApiProperty({ example: 'anon_123456789' })
  @IsString()
  anonymousId!: string;

  @ApiProperty({ example: 'CUS-10042' })
  @IsString()
  customerExternalId!: string;
}
