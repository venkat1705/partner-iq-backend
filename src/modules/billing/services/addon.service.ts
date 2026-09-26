import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { dbStore, BillingAddonEntity, BillingAddonPurchaseEntity, awaitPersist } from '../../../database/store';
import { AppDataSource } from '../../../database/data-source';
import { BillingAddon } from '../../../database/schema';
import { AuditAction } from '../../../common/enums';
import {
  BillingAddonPurchaseStatus,
  BillingInterval,
  BillingResourceType,
  PaymentProviderType,
} from '../enums/billing.enums';
import {
  ADDON_CATALOG,
  PLAN_CATALOG_CURRENCY,
  PLAN_CATALOG_SEED_VERSION,
  addonUnitPriceFor,
} from '../config/plan-catalog';
import { PurchaseAddonDto, PreviewAddonDto, UpdateAddonQuantityDto } from '../dto/addon.dto';
import { BillingAccountService } from './billing-account.service';
import { SubscriptionLimitService } from './subscription-limit.service';
import { BillingTaxService } from './billing-tax.service';
import { PaymentProviderFactory } from '../providers/payment-provider.factory';
import { PaymentProviderRouter } from '../providers/payment-provider.router';
import { RazorpayProvider } from '../providers/razorpay.provider';

const ADDON_SEED_SETTING_KEY = 'billing.addonCatalog.seedVersion';

export interface AddonLineItem {
  addonId: string;
  addonCode: string;
  addonName: string;
  resourceType: BillingResourceType;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  unitsGranted: number;
}

export interface AddonQuote {
  accountId: string;
  currency: string;
  billingInterval: BillingInterval;
  basePlanCode: string;
  basePlanName: string;
  /** Recurring price of the base plan alone. */
  basePriceMinor: number;
  /** Add-ons the account already pays for, before this purchase. */
  existingAddonsMinor: number;
  /** The add-ons being bought right now. */
  newAddonsMinor: number;
  lines: AddonLineItem[];
  subtotalMinor: number;
  taxMinor: number;
  taxLabel: string;
  totalMinor: number;
  /** What the account is charged immediately to activate this capacity. */
  dueNowSubtotalMinor: number;
  dueNowTaxMinor: number;
  dueNowTotalMinor: number;
  capacity: Array<{
    resourceType: BillingResourceType;
    currentUsage: number;
    currentEffectiveLimit: number | null;
    newEffectiveLimit: number | null;
    unitsAdded: number;
  }>;
}

/**
 * Add-on catalog, server-side pricing, and recurring add-on purchases.
 *
 * PartnerIQ keeps **one** base subscription per account and attaches recurring
 * add-on charges to it, rather than opening a separate provider subscription
 * per add-on. Capacity is granted only once a purchase reaches ACTIVE, which
 * happens on verified payment or on the provider webhook — never at checkout
 * time and never from anything the frontend sends.
 *
 * Every price in this service comes from the database catalog. Quantities are
 * the only number a client may choose.
 */
@Injectable()
export class AddonService {
  private readonly logger = new Logger(AddonService.name);
  private readonly router = new PaymentProviderRouter();
  private seeded = false;

  constructor(
    private readonly accounts: BillingAccountService,
    private readonly limits: SubscriptionLimitService,
    private readonly tax: BillingTaxService,
    private readonly providerFactory: PaymentProviderFactory,
    private readonly razorpayProvider: RazorpayProvider,
  ) {}

  // ---------------------------------------------------------------------
  // Catalog
  // ---------------------------------------------------------------------

