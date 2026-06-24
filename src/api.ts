import * as core from '@actions/core';
import * as fs from 'fs';
import * as path from 'path';
import {
  UploadResponse,
  MultipleUploadResponse,
  UploadImageResponse,
  ResourceResponse,
  ErrorResponse,
  BASE_URL
} from './types';

/**
 * Upload a file to NexusMC
 */
export async function uploadFile(
  apiToken: string,
  filePath: string
): Promise<UploadResponse> {
  core.info(`Uploading file: ${filePath}`);

  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const fileBuffer = fs.readFileSync(filePath);
  const fileName = path.basename(filePath);

  const formData = new FormData();
  // In Node.js, we need to create a Blob from the buffer
  const blob = new Blob([fileBuffer]);
  // @ts-ignore - FormData types in Node.js
  formData.append('file', blob, fileName);

  const response = await fetch(`${BASE_URL}/upload`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiToken}`,
      'Accept': 'application/json'
    },
    body: formData as any
  });

  const data = await response.json() as UploadResponse | ErrorResponse;

  if (!response.ok) {
    const error = data as ErrorResponse;
    throw new Error(`Upload failed: ${error.error || response.statusText}`);
  }

  core.info(`File uploaded successfully: ${(data as UploadResponse).url}`);
  return data as UploadResponse;
}

/**
 * Upload multiple files to NexusMC
 */
export async function uploadFiles(
  apiToken: string,
  filePaths: string[]
): Promise<UploadResponse[]> {
  if (filePaths.length === 0) {
    return [];
  }

  if (filePaths.length === 1) {
    return [await uploadFile(apiToken, filePaths[0])];
  }

  core.info(`Uploading ${filePaths.length} files`);

  const formData = new FormData();
  for (const filePath of filePaths) {
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const fileBuffer = fs.readFileSync(filePath);
    const fileName = path.basename(filePath);
    const blob = new Blob([fileBuffer]);
    // @ts-ignore - FormData types in Node.js
    formData.append('file', blob, fileName);
  }

  const response = await fetch(`${BASE_URL}/upload/multiple`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiToken}`,
      'Accept': 'application/json'
    },
    body: formData as any
  });

  const data = await response.json() as MultipleUploadResponse | ErrorResponse;

  if (!response.ok) {
    const error = data as ErrorResponse;
    throw new Error(`Multiple upload failed: ${error.error || response.statusText}`);
  }

  const files = (data as MultipleUploadResponse).files;
  core.info(`Files uploaded successfully: ${files.map((file) => file.filename).join(', ')}`);
  return files;
}

/**
 * Upload an image to NexusMC
 */
export async function uploadImage(
  apiToken: string,
  imagePath: string
): Promise<UploadImageResponse> {
  core.info(`Uploading image: ${imagePath}`);

  if (!fs.existsSync(imagePath)) {
    throw new Error(`Image file not found: ${imagePath}`);
  }

  const fileBuffer = fs.readFileSync(imagePath);
  const fileName = path.basename(imagePath);

  const formData = new FormData();
  const blob = new Blob([fileBuffer]);
  // @ts-ignore
  formData.append('file', blob, fileName);

  const response = await fetch(`${BASE_URL}/upload/image`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiToken}`,
      'Accept': 'application/json'
    },
    body: formData as any
  });

  const data = await response.json() as UploadImageResponse | ErrorResponse;

  if (!response.ok) {
    const error = data as ErrorResponse;
    throw new Error(`Image upload failed: ${error.error || response.statusText}`);
  }

  core.info(`Image uploaded successfully: ${(data as UploadImageResponse).url}`);
  return data as UploadImageResponse;
}

/**
 * Update a resource on NexusMC
 */
export async function updateResource(
  apiToken: string,
  resourceId: string,
  updateData: Record<string, any>
): Promise<ResourceResponse> {
  core.info(`Updating resource: ${resourceId}`);

  const response = await fetch(`${BASE_URL}/resources/${resourceId}`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${apiToken}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    body: JSON.stringify(updateData)
  });

  const data = await response.json() as ResourceResponse | ErrorResponse;

  if (!response.ok) {
    const error = data as ErrorResponse;
    throw new Error(`Resource update failed: ${error.error || response.statusText} (${response.status})`);
  }

  core.info(`Resource updated successfully: ${(data as ResourceResponse).id}`);
  return data as ResourceResponse;
}

/**
 * Parse JSON string input, returns undefined if invalid
 */
export function parseJsonInput(input: string | undefined): any[] | undefined {
  if (!input) return undefined;
  
  try {
    const parsed = JSON.parse(input);
    if (Array.isArray(parsed)) {
      return parsed;
    }
    // If it's an object, wrap it in an array
    return [parsed];
  } catch {
    core.warning(`Invalid JSON input: ${input}`);
    return undefined;
  }
}
