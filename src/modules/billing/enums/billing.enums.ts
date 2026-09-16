export enum PaymentProviderType {
  RAZORPAY = 'RAZORPAY',
  CASHFREE = 'CASHFREE',
  STRIPE = 'STRIPE',
  PAYU = 'PAYU',
}

export enum BillingInterval {
  MONTHLY = 'MONTHLY',
  QUARTERLY = 'QUARTERLY',
  YEARLY = 'YEARLY',
}

export enum SubscriptionStatus {
  TRIALING = 'TRIALING',
  ACTIVE = 'ACTIVE',
  PAST_DUE = 'PAST_DUE',
  GRACE_PERIOD = 'GRACE_PERIOD',
  RESTRICTED = 'RESTRICTED',
  TRIAL_EXPIRED = 'TRIAL_EXPIRED',
  CANCELLED = 'CANCELLED',
  SUSPENDED = 'SUSPENDED',
  CREATED = 'CREATED',
  AUTHENTICATION_PENDING = 'AUTHENTICATION_PENDING',
  PAUSED = 'PAUSED',
  CANCEL_PENDING = 'CANCEL_PENDING',
  COMPLETED = 'COMPLETED',
  EXPIRED = 'EXPIRED',
}

export enum PaymentStatus {
  CREATED = 'CREATED',
  PENDING = 'PENDING',
  AUTHORIZED = 'AUTHORIZED',
  CAPTURED = 'CAPTURED',
  FAILED = 'FAILED',
  REFUNDED = 'REFUNDED',
  PARTIALLY_REFUNDED = 'PARTIALLY_REFUNDED',
}

export enum PaymentEventStatus {
  RECEIVED = 'RECEIVED',
  PROCESSED = 'PROCESSED',
  DUPLICATE = 'DUPLICATE',
  FAILED = 'FAILED',
}

export enum BillingCouponDiscountType {
  PERCENTAGE = 'PERCENTAGE',
  FIXED_AMOUNT = 'FIXED_AMOUNT',
  FREE_MONTHS = 'FREE_MONTHS',
  TRIAL_EXTENSION = 'TRIAL_EXTENSION',
}

export enum BillingCouponDurationType {
  ONE_TIME = 'ONE_TIME',
  FIRST_N_BILLING_CYCLES = 'FIRST_N_BILLING_CYCLES',
  FOREVER = 'FOREVER',
}

export enum BillingCouponStatus {
  DRAFT = 'DRAFT',
  PENDING_APPROVAL = 'PENDING_APPROVAL',
  ACTIVE = 'ACTIVE',
  PAUSED = 'PAUSED',
  EXPIRED = 'EXPIRED',
  ARCHIVED = 'ARCHIVED',
}

export enum BillingCouponPlanEligibility {
  ALL_PLANS = 'ALL_PLANS',
  SPECIFIC_PLANS = 'SPECIFIC_PLANS',
}

export enum BillingCouponCycleEligibility {
  ALL = 'ALL',
  MONTHLY = 'MONTHLY',
  YEARLY = 'YEARLY',
}

export enum BillingCouponCustomerEligibility {
  ANY_ORGANIZATION = 'ANY_ORGANIZATION',
  NEW_CUSTOMERS_ONLY = 'NEW_CUSTOMERS_ONLY',
  EXISTING_CUSTOMERS_ONLY = 'EXISTING_CUSTOMERS_ONLY',
  SPECIFIC_ORGANIZATIONS = 'SPECIFIC_ORGANIZATIONS',
  SPECIFIC_ORGANIZATION_SEGMENTS = 'SPECIFIC_ORGANIZATION_SEGMENTS',
}

export enum BillingCouponRedemptionStatus {
  RESERVED = 'RESERVED',
  APPLIED = 'APPLIED',
  CONSUMED = 'CONSUMED',
  REVERSED = 'REVERSED',
  CANCELLED = 'CANCELLED',
  FAILED = 'FAILED',
  EXPIRED = 'EXPIRED',
}

export enum BillingPromotionStatus {
  DRAFT = 'DRAFT',
  ACTIVE = 'ACTIVE',
  PAUSED = 'PAUSED',
  EXPIRED = 'EXPIRED',
  ARCHIVED = 'ARCHIVED',
}

/**
 * Metered resources whose creation is gated by the customer's subscription.
 * Counted account-wide (across every organization on the subscription), never
 * per organization.
 */
export enum BillingResourceType {
  ORGANIZATION = 'ORGANIZATION',
  PROGRAM = 'PROGRAM',
  AFFILIATE = 'AFFILIATE',
  MEMBER = 'MEMBER',
}

export enum BillingAddonPurchaseStatus {
  /** Created at checkout, capacity not yet granted. */
  PENDING = 'PENDING',
  /** Paid and granting capacity right now. */
  ACTIVE = 'ACTIVE',
  /** Will stop granting capacity at `endDate`. */
  CANCEL_PENDING = 'CANCEL_PENDING',
  CANCELLED = 'CANCELLED',
  EXPIRED = 'EXPIRED',
  FAILED = 'FAILED',
}