  /**
   * Writes the default add-on catalog on first boot. Existing rows are left
   * alone unless the seed version changed, so admin price edits survive
   * restarts.
   */
  async ensureDefaultAddons() {
    const setting = dbStore.platformSettings.find((item) => item.key === ADDON_SEED_SETTING_KEY);
    const seedVersionMatches = setting?.value === PLAN_CATALOG_SEED_VERSION;
    if (this.seeded && seedVersionMatches) return;

    const repo = AppDataSource.isInitialized ? AppDataSource.getRepository(BillingAddon) : null;

    for (const interval of [BillingInterval.MONTHLY, BillingInterval.YEARLY]) {
      for (const seed of ADDON_CATALOG) {
        const unitPrice = addonUnitPriceFor(seed, interval);
        let addon = dbStore.billingAddons.find(
          (item) =>
            item.code === seed.code &&
            item.billingInterval === interval &&
            item.currency === PLAN_CATALOG_CURRENCY,
        );

        if (addon) {
          if (!seedVersionMatches) {
            addon.name = seed.name;
            addon.description = seed.description;
            addon.resourceType = seed.resourceType;
            addon.unitPrice = unitPrice;
            addon.unitsPerQuantity = seed.unitsPerQuantity;
            addon.minQuantity = seed.minQuantity;
            addon.maxQuantity = seed.maxQuantity;
            addon.isActive = true;
            addon.sortOrder = seed.sortOrder;
            addon.rowStatus = 'ACTIVE';
            addon.modifiedDate = new Date();
            await awaitPersist(addon);
          }
          continue;
        }

        addon = {
          id: uuidv4(),
          code: seed.code,
          name: seed.name,
          description: seed.description,
          resourceType: seed.resourceType,
          unitPrice,
          currency: PLAN_CATALOG_CURRENCY,
          billingInterval: interval,
          unitsPerQuantity: seed.unitsPerQuantity,
          minQuantity: seed.minQuantity,
          maxQuantity: seed.maxQuantity,
          isActive: true,
          sortOrder: seed.sortOrder,
          rowStatus: 'ACTIVE',
          createdDate: new Date(),
          modifiedDate: new Date(),
        } as BillingAddonEntity;

        if (repo) {
          const existing = await repo.findOne({
            where: {
              code: addon.code,
              billingInterval: addon.billingInterval,
              currency: addon.currency,
            } as any,
          });
          if (existing) {
            Object.assign(existing, addon, { id: existing.id });
            addon = (await repo.save(existing)) as BillingAddonEntity;
          }
        }

        if (!dbStore.billingAddons.some((item) => item.id === addon!.id)) {
          dbStore.billingAddons.push(addon);
          await awaitPersist(addon);
        }
      }
    }

    await this.recordSeedVersion();
    this.seeded = true;
  }

  async listAddons(billingInterval?: BillingInterval) {
    await this.ensureDefaultAddons();
    return dbStore.billingAddons
      .filter(
        (item) =>
          item.isActive &&
          item.rowStatus === 'ACTIVE' &&
          (!billingInterval || item.billingInterval === billingInterval),
      )
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }

  async getAddon(addonId: string) {
    await this.ensureDefaultAddons();
    const addon = dbStore.billingAddons.find(
      (item) => item.id === addonId && item.rowStatus === 'ACTIVE',
    );
    if (!addon) {
      throw new NotFoundException({ code: 'ADDON_NOT_FOUND', message: 'Add-on was not found.' });
    }
    return addon;
  }

  // ---------------------------------------------------------------------
  // Purchases (reads)
  // ---------------------------------------------------------------------

  async listPurchases(accountId: string) {
    await this.ensureDefaultAddons();
    this.expireLapsedPurchases(accountId);
    return dbStore.billingAddonPurchases
      .filter((item) => item.accountId === accountId && item.rowStatus === 'ACTIVE')
      .map((item) => this.serializePurchase(item))
      .sort((a, b) => new Date(b.createdDate).getTime() - new Date(a.createdDate).getTime());
  }

  /** Base plan + active add-ons + tax: what the account pays each cycle. */
  async getRecurringSummary(accountId: string) {
    await this.ensureDefaultAddons();
    this.expireLapsedPurchases(accountId);

    const { subscription, plan } = await this.limits.resolveEntitlement(accountId);
    const interval = (subscription?.billingInterval as BillingInterval) || BillingInterval.MONTHLY;
    const basePriceMinor = plan?.price ?? 0;

    const activePurchases = dbStore.billingAddonPurchases.filter(
      (item) =>
        item.accountId === accountId &&
        item.rowStatus === 'ACTIVE' &&
        (item.status === BillingAddonPurchaseStatus.ACTIVE ||
          item.status === BillingAddonPurchaseStatus.CANCEL_PENDING),
    );

    const lines: AddonLineItem[] = activePurchases.map((purchase) => {
      const addon = dbStore.billingAddons.find((item) => item.id === purchase.addonId);
      return {
        addonId: purchase.addonId,
        addonCode: addon?.code ?? 'UNKNOWN',
        addonName: addon?.name ?? 'Add-on',
        resourceType: purchase.resourceType as BillingResourceType,
        quantity: purchase.quantity,
        unitPrice: purchase.unitPriceSnapshot,
        lineTotal: purchase.unitPriceSnapshot * purchase.quantity,
        unitsGranted: purchase.quantity * (addon?.unitsPerQuantity ?? 1),
      };
    });

    const addonsMinor = lines.reduce((sum, line) => sum + line.lineTotal, 0);
    const subtotalMinor = basePriceMinor + addonsMinor;
    const { taxMinor, label } = this.tax.calculate(subtotalMinor);

    return {
      accountId,
      currency: plan?.currency || PLAN_CATALOG_CURRENCY,
      billingInterval: interval,
      planCode: plan?.code ?? 'NONE',
      planName: plan?.name ?? 'No plan',
      basePriceMinor,
      addonsMinor,
      subtotalMinor,
      taxMinor,
      taxLabel: label,
      totalMinor: subtotalMinor + taxMinor,
      lines,
      nextBillingDate: subscription?.nextBillingDate ?? subscription?.currentPeriodEnd ?? null,
    };
  }

