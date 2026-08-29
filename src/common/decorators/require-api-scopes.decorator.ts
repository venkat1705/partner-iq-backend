import { SetMetadata } from '@nestjs/common';

export const API_SCOPES_KEY = 'partneriq:api_scopes';

export const RequireApiScopes = (...scopes: string[]) => SetMetadata(API_SCOPES_KEY, scopes);
