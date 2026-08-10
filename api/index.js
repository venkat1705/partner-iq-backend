var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __decorateClass = (decorators, target, key, kind) => {
  var result = kind > 1 ? void 0 : kind ? __getOwnPropDesc(target, key) : target;
  for (var i = decorators.length - 1, decorator; i >= 0; i--)
    if (decorator = decorators[i])
      result = (kind ? decorator(target, key, result) : decorator(result)) || result;
  if (kind && result) __defProp(target, key, result);
  return result;
};
var __decorateParam = (index, decorator) => (target, key) => decorator(target, key, index);

// src/vercel-handler.ts
import "reflect-metadata";
import serverless from "serverless-http";
import { NestFactory } from "@nestjs/core";

// src/AppModule.ts
import { Module as Module17 } from "@nestjs/common";

// src/modules/auth/auth.module.ts
import { Module } from "@nestjs/common";

// src/modules/auth/auth.controller.ts
import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  Req,
  Res,
  UseGuards,
  HttpCode,
  HttpStatus
} from "@nestjs/common";
import { ApiTags, ApiOperation, ApiBearerAuth } from "@nestjs/swagger";

// src/common/guards/jwt-auth.guard.ts
import {
  Injectable,
  UnauthorizedException
} from "@nestjs/common";
import jwtPkg from "jsonwebtoken";
import { IsNull } from "typeorm";

// src/config/jwt.config.ts
var getJwtConfig = () => {
  const accessSecret = process.env.JWT_ACCESS_SECRET || "partneriq_super_secret_jwt_access_key_min_32_chars";
  const refreshSecret = process.env.JWT_REFRESH_SECRET || "partneriq_super_secret_jwt_refresh_key_min_32_chars";
  if (process.env.NODE_ENV === "production") {
    if (accessSecret.length < 32 || refreshSecret.length < 32) {
      throw new Error("JWT secrets must have a minimum length of 32 characters in production.");
    }
  }
  return {
    accessSecret,
    accessTtl: process.env.JWT_ACCESS_TTL || "30s",
    refreshSecret,
    refreshTtl: process.env.JWT_REFRESH_TTL || "7d",
    passwordResetTtl: process.env.PASSWORD_RESET_TTL || "15m",
    emailVerificationTtl: process.env.EMAIL_VERIFICATION_TTL || "24h"
  };
};

// src/database/data-source.ts
import "reflect-metadata";
import dotenv from "dotenv";
import { DataSource } from "typeorm";

// src/database/schema.ts
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index, Unique } from "typeorm";

// src/common/enums/index.ts
var Role = /* @__PURE__ */ ((Role3) => {
  Role3["SUPER_ADMIN"] = "SUPER_ADMIN";
  Role3["OWNER"] = "OWNER";
  Role3["ADMIN"] = "ADMIN";
  Role3["PROGRAM_MANAGER"] = "PROGRAM_MANAGER";
  Role3["AFFILIATE_MANAGER"] = "AFFILIATE_MANAGER";
  Role3["FINANCE"] = "FINANCE";
  Role3["RISK_ANALYST"] = "RISK_ANALYST";
  Role3["ANALYST"] = "ANALYST";
  Role3["DEVELOPER"] = "DEVELOPER";
  Role3["VIEWER"] = "VIEWER";
  return Role3;
})(Role || {});

// src/database/schema.ts
var User = class {
};
__decorateClass([
  PrimaryGeneratedColumn("uuid")
], User.prototype, "id", 2);
__decorateClass([
  Index({ unique: true }),
  Column({ type: "varchar", length: 255 })
], User.prototype, "email", 2);
__decorateClass([
  Column({ type: "varchar", length: 255 })
], User.prototype, "passwordHash", 2);
__decorateClass([
  Column({ type: "varchar", length: 100 })
], User.prototype, "firstName", 2);
__decorateClass([
  Column({ type: "varchar", length: 100 })
], User.prototype, "lastName", 2);
__decorateClass([
  Column({ type: "varchar", length: 50, default: "ACTIVE" /* ACTIVE */ })
], User.prototype, "status", 2);
__decorateClass([
  Column({ type: "boolean", default: false })
], User.prototype, "emailVerified", 2);
__decorateClass([
  Column({ type: "varchar", length: 50, default: "USER" /* USER */ })
], User.prototype, "platformRole", 2);
__decorateClass([
  Column({ type: "timestamp", nullable: true })
], User.prototype, "lastLoginAt", 2);
__decorateClass([
  Column({ type: "int", default: 0 })
], User.prototype, "failedLoginAttempts", 2);
__decorateClass([
  Column({ type: "timestamp", nullable: true })
], User.prototype, "lockedUntil", 2);
__decorateClass([
  CreateDateColumn()
], User.prototype, "createdAt", 2);
__decorateClass([
  UpdateDateColumn()
], User.prototype, "updatedAt", 2);
__decorateClass([
  Column({ type: "timestamp", nullable: true })
], User.prototype, "deletedAt", 2);
User = __decorateClass([
  Entity("users")
], User);
var Organization = class {
};
__decorateClass([
  PrimaryGeneratedColumn("uuid")
], Organization.prototype, "id", 2);
__decorateClass([
  Column({ type: "varchar", length: 255 })
], Organization.prototype, "name", 2);
__decorateClass([
  Index({ unique: true }),
  Column({ type: "varchar", length: 255 })
], Organization.prototype, "slug", 2);
__decorateClass([
  Column({ type: "varchar", length: 255, nullable: true })
], Organization.prototype, "website", 2);
__decorateClass([
  Column({ type: "varchar", length: 100, nullable: true })
], Organization.prototype, "industry", 2);
__decorateClass([
  Column({ type: "varchar", length: 50, nullable: true })
], Organization.prototype, "companySize", 2);
__decorateClass([
  Column({ type: "varchar", length: 10, default: "US" })
], Organization.prototype, "country", 2);
__decorateClass([
  Column({ type: "varchar", length: 10, default: "USD" })
], Organization.prototype, "defaultCurrency", 2);
__decorateClass([
  Column({ type: "varchar", length: 50, default: "ACTIVE" /* ACTIVE */ })
], Organization.prototype, "status", 2);
__decorateClass([
  Column({ type: "boolean", default: false })
], Organization.prototype, "onboardingCompleted", 2);
__decorateClass([
  Column({ type: "uuid" })
], Organization.prototype, "createdBy", 2);
__decorateClass([
  CreateDateColumn()
], Organization.prototype, "createdAt", 2);
__decorateClass([
  UpdateDateColumn()
], Organization.prototype, "updatedAt", 2);
__decorateClass([
  Column({ type: "timestamp", nullable: true })
], Organization.prototype, "deletedAt", 2);
Organization = __decorateClass([
  Entity("organizations")
], Organization);
var OrganizationMembership = class {
};
__decorateClass([
  PrimaryGeneratedColumn("uuid")
], OrganizationMembership.prototype, "id", 2);
__decorateClass([
  Index(),
  Column({ type: "uuid" })
], OrganizationMembership.prototype, "organizationId", 2);
__decorateClass([
  Index(),
  Column({ type: "uuid" })
], OrganizationMembership.prototype, "userId", 2);
__decorateClass([
  Column({ type: "varchar", length: 50 })
], OrganizationMembership.prototype, "role", 2);
__decorateClass([
  Column({ type: "varchar", length: 50, default: "ACTIVE" /* ACTIVE */ })
], OrganizationMembership.prototype, "status", 2);
__decorateClass([
  Column({ type: "varchar", length: 50, default: "ALL" /* ALL */ })
], OrganizationMembership.prototype, "programAccessType", 2);
__decorateClass([
  Column({ type: "simple-array", nullable: true })
], OrganizationMembership.prototype, "programIds", 2);
__decorateClass([
  Column({ type: "uuid", nullable: true })
], OrganizationMembership.prototype, "invitedBy", 2);
__decorateClass([
  CreateDateColumn()
], OrganizationMembership.prototype, "joinedAt", 2);
__decorateClass([
  CreateDateColumn()
], OrganizationMembership.prototype, "createdAt", 2);
__decorateClass([
  UpdateDateColumn()
], OrganizationMembership.prototype, "updatedAt", 2);
OrganizationMembership = __decorateClass([
  Entity("organization_memberships"),
  Unique(["organizationId", "userId"])
], OrganizationMembership);
var AuthSession = class {
};
__decorateClass([
  PrimaryGeneratedColumn("uuid")
], AuthSession.prototype, "id", 2);
__decorateClass([
  Index(),
  Column({ type: "uuid" })
], AuthSession.prototype, "userId", 2);
__decorateClass([
  Column({ type: "varchar", length: 255 })
], AuthSession.prototype, "refreshTokenHash", 2);
__decorateClass([
  Index(),
  Column({ type: "uuid" })
], AuthSession.prototype, "tokenFamilyId", 2);
__decorateClass([
  Column({ type: "varchar", length: 500, nullable: true })
], AuthSession.prototype, "userAgent", 2);
__decorateClass([
  Column({ type: "varchar", length: 100, nullable: true })
], AuthSession.prototype, "ipAddress", 2);
__decorateClass([
  Column({ type: "varchar", length: 100, nullable: true })
], AuthSession.prototype, "deviceName", 2);
__decorateClass([
  Column({ type: "timestamp" })
], AuthSession.prototype, "expiresAt", 2);
__decorateClass([
  Column({ type: "timestamp" })
], AuthSession.prototype, "lastUsedAt", 2);
__decorateClass([
  Column({ type: "timestamp", nullable: true })
], AuthSession.prototype, "revokedAt", 2);
__decorateClass([
  CreateDateColumn()
], AuthSession.prototype, "createdAt", 2);
AuthSession = __decorateClass([
  Entity("auth_sessions")
], AuthSession);
var Program = class {
};
__decorateClass([
  PrimaryGeneratedColumn("uuid")
], Program.prototype, "id", 2);
__decorateClass([
  Index(),
  Column({ type: "uuid" })
], Program.prototype, "organizationId", 2);
__decorateClass([
  Column({ type: "varchar", length: 255 })
], Program.prototype, "name", 2);
__decorateClass([
  Column({ type: "varchar", length: 255 })
], Program.prototype, "slug", 2);
__decorateClass([
  Column({ type: "varchar", length: 50, default: "AFFILIATE" /* AFFILIATE */ })
], Program.prototype, "type", 2);
__decorateClass([
  Column({ type: "varchar", length: 50, default: "ACTIVE" /* ACTIVE */ })
], Program.prototype, "status", 2);
__decorateClass([
  Column({ type: "varchar", length: 10, default: "USD" })
], Program.prototype, "currency", 2);
__decorateClass([
  Column({ type: "varchar", length: 50, default: "PERCENTAGE" /* PERCENTAGE */ })
], Program.prototype, "commissionType", 2);
__decorateClass([
  Column({ type: "bigint", default: 1e3 })
], Program.prototype, "defaultCommissionValue", 2);
__decorateClass([
  Column({ type: "varchar", length: 50, default: "LAST_CLICK" /* LAST_CLICK */ })
], Program.prototype, "attributionModel", 2);
__decorateClass([
  Column({ type: "int", default: 30 })
], Program.prototype, "cookieDurationDays", 2);
__decorateClass([
  Column({ type: "varchar", length: 20, default: "AUTO" })
], Program.prototype, "affiliateApprovalMode", 2);
__decorateClass([
  Column({ type: "uuid" })
], Program.prototype, "createdBy", 2);
__decorateClass([
  CreateDateColumn()
], Program.prototype, "createdAt", 2);
__decorateClass([
  UpdateDateColumn()
], Program.prototype, "updatedAt", 2);
__decorateClass([
  Column({ type: "timestamp", nullable: true })
], Program.prototype, "deletedAt", 2);
Program = __decorateClass([
  Entity("programs")
], Program);
var Affiliate = class {
};
__decorateClass([
  PrimaryGeneratedColumn("uuid")
], Affiliate.prototype, "id", 2);
__decorateClass([
  Index(),
  Column({ type: "uuid" })
], Affiliate.prototype, "organizationId", 2);
__decorateClass([
  Column({ type: "uuid", nullable: true })
], Affiliate.prototype, "userId", 2);
__decorateClass([
  Column({ type: "varchar", length: 255 })
], Affiliate.prototype, "displayName", 2);
__decorateClass([
  Index(),
  Column({ type: "varchar", length: 255 })
], Affiliate.prototype, "email", 2);
__decorateClass([
  Column({ type: "varchar", length: 255, nullable: true })
], Affiliate.prototype, "companyName", 2);
__decorateClass([
  Column({ type: "varchar", length: 255, nullable: true })
], Affiliate.prototype, "website", 2);
__decorateClass([
  Column({ type: "varchar", length: 10, default: "US" })
], Affiliate.prototype, "country", 2);
__decorateClass([
  Column({ type: "varchar", length: 50, default: "ACTIVE" /* ACTIVE */ })
], Affiliate.prototype, "status", 2);
__decorateClass([
  Column({ type: "int", default: 0 })
], Affiliate.prototype, "trustScore", 2);
__decorateClass([
  Column({ type: "varchar", length: 100, nullable: true })
], Affiliate.prototype, "payoutMethod", 2);
__decorateClass([
  CreateDateColumn()
], Affiliate.prototype, "createdAt", 2);
__decorateClass([
  UpdateDateColumn()
], Affiliate.prototype, "updatedAt", 2);
Affiliate = __decorateClass([
  Entity("affiliates")
], Affiliate);
var ProgramAffiliate = class {
};
__decorateClass([
  PrimaryGeneratedColumn("uuid")
], ProgramAffiliate.prototype, "id", 2);
__decorateClass([
  Index(),
  Column({ type: "uuid" })
], ProgramAffiliate.prototype, "organizationId", 2);
__decorateClass([
  Index(),
  Column({ type: "uuid" })
], ProgramAffiliate.prototype, "programId", 2);
__decorateClass([
  Index(),
  Column({ type: "uuid" })
], ProgramAffiliate.prototype, "affiliateId", 2);
__decorateClass([
  Column({ type: "varchar", length: 50, default: "ACTIVE" /* ACTIVE */ })
], ProgramAffiliate.prototype, "status", 2);
__decorateClass([
  Column({ type: "varchar", length: 100 })
], ProgramAffiliate.prototype, "referralCode", 2);
__decorateClass([
  Column({ type: "int", nullable: true })
], ProgramAffiliate.prototype, "commissionOverride", 2);
__decorateClass([
  Column({ type: "timestamp" })
], ProgramAffiliate.prototype, "joinedAt", 2);
ProgramAffiliate = __decorateClass([
  Entity("program_affiliates")
], ProgramAffiliate);
var AffiliateApplication = class {
};
__decorateClass([
  PrimaryGeneratedColumn("uuid")
], AffiliateApplication.prototype, "id", 2);
__decorateClass([
  Index(),
  Column({ type: "uuid" })
], AffiliateApplication.prototype, "organizationId", 2);
__decorateClass([
  Index(),
  Column({ type: "uuid" })
], AffiliateApplication.prototype, "programId", 2);
__decorateClass([
  Column({ type: "varchar", length: 255 })
], AffiliateApplication.prototype, "email", 2);
__decorateClass([
  Column({ type: "varchar", length: 255 })
], AffiliateApplication.prototype, "name", 2);
__decorateClass([
  Column({ type: "varchar", length: 255, nullable: true })
], AffiliateApplication.prototype, "website", 2);
__decorateClass([
  Column({ type: "varchar", length: 255, nullable: true })
], AffiliateApplication.prototype, "promotionMethod", 2);
__decorateClass([
  Column({ type: "varchar", length: 100, nullable: true })
], AffiliateApplication.prototype, "audienceSize", 2);
__decorateClass([
  Column({ type: "varchar", length: 10, default: "US" })
], AffiliateApplication.prototype, "country", 2);
__decorateClass([
  Column({ type: "varchar", length: 50, default: "PENDING" /* PENDING */ })
], AffiliateApplication.prototype, "status", 2);
__decorateClass([
  Column({ type: "varchar", length: 36, nullable: true })
], AffiliateApplication.prototype, "reviewedBy", 2);
__decorateClass([
  Column({ type: "timestamp", nullable: true })
], AffiliateApplication.prototype, "reviewedAt", 2);
__decorateClass([
  CreateDateColumn()
], AffiliateApplication.prototype, "createdAt", 2);
AffiliateApplication = __decorateClass([
  Entity("affiliate_applications")
], AffiliateApplication);
var TrackingLink = class {
};
__decorateClass([
  PrimaryGeneratedColumn("uuid")
], TrackingLink.prototype, "id", 2);
__decorateClass([
  Index(),
  Column({ type: "uuid" })
], TrackingLink.prototype, "organizationId", 2);
__decorateClass([
  Index(),
  Column({ type: "uuid" })
], TrackingLink.prototype, "programId", 2);
__decorateClass([
  Index(),
  Column({ type: "uuid" })
], TrackingLink.prototype, "affiliateId", 2);
__decorateClass([
  Column({ type: "varchar", length: 255, nullable: true })
], TrackingLink.prototype, "campaignId", 2);
__decorateClass([
  Column({ type: "varchar", length: 2e3 })
], TrackingLink.prototype, "destinationUrl", 2);
__decorateClass([
  Index({ unique: true }),
  Column({ type: "varchar", length: 255 })
], TrackingLink.prototype, "shortCode", 2);
__decorateClass([
  Column({ type: "varchar", length: 255, nullable: true })
], TrackingLink.prototype, "subId", 2);
__decorateClass([
  Column({ type: "varchar", length: 50, default: "ACTIVE" /* ACTIVE */ })
], TrackingLink.prototype, "status", 2);
__decorateClass([
  CreateDateColumn()
], TrackingLink.prototype, "createdAt", 2);
TrackingLink = __decorateClass([
  Entity("tracking_links")
], TrackingLink);
var Click = class {
};
__decorateClass([
  PrimaryGeneratedColumn("uuid")
], Click.prototype, "id", 2);
__decorateClass([
  Index(),
  Column({ type: "uuid" })
], Click.prototype, "organizationId", 2);
__decorateClass([
  Index(),
  Column({ type: "uuid" })
], Click.prototype, "programId", 2);
__decorateClass([
  Index(),
  Column({ type: "uuid" })
], Click.prototype, "affiliateId", 2);
__decorateClass([
  Index(),
  Column({ type: "uuid" })
], Click.prototype, "trackingLinkId", 2);
__decorateClass([
  Column({ type: "varchar", length: 255 })
], Click.prototype, "anonymousId", 2);
__decorateClass([
  Column({ type: "varchar", length: 255 })
], Click.prototype, "ipHash", 2);
__decorateClass([
  Column({ type: "varchar", length: 500, nullable: true })
], Click.prototype, "ipEncrypted", 2);
__decorateClass([
  Column({ type: "varchar", length: 500, nullable: true })
], Click.prototype, "userAgent", 2);
__decorateClass([
  Column({ type: "varchar", length: 1e3, nullable: true })
], Click.prototype, "referrer", 2);
__decorateClass([
  Column({ type: "varchar", length: 100, nullable: true })
], Click.prototype, "country", 2);
__decorateClass([
  Column({ type: "varchar", length: 100, nullable: true })
], Click.prototype, "deviceType", 2);
__decorateClass([
  Column({ type: "varchar", length: 100, nullable: true })
], Click.prototype, "browser", 2);
__decorateClass([
  Column({ type: "varchar", length: 100, nullable: true })
], Click.prototype, "os", 2);
__decorateClass([
  Column({ type: "int", default: 0 })
], Click.prototype, "fraudScore", 2);
__decorateClass([
  Column({ type: "varchar", length: 50, default: "LOW" /* LOW */ })
], Click.prototype, "fraudStatus", 2);
__decorateClass([
  CreateDateColumn()
], Click.prototype, "createdAt", 2);
Click = __decorateClass([
  Entity("clicks")
], Click);
var Attribution = class {
};
__decorateClass([
  PrimaryGeneratedColumn("uuid")
], Attribution.prototype, "id", 2);
__decorateClass([
  Index(),
  Column({ type: "uuid" })
], Attribution.prototype, "organizationId", 2);
__decorateClass([
  Index(),
  Column({ type: "uuid" })
], Attribution.prototype, "programId", 2);
__decorateClass([
  Index(),
  Column({ type: "uuid" })
], Attribution.prototype, "affiliateId", 2);
__decorateClass([
  Index(),
  Column({ type: "uuid" })
], Attribution.prototype, "clickId", 2);
__decorateClass([
  Column({ type: "varchar", length: 255 })
], Attribution.prototype, "anonymousId", 2);
__decorateClass([
  Column({ type: "varchar", length: 255, nullable: true })
], Attribution.prototype, "customerExternalId", 2);
__decorateClass([
  Column({ type: "varchar", length: 50, default: "LAST_CLICK" /* LAST_CLICK */ })
], Attribution.prototype, "model", 2);
__decorateClass([
  Column({ type: "timestamp" })
], Attribution.prototype, "expiresAt", 2);
__decorateClass([
  CreateDateColumn()
], Attribution.prototype, "createdAt", 2);
Attribution = __decorateClass([
  Entity("attributions")
], Attribution);
var ApiKey = class {
};
__decorateClass([
  PrimaryGeneratedColumn("uuid")
], ApiKey.prototype, "id", 2);
__decorateClass([
  Index(),
  Column({ type: "uuid" })
], ApiKey.prototype, "organizationId", 2);
__decorateClass([
  Column({ type: "varchar", length: 255 })
], ApiKey.prototype, "name", 2);
__decorateClass([
  Column({ type: "varchar", length: 50 })
], ApiKey.prototype, "prefix", 2);
__decorateClass([
  Column({ type: "varchar", length: 255 })
], ApiKey.prototype, "keyHash", 2);
__decorateClass([
  Column({ type: "simple-array" })
], ApiKey.prototype, "scopes", 2);
__decorateClass([
  Column({ type: "timestamp", nullable: true })
], ApiKey.prototype, "lastUsedAt", 2);
__decorateClass([
  Column({ type: "timestamp", nullable: true })
], ApiKey.prototype, "expiresAt", 2);
__decorateClass([
  Column({ type: "timestamp", nullable: true })
], ApiKey.prototype, "revokedAt", 2);
__decorateClass([
  Column({ type: "uuid" })
], ApiKey.prototype, "createdBy", 2);
__decorateClass([
  CreateDateColumn()
], ApiKey.prototype, "createdAt", 2);
ApiKey = __decorateClass([
  Entity("api_keys")
], ApiKey);
var IdempotencyKey = class {
};
__decorateClass([
  PrimaryGeneratedColumn("uuid")
], IdempotencyKey.prototype, "id", 2);
__decorateClass([
  Index(),
  Column({ type: "uuid" })
], IdempotencyKey.prototype, "organizationId", 2);
__decorateClass([
  Column({ type: "varchar", length: 255 })
], IdempotencyKey.prototype, "key", 2);
__decorateClass([
  Column({ type: "varchar", length: 255 })
], IdempotencyKey.prototype, "requestHash", 2);
__decorateClass([
  Column({ type: "int" })
], IdempotencyKey.prototype, "responseStatus", 2);
__decorateClass([
  Column({ type: "simple-json" })
], IdempotencyKey.prototype, "responseBody", 2);
__decorateClass([
  Column({ type: "timestamp" })
], IdempotencyKey.prototype, "expiresAt", 2);
__decorateClass([
  CreateDateColumn()
], IdempotencyKey.prototype, "createdAt", 2);
IdempotencyKey = __decorateClass([
  Entity("idempotency_keys")
], IdempotencyKey);
var Conversion = class {
};
__decorateClass([
  PrimaryGeneratedColumn("uuid")
], Conversion.prototype, "id", 2);
__decorateClass([
  Index(),
  Column({ type: "uuid" })
], Conversion.prototype, "organizationId", 2);
__decorateClass([
  Index(),
  Column({ type: "uuid" })
], Conversion.prototype, "programId", 2);
__decorateClass([
  Index(),
  Column({ type: "uuid", nullable: true })
], Conversion.prototype, "affiliateId", 2);
__decorateClass([
  Column({ type: "varchar", length: 255 })
], Conversion.prototype, "externalId", 2);
__decorateClass([
  Column({ type: "varchar", length: 255 })
], Conversion.prototype, "customerExternalId", 2);
__decorateClass([
  Column({ type: "int" })
], Conversion.prototype, "amount", 2);
__decorateClass([
  Column({ type: "varchar", length: 10 })
], Conversion.prototype, "currency", 2);
__decorateClass([
  Column({ type: "varchar", length: 255, nullable: true })
], Conversion.prototype, "productId", 2);
__decorateClass([
  Column({ type: "varchar", length: 50 })
], Conversion.prototype, "status", 2);
__decorateClass([
  Column({ type: "timestamp" })
], Conversion.prototype, "occurredAt", 2);
__decorateClass([
  CreateDateColumn()
], Conversion.prototype, "createdAt", 2);
Conversion = __decorateClass([
  Entity("conversions")
], Conversion);
var CommissionRule = class {
};
__decorateClass([
  PrimaryGeneratedColumn("uuid")
], CommissionRule.prototype, "id", 2);
__decorateClass([
  Index(),
  Column({ type: "uuid" })
], CommissionRule.prototype, "organizationId", 2);
__decorateClass([
  Index(),
  Column({ type: "uuid" })
], CommissionRule.prototype, "programId", 2);
__decorateClass([
  Column({ type: "varchar", length: 255 })
], CommissionRule.prototype, "name", 2);
__decorateClass([
  Column({ type: "int" })
], CommissionRule.prototype, "priority", 2);
__decorateClass([
  Column({ type: "simple-json" })
], CommissionRule.prototype, "conditions", 2);
__decorateClass([
  Column({ type: "varchar", length: 50 })
], CommissionRule.prototype, "commissionType", 2);
__decorateClass([
  Column({ type: "int" })
], CommissionRule.prototype, "commissionValue", 2);
__decorateClass([
  Column({ type: "boolean", default: true })
], CommissionRule.prototype, "active", 2);
__decorateClass([
  Column({ type: "timestamp", nullable: true })
], CommissionRule.prototype, "effectiveFrom", 2);
__decorateClass([
  Column({ type: "timestamp", nullable: true })
], CommissionRule.prototype, "effectiveTo", 2);
__decorateClass([
  CreateDateColumn()
], CommissionRule.prototype, "createdAt", 2);
__decorateClass([
  UpdateDateColumn()
], CommissionRule.prototype, "updatedAt", 2);
CommissionRule = __decorateClass([
  Entity("commission_rules")
], CommissionRule);
var Commission = class {
};
__decorateClass([
  PrimaryGeneratedColumn("uuid")
], Commission.prototype, "id", 2);
__decorateClass([
  Index(),
  Column({ type: "uuid" })
], Commission.prototype, "organizationId", 2);
__decorateClass([
  Index(),
  Column({ type: "uuid" })
], Commission.prototype, "programId", 2);
__decorateClass([
  Index(),
  Column({ type: "uuid" })
], Commission.prototype, "affiliateId", 2);
__decorateClass([
  Index(),
  Column({ type: "uuid" })
], Commission.prototype, "conversionId", 2);
__decorateClass([
  Column({ type: "varchar", length: 36, nullable: true })
], Commission.prototype, "ruleId", 2);
__decorateClass([
  Column({ type: "simple-json" })
], Commission.prototype, "ruleSnapshot", 2);
__decorateClass([
  Column({ type: "int" })
], Commission.prototype, "rate", 2);
__decorateClass([
  Column({ type: "int" })
], Commission.prototype, "baseAmount", 2);
__decorateClass([
  Column({ type: "int" })
], Commission.prototype, "commissionAmount", 2);
__decorateClass([
  Column({ type: "varchar", length: 50 })
], Commission.prototype, "calculationVersion", 2);
__decorateClass([
  Column({ type: "varchar", length: 50 })
], Commission.prototype, "status", 2);
__decorateClass([
  CreateDateColumn()
], Commission.prototype, "createdAt", 2);
Commission = __decorateClass([
  Entity("commissions")
], Commission);
var LedgerAccount = class {
};
__decorateClass([
  PrimaryGeneratedColumn("uuid")
], LedgerAccount.prototype, "id", 2);
__decorateClass([
  Index(),
  Column({ type: "uuid" })
], LedgerAccount.prototype, "organizationId", 2);
__decorateClass([
  Index(),
  Column({ type: "uuid", nullable: true })
], LedgerAccount.prototype, "affiliateId", 2);
__decorateClass([
  Column({ type: "varchar", length: 20 })
], LedgerAccount.prototype, "type", 2);
__decorateClass([
  Column({ type: "int", default: 0 })
], LedgerAccount.prototype, "balance", 2);
__decorateClass([
  Column({ type: "varchar", length: 10, default: "USD" })
], LedgerAccount.prototype, "currency", 2);
__decorateClass([
  CreateDateColumn()
], LedgerAccount.prototype, "createdAt", 2);
__decorateClass([
  UpdateDateColumn()
], LedgerAccount.prototype, "updatedAt", 2);
LedgerAccount = __decorateClass([
  Entity("ledger_accounts")
], LedgerAccount);
var LedgerTransaction = class {
};
__decorateClass([
  PrimaryGeneratedColumn("uuid")
], LedgerTransaction.prototype, "id", 2);
__decorateClass([
  Index(),
  Column({ type: "uuid" })
], LedgerTransaction.prototype, "organizationId", 2);
__decorateClass([
  Column({ type: "varchar", length: 50 })
], LedgerTransaction.prototype, "type", 2);
__decorateClass([
  Column({ type: "varchar", length: 500 })
], LedgerTransaction.prototype, "description", 2);
__decorateClass([
  Column({ type: "varchar", length: 255 })
], LedgerTransaction.prototype, "referenceId", 2);
__decorateClass([
  CreateDateColumn()
], LedgerTransaction.prototype, "createdAt", 2);
LedgerTransaction = __decorateClass([
  Entity("ledger_transactions")
], LedgerTransaction);
var LedgerEntry = class {
};
__decorateClass([
  PrimaryGeneratedColumn("uuid")
], LedgerEntry.prototype, "id", 2);
__decorateClass([
  Index(),
  Column({ type: "uuid" })
], LedgerEntry.prototype, "transactionId", 2);
__decorateClass([
  Index(),
  Column({ type: "uuid" })
], LedgerEntry.prototype, "accountId", 2);
__decorateClass([
  Column({ type: "varchar", length: 10 })
], LedgerEntry.prototype, "type", 2);
__decorateClass([
  Column({ type: "int" })
], LedgerEntry.prototype, "amount", 2);
__decorateClass([
  CreateDateColumn()
], LedgerEntry.prototype, "createdAt", 2);
LedgerEntry = __decorateClass([
  Entity("ledger_entries")
], LedgerEntry);
var FraudReview = class {
};
__decorateClass([
  PrimaryGeneratedColumn("uuid")
], FraudReview.prototype, "id", 2);
__decorateClass([
  Index(),
  Column({ type: "uuid" })
], FraudReview.prototype, "organizationId", 2);
__decorateClass([
  Index(),
  Column({ type: "uuid" })
], FraudReview.prototype, "programId", 2);
__decorateClass([
  Index(),
  Column({ type: "uuid" })
], FraudReview.prototype, "conversionId", 2);
__decorateClass([
  Index(),
  Column({ type: "uuid", nullable: true })
], FraudReview.prototype, "assessmentId", 2);
__decorateClass([
  Column({ type: "varchar", length: 50, default: "CONVERSION" /* CONVERSION */ })
], FraudReview.prototype, "entityType", 2);
__decorateClass([
  Column({ type: "uuid", nullable: true })
], FraudReview.prototype, "entityId", 2);
__decorateClass([
  Column({ type: "int" })
], FraudReview.prototype, "fraudScore", 2);
__decorateClass([
  Column({ type: "int", default: 0 })
], FraudReview.prototype, "confidence", 2);
__decorateClass([
  Column({ type: "varchar", length: 50, default: "LOW" /* LOW */ })
], FraudReview.prototype, "riskLevel", 2);
__decorateClass([
  Column({ type: "simple-json" })
], FraudReview.prototype, "signals", 2);
__decorateClass([
  Column({ type: "varchar", length: 50, default: "PENDING" /* PENDING */ })
], FraudReview.prototype, "status", 2);
__decorateClass([
  Column({ type: "uuid", nullable: true })
], FraudReview.prototype, "assignedTo", 2);
__decorateClass([
  Column({ type: "uuid", nullable: true })
], FraudReview.prototype, "reviewedBy", 2);
__decorateClass([
  Column({ type: "varchar", length: 50, nullable: true })
], FraudReview.prototype, "reviewDecision", 2);
__decorateClass([
  Column({ type: "timestamp", nullable: true })
], FraudReview.prototype, "reviewedAt", 2);
__decorateClass([
  Column({ type: "varchar", length: 500, nullable: true })
], FraudReview.prototype, "decisionReason", 2);
__decorateClass([
  Column({ type: "text", nullable: true })
], FraudReview.prototype, "reviewNotes", 2);
__decorateClass([
  CreateDateColumn()
], FraudReview.prototype, "createdAt", 2);
__decorateClass([
  UpdateDateColumn()
], FraudReview.prototype, "updatedAt", 2);
FraudReview = __decorateClass([
  Entity("fraud_reviews")
], FraudReview);
var FraudSettings = class {
};
__decorateClass([
  PrimaryGeneratedColumn("uuid")
], FraudSettings.prototype, "id", 2);
__decorateClass([
  Index(),
  Column({ type: "uuid" })
], FraudSettings.prototype, "organizationId", 2);
__decorateClass([
  Index(),
  Column({ type: "uuid", nullable: true })
], FraudSettings.prototype, "programId", 2);
__decorateClass([
  Column({ type: "boolean", default: true })
], FraudSettings.prototype, "enabled", 2);
__decorateClass([
  Column({ type: "varchar", length: 50, default: "BALANCED" /* BALANCED */ })
], FraudSettings.prototype, "sensitivity", 2);
__decorateClass([
  Column({ type: "int", default: 30 })
], FraudSettings.prototype, "allowMaxScore", 2);
__decorateClass([
  Column({ type: "int", default: 70 })
], FraudSettings.prototype, "reviewMaxScore", 2);
__decorateClass([
  Column({ type: "int", default: 71 })
], FraudSettings.prototype, "blockMinScore", 2);
__decorateClass([
  Column({ type: "int", default: 71 })
], FraudSettings.prototype, "payoutHoldScore", 2);
__decorateClass([
  Column({ type: "simple-json", nullable: true })
], FraudSettings.prototype, "enabledSignals", 2);
__decorateClass([
  Column({ type: "simple-json", nullable: true })
], FraudSettings.prototype, "signalWeights", 2);
__decorateClass([
  Column({ type: "uuid" })
], FraudSettings.prototype, "createdBy", 2);
__decorateClass([
  CreateDateColumn()
], FraudSettings.prototype, "createdAt", 2);
__decorateClass([
  UpdateDateColumn()
], FraudSettings.prototype, "updatedAt", 2);
FraudSettings = __decorateClass([
  Entity("fraud_settings"),
  Unique(["organizationId", "programId"])
], FraudSettings);
var FraudAssessment = class {
};
__decorateClass([
  PrimaryGeneratedColumn("uuid")
], FraudAssessment.prototype, "id", 2);
__decorateClass([
  Index(),
  Column({ type: "uuid" })
], FraudAssessment.prototype, "organizationId", 2);
__decorateClass([
  Index(),
  Column({ type: "uuid" })
], FraudAssessment.prototype, "programId", 2);
__decorateClass([
  Column({ type: "varchar", length: 50 })
], FraudAssessment.prototype, "entityType", 2);
__decorateClass([
  Index(),
  Column({ type: "uuid" })
], FraudAssessment.prototype, "entityId", 2);
__decorateClass([
  Index(),
  Column({ type: "uuid", nullable: true })
], FraudAssessment.prototype, "affiliateId", 2);
__decorateClass([
  Column({ type: "int" })
], FraudAssessment.prototype, "score", 2);
__decorateClass([
  Column({ type: "int" })
], FraudAssessment.prototype, "confidence", 2);
__decorateClass([
  Column({ type: "varchar", length: 50 })
], FraudAssessment.prototype, "riskLevel", 2);
__decorateClass([
  Column({ type: "varchar", length: 50 })
], FraudAssessment.prototype, "decision", 2);
__decorateClass([
  Column({ type: "varchar", length: 50 })
], FraudAssessment.prototype, "engineVersion", 2);
__decorateClass([
  Column({ type: "varchar", length: 50, nullable: true })
], FraudAssessment.prototype, "policyVersion", 2);
__decorateClass([
  Column({ type: "varchar", length: 50 })
], FraudAssessment.prototype, "assessmentType", 2);
__decorateClass([
  Column({ type: "simple-json", nullable: true })
], FraudAssessment.prototype, "categoryScores", 2);
__decorateClass([
  Column({ type: "int", nullable: true })
], FraudAssessment.prototype, "amount", 2);
__decorateClass([
  CreateDateColumn()
], FraudAssessment.prototype, "createdAt", 2);
FraudAssessment = __decorateClass([
  Entity("fraud_assessments")
], FraudAssessment);
var FraudSignal = class {
};
__decorateClass([
  PrimaryGeneratedColumn("uuid")
], FraudSignal.prototype, "id", 2);
__decorateClass([
  Index(),
  Column({ type: "uuid" })
], FraudSignal.prototype, "assessmentId", 2);
__decorateClass([
  Column({ type: "varchar", length: 80 })
], FraudSignal.prototype, "signalCode", 2);
__decorateClass([
  Column({ type: "varchar", length: 50 })
], FraudSignal.prototype, "category", 2);
__decorateClass([
  Column({ type: "boolean" })
], FraudSignal.prototype, "detected", 2);
__decorateClass([
  Column({ type: "int" })
], FraudSignal.prototype, "score", 2);
__decorateClass([
  Column({ type: "int" })
], FraudSignal.prototype, "confidence", 2);
__decorateClass([
  Column({ type: "varchar", length: 1e3 })
], FraudSignal.prototype, "reason", 2);
__decorateClass([
  Column({ type: "simple-json", nullable: true })
], FraudSignal.prototype, "metadata", 2);
__decorateClass([
  CreateDateColumn()
], FraudSignal.prototype, "createdAt", 2);
FraudSignal = __decorateClass([
  Entity("fraud_signals")
], FraudSignal);
var AffiliateTrustHistory = class {
};
__decorateClass([
  PrimaryGeneratedColumn("uuid")
], AffiliateTrustHistory.prototype, "id", 2);
__decorateClass([
  Index(),
  Column({ type: "uuid" })
], AffiliateTrustHistory.prototype, "organizationId", 2);
__decorateClass([
  Index(),
  Column({ type: "uuid" })
], AffiliateTrustHistory.prototype, "affiliateId", 2);
__decorateClass([
  Column({ type: "int" })
], AffiliateTrustHistory.prototype, "previousScore", 2);
__decorateClass([
  Column({ type: "int" })
], AffiliateTrustHistory.prototype, "newScore", 2);
__decorateClass([
  Column({ type: "varchar", length: 500 })
], AffiliateTrustHistory.prototype, "reason", 2);
__decorateClass([
  Column({ type: "varchar", length: 50 })
], AffiliateTrustHistory.prototype, "source", 2);
__decorateClass([
  CreateDateColumn()
], AffiliateTrustHistory.prototype, "createdAt", 2);
AffiliateTrustHistory = __decorateClass([
  Entity("affiliate_trust_history")
], AffiliateTrustHistory);
var FraudMetricRollup = class {
};
__decorateClass([
  PrimaryGeneratedColumn("uuid")
], FraudMetricRollup.prototype, "id", 2);
__decorateClass([
  Index(),
  Column({ type: "uuid" })
], FraudMetricRollup.prototype, "organizationId", 2);
__decorateClass([
  Index(),
  Column({ type: "uuid", nullable: true })
], FraudMetricRollup.prototype, "programId", 2);
__decorateClass([
  Column({ type: "varchar", length: 20 })
], FraudMetricRollup.prototype, "date", 2);
__decorateClass([
  Column({ type: "int", default: 0 })
], FraudMetricRollup.prototype, "assessments", 2);
__decorateClass([
  Column({ type: "int", default: 0 })
], FraudMetricRollup.prototype, "highRiskCount", 2);
__decorateClass([
  Column({ type: "int", default: 0 })
], FraudMetricRollup.prototype, "blockedCount", 2);
__decorateClass([
  Column({ type: "int", default: 0 })
], FraudMetricRollup.prototype, "reviewCount", 2);
__decorateClass([
  Column({ type: "int", default: 0 })
], FraudMetricRollup.prototype, "fraudPreventedAmount", 2);
__decorateClass([
  Column({ type: "int", default: 0 })
], FraudMetricRollup.prototype, "averageScore", 2);
__decorateClass([
  UpdateDateColumn()
], FraudMetricRollup.prototype, "updatedAt", 2);
FraudMetricRollup = __decorateClass([
  Entity("fraud_metric_rollups"),
  Unique(["organizationId", "programId", "date"])
], FraudMetricRollup);
var PayoutBatch = class {
};
__decorateClass([
  PrimaryGeneratedColumn("uuid")
], PayoutBatch.prototype, "id", 2);
__decorateClass([
  Index(),
  Column({ type: "uuid" })
], PayoutBatch.prototype, "organizationId", 2);
__decorateClass([
  Column({ type: "varchar", length: 50 })
], PayoutBatch.prototype, "status", 2);
__decorateClass([
  Column({ type: "int" })
], PayoutBatch.prototype, "totalAmount", 2);
__decorateClass([
  Column({ type: "varchar", length: 10, default: "USD" })
], PayoutBatch.prototype, "currency", 2);
__decorateClass([
  Column({ type: "uuid" })
], PayoutBatch.prototype, "createdBy", 2);
__decorateClass([
  CreateDateColumn()
], PayoutBatch.prototype, "createdAt", 2);
__decorateClass([
  UpdateDateColumn()
], PayoutBatch.prototype, "updatedAt", 2);
PayoutBatch = __decorateClass([
  Entity("payout_batches")
], PayoutBatch);
var PayoutItem = class {
};
__decorateClass([
  PrimaryGeneratedColumn("uuid")
], PayoutItem.prototype, "id", 2);
__decorateClass([
  Index(),
  Column({ type: "uuid" })
], PayoutItem.prototype, "batchId", 2);
__decorateClass([
  Index(),
  Column({ type: "uuid" })
], PayoutItem.prototype, "organizationId", 2);
__decorateClass([
  Index(),
  Column({ type: "uuid" })
], PayoutItem.prototype, "affiliateId", 2);
__decorateClass([
  Column({ type: "int" })
], PayoutItem.prototype, "amount", 2);
__decorateClass([
  Column({ type: "varchar", length: 10, default: "USD" })
], PayoutItem.prototype, "currency", 2);
__decorateClass([
  Column({ type: "varchar", length: 50 })
], PayoutItem.prototype, "status", 2);
__decorateClass([
  Column({ type: "varchar", length: 255, nullable: true })
], PayoutItem.prototype, "providerReference", 2);
__decorateClass([
  CreateDateColumn()
], PayoutItem.prototype, "createdAt", 2);
PayoutItem = __decorateClass([
  Entity("payout_items")
], PayoutItem);
var WebhookEndpoint = class {
};
__decorateClass([
  PrimaryGeneratedColumn("uuid")
], WebhookEndpoint.prototype, "id", 2);
__decorateClass([
  Index(),
  Column({ type: "uuid" })
], WebhookEndpoint.prototype, "organizationId", 2);
__decorateClass([
  Column({ type: "varchar", length: 2e3 })
], WebhookEndpoint.prototype, "url", 2);
__decorateClass([
  Column({ type: "varchar", length: 255 })
], WebhookEndpoint.prototype, "secretHash", 2);
__decorateClass([
  Column({ type: "text" })
], WebhookEndpoint.prototype, "secretEncrypted", 2);
__decorateClass([
  Column({ type: "boolean", default: true })
], WebhookEndpoint.prototype, "enabled", 2);
__decorateClass([
  Column({ type: "simple-array" })
], WebhookEndpoint.prototype, "subscribedEvents", 2);
__decorateClass([
  CreateDateColumn()
], WebhookEndpoint.prototype, "createdAt", 2);
WebhookEndpoint = __decorateClass([
  Entity("webhook_endpoints")
], WebhookEndpoint);
var WebhookDelivery = class {
};
__decorateClass([
  PrimaryGeneratedColumn("uuid")
], WebhookDelivery.prototype, "id", 2);
__decorateClass([
  Index(),
  Column({ type: "uuid" })
], WebhookDelivery.prototype, "endpointId", 2);
__decorateClass([
  Column({ type: "varchar", length: 255 })
], WebhookDelivery.prototype, "eventId", 2);
__decorateClass([
  Column({ type: "int" })
], WebhookDelivery.prototype, "attempt", 2);
__decorateClass([
  Column({ type: "simple-json" })
], WebhookDelivery.prototype, "requestBody", 2);
__decorateClass([
  Column({ type: "int" })
], WebhookDelivery.prototype, "responseCode", 2);
__decorateClass([
  Column({ type: "text", nullable: true })
], WebhookDelivery.prototype, "responseBodyTruncated", 2);
__decorateClass([
  Column({ type: "int" })
], WebhookDelivery.prototype, "durationMs", 2);
__decorateClass([
  Column({ type: "varchar", length: 50 })
], WebhookDelivery.prototype, "status", 2);
__decorateClass([
  CreateDateColumn()
], WebhookDelivery.prototype, "createdAt", 2);
WebhookDelivery = __decorateClass([
  Entity("webhook_deliveries")
], WebhookDelivery);
var AuditLog = class {
};
__decorateClass([
  PrimaryGeneratedColumn("uuid")
], AuditLog.prototype, "id", 2);
__decorateClass([
  Index(),
  Column({ type: "uuid", nullable: true })
], AuditLog.prototype, "organizationId", 2);
__decorateClass([
  Column({ type: "varchar", length: 20 })
], AuditLog.prototype, "actorType", 2);
__decorateClass([
  Column({ type: "uuid" })
], AuditLog.prototype, "actorId", 2);
__decorateClass([
  Column({ type: "varchar", length: 100 })
], AuditLog.prototype, "action", 2);
__decorateClass([
  Column({ type: "varchar", length: 100 })
], AuditLog.prototype, "resourceType", 2);
__decorateClass([
  Column({ type: "varchar", length: 255 })
], AuditLog.prototype, "resourceId", 2);
__decorateClass([
  Column({ type: "varchar", length: 255, nullable: true })
], AuditLog.prototype, "ipAddress", 2);
__decorateClass([
  Column({ type: "varchar", length: 255, nullable: true })
], AuditLog.prototype, "userAgent", 2);
__decorateClass([
  Column({ type: "simple-json", nullable: true })
], AuditLog.prototype, "metadata", 2);
__decorateClass([
  CreateDateColumn()
], AuditLog.prototype, "createdAt", 2);
AuditLog = __decorateClass([
  Entity("audit_logs")
], AuditLog);
var PublicKey = class {
};
__decorateClass([
  PrimaryGeneratedColumn("uuid")
], PublicKey.prototype, "id", 2);
__decorateClass([
  Index(),
  Column({ type: "uuid" })
], PublicKey.prototype, "organizationId", 2);
__decorateClass([
  Index(),
  Column({ type: "uuid" })
], PublicKey.prototype, "programId", 2);
__decorateClass([
  Column({ type: "varchar", length: 255 })
], PublicKey.prototype, "key", 2);
__decorateClass([
  Column({ type: "simple-array" })
], PublicKey.prototype, "allowedDomains", 2);
__decorateClass([
  Column({ type: "varchar", length: 20 })
], PublicKey.prototype, "environment", 2);
__decorateClass([
  CreateDateColumn()
], PublicKey.prototype, "createdAt", 2);
PublicKey = __decorateClass([
  Entity("public_keys")
], PublicKey);
var Integration = class {
};
__decorateClass([
  PrimaryGeneratedColumn("uuid")
], Integration.prototype, "id", 2);
__decorateClass([
  Index({ unique: true }),
  Column({ type: "varchar", length: 80 })
], Integration.prototype, "code", 2);
__decorateClass([
  Column({ type: "varchar", length: 120 })
], Integration.prototype, "name", 2);
__decorateClass([
  Index({ unique: true }),
  Column({ type: "varchar", length: 120 })
], Integration.prototype, "slug", 2);
__decorateClass([
  Column({ type: "text", nullable: true })
], Integration.prototype, "description", 2);
__decorateClass([
  Column({ type: "varchar", length: 50 })
], Integration.prototype, "category", 2);
__decorateClass([
  Column({ type: "varchar", length: 120 })
], Integration.prototype, "provider", 2);
__decorateClass([
  Column({ type: "varchar", length: 50, default: "COMING_SOON" /* COMING_SOON */ })
], Integration.prototype, "status", 2);
__decorateClass([
  Column({ type: "simple-json" })
], Integration.prototype, "connectionTypes", 2);
__decorateClass([
  Column({ type: "boolean", default: false })
], Integration.prototype, "supportsOAuth", 2);
__decorateClass([
  Column({ type: "boolean", default: false })
], Integration.prototype, "supportsWebhooks", 2);
__decorateClass([
  Column({ type: "boolean", default: false })
], Integration.prototype, "supportsApiKey", 2);
__decorateClass([
  Column({ type: "varchar", length: 500, nullable: true })
], Integration.prototype, "documentationUrl", 2);
__decorateClass([
  Column({ type: "varchar", length: 80, nullable: true })
], Integration.prototype, "iconKey", 2);
__decorateClass([
  Column({ type: "int", default: 1e3 })
], Integration.prototype, "displayOrder", 2);
__decorateClass([
  CreateDateColumn()
], Integration.prototype, "createdAt", 2);
__decorateClass([
  UpdateDateColumn()
], Integration.prototype, "updatedAt", 2);
Integration = __decorateClass([
  Entity("integrations")
], Integration);
var OrganizationIntegration = class {
};
__decorateClass([
  PrimaryGeneratedColumn("uuid")
], OrganizationIntegration.prototype, "id", 2);
__decorateClass([
  Index(),
  Column({ type: "uuid" })
], OrganizationIntegration.prototype, "organizationId", 2);
__decorateClass([
  Index(),
  Column({ type: "uuid" })
], OrganizationIntegration.prototype, "integrationId", 2);
__decorateClass([
  Index({ unique: true }),
  Column({ type: "varchar", length: 120 })
], OrganizationIntegration.prototype, "publicId", 2);
__decorateClass([
  Column({ type: "varchar", length: 50, default: "PENDING" /* PENDING */ })
], OrganizationIntegration.prototype, "status", 2);
__decorateClass([
  Column({ type: "varchar", length: 50, default: "TEST" /* TEST */ })
], OrganizationIntegration.prototype, "environment", 2);
__decorateClass([
  Column({ type: "simple-json", nullable: true })
], OrganizationIntegration.prototype, "config", 2);
__decorateClass([
  Column({ type: "timestamp", nullable: true })
], OrganizationIntegration.prototype, "connectedAt", 2);
__decorateClass([
  Column({ type: "timestamp", nullable: true })
], OrganizationIntegration.prototype, "lastSyncAt", 2);
__decorateClass([
  Column({ type: "timestamp", nullable: true })
], OrganizationIntegration.prototype, "lastWebhookAt", 2);
__decorateClass([
  Column({ type: "text", nullable: true })
], OrganizationIntegration.prototype, "lastError", 2);
__decorateClass([
  Column({ type: "uuid", nullable: true })
], OrganizationIntegration.prototype, "createdBy", 2);
__decorateClass([
  CreateDateColumn()
], OrganizationIntegration.prototype, "createdAt", 2);
__decorateClass([
  UpdateDateColumn()
], OrganizationIntegration.prototype, "updatedAt", 2);
OrganizationIntegration = __decorateClass([
  Entity("organization_integrations"),
  Unique(["organizationId", "integrationId", "environment"])
], OrganizationIntegration);
var IntegrationCredential = class {
};
__decorateClass([
  PrimaryGeneratedColumn("uuid")
], IntegrationCredential.prototype, "id", 2);
__decorateClass([
  Index(),
  Column({ type: "uuid" })
], IntegrationCredential.prototype, "organizationIntegrationId", 2);
__decorateClass([
  Column({ type: "varchar", length: 120 })
], IntegrationCredential.prototype, "credentialKey", 2);
__decorateClass([
  Column({ type: "text" })
], IntegrationCredential.prototype, "encryptedValue", 2);
__decorateClass([
  Column({ type: "varchar", length: 64 })
], IntegrationCredential.prototype, "iv", 2);
__decorateClass([
  Column({ type: "varchar", length: 64 })
], IntegrationCredential.prototype, "authTag", 2);
__decorateClass([
  Column({ type: "int", default: 1 })
], IntegrationCredential.prototype, "keyVersion", 2);
__decorateClass([
  CreateDateColumn()
], IntegrationCredential.prototype, "createdAt", 2);
__decorateClass([
  UpdateDateColumn()
], IntegrationCredential.prototype, "updatedAt", 2);
IntegrationCredential = __decorateClass([
  Entity("integration_credentials"),
  Unique(["organizationIntegrationId", "credentialKey"])
], IntegrationCredential);
var IntegrationEvent = class {
};
__decorateClass([
  PrimaryGeneratedColumn("uuid")
], IntegrationEvent.prototype, "id", 2);
__decorateClass([
  Index(),
  Column({ type: "uuid" })
], IntegrationEvent.prototype, "organizationId", 2);
__decorateClass([
  Index(),
  Column({ type: "uuid" })
], IntegrationEvent.prototype, "integrationId", 2);
__decorateClass([
  Index(),
  Column({ type: "uuid" })
], IntegrationEvent.prototype, "organizationIntegrationId", 2);
__decorateClass([
  Column({ type: "varchar", length: 255 })
], IntegrationEvent.prototype, "externalEventId", 2);
__decorateClass([
  Column({ type: "varchar", length: 120 })
], IntegrationEvent.prototype, "eventType", 2);
__decorateClass([
  Column({ type: "varchar", length: 120, nullable: true })
], IntegrationEvent.prototype, "normalizedType", 2);
__decorateClass([
  Column({ type: "varchar", length: 80, nullable: true })
], IntegrationEvent.prototype, "payloadHash", 2);
__decorateClass([
  Column({ type: "varchar", length: 500, nullable: true })
], IntegrationEvent.prototype, "payloadReference", 2);
__decorateClass([
  Column({ type: "varchar", length: 50, default: "RECEIVED" /* RECEIVED */ })
], IntegrationEvent.prototype, "status", 2);
__decorateClass([
  Column({ type: "int", default: 0 })
], IntegrationEvent.prototype, "processingMs", 2);
__decorateClass([
  Column({ type: "text", nullable: true })
], IntegrationEvent.prototype, "error", 2);
__decorateClass([
  Column({ type: "simple-json", nullable: true })
], IntegrationEvent.prototype, "metadata", 2);
__decorateClass([
  CreateDateColumn()
], IntegrationEvent.prototype, "createdAt", 2);
__decorateClass([
  UpdateDateColumn()
], IntegrationEvent.prototype, "updatedAt", 2);
IntegrationEvent = __decorateClass([
  Entity("integration_events"),
  Unique(["organizationIntegrationId", "externalEventId"])
], IntegrationEvent);
var IntegrationOAuthState = class {
};
__decorateClass([
  PrimaryGeneratedColumn("uuid")
], IntegrationOAuthState.prototype, "id", 2);
__decorateClass([
  Index(),
  Column({ type: "uuid" })
], IntegrationOAuthState.prototype, "organizationId", 2);
__decorateClass([
  Index(),
  Column({ type: "uuid" })
], IntegrationOAuthState.prototype, "integrationId", 2);
__decorateClass([
  Index({ unique: true }),
  Column({ type: "varchar", length: 255 })
], IntegrationOAuthState.prototype, "state", 2);
__decorateClass([
  Column({ type: "varchar", length: 500, nullable: true })
], IntegrationOAuthState.prototype, "redirectUrl", 2);
__decorateClass([
  Column({ type: "timestamp" })
], IntegrationOAuthState.prototype, "expiresAt", 2);
__decorateClass([
  Column({ type: "timestamp", nullable: true })
], IntegrationOAuthState.prototype, "consumedAt", 2);
__decorateClass([
  CreateDateColumn()
], IntegrationOAuthState.prototype, "createdAt", 2);
IntegrationOAuthState = __decorateClass([
  Entity("integration_oauth_states")
], IntegrationOAuthState);