  // ---------------------------------------------------------------------
  // Preview
  // ---------------------------------------------------------------------

  /**
   * Prices a prospective add-on purchase entirely server-side and shows the
   * resulting capacity. Nothing is persisted.
   */
  async preview(accountId: string, dto: PreviewAddonDto): Promise<AddonQuote> {
    await this.ensureDefaultAddons();
    const items = this.normalizeItems(dto.items);
    const { subscription, plan, entitled } = await this.limits.resolveEntitlement(accountId);

    if (!plan || !entitled) {
      throw new BadRequestException({
        code: 'SUBSCRIPTION_REQUIRED',
        message: 'An active subscription is required before buying additional capacity.',
      });
    }

    const interval = (subscription?.billingInterval as BillingInterval) || BillingInterval.MONTHLY;
    const currentLimits = await this.limits.getEffectiveLimits(accountId);
    const existing = await this.getRecurringSummary(accountId);

    const lines: AddonLineItem[] = [];
    const unitsByResource: Record<string, number> = {};

    for (const item of items) {
      const addon = await this.getAddon(item.addonId);
      if (!addon.isActive) {
        throw new BadRequestException({
          code: 'ADDON_INACTIVE',
          message: `${addon.name} is no longer available.`,
        });
      }
      if (addon.currency !== plan.currency) {
        throw new BadRequestException({
          code: 'ADDON_CURRENCY_MISMATCH',
          message: 'This add-on is not available in your subscription currency.',
        });
      }
      if (addon.billingInterval !== interval) {
        throw new BadRequestException({
          code: 'ADDON_INTERVAL_MISMATCH',
          message: `Choose the ${interval.toLowerCase()} version of this add-on to match your billing cycle.`,
        });
      }
      if (item.quantity < addon.minQuantity) {
        throw new BadRequestException({
          code: 'ADDON_QUANTITY_TOO_LOW',
          message: `Minimum quantity for ${addon.name} is ${addon.minQuantity}.`,
        });
      }
      if (addon.maxQuantity && item.quantity > addon.maxQuantity) {
        throw new BadRequestException({
          code: 'ADDON_QUANTITY_TOO_HIGH',
          message: `Maximum quantity for ${addon.name} is ${addon.maxQuantity}.`,
        });
      }

      const resourceType = addon.resourceType as BillingResourceType;
      const limit = currentLimits.limits[resourceType];
      if (!limit) {
        throw new BadRequestException({
          code: 'ADDON_RESOURCE_UNKNOWN',
          message: 'This add-on does not map to a metered resource.',
        });
      }
      if (limit.unlimited) {
        throw new BadRequestException({
          code: 'ADDON_NOT_NEEDED',
          message: `Your ${plan.name} plan already includes unlimited ${resourceType.toLowerCase()}s.`,
        });
      }
      if (!limit.canPurchaseAddon) {
        throw new BadRequestException({
          code: 'ADDON_NOT_AVAILABLE_ON_PLAN',
          message: `Additional ${resourceType.toLowerCase()} capacity cannot be purchased on the ${plan.name} plan.`,
        });
      }

      // Price is always the catalog price — anything the client sent is ignored.
      const unitsGranted = item.quantity * addon.unitsPerQuantity;
      unitsByResource[resourceType] = (unitsByResource[resourceType] || 0) + unitsGranted;
      lines.push({
        addonId: addon.id,
        addonCode: addon.code,
        addonName: addon.name,
        resourceType,
        quantity: item.quantity,
        unitPrice: addon.unitPrice,
        lineTotal: addon.unitPrice * item.quantity,
        unitsGranted,
      });
    }

    const newAddonsMinor = lines.reduce((sum, line) => sum + line.lineTotal, 0);
    const subtotalMinor = existing.subtotalMinor + newAddonsMinor;
    const { taxMinor, label } = this.tax.calculate(subtotalMinor);
    const dueNow = this.tax.calculate(newAddonsMinor);

    const capacity = Object.entries(unitsByResource).map(([resourceType, unitsAdded]) => {
      const limit = currentLimits.limits[resourceType as BillingResourceType];
      return {
        resourceType: resourceType as BillingResourceType,
        currentUsage: limit.currentUsage,
        currentEffectiveLimit: limit.effectiveLimit,
        newEffectiveLimit: limit.effectiveLimit === null ? null : limit.effectiveLimit + unitsAdded,
        unitsAdded,
      };
    });

    return {
      accountId,
      currency: plan.currency,
      billingInterval: interval,
      basePlanCode: plan.code,
      basePlanName: plan.name,
      basePriceMinor: existing.basePriceMinor,
      existingAddonsMinor: existing.addonsMinor,
      newAddonsMinor,
      lines,
      subtotalMinor,
      taxMinor,
      taxLabel: label,
      totalMinor: subtotalMinor + taxMinor,
      dueNowSubtotalMinor: newAddonsMinor,
      dueNowTaxMinor: dueNow.taxMinor,
      dueNowTotalMinor: newAddonsMinor + dueNow.taxMinor,
      capacity,
    };
  }

