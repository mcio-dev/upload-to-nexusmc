export type IfNoFilesFound = 'warn' | 'error' | 'ignore';

export type Operation = 'auto' | 'create' | 'update' | 'publish-version';

export type UploadStrategy = 'auto' | 'direct' | 'standard' | 'chunk';

export interface Inputs {
  apiToken: string;
  operation: Operation;
  resourceId?: string;
  resourceData?: ResourceMutationData;
  versionData?: ResourceVersionData;
  filePath?: string;
  files?: ResourceFileInput[];
  ifNoFilesFound: IfNoFilesFound;
  uploadStrategy: UploadStrategy;
  chunkSizeBytes: number;
  requestTimeoutMs: number;
  title?: string;
  description?: string;
  content?: unknown;
  contentMarkdown?: string;
  contentMarkdownPath?: string;
  category?: string;
  platform?: string;
  version?: string;
  versionTag?: string;
  versionTitle?: string;
  changelog?: unknown;
  changelogMarkdown?: string;
  changelogMarkdownPath?: string;
  markdownLinkBaseUrl?: string;
  markdownImageBaseUrl?: string;
  publishVersion?: boolean;
  downloadType?: 'local' | 'external';
  mcVersions?: unknown[];
  tags?: unknown[];
  officialTags?: unknown[];
  coverImagePath?: string;
  tutorialPostIds?: unknown[];
  documentationPostRefs?: unknown[];
  documentationUrl?: string;
  dependencies?: unknown[];
  isDraft?: boolean;
}

export interface ResourceFileInput {
  path: string;
  isPrimary?: boolean;
  isMain?: boolean;
  primary?: boolean;
  subcategoryIds?: string[];
  loaderIds?: string[];
  gameVersions?: string[];
  mcVersions?: string[];
  extractCode?: string;
  sha256?: string;
  sha1?: string;
  [key: string]: unknown;
}

export interface UploadedResourceFile {
  url: string;
  fileName: string;
  fileSize: number;
  isPrimary?: boolean;
  subcategoryIds?: string[];
  loaderIds?: string[];
  gameVersions?: string[];
  mcVersions?: string[];
  extractCode?: string;
  sha256?: string;
  sha1?: string;
  [key: string]: unknown;
}

export interface UploadResponse {
  url: string;
  filename: string;
  size: number;
  sha256?: string;
  sha1?: string;
  key?: string;
  bucketId?: string;
}

export interface MultipleUploadResponse {
  files: UploadResponse[];
}

export interface UploadImageResponse {
  url: string;
  thumbnailUrl?: string;
  originalSize: number;
  optimizedSize?: number;
}

export interface DirectUploadInitResponse {
  uploadUrl: string;
  method: string;
  headers: Record<string, string>;
  expiresIn: number;
  key: string;
  url: string;
  bucketId: string;
  filename: string;
  size: number;
  mimetype?: string;
  maxFileSizeMb?: number;
}

export interface ChunkUploadInitResponse {
  uploadId: string;
  chunkSize: number;
  totalChunks: number;
  maxFileSizeMb?: number;
  chunkThresholdMb?: number;
}

export interface ChunkUploadFinishResponse {
  processing?: boolean;
  uploadId?: string;
  url?: string;
  filename?: string;
  size?: number;
  sha256?: string;
  sha1?: string;
}

export interface ChunkUploadStatusResponse {
  status: 'pending' | 'processing' | 'completed' | 'failed';
  result?: UploadResponse;
  error?: string;
  startedAt?: string;
  updatedAt?: string;
}

export interface VersionTag {
  key: string;
  label: string;
  enabled: boolean;
  sortOrder: number;
}

export interface ResourceMutationData {
  [key: string]: unknown;
}

export interface ResourceVersionData {
  version?: string;
  versionTag?: string;
  title?: string;
  changelog?: unknown;
  downloadType?: 'local' | 'external';
  files?: UploadedResourceFile[];
  mcVersions?: unknown[];
  [key: string]: unknown;
}

export interface ResourceResponse {
  id: string;
  title?: string;
  status?: string;
  platform?: string;
  category?: string;
  version?: string;
  versionId?: string;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

export interface ResourceVersionResponse {
  id: string;
  resourceId?: string;
  version?: string;
  status?: string;
  [key: string]: unknown;
}

export interface ErrorResponse {
  error?: string;
  message?: string;
  code?: string;
  requiredScope?: string;
  [key: string]: unknown;
}

export const API_BASE_URL = 'https://www.nexusmc.cn/api';
export const SITE_BASE_URL = 'https://www.nexusmc.cn';

// Kept for source compatibility with earlier releases.
export const BASE_URL = API_BASE_URL;
