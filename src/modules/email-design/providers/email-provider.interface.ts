/**
 * Email Provider Abstraction Interface
 */

export interface SendEmailInput {
  to: string;
  subject: string;
  htmlContent: string;
  textContent?: string;
  senderEmail?: string;
  senderName?: string;
  replyTo?: string;
  templateKey?: string;
  tags?: string[];
  metadata?: Record<string, any>;
}

export interface SendEmailResult {
  sent: boolean;
  provider: string;
  providerMessageId: string | null;
  error?: string;
}

export interface EmailProvider {
  name: string;
  send(input: SendEmailInput): Promise<SendEmailResult>;
}