  // ---------------------------------------------------------------------
  // Purchase
  // ---------------------------------------------------------------------

  /**
   * Creates PENDING add-on purchases and a provider order for the amount due
   * now. Capacity is *not* granted here — {@link activatePurchases} does that
   * once payment is confirmed.
   */
  async purchase(
    accountId: string,
    organizationId: string,
    userId: string,
    dto: PurchaseAddonDto,
    idempotencyKey?: string,
  ) {
    const quote = await this.preview(accountId, dto);

    const requestHash = crypto
      .createHash('sha256')
      .update(JSON.stringify({ accountId, items: this.normalizeItems(dto.items) }))
      .digest('hex');

    if (idempotencyKey) {
      const existing = dbStore.idempotencyKeys.find(
        (item) => item.organizationId === organizationId && item.key === idempotencyKey,
      );
      if (existing) {
        if (existing.requestHash !== requestHash) {
          throw new BadRequestException({
            code: 'IDEMPOTENCY_KEY_REUSED',
            message: 'Idempotency key was reused with a different request.',
          });
        }
        return existing.responseBody;
      }
    }

    const { subscription, plan } = await this.limits.resolveEntitlement(accountId);
    const org = dbStore.organizations.find((item) => item.id === organizationId);
    const providerType = this.router.resolve({
      country: org?.country,
      currency: quote.currency,
      paymentType: 'SUBSCRIPTION',
    });
    const provider = this.providerFactory.getProvider(providerType);

    const now = new Date();
    const purchases: BillingAddonPurchaseEntity[] = quote.lines.map((line) => ({
      id: uuidv4(),
      accountId,
      subscriptionId: subscription?.id,
      addonId: line.addonId,
      resourceType: line.resourceType,
      quantity: line.quantity,
      unitPriceSnapshot: line.unitPrice,
      currency: quote.currency,
      billingInterval: quote.billingInterval,
      status: BillingAddonPurchaseStatus.PENDING,
      startDate: undefined,
      endDate: undefined,
      idempotencyKey: idempotencyKey || requestHash,
      metadata: { organizationId, planCode: plan?.code },
      createdBy: userId,
      modifiedBy: userId,
      rowStatus: 'ACTIVE',
      createdDate: now,
      modifiedDate: now,
    })) as BillingAddonPurchaseEntity[];

    purchases.forEach((purchase) => dbStore.billingAddonPurchases.push(purchase));
    await Promise.all(purchases.map((purchase) => awaitPersist(purchase)));

    // Charge only the new capacity now; the recurring total takes effect from
    // the next cycle, which is what the quote's `totalMinor` reflects.
    const order = await provider.createOrder({
      amount: quote.dueNowTotalMinor,
      currency: quote.currency,
      receipt: `addon_${accountId.slice(0, 8)}_${Date.now()}`,
      notes: {
        accountId,
        organizationId,
        purchaseIds: purchases.map((item) => item.id).join(','),
        kind: 'ADDON',
      },
    });

    purchases.forEach((purchase) => {
      purchase.providerOrderId = order.id;
      purchase.modifiedDate = new Date();
    });
    await Promise.all(purchases.map((purchase) => awaitPersist(purchase)));

    this.audit(organizationId, userId, 'BILLING_ADDON_PURCHASE_INITIATED', accountId, {
      purchaseIds: purchases.map((item) => item.id),
      lines: quote.lines.map((line) => ({
        addonCode: line.addonCode,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
      })),
      dueNowTotalMinor: quote.dueNowTotalMinor,
    });

    const response = {
      provider: providerType,
      quote,
      purchases: purchases.map((item) => this.serializePurchase(item)),
      checkout: {
        key:
          providerType === PaymentProviderType.RAZORPAY
            ? this.razorpayProvider.getCheckoutKey()
            : '',
        orderId: order.id,
        amount: quote.dueNowTotalMinor,
        currency: quote.currency,
        name: 'PartnerIQ',
        description: quote.lines
          .map((line) => `${line.quantity} x ${line.addonName}`)
          .join(', '),
        notes: { accountId, organizationId, kind: 'ADDON' },
      },
    };

    if (idempotencyKey) {
      const ikRecord = {
        id: uuidv4(),
        organizationId,
        key: idempotencyKey,
        requestHash,
        responseStatus: 200,
        responseBody: response,
        expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
        createdAt: new Date(),
      } as any;
      dbStore.idempotencyKeys.push(ikRecord);
      await awaitPersist(ikRecord);
    }

    return response;
  }

