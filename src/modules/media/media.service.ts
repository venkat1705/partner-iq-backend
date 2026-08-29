import { BadRequestException, Injectable, InternalServerErrorException } from '@nestjs/common';
import { createHash } from 'crypto';
import { UploadImageDto } from './dto/media.dto';

interface CloudinaryUploadResponse {
  public_id: string;
  secure_url: string;
  width?: number;
  height?: number;
  format?: string;
  bytes?: number;
}

@Injectable()
export class MediaService {
  async uploadImage(organizationId: string, dto: UploadImageDto) {
    const { cloudName, apiKey, apiSecret, folder } = this.getCloudinaryConfig();
    this.validateDataUrl(dto);

    const formData = new FormData();
    formData.set('file', dto.dataUrl);
    formData.set('api_key', apiKey);
    formData.set('timestamp', String(Math.floor(Date.now() / 1000)));
    formData.set('folder', `${folder}/${organizationId}/${dto.purpose}`);
    formData.set('resource_type', 'image');

    const signature = this.createSignature(formData, apiSecret);
    formData.set('signature', signature);

    const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, {
      method: 'POST',
      body: formData,
    });

    const payload = (await response.json().catch(() => null)) as CloudinaryUploadResponse & { error?: { message?: string } } | null;
    if (!response.ok || !payload?.secure_url) {
      throw new InternalServerErrorException(payload?.error?.message || 'Cloudinary upload failed.');
    }

    return {
      publicId: payload.public_id,
      secureUrl: payload.secure_url,
      width: payload.width,
      height: payload.height,
      format: payload.format,
      bytes: payload.bytes,
    };
  }

  private getCloudinaryConfig() {
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
    const apiKey = process.env.CLOUDINARY_API_KEY;
    const apiSecret = process.env.CLOUDINARY_API_SECRET;
    const folder = process.env.CLOUDINARY_UPLOAD_FOLDER || 'partneriq';

    if (!cloudName || !apiKey || !apiSecret) {
      throw new BadRequestException('Cloudinary is not configured. Add CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET.');
    }

    return { cloudName, apiKey, apiSecret, folder };
  }

  private validateDataUrl(dto: UploadImageDto) {
    if (!dto.dataUrl.startsWith(`data:${dto.mimeType};base64,`)) {
      throw new BadRequestException('Invalid image data URL.');
    }

    const base64 = dto.dataUrl.split(',')[1] || '';
    const estimatedBytes = Math.floor((base64.length * 3) / 4);
    if (estimatedBytes > 5 * 1024 * 1024) {
      throw new BadRequestException('Image must be 5MB or smaller.');
    }
  }

  private createSignature(formData: FormData, apiSecret: string) {
    const params = Array.from(formData.entries())
      .filter(([key]) => !['file', 'api_key', 'resource_type'].includes(key))
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => `${key}=${value}`)
      .join('&');

    return createHash('sha1').update(`${params}${apiSecret}`).digest('hex');
  }
}