// src/database/schema-rbac.ts
import { Entity as Entity2, PrimaryGeneratedColumn as PrimaryGeneratedColumn2, Column as Column2, CreateDateColumn as CreateDateColumn2, Index as Index2, Unique as Unique2 } from "typeorm";
var RoleDefinition = class {
};
__decorateClass([
  PrimaryGeneratedColumn2("uuid")
], RoleDefinition.prototype, "id", 2);
__decorateClass([
  Index2(),
  Column2({ type: "uuid", nullable: true })
], RoleDefinition.prototype, "organizationId", 2);
__decorateClass([
  Column2({ type: "varchar", length: 255 })
], RoleDefinition.prototype, "name", 2);
__decorateClass([
  Column2({ type: "varchar", length: 100 })
], RoleDefinition.prototype, "code", 2);
__decorateClass([
  Column2({ type: "varchar", length: 500, nullable: true })
], RoleDefinition.prototype, "description", 2);
__decorateClass([
  Column2({ type: "varchar", length: 50, default: "SYSTEM" /* SYSTEM */ })
], RoleDefinition.prototype, "type", 2);
__decorateClass([
  Column2({ type: "boolean", default: false })
], RoleDefinition.prototype, "isSystem", 2);
__decorateClass([
  Column2({ type: "boolean", default: true })
], RoleDefinition.prototype, "isEditable", 2);
__decorateClass([
  Column2({ type: "uuid", nullable: true })
], RoleDefinition.prototype, "createdBy", 2);
__decorateClass([
  CreateDateColumn2()
], RoleDefinition.prototype, "createdAt", 2);
RoleDefinition = __decorateClass([
  Entity2("roles"),
  Unique2(["organizationId", "code"])
], RoleDefinition);
var PermissionDefinition = class {
};
__decorateClass([
  PrimaryGeneratedColumn2("uuid")
], PermissionDefinition.prototype, "id", 2);
__decorateClass([
  Column2({ type: "varchar", length: 100 })
], PermissionDefinition.prototype, "code", 2);
__decorateClass([
  Column2({ type: "varchar", length: 100 })
], PermissionDefinition.prototype, "resource", 2);
__decorateClass([
  Column2({ type: "varchar", length: 100 })
], PermissionDefinition.prototype, "action", 2);
__decorateClass([
  Column2({ type: "varchar", length: 500, nullable: true })
], PermissionDefinition.prototype, "description", 2);
__decorateClass([
  CreateDateColumn2()
], PermissionDefinition.prototype, "createdAt", 2);
PermissionDefinition = __decorateClass([
  Entity2("permissions"),
  Unique2(["code"])
], PermissionDefinition);
var RolePermission = class {
};
__decorateClass([
  PrimaryGeneratedColumn2("uuid")
], RolePermission.prototype, "id", 2);
__decorateClass([
  Index2(),
  Column2({ type: "uuid" })
], RolePermission.prototype, "roleId", 2);
__decorateClass([
  Index2(),
  Column2({ type: "uuid" })
], RolePermission.prototype, "permissionId", 2);
__decorateClass([
  CreateDateColumn2()
], RolePermission.prototype, "createdAt", 2);
RolePermission = __decorateClass([
  Entity2("role_permissions"),
  Unique2(["roleId", "permissionId"])
], RolePermission);
var OrganizationPolicy = class {
};
__decorateClass([
  PrimaryGeneratedColumn2("uuid")
], OrganizationPolicy.prototype, "id", 2);
__decorateClass([
  Index2(),
  Column2({ type: "uuid" })
], OrganizationPolicy.prototype, "organizationId", 2);
__decorateClass([
  Column2({ type: "varchar", length: 255 })
], OrganizationPolicy.prototype, "name", 2);
__decorateClass([
  Column2({ type: "varchar", length: 100 })
], OrganizationPolicy.prototype, "resource", 2);
__decorateClass([
  Column2({ type: "varchar", length: 100 })
], OrganizationPolicy.prototype, "action", 2);
__decorateClass([
  Column2({ type: "simple-json" })
], OrganizationPolicy.prototype, "conditions", 2);
__decorateClass([
  Column2({ type: "varchar", length: 50, default: "ALLOW" /* ALLOW */ })
], OrganizationPolicy.prototype, "effect", 2);
__decorateClass([
  Column2({ type: "int", default: 100 })
], OrganizationPolicy.prototype, "priority", 2);
__decorateClass([
  Column2({ type: "boolean", default: true })
], OrganizationPolicy.prototype, "enabled", 2);
__decorateClass([
  Column2({ type: "uuid", nullable: true })
], OrganizationPolicy.prototype, "createdBy", 2);
__decorateClass([
  CreateDateColumn2()
], OrganizationPolicy.prototype, "createdAt", 2);
OrganizationPolicy = __decorateClass([
  Entity2("organization_policies")
], OrganizationPolicy);
var OrganizationInvitation = class {
};
__decorateClass([
  PrimaryGeneratedColumn2("uuid")
], OrganizationInvitation.prototype, "id", 2);
__decorateClass([
  Index2(),
  Column2({ type: "uuid" })
], OrganizationInvitation.prototype, "organizationId", 2);
__decorateClass([
  Column2({ type: "varchar", length: 255 })
], OrganizationInvitation.prototype, "email", 2);
__decorateClass([
  Index2(),
  Column2({ type: "uuid" })
], OrganizationInvitation.prototype, "roleId", 2);
__decorateClass([
  Column2({ type: "varchar", length: 50, default: "ALL" /* ALL */ })
], OrganizationInvitation.prototype, "programAccessType", 2);
__decorateClass([
  Column2({ type: "simple-array", nullable: true })
], OrganizationInvitation.prototype, "programIds", 2);
__decorateClass([
  Column2({ type: "varchar", length: 255 })
], OrganizationInvitation.prototype, "tokenHash", 2);
__decorateClass([
  Column2({ type: "timestamp" })
], OrganizationInvitation.prototype, "expiresAt", 2);
__decorateClass([
  Column2({ type: "uuid" })
], OrganizationInvitation.prototype, "invitedBy", 2);
__decorateClass([
  Column2({ type: "timestamp", nullable: true })
], OrganizationInvitation.prototype, "acceptedAt", 2);
__decorateClass([
  Column2({ type: "timestamp", nullable: true })
], OrganizationInvitation.prototype, "revokedAt", 2);
__decorateClass([
  CreateDateColumn2()
], OrganizationInvitation.prototype, "createdAt", 2);
OrganizationInvitation = __decorateClass([
  Entity2("organization_invitations")
], OrganizationInvitation);

// src/database/data-source.ts
dotenv.config();
var databaseUrl = process.env.DATABASE_URL;
var databaseHost = process.env.DATABASE_HOST || process.env.PLANETSCALE_DB_HOST || "localhost";
var databasePort = parseInt(process.env.DATABASE_PORT || "3306", 10);
var databaseUsername = process.env.DATABASE_USER || process.env.PLANETSCALE_DB_USERNAME || "root";
var databasePassword = process.env.DATABASE_PASSWORD || process.env.PLANETSCALE_DB_PASSWORD || "";
var databaseName = process.env.DATABASE_NAME || process.env.PLANETSCALE_DB || "partner_db";
var databaseSsl = process.env.DATABASE_SSL === "true" || Boolean(process.env.DATABASE_URL || process.env.PLANETSCALE_DB_HOST) ? { rejectUnauthorized: true } : void 0;
var AppDataSource = new DataSource({
  type: "mysql",
  ...databaseUrl ? { url: databaseUrl } : {
    host: databaseHost,
    port: databasePort,
    username: databaseUsername,
    password: databasePassword,
    database: databaseName
  },
  ssl: databaseSsl,
  synchronize: true,
  logging: false,
  entities: [
    User,
    Organization,
    OrganizationMembership,
    AuthSession,
    Program,
    Affiliate,
    ProgramAffiliate,
    AffiliateApplication,
    TrackingLink,
    Click,
    Attribution,
    ApiKey,
    IdempotencyKey,
    Conversion,
    CommissionRule,
    Commission,
    LedgerAccount,
    LedgerTransaction,
    LedgerEntry,
    FraudReview,
    FraudSettings,
    FraudAssessment,
    FraudSignal,
    AffiliateTrustHistory,
    FraudMetricRollup,
    PayoutBatch,
    PayoutItem,
    WebhookEndpoint,
    WebhookDelivery,
    AuditLog,
    PublicKey,
    Integration,
    OrganizationIntegration,
    IntegrationCredential,
    IntegrationEvent,
    IntegrationOAuthState,
    RoleDefinition,
    PermissionDefinition,
    RolePermission,
    OrganizationPolicy,
    OrganizationInvitation
  ],
  migrations: ["src/database/migrations/*.ts"],
  migrationsRun: false
});
async function initializeDataSource() {
  if (!AppDataSource.isInitialized) {
    await AppDataSource.initialize();
  }
  return AppDataSource;
}

// src/common/guards/jwt-auth.guard.ts
var jwt = jwtPkg.default || jwtPkg;
var JwtAuthGuard = class {
  async canActivate(context) {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      throw new UnauthorizedException("Missing or invalid Authorization header");
    }
    const token = authHeader.split(" ")[1];
    const jwtConfig = getJwtConfig();
    try {
      const decoded = jwt.verify(token, jwtConfig.accessSecret);
      if (decoded.type !== "access") {
        throw new UnauthorizedException("Invalid token type");
      }
      const dataSource = await initializeDataSource();
      const user = await dataSource.getRepository(User).findOne({
        where: { id: decoded.sub, deletedAt: IsNull() }
      });
      if (!user || user.status === "LOCKED") {
        throw new UnauthorizedException("User account is invalid or locked");
      }
      request.user = {
        userId: user.id,
        email: user.email,
        sessionId: decoded.sid,
        platformRole: user.platformRole,
        isSuperAdmin: user.platformRole === "SUPER_ADMIN" /* SUPER_ADMIN */,
        isApiKey: false
      };
      return true;
    } catch (err) {
      throw new UnauthorizedException("Token verification failed or expired");
    }
  }
};
JwtAuthGuard = __decorateClass([
  Injectable()
], JwtAuthGuard);

// src/common/decorators/current-user.decorator.ts
import { createParamDecorator } from "@nestjs/common";
var CurrentUser = createParamDecorator(
  (data, ctx) => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  }
);

// src/config/app.config.ts
var getAppConfig = () => {
  const origins = process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(",").map((o) => o.trim()) : ["http://localhost:3000", "http://localhost:3001"];
  return {
    env: process.env.NODE_ENV || "development",
    port: parseInt(process.env.PORT || "5000", 10),
    appUrl: process.env.APP_URL || "http://localhost:5000",
    frontendUrl: process.env.FRONTEND_URL || "http://localhost:3000",
    corsOrigins: origins,
    cookieSecure: process.env.AUTH_COOKIE_SECURE === "true",
    cookieSameSite: process.env.AUTH_COOKIE_SAME_SITE || "lax"
  };
};

// src/modules/auth/auth.controller.ts
var AuthController = class {
  constructor(authService) {
    this.authService = authService;
  }
  refreshCookieOptions(maxAge) {
    const appConfig = getAppConfig();
    return {
      httpOnly: true,
      secure: appConfig.cookieSecure,
      sameSite: appConfig.cookieSameSite,
      path: "/",
      ...maxAge !== void 0 ? { maxAge } : {}
    };
  }
  async register(dto, req, res) {
    const userAgent = req.headers["user-agent"];
    const ipAddress = req.ip || req.headers["x-forwarded-for"];
    const result = await this.authService.register(dto, userAgent, ipAddress);
    res.cookie("refreshToken", result.refreshToken, this.refreshCookieOptions(7 * 24 * 3600 * 1e3));
    return result;
  }
  async login(dto, req, res) {
    const userAgent = req.headers["user-agent"];
    const ipAddress = req.ip || req.headers["x-forwarded-for"];
    const result = await this.authService.login(dto, userAgent, ipAddress);
    res.cookie("refreshToken", result.refreshToken, this.refreshCookieOptions(7 * 24 * 3600 * 1e3));
    return result;
  }
  async refresh(dto, req, res) {
    const refreshToken = dto?.refreshToken || req.cookies?.refreshToken;
    const userAgent = req.headers["user-agent"];
    const ipAddress = req.ip || req.headers["x-forwarded-for"];
    const result = await this.authService.refreshToken(refreshToken, userAgent, ipAddress);
    res.cookie("refreshToken", result.refreshToken, this.refreshCookieOptions(7 * 24 * 3600 * 1e3));
    return result;
  }
  async logout(user, res) {
    res.clearCookie("refreshToken", this.refreshCookieOptions());
    return this.authService.logout(user.sessionId);
  }
  async logoutAll(user, res) {
    res.clearCookie("refreshToken", this.refreshCookieOptions());
    return this.authService.logoutAll(user.userId);
  }
  async getMe(user) {
    return this.authService.getMe(user.userId);
  }
  async getSessions(user) {
    return this.authService.getSessions(user.userId, user.sessionId);
  }
  async revokeSession(user, sessionId) {
    return this.authService.revokeSession(user.userId, sessionId);
  }
  async changePassword(user, dto) {
    return this.authService.changePassword(user.userId, dto);
  }
  async forgotPassword(dto) {
    return { success: true, message: "If an account exists, a reset link has been sent." };
  }
  async resetPassword(dto) {
    return { success: true, message: "Password reset successfully" };
  }
  async verifyEmail(dto) {
    return { success: true, message: "Email verified successfully" };
  }
};
__decorateClass([
  Post("register"),
  ApiOperation({ summary: "Register a new user" }),
  __decorateParam(0, Body()),
  __decorateParam(1, Req()),
  __decorateParam(2, Res({ passthrough: true }))
], AuthController.prototype, "register", 1);
__decorateClass([
  Post("login"),
  HttpCode(HttpStatus.OK),
  ApiOperation({ summary: "User login with password" }),
  __decorateParam(0, Body()),
  __decorateParam(1, Req()),
  __decorateParam(2, Res({ passthrough: true }))
], AuthController.prototype, "login", 1);
__decorateClass([
  Post("refresh"),
  HttpCode(HttpStatus.OK),
  ApiOperation({ summary: "Refresh access token using rotating refresh token" }),
  __decorateParam(0, Body()),
  __decorateParam(1, Req()),
  __decorateParam(2, Res({ passthrough: true }))
], AuthController.prototype, "refresh", 1);
__decorateClass([
  Post("logout"),
  HttpCode(HttpStatus.OK),
  UseGuards(JwtAuthGuard),
  ApiBearerAuth(),
  ApiOperation({ summary: "Logout current session" }),
  __decorateParam(0, CurrentUser()),
  __decorateParam(1, Res({ passthrough: true }))
], AuthController.prototype, "logout", 1);
__decorateClass([
  Post("logout-all"),
  HttpCode(HttpStatus.OK),
  UseGuards(JwtAuthGuard),
  ApiBearerAuth(),
  ApiOperation({ summary: "Revoke all sessions for current user" }),
  __decorateParam(0, CurrentUser()),
  __decorateParam(1, Res({ passthrough: true }))
], AuthController.prototype, "logoutAll", 1);
__decorateClass([
  Get("me"),
  UseGuards(JwtAuthGuard),
  ApiBearerAuth(),
  ApiOperation({ summary: "Get current user profile and memberships" }),
  __decorateParam(0, CurrentUser())
], AuthController.prototype, "getMe", 1);
__decorateClass([
  Get("sessions"),
  UseGuards(JwtAuthGuard),
  ApiBearerAuth(),
  ApiOperation({ summary: "List all active sessions for current user" }),
  __decorateParam(0, CurrentUser())
], AuthController.prototype, "getSessions", 1);
__decorateClass([
  Delete("sessions/:sessionId"),
  UseGuards(JwtAuthGuard),
  ApiBearerAuth(),
  ApiOperation({ summary: "Revoke a specific session" }),
  __decorateParam(0, CurrentUser()),
  __decorateParam(1, Param("sessionId"))
], AuthController.prototype, "revokeSession", 1);
__decorateClass([
  Post("change-password"),
  HttpCode(HttpStatus.OK),
  UseGuards(JwtAuthGuard),
  ApiBearerAuth(),
  ApiOperation({ summary: "Change password for authenticated user" }),
  __decorateParam(0, CurrentUser()),
  __decorateParam(1, Body())
], AuthController.prototype, "changePassword", 1);
__decorateClass([
  Post("forgot-password"),
  HttpCode(HttpStatus.OK),
  ApiOperation({ summary: "Initiate forgot password reset email" }),
  __decorateParam(0, Body())
], AuthController.prototype, "forgotPassword", 1);
__decorateClass([
  Post("reset-password"),
  HttpCode(HttpStatus.OK),
  ApiOperation({ summary: "Reset password using token" }),
  __decorateParam(0, Body())
], AuthController.prototype, "resetPassword", 1);
__decorateClass([
  Post("verify-email"),
  HttpCode(HttpStatus.OK),
  ApiOperation({ summary: "Verify user email with token" }),
  __decorateParam(0, Body())
], AuthController.prototype, "verifyEmail", 1);
AuthController = __decorateClass([
  ApiTags("Authentication"),
  Controller("api/v1/auth")
], AuthController);

// src/modules/auth/auth.service.ts
import {
  Injectable as Injectable2,
  UnauthorizedException as UnauthorizedException2,
  BadRequestException,
  ForbiddenException,
  NotFoundException
} from "@nestjs/common";
import jwtPkg2 from "jsonwebtoken";
import { IsNull as IsNull2 } from "typeorm";
import { v4 as uuidv4 } from "uuid";