  /**
   * Grants the capacity for every PENDING purchase on an order. Idempotent —
   * re-delivered webhooks and a verify-then-webhook sequence both land here and
   * the second call is a no-op, so capacity is never double-granted.
   */
  async activatePurchases(match: {
    providerOrderId?: string;
    providerPaymentId?: string;
    purchaseIds?: string[];
  }) {
    const candidates = dbStore.billingAddonPurchases.filter((purchase) => {
      if (purchase.rowStatus !== 'ACTIVE') return false;
      if (match.purchaseIds?.length) return match.purchaseIds.includes(purchase.id);
      if (match.providerOrderId) return purchase.providerOrderId === match.providerOrderId;
      return false;
    });

    const activated: BillingAddonPurchaseEntity[] = [];
    for (const purchase of candidates) {
      if (purchase.status === BillingAddonPurchaseStatus.ACTIVE) continue;
      if (purchase.status !== BillingAddonPurchaseStatus.PENDING) continue;
      purchase.status = BillingAddonPurchaseStatus.ACTIVE;
      purchase.startDate = purchase.startDate || new Date();
      purchase.endDate = undefined;
      if (match.providerPaymentId) purchase.providerPaymentId = match.providerPaymentId;
      purchase.modifiedDate = new Date();
      activated.push(purchase);
    }

    await Promise.all(activated.map((purchase) => awaitPersist(purchase)));

    if (activated.length) {
      this.logger.log(
        `Activated ${activated.length} add-on purchase(s) for account ${activated[0].accountId}.`,
      );
    }
    return activated.map((item) => this.serializePurchase(item));
  }

  /** Marks PENDING purchases on a failed order as FAILED so they never grant capacity. */
  async failPurchases(providerOrderId: string) {
    const failed = dbStore.billingAddonPurchases.filter(
      (purchase) =>
        purchase.providerOrderId === providerOrderId &&
        purchase.status === BillingAddonPurchaseStatus.PENDING,
    );
    failed.forEach((purchase) => {
      purchase.status = BillingAddonPurchaseStatus.FAILED;
      purchase.modifiedDate = new Date();
    });
    await Promise.all(failed.map((purchase) => awaitPersist(purchase)));
    return failed.length;
  }

  // ---------------------------------------------------------------------
  // Change / cancel
  // ---------------------------------------------------------------------

