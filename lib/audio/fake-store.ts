import type { AudioStore } from "./store";

// Tests only: an in-memory bucket. `presigned` records every key presigned, and `objects` holds what a
// test has "uploaded" with `put`, so transcription can read it back.
export function fakeAudioStore(): AudioStore & {
  presigned: { key: string; contentType: string; bytes: number }[];
  objects: Map<string, Uint8Array>;
  put(key: string, audio: Uint8Array): void;
  failPresign: boolean;
} {
  const fake = {
    presigned: [] as { key: string; contentType: string; bytes: number }[],
    objects: new Map<string, Uint8Array>(),
    failPresign: false,
    put(key: string, audio: Uint8Array) {
      fake.objects.set(key, audio);
    },
    async presignPut(key: string, upload: { contentType: string; bytes: number }) {
      if (fake.failPresign) throw new Error("presign refused");
      fake.presigned.push({ key, ...upload });
      return {
        url: `https://bucket.example.test/${key}?signature=fixture`,
        headers: { "Content-Type": upload.contentType },
        expiresAt: new Date(Date.now() + 900_000),
      };
    },
    async get(key: string) {
      return fake.objects.get(key) ?? null;
    },
  };
  return fake;
}
