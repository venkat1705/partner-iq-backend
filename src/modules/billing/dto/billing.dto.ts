import { IsArray, IsBoolean, IsDateString, IsEnum, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';
import { PLATFORM_CURRENCY } from '../../../common/constants/currency';
import {
  BillingCouponCycleEligibility,
  BillingCouponCustomerEligibility,
  BillingCouponDiscountType,
  BillingCouponDurationType,
  BillingCouponPlanEligibility,
  BillingCouponStatus,
  BillingInterval,
  PaymentProviderType,
} from '../enums/billing.enums';

export class CheckoutDto {
  @IsUUID()
  planId!: string;

  @IsEnum(BillingInterval)
  billingInterval!: BillingInterval;

  @IsOptional()
  @IsString()
  couponCode?: string;
}

export class VerifyPaymentDto {
  @IsString()
  razorpay_payment_id!: string;

  @IsOptional()
  @IsString()
  razorpay_order_id?: string;

  @IsOptional()
  @IsString()
  razorpay_subscription_id?: string;

  @IsString()
  razorpay_signature!: string;
}

export class ChangeSubscriptionDto {
  @IsUUID()
  planId!: string;

  @IsEnum(BillingInterval)
  billingInterval!: BillingInterval;
}

export class CancelSubscriptionDto {
  @IsOptional()
  @IsBoolean()
  immediate?: boolean;
}

export class RefundDto {
  @IsUUID()
  paymentId!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  amount?: number;
}

export class CreatePlanDto {
  @IsString()
  code!: string;

  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsInt()
  @Min(0)
  price!: number;

  @IsString()
  @IsIn([PLATFORM_CURRENCY], { message: `Only ${PLATFORM_CURRENCY} is supported.` })
  currency!: string;

  @IsEnum(BillingInterval)
  billingInterval!: BillingInterval;

  @IsOptional()
  @IsInt()
  @Min(1)
  billingIntervalCount?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  trialDays?: number;

  @IsOptional()
  @IsBoolean()
  isPublic?: boolean;

  @IsOptional()
  @IsEnum(PaymentProviderType)
  provider?: PaymentProviderType;

  @IsOptional()
  @IsString()
  providerPlanId?: string;
}

export class PricingPreviewDto {
  @IsUUID()
  planId!: string;

  @IsEnum(BillingInterval)
  billingInterval!: BillingInterval;

  @IsOptional()
  @IsString()
  couponCode?: string;

  @IsOptional()
  @IsString()
  @IsIn([PLATFORM_CURRENCY], { message: `Only ${PLATFORM_CURRENCY} is supported.` })
  currency?: string;
}

export class ValidateBillingCouponDto extends PricingPreviewDto { }

export class CreateBillingCouponDto {
  @IsString()
  code!: string;

  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsEnum(BillingCouponDiscountType)
  discountType!: BillingCouponDiscountType;

  @IsOptional()
  @IsInt()
  @Min(0)
  discountValue?: number;

  @IsOptional()
  @IsString()
  @IsIn([PLATFORM_CURRENCY], { message: `Only ${PLATFORM_CURRENCY} is supported.` })
  currency?: string;

  @IsEnum(BillingCouponDurationType)
  durationType!: BillingCouponDurationType;

  @IsOptional()
  @IsInt()
  @Min(1)
  durationCycles?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(90)
  trialExtensionDays?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(12)
  freeMonths?: number;

  @IsOptional()
  @IsDateString()
  validFrom?: string;

  @IsOptional()
  @IsDateString()
  validUntil?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxRedemptions?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxRedemptionsPerOrganization?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  minimumPurchaseAmount?: number;

  @IsOptional()
  @IsEnum(BillingCouponPlanEligibility)
  planEligibility?: BillingCouponPlanEligibility;

  @IsOptional()
  @IsArray()
  @IsUUID(undefined, { each: true })
  planIds?: string[];

  @IsOptional()
  @IsEnum(BillingCouponCycleEligibility)
  billingCycleEligibility?: BillingCouponCycleEligibility;

  @IsOptional()
  @IsEnum(BillingCouponCustomerEligibility)
  customerEligibility?: BillingCouponCustomerEligibility;

  @IsOptional()
  @IsArray()
  @IsUUID(undefined, { each: true })
  organizationIds?: string[];

  @IsOptional()
  @IsBoolean()
  isPublic?: boolean;

  @IsOptional()
  @IsBoolean()
  isStackable?: boolean;

  @IsOptional()
  @IsBoolean()
  firstTimeCustomersOnly?: boolean;

  @IsOptional()
  @IsUUID()
  promotionId?: string;
}

export class UpdateBillingCouponDto extends CreateBillingCouponDto {
  @IsOptional()
  @IsString()
  code!: string;

  @IsOptional()
  @IsString()
  name!: string;

  @IsOptional()
  @IsEnum(BillingCouponDiscountType)
  discountType!: BillingCouponDiscountType;

  @IsOptional()
  @IsEnum(BillingCouponDurationType)
  durationType!: BillingCouponDurationType;

  @IsOptional()
  @IsEnum(BillingCouponStatus)
  status?: BillingCouponStatus;
}

export class GrantCreditDto {
  @IsUUID()
  organizationId!: string;

  @IsInt()
  @Min(1)
  amount!: number;

  @IsString()
  reason!: string;

  @IsOptional()
  @IsString()
  type?: string;

  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}

export class UpdateSubscriptionStatusDto {
  @IsString()
  status!: string;

  @IsOptional()
  @IsBoolean()
  cancelAtPeriodEnd?: boolean;

  @IsOptional()
  @IsDateString()
  nextBillingDate?: string;
}

export class ResolveBillingExceptionDto {
  @IsOptional()
  @IsString()
  resolutionNote?: string;
}

export class CreateEnterpriseContractDto {
  @IsUUID()
  organizationId!: string;

  @IsString()
  contractName!: string;

  @IsInt()
  @Min(1)
  annualValue!: number;

  @IsString()
  billingTerms!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  customAffiliateLimit?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  customConversionLimit?: number;

  @IsOptional()
  @IsString()
  dedicatedAccountManager?: string;

  @IsOptional()
  @IsString()
  slaCommitment?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class CreateBillingCampaignDto {
  @IsString()
  name!: string;

  @IsString()
  code!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  campaignType?: string;

  @IsOptional()
  @IsDateString()
  startsAt?: string;

  @IsOptional()
  @IsDateString()
  endsAt?: string;

  @IsOptional()
  @IsString()
  utmCampaign?: string;

  @IsOptional()
  @IsString()
  utmSource?: string;

  @IsOptional()
  @IsString()
  utmMedium?: string;

  @IsOptional()
  @IsString()
  landingPage?: string;
}

export class UpdateBillingCampaignDto extends CreateBillingCampaignDto {
  @IsOptional()
  @IsString()
  status?: string;
}

export class ResolveCouponExceptionDto {
  @IsOptional()
  @IsString()
  resolutionNote?: string;
}


