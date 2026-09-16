import { IsBoolean, IsEnum, IsNotEmpty, IsOptional, IsString, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';

export class InitiateGoogleAuthDto {
  @ApiPropertyOptional({ enum: ['LOGIN', 'REGISTER', 'LINK_ACCOUNT', 'ACCEPT_INVITATION'] })
  @IsOptional()
  @IsString()
  flowType?: 'LOGIN' | 'REGISTER' | 'LINK_ACCOUNT' | 'ACCEPT_INVITATION';

  @ApiPropertyOptional({ description: 'Internal path to redirect after successful authentication' })
  @IsOptional()
  @IsString()
  returnUrl?: string;

  @ApiPropertyOptional({ description: 'Invitation token if accepting an organization or affiliate invitation' })
  @IsOptional()
  @IsString()
  invitationToken?: string;

  /**
   * Consent captured on the signup form before the user was redirected to
   * Google. Required when flowType is REGISTER — a Google signup creates an
   * account just as the password form does, so it needs the same acceptance.
   */
  @ApiPropertyOptional({
    description: 'Must be true for a REGISTER flow. Records acceptance of the PartnerIQ legal documents.',
  })
  @IsOptional()
  // This DTO is bound from the query string, where everything arrives as text
  // and the global ValidationPipe does not do implicit conversion — so coerce
  // explicitly rather than letting @IsBoolean reject the string "true".
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  acceptedTerms?: boolean;
}

export class GoogleCallbackQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  code?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  state?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  error?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  error_description?: string;

  @ApiPropertyOptional({ description: 'OAuth scopes returned by Google on successful authorization' })
  @IsOptional()
  @IsString()
  scope?: string;

  @ApiPropertyOptional({ description: 'Google account selector index returned by Google' })
  @IsOptional()
  @IsString()
  authuser?: string;

  @ApiPropertyOptional({ description: 'Prompt behavior echoed by Google in some OAuth callbacks' })
  @IsOptional()
  @IsString()
  prompt?: string;

  @ApiPropertyOptional({ description: 'Issuer returned by Google in some OpenID Connect callbacks' })
  @IsOptional()
  @IsString()
  iss?: string;

  @ApiPropertyOptional({ description: 'Hosted domain returned by Google Workspace accounts' })
  @IsOptional()
  @IsString()
  hd?: string;
}

export class GoogleTokenExchangeDto {
  @ApiProperty({ description: 'Authorization code returned by Google' })
  @IsNotEmpty()
  @IsString()
  code!: string;

  @ApiProperty({ description: 'OAuth state token generated during authorization initiation' })
  @IsNotEmpty()
  @IsString()
  state!: string;
}

export class SetPasswordDto {
  @ApiProperty({ description: 'New password for the user account (minimum 12 characters)', minLength: 12 })
  @IsNotEmpty()
  @IsString()
  @MinLength(12, { message: 'Password must be at least 12 characters long' })
  password!: string;
}