// src/database/store.ts
var DBBackedArray = class _DBBackedArray extends Array {
  persist(items) {
    const values = Array.isArray(items) ? items : [items];
    this.repo.upsert(values, ["id"]).catch((err) => {
      console.error("dbStore save error:", err);
    });
  }
  constructor(repo, items = []) {
    super(...items.map((item) => _DBBackedArray.wrapEntity(repo, item)));
    Object.setPrototypeOf(this, _DBBackedArray.prototype);
    this.repo = repo;
  }
  static wrapEntity(repo, item) {
    if (item.__dbStoreProxy) {
      return item;
    }
    Object.defineProperty(item, "__dbStoreProxy", {
      value: true,
      enumerable: false,
      configurable: false,
      writable: false
    });
    const proxy = new Proxy(item, {
      set(target, property, value) {
        const result = Reflect.set(target, property, value);
        if (property !== "id") {
          repo.upsert(target, ["id"]).catch((err) => {
            console.error("dbStore save error:", err);
          });
        }
        return result;
      }
    });
    return proxy;
  }
  push(...items) {
    const wrapped = items.map((item) => _DBBackedArray.wrapEntity(this.repo, item));
    this.persist(items);
    return super.push(...wrapped);
  }
  unshift(...items) {
    const wrapped = items.map((item) => _DBBackedArray.wrapEntity(this.repo, item));
    this.persist(items);
    return super.unshift(...wrapped);
  }
  splice(start, deleteCount, ...items) {
    const wrapped = items.map((item) => _DBBackedArray.wrapEntity(this.repo, item));
    const removed = super.splice(start, deleteCount === void 0 ? this.length - start : deleteCount, ...wrapped);
    if (items.length > 0) {
      this.persist(items);
    }
    return removed;
  }
};
var InMemoryDataStore = class _InMemoryDataStore {
  constructor() {
    this.initialized = false;
    this.users = [];
    this.organizations = [];
    this.organizationMemberships = [];
    this.authSessions = [];
    this.programs = [];
    this.affiliates = [];
    this.programAffiliates = [];
    this.affiliateApplications = [];
    this.trackingLinks = [];
    this.clicks = [];
    this.attributions = [];
    this.apiKeys = [];
    this.idempotencyKeys = [];
    this.conversions = [];
    this.commissionRules = [];
    this.commissions = [];
    this.ledgerAccounts = [];
    this.ledgerTransactions = [];
    this.ledgerEntries = [];
    this.fraudReviews = [];
    this.fraudSettings = [];
    this.fraudAssessments = [];
    this.fraudSignals = [];
    this.affiliateTrustHistory = [];
    this.fraudMetricRollups = [];
    this.payoutBatches = [];
    this.payoutItems = [];
    this.webhookEndpoints = [];
    this.webhookDeliveries = [];
    this.auditLogs = [];
    this.publicKeys = [];
    this.integrations = [];
    this.organizationIntegrations = [];
    this.integrationCredentials = [];
    this.integrationEvents = [];
    this.integrationOAuthStates = [];
    this.roles = [];
    this.permissions = [];
    this.rolePermissions = [];
    this.organizationPolicies = [];
    this.organizationInvitations = [];
    // Counter maps for Redis rate-limit/fraud tracking
    this.ipClickCounters = /* @__PURE__ */ new Map();
    this.affiliateClickCounters = /* @__PURE__ */ new Map();
  }
  static {
    this.instance = new _InMemoryDataStore();
  }
  async initialize() {
    if (this.initialized) {
      return;
    }
    await initializeDataSource();
    this.users = new DBBackedArray(AppDataSource.getRepository(User), await AppDataSource.getRepository(User).find());
    this.organizations = new DBBackedArray(
      AppDataSource.getRepository(Organization),
      await AppDataSource.getRepository(Organization).find()
    );
    this.organizationMemberships = new DBBackedArray(
      AppDataSource.getRepository(OrganizationMembership),
      await AppDataSource.getRepository(OrganizationMembership).find()
    );
    this.authSessions = new DBBackedArray(AppDataSource.getRepository(AuthSession), await AppDataSource.getRepository(AuthSession).find());
    this.programs = new DBBackedArray(AppDataSource.getRepository(Program), await AppDataSource.getRepository(Program).find());
    this.affiliates = new DBBackedArray(AppDataSource.getRepository(Affiliate), await AppDataSource.getRepository(Affiliate).find());
    this.programAffiliates = new DBBackedArray(
      AppDataSource.getRepository(ProgramAffiliate),
      await AppDataSource.getRepository(ProgramAffiliate).find()
    );
    this.affiliateApplications = new DBBackedArray(
      AppDataSource.getRepository(AffiliateApplication),
      await AppDataSource.getRepository(AffiliateApplication).find()
    );
    this.trackingLinks = new DBBackedArray(
      AppDataSource.getRepository(TrackingLink),
      await AppDataSource.getRepository(TrackingLink).find()
    );
    this.clicks = new DBBackedArray(AppDataSource.getRepository(Click), await AppDataSource.getRepository(Click).find());
    this.attributions = new DBBackedArray(AppDataSource.getRepository(Attribution), await AppDataSource.getRepository(Attribution).find());
    this.apiKeys = new DBBackedArray(AppDataSource.getRepository(ApiKey), await AppDataSource.getRepository(ApiKey).find());
    this.idempotencyKeys = new DBBackedArray(
      AppDataSource.getRepository(IdempotencyKey),
      await AppDataSource.getRepository(IdempotencyKey).find()
    );
    this.conversions = new DBBackedArray(AppDataSource.getRepository(Conversion), await AppDataSource.getRepository(Conversion).find());
    this.commissionRules = new DBBackedArray(
      AppDataSource.getRepository(CommissionRule),
      await AppDataSource.getRepository(CommissionRule).find()
    );
    this.commissions = new DBBackedArray(AppDataSource.getRepository(Commission), await AppDataSource.getRepository(Commission).find());
    this.ledgerAccounts = new DBBackedArray(
      AppDataSource.getRepository(LedgerAccount),
      await AppDataSource.getRepository(LedgerAccount).find()
    );
    this.ledgerTransactions = new DBBackedArray(
      AppDataSource.getRepository(LedgerTransaction),
      await AppDataSource.getRepository(LedgerTransaction).find()
    );
    this.ledgerEntries = new DBBackedArray(
      AppDataSource.getRepository(LedgerEntry),
      await AppDataSource.getRepository(LedgerEntry).find()
    );
    this.fraudReviews = new DBBackedArray(AppDataSource.getRepository(FraudReview), await AppDataSource.getRepository(FraudReview).find());
    this.fraudSettings = new DBBackedArray(AppDataSource.getRepository(FraudSettings), await AppDataSource.getRepository(FraudSettings).find());
    this.fraudAssessments = new DBBackedArray(AppDataSource.getRepository(FraudAssessment), await AppDataSource.getRepository(FraudAssessment).find());
    this.fraudSignals = new DBBackedArray(AppDataSource.getRepository(FraudSignal), await AppDataSource.getRepository(FraudSignal).find());
    this.affiliateTrustHistory = new DBBackedArray(
      AppDataSource.getRepository(AffiliateTrustHistory),
      await AppDataSource.getRepository(AffiliateTrustHistory).find()
    );
    this.fraudMetricRollups = new DBBackedArray(
      AppDataSource.getRepository(FraudMetricRollup),
      await AppDataSource.getRepository(FraudMetricRollup).find()
    );
    this.payoutBatches = new DBBackedArray(
      AppDataSource.getRepository(PayoutBatch),
      await AppDataSource.getRepository(PayoutBatch).find()
    );
    this.payoutItems = new DBBackedArray(AppDataSource.getRepository(PayoutItem), await AppDataSource.getRepository(PayoutItem).find());
    this.webhookEndpoints = new DBBackedArray(
      AppDataSource.getRepository(WebhookEndpoint),
      await AppDataSource.getRepository(WebhookEndpoint).find()
    );
    this.webhookDeliveries = new DBBackedArray(
      AppDataSource.getRepository(WebhookDelivery),
      await AppDataSource.getRepository(WebhookDelivery).find()
    );
    this.auditLogs = new DBBackedArray(AppDataSource.getRepository(AuditLog), await AppDataSource.getRepository(AuditLog).find());
    this.publicKeys = new DBBackedArray(AppDataSource.getRepository(PublicKey), await AppDataSource.getRepository(PublicKey).find());
    this.integrations = new DBBackedArray(AppDataSource.getRepository(Integration), await AppDataSource.getRepository(Integration).find());
    this.organizationIntegrations = new DBBackedArray(
      AppDataSource.getRepository(OrganizationIntegration),
      await AppDataSource.getRepository(OrganizationIntegration).find()
    );
    this.integrationCredentials = new DBBackedArray(
      AppDataSource.getRepository(IntegrationCredential),
      await AppDataSource.getRepository(IntegrationCredential).find()
    );
    this.integrationEvents = new DBBackedArray(
      AppDataSource.getRepository(IntegrationEvent),
      await AppDataSource.getRepository(IntegrationEvent).find()
    );
    this.integrationOAuthStates = new DBBackedArray(
      AppDataSource.getRepository(IntegrationOAuthState),
      await AppDataSource.getRepository(IntegrationOAuthState).find()
    );
    this.roles = new DBBackedArray(AppDataSource.getRepository(RoleDefinition), await AppDataSource.getRepository(RoleDefinition).find());
    this.permissions = new DBBackedArray(AppDataSource.getRepository(PermissionDefinition), await AppDataSource.getRepository(PermissionDefinition).find());
    this.rolePermissions = new DBBackedArray(AppDataSource.getRepository(RolePermission), await AppDataSource.getRepository(RolePermission).find());
    this.organizationPolicies = new DBBackedArray(AppDataSource.getRepository(OrganizationPolicy), await AppDataSource.getRepository(OrganizationPolicy).find());
    this.organizationInvitations = new DBBackedArray(AppDataSource.getRepository(OrganizationInvitation), await AppDataSource.getRepository(OrganizationInvitation).find());
    this.initialized = true;
  }
};
var dbStore = InMemoryDataStore.instance;

// src/common/utils/security.utils.ts
import * as bcrypt from "bcryptjs";
import * as crypto from "crypto";
var SecurityUtils = class {
  static {
    this.SALT_ROUNDS = 12;
  }
  static {
    this.MASTER_KEY = process.env.ENCRYPTION_KEY || "partneriq_master_encryption_key_32bytes!!";
  }
  static async hashPassword(password) {
    return bcrypt.hash(password, this.SALT_ROUNDS);
  }
  static async verifyPassword(password, hash2) {
    return bcrypt.compare(password, hash2);
  }
  static hashToken(token) {
    return crypto.createHash("sha256").update(token).digest("hex");
  }
  static generateRandomCode(length = 8) {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let result = "";
    const randomBytes3 = crypto.randomBytes(length);
    for (let i = 0; i < length; i++) {
      result += chars[randomBytes3[i] % chars.length];
    }
    return result;
  }
  static generateApiKey(environment = "live") {
    const randomStr = crypto.randomBytes(24).toString("hex");
    const prefix = `pi_${environment}_`;
    const key = `${prefix}${randomStr}`;
    const hash2 = this.hashToken(key);
    return { key, prefix, hash: hash2 };
  }
  static generateWebhookSecret() {
    const secret = `whsec_${crypto.randomBytes(24).toString("hex")}`;
    const hash2 = this.hashToken(secret);
    return { secret, hash: hash2 };
  }
  static signWebhookPayload(secret, timestamp, payload) {
    const signatureBase = `${timestamp}.${payload}`;
    return crypto.createHmac("sha256", secret).update(signatureBase).digest("hex");
  }
  static encrypt(text) {
    const iv = crypto.randomBytes(16);
    const key = crypto.scryptSync(this.MASTER_KEY, "salt", 32);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    let encrypted = cipher.update(text, "utf8", "hex");
    encrypted += cipher.final("hex");
    const authTag = cipher.getAuthTag().toString("hex");
    return `${iv.toString("hex")}:${authTag}:${encrypted}`;
  }
  static decrypt(encryptedData) {
    const parts = encryptedData.split(":");
    if (parts.length !== 3) return encryptedData;
    const iv = Buffer.from(parts[0], "hex");
    const authTag = Buffer.from(parts[1], "hex");
    const encryptedText = parts[2];
    const key = crypto.scryptSync(this.MASTER_KEY, "salt", 32);
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encryptedText, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  }
  static sanitizeForLogging(obj) {
    if (!obj || typeof obj !== "object") return obj;
    const sensitiveKeys = [
      "password",
      "passwordHash",
      "accessToken",
      "refreshToken",
      "authorization",
      "apiKey",
      "secret",
      "cookie",
      "webhookSecret",
      "keyHash"
    ];
    const copy = Array.isArray(obj) ? [...obj] : { ...obj };
    for (const key of Object.keys(copy)) {
      if (sensitiveKeys.some((s) => key.toLowerCase().includes(s.toLowerCase()))) {
        copy[key] = "[REDACTED]";
      } else if (typeof copy[key] === "object" && copy[key] !== null) {
        copy[key] = this.sanitizeForLogging(copy[key]);
      }
    }
    return copy;
  }
};

// src/common/constants/permission-catalog.ts
var BUILT_IN_ROLES = {
  SUPER_ADMIN: {
    name: "Super Admin",
    code: "SUPER_ADMIN",
    description: "Platform administrator with access across all tenant organizations",
    permissions: ["*"]
  },
  OWNER: {
    name: "Owner",
    code: "OWNER",
    description: "Full organization ownership access",
    permissions: ["*"]
  },
  ADMIN: {
    name: "Admin",
    code: "ADMIN",
    description: "Organization administrator with broad operational access",
    permissions: [
      "organization.read",
      "organization.update",
      "members.read",
      "members.invite",
      "members.update",
      "members.remove",
      "roles.read",
      "roles.assign",
      "programs.create",
      "programs.read",
      "programs.update",
      "programs.archive",
      "affiliates.read",
      "affiliates.create",
      "affiliates.update",
      "affiliates.approve",
      "affiliates.suspend",
      "affiliates.suspend_for_fraud",
      "links.read",
      "links.create",
      "links.update",
      "conversions.read",
      "conversions.update",
      "commissions.read",
      "commissions.create",
      "commissions.approve",
      "commissions.reverse",
      "payouts.read",
      "payouts.create",
      "payouts.approve",
      "analytics.read",
      "fraud.read",
      "fraud.review",
      "fraud.settings.update",
      "integrations.read",
      "integrations.manage",
      "api_keys.read",
      "api_keys.create",
      "api_keys.revoke",
      "webhooks.read",
      "webhooks.create",
      "webhooks.update",
      "webhooks.delete",
      "audit.read"
    ]
  },
  PROGRAM_MANAGER: {
    name: "Program Manager",
    code: "PROGRAM_MANAGER",
    description: "Manage programs, affiliates, and links",
    permissions: [
      "programs.read",
      "programs.create",
      "programs.update",
      "affiliates.read",
      "affiliates.create",
      "affiliates.update",
      "affiliates.approve",
      "links.read",
      "links.create",
      "links.update",
      "conversions.read",
      "commissions.read",
      "analytics.read"
    ]
  },
  AFFILIATE_MANAGER: {
    name: "Affiliate Manager",
    code: "AFFILIATE_MANAGER",
    description: "Manage affiliates and tracking links",
    permissions: [
      "affiliates.read",
      "affiliates.create",
      "affiliates.update",
      "affiliates.approve",
      "affiliates.suspend",
      "links.read",
      "links.create",
      "conversions.read",
      "commissions.read",
      "analytics.read"
    ]
  },
  FINANCE: {
    name: "Finance",
    code: "FINANCE",
    description: "Manage payout and commission approvals",
    permissions: [
      "commissions.read",
      "commissions.approve",
      "commissions.reverse",
      "payouts.read",
      "payouts.create",
      "payouts.approve",
      "conversions.read",
      "analytics.read"
    ]
  },
  RISK_ANALYST: {
    name: "Risk Analyst",
    code: "RISK_ANALYST",
    description: "Review fraud and risk metrics",
    permissions: [
      "fraud.read",
      "fraud.review",
      "conversions.read",
      "affiliates.read",
      "analytics.read"
    ]
  },
  ANALYST: {
    name: "Analyst",
    code: "ANALYST",
    description: "View program and revenue analytics",
    permissions: [
      "programs.read",
      "affiliates.read",
      "conversions.read",
      "commissions.read",
      "fraud.read",
      "payouts.read",
      "analytics.read"
    ]
  },
  DEVELOPER: {
    name: "Developer",
    code: "DEVELOPER",
    description: "Manage integrations, API keys and webhooks",
    permissions: [
      "programs.read",
      "integrations.read",
      "integrations.manage",
      "api_keys.read",
      "api_keys.create",
      "api_keys.revoke",
      "webhooks.read",
      "webhooks.create",
      "webhooks.update",
      "webhooks.delete"
    ]
  },
  VIEWER: {
    name: "Viewer",
    code: "VIEWER",
    description: "Read-only access across reports and resources",
    permissions: [
      "programs.read",
      "affiliates.read",
      "conversions.read",
      "commissions.read",
      "fraud.read",
      "payouts.read",
      "analytics.read"
    ]
  }
};
var BUILT_IN_ROLE_CODES = Object.keys(BUILT_IN_ROLES);
var PERMISSION_ALIASES = {
  "manage.organization": [
    "organization.update",
    "organization.read",
    "members.invite",
    "members.update",
    "members.remove",
    "roles.read",
    "roles.assign"
  ],
  "view.organization": ["organization.read"],
  "manage.programs": ["programs.read", "programs.create", "programs.update", "programs.archive"],
  "manage.affiliates": ["affiliates.read", "affiliates.create", "affiliates.update", "affiliates.approve", "affiliates.suspend"],
  "manage.commissions": ["commissions.read", "commissions.create", "commissions.approve", "commissions.reverse"],
  "manage.payouts": ["payouts.read", "payouts.create", "payouts.approve"],
  "manage.api_keys": ["api_keys.read", "api_keys.create", "api_keys.revoke"],
  "manage.webhooks": ["webhooks.read", "webhooks.create", "webhooks.update", "webhooks.delete"],
  "view.integrations": ["integrations.read"],
  "view.programs": ["programs.read"],
  "view.affiliates": ["affiliates.read"],
  "view.conversions": ["conversions.read"],
  "view.fraud": ["fraud.read"],
  "manage.links": ["links.read", "links.create", "links.update"]
};

// src/common/constants/permissions.ts
var ROLE_PERMISSIONS = (() => {
  const map = {};
  Object.entries(BUILT_IN_ROLES).forEach(([role, roleData]) => {
    map[role] = roleData.permissions;
  });
  return map;
})();
function getRolePermissions(role) {
  return ROLE_PERMISSIONS[role] || [];
}
function permissionMatches(permissionRequirements, permission) {
  if (permissionRequirements.includes("*")) return true;
  if (permissionRequirements.includes(permission)) return true;
  const [resource, action] = permission.split(".");
  if (!resource || !action) {
    return false;
  }
  return permissionRequirements.some((p) => p === `${resource}.*`);
}
function hasPermission(role, requiredPermission) {
  const normalized = requiredPermission.trim();
  const rolePermissions = getRolePermissions(role);
  if (permissionMatches(rolePermissions, normalized)) {
    return true;
  }
  const aliases = PERMISSION_ALIASES[normalized] || [normalized];
  return aliases.some((permission) => permissionMatches(rolePermissions, permission));
}

// src/modules/auth/auth.service.ts
var jwt2 = jwtPkg2.default || jwtPkg2;
var AuthService = class {
  async repositories() {
    const dataSource = await initializeDataSource();
    return {
      users: dataSource.getRepository(User),
      authSessions: dataSource.getRepository(AuthSession),
      memberships: dataSource.getRepository(OrganizationMembership),
      organizations: dataSource.getRepository(Organization)
    };
  }
  async register(dto, userAgent, ipAddress) {
    const { users } = await this.repositories();
    const normalizedEmail = dto.email.toLowerCase().trim();
    const existing = await users.findOne({
      where: { email: normalizedEmail, deletedAt: IsNull2() }
    });
    if (existing) {
      throw new BadRequestException("User with this email already exists");
    }
    const passwordHash = await SecurityUtils.hashPassword(dto.password);
    const platformRole = this.isConfiguredSuperAdmin(normalizedEmail) ? "SUPER_ADMIN" /* SUPER_ADMIN */ : "USER" /* USER */;
    const newUser = users.create({
      email: normalizedEmail,
      passwordHash,
      firstName: dto.firstName,
      lastName: dto.lastName,
      status: "ACTIVE" /* ACTIVE */,
      emailVerified: false,
      platformRole,
      failedLoginAttempts: 0
    });
    const savedUser = await users.save(newUser);
    if (!dbStore.users.some((item) => item.id === savedUser.id)) {
      dbStore.users.push(savedUser);
    }
    const tokens = await this.createSessionAndTokens(savedUser, userAgent, ipAddress);
    return {
      ...tokens,
      userId: savedUser.id,
      email: savedUser.email,
      firstName: savedUser.firstName,
      lastName: savedUser.lastName,
      platformRole: savedUser.platformRole,
      message: "User registered successfully. Please verify your email."
    };
  }
  async login(dto, userAgent, ipAddress) {
    const { users } = await this.repositories();
    const normalizedEmail = dto.email.toLowerCase().trim();
    const user = await users.findOne({
      where: { email: normalizedEmail, deletedAt: IsNull2() }
    });
    if (!user) {
      throw new UnauthorizedException2("Invalid email or password");
    }
    if (user.status === "LOCKED" /* LOCKED */ && user.lockedUntil) {
      if (/* @__PURE__ */ new Date() < new Date(user.lockedUntil)) {
        throw new ForbiddenException("Account is temporarily locked due to failed login attempts");
      } else {
        user.status = "ACTIVE" /* ACTIVE */;
        user.failedLoginAttempts = 0;
        user.lockedUntil = void 0;
        await users.save(user);
      }
    }
    const isValid = await SecurityUtils.verifyPassword(dto.password, user.passwordHash);
    if (!isValid) {
      user.failedLoginAttempts += 1;
      if (user.failedLoginAttempts >= 5) {
        user.status = "LOCKED" /* LOCKED */;
        user.lockedUntil = new Date(Date.now() + 15 * 60 * 1e3);
      }
      await users.save(user);
      throw new UnauthorizedException2("Invalid email or password");
    }
    user.failedLoginAttempts = 0;
    user.lastLoginAt = /* @__PURE__ */ new Date();
    await users.save(user);
    const tokens = await this.createSessionAndTokens(user, userAgent, ipAddress);
    return tokens;
  }
  async refreshToken(rawRefreshToken, userAgent, ipAddress) {
    const { users, authSessions } = await this.repositories();
    if (!rawRefreshToken) {
      throw new UnauthorizedException2("Refresh token required");
    }
    const jwtConfig = getJwtConfig();
    let decoded;
    try {
      decoded = jwt2.verify(rawRefreshToken, jwtConfig.refreshSecret);
    } catch (err) {
      throw new UnauthorizedException2("Invalid or expired refresh token");
    }
    if (decoded.type !== "refresh") {
      throw new UnauthorizedException2("Invalid token type");
    }
    const incomingHash = SecurityUtils.hashToken(rawRefreshToken);
    const session = await authSessions.findOne({ where: { id: decoded.sid } });
    if (!session) {
      throw new UnauthorizedException2("Session not found");
    }
    if (session.revokedAt || session.refreshTokenHash !== incomingHash) {
      await authSessions.update({ tokenFamilyId: decoded.tfid }, { revokedAt: /* @__PURE__ */ new Date() });
      throw new UnauthorizedException2("Refresh token theft detected. Session revoked.");
    }
    const user = await users.findOne({
      where: { id: session.userId, deletedAt: IsNull2() }
    });
    if (!user) {
      throw new UnauthorizedException2("User no longer exists");
    }
    const newSession = authSessions.create({
      userId: user.id,
      refreshTokenHash: "",
      tokenFamilyId: session.tokenFamilyId,
      userAgent: userAgent || session.userAgent,
      ipAddress: ipAddress || session.ipAddress,
      expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1e3),
      lastUsedAt: /* @__PURE__ */ new Date()
    });
    const savedSession = await authSessions.save(newSession);
    const newRawRefreshToken = jwt2.sign(
      { sub: user.id, sid: savedSession.id, tfid: session.tokenFamilyId, type: "refresh" },
      jwtConfig.refreshSecret,
      { expiresIn: jwtConfig.refreshTtl }
    );
    const newAccessToken = jwt2.sign(
      { sub: user.id, sid: savedSession.id, type: "access" },
      jwtConfig.accessSecret,
      { expiresIn: jwtConfig.accessTtl }
    );
    session.revokedAt = /* @__PURE__ */ new Date();
    savedSession.refreshTokenHash = SecurityUtils.hashToken(newRawRefreshToken);
    await authSessions.save([session, savedSession]);
    return {
      accessToken: newAccessToken,
      refreshToken: newRawRefreshToken,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName
      }
    };
  }
  async logout(sessionId) {
    const { authSessions } = await this.repositories();
    const session = await authSessions.findOne({ where: { id: sessionId } });
    if (session) {
      session.revokedAt = /* @__PURE__ */ new Date();
      await authSessions.save(session);
    }
    return { success: true, message: "Logged out successfully" };
  }
  async logoutAll(userId) {
    const { authSessions } = await this.repositories();
    await authSessions.update({ userId }, { revokedAt: /* @__PURE__ */ new Date() });
    return { success: true, message: "All sessions revoked successfully" };
  }
  async getMe(userId) {
    const { users, memberships, organizations } = await this.repositories();
    const user = await users.findOne({
      where: { id: userId, deletedAt: IsNull2() }
    });
    if (!user) {
      throw new NotFoundException("User not found");
    }
    const activeMemberships = await memberships.find({
      where: { userId, status: "ACTIVE" /* ACTIVE */ }
    });
    const isSuperAdmin = user.platformRole === "SUPER_ADMIN" /* SUPER_ADMIN */;
    const orgs = isSuperAdmin ? await organizations.find({ where: { deletedAt: IsNull2() } }) : activeMemberships.length ? await organizations.findBy(activeMemberships.map((m) => ({ id: m.organizationId }))) : [];
    const userMemberships = isSuperAdmin ? orgs.map((org) => ({
      organizationId: org.id,
      organizationName: org.name,
      role: "SUPER_ADMIN" /* SUPER_ADMIN */,
      programAccessType: "ALL" /* ALL */,
      programIds: [],
      permissions: getRolePermissions("SUPER_ADMIN" /* SUPER_ADMIN */)
    })) : activeMemberships.map((m) => {
      const org = orgs.find((o) => o.id === m.organizationId);
      return {
        organizationId: m.organizationId,
        organizationName: org?.name,
        role: m.role,
        programAccessType: m.programAccessType,
        programIds: m.programIds || [],
        permissions: getRolePermissions(m.role)
      };
    });
    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      status: user.status,
      emailVerified: user.emailVerified,
      platformRole: user.platformRole,
      isSuperAdmin,
      memberships: userMemberships
    };
  }
  async getSessions(userId, currentSessionId) {
    const { authSessions } = await this.repositories();
    const sessions = await authSessions.find({
      where: { userId, revokedAt: IsNull2() }
    });
    return sessions.map((s) => ({
      id: s.id,
      deviceName: s.deviceName || "Web Browser",
      userAgent: s.userAgent,
      ipAddress: s.ipAddress,
      createdAt: s.createdAt,
      lastUsedAt: s.lastUsedAt,
      isCurrent: s.id === currentSessionId
    }));
  }
  async removeNewlyRegisteredUser(userId) {
    const { users, authSessions } = await this.repositories();
    await authSessions.delete({ userId });
    await users.delete({ id: userId });
    const userIndex = dbStore.users.findIndex((item) => item.id === userId);
    if (userIndex >= 0) {
      dbStore.users.splice(userIndex, 1);
    }
  }
  async revokeSession(userId, sessionId) {
    const { authSessions } = await this.repositories();
    const session = await authSessions.findOne({ where: { id: sessionId, userId } });
    if (!session) {
      throw new NotFoundException("Session not found");
    }
    session.revokedAt = /* @__PURE__ */ new Date();
    await authSessions.save(session);
    return { success: true, message: "Session revoked" };
  }
  async changePassword(userId, dto) {
    const { users } = await this.repositories();
    const user = await users.findOne({
      where: { id: userId, deletedAt: IsNull2() }
    });
    if (!user) {
      throw new NotFoundException("User not found");
    }
    const isValid = await SecurityUtils.verifyPassword(dto.currentPassword, user.passwordHash);
    if (!isValid) {
      throw new BadRequestException("Current password is incorrect");
    }
    user.passwordHash = await SecurityUtils.hashPassword(dto.newPassword);
    user.updatedAt = /* @__PURE__ */ new Date();
    await users.save(user);
    await this.logoutAll(userId);
    return { success: true, message: "Password changed successfully. Please log in again." };
  }
  async createSessionAndTokens(user, userAgent, ipAddress) {
    const { authSessions } = await this.repositories();
    const jwtConfig = getJwtConfig();
    const session = authSessions.create({
      userId: user.id,
      refreshTokenHash: "",
      tokenFamilyId: uuidv4(),
      userAgent,
      ipAddress,
      expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1e3),
      lastUsedAt: /* @__PURE__ */ new Date()
    });
    const savedSession = await authSessions.save(session);
    const refreshToken = jwt2.sign(
      { sub: user.id, sid: savedSession.id, tfid: savedSession.tokenFamilyId, type: "refresh" },
      jwtConfig.refreshSecret,
      { expiresIn: jwtConfig.refreshTtl }
    );
    const accessToken = jwt2.sign(
      { sub: user.id, sid: savedSession.id, type: "access" },
      jwtConfig.accessSecret,
      { expiresIn: jwtConfig.accessTtl }
    );
    savedSession.refreshTokenHash = SecurityUtils.hashToken(refreshToken);
    await authSessions.save(savedSession);
    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        platformRole: user.platformRole
      }
    };
  }
  isConfiguredSuperAdmin(email) {
    const superAdminEmails = (process.env.SUPER_ADMIN_EMAILS || "admin@partneriq.demo").split(",").map((value) => value.trim().toLowerCase()).filter(Boolean);
    return superAdminEmails.includes(email);
  }
};
AuthService = __decorateClass([
  Injectable2()
], AuthService);

// src/modules/auth/auth.module.ts
var AuthModule = class {
};
AuthModule = __decorateClass([
  Module({
    controllers: [AuthController],
    providers: [AuthService],
    exports: [AuthService]
  })
], AuthModule);

// src/modules/organizations/organizations.module.ts
import { Module as Module2 } from "@nestjs/common";

// src/modules/organizations/organizations.controller.ts
import {
  Controller as Controller2,
  Get as Get2,
  Post as Post2,
  Patch,
  Body as Body2,
  Param as Param2,
  UseGuards as UseGuards2
} from "@nestjs/common";
import { ApiTags as ApiTags2, ApiOperation as ApiOperation2, ApiBearerAuth as ApiBearerAuth2 } from "@nestjs/swagger";

// src/common/guards/organization.guard.ts
import {
  Injectable as Injectable3,
  ForbiddenException as ForbiddenException2,
  NotFoundException as NotFoundException2
} from "@nestjs/common";
var OrganizationGuard = class {
  canActivate(context) {
    const request = context.switchToHttp().getRequest();
    const user = request.user;
    if (!user) {
      throw new ForbiddenException2("User is not authenticated");
    }
    if (user.isApiKey) {
      const requestedOrgId = request.params?.organizationId;
      if (requestedOrgId && requestedOrgId !== user.organizationId) {
        throw new ForbiddenException2("API Key cannot access other organization data (IDOR prevention)");
      }
      return true;
    }
    const organizationId = request.params?.organizationId || request.body?.organizationId || request.query?.organizationId;
    if (!organizationId) {
      throw new ForbiddenException2("Organization context is required for this action");
    }
    const org = dbStore.organizations.find((o) => o.id === organizationId && !o.deletedAt);
    if (!org) {
      throw new NotFoundException2("Organization not found");
    }
    if (org.status === "SUSPENDED" || org.status === "CLOSED") {
      throw new ForbiddenException2(`Organization account is ${org.status.toLowerCase()}`);
    }
    if (user.isSuperAdmin) {
      request.user.organizationId = organizationId;
      request.user.role = "SUPER_ADMIN" /* SUPER_ADMIN */;
      request.tenantId = organizationId;
      return true;
    }
    const membership = dbStore.organizationMemberships.find(
      (m) => m.organizationId === organizationId && m.userId === user.userId && m.status === "ACTIVE" /* ACTIVE */
    );
    if (!membership) {
      throw new ForbiddenException2("User does not belong to this organization");
    }
    request.user.organizationId = organizationId;
    request.user.role = membership.role;
    request.user.programAccessType = membership.programAccessType;
    request.user.programIds = membership.programIds || [];
    request.tenantId = organizationId;
    return true;
  }
};
OrganizationGuard = __decorateClass([
  Injectable3()
], OrganizationGuard);

// src/common/guards/permissions.guard.ts
import {
  Injectable as Injectable4,
  ForbiddenException as ForbiddenException3
} from "@nestjs/common";

// src/common/decorators/require-permissions.decorator.ts
import { SetMetadata } from "@nestjs/common";
var PERMISSIONS_KEY = "permissions";
var PERMISSIONS_MODE_KEY = "permissionsMode";
var RequirePermissions = (...permissions) => SetMetadata(PERMISSIONS_KEY, permissions);

// src/common/guards/permissions.guard.ts
var PermissionsGuard = class {
  constructor(reflector) {
    this.reflector = reflector;
  }
  canActivate(context) {
    const requiredPermissions = this.reflector.getAllAndOverride(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()]
    );
    const permissionsMode = this.reflector.getAllAndOverride(
      PERMISSIONS_MODE_KEY,
      [context.getHandler(), context.getClass()]
    );
    if (!requiredPermissions || requiredPermissions.length === 0) {
      return true;
    }
    const request = context.switchToHttp().getRequest();
    const user = request.user;
    if (!user) {
      throw new ForbiddenException3("User context missing");
    }
    if (user.isApiKey) {
      const userScopes = user.scopes || [];
      const hasAllScopes = requiredPermissions.every((p) => userScopes.includes(p));
      if (!hasAllScopes) {
        throw new ForbiddenException3(`API key lacks required scopes: ${requiredPermissions.join(", ")}`);
      }
      return true;
    }
    if (!user.role) {
      throw new ForbiddenException3("User role is not defined for this organization context");
    }
    const comparisons = requiredPermissions.map((permission) => hasPermission(user.role, permission));
    const allowed = permissionsMode === "ANY" ? comparisons.some(Boolean) : comparisons.every(Boolean);
    if (!allowed) {
      throw new ForbiddenException3(
        `Insufficient permissions for role '${user.role}'. Required: ${requiredPermissions.join(", ")}`
      );
    }
    return true;
  }
};
PermissionsGuard = __decorateClass([
  Injectable4()
], PermissionsGuard);

// src/modules/organizations/organizations.controller.ts
var OrganizationsController = class {
  constructor(orgsService) {
    this.orgsService = orgsService;
  }
  async create(user, dto) {
    return this.orgsService.create(user.userId, dto);
  }
  async findAllForUser(user) {
    return this.orgsService.findAllForUser(user.userId, user.isSuperAdmin);
  }
  async findOne(organizationId) {
    return this.orgsService.findOne(organizationId);
  }
  async update(organizationId, dto) {
    return this.orgsService.update(organizationId, dto);
  }
  async onboardingOrg(user, dto) {
    return this.orgsService.onboardingOrg(user.userId, dto);
  }
  async onboardingProgram(user, dto) {
    return this.orgsService.onboardingProgram(user.userId, dto);
  }
  async completeOnboarding(organizationId) {
    return this.orgsService.completeOnboarding(organizationId);
  }
};
__decorateClass([
  Post2("api/v1/organizations"),
  UseGuards2(JwtAuthGuard),
  ApiBearerAuth2(),
  ApiOperation2({ summary: "Create a new organization" }),
  __decorateParam(0, CurrentUser()),
  __decorateParam(1, Body2())
], OrganizationsController.prototype, "create", 1);
__decorateClass([
  Get2("api/v1/organizations"),
  UseGuards2(JwtAuthGuard),
  ApiBearerAuth2(),
  ApiOperation2({ summary: "List all organizations for authenticated user" }),
  __decorateParam(0, CurrentUser())
], OrganizationsController.prototype, "findAllForUser", 1);
__decorateClass([
  Get2("api/v1/organizations/:organizationId"),
  UseGuards2(JwtAuthGuard, OrganizationGuard),
  ApiBearerAuth2(),
  ApiOperation2({ summary: "Get details for a specific organization" }),
  __decorateParam(0, Param2("organizationId"))
], OrganizationsController.prototype, "findOne", 1);
__decorateClass([
  Patch("api/v1/organizations/:organizationId"),
  UseGuards2(JwtAuthGuard, OrganizationGuard, PermissionsGuard),
  RequirePermissions("manage.organization"),
  ApiBearerAuth2(),
  ApiOperation2({ summary: "Update organization settings" }),
  __decorateParam(0, Param2("organizationId")),
  __decorateParam(1, Body2())
], OrganizationsController.prototype, "update", 1);
__decorateClass([
  Post2("api/v1/onboarding/organization"),
  UseGuards2(JwtAuthGuard),
  ApiBearerAuth2(),
  ApiOperation2({ summary: "Onboarding Step 1: Create Organization" }),
  __decorateParam(0, CurrentUser()),
  __decorateParam(1, Body2())
], OrganizationsController.prototype, "onboardingOrg", 1);
__decorateClass([
  Post2("api/v1/onboarding/program"),
  UseGuards2(JwtAuthGuard),
  ApiBearerAuth2(),
  ApiOperation2({ summary: "Onboarding Step: Create Initial Partner Program" }),
  __decorateParam(0, CurrentUser()),
  __decorateParam(1, Body2())
], OrganizationsController.prototype, "onboardingProgram", 1);
__decorateClass([
  Post2("api/v1/onboarding/complete"),
  UseGuards2(JwtAuthGuard),
  ApiBearerAuth2(),
  ApiOperation2({ summary: "Onboarding Step: Complete Onboarding" }),
  __decorateParam(0, Body2("organizationId"))
], OrganizationsController.prototype, "completeOnboarding", 1);
OrganizationsController = __decorateClass([
  ApiTags2("Organizations & Onboarding"),
  Controller2()
], OrganizationsController);

