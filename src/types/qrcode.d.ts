declare module 'qrcode' {
  export function toString(text: string, opts?: { type?: 'svg' | 'utf8' | 'terminal'; margin?: number; width?: number; errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H' }): Promise<string>;
  export function toDataURL(text: string, opts?: { margin?: number; width?: number; errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H' }): Promise<string>;
}