  /**
   * Reduces an add-on's quantity. Increases must go through {@link purchase}
   * so the extra capacity is paid for before it is granted.
   */
  async updateQuantity(
    accountId: string,
    purchaseId: string,
    organizationId: string,
    userId: string,
    dto: UpdateAddonQuantityDto,
  ) {
    const purchase = this.requirePurchase(accountId, purchaseId);
    if (dto.quantity > purchase.quantity) {
      throw new BadRequestException({
        code: 'ADDON_INCREASE_REQUIRES_PURCHASE',
        message: 'Buy additional capacity through the add-on checkout so it can be charged.',
      });
    }
    if (dto.quantity < 0) {
      throw new BadRequestException({ code: 'INVALID_QUANTITY', message: 'Quantity cannot be negative.' });
    }

    const addon = dbStore.billingAddons.find((item) => item.id === purchase.addonId);
    const unitsPer = addon?.unitsPerQuantity ?? 1;
    const unitsRemoved = (purchase.quantity - dto.quantity) * unitsPer;

    // Releasing capacity the account is already using would leave it silently
    // over its limit, so the reduction is refused rather than applied.
    const limits = await this.limits.getEffectiveLimits(accountId);
    const limit = limits.limits[purchase.resourceType as BillingResourceType];
    if (limit && limit.effectiveLimit !== null && limit.currentUsage > limit.effectiveLimit - unitsRemoved) {
      throw new BadRequestException({
        code: 'ADDON_IN_USE',
        message: `You are using ${limit.currentUsage} of ${limit.effectiveLimit} ${purchase.resourceType.toLowerCase()}s. Reduce usage to ${
          limit.effectiveLimit - unitsRemoved
        } before releasing this capacity. Nothing has been deleted.`,
        details: { resource: purchase.resourceType, currentUsage: limit.currentUsage },
      });
    }

    const previousQuantity = purchase.quantity;
    purchase.quantity = dto.quantity;
    purchase.modifiedBy = userId;
    purchase.modifiedDate = new Date();
    if (dto.quantity === 0) {
      purchase.status = BillingAddonPurchaseStatus.CANCELLED;
      purchase.endDate = new Date();
    }

    this.audit(organizationId, userId, 'BILLING_ADDON_QUANTITY_CHANGED', accountId, {
      purchaseId,
      previousQuantity,
      quantity: dto.quantity,
    });

    await awaitPersist(purchase);
    return this.serializePurchase(purchase);
  }

  /**
   * Cancels an add-on at the end of the paid period. Capacity keeps working
   * until then and no customer data is touched.
   */
  async cancelPurchase(
    accountId: string,
    purchaseId: string,
    organizationId: string,
    userId: string,
    immediate = false,
  ) {
    const purchase = this.requirePurchase(accountId, purchaseId);
    const { subscription } = await this.limits.resolveEntitlement(accountId);

    if (immediate) {
      const limits = await this.limits.getEffectiveLimits(accountId);
      const limit = limits.limits[purchase.resourceType as BillingResourceType];
      const addon = dbStore.billingAddons.find((item) => item.id === purchase.addonId);
      const unitsRemoved = purchase.quantity * (addon?.unitsPerQuantity ?? 1);
      if (limit && limit.effectiveLimit !== null && limit.currentUsage > limit.effectiveLimit - unitsRemoved) {
        throw new BadRequestException({
          code: 'ADDON_IN_USE',
          message: `Releasing this capacity now would put you over your ${purchase.resourceType.toLowerCase()} limit. Reduce usage first, or cancel at the end of the period instead.`,
        });
      }
      purchase.status = BillingAddonPurchaseStatus.CANCELLED;
      purchase.endDate = new Date();
    } else {
      purchase.status = BillingAddonPurchaseStatus.CANCEL_PENDING;
      purchase.endDate =
        subscription?.currentPeriodEnd || new Date(Date.now() + 30 * 24 * 3600 * 1000);
    }

    purchase.modifiedBy = userId;
    purchase.modifiedDate = new Date();

    this.audit(organizationId, userId, 'BILLING_ADDON_CANCELLED', accountId, {
      purchaseId,
      immediate,
      endDate: purchase.endDate,
    });

    await awaitPersist(purchase);
    return this.serializePurchase(purchase);
  }

