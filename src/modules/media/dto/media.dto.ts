/** Image uploads are multipart (see MediaService.uploadImage); purposes accepted for organization images. */
export const MEDIA_PURPOSES = ['program-logo', 'program-banner', 'organization-logo', 'affiliate-avatar'] as const;
export type MediaPurpose = (typeof MEDIA_PURPOSES)[number];
