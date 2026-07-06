/**
 * File-download helpers, mirroring `utils.download`.
 *
 * Serve a file from disk with HTTP Range support (resumable / seekable
 * downloads → `206 Partial Content`) or send in-memory bytes, both with a
 * correct `Content-Disposition`. Path resolution is traversal-safe.
 */

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { isAbsolute, join, normalize, relative } from "node:path";
import { buildContentDisposition } from "@/storage/local";
import type { Request, Response } from "express";

/**
 * Resolve a client-supplied relative path under a root, refusing traversal
 * outside it.
 *
 * @param root - The directory downloads are confined to.
 * @param relativePath - The (untrusted) relative path.
 * @param subdir - Optional sub-directory under `root`.
 * @returns The absolute, validated path.
 * @throws {Error} When the resolved path escapes `root`.
 */
export function resolveDownloadPath(
  root: string,
  relativePath: string,
  subdir = "",
): string {
  const base = normalize(join(root, subdir));
  const target = normalize(join(base, relativePath));
  const rel = relative(base, target);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error("Resolved path escapes the download root");
  }
  return target;
}

/** Options for {@link sendFileDownload} / {@link sendBytesDownload}. */
export interface DownloadOptions {
  /** Download filename; defaults to the file's basename. */
  filename?: string;
  /** MIME type. Default `application/octet-stream`. */
  contentType?: string;
  /** Serve inline (view in browser) instead of forcing a download. */
  inline?: boolean;
}

/** Parse a single-range `Range: bytes=start-end` header against a size. */
function parseRange(
  header: string | undefined,
  size: number,
): { start: number; end: number } | null {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const [, rawStart, rawEnd] = match;
  if (rawStart === "" && rawEnd === "") return null;
  let start: number;
  let end: number;
  if (rawStart === "") {
    // Suffix range: last N bytes.
    const suffix = Number(rawEnd);
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd === "" ? size - 1 : Math.min(Number(rawEnd), size - 1);
  }
  if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= size)
    return null;
  return { start, end };
}

/**
 * Stream a file from disk as a download, honoring a `Range` request header
 * (responds `206` with `Content-Range` for a partial request, else `200`).
 *
 * @param req - The request (read for the `Range` header).
 * @param res - The response.
 * @param absolutePath - The absolute file path (validate it first — see
 *   {@link resolveDownloadPath}).
 * @param options - Filename, content type and inline flag.
 * @returns Resolves once the response stream is wired up.
 */
export async function sendFileDownload(
  req: Request,
  res: Response,
  absolutePath: string,
  options: DownloadOptions = {},
): Promise<void> {
  const info = await stat(absolutePath);
  const filename = options.filename ?? absolutePath.split(/[/\\]/).pop() ?? "download";
  res.setHeader("Content-Type", options.contentType ?? "application/octet-stream");
  res.setHeader("Content-Disposition", buildContentDisposition(filename, options.inline));
  res.setHeader("Accept-Ranges", "bytes");

  const range = parseRange(req.header("range"), info.size);
  if (range) {
    res.status(206);
    res.setHeader("Content-Range", `bytes ${range.start}-${range.end}/${info.size}`);
    res.setHeader("Content-Length", String(range.end - range.start + 1));
    createReadStream(absolutePath, { start: range.start, end: range.end }).pipe(res);
    return;
  }
  res.status(200);
  res.setHeader("Content-Length", String(info.size));
  createReadStream(absolutePath).pipe(res);
}

/**
 * Send in-memory bytes as a download.
 *
 * @param res - The response.
 * @param data - The bytes to send.
 * @param options - Filename, content type and inline flag.
 */
export function sendBytesDownload(
  res: Response,
  data: Uint8Array,
  options: DownloadOptions = {},
): void {
  const filename = options.filename ?? "download";
  res.setHeader("Content-Type", options.contentType ?? "application/octet-stream");
  res.setHeader("Content-Disposition", buildContentDisposition(filename, options.inline));
  res.setHeader("Content-Length", String(data.byteLength));
  res.status(200).end(Buffer.from(data));
}