  /** Flips CANCEL_PENDING add-ons to CANCELLED once their end date has passed. */
  expireLapsedPurchases(accountId?: string) {
    const now = Date.now();
    dbStore.billingAddonPurchases
      .filter(
        (purchase) =>
          (!accountId || purchase.accountId === accountId) &&
          purchase.status === BillingAddonPurchaseStatus.CANCEL_PENDING &&
          purchase.endDate &&
          new Date(purchase.endDate).getTime() <= now,
      )
      .forEach((purchase) => {
        purchase.status = BillingAddonPurchaseStatus.CANCELLED;
        purchase.modifiedDate = new Date();
        void awaitPersist(purchase);
      });
  }

  // ---------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------

  private requirePurchase(accountId: string, purchaseId: string) {
    const purchase = dbStore.billingAddonPurchases.find(
      (item) => item.id === purchaseId && item.rowStatus === 'ACTIVE',
    );
    if (!purchase) {
      throw new NotFoundException({
        code: 'ADDON_PURCHASE_NOT_FOUND',
        message: 'Add-on purchase was not found.',
      });
    }
    // Tenant isolation: an admin of one account must never touch another's.
    if (purchase.accountId !== accountId) {
      throw new ForbiddenException({
        code: 'ADDON_PURCHASE_FORBIDDEN',
        message: 'This add-on belongs to a different account.',
      });
    }
    return purchase;
  }

  private normalizeItems(items: PurchaseAddonDto['items']) {
    if (!items?.length) {
      throw new BadRequestException({
        code: 'ADDON_ITEMS_REQUIRED',
        message: 'Select at least one add-on.',
      });
    }
    // Collapse duplicates so a client sending the same add-on twice is charged
    // once for the combined quantity.
    const merged = new Map<string, number>();
    for (const item of items) {
      const quantity = Math.trunc(Number(item.quantity));
      if (!Number.isFinite(quantity) || quantity <= 0) {
        throw new BadRequestException({
          code: 'INVALID_QUANTITY',
          message: 'Add-on quantity must be a positive whole number.',
        });
      }
      merged.set(item.addonId, (merged.get(item.addonId) || 0) + quantity);
    }
    return [...merged.entries()].map(([addonId, quantity]) => ({ addonId, quantity }));
  }

  private serializePurchase(purchase: BillingAddonPurchaseEntity) {
    const addon = dbStore.billingAddons.find((item) => item.id === purchase.addonId);
    return {
      id: purchase.id,
      accountId: purchase.accountId,
      subscriptionId: purchase.subscriptionId ?? null,
      addonId: purchase.addonId,
      addonCode: addon?.code ?? null,
      addonName: addon?.name ?? 'Add-on',
      resourceType: purchase.resourceType,
      quantity: purchase.quantity,
      unitsGranted: purchase.quantity * (addon?.unitsPerQuantity ?? 1),
      unitPrice: purchase.unitPriceSnapshot,
      lineTotal: purchase.unitPriceSnapshot * purchase.quantity,
      currency: purchase.currency,
      billingInterval: purchase.billingInterval,
      status: purchase.status,
      startDate: purchase.startDate ?? null,
      endDate: purchase.endDate ?? null,
      createdDate: purchase.createdDate,
    };
  }

  private async recordSeedVersion() {
    let setting = dbStore.platformSettings.find((item) => item.key === ADDON_SEED_SETTING_KEY);
    if (!setting) {
      const newSetting = {
        id: uuidv4(),
        key: ADDON_SEED_SETTING_KEY,
        value: PLAN_CATALOG_SEED_VERSION,
        description: 'Seed version of the PartnerIQ add-on catalog',
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any;
      dbStore.platformSettings.push(newSetting);
      await awaitPersist(newSetting);
    } else if (setting.value !== PLAN_CATALOG_SEED_VERSION) {
      setting.value = PLAN_CATALOG_SEED_VERSION;
      setting.updatedAt = new Date();
      await awaitPersist(setting);
    }
  }

  private audit(
    organizationId: string | undefined,
    actorId: string,
    action: string,
    resourceId: string,
    metadata?: any,
  ) {
    dbStore.auditLogs.push({
      id: uuidv4(),
      organizationId,
      actorType: 'USER',
      actorId,
      action: action as AuditAction,
      resourceType: 'billing_addon_purchase',
      resourceId,
      metadata,
      createdAt: new Date(),
    } as any);
  }
}
