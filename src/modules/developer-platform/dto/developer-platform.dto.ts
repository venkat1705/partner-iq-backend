import { IsArray, IsIn, IsNumber, IsOptional, IsString, IsUrl, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PLATFORM_CURRENCY } from '../../../common/constants/currency';

export class PublicIdentifyCustomerDto {
  @ApiProperty({ example: 'CUS-102' })
  @IsString()
  customerId!: string;

  @ApiPropertyOptional({ example: 'attr_xxx' })
  @IsOptional()
  @IsString()
  attributionId?: string;

  @ApiPropertyOptional({ example: 'anon_xxx' })
  @IsOptional()
  @IsString()
  anonymousId?: string;
}

export class AttachOrderDto {
  @ApiProperty({ example: 'attr_xxx' })
  @IsString()
  attributionId!: string;

  @ApiProperty({ enum: ['RAZORPAY', 'CASHFREE', 'JUSPAY', 'CUSTOM'] })
  @IsIn(['RAZORPAY', 'CASHFREE', 'JUSPAY', 'CUSTOM'])
  provider!: 'RAZORPAY' | 'CASHFREE' | 'JUSPAY' | 'CUSTOM';

  @ApiProperty({ example: 'order_RZP123' })
  @IsString()
  externalOrderId!: string;

  @ApiProperty({ example: 200000 })
  @IsNumber()
  @Min(1)
  amount!: number;

  @ApiProperty({ example: PLATFORM_CURRENCY })
  @IsString()
  @IsIn([PLATFORM_CURRENCY], { message: `Only ${PLATFORM_CURRENCY} is supported.` })
  currency!: string;
}

export class CreatePublicBrowserKeyDto {
  @ApiPropertyOptional({ example: 'program_uuid' })
  @IsOptional()
  @IsString()
  programId?: string;

  @ApiProperty({ enum: ['test', 'live'] })
  @IsIn(['test', 'live'])
  environment!: 'test' | 'live';

  @ApiProperty({ example: ['acme.com', 'www.acme.com'] })
  @IsArray()
  @IsString({ each: true })
  allowedDomains!: string[];
}

export class BrowserReferralDto {
  @ApiProperty({ example: 'pi_test_pk_xxx' })
  @IsString()
  publicKey!: string;

  @ApiProperty({ example: 'sarah123' })
  @IsString()
  ref!: string;

  @ApiPropertyOptional({ example: 'anon_xxx' })
  @IsOptional()
  @IsString()
  anonymousId?: string;

  @ApiPropertyOptional({ example: 'https://acme.com/pricing?ref=sarah123' })
  @IsOptional()
  @IsUrl()
  landingPageUrl?: string;
}
