export type NotificationChannel = 'in_app' | 'email' | 'sms' | 'push';
export type NotificationPriority = 'low' | 'normal' | 'high' | 'urgent';
export type NotificationCategory =
  | 'system'
  | 'fraud'
  | 'payout'
  | 'commission'
  | 'program'
  | 'team'
  | 'security';

export interface NotificationRecord {
  id: string;
  userId: string;
  organizationId?: string;
  type: NotificationCategory;
  title: string;
  body: string;
  channel: NotificationChannel;
  priority: NotificationPriority;
  isRead: boolean;
  createdAt: string;
  actionUrl?: string;
  metadata?: Record<string, unknown>;
}

export interface NotificationPreference {
  id: string;
  userId: string;
  organizationId?: string;
  enabled: boolean;
  channels: {
    in_app: boolean;
    email: boolean;
    sms: boolean;
    push: boolean;
  };
  categories: Record<NotificationCategory, boolean>;
}

export interface NotificationEventPayload {
  type: 'notification.created' | 'notification.read' | 'notification.read_all';
  notification?: NotificationRecord;
  userId?: string;
  count?: number;
}
