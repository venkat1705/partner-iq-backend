import { IsEmail, IsNotEmpty, IsOptional, IsString, MinLength, IsBoolean, IsEnum, IsObject } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UserStatus, DocumentType } from '../../../common/enums';

// CreateSuperAdminDto was removed along with POST /internal/superadmins —
// super admin creation now only happens via `npm run create-super-admin`.

export class UpdateSuperAdminDto {
  // Password changes are deliberately not permitted via PATCH /internal/superadmins/:id.
  // Password updates happen strictly via the CLI (`npm run create-super-admin`) or the
  // user's own standard set-password / password-reset flow.

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
      invoice: { number: 'PIQ-TEST-001', total: 299, currency: 'INR', status: 'PAID' },
      items: [{ description: 'PartnerIQ Growth Subscription', qty: 1, unitPrice: 299, total: 299 }],
    },
  })
  @IsOptional()
  @IsObject()
  customData?: Record<string, any>;
}



