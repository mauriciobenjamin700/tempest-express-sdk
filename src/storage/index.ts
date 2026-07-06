/** Object-storage primitives: interface + filesystem backend. */

export {
  LocalUploadStorage,
  type LocalUploadStorageOptions,
  type SaveOptions,
  type UploadResult,
  type UploadStorage,
  buildContentDisposition,
} from "@/storage/local";
export {
  type S3ClientLike,
  S3UploadStorage,
  type S3UploadStorageOptions,
} from "@/storage/s3";
