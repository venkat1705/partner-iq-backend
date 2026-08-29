export const HUBSPOT_PROVIDER = 'HUBSPOT';

export const HUBSPOT_REQUIRED_SCOPES = [
  'oauth',
  'crm.objects.contacts.read',
  'crm.objects.contacts.write',
  'crm.objects.companies.read',
  'crm.objects.companies.write',
  'crm.objects.deals.read',
  'crm.objects.deals.write',
  'crm.schemas.deals.read',
];

export const HUBSPOT_DEFAULT_FIELD_MAPPINGS = [
  ['companyName', 'name', true],
  ['companyDomain', 'domain', false],
  ['contactEmail', 'email', true],
  ['contactFirstName', 'firstname', false],
  ['contactLastName', 'lastname', false],
  ['contactPhone', 'phone', false],
  ['contactJobTitle', 'jobtitle', false],
  ['dealName', 'dealname', true],
  ['estimatedValue', 'amount', false],
  ['expectedCloseDate', 'closedate', false],
  ['partnerId', 'partneriq_partner_id', true],
  ['dealRegistrationId', 'partneriq_deal_registration_id', true],
  ['programId', 'partneriq_program_id', false],
  ['programName', 'partneriq_program_name', false],
  ['referralSource', 'partneriq_referral_source', false],
] as const;

export const HUBSPOT_CUSTOM_DEAL_PROPERTIES = [
  'partneriq_deal_registration_id',
  'partneriq_partner_id',
  'partneriq_partner_code',
  'partneriq_program_id',
  'partneriq_program_name',
  'partneriq_referral_source',
  'partneriq_attribution_reference',
];
