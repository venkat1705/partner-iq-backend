import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { dbStore } from '../../database/store';
import { NotificationGateway } from './notifications.gateway';
import type {
  NotificationCategory,
  NotificationPreference,
  NotificationRecord,
} from './notifications.types';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(private readonly gateway: NotificationGateway) {}

  private defaultPreferences(userId: string, organizationId?: string): NotificationPreference {
    return {
      id: uuidv4(),
      userId,
      organizationId,
      enabled: true,
      channels: {
        in_app: true,
        email: true,
        sms: false,
        push: true,
      },
      categories: {
        system: true,
        fraud: true,
        payout: true,
        commission: true,
        program: true,
        team: true,
        security: true,
      },
    };
  }

  async listForUser(userId: string, organizationId?: string) {
    return dbStore.notifications
      .filter((notification) => notification.userId === userId && (!organizationId || notification.organizationId === organizationId))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  async getPreferences(userId: string, organizationId?: string) {
    const existing = dbStore.notificationPreferences.find(
      (item) => item.userId === userId && (!organizationId || item.organizationId === organizationId),
    );

    if (existing) {
      return existing;
    }

    const next = this.defaultPreferences(userId, organizationId);
    dbStore.notificationPreferences.push(next);
    return next;
  }

  async updatePreferences(userId: string, updates: Partial<NotificationPreference>, organizationId?: string) {
    const current = await this.getPreferences(userId, organizationId);
    const next = {
      ...current,
      ...updates,
      channels: { ...current.channels, ...(updates.channels || {}) },
      categories: { ...current.categories, ...(updates.categories || {}) },
    };

    const index = dbStore.notificationPreferences.findIndex(
      (item) => item.userId === userId && (!organizationId || item.organizationId === organizationId),
    );

    if (index >= 0) {
      dbStore.notificationPreferences[index] = next;
    } else {
      dbStore.notificationPreferences.push(next);
    }

    return next;
  }

  async createNotification(input: {
    userId: string;
    organizationId?: string;
    type?: NotificationCategory;
    title: string;
    body: string;
    channel?: 'in_app' | 'email' | 'sms' | 'push';
    priority?: 'low' | 'normal' | 'high' | 'urgent';
    actionUrl?: string;
    metadata?: Record<string, unknown>;
  }): Promise<NotificationRecord> {
    const notification: NotificationRecord = {
      id: uuidv4(),
      userId: input.userId,
      organizationId: input.organizationId,
      type: input.type || 'system',
      title: input.title,
      body: input.body,
      channel: input.channel || 'in_app',
      priority: input.priority || 'normal',
      isRead: false,
      createdAt: new Date().toISOString(),
      actionUrl: input.actionUrl,
      metadata: input.metadata || {},
    };

    dbStore.notifications.unshift(notification);

    const preferences = await this.getPreferences(notification.userId, notification.organizationId);
    if (!preferences.enabled || !preferences.channels.in_app) {
      this.logger.debug(`Skipping realtime broadcast for ${notification.userId} because in-app notifications are disabled`);
      return notification;
    }

    this.gateway.broadcastToUser(notification.userId, {
      type: 'notification.created',
      notification,
      userId: notification.userId,
    });

    return notification;
  }

  async markAsRead(notificationId: string, userId: string) {
    const notification = dbStore.notifications.find(
      (item) => item.id === notificationId && item.userId === userId,
    );

    if (!notification) {
      throw new NotFoundException('Notification not found');
    }

    notification.isRead = true;
    this.gateway.broadcastToUser(userId, {
      type: 'notification.read',
      notification,
      userId,
    });

    return notification;
  }

  async markAllAsRead(userId: string) {
    const items = dbStore.notifications.filter((notification) => notification.userId === userId && !notification.isRead);
    items.forEach((notification) => {
      notification.isRead = true;
    });

    this.gateway.broadcastToUser(userId, {
      type: 'notification.read_all',
      userId,
      count: items.length,
    });

    return { success: true, count: items.length };
  }
}
