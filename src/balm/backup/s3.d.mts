export const PART_BYTES: number
export class StorageError extends Error {}
export interface Storage { origin: string; region: string; bucket: string; prefix: string; accessKeyId: string; secretAccessKey: string }
export interface CallOptions { now?: Date; fetcher?: typeof fetch }
export function storage(config: { endpoint: string; region: string; bucket: string; prefix?: string; accessKeyId: string; secretAccessKey: string }, options?: { loopback?: boolean }): Storage
export function putObject(target: Storage, key: string, body: Uint8Array, options?: CallOptions): Promise<void>
export function putStream(target: Storage, key: string, source: AsyncIterable<Uint8Array>, options?: CallOptions): Promise<{ bytes: number }>
export function listObjects(target: Storage, options?: CallOptions): Promise<string[]>
export function getObject(target: Storage, key: string, options?: CallOptions): Promise<ReadableStream<Uint8Array>>
