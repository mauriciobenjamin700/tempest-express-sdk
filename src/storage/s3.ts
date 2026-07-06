/**
 * S3 / MinIO-backed {@link UploadStorage}, mirroring `utils.storage_backends`.
 *
 * Implements the same narrow `UploadStorage` interface as
 * {@link LocalUploadStorage} over a MinIO/S3 client, so services swap backends
 * without touching call sites. The `minio` client is an **optional** peer
 * dependency, lazy-loaded on first use (or inject your own client for tests /
 * a custom SDK).
 */

import type { Readable } from "node:stream";
import type { SaveOptions, UploadResult, UploadStorage } from "@/storage/local";

/** Minimal MinIO/S3 client surface used by {@link S3UploadStorage}. */
export interface S3ClientLike {
  putObject(
    bucket: string,
    key: string,
    data: Buffer,
    size?: number,
    metaData?: Record<string, string>,
  ): Promise<unknown>;
  getObject(bucket: string, key: string): Promise<Readable>;
  removeObject(bucket: string, key: string): Promise<void>;
}

/** Options for {@link S3UploadStorage}. */
export interface S3UploadStorageOptions {
  /** Target bucket. */
  bucket: string;
  /** Public base URL for {@link S3UploadStorage.url} (e.g. a CDN or the endpoint). */
  publicBaseUrl?: string;
  /** Inject a ready client (e.g. a `minio` `Client`, or a mock). */
  client?: S3ClientLike;
  /** MinIO/S3 endpoint host (used only when `client` is not injected). */
  endPoint?: string;
  /** Endpoint port. */
  port?: number;
  /** Whether to use TLS. */
  useSSL?: boolean;
  /** Access key. */
  accessKey?: string;
  /** Secret key. */
  secretKey?: string;
  /** Region. */
  region?: string;
}

/** Collect a readable stream into a single {@link Buffer}. */
async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
  }
  return Buffer.concat(chunks);
}

/** {@link UploadStorage} over a MinIO/S3 client. */
export class S3UploadStorage implements UploadStorage {
  private readonly bucket: string;
  private readonly publicBaseUrl: string;
  private client: S3ClientLike | undefined;
  private readonly options: S3UploadStorageOptions;

  /**
   * @param options - Bucket, public URL and either a client or connection config.
   */
  constructor(options: S3UploadStorageOptions) {
    this.bucket = options.bucket;
    this.publicBaseUrl = options.publicBaseUrl ?? "";
    this.client = options.client;
    this.options = options;
  }

  /** Resolve the client, lazy-loading `minio` when one wasn't injected. */
  private async getClient(): Promise<S3ClientLike> {
    if (this.client) return this.client;
    // Variable specifier keeps the optional peer out of static resolution.
    const specifier = "minio";
    let mod: { Client: new (config: Record<string, unknown>) => S3ClientLike };
    try {
      mod = (await import(specifier)) as typeof mod;
    } catch {
      throw new Error(
        "S3UploadStorage requires the 'minio' peer dependency. Install with `npm i minio`.",
      );
    }
    this.client = new mod.Client({
      endPoint: this.options.endPoint,
      port: this.options.port,
      useSSL: this.options.useSSL,
      accessKey: this.options.accessKey,
      secretKey: this.options.secretKey,
      region: this.options.region,
    });
    return this.client;
  }

  async save(
    key: string,
    data: Uint8Array,
    options: SaveOptions = {},
  ): Promise<UploadResult> {
    const client = await this.getClient();
    const buffer = Buffer.from(data);
    const metaData = options.contentType
      ? { "Content-Type": options.contentType }
      : undefined;
    await client.putObject(this.bucket, key, buffer, buffer.byteLength, metaData);
    return {
      key,
      url: this.url(key),
      size: buffer.byteLength,
      ...(options.contentType !== undefined ? { contentType: options.contentType } : {}),
    };
  }

  async read(key: string): Promise<Buffer> {
    const client = await this.getClient();
    return streamToBuffer(await client.getObject(this.bucket, key));
  }

  async delete(key: string): Promise<void> {
    const client = await this.getClient();
    await client.removeObject(this.bucket, key);
  }

  url(key: string): string {
    const base = this.publicBaseUrl.replace(/\/$/, "");
    return base ? `${base}/${this.bucket}/${key}` : `/${this.bucket}/${key}`;
  }
}
