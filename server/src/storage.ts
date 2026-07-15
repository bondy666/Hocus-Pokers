// Upload storage abstraction.
//
// In production, uploads (tournament photos + member avatars) are stored in
// Azure Blob Storage so they survive app restarts, redeploys and app
// recreation. Access uses the App Service managed identity (no secrets) — set
// AZURE_STORAGE_ACCOUNT (and optionally AZURE_STORAGE_CONTAINER, default
// "uploads"). When no account is configured (e.g. local dev) it falls back to
// the local filesystem under UPLOAD_DIR / $HOME/data/uploads.

import fs from "fs";
import path from "path";
import { BlobServiceClient, type ContainerClient } from "@azure/storage-blob";
import { DefaultAzureCredential } from "@azure/identity";

const account = process.env.AZURE_STORAGE_ACCOUNT;
const containerName = process.env.AZURE_STORAGE_CONTAINER || "uploads";

const localDir =
  process.env.UPLOAD_DIR ||
  (process.env.HOME
    ? path.join(process.env.HOME, "data", "uploads")
    : path.join(process.cwd(), "uploads"));

let container: ContainerClient | null = null;

if (account) {
  const service = new BlobServiceClient(
    `https://${account}.blob.core.windows.net`,
    new DefaultAzureCredential()
  );
  container = service.getContainerClient(containerName);
  console.log(`Uploads: Azure Blob Storage (account=${account}, container=${containerName})`);
} else {
  try {
    fs.mkdirSync(localDir, { recursive: true });
  } catch (err) {
    console.error("Could not create upload directory", localDir, err);
  }
  console.log(`Uploads: local filesystem (${localDir})`);
}

export const usingBlobStorage = container !== null;

/** Persist an uploaded file's bytes under the given name. */
export async function saveUpload(
  filename: string,
  data: Buffer,
  contentType?: string
): Promise<void> {
  if (container) {
    await container.getBlockBlobClient(filename).uploadData(data, {
      blobHTTPHeaders: { blobContentType: contentType || "application/octet-stream" },
    });
  } else {
    await fs.promises.writeFile(path.join(localDir, filename), data);
  }
}

/**
 * Open a stored upload for streaming to a response. Returns null when the file
 * does not exist.
 */
export async function openUpload(
  filename: string
): Promise<{ stream: NodeJS.ReadableStream; contentType?: string } | null> {
  if (container) {
    const blob = container.getBlockBlobClient(filename);
    if (!(await blob.exists())) return null;
    const download = await blob.download();
    if (!download.readableStreamBody) return null;
    return { stream: download.readableStreamBody, contentType: download.contentType };
  }
  const filePath = path.join(localDir, filename);
  if (!fs.existsSync(filePath)) return null;
  return { stream: fs.createReadStream(filePath) };
}

/** Delete a stored upload; missing files are ignored. */
export async function deleteUpload(filename: string): Promise<void> {
  if (container) {
    await container.getBlockBlobClient(filename).deleteIfExists();
  } else {
    await fs.promises.unlink(path.join(localDir, filename)).catch(() => {});
  }
}
