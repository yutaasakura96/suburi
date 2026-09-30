import type { Readable } from "node:stream";
import { S3Client } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";

/**
 * Where a dump is written: one object per key, streamed. The port the daily dump writes through, so
 * tests use `fake-store.ts` and never reach S3 (#56).
 */
export interface BackupStore {
  /** Resolves once the whole body is stored under `key`; rejects, storing nothing usable, otherwise. */
  put(key: string, body: Readable): Promise<void>;
}

export interface S3BackupStoreOptions {
  readonly region: string;
  readonly bucket: string;
  /** The backup-writer IAM user's key: exactly `s3:PutObject` on `backups/*` (12 §3 step 5). */
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
}

/**
 * S3, SSE-S3 encrypted. The body is sent a part at a time: a dump under 5 MB is one PutObject, a
 * larger one a multipart upload holding at most `queueSize` parts in memory, never the whole dump.
 */
export function s3BackupStore(options: S3BackupStoreOptions): BackupStore {
  const client = new S3Client({
    region: options.region,
    credentials: { accessKeyId: options.accessKeyId, secretAccessKey: options.secretAccessKey },
  });
  return {
    async put(key, body) {
      await new Upload({
        client,
        params: {
          Bucket: options.bucket,
          Key: key,
          Body: body,
          ContentType: "application/sql",
          ServerSideEncryption: "AES256",
        },
        queueSize: 2,
        // The user may not call AbortMultipartUpload (06, #56). Trying would replace the upload's own
        // error with AccessDenied; the parts of a failed multipart upload stay, unlisted and unread.
        leavePartsOnError: true,
      }).done();
    },
  };
}
