import * as core from '@actions/core';
import * as fs from 'fs';
import * as path from 'path';
import {
  API_BASE_URL,
  ChunkUploadFinishResponse,
  ChunkUploadInitResponse,
  ChunkUploadStatusResponse,
  DirectUploadInitResponse,
  ErrorResponse,
  MultipleUploadResponse,
  ResourceMutationData,
  ResourceResponse,
  ResourceVersionData,
  ResourceVersionResponse,
  UploadImageResponse,
  UploadResponse,
  UploadStrategy,
  VersionTag
} from './types';

export interface ApiRequestOptions {
  timeoutMs?: number;
  retries?: number;
  chunkSizeBytes?: number;
  pollIntervalMs?: number;
}

const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;
const DEFAULT_CHUNK_SIZE_BYTES = 8 * 1024 * 1024;
const MAX_CHUNK_SIZE_BYTES = 20 * 1024 * 1024;

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly code?: string,
    public readonly responseBody?: unknown
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getMimeType(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  const mimeTypes: Record<string, string> = {
    '.jar': 'application/java-archive',
    '.zip': 'application/zip',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp'
  };
  return mimeTypes[extension] || 'application/octet-stream';
}

function getFileDetails(filePath: string): { fileName: string; size: number; mimeType: string } {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const stat = fs.statSync(filePath);
  if (!stat.isFile()) {
    throw new Error(`Path is not a file: ${filePath}`);
  }

  return {
    fileName: path.basename(filePath),
    size: stat.size,
    mimeType: getMimeType(filePath)
  };
}

async function parseResponseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return undefined;

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function errorMessageFromBody(body: unknown, fallback: string): string {
  if (body && typeof body === 'object') {
    const error = body as ErrorResponse;
    if (typeof error.error === 'string' && error.error) return error.error;
    if (typeof error.message === 'string' && error.message) return error.message;
  }
  if (typeof body === 'string' && body.trim()) return body.trim();
  return fallback;
}

function errorCodeFromBody(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const code = (body as ErrorResponse).code;
  return typeof code === 'string' ? code : undefined;
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status === 502 || status === 503 || status === 504;
}

