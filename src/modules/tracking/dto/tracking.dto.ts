import { IsString, IsUrl, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateTrackingLinkDto {
  @ApiProperty({ example: 'program_uuid' })
  @IsString()
  programId!: string;

  @ApiProperty({ example: 'affiliate_uuid' })
  @IsString()
  affiliateId!: string;

  @ApiProperty({ example: 'https://acme.com/pricing' })
  @IsUrl()
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
