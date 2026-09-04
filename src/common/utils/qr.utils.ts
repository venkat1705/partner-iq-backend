import { Logger } from '@nestjs/common';

const logger = new Logger('QrUtils');

let qrcodeLib: any = null;

async function getQrcode() {
  if (qrcodeLib) return qrcodeLib;
  try {
    const mod = await import('qrcode');
    qrcodeLib = mod.default ?? mod;
    return qrcodeLib;
  } catch {
    logger.warn('qrcode package not available — QR code generation will return null');
    return null;
  }
}

/**
 * Generate a base64-encoded PNG data URL from a text string (e.g., otpauth:// URI).
 * Returns null if qrcode package is unavailable.
 */
export async function generateQrCodeDataUrl(text: string): Promise<string | null> {
  try {
    const qrcode = await getQrcode();
    if (!qrcode) return null;

    const dataUrl: string = await qrcode.toDataURL(text, {
      type: 'image/png',
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 256,
      color: {
        dark: '#0f172a',
        light: '#ffffff',
      },
    });

    return dataUrl;
  } catch (err) {
    logger.warn(`QR code generation failed: ${err}`);
    return null;
  }
}
