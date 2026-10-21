export const MAGIC: string
export const PUBLIC_PREFIX: string
export function toBase64(bytes: Uint8Array): string
export function fromBase64(text: string): Uint8Array
export function generateBackupKeys(): Promise<{ publicKey: string; privateKeyPem: string; fingerprint: string }>
export function readPublicKey(text: unknown): Promise<{ key: CryptoKey; publicKey: string; fingerprint: string }>
export function encryptBackup(source: AsyncIterable<Uint8Array>, publicKey: string, createdAt?: string): AsyncGenerator<Uint8Array>
export function decryptBackup(source: AsyncIterable<Uint8Array>, privateKeyPem: string): AsyncGenerator<Uint8Array>
