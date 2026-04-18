/**
 * Cloudflare R2 (S3-compatible) Storage Client
 * Supports two modes:
 * 1. R2_ENDPOINT is set → use Cloudflare R2 via AWS SDK
 * 2. R2_ENDPOINT is not set → fall back to coze-coding-dev-sdk S3Storage (sandbox)
 */
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { S3Storage } from "coze-coding-dev-sdk";

const R2_ENDPOINT = process.env.R2_ENDPOINT || "";
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID || "";
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY || "";
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME || "";
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || "";

const useR2 = !!R2_ENDPOINT;

// R2 client (lazy init)
let r2Client: S3Client | null = null;
function getR2Client(): S3Client {
  if (!r2Client) {
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

// Coze SDK fallback
let cozeStorage: S3Storage | null = null;
function getCozeStorage(): S3Storage {
  if (!cozeStorage) {
    cozeStorage = new S3Storage({
      endpointUrl: process.env.COZE_BUCKET_ENDPOINT_URL,
      accessKey: "",
      secretKey: "",
      bucketName: process.env.COZE_BUCKET_NAME,
      region: "cn-beijing",
    });
  }
  return cozeStorage;
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
  if (useR2) {
    // Add UUID prefix to avoid filename conflicts
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
  } else {
    return getCozeStorage().uploadFile(params);
  }
}

/**
 * Generate a presigned URL for file access
 */
export async function generatePresignedUrl(params: {
  key: string;
  expireTime?: number;
}): Promise<string> {
  if (useR2) {
    // If R2_PUBLIC_URL is configured, use it directly (for public buckets)
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
  } else {
    return getCozeStorage().generatePresignedUrl({ key: params.key, expireTime: params.expireTime });
  }
}

/**
 * Read a file from storage
 */
export async function readFile(params: { key: string }): Promise<Buffer> {
  if (useR2) {
    const response = await getR2Client().send(
      new GetObjectCommand({
        Bucket: R2_BUCKET_NAME,
        Key: params.key,
      })
    );
    const bytes = await response.Body?.transformToByteArray();
    return Buffer.from(bytes || []);
  } else {
    return getCozeStorage().readFile({ fileKey: params.key });
  }
}

/**
 * Delete a file from storage
 */
export async function deleteFile(params: { key: string }): Promise<boolean> {
  if (useR2) {
    await getR2Client().send(
      new DeleteObjectCommand({
        Bucket: R2_BUCKET_NAME,
        Key: params.key,
      })
    );
    return true;
  } else {
    return getCozeStorage().deleteFile({ fileKey: params.key });
  }
}

/**
 * Check if a file exists in storage
 */
export async function fileExists(params: { key: string }): Promise<boolean> {
  if (useR2) {
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
  } else {
    return getCozeStorage().fileExists({ fileKey: params.key });
  }
}
