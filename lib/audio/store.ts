import { GetObjectCommand, NoSuchKey, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/**
 * Where takes live (03 §3, 07 §5.6). **Audio goes browser → S3 directly** through a presigned PUT: a
 * Vercel Function caps bodies at 4.5 MB and a four-minute take can exceed it. The server only presigns
 * and, for transcription, reads the object back. **The client never chooses the key.** A port, so
 * tests use `fake-store.ts` and never reach S3.
 */
export interface PresignedUpload {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly expiresAt: Date;
}

export interface AudioStore {
  /** A PUT for exactly `bytes` bytes of `contentType` to `key`, signed so S3 refuses anything else. */
  presignPut(key: string, upload: { contentType: string; bytes: number }): Promise<PresignedUpload>;
  /** The stored take, or null when nothing was ever PUT at `key`. */
  get(key: string): Promise<Uint8Array | null>;
}

/** 07 §5.6: `{prefix}/{user_id}/{round_id}/{answer_id}.webm`. `S3_PREFIX` already ends in `/`. */
export function answerAudioKey(prefix: string, userId: string, roundId: string, answerId: string) {
  return `${prefix}${userId}/${roundId}/${answerId}.webm`;
}

/** A presigned PUT lives long enough for a four-minute take on a slow connection, and no longer. */
const UPLOAD_EXPIRES_SECONDS = 900;

export interface S3AudioStoreOptions {
  readonly region: string;
  readonly bucket: string;
  /** The environment's IAM user: `s3:PutObject` and `s3:GetObject` on its own prefix only (12 §3 step 5). */
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  /** Playwright's mock only (`lib/config.ts` refuses anything but a local host). */
  readonly endpoint?: string;
}

export function s3AudioStore(options: S3AudioStoreOptions): AudioStore {
  const client = new S3Client({
    region: options.region,
    credentials: { accessKeyId: options.accessKeyId, secretAccessKey: options.secretAccessKey },
    ...(options.endpoint ? { endpoint: options.endpoint, forcePathStyle: true } : {}),
  });
  return {
    async presignPut(key, { contentType, bytes }) {
      const command = new PutObjectCommand({
        Bucket: options.bucket,
        Key: key,
        ContentType: contentType,
        ContentLength: bytes,
      });
      // Content-Length is signed too, so the PUT must carry exactly the size the slot was opened for.
      // The browser sets it itself; the CORS rule allows `content-type` only, and needs nothing more.
      const url = await getSignedUrl(client, command, {
        expiresIn: UPLOAD_EXPIRES_SECONDS,
        signableHeaders: new Set(["content-type", "content-length"]),
      });
      return {
        url,
        headers: { "Content-Type": contentType },
        expiresAt: new Date(Date.now() + UPLOAD_EXPIRES_SECONDS * 1000),
      };
    },
    async get(key) {
      try {
        const object = await client.send(new GetObjectCommand({ Bucket: options.bucket, Key: key }));
        return object.Body ? await object.Body.transformToByteArray() : null;
      } catch (error) {
        if (error instanceof NoSuchKey) return null;
        throw error;
      }
    },
  };
}