function retryDelayMs(response: Response | undefined, attempt: number): number {
  const retryAfter = response?.headers.get('retry-after');
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  }
  return Math.min(1000 * (2 ** attempt), 5000);
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if ((error as Error).name === 'AbortError') {
      throw new ApiError(`Request timed out after ${Math.round(timeoutMs / 1000)} seconds`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function requestJson<T>(
  url: string,
  init: RequestInit,
  options: ApiRequestOptions = {}
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retries = options.retries ?? 0;

  for (let attempt = 0; ; attempt += 1) {
    let response: Response | undefined;
    try {
      response = await fetchWithTimeout(url, init, timeoutMs);
      const body = await parseResponseBody(response);

      if (response.ok) return body as T;

      if (attempt < retries && isRetryableStatus(response.status)) {
        await sleep(retryDelayMs(response, attempt));
        continue;
      }

      const responseMessage = errorMessageFromBody(body, response.statusText || 'Request failed');
      const code = errorCodeFromBody(body);
      throw new ApiError(
        `${responseMessage} (HTTP ${response.status}${code ? `, ${code}` : ''})`,
        response.status,
        code,
        body
      );
    } catch (error) {
      if (error instanceof ApiError && error.status !== undefined) throw error;
      if (attempt >= retries) throw error;
      await sleep(retryDelayMs(response, attempt));
    }
  }
}

function authorizationHeaders(apiToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiToken}`,
    Accept: 'application/json'
  };
}

function assertUploadResponse(data: UploadResponse, context: string): UploadResponse {
  if (!data || typeof data.url !== 'string' || typeof data.filename !== 'string' || typeof data.size !== 'number') {
    throw new Error(`${context} returned an invalid upload response`);
  }
  return data;
}

/** Upload one file through the ordinary multipart endpoint. */
export async function uploadFileStandard(
  apiToken: string,
  filePath: string,
  options: ApiRequestOptions = {}
): Promise<UploadResponse> {
  const { fileName, mimeType } = getFileDetails(filePath);
  core.info(`Uploading file through the standard endpoint: ${fileName}`);

  const formData = new FormData();
  const blob = await fs.openAsBlob(filePath, { type: mimeType });
  formData.append('file', blob, fileName);

  const data = await requestJson<UploadResponse>(`${API_BASE_URL}/upload`, {
    method: 'POST',
    headers: authorizationHeaders(apiToken),
    body: formData
  }, { ...options, retries: options.retries ?? 1 });

  return assertUploadResponse(data, 'Standard upload');
}

/** Upload one file using the preferred direct-upload handshake. */
export async function uploadFileDirect(
  apiToken: string,
  filePath: string,
  options: ApiRequestOptions = {}
): Promise<UploadResponse> {
  const { fileName, size, mimeType } = getFileDetails(filePath);
  core.info(`Initializing direct upload: ${fileName}`);

  const init = await requestJson<DirectUploadInitResponse>(`${API_BASE_URL}/upload/direct/init`, {
    method: 'POST',
    headers: {
      ...authorizationHeaders(apiToken),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ filename: fileName, size, mimetype: mimeType, type: 'files' })
  }, { ...options, retries: options.retries ?? 1 });

  if (!init?.uploadUrl || !init.method || !init.key || !init.bucketId) {
    throw new Error('Direct upload initialization returned an invalid response');
  }

  const blob = await fs.openAsBlob(filePath, { type: mimeType });
  const uploadResponse = await fetchWithTimeout(init.uploadUrl, {
    method: init.method,
    headers: init.headers,
    body: blob
  }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  if (!uploadResponse.ok) {
    const body = await parseResponseBody(uploadResponse);
    throw new ApiError(
      `Direct file transfer failed: ${errorMessageFromBody(body, uploadResponse.statusText)}`,
      uploadResponse.status,
      errorCodeFromBody(body),
      body
    );
  }

  const completed = await requestJson<UploadResponse>(`${API_BASE_URL}/upload/direct/complete`, {
    method: 'POST',
    headers: {
      ...authorizationHeaders(apiToken),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      bucketId: init.bucketId,
      key: init.key,
      filename: init.filename || fileName,
      size
    })
  }, { ...options, retries: options.retries ?? 1 });

  return assertUploadResponse(completed, 'Direct upload confirmation');
}

function isFileTooLargeError(error: unknown): boolean {
  if (error instanceof ApiError && error.status === 413) return true;
  const message = (error as Error)?.message || '';
  return /too large|file size|maximum size|文件.*(?:过大|太大)|超过.*(?:限制|大小)/i.test(message);
}

/** Upload one file in bounded-memory chunks and poll asynchronous merge status. */
export async function uploadFileInChunks(
  apiToken: string,
  filePath: string,
  options: ApiRequestOptions = {}
): Promise<UploadResponse> {
  const { fileName, size, mimeType } = getFileDetails(filePath);
  const requestedChunkSize = options.chunkSizeBytes ?? DEFAULT_CHUNK_SIZE_BYTES;
  if (!Number.isInteger(requestedChunkSize) || requestedChunkSize <= 0 || requestedChunkSize > MAX_CHUNK_SIZE_BYTES) {
    throw new Error('Chunk size must be an integer between 1 byte and 20 MB');
  }

  const requestedTotalChunks = Math.max(1, Math.ceil(size / requestedChunkSize));
  core.info(`Initializing chunk upload: ${fileName} (${requestedTotalChunks} chunks)`);

  const init = await requestJson<ChunkUploadInitResponse>(`${API_BASE_URL}/upload/session/init`, {
    method: 'POST',
    headers: {
      ...authorizationHeaders(apiToken),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      filename: fileName,
      size,
      chunkSize: requestedChunkSize,
      totalChunks: requestedTotalChunks,
      mimetype: mimeType
    })
  }, { ...options, retries: options.retries ?? 1 });

  if (!init?.uploadId || !Number.isInteger(init.chunkSize) || !Number.isInteger(init.totalChunks)) {
    throw new Error('Chunk upload initialization returned an invalid response');
  }

  const fileBlob = await fs.openAsBlob(filePath, { type: mimeType });
  try {
    for (let index = 0; index < init.totalChunks; index += 1) {
      const start = index * init.chunkSize;
      const end = Math.min(start + init.chunkSize, size);
      const chunk = fileBlob.slice(start, end, mimeType);
      const formData = new FormData();
      formData.append('chunk', chunk, `${fileName}.part-${index}`);

      await requestJson<unknown>(`${API_BASE_URL}/upload/session/${init.uploadId}/part/${index}`, {
        method: 'POST',
        headers: authorizationHeaders(apiToken),
        body: formData
      }, { ...options, retries: options.retries ?? 2 });
      core.info(`Uploaded chunk ${index + 1}/${init.totalChunks}: ${fileName}`);
    }

    const finish = await requestJson<ChunkUploadFinishResponse>(
      `${API_BASE_URL}/upload/session/${init.uploadId}/finish`,
      { method: 'POST', headers: authorizationHeaders(apiToken) },
      { ...options, retries: options.retries ?? 1 }
    );

    if (finish?.url && finish.filename && typeof finish.size === 'number') {
      return assertUploadResponse(finish as UploadResponse, 'Chunk upload completion');
    }

    const deadline = Date.now() + (options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const pollIntervalMs = options.pollIntervalMs ?? 2000;
    while (Date.now() < deadline) {
      const status = await requestJson<ChunkUploadStatusResponse>(
        `${API_BASE_URL}/upload/session/${init.uploadId}/status`,
        { method: 'GET', headers: authorizationHeaders(apiToken) },
        { ...options, retries: options.retries ?? 2 }
      );

      if (status.status === 'completed' && status.result) {
        return assertUploadResponse(status.result, 'Chunk upload status');
      }
      if (status.status === 'failed') {
        throw new Error(`Chunk upload merge failed: ${status.error || 'unknown error'}`);
      }

      await sleep(pollIntervalMs);
    }

    throw new Error(`Chunk upload merge timed out after ${Math.round((options.timeoutMs ?? DEFAULT_TIMEOUT_MS) / 1000)} seconds`);
  } catch (error) {
    try {
      await requestJson<unknown>(`${API_BASE_URL}/upload/session/${init.uploadId}`, {
        method: 'DELETE',
        headers: authorizationHeaders(apiToken)
      }, { ...options, retries: 0 });
    } catch {
      core.warning(`Unable to cancel failed upload session ${init.uploadId}`);
    }
    throw error;
  }
}

/** Upload one file using a selected strategy. Auto follows the official fallback flow. */
export async function uploadFile(
  apiToken: string,
  filePath: string,
  strategy: UploadStrategy = 'auto',
  options: ApiRequestOptions = {}
): Promise<UploadResponse> {
  if (strategy === 'direct') return uploadFileDirect(apiToken, filePath, options);
  if (strategy === 'standard') return uploadFileStandard(apiToken, filePath, options);
  if (strategy === 'chunk') return uploadFileInChunks(apiToken, filePath, options);

  try {
    return await uploadFileDirect(apiToken, filePath, options);
  } catch (directError) {
    core.warning(`Direct upload unavailable; falling back to standard upload: ${(directError as Error).message}`);
  }

  try {
    return await uploadFileStandard(apiToken, filePath, options);
  } catch (standardError) {
    if (!isFileTooLargeError(standardError)) throw standardError;
    core.warning(`Standard upload rejected the file size; falling back to chunk upload: ${(standardError as Error).message}`);
    return uploadFileInChunks(apiToken, filePath, options);
  }
}

/** Upload files one by one so each can use direct upload and fallback independently. */
export async function uploadFiles(
  apiToken: string,
  filePaths: string[],
  strategy: UploadStrategy = 'auto',
  options: ApiRequestOptions = {}
): Promise<UploadResponse[]> {
  const results: UploadResponse[] = [];
  for (const filePath of filePaths) {
    results.push(await uploadFile(apiToken, filePath, strategy, options));
  }
  return results;
}

/** Retained for clients that explicitly need the simple multiple-upload endpoint. */
export async function uploadFilesMultiple(
  apiToken: string,
  filePaths: string[],
  options: ApiRequestOptions = {}
): Promise<UploadResponse[]> {
  if (filePaths.length === 0) return [];

  const formData = new FormData();
  for (const filePath of filePaths) {
    const { fileName, mimeType } = getFileDetails(filePath);
    formData.append('file', await fs.openAsBlob(filePath, { type: mimeType }), fileName);
  }

  const data = await requestJson<MultipleUploadResponse>(`${API_BASE_URL}/upload/multiple`, {
    method: 'POST',
    headers: authorizationHeaders(apiToken),
    body: formData
  }, { ...options, retries: options.retries ?? 1 });

  if (!data || !Array.isArray(data.files)) throw new Error('Multiple upload returned an invalid response');
  return data.files.map((file) => assertUploadResponse(file, 'Multiple upload'));
}

export async function uploadImage(
  apiToken: string,
  imagePath: string,
  purpose: 'content' | 'cover' | 'icon' = 'cover',
  options: ApiRequestOptions = {}
): Promise<UploadImageResponse> {
  const { fileName, mimeType } = getFileDetails(imagePath);
  core.info(`Uploading ${purpose} image: ${fileName}`);

  const formData = new FormData();
  formData.append('purpose', purpose);
  formData.append('file', await fs.openAsBlob(imagePath, { type: mimeType }), fileName);

  const data = await requestJson<UploadImageResponse>(`${API_BASE_URL}/upload/image`, {
    method: 'POST',
    headers: authorizationHeaders(apiToken),
    body: formData
  }, { ...options, retries: options.retries ?? 1 });

  if (!data || typeof data.url !== 'string') throw new Error('Image upload returned an invalid response');
  return data;
}

export async function getVersionTags(options: ApiRequestOptions = {}): Promise<VersionTag[]> {
  const tags = await requestJson<VersionTag[]>(`${API_BASE_URL}/resources/version-tags`, {
    method: 'GET',
    headers: { Accept: 'application/json' }
  }, { ...options, retries: options.retries ?? 2 });

  if (!Array.isArray(tags)) throw new Error('Version tag endpoint returned an invalid response');
  return tags;
}

export async function createResource(
  apiToken: string,
  createData: ResourceMutationData,
  options: ApiRequestOptions = {}
): Promise<ResourceResponse> {
  core.info('Creating NexusMC resource');
  return requestJson<ResourceResponse>(`${API_BASE_URL}/resources`, {
    method: 'POST',
    headers: {
      ...authorizationHeaders(apiToken),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(createData)
  }, { ...options, retries: 0 });
}

export async function updateResource(
  apiToken: string,
  resourceId: string,
  updateData: ResourceMutationData,
  options: ApiRequestOptions = {}
): Promise<ResourceResponse> {
  core.info(`Updating resource: ${resourceId}`);
  return requestJson<ResourceResponse>(`${API_BASE_URL}/resources/${resourceId}`, {
    method: 'PATCH',
    headers: {
      ...authorizationHeaders(apiToken),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(updateData)
  }, { ...options, retries: 0 });
}

export async function createResourceVersion(
  apiToken: string,
  resourceId: string,
  versionData: ResourceVersionData,
  options: ApiRequestOptions = {}
): Promise<ResourceVersionResponse> {
  core.info(`Publishing version for resource: ${resourceId}`);
  return requestJson<ResourceVersionResponse>(`${API_BASE_URL}/resources/${resourceId}/versions`, {
    method: 'POST',
    headers: {
      ...authorizationHeaders(apiToken),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(versionData)
  }, { ...options, retries: 0 });
}

/** Parse a JSON array input. Invalid or non-array values fail explicitly. */
export function parseJsonArrayInput(input: string | undefined, name = 'input'): unknown[] | undefined {
  if (!input) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch {
    throw new Error(`${name} must be valid JSON`);
  }
  if (!Array.isArray(parsed)) throw new Error(`${name} must be a JSON array`);
  return parsed;
}

/** Parse any JSON value while allowing plain strings for content/changelog fields. */
export function parseJsonOrStringInput(input: string | undefined): unknown {
  if (!input) return undefined;
  try {
    return JSON.parse(input);
  } catch {
    return input;
  }
}

/** Parse an object-valued JSON input. */
export function parseJsonObjectInput(input: string | undefined, name: string): Record<string, unknown> | undefined {
  if (!input) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch {
    throw new Error(`${name} must be valid JSON`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${name} must be a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

// Backward-compatible export for source consumers. New code should use parseJsonArrayInput.
export const parseJsonInput = parseJsonArrayInput;
