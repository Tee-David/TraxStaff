import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// Cloudflare R2 is S3-compatible. Screenshots are uploaded directly by the
// desktop client via a presigned PUT (bypassing the API for bandwidth) and
// viewed via short-lived presigned GET URLs. Nothing is public.

const endpoint = process.env.R2_ENDPOINT;
const accessKeyId = process.env.R2_ACCESS_KEY_ID;
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
export const R2_BUCKET = process.env.R2_BUCKET_NAME ?? "trax";

export const r2Configured = Boolean(endpoint && accessKeyId && secretAccessKey);

const client = r2Configured
  ? new S3Client({
      region: "auto",
      endpoint,
      credentials: { accessKeyId: accessKeyId!, secretAccessKey: secretAccessKey! },
    })
  : null;

export async function presignPut(key: string, contentType = "image/webp"): Promise<string> {
  if (!client) throw new Error("R2 not configured");
  return getSignedUrl(client, new PutObjectCommand({ Bucket: R2_BUCKET, Key: key, ContentType: contentType }), {
    expiresIn: 600, // 10 min to complete the upload
  });
}

export async function presignGet(key: string): Promise<string> {
  if (!client) throw new Error("R2 not configured");
  return getSignedUrl(client, new GetObjectCommand({ Bucket: R2_BUCKET, Key: key }), { expiresIn: 3600 });
}

export async function deleteObject(key: string): Promise<void> {
  if (!client) return;
  await client.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: key }));
}
