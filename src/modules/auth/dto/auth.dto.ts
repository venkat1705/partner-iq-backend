import { IsEmail, IsOptional, IsString, MinLength, Matches, IsBoolean, IsIn, IsArray, IsNumber, Min, Max } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class RegisterDto {
  @ApiProperty({ example: 'user@example.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'StrongPassword123!' })
  @IsString()
  @MinLength(12)
  @Matches(/((?=.*\d)|(?=.*\W+))(?![.\n])(?=.*[A-Z])(?=.*[a-z]).*$/, {
    message: 'Password must contain uppercase, lowercase, number and special character',
  })
  password!: string;

  @ApiProperty({ example: 'Jane' })
  @IsString()
  firstName!: string;

  @ApiProperty({ example: 'Doe' })
  @IsString()
  lastName!: string;

  /**
   * The signup form's single consent checkbox, covering the Master Services
   * Agreement, Privacy Policy and Anti-Fraud Guidelines.
   *
   * Deliberately carries no version: the server decides which document versions
   * an acceptance is recorded against, since a client-supplied version could be
   * forged to make stale consent look current.
   *
   * Optional on the wire so that existing API clients are not broken by this
   * field appearing — `AuthService.register` rejects a registration where it is
   * not explicitly `true`.
   */
  @ApiPropertyOptional({
    example: true,
    description:
      'Must be true. Records acceptance of the Master Services Agreement, Privacy Policy, and Anti-Fraud Guidelines.',
  })
  @IsOptional()
  @IsBoolean()
  acceptedTerms?: boolean;
}

export class LoginDto {
  @ApiProperty({ example: 'admin@partneriq.demo' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'PartnerIQ@123' })
  @IsString()
  password!: string;
}

export class RefreshTokenDto {
  @ApiPropertyOptional({ description: 'Refresh token string if not supplied via cookie' })
  @IsOptional()
  @IsString()
  refreshToken?: string;
}

export class ChangePasswordDto {
  @ApiProperty({ example: 'PartnerIQ@123' })
  @IsString()
  currentPassword!: string;

  @ApiProperty({ example: 'NewStrongPassword456!' })
  @IsString()
  @MinLength(12)
  newPassword!: string;
}

export class ForgotPasswordDto {
  @ApiProperty({ example: 'user@example.com' })
  @IsEmail()
  email!: string;

  @ApiPropertyOptional({ example: 'frontend' })
  @IsOptional()
  @IsString()
  portal?: string;
}

export class ResetPasswordDto {
  @ApiProperty()
  @IsString()
  token!: string;

  @ApiProperty({ example: 'NewStrongPassword456!' })
  @IsString()
  @MinLength(8)
  newPassword!: string;
}

export class VerifyEmailOtpDto {
  @ApiProperty({ example: 'challenge-uuid-123' })
  @IsString()
  challengeId!: string;

  @ApiProperty({ example: '482913' })
  @IsString()
  @Matches(/^\d{6}$/, { message: 'Code must be a 6-digit number' })
  code!: string;
}

export class ResendEmailOtpDto {
  @ApiPropertyOptional({ example: 'challenge-uuid-123' })
  @IsOptional()
  @IsString()
  challengeId?: string;

  @ApiPropertyOptional({ example: 'user@example.com' })
  @IsOptional()
  @IsEmail()
  email?: string;
}

export class MfaChallengeDto {
  @ApiProperty({ example: 'user@example.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'PartnerIQ@123' })
  @IsString()
  password!: string;
}

export class MfaVerifyDto {
  @ApiProperty({ example: 'challenge-uuid-123' })
  @IsString()
  challengeId!: string;

  @ApiPropertyOptional({ example: '123456' })
  @IsOptional()
  @IsString()
  code?: string;

  @ApiPropertyOptional({ example: 'ABCD-EFGH' })
  @IsOptional()
  @IsString()
  recoveryCode?: string;

  @ApiPropertyOptional({ description: 'Trust this device for 30 days', example: false })
  @IsOptional()
  @IsBoolean()
  trustDevice?: boolean;
}

export class MfaSetupVerifyDto {
  @ApiProperty({ example: '123456' })
  @IsString()
  code!: string;
}

export class MfaDisableDto {
  @ApiProperty({ example: 'PartnerIQ@123' })
  @IsString()
  password!: string;

  @ApiPropertyOptional({ example: '123456' })
  @IsOptional()
  @IsString()
  code?: string;
}

export class RegenerateRecoveryCodesDto {
  @ApiProperty({ example: '123456', description: 'Current TOTP code to authorize regeneration' })
  @IsString()
  code!: string;
}

export class TrustDeviceDto {
  @ApiPropertyOptional({ description: 'Optional reason or label' })
  @IsOptional()
  @IsString()
  label?: string;
}

export class StepUpChallengeDto {
  // No body needed — user context from JWT
}

export class StepUpVerifyDto {
  @ApiProperty({ example: 'challenge-uuid-123' })
  @IsString()
  challengeId!: string;

  @ApiProperty({ example: '123456' })
  @IsString()
  code!: string;
}

export class UpdateOrgSecurityPolicyDto {
  @ApiProperty({ example: 'org-uuid' })
  @IsString()
  organizationId!: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  requireMfa?: boolean;

  @ApiPropertyOptional({ example: 'ALL', enum: ['ALL', 'ADMINS', 'SENSITIVE_ROLES'] })
  @IsOptional()
  @IsString()
  @IsIn(['ALL', 'ADMINS', 'SENSITIVE_ROLES'])
  mfaScope?: string;

  @ApiPropertyOptional({ example: ['OWNER', 'ADMIN', 'FINANCE'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  sensitiveRoles?: string[];

  @ApiPropertyOptional({ example: 10080, description: 'Session idle timeout in minutes' })
  @IsOptional()
  @IsNumber()
  @Min(60)
  @Max(43200)
  @Type(() => Number)
  sessionIdleTimeoutMinutes?: number;
}
