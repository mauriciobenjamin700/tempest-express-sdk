/**
 * Multipart form parsing for the admin's upload and import screens.
 *
 * The panel's ordinary forms are `application/x-www-form-urlencoded`, which
 * Express parses on its own. A form carrying a file is `multipart/form-data`,
 * which it does not — so this module wraps `busboy`, the streaming parser
 * behind most of the Node ecosystem's upload middleware.
 *
 * `busboy` is an **optional peer**: only a project that configures
 * `uploadFields` or `canImport` needs it, and the error below says exactly what
 * to install. Multipart is a wire format with a long tail of correctness
 * (boundary handling, transfer encodings, filename escaping) — the kind of
 * parser this SDK depends on rather than reimplements.
 */

import type { Request } from "express";

/** One uploaded file, buffered in memory. */
export interface UploadedFile {
  /** The form field the file arrived on. */
  field: string;
  /** The client-supplied filename, already stripped of any path. */
  filename: string;
  /** The declared MIME type. */
  contentType: string;
  /** The file bytes. */
  data: Buffer;
}

/** The result of parsing a multipart body. */
export interface ParsedMultipart {
  /** Text fields, keyed by name. A repeated field keeps its last value. */
  fields: Record<string, string>;
  /** Uploaded files that carried a filename and at least one byte. */
  files: UploadedFile[];
}

/** Options for {@link parseMultipart}. */
export interface ParseMultipartOptions {
  /** Reject a file larger than this many bytes. Default `10 * 1024 * 1024`. */
  maxFileBytes?: number;
  /** Reject more than this many files in one submission. Default `10`. */
  maxFiles?: number;
}

/** Message pointing at the optional peer when it is missing. */
const BUSBOY_HINT =
  "The admin's upload and CSV-import screens need the optional peer `busboy`. " +
  "Install it with: npm install busboy";

/** Minimal shape of the `busboy` factory this module uses. */
type BusboyFactory = (config: {
  headers: Record<string, string | string[] | undefined>;
  limits: { fileSize: number; files: number };
}) => NodeJS.WritableStream & {
  on(event: string, handler: (...args: never[]) => void): unknown;
};

/**
 * Load `busboy`, or throw an error naming the install command.
 *
 * @returns The `busboy` factory.
 * @throws Error When the optional peer is not installed.
 */
async function loadBusboy(): Promise<BusboyFactory> {
  try {
    const module = (await import("busboy")) as unknown as {
      default?: BusboyFactory;
    } & BusboyFactory;
    return module.default ?? module;
  } catch {
    throw new Error(BUSBOY_HINT);
  }
}

/**
 * Raised when a submission exceeds a configured multipart limit.
 *
 * Distinct from a parse failure so the caller can turn it into a `400` with a
 * message the operator can act on ("the file is too large") instead of a
 * generic failure.
 */
export class MultipartLimitError extends Error {
  /**
   * @param message - The operator-facing explanation.
   */
  constructor(message: string) {
    super(message);
    this.name = "MultipartLimitError";
  }
}

/**
 * Parse a `multipart/form-data` request body.
 *
 * Files are buffered in memory, which is what the admin needs — an operator
 * attaching a document or a CSV, not a streaming ingest path — and bounded by
 * `maxFileBytes` so a large upload cannot exhaust the process.
 *
 * @param req - The inbound request.
 * @param options - Size and count limits.
 * @returns The text fields and the uploaded files.
 * @throws MultipartLimitError When a limit is exceeded.
 * @throws Error When `busboy` is missing or the body is not valid multipart.
 */
export async function parseMultipart(
  req: Request,
  options: ParseMultipartOptions = {},
): Promise<ParsedMultipart> {
  const maxFileBytes = options.maxFileBytes ?? 10 * 1024 * 1024;
  const maxFiles = options.maxFiles ?? 10;
  const busboy = await loadBusboy();

  return await new Promise<ParsedMultipart>((resolve, reject) => {
    const fields: Record<string, string> = {};
    const files: UploadedFile[] = [];
    let settled = false;

    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    const parser = busboy({
      headers: req.headers,
      limits: { fileSize: maxFileBytes, files: maxFiles },
    });

    parser.on("field", ((name: string, value: string) => {
      fields[name] = value;
    }) as never);

    parser.on("file", ((
      name: string,
      stream: NodeJS.ReadableStream & { on(event: string, handler: () => void): unknown },
      info: { filename?: string; mimeType?: string },
    ) => {
      const chunks: Buffer[] = [];
      stream.on("data", ((chunk: Buffer) => chunks.push(chunk)) as never);
      stream.on("limit", () => {
        fail(
          new MultipartLimitError(
            `The file is larger than the ${Math.floor(maxFileBytes / 1024 / 1024)} MB limit.`,
          ),
        );
      });
      stream.on("end", () => {
        const data = Buffer.concat(chunks);
        const filename = (info.filename ?? "").split(/[/\\]/).pop() ?? "";
        if (filename === "" || data.length === 0) return;
        files.push({
          field: name,
          filename,
          contentType: info.mimeType ?? "application/octet-stream",
          data,
        });
      });
    }) as never);

    parser.on("filesLimit", () => {
      fail(new MultipartLimitError(`At most ${maxFiles} files can be uploaded at once.`));
    });
    parser.on("error", ((error: unknown) => {
      fail(error instanceof Error ? error : new Error(String(error)));
    }) as never);
    parser.on("close", () => {
      if (settled) return;
      settled = true;
      resolve({ fields, files });
    });

    req.pipe(parser);
  });
}

/**
 * Whether a request carries a multipart body.
 *
 * @param req - The inbound request.
 * @returns `true` when the content type is `multipart/form-data`.
 */
export function isMultipart(req: Request): boolean {
  return (req.header("content-type") ?? "")
    .toLowerCase()
    .startsWith("multipart/form-data");
}
