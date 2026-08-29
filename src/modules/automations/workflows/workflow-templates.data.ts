import {
  AutomationTriggerType,
  AutomationWorkflowStatus,
  AutomationNodeType,
  AutomationActionType,
} from '../../../common/enums';

export interface WorkflowTemplateDefinition {
  id: string;
  name: string;
  category: 'ONBOARDING' | 'RE_ENGAGEMENT' | 'MILESTONE' | 'TIER';
  description: string;
  triggerType: AutomationTriggerType;
  goalType?: string;
  goalConfig?: Record<string, any>;
  nodes: Array<{
    id: string;
    type: AutomationNodeType;
    name: string;
    config: Record<string, any>;
    position: { x: number; y: number };
  }>;
  edges: Array<{
    id: string;
    sourceNodeId: string;
    targetNodeId: string;
    branchKey?: string;
  }>;
}

export const PREBUILT_WORKFLOW_TEMPLATES: WorkflowTemplateDefinition[] = [
  {
    id: 'template-new-affiliate-onboarding',
    name: 'New Affiliate Onboarding (Multi-Day Drip)',
    category: 'ONBOARDING',
    description: 'Welcome new partners, guide them to create their first tracking link, and nurture them to their first conversion.',
    triggerType: AutomationTriggerType.AFFILIATE_JOINED_PROGRAM,
    goalType: 'FIRST_CONVERSION',
    goalConfig: { metric: 'APPROVED_CONVERSIONS', operator: 'GREATER_THAN', value: 0 },
    nodes: [
      {
        id: 'node-trigger-1',
        type: AutomationNodeType.TRIGGER,
        name: 'Affiliate Joined Program',
        config: { trigger: AutomationTriggerType.AFFILIATE_JOINED_PROGRAM },
        position: { x: 250, y: 50 },
      },
      {
        id: 'node-action-welcome',
        type: AutomationNodeType.ACTION,
        name: 'Send Welcome Email',
        config: {
          actionType: AutomationActionType.SEND_EMAIL,
          emailTemplateCode: 'WELCOME_AFFILIATE',
          notificationTitle: 'Welcome to the Partner Program!',
          notificationBody: 'Welcome aboard! Check your dashboard to access your links and marketing assets.',
        },
        position: { x: 250, y: 150 },
      },
      {
        id: 'node-delay-3d',
        type: AutomationNodeType.DELAY,
        name: 'Wait 3 Days',
        config: { delayAmount: 3, delayUnit: 'DAYS' },
        position: { x: 250, y: 250 },
      },
      {
        id: 'node-cond-has-link',
        type: AutomationNodeType.CONDITION,
        name: 'Tracking Links Created == 0?',
        config: {
          matchType: 'ALL',
          conditions: [{ field: 'trackingLinksCreated', operator: 'EQUAL', value: 0 }],
        },
        position: { x: 250, y: 350 },
      },
      {
        id: 'node-action-create-link',
        type: AutomationNodeType.ACTION,
        name: 'Send "Create First Link" Email',
        config: {
          actionType: AutomationActionType.SEND_EMAIL,
          emailTemplateCode: 'CREATE_FIRST_LINK',
          notificationTitle: 'Create Your First Tracking Link',
          notificationBody: 'You haven\'t created a tracking link yet. Generate your link in seconds to start earning.',
        },
        position: { x: 120, y: 460 },
      },
      {
        id: 'node-delay-4d',
        type: AutomationNodeType.DELAY,
        name: 'Wait 4 Days',
        config: { delayAmount: 4, delayUnit: 'DAYS' },
        position: { x: 120, y: 560 },
      },
      {
        id: 'node-cond-has-clicks',
        type: AutomationNodeType.CONDITION,
        name: 'Clicks Received == 0?',
        config: {
          matchType: 'ALL',
          conditions: [{ field: 'clicks', operator: 'EQUAL', value: 0 }],
        },
        position: { x: 120, y: 660 },
      },
      {
        id: 'node-action-marketing-assets',
        type: AutomationNodeType.ACTION,
        name: 'Send Marketing Assets Email',
        config: {
          actionType: AutomationActionType.SEND_EMAIL,
          emailTemplateCode: 'MARKETING_ASSETS_TIPS',
          notificationTitle: 'Boost Traffic with Free Brand Assets',
          notificationBody: 'Download high-converting banners, copy, and product kits to start getting clicks.',
        },
        position: { x: 120, y: 770 },
      },
      {
        id: 'node-end',
        type: AutomationNodeType.END,
        name: 'Complete Onboarding Sequence',
        config: {},
        position: { x: 380, y: 500 },
      },
    ],
    edges: [
      { id: 'e1', sourceNodeId: 'node-trigger-1', targetNodeId: 'node-action-welcome' },
      { id: 'e2', sourceNodeId: 'node-action-welcome', targetNodeId: 'node-delay-3d' },
      { id: 'e3', sourceNodeId: 'node-delay-3d', targetNodeId: 'node-cond-has-link' },
      { id: 'e4', sourceNodeId: 'node-cond-has-link', targetNodeId: 'node-action-create-link', branchKey: 'YES' },
      { id: 'e5', sourceNodeId: 'node-cond-has-link', targetNodeId: 'node-end', branchKey: 'NO' },
      { id: 'e6', sourceNodeId: 'node-action-create-link', targetNodeId: 'node-delay-4d' },
      { id: 'e7', sourceNodeId: 'node-delay-4d', targetNodeId: 'node-cond-has-clicks' },
      { id: 'e8', sourceNodeId: 'node-cond-has-clicks', targetNodeId: 'node-action-marketing-assets', branchKey: 'YES' },
      { id: 'e9', sourceNodeId: 'node-cond-has-clicks', targetNodeId: 'node-end', branchKey: 'NO' },
      { id: 'e10', sourceNodeId: 'node-action-marketing-assets', targetNodeId: 'node-end' },
    ],
  },
  {
    id: 'template-no-tracking-link-7d',
    name: 'No Tracking Link After 7 Days',
    category: 'ONBOARDING',
    description: 'Nudge affiliates who joined 7 days ago but have not generated any tracking link yet.',
    triggerType: AutomationTriggerType.AFFILIATE_JOINED_PROGRAM,
    goalType: 'TRACKING_LINK_CREATED',
    goalConfig: { metric: 'TRACKING_LINKS_CREATED', operator: 'GREATER_THAN', value: 0 },
    nodes: [
      {
        id: 'node-trig-link',
        type: AutomationNodeType.TRIGGER,
        name: 'Affiliate Joined Program',
        config: { trigger: AutomationTriggerType.AFFILIATE_JOINED_PROGRAM },
        position: { x: 250, y: 50 },
      },
      {
        id: 'node-delay-7d',
        type: AutomationNodeType.DELAY,
        name: 'Wait 7 Days',
        config: { delayAmount: 7, delayUnit: 'DAYS' },
        position: { x: 250, y: 160 },
      },
      {
        id: 'node-cond-0link',
        type: AutomationNodeType.CONDITION,
        name: 'Tracking Links == 0?',
        config: {
          matchType: 'ALL',
          conditions: [{ field: 'trackingLinksCreated', operator: 'EQUAL', value: 0 }],
        },
        position: { x: 250, y: 270 },
      },
      {
        id: 'node-act-link-nudge',
        type: AutomationNodeType.ACTION,
        name: 'Send Link Reminder Email & In-App Notification',
        config: {
          actionType: AutomationActionType.SEND_EMAIL,
          emailTemplateCode: 'CREATE_FIRST_LINK',
          notificationTitle: 'Create your tracking link to start earning',
          notificationBody: 'You joined 7 days ago! Create your unique referral link to track conversions.',
        },
        position: { x: 120, y: 390 },
      },
      {
        id: 'node-end-link',
        type: AutomationNodeType.END,
        name: 'End Workflow',
        config: {},
        position: { x: 380, y: 390 },
      },
    ],
    edges: [
      { id: 'el1', sourceNodeId: 'node-trig-link', targetNodeId: 'node-delay-7d' },
      { id: 'el2', sourceNodeId: 'node-delay-7d', targetNodeId: 'node-cond-0link' },
      { id: 'el3', sourceNodeId: 'node-cond-0link', targetNodeId: 'node-act-link-nudge', branchKey: 'YES' },
      { id: 'el4', sourceNodeId: 'node-cond-0link', targetNodeId: 'node-end-link', branchKey: 'NO' },
      { id: 'el5', sourceNodeId: 'node-act-link-nudge', targetNodeId: 'node-end-link' },
    ],
  },
  {
    id: 'template-inactive-affiliate-reengagement',
    name: 'Inactive Affiliate Re-Engagement (30-Day)',
    category: 'RE_ENGAGEMENT',
    description: 'Automatically re-engage partners who have had no activity for 30 days with tier and bonus incentives.',
    triggerType: AutomationTriggerType.AFFILIATE_INACTIVE,
    goalType: 'APPROVED_CONVERSION',
    goalConfig: { metric: 'APPROVED_CONVERSIONS', operator: 'GREATER_THAN', value: 0 },
    nodes: [
      {
        id: 'node-trig-inact',
        type: AutomationNodeType.TRIGGER,
        name: 'Affiliate Inactive (30 Days)',
        config: { trigger: AutomationTriggerType.AFFILIATE_INACTIVE },
        position: { x: 250, y: 50 },
      },
      {
        id: 'node-act-reengage',
        type: AutomationNodeType.ACTION,
        name: 'Send Re-engagement Incentive Email',
        config: {
          actionType: AutomationActionType.SEND_EMAIL,
          emailTemplateCode: 'RE_ENGAGE_AFFILIATE',
          notificationTitle: 'We miss you! Unlock your next tier commission',
          notificationBody: 'You\'re only a few sales away from your next commission tier upgrade. Check top converting campaigns today!',
        },
        position: { x: 250, y: 160 },
      },
      {
        id: 'node-delay-7d-re',
        type: AutomationNodeType.DELAY,
        name: 'Wait 7 Days',
        config: { delayAmount: 7, delayUnit: 'DAYS' },
        position: { x: 250, y: 270 },
      },
      {
        id: 'node-cond-still-0',
        type: AutomationNodeType.CONDITION,
        name: 'Conversions == 0 in last 7 days?',
        config: {
          matchType: 'ALL',
          conditions: [{ field: 'approvedConversions', operator: 'EQUAL', value: 0 }],
        },
        position: { x: 250, y: 380 },
      },
      {
        id: 'node-act-tips',
        type: AutomationNodeType.ACTION,
        name: 'Send Partner Promotion Kit',
        config: {
          actionType: AutomationActionType.SEND_EMAIL,
          emailTemplateCode: 'MARKETING_ASSETS_TIPS',
          notificationTitle: 'New marketing assets ready for your audience',
          notificationBody: 'Explore our latest banners and promotional copy in your asset library.',
        },
        position: { x: 120, y: 490 },
      },
      {
        id: 'node-end-re',
        type: AutomationNodeType.END,
        name: 'End Workflow',
        config: {},
        position: { x: 380, y: 490 },
      },
    ],
    edges: [
      { id: 'er1', sourceNodeId: 'node-trig-inact', targetNodeId: 'node-act-reengage' },
      { id: 'er2', sourceNodeId: 'node-act-reengage', targetNodeId: 'node-delay-7d-re' },
      { id: 'er3', sourceNodeId: 'node-delay-7d-re', targetNodeId: 'node-cond-still-0' },
      { id: 'er4', sourceNodeId: 'node-cond-still-0', targetNodeId: 'node-act-tips', branchKey: 'YES' },
      { id: 'er5', sourceNodeId: 'node-cond-still-0', targetNodeId: 'node-end-re', branchKey: 'NO' },
      { id: 'er6', sourceNodeId: 'node-act-tips', targetNodeId: 'node-end-re' },
    ],
  },
  {
    id: 'template-first-conversion-celebration',
    name: 'First Conversion Celebration',
    category: 'MILESTONE',
    description: 'Celebrate the partner\'s first approved referral with an instant notification, congratulations email, and badge.',
    triggerType: AutomationTriggerType.FIRST_CONVERSION,
    nodes: [
      {
        id: 'node-trig-conv1',
        type: AutomationNodeType.TRIGGER,
        name: 'First Conversion Approved',
        config: { trigger: AutomationTriggerType.FIRST_CONVERSION },
        position: { x: 250, y: 50 },
      },
      {
        id: 'node-act-conv1-badge',
        type: AutomationNodeType.ACTION,
        name: 'Award First Sale Badge',
        config: {
          actionType: AutomationActionType.AWARD_BADGE,
          badgeName: 'First Sale Club',
        },
        position: { x: 250, y: 150 },
      },
      {
        id: 'node-act-conv1-email',
        type: AutomationNodeType.ACTION,
        name: 'Send Celebration Email',
        config: {
          actionType: AutomationActionType.SEND_EMAIL,
          emailTemplateCode: 'FIRST_CONVERSION_CONGRATS',
          notificationTitle: '🎉 Congratulations on your first sale!',
          notificationBody: 'You just earned your first commission! Check your dashboard for details.',
        },
        position: { x: 250, y: 260 },
      },
      {
        id: 'node-end-conv1',
        type: AutomationNodeType.END,
        name: 'End Workflow',
        config: {},
        position: { x: 250, y: 370 },
      },
    ],
    edges: [
      { id: 'ec1', sourceNodeId: 'node-trig-conv1', targetNodeId: 'node-act-conv1-badge' },
      { id: 'ec2', sourceNodeId: 'node-act-conv1-badge', targetNodeId: 'node-act-conv1-email' },
      { id: 'ec3', sourceNodeId: 'node-act-conv1-email', targetNodeId: 'node-end-conv1' },
    ],
  },
  {
    id: 'template-tier-upgrade-celebration',
    name: 'Tier Upgrade Celebration',
    category: 'TIER',
    description: 'Notify the partner immediately when they advance to Silver, Gold, or Diamond tier with new commission rate details.',
    triggerType: AutomationTriggerType.TIER_UPGRADED,
    nodes: [
      {
        id: 'node-trig-tier-up',
        type: AutomationNodeType.TRIGGER,
        name: 'Affiliate Tier Upgraded',
        config: { trigger: AutomationTriggerType.TIER_UPGRADED },
        position: { x: 250, y: 50 },
      },
      {
        id: 'node-act-tier-email',
        type: AutomationNodeType.ACTION,
        name: 'Send Tier Upgrade Congratulations Email',
        config: {
          actionType: AutomationActionType.SEND_EMAIL,
          emailTemplateCode: 'TIER_UPGRADE_CONGRATS',
          notificationTitle: '🌟 You reached a new partner tier!',
          notificationBody: 'Your performance has unlocked higher commission rates and exclusive partner perks.',
        },
        position: { x: 250, y: 160 },
      },
      {
        id: 'node-end-tier',
        type: AutomationNodeType.END,
        name: 'End Workflow',
        config: {},
        position: { x: 250, y: 270 },
      },
    ],
    edges: [
      { id: 'et1', sourceNodeId: 'node-trig-tier-up', targetNodeId: 'node-act-tier-email' },
      { id: 'et2', sourceNodeId: 'node-act-tier-email', targetNodeId: 'node-end-tier' },
    ],
  },
];