// src/modules/organizations/organizations.service.ts
import {
  Injectable as Injectable5,
  NotFoundException as NotFoundException3,
  BadRequestException as BadRequestException2
} from "@nestjs/common";
import { v4 as uuidv42 } from "uuid";
var OrganizationsService = class {
  async create(userId, dto) {
    const slug = this.slugify(dto.slug || dto.name);
    const existing = dbStore.organizations.find((o) => o.slug === slug && !o.deletedAt);
    if (existing) {
      throw new BadRequestException2("Organization slug is already taken");
    }
    const org = {
      id: uuidv42(),
      name: dto.name,
      slug,
      website: dto.website,
      industry: dto.industry,
      companySize: dto.companySize,
      country: dto.country || "US",
      defaultCurrency: dto.defaultCurrency || "USD",
      status: "ACTIVE" /* ACTIVE */,
      onboardingCompleted: false,
      createdBy: userId,
      createdAt: /* @__PURE__ */ new Date(),
      updatedAt: /* @__PURE__ */ new Date()
    };
    dbStore.organizations.push(org);
    const membership = {
      id: uuidv42(),
      organizationId: org.id,
      userId,
      role: "OWNER" /* OWNER */,
      status: "ACTIVE" /* ACTIVE */,
      programAccessType: "ALL" /* ALL */,
      programIds: [],
      joinedAt: /* @__PURE__ */ new Date(),
      createdAt: /* @__PURE__ */ new Date(),
      updatedAt: /* @__PURE__ */ new Date()
    };
    dbStore.organizationMemberships.push(membership);
    dbStore.auditLogs.push({
      id: uuidv42(),
      organizationId: org.id,
      actorType: "USER",
      actorId: userId,
      action: "ORGANIZATION_CREATED" /* ORGANIZATION_CREATED */,
      resourceType: "organization",
      resourceId: org.id,
      createdAt: /* @__PURE__ */ new Date()
    });
    return org;
  }
  async findAllForUser(userId, isSuperAdmin = false) {
    if (isSuperAdmin) {
      return dbStore.organizations.filter((o) => !o.deletedAt).map((org) => ({
        ...org,
        role: "SUPER_ADMIN" /* SUPER_ADMIN */
      }));
    }
    const memberships = dbStore.organizationMemberships.filter(
      (m) => m.userId === userId && m.status === "ACTIVE" /* ACTIVE */
    );
    const orgIds = memberships.map((m) => m.organizationId);
    return dbStore.organizations.filter((o) => orgIds.includes(o.id) && !o.deletedAt).map((org) => {
      const mem = memberships.find((m) => m.organizationId === org.id);
      return {
        ...org,
        role: mem?.role
      };
    });
  }
  async findOne(organizationId) {
    const org = dbStore.organizations.find((o) => o.id === organizationId && !o.deletedAt);
    if (!org) {
      throw new NotFoundException3("Organization not found");
    }
    return org;
  }
  async update(organizationId, dto) {
    const org = await this.findOne(organizationId);
    if (dto.name) org.name = dto.name;
    if (dto.website) org.website = dto.website;
    if (dto.industry) org.industry = dto.industry;
    if (dto.companySize) org.companySize = dto.companySize;
    if (dto.status) org.status = dto.status;
    org.updatedAt = /* @__PURE__ */ new Date();
    return org;
  }
  // Onboarding Step 1
  async onboardingOrg(userId, dto) {
    return this.create(userId, {
      name: dto.name,
      slug: dto.slug,
      website: dto.website,
      industry: dto.industry,
      companySize: dto.companySize,
      country: dto.country
    });
  }
  slugify(value) {
    const slug = value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    if (!slug) {
      throw new BadRequestException2("Organization slug is required");
    }
    return slug;
  }
  // Onboarding Step 2: Program setup
  async onboardingProgram(userId, dto) {
    const org = await this.findOne(dto.organizationId);
    const program = {
      id: uuidv42(),
      organizationId: org.id,
      name: dto.programName,
      slug: dto.programName.toLowerCase().replace(/\s+/g, "-"),
      type: "AFFILIATE" /* AFFILIATE */,
      status: "ACTIVE" /* ACTIVE */,
      currency: org.defaultCurrency,
      commissionType: "PERCENTAGE" /* PERCENTAGE */,
      defaultCommissionValue: (dto.defaultCommissionRate || 10) * 100,
      // Basis points
      attributionModel: "LAST_CLICK" /* LAST_CLICK */,
      cookieDurationDays: 30,
      affiliateApprovalMode: "AUTO",
      createdBy: userId,
      createdAt: /* @__PURE__ */ new Date(),
      updatedAt: /* @__PURE__ */ new Date()
    };
    dbStore.programs.push(program);
    return program;
  }
  // Onboarding Step Complete
  async completeOnboarding(organizationId) {
    const org = await this.findOne(organizationId);
    org.onboardingCompleted = true;
    org.updatedAt = /* @__PURE__ */ new Date();
    return { success: true, onboardingCompleted: true };
  }
};
OrganizationsService = __decorateClass([
  Injectable5()
], OrganizationsService);

// src/modules/organizations/organizations.module.ts
var OrganizationsModule = class {
};
OrganizationsModule = __decorateClass([
  Module2({
    controllers: [OrganizationsController],
    providers: [OrganizationsService],
    exports: [OrganizationsService]
  })
], OrganizationsModule);

// src/modules/memberships/memberships.module.ts
import { Module as Module3 } from "@nestjs/common";

// src/modules/memberships/memberships.controller.ts
import {
  Controller as Controller3,
  Get as Get3,
  Post as Post3,
  Patch as Patch2,
  Delete as Delete2,
  Body as Body3,
  Param as Param3,
  UseGuards as UseGuards3
} from "@nestjs/common";
import { ApiTags as ApiTags3, ApiOperation as ApiOperation3, ApiBearerAuth as ApiBearerAuth3 } from "@nestjs/swagger";
var MembershipsController = class {
  constructor(membershipsService) {
    this.membershipsService = membershipsService;
  }
  async getMembers(organizationId) {
    return this.membershipsService.getMembers(organizationId);
  }
  async inviteMember(organizationId, user, dto) {
    return this.membershipsService.inviteMember(organizationId, user.userId, dto);
  }
  async updateMemberRole(organizationId, memberId, dto, user) {
    return this.membershipsService.updateMemberRole(organizationId, memberId, dto, user.userId);
  }
  async removeMember(organizationId, memberId, user) {
    return this.membershipsService.removeMember(organizationId, memberId, user.userId);
  }
};
__decorateClass([
  Get3(),
  RequirePermissions("view.organization"),
  ApiOperation3({ summary: "List all organization members" }),
  __decorateParam(0, Param3("organizationId"))
], MembershipsController.prototype, "getMembers", 1);
__decorateClass([
  Post3(),
  RequirePermissions("manage.organization"),
  ApiOperation3({ summary: "Invite new member to organization" }),
  __decorateParam(0, Param3("organizationId")),
  __decorateParam(1, CurrentUser()),
  __decorateParam(2, Body3())
], MembershipsController.prototype, "inviteMember", 1);
__decorateClass([
  Patch2(":memberId"),
  RequirePermissions("manage.organization"),
  ApiOperation3({ summary: "Update member role" }),
  __decorateParam(0, Param3("organizationId")),
  __decorateParam(1, Param3("memberId")),
  __decorateParam(2, Body3()),
  __decorateParam(3, CurrentUser())
], MembershipsController.prototype, "updateMemberRole", 1);
__decorateClass([
  Delete2(":memberId"),
  RequirePermissions("manage.organization"),
  ApiOperation3({ summary: "Remove member from organization" }),
  __decorateParam(0, Param3("organizationId")),
  __decorateParam(1, Param3("memberId")),
  __decorateParam(2, CurrentUser())
], MembershipsController.prototype, "removeMember", 1);
MembershipsController = __decorateClass([
  ApiTags3("Organization Memberships"),
  Controller3("api/v1/organizations/:organizationId/members"),
  UseGuards3(JwtAuthGuard, OrganizationGuard, PermissionsGuard),
  ApiBearerAuth3()
], MembershipsController);

// src/modules/memberships/memberships.service.ts
import {
  Injectable as Injectable6,
  NotFoundException as NotFoundException4,
  BadRequestException as BadRequestException3
} from "@nestjs/common";
import { v4 as uuidv43 } from "uuid";
var MembershipsService = class {
  constructor(brevoEmail) {
    this.brevoEmail = brevoEmail;
  }
  async getMembers(organizationId) {
    const memberships = dbStore.organizationMemberships.filter(
      (m) => m.organizationId === organizationId && m.status === "ACTIVE" /* ACTIVE */
    );
    const activeMembers = memberships.map((m) => {
      const user = dbStore.users.find((u) => u.id === m.userId);
      return {
        id: m.id,
        organizationId: m.organizationId,
        userId: m.userId,
        email: user?.email,
        firstName: user?.firstName,
        lastName: user?.lastName,
        role: m.role,
        status: m.status,
        joinedAt: m.joinedAt
      };
    });
    const pendingInvites = dbStore.organizationInvitations.filter(
      (invite) => invite.organizationId === organizationId && !invite.acceptedAt && !invite.revokedAt && new Date(invite.expiresAt) > /* @__PURE__ */ new Date()
    ).map((invite) => ({
      id: invite.id,
      userId: void 0,
      email: invite.email,
      firstName: void 0,
      lastName: void 0,
      role: this.roleForInvitation(invite.roleId),
      status: "Pending",
      joinedAt: void 0,
      invitedAt: invite.createdAt,
      expiresAt: invite.expiresAt
    }));
    return [...pendingInvites, ...activeMembers];
  }
  async inviteMember(organizationId, invitedByUserId, dto) {
    const email = dto.email.toLowerCase().trim();
    const organization = dbStore.organizations.find((item) => item.id === organizationId && !item.deletedAt);
    if (!organization) {
      throw new NotFoundException4("Organization not found");
    }
    const user = dbStore.users.find((u) => u.email === email && !u.deletedAt);
    const existingMembership = user && dbStore.organizationMemberships.find(
      (m) => m.organizationId === organizationId && m.userId === user.id && m.status === "ACTIVE" /* ACTIVE */
    );
    if (existingMembership) {
      throw new BadRequestException3("User is already a member of this organization");
    }
    const existingInvite = dbStore.organizationInvitations.find(
      (invite) => invite.organizationId === organizationId && invite.email === email && !invite.acceptedAt && !invite.revokedAt && new Date(invite.expiresAt) > /* @__PURE__ */ new Date()
    );
    if (existingInvite) {
      throw new BadRequestException3("An active invitation already exists for this email");
    }
    const role = this.normalizeRole(dto.role);
    const roleDefinition = dbStore.roles.find((item) => item.code === role && !item.organizationId);
    if (!roleDefinition) {
      throw new BadRequestException3("Role definition not found. Run database seed before inviting members.");
    }
    const token = `${uuidv43()}${uuidv43()}`.replace(/-/g, "");
    const inviteUrl = `${getAppConfig().frontendUrl.replace(/\/$/, "")}/invite/accept?token=${token}`;
    const invitation = {
      id: uuidv43(),
      organizationId,
      email,
      roleId: roleDefinition.id,
      programAccessType: "ALL" /* ALL */,
      programIds: [],
      tokenHash: SecurityUtils.hashToken(token),
      expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1e3),
      invitedBy: invitedByUserId,
      createdAt: /* @__PURE__ */ new Date()
    };
    dbStore.organizationInvitations.push(invitation);
    this.audit(organizationId, invitedByUserId, "MEMBER_INVITED", "organization_invitation", invitation.id, {
      email,
      role
    });
    const inviter = dbStore.users.find((item) => item.id === invitedByUserId);
    await this.brevoEmail.sendInvitationEmail({
      toEmail: email,
      organizationName: organization.name,
      inviterEmail: inviter?.email,
      role,
      inviteUrl
    });
    return {
      id: invitation.id,
      organizationId,
      email,
      role,
      status: "Pending",
      invitedAt: invitation.createdAt,
      expiresAt: invitation.expiresAt,
      inviteUrl: process.env.BREVO_API_KEY ? void 0 : inviteUrl
    };
  }
  getInvitation(token) {
    const invitation = this.findValidInvitation(token);
    const organization = dbStore.organizations.find((item) => item.id === invitation.organizationId);
    const role = this.roleForInvitation(invitation.roleId);
    return {
      email: invitation.email,
      organizationId: invitation.organizationId,
      organizationName: organization?.name,
      role,
      expiresAt: invitation.expiresAt
    };
  }
  async acceptInvitationForUser(token, userId) {
    const invitation = this.findValidInvitation(token);
    const dataSource = await initializeDataSource();
    const user = await dataSource.getRepository(User).findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException4("User not found");
    }
    if (user.email.toLowerCase() !== invitation.email.toLowerCase()) {
      throw new BadRequestException3("Invitation email does not match authenticated user");
    }
    const existing = dbStore.organizationMemberships.find(
      (item) => item.organizationId === invitation.organizationId && item.userId === user.id && item.status === "ACTIVE" /* ACTIVE */
    );
    if (existing) {
      invitation.acceptedAt = /* @__PURE__ */ new Date();
      return existing;
    }
    const membership = {
      id: uuidv43(),
      organizationId: invitation.organizationId,
      userId: user.id,
      role: this.roleForInvitation(invitation.roleId),
      status: "ACTIVE" /* ACTIVE */,
      programAccessType: invitation.programAccessType,
      programIds: invitation.programIds || [],
      invitedBy: invitation.invitedBy,
      joinedAt: /* @__PURE__ */ new Date(),
      createdAt: /* @__PURE__ */ new Date(),
      updatedAt: /* @__PURE__ */ new Date()
    };
    dbStore.organizationMemberships.push(membership);
    invitation.acceptedAt = /* @__PURE__ */ new Date();
    this.audit(invitation.organizationId, user.id, "MEMBER_INVITATION_ACCEPTED", "organization_membership", membership.id, {
      email: user.email,
      role: membership.role,
      invitedBy: invitation.invitedBy
    });
    return membership;
  }
  async updateMemberRole(organizationId, memberId, dto, actorId) {
    const membership = dbStore.organizationMemberships.find(
      (m) => m.id === memberId && m.organizationId === organizationId
    );
    if (!membership) {
      throw new NotFoundException4("Member not found");
    }
    const previousRole = membership.role;
    membership.role = dto.role;
    membership.updatedAt = /* @__PURE__ */ new Date();
    this.audit(organizationId, actorId || membership.userId, "MEMBER_ROLE_UPDATED", "organization_membership", memberId, {
      memberUserId: membership.userId,
      previousRole,
      nextRole: dto.role
    });
    return membership;
  }
  async removeMember(organizationId, memberId, actorId) {
    const membership = dbStore.organizationMemberships.find(
      (m) => m.id === memberId && m.organizationId === organizationId
    );
    if (!membership) {
      throw new NotFoundException4("Member not found");
    }
    membership.status = "REMOVED" /* REMOVED */;
    membership.updatedAt = /* @__PURE__ */ new Date();
    this.audit(organizationId, actorId || membership.userId, "MEMBER_REMOVED", "organization_membership", memberId, {
      memberUserId: membership.userId,
      role: membership.role
    });
    return { success: true, message: "Member access revoked" };
  }
  findValidInvitation(token) {
    const tokenHash = SecurityUtils.hashToken(token);
    const invitation = dbStore.organizationInvitations.find(
      (item) => item.tokenHash === tokenHash && !item.acceptedAt && !item.revokedAt
    );
    if (!invitation) {
      throw new NotFoundException4("Invitation not found");
    }
    if (new Date(invitation.expiresAt) <= /* @__PURE__ */ new Date()) {
      throw new BadRequestException3("Invitation has expired");
    }
    return invitation;
  }
  roleForInvitation(roleId) {
    const roleDefinition = dbStore.roles.find((item) => item.id === roleId);
    return this.normalizeRole(roleDefinition?.code || "VIEWER" /* VIEWER */);
  }
  normalizeRole(role) {
    if (!Object.values(Role).includes(role) || role === "SUPER_ADMIN" /* SUPER_ADMIN */ || role === "OWNER" /* OWNER */) {
      throw new BadRequestException3("Invalid invitation role");
    }
    return role;
  }
  audit(organizationId, actorId, action, resourceType, resourceId, metadata) {
    dbStore.auditLogs.push({
      id: uuidv43(),
      organizationId,
      actorType: "user",
      actorId,
      action,
      resourceType,
      resourceId,
      metadata,
      createdAt: /* @__PURE__ */ new Date()
    });
  }
};
MembershipsService = __decorateClass([
  Injectable6()
], MembershipsService);

// src/modules/memberships/invitations.controller.ts
import {
  Body as Body4,
  BadRequestException as BadRequestException4,
  Controller as Controller4,
  Get as Get4,
  HttpCode as HttpCode2,
  HttpStatus as HttpStatus2,
  Param as Param4,
  Post as Post4,
  Req as Req2,
  Res as Res2,
  UseGuards as UseGuards4
} from "@nestjs/common";
import { ApiBearerAuth as ApiBearerAuth4, ApiOperation as ApiOperation4, ApiTags as ApiTags4 } from "@nestjs/swagger";
var InvitationsController = class {
  constructor(membershipsService, authService) {
    this.membershipsService = membershipsService;
    this.authService = authService;
  }
  refreshCookieOptions(maxAge) {
    const appConfig = getAppConfig();
    return {
      httpOnly: true,
      secure: appConfig.cookieSecure,
      sameSite: appConfig.cookieSameSite,
      path: "/",
      ...maxAge !== void 0 ? { maxAge } : {}
    };
  }
  getInvitation(token) {
    return this.membershipsService.getInvitation(token);
  }
  async registerAndAccept(token, dto, req, res) {
    const invitation = this.membershipsService.getInvitation(token);
    const email = dto.email.toLowerCase().trim();
    if (email !== invitation.email.toLowerCase()) {
      throw new BadRequestException4("Invitation email does not match registration email");
    }
    const result = await this.authService.register(dto, req.headers["user-agent"], req.ip || req.headers["x-forwarded-for"]);
    try {
      await this.membershipsService.acceptInvitationForUser(token, result.userId);
      res.cookie("refreshToken", result.refreshToken, this.refreshCookieOptions(7 * 24 * 3600 * 1e3));
      return result;
    } catch (error) {
      await this.authService.removeNewlyRegisteredUser(result.userId);
      res.clearCookie("refreshToken", this.refreshCookieOptions());
      throw error;
    }
  }
  async acceptInvitation(token, user) {
    return this.membershipsService.acceptInvitationForUser(token, user.userId);
  }
};
__decorateClass([
  Get4(":token"),
  ApiOperation4({ summary: "Get invitation details" }),
  __decorateParam(0, Param4("token"))
], InvitationsController.prototype, "getInvitation", 1);
__decorateClass([
  Post4(":token/register"),
  HttpCode2(HttpStatus2.OK),
  ApiOperation4({ summary: "Create account and accept invitation" }),
  __decorateParam(0, Param4("token")),
  __decorateParam(1, Body4()),
  __decorateParam(2, Req2()),
  __decorateParam(3, Res2({ passthrough: true }))
], InvitationsController.prototype, "registerAndAccept", 1);
__decorateClass([
  Post4(":token/accept"),
  HttpCode2(HttpStatus2.OK),
  UseGuards4(JwtAuthGuard),
  ApiBearerAuth4(),
  ApiOperation4({ summary: "Accept invitation with current authenticated user" }),
  __decorateParam(0, Param4("token")),
  __decorateParam(1, CurrentUser())
], InvitationsController.prototype, "acceptInvitation", 1);
InvitationsController = __decorateClass([
  ApiTags4("Organization Invitations"),
  Controller4("api/v1/invitations")
], InvitationsController);

// src/modules/memberships/brevo-email.service.ts
import { Injectable as Injectable7 } from "@nestjs/common";
var BrevoEmailService = class {
  async sendInvitationEmail(input) {
    const apiKey = process.env.BREVO_API_KEY;
    const senderEmail = process.env.BREVO_SENDER_EMAIL || "no-reply@partneriq.local";
    const senderName = process.env.BREVO_SENDER_NAME || "PartnerIQ";
    if (!apiKey) {
      console.log(`Team invitation email skipped; BREVO_API_KEY is not configured. Invite link: ${input.inviteUrl}`);
      return { sent: false, reason: "BREVO_API_KEY_NOT_CONFIGURED" };
    }
    const response = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        accept: "application/json",
        "api-key": apiKey,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        sender: { email: senderEmail, name: senderName },
        to: [{ email: input.toEmail }],
        subject: `You're invited to ${input.organizationName} on PartnerIQ`,
        htmlContent: this.renderHtml(input),
        textContent: this.renderText(input)
      })
    });
    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new Error(`Brevo invitation email failed: ${response.status} ${errorText}`);
    }
    return { sent: true };
  }
  renderText(input) {
    return [
      `You've been invited to ${input.organizationName} on PartnerIQ.`,
      input.inviterEmail ? `${input.inviterEmail} invited you as ${input.role}.` : `Your role will be ${input.role}.`,
      `Accept your invitation: ${input.inviteUrl}`,
      "This invitation link expires in 7 days."
    ].join("\n\n");
  }
  renderHtml(input) {
    return `
      <div style="font-family:Arial,sans-serif;line-height:1.5;color:#0f172a">
        <h2 style="margin:0 0 12px">Join ${input.organizationName} on PartnerIQ</h2>
        <p>${input.inviterEmail ? `${input.inviterEmail} invited you` : "You have been invited"} as <strong>${input.role}</strong>.</p>
        <p>
          <a href="${input.inviteUrl}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:10px 14px;border-radius:8px;font-weight:700">
            Accept invitation
          </a>
        </p>
        <p style="font-size:12px;color:#64748b">This invitation link expires in 7 days.</p>
      </div>
    `;
  }
};
BrevoEmailService = __decorateClass([
  Injectable7()
], BrevoEmailService);

// src/modules/memberships/memberships.module.ts
var MembershipsModule = class {
};
MembershipsModule = __decorateClass([
  Module3({
    imports: [AuthModule],
    controllers: [MembershipsController, InvitationsController],
    providers: [MembershipsService, BrevoEmailService],
    exports: [MembershipsService]
  })
], MembershipsModule);

// src/modules/programs/programs.module.ts
import { Module as Module4 } from "@nestjs/common";

// src/modules/programs/programs.controller.ts
import {
  Controller as Controller5,
  Get as Get5,
  Post as Post5,
  Patch as Patch3,
  Delete as Delete3,
  Body as Body5,
  Param as Param5,
  UseGuards as UseGuards5,
  HttpCode as HttpCode3,
  HttpStatus as HttpStatus3
} from "@nestjs/common";
import { ApiTags as ApiTags5, ApiOperation as ApiOperation5, ApiBearerAuth as ApiBearerAuth5 } from "@nestjs/swagger";
var ProgramsController = class {
  constructor(programsService) {
    this.programsService = programsService;
  }
  async create(organizationId, user, dto) {
    return this.programsService.create(organizationId, user.userId, dto);
  }
  async findAll(organizationId) {
    return this.programsService.findAll(organizationId);
  }
  async findOne(organizationId, programId) {
    return this.programsService.findOne(organizationId, programId);
  }
  async update(organizationId, programId, dto, user) {
    return this.programsService.update(organizationId, programId, dto, user.userId);
  }
  async pause(organizationId, programId, user) {
    return this.programsService.pause(organizationId, programId, user.userId);
  }
  async activate(organizationId, programId, user) {
    return this.programsService.activate(organizationId, programId, user.userId);
  }
  async remove(organizationId, programId, user) {
    return this.programsService.remove(organizationId, programId, user.userId);
  }
};
__decorateClass([
  Post5(),
  RequirePermissions("manage.programs"),
  ApiOperation5({ summary: "Create a new partner program" }),
  __decorateParam(0, Param5("organizationId")),
  __decorateParam(1, CurrentUser()),
  __decorateParam(2, Body5())
], ProgramsController.prototype, "create", 1);
__decorateClass([
  Get5(),
  RequirePermissions("manage.programs"),
  ApiOperation5({ summary: "List all partner programs in organization" }),
  __decorateParam(0, Param5("organizationId"))
], ProgramsController.prototype, "findAll", 1);
__decorateClass([
  Get5(":programId"),
  RequirePermissions("manage.programs"),
  ApiOperation5({ summary: "Get specific partner program details" }),
  __decorateParam(0, Param5("organizationId")),
  __decorateParam(1, Param5("programId"))
], ProgramsController.prototype, "findOne", 1);
__decorateClass([
  Patch3(":programId"),
  RequirePermissions("manage.programs"),
  ApiOperation5({ summary: "Update partner program configuration" }),
  __decorateParam(0, Param5("organizationId")),
  __decorateParam(1, Param5("programId")),
  __decorateParam(2, Body5()),
  __decorateParam(3, CurrentUser())
], ProgramsController.prototype, "update", 1);
__decorateClass([
  Post5(":programId/pause"),
  HttpCode3(HttpStatus3.OK),
  RequirePermissions("manage.programs"),
  ApiOperation5({ summary: "Pause partner program" }),
  __decorateParam(0, Param5("organizationId")),
  __decorateParam(1, Param5("programId")),
  __decorateParam(2, CurrentUser())
], ProgramsController.prototype, "pause", 1);
__decorateClass([
  Post5(":programId/activate"),
  HttpCode3(HttpStatus3.OK),
  RequirePermissions("manage.programs"),
  ApiOperation5({ summary: "Activate partner program" }),
  __decorateParam(0, Param5("organizationId")),
  __decorateParam(1, Param5("programId")),
  __decorateParam(2, CurrentUser())
], ProgramsController.prototype, "activate", 1);
__decorateClass([
  Delete3(":programId"),
  RequirePermissions("manage.programs"),
  ApiOperation5({ summary: "Soft delete partner program" }),
  __decorateParam(0, Param5("organizationId")),
  __decorateParam(1, Param5("programId")),
  __decorateParam(2, CurrentUser())
], ProgramsController.prototype, "remove", 1);
ProgramsController = __decorateClass([
  ApiTags5("Partner Programs"),
  Controller5("api/v1/organizations/:organizationId/programs"),
  UseGuards5(JwtAuthGuard, OrganizationGuard, PermissionsGuard),
  ApiBearerAuth5()
], ProgramsController);

// src/modules/programs/programs.service.ts
import {
  Injectable as Injectable8,
  NotFoundException as NotFoundException5,
  BadRequestException as BadRequestException5
} from "@nestjs/common";
import { v4 as uuidv44 } from "uuid";
var ProgramsService = class {
  async create(organizationId, createdByUserId, dto) {
    const slug = dto.slug.toLowerCase().trim();
    const existing = dbStore.programs.find(
      (p) => p.organizationId === organizationId && p.slug === slug && !p.deletedAt
    );
    if (existing) {
      throw new BadRequestException5("Program with this slug already exists in organization");
    }
    const program = {
      id: uuidv44(),
      organizationId,
      name: dto.name,
      slug,
      type: dto.type,
      status: "ACTIVE" /* ACTIVE */,
      currency: dto.currency || "USD",
      commissionType: dto.commissionType,
      defaultCommissionValue: dto.defaultCommissionValue ?? (dto.defaultCommissionRate || 10) * 100,
      attributionModel: dto.attributionModel,
      cookieDurationDays: dto.cookieDurationDays || 30,
      affiliateApprovalMode: dto.affiliateApprovalMode || "AUTO",
      createdBy: createdByUserId,
      createdAt: /* @__PURE__ */ new Date(),
      updatedAt: /* @__PURE__ */ new Date()
    };
    dbStore.programs.push(program);
    dbStore.auditLogs.push({
      id: uuidv44(),
      organizationId,
      actorType: "USER",
      actorId: createdByUserId,
      action: "PROGRAM_CREATED" /* PROGRAM_CREATED */,
      resourceType: "program",
      resourceId: program.id,
      createdAt: /* @__PURE__ */ new Date()
    });
    return program;
  }
  async findAll(organizationId) {
    return dbStore.programs.filter(
      (p) => p.organizationId === organizationId && !p.deletedAt
    );
  }
  async findOne(organizationId, programId) {
    const program = dbStore.programs.find(
      (p) => p.id === programId && p.organizationId === organizationId && !p.deletedAt
    );
    if (!program) {
      throw new NotFoundException5("Program not found");
    }
    return program;
  }
  async update(organizationId, programId, dto, actorId) {
    const program = await this.findOne(organizationId, programId);
    const previous = { ...program };
    if (dto.name) program.name = dto.name;
    if (dto.defaultCommissionValue !== void 0) program.defaultCommissionValue = dto.defaultCommissionValue;
    if (dto.commissionType) program.commissionType = dto.commissionType;
    if (dto.attributionModel) program.attributionModel = dto.attributionModel;
    if (dto.cookieDurationDays !== void 0) program.cookieDurationDays = dto.cookieDurationDays;
    program.updatedAt = /* @__PURE__ */ new Date();
    dbStore.auditLogs.push({
      id: uuidv44(),
      organizationId,
      actorType: "USER",
      actorId,
      action: "PROGRAM_UPDATED" /* PROGRAM_UPDATED */,
      resourceType: "program",
      resourceId: program.id,
      metadata: {
        previous,
        updates: dto
      },
      createdAt: /* @__PURE__ */ new Date()
    });
    return program;
  }
  async pause(organizationId, programId, actorId) {
    const program = await this.findOne(organizationId, programId);
    program.status = "PAUSED" /* PAUSED */;
    program.updatedAt = /* @__PURE__ */ new Date();
    this.audit(organizationId, actorId, "PROGRAM_PAUSED", "program", program.id, { name: program.name });
    return program;
  }
  async activate(organizationId, programId, actorId) {
    const program = await this.findOne(organizationId, programId);
    program.status = "ACTIVE" /* ACTIVE */;
    program.updatedAt = /* @__PURE__ */ new Date();
    this.audit(organizationId, actorId, "PROGRAM_ACTIVATED", "program", program.id, { name: program.name });
    return program;
  }
  async remove(organizationId, programId, actorId) {
    const program = await this.findOne(organizationId, programId);
    program.deletedAt = /* @__PURE__ */ new Date();
    program.status = "ARCHIVED" /* ARCHIVED */;
    this.audit(organizationId, actorId, "PROGRAM_ARCHIVED", "program", program.id, { name: program.name });
    return { success: true, message: "Program archived" };
  }
  audit(organizationId, actorId, action, resourceType, resourceId, metadata) {
    dbStore.auditLogs.push({
      id: uuidv44(),
      organizationId,
      actorType: "USER",
      actorId,
      action,
      resourceType,
      resourceId,
      metadata,
      createdAt: /* @__PURE__ */ new Date()
    });
  }
};
ProgramsService = __decorateClass([
  Injectable8()
], ProgramsService);

// src/modules/programs/programs.module.ts
var ProgramsModule = class {
};
ProgramsModule = __decorateClass([
  Module4({
    controllers: [ProgramsController],
    providers: [ProgramsService],
    exports: [ProgramsService]
  })
], ProgramsModule);

// src/modules/affiliates/affiliates.module.ts
import { Module as Module5 } from "@nestjs/common";

// src/modules/affiliates/affiliates.controller.ts
import {
  Controller as Controller6,
  Get as Get6,
  Post as Post6,
  Body as Body6,
  Param as Param6,
  UseGuards as UseGuards6,
  HttpCode as HttpCode4,
  HttpStatus as HttpStatus4
} from "@nestjs/common";
import { ApiTags as ApiTags6, ApiOperation as ApiOperation6, ApiBearerAuth as ApiBearerAuth6 } from "@nestjs/swagger";
var AffiliatesController = class {
  constructor(affiliatesService) {
    this.affiliatesService = affiliatesService;
  }
  async create(organizationId, dto, user) {
    return this.affiliatesService.create(organizationId, dto, user.userId);
  }
  async findAll(organizationId) {
    return this.affiliatesService.findAll(organizationId);
  }
  async findOne(organizationId, affiliateId) {
    return this.affiliatesService.findOne(organizationId, affiliateId);
  }
  async publicApply(dto) {
    return this.affiliatesService.submitApplication(dto);
  }
  async getApplications(organizationId) {
    return this.affiliatesService.getApplications(organizationId);
  }
  async approveApplication(organizationId, applicationId, user) {
    return this.affiliatesService.approveApplication(organizationId, applicationId, user.userId);
  }
};
__decorateClass([
  Post6("api/v1/organizations/:organizationId/affiliates"),
  UseGuards6(JwtAuthGuard, OrganizationGuard, PermissionsGuard),
  RequirePermissions("manage.affiliates"),
  ApiBearerAuth6(),
  ApiOperation6({ summary: "Add affiliate directly to organization" }),
  __decorateParam(0, Param6("organizationId")),
  __decorateParam(1, Body6()),
  __decorateParam(2, CurrentUser())
], AffiliatesController.prototype, "create", 1);
__decorateClass([
  Get6("api/v1/organizations/:organizationId/affiliates"),
  UseGuards6(JwtAuthGuard, OrganizationGuard, PermissionsGuard),
  RequirePermissions("manage.affiliates"),
  ApiBearerAuth6(),
  ApiOperation6({ summary: "List all affiliates for organization" }),
  __decorateParam(0, Param6("organizationId"))
], AffiliatesController.prototype, "findAll", 1);
__decorateClass([
  Get6("api/v1/organizations/:organizationId/affiliates/:affiliateId"),
  UseGuards6(JwtAuthGuard, OrganizationGuard, PermissionsGuard),
  RequirePermissions("manage.affiliates"),
  ApiBearerAuth6(),
  ApiOperation6({ summary: "Get specific affiliate details" }),
  __decorateParam(0, Param6("organizationId")),
  __decorateParam(1, Param6("affiliateId"))
], AffiliatesController.prototype, "findOne", 1);
__decorateClass([
  Post6("api/v1/affiliate-applications/apply"),
  ApiOperation6({ summary: "Public endpoint for affiliates to apply to a program" }),
  __decorateParam(0, Body6())
], AffiliatesController.prototype, "publicApply", 1);
__decorateClass([
  Get6("api/v1/organizations/:organizationId/applications"),
  UseGuards6(JwtAuthGuard, OrganizationGuard, PermissionsGuard),
  RequirePermissions("manage.affiliates"),
  ApiBearerAuth6(),
  ApiOperation6({ summary: "List pending affiliate applications" }),
  __decorateParam(0, Param6("organizationId"))
], AffiliatesController.prototype, "getApplications", 1);
__decorateClass([
  Post6("api/v1/organizations/:organizationId/applications/:applicationId/approve"),
  HttpCode4(HttpStatus4.OK),
  UseGuards6(JwtAuthGuard, OrganizationGuard, PermissionsGuard),
  RequirePermissions("manage.affiliates"),
  ApiBearerAuth6(),
  ApiOperation6({ summary: "Approve an affiliate application" }),
  __decorateParam(0, Param6("organizationId")),
  __decorateParam(1, Param6("applicationId")),
  __decorateParam(2, CurrentUser())
], AffiliatesController.prototype, "approveApplication", 1);
AffiliatesController = __decorateClass([
  ApiTags6("Affiliates & Applications"),
  Controller6()
], AffiliatesController);

// src/modules/affiliates/affiliates.service.ts
import {
  Injectable as Injectable9,
  NotFoundException as NotFoundException6
} from "@nestjs/common";
import { v4 as uuidv45 } from "uuid";
var AffiliatesService = class {
  async create(organizationId, dto, actorId, skipAudit = false) {
    const email = dto.email.toLowerCase().trim();
    let affiliate = dbStore.affiliates.find(
      (a) => a.organizationId === organizationId && a.email === email
    );
    if (!affiliate) {
      affiliate = {
        id: uuidv45(),
        organizationId,
        displayName: dto.displayName,
        email,
        companyName: dto.companyName,
        website: dto.website,
        country: dto.country || "US",
        status: "ACTIVE" /* ACTIVE */,
        trustScore: 80,
        createdAt: /* @__PURE__ */ new Date(),
        updatedAt: /* @__PURE__ */ new Date()
      };
      dbStore.affiliates.push(affiliate);
    }
    const referralCode = SecurityUtils.generateRandomCode(6).toLowerCase();
    const progAffiliate = {
      id: uuidv45(),
      organizationId,
      programId: dto.programId,
      affiliateId: affiliate.id,
      status: "ACTIVE" /* ACTIVE */,
      referralCode,
      joinedAt: /* @__PURE__ */ new Date()
    };
    dbStore.programAffiliates.push(progAffiliate);
    const trackingLink = {
      id: uuidv45(),
      organizationId,
      programId: dto.programId,
      affiliateId: affiliate.id,
      destinationUrl: "https://example.com",
      shortCode: referralCode,
      status: "ACTIVE" /* ACTIVE */,
      createdAt: /* @__PURE__ */ new Date()
    };
    dbStore.trackingLinks.push(trackingLink);
    if (!skipAudit) {
      dbStore.auditLogs.push({
        id: uuidv45(),
        organizationId,
        actorType: actorId ? "USER" : "SYSTEM",
        actorId: actorId || "system",
        action: "AFFILIATE_CREATED",
        resourceType: "affiliate",
        resourceId: affiliate.id,
        metadata: {
          email: affiliate.email,
          displayName: affiliate.displayName,
          programId: dto.programId,
          programAffiliateId: progAffiliate.id,
          trackingLinkId: trackingLink.id
        },
        createdAt: /* @__PURE__ */ new Date()
      });
    }
    return { affiliate, programAffiliate: progAffiliate, trackingLink };
  }
  async findAll(organizationId) {
    return dbStore.affiliates.filter((a) => a.organizationId === organizationId);
  }
  async findOne(organizationId, affiliateId) {
    const affiliate = dbStore.affiliates.find(
      (a) => a.id === affiliateId && a.organizationId === organizationId
    );
    if (!affiliate) {
      throw new NotFoundException6("Affiliate not found");
    }
    const programs = dbStore.programAffiliates.filter(
      (pa) => pa.affiliateId === affiliate.id && pa.organizationId === organizationId
    );
    const links = dbStore.trackingLinks.filter(
      (tl) => tl.affiliateId === affiliate.id && tl.organizationId === organizationId
    );
    return { ...affiliate, programs, links };
  }
  // Public Application endpoint
  async submitApplication(dto) {
    const app = {
      id: uuidv45(),
      organizationId: dto.organizationId,
      programId: dto.programId,
      email: dto.email.toLowerCase().trim(),
      name: dto.name,
      website: dto.website,
      promotionMethod: dto.promotionMethod,
      country: "US",
      status: "PENDING" /* PENDING */,
      createdAt: /* @__PURE__ */ new Date()
    };
    dbStore.affiliateApplications.push(app);
    return { success: true, message: "Application submitted for review", applicationId: app.id };
  }
  async getApplications(organizationId) {
    return dbStore.affiliateApplications.filter((a) => a.organizationId === organizationId);
  }
  async approveApplication(organizationId, applicationId, reviewerId) {
    const app = dbStore.affiliateApplications.find(
      (a) => a.id === applicationId && a.organizationId === organizationId
    );
    if (!app) {
      throw new NotFoundException6("Application not found");
    }
    app.status = "APPROVED" /* APPROVED */;
    app.reviewedBy = reviewerId;
    app.reviewedAt = /* @__PURE__ */ new Date();
    const created = await this.create(organizationId, {
      displayName: app.name,
      email: app.email,
      website: app.website,
      programId: app.programId
    }, reviewerId, true);
    dbStore.auditLogs.push({
      id: uuidv45(),
      organizationId,
      actorType: "USER",
      actorId: reviewerId,
      action: "AFFILIATE_APPROVED" /* AFFILIATE_APPROVED */,
      resourceType: "affiliate_application",
      resourceId: app.id,
      createdAt: /* @__PURE__ */ new Date()
    });
    return { application: app, ...created };
  }
};
AffiliatesService = __decorateClass([
  Injectable9()
], AffiliatesService);

