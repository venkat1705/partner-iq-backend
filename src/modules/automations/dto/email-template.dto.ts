import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEmail,
} from 'class-validator';

export class CreateEmailTemplateDto {
  @IsString()
  @IsOptional()
  programId?: string;

  @IsString()
  @IsNotEmpty()
  code!: string;

  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsNotEmpty()
  subject!: string;

  @IsString()
  @IsOptional()
  preheader?: string;

  @IsString()
  @IsNotEmpty()
  bodyHtml!: string;

  @IsString()
  @IsOptional()
  bodyText?: string;

  @IsString()
  @IsOptional()
  ctaText?: string;

  @IsString()
  @IsOptional()
  ctaUrl?: string;

  @IsString()
  @IsOptional()
  senderName?: string;

  @IsString()
  @IsOptional()
  replyTo?: string;
}

export class UpdateEmailTemplateDto extends CreateEmailTemplateDto {}

export class PreviewEmailTemplateDto {
  @IsString()
  @IsNotEmpty()
  subject!: string;

  @IsString()
  @IsNotEmpty()
  bodyHtml!: string;

  @IsOptional()
  mockVariables?: Record<string, any>;
}

export class TestEmailTemplateDto {
  @IsString()
  @IsNotEmpty()
  templateId!: string;

  @IsEmail()
  toEmail!: string;

  @IsOptional()
  mockVariables?: Record<string, any>;
}
