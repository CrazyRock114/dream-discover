/**
 * Cloudflare R2 (S3-compatible) Storage Client
 */
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const R2_ENDPOINT = process.env.R2_ENDPOINT || "";
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID || "";
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY || "";
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME || "";
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || "";

if (!R2_ENDPOINT) {
  console.warn("[r2-storage] R2_ENDPOINT is not set. File uploads will fail.");
}

// R2 client (lazy init)
let r2Client: S3Client | null = null;
function getR2Client(): S3Client {
  if (!r2Client) {
    if (!R2_ENDPOINT || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
      throw new Error("R2 存储未配置。请设置 R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY 环境变量");
    }
    r2Client = new S3Client({
      region: "auto",
      endpoint: R2_ENDPOINT,
      credentials: {
        accessKeyId: R2_ACCESS_KEY_ID,
        secretAccessKey: R2_SECRET_ACCESS_KEY,
      },
    });
  }
  return r2Client;
}

/**
 * Upload a file
 * Returns the storage key
 */
export async function uploadFile(params: {
  fileContent: Buffer;
  fileName: string;
  contentType?: string;
}): Promise<string> {
  const uuidPrefix = crypto.randomUUID().split("-")[0];
  const key = `${uuidPrefix}_${params.fileName}`;

  await getR2Client().send(
    new PutObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: key,
      Body: params.fileContent,
      ContentType: params.contentType,
    })
  );
  return key;
}

/**
 * Generate a presigned URL for file access
 */
export async function generatePresignedUrl(params: {
  key: string;
  expireTime?: number;
}): Promise<string> {
  if (R2_PUBLIC_URL) {
    return `${R2_PUBLIC_URL}/${params.key}`;
  }

  const command = new GetObjectCommand({
    Bucket: R2_BUCKET_NAME,
    Key: params.key,
  });

  return getSignedUrl(getR2Client(), command, {
    expiresIn: params.expireTime || 86400,
  });
}

/**
 * Read a file from storage
 */
export async function readFile(params: { key: string }): Promise<Buffer> {
  const response = await getR2Client().send(
    new GetObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: params.key,
    })
  );
  const bytes = await response.Body?.transformToByteArray();
  return Buffer.from(bytes || []);
}

/**
 * Delete a file from storage
 */
export async function deleteFile(params: { key: string }): Promise<boolean> {
  await getR2Client().send(
    new DeleteObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: params.key,
    })
  );
  return true;
}

/**
 * Check if a file exists in storage
 */
export async function fileExists(params: { key: string }): Promise<boolean> {
  try {
    await getR2Client().send(
      new HeadObjectCommand({
        Bucket: R2_BUCKET_NAME,
        Key: params.key,
      })
    );
    return true;
  } catch {
    return false;
  }
}