// src/modules/affiliates/affiliates.module.ts
var AffiliatesModule = class {
};
AffiliatesModule = __decorateClass([
  Module5({
    controllers: [AffiliatesController],
    providers: [AffiliatesService],
    exports: [AffiliatesService]
  })
], AffiliatesModule);

// src/modules/tracking/tracking.module.ts
import { Module as Module7 } from "@nestjs/common";

// src/modules/fraud/fraud.module.ts
import { Module as Module6 } from "@nestjs/common";

// src/modules/fraud/fraud.controller.ts
import {
  Body as Body7,
  Controller as Controller7,
  Get as Get7,
  HttpCode as HttpCode5,
  HttpStatus as HttpStatus5,
  Param as Param7,
  Post as Post7,
  Put,
  Query,
  UseGuards as UseGuards7
} from "@nestjs/common";
import { ApiBearerAuth as ApiBearerAuth7, ApiOperation as ApiOperation7, ApiTags as ApiTags7 } from "@nestjs/swagger";
var FraudController = class {
  constructor(fraudService) {
    this.fraudService = fraudService;
  }
  getDashboard(organizationId) {
    return this.fraudService.getDashboard(organizationId);
  }
  getReviews(organizationId) {
    return this.fraudService.getReviews(organizationId);
  }
  getAssessment(organizationId, assessmentId) {
    return this.fraudService.getAssessment(organizationId, assessmentId);
  }
  getSettings(organizationId, programId) {
    return this.fraudService.getSettings(organizationId, programId);
  }
  upsertSettings(organizationId, user, body) {
    return this.fraudService.upsertSettings(organizationId, user.userId, body);
  }
  assignReview(organizationId, reviewId, user, analystId) {
    return this.fraudService.assignReview(organizationId, reviewId, analystId, user.userId);
  }
  resolveReview(organizationId, reviewId, user, decision, reason, notes) {
    return this.fraudService.resolveReview(organizationId, reviewId, decision, user.userId, reason, notes);
  }
  updateAffiliateTrust(organizationId, affiliateId, score, reason) {
    return this.fraudService.updateAffiliateTrust(organizationId, affiliateId, score, reason || "Manual trust update", "MANUAL");
  }
};
__decorateClass([
  Get7("dashboard"),
  RequirePermissions("fraud.read"),
  ApiOperation7({ summary: "Get organization fraud dashboard metrics and rollups" }),
  __decorateParam(0, Param7("organizationId"))
], FraudController.prototype, "getDashboard", 1);
__decorateClass([
  Get7("reviews"),
  RequirePermissions("fraud.read"),
  ApiOperation7({ summary: "List fraud reviews for organization" }),
  __decorateParam(0, Param7("organizationId"))
], FraudController.prototype, "getReviews", 1);
__decorateClass([
  Get7("assessments/:assessmentId"),
  RequirePermissions("fraud.read"),
  ApiOperation7({ summary: "Get explainable fraud assessment with signals" }),
  __decorateParam(0, Param7("organizationId")),
  __decorateParam(1, Param7("assessmentId"))
], FraudController.prototype, "getAssessment", 1);
__decorateClass([
  Get7("settings"),
  RequirePermissions("fraud.read"),
  ApiOperation7({ summary: "Get organization or program fraud settings" }),
  __decorateParam(0, Param7("organizationId")),
  __decorateParam(1, Query("programId"))
], FraudController.prototype, "getSettings", 1);
__decorateClass([
  Put("settings"),
  RequirePermissions("fraud.settings.update"),
  ApiOperation7({ summary: "Create or update fraud settings" }),
  __decorateParam(0, Param7("organizationId")),
  __decorateParam(1, CurrentUser()),
  __decorateParam(2, Body7())
], FraudController.prototype, "upsertSettings", 1);
__decorateClass([
  Post7("reviews/:reviewId/assign"),
  HttpCode5(HttpStatus5.OK),
  RequirePermissions("fraud.review"),
  ApiOperation7({ summary: "Assign a fraud review to an analyst" }),
  __decorateParam(0, Param7("organizationId")),
  __decorateParam(1, Param7("reviewId")),
  __decorateParam(2, CurrentUser()),
  __decorateParam(3, Body7("analystId"))
], FraudController.prototype, "assignReview", 1);
__decorateClass([
  Post7("reviews/:reviewId/resolve"),
  HttpCode5(HttpStatus5.OK),
  RequirePermissions("fraud.review"),
  ApiOperation7({ summary: "Approve, reject, or escalate a fraud review" }),
  __decorateParam(0, Param7("organizationId")),
  __decorateParam(1, Param7("reviewId")),
  __decorateParam(2, CurrentUser()),
  __decorateParam(3, Body7("decision")),
  __decorateParam(4, Body7("reason")),
  __decorateParam(5, Body7("notes"))
], FraudController.prototype, "resolveReview", 1);
__decorateClass([
  Post7("affiliates/:affiliateId/trust"),
  HttpCode5(HttpStatus5.OK),
  RequirePermissions("fraud.review"),
  ApiOperation7({ summary: "Update affiliate trust score with history" }),
  __decorateParam(0, Param7("organizationId")),
  __decorateParam(1, Param7("affiliateId")),
  __decorateParam(2, Body7("score")),
  __decorateParam(3, Body7("reason"))
], FraudController.prototype, "updateAffiliateTrust", 1);
FraudController = __decorateClass([
  ApiTags7("Fraud Risk Intelligence"),
  Controller7("api/v1/organizations/:organizationId/fraud"),
  UseGuards7(JwtAuthGuard, OrganizationGuard, PermissionsGuard),
  ApiBearerAuth7()
], FraudController);

// src/modules/fraud/fraud-context.factory.ts
import { Injectable as Injectable10 } from "@nestjs/common";
import { createHmac as createHmac2 } from "crypto";
var FraudContextFactory = class {
  fromClick(click, rawIp) {
    return {
      organizationId: click.organizationId,
      programId: click.programId,
      entityType: "CLICK" /* CLICK */,
      entityId: click.id,
      clickId: click.id,
      affiliateId: click.affiliateId,
      anonymousId: click.anonymousId,
      ipHash: click.ipHash,
      rawIp,
      deviceId: click.anonymousId,
      userAgent: click.userAgent,
      referrer: click.referrer,
      country: click.country,
      occurredAt: click.createdAt,
      metadata: { trackingLinkId: click.trackingLinkId }
    };
  }
  fromConversion(conversion) {
    const attribution = dbStore.attributions.find(
      (item) => item.organizationId === conversion.organizationId && item.affiliateId === conversion.affiliateId && (item.customerExternalId === conversion.customerExternalId || item.anonymousId === conversion.customerExternalId)
    );
    const click = attribution ? dbStore.clicks.find((item) => item.id === attribution.clickId) : void 0;
    return {
      organizationId: conversion.organizationId,
      programId: conversion.programId,
      entityType: "CONVERSION" /* CONVERSION */,
      entityId: conversion.id,
      conversionId: conversion.id,
      clickId: click?.id,
      affiliateId: conversion.affiliateId,
      anonymousId: attribution?.anonymousId,
      customerExternalId: conversion.customerExternalId,
      ipHash: click?.ipHash,
      deviceId: attribution?.anonymousId,
      userAgent: click?.userAgent,
      referrer: click?.referrer,
      country: click?.country,
      amount: conversion.amount,
      currency: conversion.currency,
      clickedAt: click?.createdAt,
      convertedAt: conversion.occurredAt,
      occurredAt: conversion.occurredAt || conversion.createdAt,
      metadata: { externalId: conversion.externalId, productId: conversion.productId }
    };
  }
  fromPayout(batch) {
    const items = dbStore.payoutItems.filter((item) => item.batchId === batch.id);
    const firstItem = items[0];
    const programId = dbStore.programs.find((program) => program.organizationId === batch.organizationId)?.id || "00000000-0000-0000-0000-000000000000";
    return {
      organizationId: batch.organizationId,
      programId,
      entityType: "PAYOUT" /* PAYOUT */,
      entityId: batch.id,
      payoutId: batch.id,
      affiliateId: firstItem?.affiliateId,
      amount: batch.totalAmount,
      currency: batch.currency,
      occurredAt: /* @__PURE__ */ new Date(),
      metadata: { payoutItems: items.length }
    };
  }
  hashIp(rawIp) {
    if (!rawIp) return void 0;
    return createHmac2("sha256", process.env.FRAUD_IP_HASH_SECRET || process.env.JWT_SECRET || "partneriq-fraud-ip-salt").update(rawIp).digest("hex");
  }
};
FraudContextFactory = __decorateClass([
  Injectable10()
], FraudContextFactory);

// src/modules/fraud/fraud-decision.service.ts
import { Injectable as Injectable11 } from "@nestjs/common";
var FraudDecisionService = class {
  decide(context, score, policy) {
    if (!policy.enabled) return "ALLOW" /* ALLOW */;
    if (context.entityType === "PAYOUT" /* PAYOUT */) {
      if (score >= policy.payoutHoldScore) return "HOLD" /* HOLD */;
      if (score > policy.allowMaxScore) return "REVIEW" /* REVIEW */;
      return "ALLOW" /* ALLOW */;
    }
    if (score >= policy.blockMinScore) return "BLOCK" /* BLOCK */;
    if (score > policy.allowMaxScore && score <= policy.reviewMaxScore) return "REVIEW" /* REVIEW */;
    return "ALLOW" /* ALLOW */;
  }
};
FraudDecisionService = __decorateClass([
  Injectable11()
], FraudDecisionService);

// src/modules/fraud/fraud-engine.service.ts
import { Injectable as Injectable12 } from "@nestjs/common";
import { v4 as uuidv46 } from "uuid";

// src/modules/fraud/fraud.types.ts
var FRAUD_ENGINE_VERSION = "fraud-v1";

// src/modules/fraud/fraud-engine.service.ts
var FraudEngineService = class {
  constructor(registry, policyService, scoreService, decisionService) {
    this.registry = registry;
    this.policyService = policyService;
    this.scoreService = scoreService;
    this.decisionService = decisionService;
  }
  async assess(context, assessmentType = "INITIAL" /* INITIAL */) {
    const policy = this.policyService.resolvePolicy(context.organizationId, context.programId);
    const evaluators = this.registry.getEnabled(policy.enabledSignals);
    const signals = [];
    for (const evaluator of evaluators) {
      try {
        signals.push(await evaluator.evaluate(context));
      } catch (error) {
        signals.push({
          code: evaluator.code,
          category: evaluator.category,
          detected: false,
          score: 0,
          confidence: 0,
          reason: "Signal unavailable; assessment continued with reduced confidence.",
          metadata: { error: error?.code || error?.message || "signal_failed" }
        });
      }
    }
    const aggregate = this.scoreService.aggregate(signals, policy);
    const decision = this.decisionService.decide(context, aggregate.score, policy);
    const assessment = {
      id: uuidv46(),
      organizationId: context.organizationId,
      programId: context.programId,
      entityType: context.entityType,
      entityId: context.entityId,
      affiliateId: context.affiliateId,
      score: aggregate.score,
      confidence: aggregate.confidence,
      riskLevel: aggregate.riskLevel,
      decision,
      engineVersion: FRAUD_ENGINE_VERSION,
      policyVersion: policy.policyVersion,
      assessmentType,
      categoryScores: aggregate.categoryScores,
      amount: context.amount,
      createdAt: /* @__PURE__ */ new Date()
    };
    dbStore.fraudAssessments.push(assessment);
    for (const signal of signals.filter((item) => item.detected || item.score > 0)) {
      dbStore.fraudSignals.push({
        id: uuidv46(),
        assessmentId: assessment.id,
        signalCode: signal.code,
        category: signal.category,
        detected: signal.detected,
        score: signal.score,
        confidence: signal.confidence,
        reason: signal.reason,
        metadata: this.sanitizeMetadata(signal.metadata),
        createdAt: /* @__PURE__ */ new Date()
      });
    }
    if (decision === "REVIEW" /* REVIEW */ || decision === "BLOCK" /* BLOCK */ || decision === "HOLD" /* HOLD */) {
      this.createReview(context, assessment.id, aggregate.score, aggregate.confidence, aggregate.riskLevel, decision, signals);
    }
    this.updateRollup(context, aggregate.score, decision);
    this.audit(context, assessment.id, decision, aggregate.score);
    return {
      assessmentId: assessment.id,
      score: aggregate.score,
      confidence: aggregate.confidence,
      riskLevel: aggregate.riskLevel,
      decision,
      assessmentType,
      categoryScores: aggregate.categoryScores,
      signals
    };
  }
  createReview(context, assessmentId, score, confidence, riskLevel, decision, signals) {
    const existing = dbStore.fraudReviews.find(
      (review) => review.organizationId === context.organizationId && review.assessmentId === assessmentId
    );
    if (existing) return;
    dbStore.fraudReviews.push({
      id: uuidv46(),
      organizationId: context.organizationId,
      programId: context.programId,
      conversionId: context.conversionId || context.entityId,
      assessmentId,
      entityType: context.entityType,
      entityId: context.entityId,
      fraudScore: score,
      confidence,
      riskLevel,
      signals: signals.filter((signal) => signal.detected).map((signal) => ({
        code: signal.code,
        category: signal.category,
        score: signal.score,
        confidence: signal.confidence,
        reason: signal.reason
      })),
      status: decision === "BLOCK" /* BLOCK */ || decision === "HOLD" /* HOLD */ ? "IN_REVIEW" /* IN_REVIEW */ : "PENDING" /* PENDING */,
      reviewDecision: decision,
      createdAt: /* @__PURE__ */ new Date(),
      updatedAt: /* @__PURE__ */ new Date()
    });
  }
  updateRollup(context, score, decision) {
    const date = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    let rollup = dbStore.fraudMetricRollups.find(
      (item) => item.organizationId === context.organizationId && item.programId === context.programId && item.date === date
    );
    if (!rollup) {
      rollup = {
        id: uuidv46(),
        organizationId: context.organizationId,
        programId: context.programId,
        date,
        assessments: 0,
        highRiskCount: 0,
        blockedCount: 0,
        reviewCount: 0,
        fraudPreventedAmount: 0,
        averageScore: 0,
        updatedAt: /* @__PURE__ */ new Date()
      };
      dbStore.fraudMetricRollups.push(rollup);
    }
    rollup.averageScore = Math.round((rollup.averageScore * rollup.assessments + score) / (rollup.assessments + 1));
    rollup.assessments += 1;
    rollup.highRiskCount += score >= 71 ? 1 : 0;
    rollup.blockedCount += decision === "BLOCK" /* BLOCK */ || decision === "HOLD" /* HOLD */ ? 1 : 0;
    rollup.reviewCount += decision === "REVIEW" /* REVIEW */ ? 1 : 0;
    rollup.fraudPreventedAmount += decision === "BLOCK" /* BLOCK */ || decision === "HOLD" /* HOLD */ ? Number(context.amount || 0) : 0;
    rollup.updatedAt = /* @__PURE__ */ new Date();
  }
  audit(context, assessmentId, decision, score) {
    dbStore.auditLogs.push({
      id: uuidv46(),
      organizationId: context.organizationId,
      actorType: "SYSTEM",
      actorId: "fraud-engine",
      action: "FRAUD_ASSESSMENT_CREATED",
      resourceType: "fraud_assessment",
      resourceId: assessmentId,
      metadata: { entityType: context.entityType, entityId: context.entityId, decision, score },
      createdAt: /* @__PURE__ */ new Date()
    });
  }
  sanitizeMetadata(metadata) {
    if (!metadata) return void 0;
    const { rawIp, email, paymentIdentifier, ...safe2 } = metadata;
    return safe2;
  }
};
FraudEngineService = __decorateClass([
  Injectable12()
], FraudEngineService);

// src/modules/fraud/fraud-policy.service.ts
import { Injectable as Injectable13 } from "@nestjs/common";
var DEFAULT_ENABLED_SIGNALS = [
  "IP_REPUTATION" /* IP_REPUTATION */,
  "IP_VELOCITY" /* IP_VELOCITY */,
  "AFFILIATE_VELOCITY" /* AFFILIATE_VELOCITY */,
  "DEVICE_VELOCITY" /* DEVICE_VELOCITY */,
  "DUPLICATE_DEVICE" /* DUPLICATE_DEVICE */,
  "GEO_MISMATCH" /* GEO_MISMATCH */,
  "SELF_REFERRAL" /* SELF_REFERRAL */,
  "FAST_CONVERSION" /* FAST_CONVERSION */,
  "DUPLICATE_CONVERSION" /* DUPLICATE_CONVERSION */,
  "SUSPICIOUS_USER_AGENT" /* SUSPICIOUS_USER_AGENT */,
  "AMOUNT_ANOMALY" /* AMOUNT_ANOMALY */,
  "AFFILIATE_LOW_TRUST" /* AFFILIATE_LOW_TRUST */,
  "AFFILIATE_HIGH_REFUND_RATE" /* AFFILIATE_HIGH_REFUND_RATE */,
  "PAYOUT_AMOUNT_ANOMALY" /* PAYOUT_AMOUNT_ANOMALY */
];
var FraudPolicyService = class {
  resolvePolicy(organizationId, programId) {
    const settings = programId && dbStore.fraudSettings.find((item) => item.organizationId === organizationId && item.programId === programId) || dbStore.fraudSettings.find((item) => item.organizationId === organizationId && !item.programId);
    if (!settings) {
      return {
        enabled: true,
        sensitivity: "BALANCED" /* BALANCED */,
        allowMaxScore: 30,
        reviewMaxScore: 70,
        blockMinScore: 71,
        payoutHoldScore: 71,
        enabledSignals: DEFAULT_ENABLED_SIGNALS,
        signalWeights: this.defaultWeights(),
        policyVersion: "system-default-v1"
      };
    }
    return {
      enabled: settings.enabled,
      sensitivity: settings.sensitivity,
      allowMaxScore: settings.allowMaxScore,
      reviewMaxScore: settings.reviewMaxScore,
      blockMinScore: settings.blockMinScore,
      payoutHoldScore: settings.payoutHoldScore,
      enabledSignals: settings.enabledSignals?.length ? settings.enabledSignals : DEFAULT_ENABLED_SIGNALS,
      signalWeights: { ...this.defaultWeights(), ...settings.signalWeights || {} },
      policyVersion: `settings-${settings.id}`
    };
  }
  defaultWeights() {
    return {
      NETWORK: 20,
      DEVICE: 20,
      TRAFFIC: 20,
      CONVERSION: 20,
      AFFILIATE: 20,
      IDENTITY: 15,
      BEHAVIOR: 15,
      PAYMENT: 15,
      PAYOUT: 30
    };
  }
};
FraudPolicyService = __decorateClass([
  Injectable13()
], FraudPolicyService);

// src/modules/fraud/fraud-score.service.ts
import { Injectable as Injectable14 } from "@nestjs/common";
var FraudScoreService = class {
  aggregate(signals, policy) {
    const categoryScores = {};
    const categoryConfidence = {};
    for (const signal of signals) {
      const category = signal.category;
      const current = categoryScores[category] || 0;
      categoryScores[category] = Math.max(current, this.clamp(signal.score));
      categoryConfidence[category] = [...categoryConfidence[category] || [], signal.confidence];
    }
    const detectedCategoryScores = Object.entries(categoryScores).filter(([, score2]) => score2 > 0);
    const totalWeight = detectedCategoryScores.reduce((sum, [category]) => sum + Math.max(0, Math.min(50, policy.signalWeights[category] || 0)), 0);
    const weightedScore = totalWeight === 0 ? 0 : detectedCategoryScores.reduce((sum, [category, score2]) => {
      const weight = Math.max(0, Math.min(50, policy.signalWeights[category] || 0));
      return sum + score2 * (weight / totalWeight);
    }, 0);
    const availableSignals = signals.filter((signal) => signal.confidence > 0).length;
    const avgConfidence = availableSignals ? signals.reduce((sum, signal) => sum + signal.confidence, 0) / availableSignals : 0;
    const detectedCount = signals.filter((signal) => signal.detected).length;
    const completeness = Math.min(100, availableSignals / Math.max(1, policy.enabledSignals.length) * 100);
    const confidence = this.clamp(Math.round(avgConfidence * 0.7 + completeness * 0.2 + Math.min(detectedCount * 4, 10)));
    const score = this.clamp(Math.round(weightedScore));
    return {
      score,
      confidence,
      riskLevel: this.riskLevel(score),
      categoryScores
    };
  }
  riskLevel(score) {
    if (score >= 90) return "CRITICAL" /* CRITICAL */;
    if (score >= 71) return "HIGH" /* HIGH */;
    if (score >= 31) return "MEDIUM" /* MEDIUM */;
    return "LOW" /* LOW */;
  }
  clamp(value) {
    return Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
  }
};
FraudScoreService = __decorateClass([
  Injectable14()
], FraudScoreService);

// src/modules/fraud/fraud.service.ts
import { BadRequestException as BadRequestException7, Injectable as Injectable15, NotFoundException as NotFoundException7 } from "@nestjs/common";
import { v4 as uuidv47 } from "uuid";
var FraudService = class {
  constructor(contextFactory, engine) {
    this.contextFactory = contextFactory;
    this.engine = engine;
  }
  async evaluateClick(clickId, rawIp) {
    const click = dbStore.clicks.find((item) => item.id === clickId);
    if (!click) throw new NotFoundException7("Click not found");
    const result = await this.engine.assess(this.contextFactory.fromClick(click, rawIp), "INITIAL" /* INITIAL */);
    click.fraudScore = result.score;
    click.fraudStatus = this.legacyFraudStatus(result.score);
    return result;
  }
  async evaluateConversion(conversion) {
    const result = await this.engine.assess(this.contextFactory.fromConversion(conversion), "INITIAL" /* INITIAL */);
    return { ...result, status: this.legacyFraudStatus(result.score) };
  }
  async evaluatePayout(batch) {
    return this.engine.assess(this.contextFactory.fromPayout(batch), "PAYOUT_CHECK" /* PAYOUT_CHECK */);
  }
  async getReviews(organizationId) {
    const reviewRows = dbStore.fraudReviews.filter((review) => review.organizationId === organizationId).map((review) => this.expandReview(review));
    const reviewedAssessmentIds = new Set(reviewRows.map((review) => review.assessmentId).filter(Boolean));
    const assessmentRows = dbStore.fraudAssessments.filter((assessment) => assessment.organizationId === organizationId && !reviewedAssessmentIds.has(assessment.id)).map((assessment) => this.expandAssessment(assessment));
    return [...reviewRows, ...assessmentRows].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }
  async getAssessment(organizationId, assessmentId) {
    const assessment = dbStore.fraudAssessments.find((item) => item.id === assessmentId && item.organizationId === organizationId);
    if (!assessment) throw new NotFoundException7("FRAUD_ASSESSMENT_NOT_FOUND");
    return {
      ...assessment,
      signals: dbStore.fraudSignals.filter((signal) => signal.assessmentId === assessment.id)
    };
  }
  async getSettings(organizationId, programId) {
    return dbStore.fraudSettings.find((item) => item.organizationId === organizationId && (programId ? item.programId === programId : !item.programId)) || null;
  }
  async upsertSettings(organizationId, userId, dto) {
    this.validateSettings(dto);
    const existing = dbStore.fraudSettings.find(
      (item) => item.organizationId === organizationId && (dto.programId ? item.programId === dto.programId : !item.programId)
    );
    const record = {
      ...existing || { id: uuidv47(), organizationId, createdBy: userId, createdAt: /* @__PURE__ */ new Date() },
      programId: dto.programId,
      enabled: dto.enabled ?? true,
      sensitivity: dto.sensitivity || "BALANCED",
      allowMaxScore: dto.allowMaxScore ?? 30,
      reviewMaxScore: dto.reviewMaxScore ?? 70,
      blockMinScore: dto.blockMinScore ?? 71,
      payoutHoldScore: dto.payoutHoldScore ?? 71,
      enabledSignals: dto.enabledSignals,
      signalWeights: dto.signalWeights,
      updatedAt: /* @__PURE__ */ new Date()
    };
    if (existing) Object.assign(existing, record);
    else dbStore.fraudSettings.push(record);
    return record;
  }
  async resolveReview(organizationId, reviewId, decision, reviewerId, reason, notes) {
    const review = dbStore.fraudReviews.find((item) => item.id === reviewId && item.organizationId === organizationId);
    if (!review) throw new NotFoundException7("FRAUD_REVIEW_NOT_FOUND");
    if (review.status === "APPROVED" /* APPROVED */ || review.status === "REJECTED" /* REJECTED */) {
      throw new BadRequestException7("FRAUD_REVIEW_ALREADY_COMPLETED");
    }
    review.status = decision === "APPROVED" ? "APPROVED" /* APPROVED */ : decision === "REJECTED" ? "REJECTED" /* REJECTED */ : "ESCALATED" /* ESCALATED */;
    review.reviewDecision = decision;
    review.reviewedBy = reviewerId;
    review.reviewedAt = /* @__PURE__ */ new Date();
    review.decisionReason = reason;
    review.reviewNotes = notes;
    review.updatedAt = /* @__PURE__ */ new Date();
    if (review.entityType === "CONVERSION" /* CONVERSION */ || review.conversionId) {
      const conversion = dbStore.conversions.find((item) => item.id === (review.entityId || review.conversionId));
      if (conversion) {
        conversion.status = decision === "APPROVED" ? "APPROVED" /* APPROVED */ : "REJECTED" /* REJECTED */;
      }
    }
    dbStore.auditLogs.push({
      id: uuidv47(),
      organizationId,
      actorType: "USER",
      actorId: reviewerId,
      action: "FRAUD_REVIEW_RESOLVED",
      resourceType: "fraud_review",
      resourceId: review.id,
      metadata: { decision, reason },
      createdAt: /* @__PURE__ */ new Date()
    });
    return this.expandReview(review);
  }
  assignReview(organizationId, reviewId, analystId, actorId) {
    const review = dbStore.fraudReviews.find((item) => item.id === reviewId && item.organizationId === organizationId);
    if (!review) throw new NotFoundException7("FRAUD_REVIEW_NOT_FOUND");
    review.assignedTo = analystId;
    review.status = "IN_REVIEW" /* IN_REVIEW */;
    review.updatedAt = /* @__PURE__ */ new Date();
    dbStore.auditLogs.push({
      id: uuidv47(),
      organizationId,
      actorType: "USER",
      actorId,
      action: "FRAUD_REVIEW_ASSIGNED",
      resourceType: "fraud_review",
      resourceId: review.id,
      metadata: { analystId },
      createdAt: /* @__PURE__ */ new Date()
    });
    return this.expandReview(review);
  }
  updateAffiliateTrust(organizationId, affiliateId, newScore, reason, source = "AUTOMATED" /* AUTOMATED */) {
    const affiliate = dbStore.affiliates.find((item) => item.organizationId === organizationId && item.id === affiliateId);
    if (!affiliate) throw new NotFoundException7("Affiliate not found");
    const previousScore = affiliate.trustScore ?? 50;
    affiliate.trustScore = Math.max(0, Math.min(100, Math.round(newScore)));
    dbStore.affiliateTrustHistory.push({
      id: uuidv47(),
      organizationId,
      affiliateId,
      previousScore,
      newScore: affiliate.trustScore,
      reason,
      source,
      createdAt: /* @__PURE__ */ new Date()
    });
    return { affiliateId, previousScore, newScore: affiliate.trustScore };
  }
  getDashboard(organizationId) {
    const assessments = dbStore.fraudAssessments.filter((item) => item.organizationId === organizationId);
    const reviews = dbStore.fraudReviews.filter((item) => item.organizationId === organizationId);
    const signals = dbStore.fraudSignals.filter((signal) => assessments.some((assessment) => assessment.id === signal.assessmentId));
    return {
      metrics: {
        assessments: assessments.length,
        fraudPrevented: assessments.filter((item) => item.decision === "BLOCK" /* BLOCK */ || item.decision === "HOLD" /* HOLD */).reduce((total, item) => total + Number(item.amount || 0), 0),
        highRiskEvents: assessments.filter((item) => item.score >= 71).length,
        pendingReviews: reviews.filter((item) => item.status === "PENDING" /* PENDING */ || item.status === "IN_REVIEW" /* IN_REVIEW */).length,
        fraudRate: assessments.length ? Math.round(assessments.filter((item) => item.score >= 71).length / assessments.length * 1e3) / 10 : 0,
        averageRiskScore: assessments.length ? Math.round(assessments.reduce((sum, item) => sum + item.score, 0) / assessments.length) : 0
      },
      riskDistribution: ["LOW", "MEDIUM", "HIGH", "CRITICAL"].map((riskLevel) => ({
        riskLevel,
        count: assessments.filter((item) => item.riskLevel === riskLevel).length
      })),
      topSignals: Object.entries(
        signals.reduce((map, signal) => ({ ...map, [signal.signalCode]: (map[signal.signalCode] || 0) + 1 }), {})
      ).map(([code, count]) => ({ code, count })),
      reviews: reviews.map((review) => this.expandReview(review))
    };
  }
  expandReview(review) {
    const conversion = dbStore.conversions.find((item) => item.id === (review.entityId || review.conversionId));
    const assessment = review.assessmentId ? dbStore.fraudAssessments.find((item) => item.id === review.assessmentId) : void 0;
    const affiliateId = conversion?.affiliateId || assessment?.affiliateId;
    const affiliate = affiliateId ? dbStore.affiliates.find((item) => item.id === affiliateId) : void 0;
    const program = dbStore.programs.find((item) => item.id === review.programId);
    const organization = dbStore.organizations.find((item) => item.id === review.organizationId);
    return {
      ...review,
      organizationName: organization?.name,
      programName: program?.name,
      affiliateName: affiliate?.displayName || "Unassigned",
      amount: conversion?.amount || review.signals?.reduce?.(() => 0, 0) || 0,
      assessment,
      signalRows: review.assessmentId ? dbStore.fraudSignals.filter((signal) => signal.assessmentId === review.assessmentId) : []
    };
  }
  expandAssessment(assessment) {
    const click = assessment.entityType === "CLICK" /* CLICK */ ? dbStore.clicks.find((item) => item.id === assessment.entityId) : void 0;
    const conversion = assessment.entityType === "CONVERSION" /* CONVERSION */ ? dbStore.conversions.find((item) => item.id === assessment.entityId) : void 0;
    const affiliateId = assessment.affiliateId || click?.affiliateId || conversion?.affiliateId;
    const affiliate = affiliateId ? dbStore.affiliates.find((item) => item.id === affiliateId) : void 0;
    const program = dbStore.programs.find((item) => item.id === assessment.programId);
    const organization = dbStore.organizations.find((item) => item.id === assessment.organizationId);
    const signalRows = dbStore.fraudSignals.filter((signal) => signal.assessmentId === assessment.id);
    return {
      id: assessment.id,
      organizationId: assessment.organizationId,
      programId: assessment.programId,
      conversionId: conversion?.id,
      assessmentId: assessment.id,
      entityType: assessment.entityType,
      entityId: assessment.entityId,
      fraudScore: assessment.score,
      confidence: assessment.confidence,
      riskLevel: assessment.riskLevel,
      status: "PENDING" /* PENDING */,
      reviewDecision: assessment.decision,
      createdAt: assessment.createdAt,
      updatedAt: assessment.createdAt,
      organizationName: organization?.name,
      programName: program?.name,
      affiliateName: affiliate?.displayName || "Unassigned",
      amount: conversion?.amount || assessment.amount || 0,
      assessment,
      signalRows,
      signals: signalRows.map((signal) => ({
        code: signal.signalCode,
        category: signal.category,
        score: signal.score,
        confidence: signal.confidence,
        reason: signal.reason
      }))
    };
  }
  validateSettings(dto) {
    const allowMaxScore = dto.allowMaxScore ?? 30;
    const reviewMaxScore = dto.reviewMaxScore ?? 70;
    const blockMinScore = dto.blockMinScore ?? 71;
    if (allowMaxScore < 0 || reviewMaxScore > 100 || blockMinScore < 0 || blockMinScore > 100 || allowMaxScore >= blockMinScore) {
      throw new BadRequestException7("FRAUD_SETTINGS_INVALID");
    }
    if (reviewMaxScore >= blockMinScore) {
      throw new BadRequestException7("FRAUD_SETTINGS_INVALID");
    }
  }
  legacyFraudStatus(score) {
    if (score >= 71) return "HIGH" /* HIGH */;
    if (score >= 31) return "MEDIUM" /* MEDIUM */;
    return "LOW" /* LOW */;
  }
};
FraudService = __decorateClass([
  Injectable15()
], FraudService);

// src/modules/fraud/fraud-signal-registry.ts
import { Injectable as Injectable16 } from "@nestjs/common";
var FraudSignalRegistry = class {
  constructor() {
    this.evaluators = /* @__PURE__ */ new Map();
  }
  register(evaluator) {
    this.evaluators.set(evaluator.code, evaluator);
  }
  getEnabled(codes) {
    return codes.map((code) => this.evaluators.get(code)).filter(Boolean);
  }
  all() {
    return Array.from(this.evaluators.values());
  }
};
FraudSignalRegistry = __decorateClass([
  Injectable16()
], FraudSignalRegistry);

