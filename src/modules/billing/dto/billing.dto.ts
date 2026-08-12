import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, IsUUID, Min } from 'class-validator';
import { BillingInterval, PaymentProviderType } from '../enums/billing.enums';

export class CheckoutDto {
  @IsUUID()
  planId!: string;

  @IsEnum(BillingInterval)
  billingInterval!: BillingInterval;
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
