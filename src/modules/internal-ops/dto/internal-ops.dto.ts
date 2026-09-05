import { IsEmail, IsNotEmpty, IsOptional, IsString, MinLength, IsBoolean, IsEnum, IsObject } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UserStatus, DocumentType } from '../../../common/enums';

export class CreateSuperAdminDto {
  @ApiProperty({ example: 'superadmin@partneriq.io', description: 'Email address of the superadmin' })
  @IsEmail({}, { message: 'Please provide a valid email address' })
  @IsNotEmpty()
  email!: string;

  @ApiProperty({ example: 'SuperSecure@2026', description: 'Password (min 8 characters)' })
  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters long' })
  @IsNotEmpty()
  password!: string;

  @ApiProperty({ example: 'Alex', description: 'First name' })
  @IsString()
  @IsNotEmpty()
  firstName!: string;

  @ApiProperty({ example: 'Mercer', description: 'Last name' })
  @IsString()
  @IsNotEmpty()
  lastName!: string;

  @ApiPropertyOptional({ example: '+14155552671', description: 'Contact phone number' })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional({ example: true, default: true, description: 'Automatically verify email' })
  @IsOptional()
  @IsBoolean()
  autoVerifyEmail?: boolean = true;
}

export class UpdateSuperAdminDto {
  @ApiPropertyOptional({ example: 'NewSecurePassword@2026', description: 'New password' })
  @IsOptional()
  @IsString()
  @MinLength(8)
  password?: string;

  @ApiPropertyOptional({ example: 'Alex', description: 'First name' })
  @IsOptional()
  @IsString()
  firstName?: string;

  @ApiPropertyOptional({ example: 'Mercer', description: 'Last name' })
  @IsOptional()
  @IsString()
  lastName?: string;

  @ApiPropertyOptional({ enum: UserStatus, example: UserStatus.ACTIVE })
  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  emailVerified?: boolean;
}

export class TriggerTestEmailDto {
  @ApiProperty({
    example: 'WELCOME_EMAIL',
    description: 'System template key (e.g. WELCOME_EMAIL, COMMISSION_EARNED, PAYOUT_PROCESSED, INVOICE_GENERATED, SECURITY_ALERT, AFFILIATE_WELCOME, PASSWORD_RESET)',
  })
  @IsString()
  @IsNotEmpty()
  templateKey!: string;

  @ApiProperty({ example: 'tester@acme.com', description: 'Recipient email address' })
  @IsEmail()
  @IsNotEmpty()
  recipientEmail!: string;

  @ApiPropertyOptional({ example: 'Sarah Jenkins', description: 'Recipient full name' })
  @IsOptional()
  @IsString()
  recipientName?: string;

  @ApiPropertyOptional({ example: 'Test Notification from PartnerIQ Engine', description: 'Custom subject override' })
  @IsOptional()
  @IsString()
  subject?: string;

  @ApiPropertyOptional({
    example: { affiliateName: 'Sarah Jenkins', amount: '$250.00', organizationName: 'Acme SaaS' },
    description: 'Dynamic variables for template interpolation',
  })
  @IsOptional()
  @IsObject()
  variables?: Record<string, any>;

  @ApiPropertyOptional({
    example: false,
    default: false,
    description: 'If true, dispatches via Brevo/configured email provider. If false, renders preview HTML and logs test event.',
  })
  @IsOptional()
  @IsBoolean()
  sendViaProvider?: boolean = false;
}

export class GenerateTestDocumentDto {
  @ApiProperty({
    example: 'CUSTOMER_SUBSCRIPTION_INVOICE',
    description: 'Document template key (CUSTOMER_SUBSCRIPTION_INVOICE, AFFILIATE_COMMISSION_STATEMENT, PARTNER_INVOICE, PARTNER_CERTIFICATE)',
  })
  @IsString()
  @IsNotEmpty()
  templateKey!: string;

  @ApiPropertyOptional({ example: 'Acme Growth Labs LLC' })
  @IsOptional()
  @IsString()
  recipientName?: string;

  @ApiPropertyOptional({ example: 'billing@acmegrowth.com' })
  @IsOptional()
  @IsEmail()
  recipientEmail?: string;

  @ApiPropertyOptional({ example: 'PartnerIQ Inc.' })
  @IsOptional()
  @IsString()
  organizationName?: string;

  @ApiPropertyOptional({
    example: {
      invoice: { number: 'PIQ-TEST-001', total: 299, currency: 'USD', status: 'PAID' },
      items: [{ description: 'PartnerIQ Growth Subscription', qty: 1, unitPrice: 299, total: 299 }],
    },
  })
  @IsOptional()
  @IsObject()
  customData?: Record<string, any>;
}

export class SeedSandboxOrgDto {
  @ApiProperty({ example: 'Apex Analytics Corp' })
  @IsString()
  @IsNotEmpty()
  organizationName!: string;

  @ApiProperty({ example: 'admin@apexanalytics.io' })
  @IsEmail()
  @IsNotEmpty()
  ownerEmail!: string;

  @ApiPropertyOptional({ example: 'pro', default: 'pro', enum: ['starter', 'pro', 'growth', 'enterprise'] })
  @IsOptional()
  @IsString()
  plan?: string = 'pro';

  @ApiPropertyOptional({ example: 5, default: 5, description: 'Number of sample affiliates to generate' })
  @IsOptional()
  generateAffiliatesCount?: number = 5;

  @ApiPropertyOptional({ example: 10, default: 10, description: 'Number of mock conversions to record' })
  @IsOptional()
  generateConversionsCount?: number = 10;
}

