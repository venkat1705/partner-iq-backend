import { IsOptional, IsString, IsObject, IsArray, IsBoolean } from 'class-validator';

export class UpdateBrandingDto {
  @IsOptional()
  @IsString()
  id?: string;

  @IsOptional()
  @IsString()
  organizationId?: string;

  @IsOptional()
  createdAt?: any;

  @IsOptional()
  updatedAt?: any;

  @IsOptional()
  deletedAt?: any;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;

  @IsOptional()
  @IsString()
  logoUrl?: string;

  @IsOptional()
  @IsString()
  logoDarkUrl?: string;

  @IsOptional()
  @IsString()
  faviconUrl?: string;

  @IsOptional()
  @IsString()
  primaryColor?: string;

  @IsOptional()
  @IsString()
  secondaryColor?: string;

  @IsOptional()
  @IsString()
  backgroundColor?: string;

  @IsOptional()
  @IsString()
  textColor?: string;

  @IsOptional()
  @IsString()
  heroHeaderPill?: string;

  @IsOptional()
  @IsString()
  heroTitle?: string;

  @IsOptional()
  @IsString()
  heroHighlightText?: string;

  @IsOptional()
  @IsString()
  heroDescription?: string;

  @IsOptional()
  @IsString()
  heroCtaText?: string;

  @IsOptional()
  @IsString()
  heroImageUrl?: string;

  @IsOptional()
  @IsArray()
  partnerBenefits?: Array<{ title: string; description?: string; icon?: string }>;

  @IsOptional()
  @IsArray()
  howItWorks?: Array<{ title: string; description?: string }>;

  @IsOptional()
  @IsArray()
  faq?: Array<{ question: string; answer: string; active?: boolean }>;

  @IsOptional()
  @IsString()
  storyTitle?: string;

  @IsOptional()
  @IsString()
  storyHeading?: string;

  @IsOptional()
  @IsString()
  storyDescription?: string;

  @IsOptional()
  @IsString()
  mission?: string;

  @IsOptional()
  @IsString()
  foundedYear?: string;

  @IsOptional()
  @IsString()
  location?: string;

  @IsOptional()
  @IsArray()
  accreditations?: string[];

  @IsOptional()
  @IsArray()
  trustMetrics?: Array<{ label: string; value: string }>;

  @IsOptional()
  @IsString()
  legalName?: string;

  @IsOptional()
  @IsString()
  footerDescription?: string;

  @IsOptional()
  @IsArray()
  footerLinks?: Array<{ label: string; url: string; newTab?: boolean }>;

  @IsOptional()
  @IsObject()
  socialLinks?: Record<string, string>;

  @IsOptional()
  @IsString()
  privacyUrl?: string;

  @IsOptional()
  @IsString()
  termsUrl?: string;

  @IsOptional()
  @IsString()
  cookiePolicyUrl?: string;

  @IsOptional()
  @IsString()
  partnerTermsUrl?: string;

  @IsOptional()
  @IsString()
  seoTitle?: string;

  @IsOptional()
  @IsString()
  seoDescription?: string;

  @IsOptional()
  @IsString()
  seoImageUrl?: string;

  @IsOptional()
  @IsObject()
  visibility?: {
    showPrograms?: boolean;
    showBenefits?: boolean;
    showHowItWorks?: boolean;
    showFaq?: boolean;
    showCompany?: boolean;
    showSocialLinks?: boolean;
    showTrustStrip?: boolean;
  };

  @IsOptional()
  @IsBoolean()
  highlightWebsite?: boolean;
}