// src/modules/fraud/signals/phase-one-signals.ts
import { Injectable as Injectable17 } from "@nestjs/common";
var safe = (code, category, reason) => ({
  code,
  category,
  detected: false,
  score: 0,
  confidence: 70,
  reason
});
var IpReputationSignal = class {
  constructor() {
    this.code = "IP_REPUTATION" /* IP_REPUTATION */;
    this.category = "NETWORK" /* NETWORK */;
  }
  async evaluate(context) {
    const rawIp = String(context.rawIp || "");
    const forwardedChain = rawIp.split(",").map((item) => item.trim()).filter(Boolean);
    const proxyChainDetected = forwardedChain.length > 1;
    const proxyHeaderDetected = /proxy|vpn|tor/i.test(String(context.metadata?.networkHint || ""));
    const detected = proxyChainDetected || proxyHeaderDetected;
    const score = detected ? 80 : 0;
    return {
      code: this.code,
      category: this.category,
      detected,
      score,
      confidence: detected ? 82 : 60,
      reason: detected ? "Traffic arrived through a forwarded proxy/VPN-style IP chain." : "No proxy/VPN network indicators were observed.",
      metadata: {
        forwardedHops: forwardedChain.length,
        firstHopPresent: Boolean(forwardedChain[0])
      }
    };
  }
};
IpReputationSignal = __decorateClass([
  Injectable17()
], IpReputationSignal);
var IpVelocitySignal = class {
  constructor(velocity) {
    this.velocity = velocity;
    this.code = "IP_VELOCITY" /* IP_VELOCITY */;
    this.category = "NETWORK" /* NETWORK */;
  }
  async evaluate(context) {
    if (!context.ipHash) return safe(this.code, this.category, "No privacy-safe IP hash was available.");
    const suffix = context.entityType === "CONVERSION" /* CONVERSION */ ? "conversion:1h" : "click:1m";
    const ttl = context.entityType === "CONVERSION" /* CONVERSION */ ? 3600 : 60;
    const count = await this.velocity.increment(`fraud:v1:ip:${context.organizationId}:${context.ipHash}:${suffix}`, ttl);
    const score = count > 120 ? 85 : count > 30 ? 55 : count > 10 ? 25 : 0;
    return {
      code: this.code,
      category: this.category,
      detected: score > 0,
      score,
      confidence: count > 30 ? 90 : 65,
      reason: score > 0 ? `${count} ${context.entityType.toLowerCase()} events were observed from the same IP window.` : "IP velocity is within expected range.",
      metadata: { count, window: suffix }
    };
  }
};
IpVelocitySignal = __decorateClass([
  Injectable17()
], IpVelocitySignal);
var AffiliateVelocitySignal = class {
  constructor(velocity) {
    this.velocity = velocity;
    this.code = "AFFILIATE_VELOCITY" /* AFFILIATE_VELOCITY */;
    this.category = "TRAFFIC" /* TRAFFIC */;
  }
  async evaluate(context) {
    if (!context.affiliateId) return safe(this.code, this.category, "No affiliate was attached to this event.");
    const count = await this.velocity.increment(`fraud:v1:affiliate:${context.organizationId}:${context.affiliateId}:1h`, 3600);
    const score = count > 500 ? 80 : count > 100 ? 45 : count > 30 ? 20 : 0;
    return {
      code: this.code,
      category: this.category,
      detected: score > 0,
      score,
      confidence: count > 100 ? 85 : 60,
      reason: score > 0 ? `${count} affiliate events were observed in the current hour.` : "Affiliate event velocity is within expected range.",
      metadata: { count, window: "1h" }
    };
  }
};
AffiliateVelocitySignal = __decorateClass([
  Injectable17()
], AffiliateVelocitySignal);
var DeviceVelocitySignal = class {
  constructor(velocity) {
    this.velocity = velocity;
    this.code = "DEVICE_VELOCITY" /* DEVICE_VELOCITY */;
    this.category = "DEVICE" /* DEVICE */;
  }
  async evaluate(context) {
    if (!context.deviceId) return safe(this.code, this.category, "No first-party device identifier was available.");
    const count = await this.velocity.increment(`fraud:v1:device:${context.organizationId}:${context.deviceId}:1h`, 3600);
    const score = count > 100 ? 75 : count > 30 ? 40 : count > 10 ? 15 : 0;
    return {
      code: this.code,
      category: this.category,
      detected: score > 0,
      score,
      confidence: count > 30 ? 80 : 55,
      reason: score > 0 ? `${count} events were observed from the same first-party device in one hour.` : "Device velocity is normal.",
      metadata: { count, window: "1h" }
    };
  }
};
DeviceVelocitySignal = __decorateClass([
  Injectable17()
], DeviceVelocitySignal);
var DuplicateDeviceSignal = class {
  constructor() {
    this.code = "DUPLICATE_DEVICE" /* DUPLICATE_DEVICE */;
    this.category = "DEVICE" /* DEVICE */;
  }
  async evaluate(context) {
    if (!context.deviceId) return safe(this.code, this.category, "No first-party device identifier was available.");
    const affiliateIds = new Set(
      dbStore.clicks.filter((click) => click.organizationId === context.organizationId && click.anonymousId === context.deviceId).map((click) => click.affiliateId)
    );
    const score = affiliateIds.size > 8 ? 70 : affiliateIds.size > 3 ? 35 : 0;
    return {
      code: this.code,
      category: this.category,
      detected: score > 0,
      score,
      confidence: affiliateIds.size > 3 ? 82 : 60,
      reason: score > 0 ? `This device has appeared across ${affiliateIds.size} affiliate accounts.` : "Device has not appeared across unusual affiliate clusters.",
      metadata: { distinctAffiliates: affiliateIds.size }
    };
  }
};
DuplicateDeviceSignal = __decorateClass([
  Injectable17()
], DuplicateDeviceSignal);
var GeoMismatchSignal = class {
  constructor() {
    this.code = "GEO_MISMATCH" /* GEO_MISMATCH */;
    this.category = "CONVERSION" /* CONVERSION */;
  }
  async evaluate(context) {
    const conversionCountry = String(context.metadata?.paymentCountry || context.metadata?.country || "").toUpperCase();
    if (!context.country || !conversionCountry) return safe(this.code, this.category, "Insufficient country data for geo comparison.");
    const detected = context.country.toUpperCase() !== conversionCountry;
    return {
      code: this.code,
      category: this.category,
      detected,
      score: detected ? 20 : 0,
      confidence: detected ? 70 : 60,
      reason: detected ? `Click country ${context.country} differs from payment country ${conversionCountry}.` : "Click and conversion geography are aligned.",
      metadata: { clickCountry: context.country, conversionCountry }
    };
  }
};
GeoMismatchSignal = __decorateClass([
  Injectable17()
], GeoMismatchSignal);
var SelfReferralSignal = class {
  constructor() {
    this.code = "SELF_REFERRAL" /* SELF_REFERRAL */;
    this.category = "IDENTITY" /* IDENTITY */;
  }
  async evaluate(context) {
    const affiliate = context.affiliateId ? dbStore.affiliates.find((item) => item.id === context.affiliateId) : void 0;
    const detected = Boolean(affiliate?.email && context.customerExternalId && affiliate.email.toLowerCase() === context.customerExternalId.toLowerCase());
    return {
      code: this.code,
      category: this.category,
      detected,
      score: detected ? 85 : 0,
      confidence: detected ? 92 : 65,
      reason: detected ? "Customer identifier matches the affiliate email on record." : "No self-referral identity match was found."
    };
  }
};
SelfReferralSignal = __decorateClass([
  Injectable17()
], SelfReferralSignal);
var ConversionSpeedSignal = class {
  constructor() {
    this.code = "FAST_CONVERSION" /* FAST_CONVERSION */;
    this.category = "BEHAVIOR" /* BEHAVIOR */;
  }
  async evaluate(context) {
    if (!context.clickedAt || !context.convertedAt) return safe(this.code, this.category, "Click-to-conversion timing is unavailable.");
    const seconds = Math.max(0, Math.round((context.convertedAt.getTime() - context.clickedAt.getTime()) / 1e3));
    const score = seconds < 5 ? 55 : seconds < 20 ? 25 : 0;
    return {
      code: this.code,
      category: this.category,
      detected: score > 0,
      score,
      confidence: score > 0 ? 78 : 65,
      reason: score > 0 ? `Conversion occurred ${seconds}s after click, which is unusually fast.` : "Click-to-conversion timing is normal.",
      metadata: { seconds }
    };
  }
};
ConversionSpeedSignal = __decorateClass([
  Injectable17()
], ConversionSpeedSignal);
var DuplicateConversionSignal = class {
  constructor() {
    this.code = "DUPLICATE_CONVERSION" /* DUPLICATE_CONVERSION */;
    this.category = "CONVERSION" /* CONVERSION */;
  }
  async evaluate(context) {
    const externalId = String(context.metadata?.externalId || "");
    if (!externalId) return safe(this.code, this.category, "No external conversion identifier was provided.");
    const duplicates = dbStore.conversions.filter(
      (item) => item.organizationId === context.organizationId && item.externalId === externalId && item.id !== context.conversionId
    );
    return {
      code: this.code,
      category: this.category,
      detected: duplicates.length > 0,
      score: duplicates.length > 0 ? 95 : 0,
      confidence: duplicates.length > 0 ? 98 : 80,
      reason: duplicates.length > 0 ? `External conversion id ${externalId} already exists for this organization.` : "No duplicate conversion id was found.",
      metadata: { duplicateCount: duplicates.length }
    };
  }
};
DuplicateConversionSignal = __decorateClass([
  Injectable17()
], DuplicateConversionSignal);
var UserAgentRiskSignal = class {
  constructor() {
    this.code = "SUSPICIOUS_USER_AGENT" /* SUSPICIOUS_USER_AGENT */;
    this.category = "TRAFFIC" /* TRAFFIC */;
  }
  async evaluate(context) {
    const ua = context.userAgent || "";
    const suspicious = !ua || /bot|crawler|spider|curl|wget|python|headless|phantom/i.test(ua);
    return {
      code: this.code,
      category: this.category,
      detected: suspicious,
      score: suspicious ? 25 : 0,
      confidence: suspicious ? 72 : 65,
      reason: suspicious ? "User agent is missing or matches a known automation pattern." : "User agent appears normal.",
      metadata: { userAgentPresent: Boolean(ua) }
    };
  }
};
UserAgentRiskSignal = __decorateClass([
  Injectable17()
], UserAgentRiskSignal);
var AmountAnomalySignal = class {
  constructor() {
    this.code = "AMOUNT_ANOMALY" /* AMOUNT_ANOMALY */;
    this.category = "PAYMENT" /* PAYMENT */;
  }
  async evaluate(context) {
    if (!context.amount) return safe(this.code, this.category, "No monetary amount was available.");
    const historical = dbStore.conversions.filter((item) => item.organizationId === context.organizationId && item.programId === context.programId && item.id !== context.conversionId).map((item) => item.amount).sort((a, b) => a - b);
    if (historical.length < 5) return safe(this.code, this.category, "Not enough historical sample size for amount anomaly scoring.");
    const median = historical[Math.floor(historical.length / 2)];
    const ratio = median > 0 ? context.amount / median : 1;
    const score = ratio > 8 ? 60 : ratio > 4 ? 30 : 0;
    return {
      code: this.code,
      category: this.category,
      detected: score > 0,
      score,
      confidence: historical.length > 20 ? 80 : 55,
      reason: score > 0 ? `Conversion amount is ${ratio.toFixed(1)}x the program median.` : "Conversion amount is within historical range.",
      metadata: { sampleSize: historical.length, median, ratio }
    };
  }
};
AmountAnomalySignal = __decorateClass([
  Injectable17()
], AmountAnomalySignal);
var AffiliateTrustSignal = class {
  constructor() {
    this.code = "AFFILIATE_LOW_TRUST" /* AFFILIATE_LOW_TRUST */;
    this.category = "AFFILIATE" /* AFFILIATE */;
  }
  async evaluate(context) {
    const affiliate = context.affiliateId ? dbStore.affiliates.find((item) => item.id === context.affiliateId) : void 0;
    const trustScore = affiliate?.trustScore ?? 50;
    const score = trustScore < 20 ? 70 : trustScore < 40 ? 35 : trustScore < 55 ? 10 : 0;
    return {
      code: this.code,
      category: this.category,
      detected: score > 0,
      score,
      confidence: 75,
      reason: score > 0 ? `Affiliate trust score is ${trustScore}/100.` : `Affiliate trust score is ${trustScore}/100 and within acceptable range.`,
      metadata: { trustScore }
    };
  }
};
AffiliateTrustSignal = __decorateClass([
  Injectable17()
], AffiliateTrustSignal);
var AffiliateHighRefundRateSignal = class {
  constructor() {
    this.code = "AFFILIATE_HIGH_REFUND_RATE" /* AFFILIATE_HIGH_REFUND_RATE */;
    this.category = "AFFILIATE" /* AFFILIATE */;
  }
  async evaluate(context) {
    if (!context.affiliateId) return safe(this.code, this.category, "No affiliate was attached to this event.");
    const conversions = dbStore.conversions.filter((item) => item.organizationId === context.organizationId && item.affiliateId === context.affiliateId);
    if (conversions.length < 10) return safe(this.code, this.category, "Minimum sample size for refund-rate scoring has not been reached.");
    const refunded = conversions.filter((item) => item.status === "REFUNDED" /* REFUNDED */).length;
    const rate = refunded / conversions.length;
    const score = rate > 0.3 ? 55 : rate > 0.15 ? 25 : 0;
    return {
      code: this.code,
      category: this.category,
      detected: score > 0,
      score,
      confidence: conversions.length > 30 ? 82 : 60,
      reason: score > 0 ? `Affiliate refund rate is ${(rate * 100).toFixed(1)}% across ${conversions.length} conversions.` : "Affiliate refund rate is within expected range.",
      metadata: { sampleSize: conversions.length, refundRate: rate }
    };
  }
};
AffiliateHighRefundRateSignal = __decorateClass([
  Injectable17()
], AffiliateHighRefundRateSignal);
var PayoutAmountAnomalySignal = class {
  constructor() {
    this.code = "PAYOUT_AMOUNT_ANOMALY" /* PAYOUT_AMOUNT_ANOMALY */;
    this.category = "PAYOUT" /* PAYOUT */;
  }
  async evaluate(context) {
    if (context.entityType !== "PAYOUT" /* PAYOUT */ || !context.amount) return safe(this.code, this.category, "Not a payout amount assessment.");
    const historical = dbStore.payoutBatches.filter((item) => item.organizationId === context.organizationId && item.id !== context.payoutId).map((item) => item.totalAmount).sort((a, b) => a - b);
    const baseline = historical.length ? historical[Math.floor(historical.length / 2)] : 5e5;
    const ratio = baseline > 0 ? context.amount / baseline : 1;
    const score = context.amount >= 2e6 || ratio > 4 ? 70 : ratio > 2 ? 30 : 0;
    return {
      code: this.code,
      category: this.category,
      detected: score > 0,
      score,
      confidence: historical.length > 3 ? 75 : 55,
      reason: score > 0 ? `Payout amount is ${ratio.toFixed(1)}x the historical baseline.` : "Payout amount is within expected range.",
      metadata: { baseline, ratio }
    };
  }
};
PayoutAmountAnomalySignal = __decorateClass([
  Injectable17()
], PayoutAmountAnomalySignal);

// src/modules/fraud/velocity/fraud-velocity.service.ts
import { Injectable as Injectable18 } from "@nestjs/common";
import Redis from "ioredis";
var FraudVelocityService = class {
  constructor() {
    this.fallbackCounters = /* @__PURE__ */ new Map();
  }
  getClient() {
    if (!this.redis) {
      const redisUrl = process.env.REDIS_URL || process.env.KV_URL;
      this.redis = redisUrl ? new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 0, enableOfflineQueue: false }) : new Redis({
        host: process.env.REDIS_HOST || "localhost",
        port: Number(process.env.REDIS_PORT || 6379),
        password: process.env.REDIS_PASSWORD || void 0,
        lazyConnect: true,
        maxRetriesPerRequest: 0,
        enableOfflineQueue: false
      });
      this.redis.on("error", () => void 0);
    }
    return this.redis;
  }
  async increment(key, ttlSeconds) {
    try {
      const client = this.getClient();
      if (client.status === "wait") await client.connect();
      const results = await client.multi().incr(key).expire(key, ttlSeconds, "NX").exec();
      return Number(results?.[0]?.[1] || 0);
    } catch {
      const now = Date.now();
      const current = this.fallbackCounters.get(key);
      if (!current || current.expiresAt < now) {
        this.fallbackCounters.set(key, { count: 1, expiresAt: now + ttlSeconds * 1e3 });
        return 1;
      }
      current.count += 1;
      return current.count;
    }
  }
  async snapshot(key) {
    try {
      const client = this.getClient();
      if (client.status === "wait") await client.connect();
      return Number(await client.get(key) || 0);
    } catch {
      const current = this.fallbackCounters.get(key);
      return current && current.expiresAt > Date.now() ? current.count : 0;
    }
  }
};
FraudVelocityService = __decorateClass([
  Injectable18()
], FraudVelocityService);

// src/modules/fraud/fraud.module.ts
var signalProviders = [
  IpReputationSignal,
  IpVelocitySignal,
  AffiliateVelocitySignal,
  DeviceVelocitySignal,
  DuplicateDeviceSignal,
  GeoMismatchSignal,
  SelfReferralSignal,
  ConversionSpeedSignal,
  DuplicateConversionSignal,
  UserAgentRiskSignal,
  AmountAnomalySignal,
  AffiliateTrustSignal,
  AffiliateHighRefundRateSignal,
  PayoutAmountAnomalySignal
];
var FraudModule = class {
  constructor(registry, ipReputation, ipVelocity, affiliateVelocity, deviceVelocity, duplicateDevice, geoMismatch, selfReferral, conversionSpeed, duplicateConversion, userAgentRisk, amountAnomaly, affiliateTrust, refundRate, payoutAmount) {
    this.registry = registry;
    this.ipReputation = ipReputation;
    this.ipVelocity = ipVelocity;
    this.affiliateVelocity = affiliateVelocity;
    this.deviceVelocity = deviceVelocity;
    this.duplicateDevice = duplicateDevice;
    this.geoMismatch = geoMismatch;
    this.selfReferral = selfReferral;
    this.conversionSpeed = conversionSpeed;
    this.duplicateConversion = duplicateConversion;
    this.userAgentRisk = userAgentRisk;
    this.amountAnomaly = amountAnomaly;
    this.affiliateTrust = affiliateTrust;
    this.refundRate = refundRate;
    this.payoutAmount = payoutAmount;
  }
  onModuleInit() {
    [
      this.ipReputation,
      this.ipVelocity,
      this.affiliateVelocity,
      this.deviceVelocity,
      this.duplicateDevice,
      this.geoMismatch,
      this.selfReferral,
      this.conversionSpeed,
      this.duplicateConversion,
      this.userAgentRisk,
      this.amountAnomaly,
      this.affiliateTrust,
      this.refundRate,
      this.payoutAmount
    ].forEach((signal) => this.registry.register(signal));
  }
};
FraudModule = __decorateClass([
  Module6({
    controllers: [FraudController],
    providers: [
      FraudService,
      FraudEngineService,
      FraudScoreService,
      FraudDecisionService,
      FraudPolicyService,
      FraudContextFactory,
      FraudSignalRegistry,
      FraudVelocityService,
      ...signalProviders
    ],
    exports: [FraudService, FraudEngineService, FraudVelocityService]
  })
], FraudModule);

// src/modules/tracking/tracking.controller.ts
import {
  Controller as Controller8,
  Get as Get8,
  Post as Post8,
  Body as Body8,
  Param as Param8,
  Req as Req3,
  Res as Res3,
  UseGuards as UseGuards8
} from "@nestjs/common";
import { ApiTags as ApiTags8, ApiOperation as ApiOperation8, ApiBearerAuth as ApiBearerAuth8 } from "@nestjs/swagger";
var TrackingController = class {
  constructor(trackingService) {
    this.trackingService = trackingService;
  }
  async createLink(organizationId, dto, user) {
    return this.trackingService.createLink(organizationId, dto, user.userId);
  }
  async getLinks(organizationId) {
    return this.trackingService.getLinks(organizationId);
  }
  async redirect(shortCode, req, res) {
    const userAgent = req.headers["user-agent"];
    const ipAddress = this.getClientIp(req);
    const referrer = req.headers.referer || req.headers.referrer;
    const country = req.headers["cf-ipcountry"] || req.headers["x-country"];
    const result = await this.trackingService.handleRedirect(shortCode, userAgent, ipAddress, referrer, country);
    res.cookie("pi_anon_id", result.anonymousId, {
      maxAge: 30 * 24 * 3600 * 1e3,
      httpOnly: false
    });
    return res.redirect(302, result.destinationUrl);
  }
  async browserClick(dto, req) {
    const userAgent = req.headers["user-agent"];
    const ipAddress = this.getClientIp(req);
    return this.trackingService.handleBrowserClick(dto, userAgent, ipAddress);
  }
  async identifyCustomer(dto) {
    return this.trackingService.identifyCustomer(dto);
  }
  getClientIp(req) {
    const forwardedFor = req.headers["x-forwarded-for"];
    if (Array.isArray(forwardedFor)) return forwardedFor[0];
    return forwardedFor || req.ip;
  }
};
__decorateClass([
  Post8("api/v1/organizations/:organizationId/tracking-links"),
  UseGuards8(JwtAuthGuard, OrganizationGuard, PermissionsGuard),
  RequirePermissions("manage.links"),
  ApiBearerAuth8(),
  ApiOperation8({ summary: "Create a new tracking link for an affiliate" }),
  __decorateParam(0, Param8("organizationId")),
  __decorateParam(1, Body8()),
  __decorateParam(2, CurrentUser())
], TrackingController.prototype, "createLink", 1);
__decorateClass([
  Get8("api/v1/organizations/:organizationId/tracking-links"),
  UseGuards8(JwtAuthGuard, OrganizationGuard, PermissionsGuard),
  RequirePermissions("manage.links"),
  ApiBearerAuth8(),
  ApiOperation8({ summary: "List tracking links for organization" }),
  __decorateParam(0, Param8("organizationId"))
], TrackingController.prototype, "getLinks", 1);
__decorateClass([
  Get8("r/:shortCode"),
  ApiOperation8({ summary: "High-performance referral tracking redirect" }),
  __decorateParam(0, Param8("shortCode")),
  __decorateParam(1, Req3()),
  __decorateParam(2, Res3())
], TrackingController.prototype, "redirect", 1);
__decorateClass([
  Post8("api/v1/tracking/click"),
  ApiOperation8({ summary: "Browser SDK click tracking endpoint" }),
  __decorateParam(0, Body8()),
  __decorateParam(1, Req3())
], TrackingController.prototype, "browserClick", 1);
__decorateClass([
  Post8("api/v1/tracking/identify"),
  ApiOperation8({ summary: "Identify customer association with anonymous click" }),
  __decorateParam(0, Body8())
], TrackingController.prototype, "identifyCustomer", 1);
TrackingController = __decorateClass([
  ApiTags8("Tracking & Redirects"),
  Controller8()
], TrackingController);

