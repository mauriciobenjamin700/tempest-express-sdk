/**
 * File storage abstraction, mirroring `utils.storage_backends` / `utils.upload`.
 *
 * A narrow {@link UploadStorage} interface with a filesystem-backed
 * {@link LocalUploadStorage}. For S3/MinIO, implement the same interface over
 * your client (the interface intentionally avoids a hard cloud dependency).
 */

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

/** The result of persisting an object. */
export interface UploadResult {
  /** The storage key (path within the backend). */
  key: string;
  /** A URL the object can be served from. */
  url: string;
  /** The stored byte size. */
  size: number;
  /** The declared content type, when known. */
  contentType?: string;
}

/** Options for {@link UploadStorage.save}. */
export interface SaveOptions {
  /** MIME type recorded on the result. */
  contentType?: string;
}

/** Narrow object-storage surface backends implement. */
export interface UploadStorage {
  /** Persist bytes under `key`, returning metadata. */
  save(key: string, data: Uint8Array, options?: SaveOptions): Promise<UploadResult>;
  /** Read bytes back by key. */
  read(key: string): Promise<Buffer>;
  /** Delete an object. Idempotent. */
  delete(key: string): Promise<void>;
  /** The URL an object is served from. */
  url(key: string): string;
}

/** Options for {@link LocalUploadStorage}. */
export interface LocalUploadStorageOptions {
  /** Filesystem root every key is written under. */
  root: string;
  /** Public base URL prefix for {@link LocalUploadStorage.url}. Default `""`. */
  baseUrl?: string;
}

/** Filesystem-backed {@link UploadStorage} for local/dev or single-host setups. */
export class LocalUploadStorage implements UploadStorage {
  private readonly root: string;
  private readonly baseUrl: string;

  /**
   * @param options - Filesystem root and public base URL.
   */
  constructor(options: LocalUploadStorageOptions) {
    this.root = options.root;
    this.baseUrl = options.baseUrl ?? "";
  }

  async save(
    key: string,
    data: Uint8Array,
    options: SaveOptions = {},
  ): Promise<UploadResult> {
    const target = join(this.root, key);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, data);
    return {
      key,
      url: this.url(key),
      size: data.byteLength,
      ...(options.contentType !== undefined ? { contentType: options.contentType } : {}),
    };
  }

  async read(key: string): Promise<Buffer> {
    return readFile(join(this.root, key));
  }

  async delete(key: string): Promise<void> {
    await rm(join(this.root, key), { force: true });
  }

  url(key: string): string {
    const base = this.baseUrl.replace(/\/$/, "");
    return base ? `${base}/${key}` : `/${key}`;
  }
}

/**
 * Build a `Content-Disposition` header value.
 *
 * @param filename - The download filename.
 * @param inline - When `true`, use `inline`; otherwise `attachment`.
 * @returns The header value (RFC 5987 `filename*` encoded).
 */
export function buildContentDisposition(filename: string, inline = false): string {
  const disposition = inline ? "inline" : "attachment";
  const encoded = encodeURIComponent(filename);
  return `${disposition}; filename*=UTF-8''${encoded}`;
}