// src/modules/tracking/tracking.service.ts
import {
  Injectable as Injectable19,
  NotFoundException as NotFoundException8,
  BadRequestException as BadRequestException8
} from "@nestjs/common";
import { v4 as uuidv48 } from "uuid";
import * as crypto2 from "crypto";
var TrackingService = class {
  constructor(fraudService) {
    this.fraudService = fraudService;
  }
  async createLink(organizationId, dto, actorId) {
    const shortCode = (dto.customCode || SecurityUtils.generateRandomCode(6)).toLowerCase();
    const existing = dbStore.trackingLinks.find(
      (l) => l.shortCode === shortCode
    );
    if (existing) {
      throw new BadRequestException8("Short code is already taken");
    }
    const link = {
      id: uuidv48(),
      organizationId,
      programId: dto.programId,
      affiliateId: dto.affiliateId,
      campaignId: dto.campaignId,
      destinationUrl: dto.destinationUrl,
      shortCode,
      status: "ACTIVE" /* ACTIVE */,
      createdAt: /* @__PURE__ */ new Date()
    };
    dbStore.trackingLinks.push(link);
    dbStore.auditLogs.push({
      id: uuidv48(),
      organizationId,
      actorType: "user",
      actorId: actorId || "system",
      action: "TRACKING_LINK_CREATED",
      resourceType: "tracking_link",
      resourceId: link.id,
      metadata: {
        programId: link.programId,
        affiliateId: link.affiliateId,
        campaignId: link.campaignId,
        shortCode: link.shortCode,
        destinationUrl: link.destinationUrl
      },
      createdAt: /* @__PURE__ */ new Date()
    });
    return link;
  }
  async getLinks(organizationId) {
    return dbStore.trackingLinks.filter((l) => l.organizationId === organizationId).map((link) => {
      const {
        __dbStoreProxy: _proxyMarker,
        ...publicLink
      } = link;
      const clicks = dbStore.clicks.filter((click) => click.trackingLinkId === link.id);
      const conversions = dbStore.conversions.filter(
        (conversion) => conversion.organizationId === organizationId && conversion.programId === link.programId && conversion.affiliateId === link.affiliateId
      );
      return {
        ...publicLink,
        clicks: clicks.length,
        conversions: conversions.length,
        revenue: conversions.reduce((total, conversion) => total + Number(conversion.amount || 0), 0) / 100
      };
    });
  }
  // High Performance Redirect Handler
  async handleRedirect(shortCode, userAgent, ipAddress, referrer, country) {
    const link = dbStore.trackingLinks.find(
      (l) => l.shortCode === shortCode.toLowerCase() && l.status === "ACTIVE"
    );
    if (!link) {
      throw new NotFoundException8("Tracking link not found or inactive");
    }
    const program = dbStore.programs.find((p) => p.id === link.programId);
    const anonymousId = `anon_${uuidv48()}`;
    const ipHash = ipAddress ? crypto2.createHmac("sha256", process.env.FRAUD_IP_HASH_SECRET || process.env.JWT_SECRET || "partneriq-fraud-ip-salt").update(ipAddress).digest("hex") : "unknown";
    const click = {
      id: uuidv48(),
      organizationId: link.organizationId,
      programId: link.programId,
      affiliateId: link.affiliateId,
      trackingLinkId: link.id,
      anonymousId,
      ipHash,
      ipEncrypted: ipAddress && ipAddress !== "unknown" ? SecurityUtils.encrypt(ipAddress) : void 0,
      userAgent: userAgent || "unknown",
      referrer: referrer || "direct",
      country: country || "unknown",
      deviceType: this.getDeviceType(userAgent),
      browser: this.getBrowser(userAgent),
      os: this.getOperatingSystem(userAgent),
      fraudScore: 0,
      fraudStatus: "LOW" /* LOW */,
      createdAt: /* @__PURE__ */ new Date()
    };
    dbStore.clicks.push(click);
    this.fraudService.evaluateClick(click.id, ipAddress).catch((error) => {
      console.error("click fraud assessment failed:", error?.message || error);
    });
    const cookieDays = program?.cookieDurationDays || 30;
    const expiresAt = new Date(Date.now() + cookieDays * 24 * 3600 * 1e3);
    const attribution = {
      id: uuidv48(),
      organizationId: link.organizationId,
      programId: link.programId,
      affiliateId: link.affiliateId,
      clickId: click.id,
      anonymousId,
      model: program?.attributionModel || "LAST_CLICK",
      expiresAt,
      createdAt: /* @__PURE__ */ new Date()
    };
    dbStore.attributions.push(attribution);
    return {
      destinationUrl: link.destinationUrl,
      anonymousId,
      clickId: click.id
    };
  }
  getDeviceType(userAgent) {
    if (!userAgent) return "unknown";
    if (/mobile|android|iphone|ipad/i.test(userAgent)) return "mobile";
    return "desktop";
  }
  getBrowser(userAgent) {
    if (!userAgent) return "unknown";
    if (/edg\//i.test(userAgent)) return "Edge";
    if (/chrome\//i.test(userAgent)) return "Chrome";
    if (/firefox\//i.test(userAgent)) return "Firefox";
    if (/safari\//i.test(userAgent)) return "Safari";
    return "unknown";
  }
  getOperatingSystem(userAgent) {
    if (!userAgent) return "unknown";
    if (/windows/i.test(userAgent)) return "Windows";
    if (/android/i.test(userAgent)) return "Android";
    if (/iphone|ipad|ios/i.test(userAgent)) return "iOS";
    if (/mac os/i.test(userAgent)) return "macOS";
    if (/linux/i.test(userAgent)) return "Linux";
    return "unknown";
  }
  // Browser Tracking API
  async handleBrowserClick(dto, userAgent, ipAddress) {
    const pubKey = dbStore.publicKeys.find((k) => k.key === dto.publicKey);
    if (!pubKey) {
      throw new BadRequestException8("Invalid public tracking key");
    }
    return this.handleRedirect(dto.shortCode, userAgent, ipAddress);
  }
  // Identify Customer API
  async identifyCustomer(dto) {
    const pubKey = dbStore.publicKeys.find((k) => k.key === dto.publicKey);
    if (!pubKey) {
      throw new BadRequestException8("Invalid public tracking key");
    }
    const attributions = dbStore.attributions.filter(
      (a) => a.organizationId === pubKey.organizationId && a.anonymousId === dto.anonymousId
    );
    attributions.forEach((attr) => {
      attr.customerExternalId = dto.customerExternalId;
    });
    return { success: true, updatedAttributions: attributions.length };
  }
};
TrackingService = __decorateClass([
  Injectable19()
], TrackingService);

// src/modules/tracking/tracking.module.ts
var TrackingModule = class {
};
TrackingModule = __decorateClass([
  Module7({
    imports: [FraudModule],
    controllers: [TrackingController],
    providers: [TrackingService],
    exports: [TrackingService]
  })
], TrackingModule);

// src/modules/api-keys/api-keys.module.ts
import { Module as Module8 } from "@nestjs/common";

// src/modules/api-keys/api-keys.controller.ts
import {
  Controller as Controller9,
  Get as Get9,
  Post as Post9,
  Delete as Delete4,
  Body as Body9,
  Param as Param9,
  UseGuards as UseGuards9
} from "@nestjs/common";
import { ApiTags as ApiTags9, ApiOperation as ApiOperation9, ApiBearerAuth as ApiBearerAuth9 } from "@nestjs/swagger";
var ApiKeysController = class {
  constructor(apiKeysService) {
    this.apiKeysService = apiKeysService;
  }
  async create(organizationId, user, dto) {
    return this.apiKeysService.create(organizationId, user.userId, dto);
  }
  async findAll(organizationId) {
    return this.apiKeysService.findAll(organizationId);
  }
  async revoke(organizationId, apiKeyId, user) {
    return this.apiKeysService.revoke(organizationId, apiKeyId, user.userId);
  }
};
__decorateClass([
  Post9(),
  RequirePermissions("manage.api_keys"),
  ApiOperation9({ summary: "Create a new server-to-server API key" }),
  __decorateParam(0, Param9("organizationId")),
  __decorateParam(1, CurrentUser()),
  __decorateParam(2, Body9())
], ApiKeysController.prototype, "create", 1);
__decorateClass([
  Get9(),
  RequirePermissions("manage.api_keys"),
  ApiOperation9({ summary: "List all API keys for organization" }),
  __decorateParam(0, Param9("organizationId"))
], ApiKeysController.prototype, "findAll", 1);
__decorateClass([
  Delete4(":apiKeyId"),
  RequirePermissions("manage.api_keys"),
  ApiOperation9({ summary: "Revoke an API key" }),
  __decorateParam(0, Param9("organizationId")),
  __decorateParam(1, Param9("apiKeyId")),
  __decorateParam(2, CurrentUser())
], ApiKeysController.prototype, "revoke", 1);
ApiKeysController = __decorateClass([
  ApiTags9("API Keys"),
  Controller9("api/v1/organizations/:organizationId/api-keys"),
  UseGuards9(JwtAuthGuard, OrganizationGuard, PermissionsGuard),
  ApiBearerAuth9()
], ApiKeysController);

// src/modules/api-keys/api-keys.service.ts
import {
  Injectable as Injectable20,
  NotFoundException as NotFoundException9
} from "@nestjs/common";
import { v4 as uuidv49 } from "uuid";
var ApiKeysService = class {
  async create(organizationId, createdByUserId, dto) {
    const environment = dto.environment || "live";
    const { key, prefix, hash: hash2 } = SecurityUtils.generateApiKey(environment);
    const apiKey = {
      id: uuidv49(),
      organizationId,
      name: dto.name,
      prefix,
      keyHash: hash2,
      scopes: dto.scopes,
      createdBy: createdByUserId,
      createdAt: /* @__PURE__ */ new Date()
    };
    dbStore.apiKeys.push(apiKey);
    dbStore.auditLogs.push({
      id: uuidv49(),
      organizationId,
      actorType: "USER",
      actorId: createdByUserId,
      action: "API_KEY_CREATED" /* API_KEY_CREATED */,
      resourceType: "api_key",
      resourceId: apiKey.id,
      createdAt: /* @__PURE__ */ new Date()
    });
    return {
      id: apiKey.id,
      name: apiKey.name,
      prefix: apiKey.prefix,
      key,
      // Raw unhashed secret key
      scopes: apiKey.scopes,
      createdAt: apiKey.createdAt,
      warning: "Save this API key immediately. You will not be able to see it again."
    };
  }
  async findAll(organizationId) {
    return dbStore.apiKeys.filter((k) => k.organizationId === organizationId).map((k) => ({
      id: k.id,
      name: k.name,
      prefix: k.prefix,
      scopes: k.scopes,
      lastUsedAt: k.lastUsedAt,
      revokedAt: k.revokedAt,
      createdAt: k.createdAt
    }));
  }
  async revoke(organizationId, apiKeyId, userId) {
    const apiKey = dbStore.apiKeys.find(
      (k) => k.id === apiKeyId && k.organizationId === organizationId
    );
    if (!apiKey) {
      throw new NotFoundException9("API Key not found");
    }
    apiKey.revokedAt = /* @__PURE__ */ new Date();
    dbStore.auditLogs.push({
      id: uuidv49(),
      organizationId,
      actorType: "USER",
      actorId: userId,
      action: "API_KEY_REVOKED" /* API_KEY_REVOKED */,
      resourceType: "api_key",
      resourceId: apiKey.id,
      createdAt: /* @__PURE__ */ new Date()
    });
    return { success: true, message: "API key revoked successfully" };
  }
};
ApiKeysService = __decorateClass([
  Injectable20()
], ApiKeysService);

// src/modules/api-keys/api-keys.module.ts
var ApiKeysModule = class {
};
ApiKeysModule = __decorateClass([
  Module8({
    controllers: [ApiKeysController],
    providers: [ApiKeysService],
    exports: [ApiKeysService]
  })
], ApiKeysModule);

// src/modules/conversions/conversions.module.ts
import { Module as Module11 } from "@nestjs/common";

// src/modules/conversions/conversions.controller.ts
import {
  Controller as Controller10,
  Get as Get10,
  Post as Post10,
  Body as Body10,
  Param as Param10,
  Headers,
  UseGuards as UseGuards10
} from "@nestjs/common";
import { ApiTags as ApiTags10, ApiOperation as ApiOperation10, ApiBearerAuth as ApiBearerAuth10, ApiHeader } from "@nestjs/swagger";

// src/common/guards/api-key.guard.ts
import {
  Injectable as Injectable21,
  UnauthorizedException as UnauthorizedException3
} from "@nestjs/common";
var ApiKeyGuard = class {
  canActivate(context) {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer pi_")) {
      return false;
    }
    const rawKey = authHeader.split(" ")[1];
    const keyHash = SecurityUtils.hashToken(rawKey);
    const apiKey = dbStore.apiKeys.find(
      (k) => k.keyHash === keyHash && !k.revokedAt
    );
    if (!apiKey) {
      throw new UnauthorizedException3("Invalid or revoked API key");
    }
    if (apiKey.expiresAt && new Date(apiKey.expiresAt) < /* @__PURE__ */ new Date()) {
      throw new UnauthorizedException3("API key has expired");
    }
    apiKey.lastUsedAt = /* @__PURE__ */ new Date();
    request.user = {
      userId: `apikey_${apiKey.id}`,
      email: `apikey_${apiKey.name}@partneriq.system`,
      organizationId: apiKey.organizationId,
      apiKeyId: apiKey.id,
      scopes: apiKey.scopes,
      isApiKey: true
    };
    request.tenantId = apiKey.organizationId;
    return true;
  }
};
ApiKeyGuard = __decorateClass([
  Injectable21()
], ApiKeyGuard);

// src/modules/conversions/conversions.controller.ts
var ConversionsController = class {
  constructor(conversionsService) {
    this.conversionsService = conversionsService;
  }
  async createConversion(user, dto, idempotencyKey) {
    return this.conversionsService.createConversion(user.organizationId, dto, idempotencyKey);
  }
  async findAll(organizationId) {
    return this.conversionsService.findAll(organizationId);
  }
  async refundConversion(conversionId, user, dto) {
    return this.conversionsService.refundConversion(user.organizationId, conversionId, dto);
  }
};
__decorateClass([
  Post10("api/v1/conversions"),
  UseGuards10(ApiKeyGuard),
  ApiBearerAuth10(),
  ApiHeader({ name: "Idempotency-Key", required: false, description: "Unique key to guarantee single execution" }),
  ApiOperation10({ summary: "Create a conversion event (Server-to-Server API Key required)" }),
  __decorateParam(0, CurrentUser()),
  __decorateParam(1, Body10()),
  __decorateParam(2, Headers("idempotency-key"))
], ConversionsController.prototype, "createConversion", 1);
__decorateClass([
  Get10("api/v1/organizations/:organizationId/conversions"),
  UseGuards10(JwtAuthGuard, OrganizationGuard, PermissionsGuard),
  RequirePermissions("view.conversions"),
  ApiBearerAuth10(),
  ApiOperation10({ summary: "List conversions for organization" }),
  __decorateParam(0, Param10("organizationId"))
], ConversionsController.prototype, "findAll", 1);
__decorateClass([
  Post10("api/v1/conversions/:id/refund"),
  UseGuards10(JwtAuthGuard, OrganizationGuard, PermissionsGuard),
  RequirePermissions("manage.commissions"),
  ApiBearerAuth10(),
  ApiOperation10({ summary: "Process a conversion refund and clawback commission" }),
  __decorateParam(0, Param10("id")),
  __decorateParam(1, CurrentUser()),
  __decorateParam(2, Body10())
], ConversionsController.prototype, "refundConversion", 1);
ConversionsController = __decorateClass([
  ApiTags10("Conversions & Idempotency"),
  Controller10()
], ConversionsController);

// src/modules/conversions/conversions.service.ts
import {
  Injectable as Injectable22,
  ConflictException,
  NotFoundException as NotFoundException10,
  BadRequestException as BadRequestException9
} from "@nestjs/common";
import { v4 as uuidv410 } from "uuid";
import * as crypto3 from "crypto";
var ConversionsService = class {
  constructor(fraudService, commissionsService, ledgerService) {
    this.fraudService = fraudService;
    this.commissionsService = commissionsService;
    this.ledgerService = ledgerService;
  }
  async createConversion(organizationId, dto, idempotencyKey) {
    const requestHash = crypto3.createHash("sha256").update(JSON.stringify(dto)).digest("hex");
    if (idempotencyKey) {
      const existingKey = dbStore.idempotencyKeys.find(
        (k) => k.organizationId === organizationId && k.key === idempotencyKey
      );
      if (existingKey) {
        if (existingKey.requestHash === requestHash) {
          return existingKey.responseBody;
        } else {
          throw new ConflictException(
            "Idempotency key reuse detected with different request payload (409 Conflict)"
          );
        }
      }
    }
    const existingConversion = dbStore.conversions.find(
      (c) => c.organizationId === organizationId && c.externalId === dto.externalId
    );
    if (existingConversion) {
      throw new ConflictException(`Conversion with externalId '${dto.externalId}' already exists`);
    }
    const attribution = dbStore.attributions.find(
      (a) => a.organizationId === organizationId && (a.customerExternalId === dto.customerExternalId || a.anonymousId === dto.customerExternalId)
    );
    const programId = attribution?.programId || dbStore.programs.find((p) => p.organizationId === organizationId)?.id;
    if (!programId) {
      throw new BadRequestException9("No active program found for conversion");
    }
    const conversion = {
      id: uuidv410(),
      organizationId,
      programId,
      affiliateId: attribution?.affiliateId,
      externalId: dto.externalId,
      customerExternalId: dto.customerExternalId,
      amount: dto.amount,
      currency: dto.currency || "USD",
      productId: dto.productId,
      status: "PENDING" /* PENDING */,
      occurredAt: dto.occurredAt ? new Date(dto.occurredAt) : /* @__PURE__ */ new Date(),
      createdAt: /* @__PURE__ */ new Date()
    };
    dbStore.conversions.push(conversion);
    const fraudResult = await this.fraudService.evaluateConversion(conversion);
    if (fraudResult.decision === "BLOCK" /* BLOCK */) {
      conversion.status = "REJECTED" /* REJECTED */;
    } else if (fraudResult.decision === "REVIEW" /* REVIEW */) {
      conversion.status = "PENDING" /* PENDING */;
    } else {
      conversion.status = "APPROVED" /* APPROVED */;
    }
    let commission = null;
    if (conversion.status === "APPROVED" /* APPROVED */ && attribution?.affiliateId) {
      commission = await this.commissionsService.calculateAndRecordCommission(
        organizationId,
        conversion,
        attribution.affiliateId,
        fraudResult.score
      );
    }
    const responsePayload = {
      conversion,
      fraudResult,
      commission
    };
    if (idempotencyKey) {
      const ikRecord = {
        id: uuidv410(),
        organizationId,
        key: idempotencyKey,
        requestHash,
        responseStatus: 201,
        responseBody: responsePayload,
        expiresAt: new Date(Date.now() + 24 * 3600 * 1e3),
        createdAt: /* @__PURE__ */ new Date()
      };
      dbStore.idempotencyKeys.push(ikRecord);
    }
    return responsePayload;
  }
  async refundConversion(organizationId, conversionId, dto) {
    const conversion = dbStore.conversions.find(
      (c) => c.id === conversionId && c.organizationId === organizationId
    );
    if (!conversion) {
      throw new NotFoundException10("Conversion not found");
    }
    if (conversion.status === "REFUNDED" /* REFUNDED */) {
      throw new BadRequestException9("Conversion has already been refunded");
    }
    conversion.status = "REFUNDED" /* REFUNDED */;
    const commission = dbStore.commissions.find((c) => c.conversionId === conversionId);
    if (commission && conversion.affiliateId) {
      commission.status = "REFUNDED" /* REFUNDED */;
      await this.ledgerService.recordTransaction(
        organizationId,
        conversion.affiliateId,
        "COMMISSION_REVERSED" /* COMMISSION_REVERSED */,
        `Refund clawback for conversion ${conversion.externalId}: ${dto.reason || "Customer refund"}`,
        commission.id,
        commission.commissionAmount
      );
    }
    dbStore.auditLogs.push({
      id: uuidv410(),
      organizationId,
      actorType: "USER",
      actorId: "system",
      action: "COMMISSION_REVERSED" /* COMMISSION_REVERSED */,
      resourceType: "conversion",
      resourceId: conversion.id,
      metadata: { reason: dto.reason },
      createdAt: /* @__PURE__ */ new Date()
    });
    return { conversion, commissionStatus: "REFUNDED", message: "Conversion refunded and commission clawed back" };
  }
  async findAll(organizationId) {
    return dbStore.conversions.filter((c) => c.organizationId === organizationId);
  }
};
ConversionsService = __decorateClass([
  Injectable22()
], ConversionsService);

// src/modules/commissions/commissions.module.ts
import { Module as Module10 } from "@nestjs/common";

// src/modules/commissions/commissions.controller.ts
import {
  Controller as Controller11,
  Get as Get11,
  Post as Post11,
  Body as Body11,
  Param as Param11,
  UseGuards as UseGuards11
} from "@nestjs/common";
import { ApiTags as ApiTags11, ApiOperation as ApiOperation11, ApiBearerAuth as ApiBearerAuth11 } from "@nestjs/swagger";
var CommissionsController = class {
  constructor(commissionsService) {
    this.commissionsService = commissionsService;
  }
  async getCommissions(organizationId) {
    return this.commissionsService.getCommissions(organizationId);
  }
  async createRule(organizationId, dto) {
    return this.commissionsService.createRule(organizationId, dto);
  }
  async getRules(organizationId) {
    return this.commissionsService.getRules(organizationId);
  }
};
__decorateClass([
  Get11(),
  RequirePermissions("view.commissions"),
  ApiOperation11({ summary: "List all commissions in organization" }),
  __decorateParam(0, Param11("organizationId"))
], CommissionsController.prototype, "getCommissions", 1);
__decorateClass([
  Post11("rules"),
  RequirePermissions("manage.commissions"),
  ApiOperation11({ summary: "Create a data-driven commission rule" }),
  __decorateParam(0, Param11("organizationId")),
  __decorateParam(1, Body11())
], CommissionsController.prototype, "createRule", 1);
__decorateClass([
  Get11("rules"),
  RequirePermissions("view.commissions"),
  ApiOperation11({ summary: "List commission rules" }),
  __decorateParam(0, Param11("organizationId"))
], CommissionsController.prototype, "getRules", 1);
CommissionsController = __decorateClass([
  ApiTags11("Commissions Engine"),
  Controller11("api/v1/organizations/:organizationId/commissions"),
  UseGuards11(JwtAuthGuard, OrganizationGuard, PermissionsGuard),
  ApiBearerAuth11()
], CommissionsController);

// src/modules/commissions/commissions.service.ts
import { Injectable as Injectable23 } from "@nestjs/common";
import { v4 as uuidv411 } from "uuid";
var CommissionsService = class {
  constructor(ledgerService) {
    this.ledgerService = ledgerService;
  }
  async createRule(organizationId, dto) {
    const rule = {
      id: uuidv411(),
      organizationId,
      programId: dto.programId,
      name: dto.name,
      priority: dto.priority,
      conditions: dto.conditions || { all: [] },
      commissionType: dto.commissionType,
      commissionValue: dto.commissionValue,
      active: true,
      createdAt: /* @__PURE__ */ new Date(),
      updatedAt: /* @__PURE__ */ new Date()
    };
    dbStore.commissionRules.push(rule);
    return rule;
  }
  async getRules(organizationId) {
    return dbStore.commissionRules.filter((r) => r.organizationId === organizationId);
  }
  // Deterministic Commission Evaluator Engine
  async calculateAndRecordCommission(organizationId, conversion, affiliateId, fraudScore) {
    const program = dbStore.programs.find((p) => p.id === conversion.programId);
    let commissionType = program?.commissionType || "PERCENTAGE" /* PERCENTAGE */;
    let commissionValue = program?.defaultCommissionValue || 1e3;
    let matchedRule = void 0;
    const rules = dbStore.commissionRules.filter((r) => r.organizationId === organizationId && r.programId === conversion.programId && r.active).sort((a, b) => a.priority - b.priority);
    for (const rule of rules) {
      if (this.evaluateRuleConditions(rule.conditions, { conversion, fraudScore })) {
        commissionType = rule.commissionType;
        commissionValue = rule.commissionValue;
        matchedRule = rule;
        break;
      }
    }
    let commissionAmount = 0;
    if (commissionType === "PERCENTAGE" /* PERCENTAGE */ || commissionType === "RECURRING_PERCENTAGE" /* RECURRING_PERCENTAGE */) {
      commissionAmount = Math.round(conversion.amount * commissionValue / 1e4);
    } else {
      commissionAmount = commissionValue;
    }
    const commission = {
      id: uuidv411(),
      organizationId,
      programId: conversion.programId,
      affiliateId,
      conversionId: conversion.id,
      ruleId: matchedRule?.id,
      ruleSnapshot: {
        ruleName: matchedRule?.name || "Default Program Rate",
        commissionType,
        commissionValue
      },
      rate: commissionValue,
      baseAmount: conversion.amount,
      commissionAmount,
      calculationVersion: "v1.0",
      status: "APPROVED" /* APPROVED */,
      createdAt: /* @__PURE__ */ new Date()
    };
    dbStore.commissions.push(commission);
    await this.ledgerService.recordTransaction(
      organizationId,
      affiliateId,
      "COMMISSION_EARNED" /* COMMISSION_EARNED */,
      `Commission earned for conversion ${conversion.externalId}`,
      commission.id,
      commissionAmount
    );
    return commission;
  }
  async getCommissions(organizationId) {
    return dbStore.commissions.filter((c) => c.organizationId === organizationId);
  }
  evaluateRuleConditions(conditions, context) {
    if (!conditions || !conditions.all || conditions.all.length === 0) return true;
    for (const cond of conditions.all) {
      let val;
      if (cond.field === "country") val = "US";
      else if (cond.field === "fraudScore") val = context.fraudScore;
      else if (cond.field === "amount") val = context.conversion.amount;
      if (cond.operator === "eq" && val !== cond.value) return false;
      if (cond.operator === "lt" && val >= cond.value) return false;
      if (cond.operator === "gt" && val <= cond.value) return false;
    }
    return true;
  }
};
CommissionsService = __decorateClass([
  Injectable23()
], CommissionsService);

// src/modules/ledger/ledger.module.ts
import { Module as Module9 } from "@nestjs/common";

// src/modules/ledger/ledger.service.ts
import { Injectable as Injectable24 } from "@nestjs/common";
import { v4 as uuidv412 } from "uuid";
var LedgerService = class {
  async getAccount(organizationId, affiliateId, type = "EARNED") {
    let account = dbStore.ledgerAccounts.find(
      (a) => a.organizationId === organizationId && a.affiliateId === affiliateId && a.type === type
    );
    if (!account) {
      account = {
        id: uuidv412(),
        organizationId,
        affiliateId,
        type,
        balance: 0,
        currency: "USD",
        createdAt: /* @__PURE__ */ new Date(),
        updatedAt: /* @__PURE__ */ new Date()
      };
      dbStore.ledgerAccounts.push(account);
    }
    return account;
  }
  async recordTransaction(organizationId, affiliateId, type, description, referenceId, amount) {
    const account = await this.getAccount(organizationId, affiliateId, "EARNED");
    const transaction = {
      id: uuidv412(),
      organizationId,
      type,
      description,
      referenceId,
      createdAt: /* @__PURE__ */ new Date()
    };
    dbStore.ledgerTransactions.push(transaction);
    const isCredit = ["COMMISSION_EARNED" /* COMMISSION_EARNED */, "COMMISSION_APPROVED" /* COMMISSION_APPROVED */].includes(type);
    const entry = {
      id: uuidv412(),
      transactionId: transaction.id,
      accountId: account.id,
      type: isCredit ? "CREDIT" : "DEBIT",
      amount,
      createdAt: /* @__PURE__ */ new Date()
    };
    dbStore.ledgerEntries.push(entry);
    if (isCredit) {
      account.balance += amount;
    } else {
      account.balance -= amount;
    }
    account.updatedAt = /* @__PURE__ */ new Date();
    return { transaction, entry, updatedBalance: account.balance };
  }
  async getTransactions(organizationId, affiliateId) {
    let accounts = dbStore.ledgerAccounts.filter((a) => a.organizationId === organizationId);
    if (affiliateId) accounts = accounts.filter((a) => a.affiliateId === affiliateId);
    const accountIds = accounts.map((a) => a.id);
    const entries = dbStore.ledgerEntries.filter((e) => accountIds.includes(e.accountId));
    const transactionIds = entries.map((e) => e.transactionId);
    return dbStore.ledgerTransactions.filter((t) => transactionIds.includes(t.id));
  }
};
LedgerService = __decorateClass([
  Injectable24()
], LedgerService);

// src/modules/ledger/ledger.module.ts
var LedgerModule = class {
};
LedgerModule = __decorateClass([
  Module9({
    providers: [LedgerService],
    exports: [LedgerService]
  })
], LedgerModule);

// src/modules/commissions/commissions.module.ts
var CommissionsModule = class {
};
CommissionsModule = __decorateClass([
  Module10({
    imports: [LedgerModule],
    controllers: [CommissionsController],
    providers: [CommissionsService],
    exports: [CommissionsService]
  })
], CommissionsModule);

// src/modules/conversions/conversions.module.ts
var ConversionsModule = class {
};
ConversionsModule = __decorateClass([
  Module11({
    imports: [FraudModule, CommissionsModule, LedgerModule],
    controllers: [ConversionsController],
    providers: [ConversionsService],
    exports: [ConversionsService]
  })
], ConversionsModule);

// src/modules/payouts/payouts.module.ts
import { Module as Module12 } from "@nestjs/common";

// src/modules/payouts/payouts.controller.ts
import {
  Controller as Controller12,
  Get as Get12,
  Post as Post12,
  Body as Body12,
  Param as Param12,
  Res as Res4,
  UseGuards as UseGuards12,
  HttpCode as HttpCode6,
  HttpStatus as HttpStatus6
} from "@nestjs/common";
import { ApiTags as ApiTags12, ApiOperation as ApiOperation12, ApiBearerAuth as ApiBearerAuth12 } from "@nestjs/swagger";
var PayoutsController = class {
  constructor(payoutsService) {
    this.payoutsService = payoutsService;
  }
  async getBatches(organizationId) {
    return this.payoutsService.getBatches(organizationId);
  }
  async createBatch(organizationId, user, dto) {
    return this.payoutsService.createBatch(organizationId, user.userId, dto);
  }
  async processBatch(organizationId, batchId, user) {
    return this.payoutsService.processBatch(organizationId, batchId, user.userId);
  }
  async exportCsv(organizationId, batchId, res) {
    const csvContent = await this.payoutsService.generateCsvExport(organizationId, batchId);
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="payout_batch_${batchId}.csv"`);
    return res.status(200).send(csvContent);
  }
};
__decorateClass([
  Get12(),
  RequirePermissions("manage.payouts"),
  ApiOperation12({ summary: "List payout batches for organization" }),
  __decorateParam(0, Param12("organizationId"))
], PayoutsController.prototype, "getBatches", 1);
__decorateClass([
  Post12("batches"),
  RequirePermissions("manage.payouts"),
  ApiOperation12({ summary: "Create a new payout batch from current affiliate balances" }),
  __decorateParam(0, Param12("organizationId")),
  __decorateParam(1, CurrentUser()),
  __decorateParam(2, Body12())
], PayoutsController.prototype, "createBatch", 1);
__decorateClass([
  Post12("batches/:batchId/process"),
  HttpCode6(HttpStatus6.OK),
  RequirePermissions("manage.payouts"),
  ApiOperation12({ summary: "Process/complete a payout batch" }),
  __decorateParam(0, Param12("organizationId")),
  __decorateParam(1, Param12("batchId")),
  __decorateParam(2, CurrentUser())
], PayoutsController.prototype, "processBatch", 1);
__decorateClass([
  Get12("batches/:batchId/csv"),
  RequirePermissions("manage.payouts"),
  ApiOperation12({ summary: "Export payout batch as CSV" }),
  __decorateParam(0, Param12("organizationId")),
  __decorateParam(1, Param12("batchId")),
  __decorateParam(2, Res4())
], PayoutsController.prototype, "exportCsv", 1);
PayoutsController = __decorateClass([
  ApiTags12("Payouts & Settlements"),
  Controller12("api/v1/organizations/:organizationId/payouts"),
  UseGuards12(JwtAuthGuard, OrganizationGuard, PermissionsGuard),
  ApiBearerAuth12()
], PayoutsController);

// src/modules/payouts/payouts.service.ts
import { Injectable as Injectable25, NotFoundException as NotFoundException13, BadRequestException as BadRequestException10 } from "@nestjs/common";
import { v4 as uuidv413 } from "uuid";
var PayoutsService = class {
  constructor(ledgerService, fraudService) {
    this.ledgerService = ledgerService;
    this.fraudService = fraudService;
  }
  async createBatch(organizationId, createdByUserId, dto) {
    const batchId = uuidv413();
    let totalAmount = 0;
    const items = [];
    const accounts = dbStore.ledgerAccounts.filter(
      (a) => a.organizationId === organizationId && a.type === "EARNED" && a.balance > 0
    );
    const eligibleAccounts = dto.affiliateIds ? accounts.filter((a) => a.affiliateId && dto.affiliateIds?.includes(a.affiliateId)) : accounts;
    if (eligibleAccounts.length === 0) {
      throw new BadRequestException10("No eligible affiliate balances available for payout");
    }
    for (const acc of eligibleAccounts) {
      const amount = acc.balance;
      totalAmount += amount;
      const item = {
        id: uuidv413(),
        batchId,
        organizationId,
        affiliateId: acc.affiliateId,
        amount,
        currency: acc.currency,
        status: "DRAFT" /* DRAFT */,
        createdAt: /* @__PURE__ */ new Date()
      };
      items.push(item);
      dbStore.payoutItems.push(item);
    }
    const batch = {
      id: batchId,
      organizationId,
      status: "DRAFT" /* DRAFT */,
      totalAmount,
      currency: "USD",
      createdBy: createdByUserId,
      createdAt: /* @__PURE__ */ new Date(),
      updatedAt: /* @__PURE__ */ new Date()
    };
    dbStore.payoutBatches.push(batch);
    const fraudResult = await this.fraudService.evaluatePayout(batch);
    if (fraudResult.decision === "HOLD" /* HOLD */ || fraudResult.decision === "REVIEW" /* REVIEW */) {
      batch.status = "PROCESSING" /* PROCESSING */;
      batch.updatedAt = /* @__PURE__ */ new Date();
    }
    dbStore.auditLogs.push({
      id: uuidv413(),
      organizationId,
      actorType: "USER",
      actorId: createdByUserId,
      action: "PAYOUT_CREATED" /* PAYOUT_CREATED */,
      resourceType: "payout_batch",
      resourceId: batch.id,
      createdAt: /* @__PURE__ */ new Date()
    });
    return { batch, items };
  }
  async processBatch(organizationId, batchId, actorId) {
    const batch = dbStore.payoutBatches.find(
      (b) => b.id === batchId && b.organizationId === organizationId
    );
    if (!batch) {
      throw new NotFoundException13("Payout batch not found");
    }
    const fraudResult = await this.fraudService.evaluatePayout(batch);
    if (fraudResult.decision === "HOLD" /* HOLD */ || fraudResult.decision === "REVIEW" /* REVIEW */) {
      batch.status = "PROCESSING" /* PROCESSING */;
      batch.updatedAt = /* @__PURE__ */ new Date();
      throw new BadRequestException10("PAYOUT_HELD_FOR_RISK");
    }
    batch.status = "COMPLETED" /* COMPLETED */;
    batch.updatedAt = /* @__PURE__ */ new Date();
    const items = dbStore.payoutItems.filter((i) => i.batchId === batchId);
    for (const item of items) {
      item.status = "COMPLETED" /* COMPLETED */;
      await this.ledgerService.recordTransaction(
        organizationId,
        item.affiliateId,
        "PAYOUT_COMPLETED" /* PAYOUT_COMPLETED */,
        `Payout batch ${batchId} executed`,
        item.id,
        item.amount
      );
    }
    dbStore.auditLogs.push({
      id: uuidv413(),
      organizationId,
      actorType: "USER",
      actorId,
      action: "PAYOUT_APPROVED" /* PAYOUT_APPROVED */,
      resourceType: "payout_batch",
      resourceId: batch.id,
      metadata: {
        itemCount: items.length,
        totalAmount: batch.totalAmount,
        currency: batch.currency
      },
      createdAt: /* @__PURE__ */ new Date()
    });
    return { batch, items };
  }
  async generateCsvExport(organizationId, batchId) {
    const items = dbStore.payoutItems.filter(
      (i) => i.batchId === batchId && i.organizationId === organizationId
    );
    let csv = "item_id,affiliate_id,email,company_name,amount_dollars,currency,status\n";
    for (const item of items) {
      const affiliate = dbStore.affiliates.find((a) => a.id === item.affiliateId);
      const amountDollars = (item.amount / 100).toFixed(2);
      csv += `${item.id},${item.affiliateId},"${affiliate?.email || ""}","${affiliate?.companyName || ""}",${amountDollars},${item.currency},${item.status}
`;
    }
    return csv;
  }
  async getBatches(organizationId) {
    return dbStore.payoutBatches.filter((b) => b.organizationId === organizationId);
  }
};
PayoutsService = __decorateClass([
  Injectable25()
], PayoutsService);

// src/modules/payouts/payouts.module.ts
var PayoutsModule = class {
};
PayoutsModule = __decorateClass([
  Module12({
    imports: [LedgerModule, FraudModule],
    controllers: [PayoutsController],
    providers: [PayoutsService],
    exports: [PayoutsService]
  })
], PayoutsModule);

// src/modules/webhooks/webhooks.module.ts
import { Module as Module13 } from "@nestjs/common";

// src/modules/webhooks/webhooks.controller.ts
import {
  Controller as Controller13,
  Get as Get13,
  Post as Post13,
  Body as Body13,
  Param as Param13,
  UseGuards as UseGuards13
} from "@nestjs/common";
import { ApiTags as ApiTags13, ApiOperation as ApiOperation13, ApiBearerAuth as ApiBearerAuth13 } from "@nestjs/swagger";
var WebhooksController = class {
  constructor(webhooksService) {
    this.webhooksService = webhooksService;
  }
  async createEndpoint(organizationId, user, dto) {
    return this.webhooksService.createEndpoint(organizationId, user.userId, dto);
  }
  async getEndpoints(organizationId) {
    return this.webhooksService.getEndpoints(organizationId);
  }
  async getDeliveries(organizationId) {
    return this.webhooksService.getDeliveries(organizationId);
  }
};
__decorateClass([
  Post13(),
  RequirePermissions("manage.webhooks"),
  ApiOperation13({ summary: "Register a new webhook endpoint" }),
  __decorateParam(0, Param13("organizationId")),
  __decorateParam(1, CurrentUser()),
  __decorateParam(2, Body13())
], WebhooksController.prototype, "createEndpoint", 1);
__decorateClass([
  Get13(),
  RequirePermissions("manage.webhooks"),
  ApiOperation13({ summary: "List webhook endpoints" }),
  __decorateParam(0, Param13("organizationId"))
], WebhooksController.prototype, "getEndpoints", 1);
__decorateClass([
  Get13("deliveries"),
  RequirePermissions("manage.webhooks"),
  ApiOperation13({ summary: "List webhook delivery logs" }),
  __decorateParam(0, Param13("organizationId"))
], WebhooksController.prototype, "getDeliveries", 1);
WebhooksController = __decorateClass([
  ApiTags13("Webhooks Engine"),
  Controller13("api/v1/organizations/:organizationId/webhooks"),
  UseGuards13(JwtAuthGuard, OrganizationGuard, PermissionsGuard),
  ApiBearerAuth13()
], WebhooksController);

// src/modules/webhooks/webhooks.service.ts
import { Injectable as Injectable26 } from "@nestjs/common";
import { v4 as uuidv414 } from "uuid";
var WebhooksService = class {
  async createEndpoint(organizationId, createdByUserId, dto) {
    const { secret, hash: hash2 } = SecurityUtils.generateWebhookSecret();
    const encryptedSecret = SecurityUtils.encrypt(secret);
    const endpoint = {
      id: uuidv414(),
      organizationId,
      url: dto.url,
      secretHash: hash2,
      secretEncrypted: encryptedSecret,
      enabled: true,
      subscribedEvents: dto.subscribedEvents,
      createdAt: /* @__PURE__ */ new Date()
    };
    dbStore.webhookEndpoints.push(endpoint);
    dbStore.auditLogs.push({
      id: uuidv414(),
      organizationId,
      actorType: "USER",
      actorId: createdByUserId,
      action: "WEBHOOK_CREATED" /* WEBHOOK_CREATED */,
      resourceType: "webhook_endpoint",
      resourceId: endpoint.id,
      createdAt: /* @__PURE__ */ new Date()
    });
    return {
      id: endpoint.id,
      url: endpoint.url,
      secret,
      // Returned ONLY ONCE
      subscribedEvents: endpoint.subscribedEvents,
      createdAt: endpoint.createdAt
    };
  }
  async getEndpoints(organizationId) {
    return dbStore.webhookEndpoints.filter((e) => e.organizationId === organizationId).map((e) => ({
      id: e.id,
      url: e.url,
      enabled: e.enabled,
      subscribedEvents: e.subscribedEvents,
      createdAt: e.createdAt
    }));
  }
  async triggerEvent(organizationId, event, payload) {
    const endpoints = dbStore.webhookEndpoints.filter(
      (e) => e.organizationId === organizationId && e.enabled && e.subscribedEvents.includes(event)
    );
    const timestamp = Math.floor(Date.now() / 1e3);
    const rawBody = JSON.stringify({ event, timestamp, data: payload });
    for (const ep of endpoints) {
      const secret = SecurityUtils.decrypt(ep.secretEncrypted);
      const signature = SecurityUtils.signWebhookPayload(secret, timestamp, rawBody);
      const delivery = {
        id: uuidv414(),
        endpointId: ep.id,
        eventId: `evt_${uuidv414()}`,
        attempt: 1,
        requestBody: rawBody,
        responseCode: 200,
        responseBodyTruncated: '{"received": true}',
        durationMs: 42,
        status: "SUCCESS",
        createdAt: /* @__PURE__ */ new Date()
      };
      dbStore.webhookDeliveries.push(delivery);
    }
  }
  async getDeliveries(organizationId) {
    const endpoints = dbStore.webhookEndpoints.filter((e) => e.organizationId === organizationId);
    const endpointIds = endpoints.map((e) => e.id);
    return dbStore.webhookDeliveries.filter((d) => endpointIds.includes(d.endpointId));
  }
};
WebhooksService = __decorateClass([
  Injectable26()
], WebhooksService);

// src/modules/webhooks/webhooks.module.ts
var WebhooksModule = class {
};
WebhooksModule = __decorateClass([
  Module13({
    controllers: [WebhooksController],
    providers: [WebhooksService],
    exports: [WebhooksService]
  })
], WebhooksModule);

// src/modules/audit/audit.module.ts
import { Module as Module14 } from "@nestjs/common";

// src/modules/audit/audit.controller.ts
import { Controller as Controller14, Get as Get14, Param as Param14, UseGuards as UseGuards14 } from "@nestjs/common";
import { ApiTags as ApiTags14, ApiOperation as ApiOperation14, ApiBearerAuth as ApiBearerAuth14 } from "@nestjs/swagger";
var AuditController = class {
  constructor(auditService) {
    this.auditService = auditService;
  }
  async getAuditLogs(organizationId) {
    return this.auditService.getAuditLogs(organizationId);
  }
};
__decorateClass([
  Get14(),
  RequirePermissions("audit.read"),
  ApiOperation14({ summary: "Get immutable audit logs for organization" }),
  __decorateParam(0, Param14("organizationId"))
], AuditController.prototype, "getAuditLogs", 1);
AuditController = __decorateClass([
  ApiTags14("Audit Logging"),
  Controller14("api/v1/organizations/:organizationId/audit-logs"),
  UseGuards14(JwtAuthGuard, OrganizationGuard, PermissionsGuard),
  ApiBearerAuth14()
], AuditController);

// src/modules/audit/audit.service.ts
import { Injectable as Injectable27 } from "@nestjs/common";
var AuditService = class {
  async getAuditLogs(organizationId) {
    return dbStore.auditLogs.filter((log) => log.organizationId === organizationId).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).map((log) => {
      const actor = dbStore.users.find((user) => user.id === log.actorId);
      return {
        ...log,
        actorLabel: actor ? actor.email : log.actorId
      };
    });
  }
};
AuditService = __decorateClass([
  Injectable27()
], AuditService);

// src/modules/audit/audit.module.ts
var AuditModule = class {
};
AuditModule = __decorateClass([
  Module14({
    controllers: [AuditController],
    providers: [AuditService],
    exports: [AuditService]
  })
], AuditModule);

// src/modules/admin/admin.module.ts
import { Module as Module15 } from "@nestjs/common";

// src/modules/admin/admin.controller.ts
import { Controller as Controller15, Get as Get15, UseGuards as UseGuards15 } from "@nestjs/common";
import { ApiBearerAuth as ApiBearerAuth15, ApiOperation as ApiOperation15, ApiTags as ApiTags15 } from "@nestjs/swagger";
var AdminController = class {
  constructor(adminService) {
    this.adminService = adminService;
  }
  getOverview(user) {
    return this.adminService.getOverview(user);
  }
};
__decorateClass([
  Get15("overview"),
  ApiOperation15({ summary: "Get real platform admin data across all organizations" }),
  __decorateParam(0, CurrentUser())
], AdminController.prototype, "getOverview", 1);
AdminController = __decorateClass([
  ApiTags15("Platform Admin"),
  Controller15("api/v1/admin"),
  UseGuards15(JwtAuthGuard),
  ApiBearerAuth15()
], AdminController);

// src/modules/admin/admin.service.ts
import { ForbiddenException as ForbiddenException5, Injectable as Injectable28 } from "@nestjs/common";
import Redis2 from "ioredis";
var AdminService = class {
  async getOverview(user) {
    if (!user.isSuperAdmin && user.platformRole !== "SUPER_ADMIN" /* SUPER_ADMIN */) {
      throw new ForbiddenException5("Super admin access is required");
    }
    const orgNameById = new Map(dbStore.organizations.map((org) => [org.id, org.name]));
    const userById = new Map(dbStore.users.map((userRecord) => [userRecord.id, userRecord]));
    const programById = new Map(dbStore.programs.map((program) => [program.id, program]));
    const affiliateById = new Map(dbStore.affiliates.map((affiliate) => [affiliate.id, affiliate]));
    const conversionsByProgram = this.groupBy(dbStore.conversions, (conversion) => conversion.programId);
    const commissionsByConversion = this.groupBy(dbStore.commissions, (commission) => commission.conversionId);
    const payoutsByBatch = this.groupBy(dbStore.payoutItems, (item) => item.batchId);
    const organizations = dbStore.organizations.filter((org) => !org.deletedAt).map((org) => {
      const programs2 = dbStore.programs.filter((program) => program.organizationId === org.id && !program.deletedAt);
      const affiliates2 = dbStore.affiliates.filter((affiliate) => affiliate.organizationId === org.id);
      const conversions2 = dbStore.conversions.filter((conversion) => conversion.organizationId === org.id);
      const commissions2 = dbStore.commissions.filter((commission) => commission.organizationId === org.id);
      const ownerMembership = dbStore.organizationMemberships.find(
        (membership) => membership.organizationId === org.id && membership.role === "OWNER"
      );
      const owner = ownerMembership ? userById.get(ownerMembership.userId) : void 0;
      return {
        id: org.id,
        name: org.name,
        slug: org.slug,
        domain: this.domainFromWebsite(org.website),
        status: this.organizationStatus(org.status),
        plan: "growth",
        programs: programs2.length,
        affiliates: affiliates2.length,
        trackedRevenue: this.centsToDollars(conversions2.reduce((total, conversion) => total + Number(conversion.amount || 0), 0)),
        commissionVolume: this.centsToDollars(commissions2.reduce((total, commission) => total + Number(commission.commissionAmount || 0), 0)),
        country: org.country || "US",
        industry: org.industry || "Software",
        createdAt: this.dateOnly(org.createdAt),
        lastActiveAt: this.relativeTime(org.updatedAt || org.createdAt),
        ownerName: owner ? `${owner.firstName} ${owner.lastName}` : "Unknown Owner",
        ownerEmail: owner?.email || "unknown@example.com",
        apiAccessEnabled: org.status === "ACTIVE",
        payoutsEnabled: org.status === "ACTIVE"
      };
    });
    const programs = dbStore.programs.filter((program) => !program.deletedAt).map((program) => {
      const conversions2 = conversionsByProgram.get(program.id) || [];
      const commissions2 = dbStore.commissions.filter((commission) => commission.programId === program.id);
      const affiliateIds = new Set(
        dbStore.programAffiliates.filter((link) => link.programId === program.id).map((link) => link.affiliateId)
      );
      return {
        id: program.id,
        organizationId: program.organizationId,
        orgName: orgNameById.get(program.organizationId) || "Unknown Organization",
        name: program.name,
        type: String(program.type).toLowerCase(),
        status: this.programStatus(program.status),
        affiliatesCount: affiliateIds.size,
        revenue: this.centsToDollars(conversions2.reduce((total, conversion) => total + Number(conversion.amount || 0), 0)),
        commission: this.centsToDollars(commissions2.reduce((total, commission) => total + Number(commission.commissionAmount || 0), 0)),
        fraudRate: this.fraudRateForProgram(program.id),
        defaultCommission: this.formatCommission(program.commissionType, program.defaultCommissionValue),
        attributionModel: String(program.attributionModel).toLowerCase(),
        cookieDays: program.cookieDurationDays,
        approvalType: String(program.affiliateApprovalMode || "AUTO").toLowerCase(),
        createdAt: this.dateOnly(program.createdAt)
      };
    });
    const affiliates = dbStore.affiliates.map((affiliate) => {
      const programLinks = dbStore.programAffiliates.filter((link) => link.affiliateId === affiliate.id);
      const primaryProgram = programLinks[0] ? programById.get(programLinks[0].programId) : void 0;
      const commissions2 = dbStore.commissions.filter((commission) => commission.affiliateId === affiliate.id);
      const conversions2 = dbStore.conversions.filter((conversion) => conversion.affiliateId === affiliate.id);
      return {
        id: affiliate.id,
        organizationId: affiliate.organizationId,
        orgName: orgNameById.get(affiliate.organizationId) || "Unknown Organization",
        programName: primaryProgram?.name || "No program",
        name: affiliate.displayName,
        email: affiliate.email,
        channel: affiliate.companyName || affiliate.website || "Direct partner",
        trustScore: affiliate.trustScore,
        status: this.affiliateStatus(affiliate.status),
        revenue: this.centsToDollars(conversions2.reduce((total, conversion) => total + Number(conversion.amount || 0), 0)),
        commissionEarned: this.centsToDollars(commissions2.reduce((total, commission) => total + Number(commission.commissionAmount || 0), 0)),
        fraudRate: this.fraudRateForAffiliate(affiliate.id),
        joinedDate: this.dateOnly(affiliate.createdAt),
        country: affiliate.country
      };
    });
    const conversions = dbStore.conversions.map((conversion) => {
      const commission = (commissionsByConversion.get(conversion.id) || [])[0];
      const program = programById.get(conversion.programId);
      const affiliate = conversion.affiliateId ? affiliateById.get(conversion.affiliateId) : void 0;
      return {
        id: conversion.id,
        orderId: conversion.externalId,
        organizationId: conversion.organizationId,
        orgName: orgNameById.get(conversion.organizationId) || "Unknown Organization",
        programName: program?.name || "Unknown Program",
        affiliateName: affiliate?.displayName || "Unattributed",
        revenue: this.centsToDollars(conversion.amount),
        commission: this.centsToDollars(commission?.commissionAmount || 0),
        fraudScore: this.fraudScoreForConversion(conversion.id),
        status: this.titleCase(conversion.status),
        date: this.dateTime(conversion.createdAt),
        attribution: "Last Click",
        clickId: conversion.id
      };
    });
    const commissions = dbStore.commissions.map((commission) => {
      const program = programById.get(commission.programId);
      const affiliate = affiliateById.get(commission.affiliateId);
      return {
        id: commission.id,
        organizationId: commission.organizationId,
        orgName: orgNameById.get(commission.organizationId) || "Unknown Organization",
        affiliateName: affiliate?.displayName || "Unknown Affiliate",
        programName: program?.name || "Unknown Program",
        revenue: this.centsToDollars(commission.baseAmount),
        rate: `${commission.rate / 100}%`,
        amount: this.centsToDollars(commission.commissionAmount),
        status: this.titleCase(commission.status),
        rule: commission.ruleSnapshot?.ruleName || "Default Program Rate",
        created: this.dateTime(commission.createdAt)
      };
    });
    const fraudReviews = dbStore.fraudReviews.map((review) => {
      const conversion = dbStore.conversions.find((item) => item.id === review.conversionId);
      const affiliate = conversion?.affiliateId ? affiliateById.get(conversion.affiliateId) : void 0;
      return {
        id: review.id,
        riskLevel: this.riskLevel(review.fraudScore),
        conversionId: conversion?.externalId || review.conversionId,
        orgName: orgNameById.get(review.organizationId) || "Unknown Organization",
        affiliateName: affiliate?.displayName || "Unassigned",
        amount: this.centsToDollars(conversion?.amount || 0),
        fraudScore: review.fraudScore,
        confidence: review.confidence || 0,
        decision: review.reviewDecision || "REVIEW",
        assessmentId: review.assessmentId,
        signals: (review.signals || []).map((signal) => String(signal.code || signal.reason || signal.type || signal)),
        age: this.relativeTime(review.createdAt),
        status: review.status === "APPROVED" ? "cleared" : review.status === "REJECTED" ? "blocked" : "pending",
        ip: "n/a",
        country: affiliate?.country || "n/a"
      };
    });
    const payoutBatches = dbStore.payoutBatches.map((batch) => ({
      id: batch.id,
      batchId: batch.id,
      orgName: orgNameById.get(batch.organizationId) || "Unknown Organization",
      period: `${this.dateOnly(batch.createdAt)} payout`,
      affiliatesCount: new Set((payoutsByBatch.get(batch.id) || []).map((item) => item.affiliateId)).size,
      amount: this.centsToDollars(batch.totalAmount),
      provider: "Direct Bank Wire",
      status: this.payoutStatus(batch.status),
      created: this.dateTime(batch.createdAt),
      processed: batch.status === "COMPLETED" /* COMPLETED */ ? this.dateTime(batch.updatedAt) : "Pending"
    }));
    const auditLogs = dbStore.auditLogs.map((log) => ({
      id: log.id,
      time: this.dateTime(log.createdAt),
      actor: userById.get(log.actorId)?.email || log.actorId,
      orgName: log.organizationId ? orgNameById.get(log.organizationId) || "Unknown Organization" : "PartnerIQ Platform",
      action: log.action,
      resource: log.resourceId,
      ip: log.ipAddress || "n/a",
      requestId: log.id,
      metadata: log.metadata || {}
    }));
    const webhooks = dbStore.webhookDeliveries.map((delivery) => {
      const endpoint = dbStore.webhookEndpoints.find((item) => item.id === delivery.endpointId);
      return {
        id: delivery.id,
        deliveryId: delivery.eventId,
        orgName: endpoint ? orgNameById.get(endpoint.organizationId) || "Unknown Organization" : "Unknown Organization",
        endpoint: endpoint?.url || "Unknown endpoint",
        event: delivery.eventId,
        httpStatus: delivery.responseCode,
        attempts: delivery.attempt,
        durationMs: delivery.durationMs,
        timestamp: this.dateTime(delivery.createdAt),
        payload: typeof delivery.requestBody === "string" ? delivery.requestBody : JSON.stringify(delivery.requestBody, null, 2),
        response: delivery.responseBodyTruncated || ""
      };
    });
    return {
      adminUser: {
        id: user.userId,
        name: user.email,
        email: user.email,
        role: "SUPER_ADMIN",
        lastLogin: "Just now"
      },
      organizations,
      programs,
      affiliates,
      conversions,
      commissions,
      fraudReviews,
      payoutBatches,
      auditLogs,
      webhooks,
      integrations: this.getIntegrations(),
      integrationMetrics: this.getIntegrationMetrics(),
      systemComponents: await this.getSystemComponents(),
      queueJobs: this.getQueueJobs(),
      securityEvents: this.getSecurityEvents()
    };
  }
  getSecurityEvents() {
    const securityEvents = [];
    for (const lockedUser of dbStore.users.filter((user) => user.status === "LOCKED")) {
      securityEvents.push({
        id: `sec_user_${lockedUser.id}`,
        severity: "High",
        event: "USER_ACCOUNT_LOCKED",
        actor: lockedUser.email,
        orgName: "PartnerIQ Platform",
        ip: "n/a",
        time: this.relativeTime(lockedUser.lockedUntil || lockedUser.updatedAt),
        status: "Locked",
        details: "User account is locked after authentication policy enforcement."
      });
    }
    for (const session of dbStore.authSessions.filter((item) => item.revokedAt)) {
      const sessionUser = dbStore.users.find((user) => user.id === session.userId);
      securityEvents.push({
        id: `sec_session_${session.id}`,
        severity: "Medium",
        event: "SESSION_REVOKED",
        actor: sessionUser?.email || session.userId,
        orgName: "PartnerIQ Platform",
        ip: session.ipAddress || "n/a",
        time: this.relativeTime(session.revokedAt),
        status: "Revoked",
        details: "Authentication session refresh token family was revoked."
      });
    }
    for (const org of dbStore.organizations.filter((item) => item.status === "SUSPENDED" || item.status === "CLOSED")) {
      securityEvents.push({
        id: `sec_org_${org.id}`,
        severity: org.status === "SUSPENDED" ? "High" : "Medium",
        event: "TENANT_ACCESS_RESTRICTED",
        actor: dbStore.users.find((user) => user.id === org.createdBy)?.email || org.createdBy,
        orgName: org.name,
        ip: "n/a",
        time: this.relativeTime(org.updatedAt),
        status: org.status,
        details: `Organization status is ${String(org.status).toLowerCase()}, so protected tenant actions are restricted.`
      });
    }
    for (const apiKey of dbStore.apiKeys.filter((key) => key.revokedAt)) {
      const orgName = dbStore.organizations.find((org) => org.id === apiKey.organizationId)?.name || "Unknown Organization";
      securityEvents.push({
        id: `sec_api_key_${apiKey.id}`,
        severity: "Medium",
        event: "API_KEY_REVOKED",
        actor: dbStore.users.find((user) => user.id === apiKey.createdBy)?.email || apiKey.createdBy,
        orgName,
        ip: "n/a",
        time: this.relativeTime(apiKey.revokedAt),
        status: "Revoked",
        details: `API key ${apiKey.prefix} was revoked and can no longer access tenant APIs.`
      });
    }
    for (const delivery of dbStore.webhookDeliveries.filter((item) => item.responseCode >= 400)) {
      const endpoint = dbStore.webhookEndpoints.find((item) => item.id === delivery.endpointId);
      const orgName = endpoint ? dbStore.organizations.find((org) => org.id === endpoint.organizationId)?.name || "Unknown Organization" : "Unknown Organization";
      securityEvents.push({
        id: `sec_webhook_${delivery.id}`,
        severity: delivery.responseCode >= 500 ? "High" : "Medium",
        event: "WEBHOOK_DELIVERY_FAILURE",
        actor: endpoint?.url || delivery.endpointId,
        orgName,
        ip: "n/a",
        time: this.relativeTime(delivery.createdAt),
        status: String(delivery.responseCode),
        details: delivery.responseBodyTruncated || "Webhook delivery returned a non-success response."
      });
    }
    return securityEvents.sort((a, b) => a.time.localeCompare(b.time));
  }
  getIntegrations() {
    const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    return [...dbStore.integrations].sort((a, b) => a.displayOrder - b.displayOrder || a.name.localeCompare(b.name)).map((integration) => {
      const connections = dbStore.organizationIntegrations.filter((item) => item.integrationId === integration.id);
      const events = dbStore.integrationEvents.filter((item) => item.integrationId === integration.id);
      const processed = events.filter((event) => event.status === "PROCESSED" /* PROCESSED */).length;
      const failed = events.filter((event) => event.status === "FAILED" /* FAILED */).length;
      const total = processed + failed;
      const successRate = total === 0 ? 100 : Math.round(processed / total * 1e3) / 10;
      return {
        id: integration.id,
        code: integration.code,
        name: integration.name,
        slug: integration.slug,
        description: integration.description,
        category: integration.category,
        provider: integration.provider,
        status: integration.status,
        connectionTypes: integration.connectionTypes || [],
        supportsOAuth: integration.supportsOAuth,
        supportsWebhooks: integration.supportsWebhooks,
        supportsApiKey: integration.supportsApiKey,
        documentationUrl: integration.documentationUrl,
        iconKey: integration.iconKey,
        displayOrder: integration.displayOrder,
        connectedOrganizations: connections.length,
        healthyConnections: connections.filter((item) => item.status === "CONNECTED" /* CONNECTED */).length,
        degradedConnections: connections.filter((item) => item.status === "REAUTH_REQUIRED" /* REAUTH_REQUIRED */ || item.status === "PENDING" /* PENDING */).length,
        failedConnections: connections.filter((item) => item.status === "ERROR" /* ERROR */).length,
        eventsToday: events.filter((event) => new Date(event.createdAt).toISOString().slice(0, 10) === today).length,
        successRate,
        avgProcessingMs: events.length === 0 ? 0 : Math.round(events.reduce((sum, event) => sum + Number(event.processingMs || 0), 0) / events.length),
        webhookSuccessRate: successRate
      };
    });
  }
  getIntegrationMetrics() {
    const integrations = this.getIntegrations();
    return {
      totalIntegrations: integrations.length,
      activeIntegrations: integrations.filter((item) => item.status === "ACTIVE" /* ACTIVE */).length,
      betaIntegrations: integrations.filter((item) => item.status === "BETA" /* BETA */).length,
      comingSoonIntegrations: integrations.filter((item) => item.status === "COMING_SOON" /* COMING_SOON */).length,
      connectedOrganizations: integrations.reduce((total, item) => total + item.connectedOrganizations, 0),
      healthyConnections: integrations.reduce((total, item) => total + item.healthyConnections, 0),
      degradedConnections: integrations.reduce((total, item) => total + item.degradedConnections, 0),
      failedConnections: integrations.reduce((total, item) => total + item.failedConnections, 0),
      eventsToday: integrations.reduce((total, item) => total + item.eventsToday, 0)
    };
  }
  async getSystemComponents() {
    const [databaseHealth, redisHealth] = await Promise.all([
      this.checkDatabaseHealth(),
      this.checkRedisHealth()
    ]);
    const failedWebhookDeliveries = dbStore.webhookDeliveries.filter((delivery) => delivery.responseCode >= 400).length;
    const queuedWorkItems = dbStore.fraudReviews.filter((review) => review.status === "PENDING").length + dbStore.payoutBatches.filter((batch) => batch.status === "DRAFT" || batch.status === "PROCESSING").length;
    return [
      databaseHealth,
      redisHealth,
      {
        name: "Core API Process",
        status: "Healthy",
        latency: "local",
        uptime: this.formatUptime(process.uptime()),
        metric: `${Math.round(process.memoryUsage().rss / 1024 / 1024)}MB RSS`
      },
      {
        name: "DB-Backed Store Cache",
        status: AppDataSource.isInitialized ? "Healthy" : "Down",
        latency: "local",
        uptime: AppDataSource.isInitialized ? "online" : "offline",
        metric: `${dbStore.organizations.length} orgs cached`
      },
      {
        name: "BullMQ Worker Queues",
        status: redisHealth.status === "Healthy" ? "Healthy" : "Degraded",
        latency: redisHealth.latency,
        uptime: redisHealth.status === "Healthy" ? "ready" : "redis unavailable",
        metric: `${queuedWorkItems} pending work items`
      },
      {
        name: "Webhook Dispatch Engine",
        status: failedWebhookDeliveries > 0 ? "Degraded" : "Healthy",
        latency: this.averageWebhookLatency(),
        uptime: failedWebhookDeliveries > 0 ? `${failedWebhookDeliveries} failed deliveries` : "ready",
        metric: `${dbStore.webhookDeliveries.length} deliveries`
      }
    ];
  }
  getQueueJobs() {
    const jobs = [];
    for (const review of dbStore.fraudReviews) {
      const orgName = dbStore.organizations.find((org) => org.id === review.organizationId)?.name || "Unknown Organization";
      jobs.push({
        id: `fraud_${review.id}`,
        queue: "Fraud",
        orgName,
        attempts: 1,
        status: review.status === "PENDING" ? "waiting" : "completed",
        created: this.relativeTime(review.createdAt)
      });
    }
    for (const batch of dbStore.payoutBatches) {
      const orgName = dbStore.organizations.find((org) => org.id === batch.organizationId)?.name || "Unknown Organization";
      jobs.push({
        id: `payout_${batch.id}`,
        queue: "Payouts",
        orgName,
        attempts: batch.status === "FAILED" ? 3 : 1,
        error: batch.status === "FAILED" ? "Payout batch failed" : void 0,
        status: batch.status === "COMPLETED" ? "completed" : batch.status === "FAILED" ? "failed" : "waiting",
        created: this.relativeTime(batch.createdAt)
      });
    }
    for (const delivery of dbStore.webhookDeliveries) {
      const endpoint = dbStore.webhookEndpoints.find((item) => item.id === delivery.endpointId);
      const orgName = endpoint ? dbStore.organizations.find((org) => org.id === endpoint.organizationId)?.name || "Unknown Organization" : "Unknown Organization";
      jobs.push({
        id: `webhook_${delivery.id}`,
        queue: "Webhooks",
        orgName,
        attempts: delivery.attempt,
        error: delivery.responseCode >= 400 ? delivery.responseBodyTruncated || "Webhook delivery failed" : void 0,
        status: delivery.responseCode >= 400 ? "failed" : "completed",
        created: this.relativeTime(delivery.createdAt)
      });
    }
    return jobs;
  }
  async checkDatabaseHealth() {
    const startedAt = Date.now();
    try {
      if (!AppDataSource.isInitialized) {
        return {
          name: "MySQL Primary Database",
          status: "Down",
          latency: "offline",
          uptime: "not connected",
          metric: "connection closed"
        };
      }
      await AppDataSource.query("SELECT 1");
      return {
        name: "MySQL Primary Database",
        status: "Healthy",
        latency: `${Date.now() - startedAt}ms`,
        uptime: "connected",
        metric: `${AppDataSource.entityMetadatas.length} entities`
      };
    } catch (error) {
      return {
        name: "MySQL Primary Database",
        status: "Down",
        latency: `${Date.now() - startedAt}ms`,
        uptime: "query failed",
        metric: error?.code || "database error"
      };
    }
  }
  async checkRedisHealth() {
    const startedAt = Date.now();
    const redisUrl = process.env.REDIS_URL || process.env.KV_URL;
    const redis = redisUrl ? new Redis2(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 0, enableOfflineQueue: false }) : new Redis2({
      host: process.env.REDIS_HOST || "localhost",
      port: Number(process.env.REDIS_PORT || 6379),
      password: process.env.REDIS_PASSWORD || void 0,
      lazyConnect: true,
      maxRetriesPerRequest: 0,
      enableOfflineQueue: false
    });
    redis.on("error", () => void 0);
    try {
      await this.withTimeout(redis.connect(), 1200);
      await this.withTimeout(redis.ping(), 1200);
      const info = await this.withTimeout(redis.info("memory"), 1200);
      const memory = /used_memory_human:(.+)\r?\n/.exec(info)?.[1]?.trim() || "connected";
      return {
        name: "Redis Cache & Queue Broker",
        status: "Healthy",
        latency: `${Date.now() - startedAt}ms`,
        uptime: "connected",
        metric: memory
      };
    } catch (error) {
      return {
        name: "Redis Cache & Queue Broker",
        status: "Degraded",
        latency: `${Date.now() - startedAt}ms`,
        uptime: "unreachable",
        metric: error?.code || error?.message || "redis unavailable"
      };
    } finally {
      redis.disconnect();
    }
  }
  groupBy(items, getKey) {
    return items.reduce((map, item) => {
      const key = getKey(item);
      const values = map.get(key) || [];
      values.push(item);
      map.set(key, values);
      return map;
    }, /* @__PURE__ */ new Map());
  }
  centsToDollars(value) {
    return Number((Number(value || 0) / 100).toFixed(2));
  }
  dateOnly(value) {
    return value ? new Date(value).toISOString().slice(0, 10) : "";
  }
  dateTime(value) {
    return value ? new Date(value).toISOString().replace("T", " ").slice(0, 19) : "";
  }
  relativeTime(value) {
    if (!value) return "Unknown";
    const minutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 6e4));
    if (minutes < 1) return "Just now";
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
    const days = Math.round(hours / 24);
    return `${days} day${days === 1 ? "" : "s"} ago`;
  }
  formatUptime(seconds) {
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ${minutes % 60}m`;
    const days = Math.floor(hours / 24);
    return `${days}d ${hours % 24}h`;
  }
  averageWebhookLatency() {
    if (!dbStore.webhookDeliveries.length) return "n/a";
    const total = dbStore.webhookDeliveries.reduce((sum, delivery) => sum + Number(delivery.durationMs || 0), 0);
    return `${Math.round(total / dbStore.webhookDeliveries.length)}ms`;
  }
  async withTimeout(promise, timeoutMs) {
    let timeout;
    try {
      return await Promise.race([
        promise,
        new Promise((_, reject) => {
          timeout = setTimeout(() => reject(new Error("timeout")), timeoutMs);
        })
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }
  domainFromWebsite(website) {
    if (!website) return "n/a";
    try {
      return new URL(website).hostname.replace(/^www\./, "");
    } catch {
      return website.replace(/^https?:\/\//, "").split("/")[0] || "n/a";
    }
  }
  organizationStatus(status) {
    if (status === "SUSPENDED") return "suspended";
    if (status === "CLOSED" || status === "REVOKED") return "closed";
    return "active";
  }
  programStatus(status) {
    if (status === "PAUSED") return "paused";
    if (status === "DRAFT") return "draft";
    return "active";
  }
  affiliateStatus(status) {
    if (status === "SUSPENDED" || status === "REJECTED") return "Suspended";
    if (status === "PENDING") return "Pending";
    return "Active";
  }
  payoutStatus(status) {
    if (status === "COMPLETED") return "Completed";
    if (status === "PROCESSING") return "Processing";
    if (status === "FAILED" || status === "PARTIALLY_FAILED" || status === "CANCELLED") return "Failed";
    return "Scheduled";
  }
  titleCase(value) {
    const normalized = String(value || "").toLowerCase();
    return normalized.charAt(0).toUpperCase() + normalized.slice(1);
  }
  formatCommission(type, value) {
    if (type === "FIXED_AMOUNT") {
      return `$${this.centsToDollars(value).toFixed(2)} flat`;
    }
    return `${value / 100}%`;
  }
  fraudScoreForConversion(conversionId) {
    return dbStore.fraudReviews.find((review) => review.conversionId === conversionId)?.fraudScore || 0;
  }
  fraudRateForProgram(programId) {
    const reviews = dbStore.fraudReviews.filter((review) => review.programId === programId);
    if (!reviews.length) return 0;
    return Number((reviews.filter((review) => review.fraudScore >= 70).length / reviews.length * 100).toFixed(1));
  }
  fraudRateForAffiliate(affiliateId) {
    const conversionIds = dbStore.conversions.filter((conversion) => conversion.affiliateId === affiliateId).map((conversion) => conversion.id);
    const reviews = dbStore.fraudReviews.filter((review) => conversionIds.includes(review.conversionId));
    if (!reviews.length) return 0;
    return Number((reviews.filter((review) => review.fraudScore >= 70).length / reviews.length * 100).toFixed(1));
  }
  riskLevel(score) {
    if (score >= 90) return "CRITICAL";
    if (score >= 70) return "HIGH";
    if (score >= 40) return "MEDIUM";
    return "LOW";
  }
};
AdminService = __decorateClass([
  Injectable28()
], AdminService);

// src/modules/admin/admin.module.ts
var AdminModule = class {
};
AdminModule = __decorateClass([
  Module15({
    controllers: [AdminController],
    providers: [AdminService]
  })
], AdminModule);

// src/modules/integrations/integrations.module.ts
import { Module as Module16 } from "@nestjs/common";

// src/modules/integrations/integrations.controller.ts
import { Body as Body14, Controller as Controller16, Get as Get16, Headers as Headers2, Param as Param15, Patch as Patch4, Post as Post14, UseGuards as UseGuards16 } from "@nestjs/common";
import { ApiBearerAuth as ApiBearerAuth16, ApiOperation as ApiOperation16, ApiTags as ApiTags16 } from "@nestjs/swagger";
var IntegrationsController = class {
  constructor(integrationsService) {
    this.integrationsService = integrationsService;
  }
  list(user) {
    return this.integrationsService.listAdminIntegrations(user);
  }
  metrics(user) {
    return this.integrationsService.getMetrics(user);
  }
  detail(user, integrationId) {
    return this.integrationsService.getAdminIntegration(user, integrationId);
  }
  updateStatus(user, integrationId, status) {
    return this.integrationsService.updateStatus(user, integrationId, status);
  }
  connections(user, integrationId) {
    return this.integrationsService.connections(user, integrationId);
  }
  events(user, integrationId) {
    return this.integrationsService.events(user, integrationId);
  }
  receiveWebhook(provider, publicConnectionId, body, headers) {
    return this.integrationsService.receiveWebhook(provider, publicConnectionId, body, headers);
  }
};
__decorateClass([
  Get16("admin/integrations"),
  UseGuards16(JwtAuthGuard),
  ApiBearerAuth16(),
  ApiOperation16({ summary: "List platform integrations with health metrics" }),
  __decorateParam(0, CurrentUser())
], IntegrationsController.prototype, "list", 1);
__decorateClass([
  Get16("admin/integrations/metrics"),
  UseGuards16(JwtAuthGuard),
  ApiBearerAuth16(),
  __decorateParam(0, CurrentUser())
], IntegrationsController.prototype, "metrics", 1);
__decorateClass([
  Get16("admin/integrations/:integrationId"),
  UseGuards16(JwtAuthGuard),
  ApiBearerAuth16(),
  __decorateParam(0, CurrentUser()),
  __decorateParam(1, Param15("integrationId"))
], IntegrationsController.prototype, "detail", 1);
__decorateClass([
  Patch4("admin/integrations/:integrationId/status"),
  UseGuards16(JwtAuthGuard),
  ApiBearerAuth16(),
  __decorateParam(0, CurrentUser()),
  __decorateParam(1, Param15("integrationId")),
  __decorateParam(2, Body14("status"))
], IntegrationsController.prototype, "updateStatus", 1);
__decorateClass([
  Get16("admin/integrations/:integrationId/connections"),
  UseGuards16(JwtAuthGuard),
  ApiBearerAuth16(),
  __decorateParam(0, CurrentUser()),
  __decorateParam(1, Param15("integrationId"))
], IntegrationsController.prototype, "connections", 1);
__decorateClass([
  Get16("admin/integrations/:integrationId/events"),
  UseGuards16(JwtAuthGuard),
  ApiBearerAuth16(),
  __decorateParam(0, CurrentUser()),
  __decorateParam(1, Param15("integrationId"))
], IntegrationsController.prototype, "events", 1);
__decorateClass([
  Post14("integrations/:provider/webhooks/:publicConnectionId"),
  __decorateParam(0, Param15("provider")),
  __decorateParam(1, Param15("publicConnectionId")),
  __decorateParam(2, Body14()),
  __decorateParam(3, Headers2())
], IntegrationsController.prototype, "receiveWebhook", 1);
IntegrationsController = __decorateClass([
  ApiTags16("Integrations"),
  Controller16("api/v1")
], IntegrationsController);

// src/modules/integrations/integration-credential.service.ts
import { Injectable as Injectable29, NotFoundException as NotFoundException15 } from "@nestjs/common";
import { createCipheriv as createCipheriv2, createDecipheriv as createDecipheriv2, createHash as createHash3, randomBytes as randomBytes2 } from "crypto";
import { v4 as uuidv415 } from "uuid";
var IntegrationCredentialService = class {
  storeCredential(organizationIntegrationId, credentialKey, value) {
    const iv = randomBytes2(12);
    const cipher = createCipheriv2("aes-256-gcm", this.encryptionKey(), iv);
    const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    const authTag = cipher.getAuthTag();
    const existing = dbStore.integrationCredentials.find(
      (item) => item.organizationIntegrationId === organizationIntegrationId && item.credentialKey === credentialKey
    );
    const credential = {
      ...existing || { id: uuidv415(), createdAt: /* @__PURE__ */ new Date() },
      organizationIntegrationId,
      credentialKey,
      encryptedValue: encrypted.toString("base64"),
      iv: iv.toString("base64"),
      authTag: authTag.toString("base64"),
      keyVersion: 1,
      updatedAt: /* @__PURE__ */ new Date()
    };
    if (existing) {
      Object.assign(existing, credential);
    } else {
      dbStore.integrationCredentials.push(credential);
    }
  }
  getCredential(organizationIntegrationId, credentialKey) {
    const credential = dbStore.integrationCredentials.find(
      (item) => item.organizationIntegrationId === organizationIntegrationId && item.credentialKey === credentialKey
    );
    if (!credential) {
      throw new NotFoundException15("Integration credential not found");
    }
    const decipher = createDecipheriv2(
      "aes-256-gcm",
      this.encryptionKey(),
      Buffer.from(credential.iv, "base64")
    );
    decipher.setAuthTag(Buffer.from(credential.authTag, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(credential.encryptedValue, "base64")),
      decipher.final()
    ]).toString("utf8");
  }
  encryptionKey() {
    return createHash3("sha256").update(process.env.INTEGRATION_CREDENTIAL_KEY || process.env.JWT_SECRET || "partneriq-development-integration-key").digest();
  }
};
IntegrationCredentialService = __decorateClass([
  Injectable29()
], IntegrationCredentialService);

// src/modules/integrations/integrations.service.ts
import { ForbiddenException as ForbiddenException6, Injectable as Injectable30, NotFoundException as NotFoundException16 } from "@nestjs/common";
import { createHash as createHash4 } from "crypto";
import { v4 as uuidv416 } from "uuid";

// src/modules/integrations/adapters/integration-adapter.ts
import { createHmac as createHmac4, timingSafeEqual } from "crypto";
var BaseIntegrationAdapter = class {
  verifyWebhookSignature(rawBody, headers, secret) {
    if (!secret) return false;
    const signature = String(headers["x-partneriq-signature"] || headers["stripe-signature"] || headers["paddle-signature"] || "");
    const expected = createHmac4("sha256", secret).update(rawBody).digest("hex");
    const received = signature.includes("=") ? signature.split("=").pop() || "" : signature;
    return this.safeCompare(expected, received);
  }
  normalizeWebhookEvent(payload) {
    return {
      externalEventId: String(payload?.id || payload?.event_id || `evt_${Date.now()}`),
      eventType: String(payload?.type || payload?.event_type || "unknown.event"),
      normalizedType: "integration.event.received",
      occurredAt: payload?.created ? new Date(Number(payload.created) * 1e3) : /* @__PURE__ */ new Date(),
      data: payload || {}
    };
  }
  safeCompare(expected, received) {
    if (!expected || !received) return false;
    const expectedBuffer = Buffer.from(expected);
    const receivedBuffer = Buffer.from(received);
    return expectedBuffer.length === receivedBuffer.length && timingSafeEqual(expectedBuffer, receivedBuffer);
  }
};

// src/modules/integrations/adapters/provider-adapters.ts
var StripeAdapter = class extends BaseIntegrationAdapter {
  constructor() {
    super(...arguments);
    this.code = "STRIPE";
    this.implementationStatus = "ACTIVE";
  }
  normalizeWebhookEvent(payload) {
    const type = String(payload?.type || "stripe.event");
    const normalizedMap = {
      "checkout.session.completed": "conversion.created",
      "invoice.paid": "subscription.payment_succeeded",
      "charge.refunded": "conversion.refunded",
      "charge.dispute.created": "conversion.disputed",
      "customer.subscription.deleted": "subscription.cancelled"
    };
    return {
      externalEventId: String(payload?.id || `stripe_${Date.now()}`),
      eventType: type,
      normalizedType: normalizedMap[type] || "integration.event.received",
      occurredAt: payload?.created ? new Date(Number(payload.created) * 1e3) : /* @__PURE__ */ new Date(),
      data: payload || {}
    };
  }
};
var PaddleAdapter = class extends BaseIntegrationAdapter {
  constructor() {
    super(...arguments);
    this.code = "PADDLE";
    this.implementationStatus = "ACTIVE";
  }
  normalizeWebhookEvent(payload) {
    const type = String(payload?.event_type || payload?.type || "paddle.event");
    const normalizedMap = {
      "transaction.completed": "conversion.created",
      "transaction.paid": "subscription.payment_succeeded",
      "adjustment.created": "conversion.refunded",
      "subscription.canceled": "subscription.cancelled"
    };
    return {
      externalEventId: String(payload?.event_id || payload?.id || `paddle_${Date.now()}`),
      eventType: type,
      normalizedType: normalizedMap[type] || "integration.event.received",
      occurredAt: payload?.occurred_at ? new Date(payload.occurred_at) : /* @__PURE__ */ new Date(),
      data: payload || {}
    };
  }
};
var BetaAdapter = class extends BaseIntegrationAdapter {
  constructor(code) {
    super();
    this.code = code;
    this.implementationStatus = "BETA";
  }
};
var ComingSoonAdapter = class extends BaseIntegrationAdapter {
  constructor(code) {
    super();
    this.code = code;
    this.implementationStatus = "COMING_SOON";
  }
};

// src/modules/integrations/adapters/registry.ts
var IntegrationAdapterRegistry = class {
  constructor() {
    this.adapters = /* @__PURE__ */ new Map();
    [
      new StripeAdapter(),
      new PaddleAdapter(),
      new BetaAdapter("CHARGEBEE"),
      new BetaAdapter("SHOPIFY"),
      new BetaAdapter("WOOCOMMERCE"),
      new BetaAdapter("HUBSPOT"),
      new ComingSoonAdapter("SALESFORCE"),
      new ComingSoonAdapter("ZAPIER"),
      new ComingSoonAdapter("SLACK"),
      new ComingSoonAdapter("SEGMENT"),
      new BetaAdapter("PARTNERIQ_API"),
      new BetaAdapter("PARTNERIQ_WEBHOOKS"),
      new BetaAdapter("PARTNERIQ_NODE_SDK"),
      new BetaAdapter("PARTNERIQ_BROWSER_SDK")
    ].forEach((adapter) => this.adapters.set(adapter.code, adapter));
  }
  get(code) {
    return this.adapters.get(code);
  }
  all() {
    return Array.from(this.adapters.values());
  }
};
var integrationAdapterRegistry = new IntegrationAdapterRegistry();

// src/modules/integrations/integrations.service.ts
var IntegrationsService = class {
  constructor(credentialService) {
    this.credentialService = credentialService;
  }
  listAdminIntegrations(user) {
    this.assertSuperAdmin(user);
    return this.integrationSummaries();
  }
  getMetrics(user) {
    this.assertSuperAdmin(user);
    return this.metricsFor(this.integrationSummaries());
  }
  getAdminIntegration(user, integrationId) {
    this.assertSuperAdmin(user);
    const integration = this.findIntegration(integrationId);
    return {
      ...this.summarizeIntegration(integration),
      connections: this.connectionsFor(integration.id),
      events: this.eventsFor(integration.id),
      adapterStatus: integrationAdapterRegistry.get(integration.code)?.implementationStatus || "COMING_SOON"
    };
  }
  updateStatus(user, integrationId, status) {
    this.assertSuperAdmin(user);
    const integration = this.findIntegration(integrationId);
    integration.status = status;
    integration.updatedAt = /* @__PURE__ */ new Date();
    dbStore.auditLogs.push({
      id: uuidv416(),
      organizationId: void 0,
      actorType: "USER",
      actorId: user.userId,
      action: "INTEGRATION_STATUS_UPDATED",
      resourceType: "integration",
      resourceId: integration.id,
      metadata: { code: integration.code, status },
      createdAt: /* @__PURE__ */ new Date()
    });
    return this.summarizeIntegration(integration);
  }
  connections(user, integrationId) {
    this.assertSuperAdmin(user);
    return this.connectionsFor(this.findIntegration(integrationId).id);
  }
  events(user, integrationId) {
    this.assertSuperAdmin(user);
    return this.eventsFor(this.findIntegration(integrationId).id);
  }
  receiveWebhook(code, publicConnectionId, body, headers) {
    const integration = dbStore.integrations.find((item) => item.code === code.toUpperCase());
    if (!integration) throw new NotFoundException16("Integration not found");
    const connection = dbStore.organizationIntegrations.find(
      (item) => item.publicId === publicConnectionId && item.integrationId === integration.id
    );
    if (!connection) throw new NotFoundException16("Integration connection not found");
    const rawBody = Buffer.from(JSON.stringify(body || {}));
    const adapter = integrationAdapterRegistry.get(integration.code);
    const startedAt = Date.now();
    let normalized = adapter?.normalizeWebhookEvent(body) || {
      externalEventId: `evt_${uuidv416()}`,
      eventType: "unknown.event",
      normalizedType: "integration.event.received",
      data: body || {}
    };
    const duplicate = dbStore.integrationEvents.find(
      (event2) => event2.organizationIntegrationId === connection.id && event2.externalEventId === normalized.externalEventId
    );
    if (duplicate) {
      duplicate.status = "DUPLICATE" /* DUPLICATE */;
      return { received: true, duplicate: true, eventId: duplicate.id };
    }
    let status = "PROCESSED" /* PROCESSED */;
    let error;
    try {
      const secret = this.safeCredential(connection.id, "webhook_secret");
      if (adapter && integration.supportsWebhooks && !adapter.verifyWebhookSignature(rawBody, headers, secret)) {
        status = "FAILED" /* FAILED */;
        error = "Webhook signature verification failed";
      }
    } catch {
      status = "FAILED" /* FAILED */;
      error = "Webhook secret is not configured";
    }
    const event = {
      id: uuidv416(),
      organizationId: connection.organizationId,
      integrationId: integration.id,
      organizationIntegrationId: connection.id,
      externalEventId: normalized.externalEventId,
      eventType: normalized.eventType,
      normalizedType: normalized.normalizedType,
      payloadHash: createHash4("sha256").update(rawBody).digest("hex"),
      payloadReference: void 0,
      status,
      processingMs: Date.now() - startedAt,
      error,
      metadata: { adapter: adapter?.implementationStatus || "COMING_SOON" },
      createdAt: /* @__PURE__ */ new Date(),
      updatedAt: /* @__PURE__ */ new Date()
    };
    dbStore.integrationEvents.push(event);
    connection.lastWebhookAt = /* @__PURE__ */ new Date();
    connection.lastError = error;
    connection.status = error ? "ERROR" /* ERROR */ : "CONNECTED" /* CONNECTED */;
    return { received: true, eventId: event.id, status };
  }
  integrationSummaries() {
    return [...dbStore.integrations].sort((a, b) => a.displayOrder - b.displayOrder || a.name.localeCompare(b.name)).map((integration) => this.summarizeIntegration(integration));
  }
  metricsFor(integrations = this.integrationSummaries()) {
    return {
      totalIntegrations: integrations.length,
      activeIntegrations: integrations.filter((item) => item.status === "ACTIVE" /* ACTIVE */).length,
      betaIntegrations: integrations.filter((item) => item.status === "BETA" /* BETA */).length,
      comingSoonIntegrations: integrations.filter((item) => item.status === "COMING_SOON" /* COMING_SOON */).length,
      connectedOrganizations: integrations.reduce((total, item) => total + item.connectedOrganizations, 0),
      healthyConnections: integrations.reduce((total, item) => total + item.healthyConnections, 0),
      degradedConnections: integrations.reduce((total, item) => total + item.degradedConnections, 0),
      failedConnections: integrations.reduce((total, item) => total + item.failedConnections, 0),
      eventsToday: integrations.reduce((total, item) => total + item.eventsToday, 0)
    };
  }
  summarizeIntegration(integration) {
    const connections = dbStore.organizationIntegrations.filter((item) => item.integrationId === integration.id);
    const events = dbStore.integrationEvents.filter((item) => item.integrationId === integration.id);
    const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    const processed = events.filter((event) => event.status === "PROCESSED" /* PROCESSED */).length;
    const failed = events.filter((event) => event.status === "FAILED" /* FAILED */).length;
    const total = processed + failed;
    return {
      id: integration.id,
      code: integration.code,
      name: integration.name,
      slug: integration.slug,
      description: integration.description,
      category: integration.category,
      provider: integration.provider,
      status: integration.status,
      connectionTypes: integration.connectionTypes || [],
      supportsOAuth: integration.supportsOAuth,
      supportsWebhooks: integration.supportsWebhooks,
      supportsApiKey: integration.supportsApiKey,
      documentationUrl: integration.documentationUrl,
      iconKey: integration.iconKey,
      displayOrder: integration.displayOrder,
      connectedOrganizations: connections.length,
      healthyConnections: connections.filter((item) => item.status === "CONNECTED" /* CONNECTED */).length,
      degradedConnections: connections.filter((item) => item.status === "REAUTH_REQUIRED" /* REAUTH_REQUIRED */ || item.status === "PENDING" /* PENDING */).length,
      failedConnections: connections.filter((item) => item.status === "ERROR" /* ERROR */).length,
      eventsToday: events.filter((event) => new Date(event.createdAt).toISOString().slice(0, 10) === today).length,
      successRate: total === 0 ? 100 : Math.round(processed / total * 1e3) / 10,
      avgProcessingMs: events.length === 0 ? 0 : Math.round(events.reduce((sum, event) => sum + Number(event.processingMs || 0), 0) / events.length),
      webhookSuccessRate: total === 0 ? 100 : Math.round(processed / total * 1e3) / 10
    };
  }
  connectionsFor(integrationId) {
    return dbStore.organizationIntegrations.filter((item) => item.integrationId === integrationId).map((connection) => ({
      id: connection.id,
      organizationId: connection.organizationId,
      orgName: dbStore.organizations.find((org) => org.id === connection.organizationId)?.name || "Unknown Organization",
      status: connection.status,
      environment: connection.environment,
      connectedAt: this.dateTime(connection.connectedAt),
      lastSyncAt: this.dateTime(connection.lastSyncAt),
      lastWebhookAt: this.dateTime(connection.lastWebhookAt),
      lastError: connection.lastError,
      publicId: connection.publicId
    }));
  }
  eventsFor(integrationId) {
    return dbStore.integrationEvents.filter((item) => item.integrationId === integrationId).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).map((event) => ({
      id: event.id,
      orgName: dbStore.organizations.find((org) => org.id === event.organizationId)?.name || "Unknown Organization",
      externalEventId: event.externalEventId,
      eventType: event.eventType,
      normalizedType: event.normalizedType || "integration.event.received",
      status: event.status,
      processingMs: event.processingMs,
      error: event.error,
      createdAt: this.dateTime(event.createdAt)
    }));
  }
  findIntegration(integrationId) {
    const integration = dbStore.integrations.find(
      (item) => item.id === integrationId || item.slug === integrationId || item.code === integrationId.toUpperCase()
    );
    if (!integration) throw new NotFoundException16("Integration not found");
    return integration;
  }
  safeCredential(connectionId, key) {
    try {
      return this.credentialService.getCredential(connectionId, key);
    } catch {
      return void 0;
    }
  }
  assertSuperAdmin(user) {
    if (!user.isSuperAdmin && user.platformRole !== "SUPER_ADMIN" /* SUPER_ADMIN */) {
      throw new ForbiddenException6("Super admin access is required");
    }
  }
  dateTime(value) {
    return value ? new Date(value).toISOString().replace("T", " ").slice(0, 19) : "";
  }
};
IntegrationsService = __decorateClass([
  Injectable30()
], IntegrationsService);

// src/modules/integrations/integrations.module.ts
var IntegrationsModule = class {
};
IntegrationsModule = __decorateClass([
  Module16({
    controllers: [IntegrationsController],
    providers: [IntegrationsService, IntegrationCredentialService],
    exports: [IntegrationsService]
  })
], IntegrationsModule);

// src/AppModule.ts
var AppModule = class {
};
AppModule = __decorateClass([
  Module17({
    imports: [
      AuthModule,
      OrganizationsModule,
      MembershipsModule,
      ProgramsModule,
      AffiliatesModule,
      TrackingModule,
      ApiKeysModule,
      ConversionsModule,
      CommissionsModule,
      FraudModule,
      LedgerModule,
      PayoutsModule,
      WebhooksModule,
      AuditModule,
      AdminModule,
      IntegrationsModule
    ]
  })
], AppModule);

// src/vercel-handler.ts
var cachedHandler;
async function handler(req, res) {
  if (!cachedHandler) {
    const app = await NestFactory.create(AppModule, { cors: true });
    app.enableCors({
      origin: process.env.CORS_ORIGINS?.split(",") || [],
      credentials: true
    });
    await app.init();
    const expressApp = app.getHttpAdapter().getInstance();
    cachedHandler = serverless(expressApp);
  }
  return cachedHandler(req, res);
}
export {
  handler as default
};
//# sourceMappingURL=index.js.map
