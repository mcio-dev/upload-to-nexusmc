import * as core from '@actions/core';
import * as fs from 'fs';
import * as path from 'path';
import {
  ApiRequestOptions,
  createResource,
  createResourceVersion,
  getVersionTags,
  parseJsonArrayInput,
  parseJsonObjectInput,
  parseJsonOrStringInput,
  updateResource,
  uploadFiles,
  uploadImage
} from './api';
import { MarkdownConversionOptions, markdownToTiptap } from './markdown';
import {
  IfNoFilesFound,
  Inputs,
  Operation,
  ResourceFileInput,
  ResourceMutationData,
  ResourceVersionData,
  SITE_BASE_URL,
  UploadedResourceFile,
  UploadResponse,
  UploadStrategy
} from './types';

export { markdownToTiptap };
export type { MarkdownConversionOptions, TiptapDocument, TiptapMark, TiptapNode } from './markdown';

function getIfNoFilesFoundInput(): IfNoFilesFound {
  const value = core.getInput('if_no_files_found', { required: false }) || 'error';
  if (value === 'warn' || value === 'error' || value === 'ignore') return value;
  throw new Error('if_no_files_found must be one of: warn, error, ignore');
}

function getOperationInput(): Operation {
  const value = core.getInput('operation', { required: false }) || 'auto';
  if (value === 'auto' || value === 'create' || value === 'update' || value === 'publish-version') return value;
  throw new Error('operation must be one of: auto, create, update, publish-version');
}

function getUploadStrategyInput(): UploadStrategy {
  const value = core.getInput('upload_strategy', { required: false }) || 'auto';
  if (value === 'auto' || value === 'direct' || value === 'standard' || value === 'chunk') return value;
  throw new Error('upload_strategy must be one of: auto, direct, standard, chunk');
}

function getOptionalBooleanInput(name: string): boolean | undefined {
  const rawValue = core.getInput(name, { required: false });
  if (!rawValue) return undefined;
  return core.getBooleanInput(name, { required: false });
}

function getPositiveNumberInput(name: string, fallback: number): number {
  const rawValue = core.getInput(name, { required: false });
  if (!rawValue) return fallback;
  const value = Number(rawValue);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number`);
  return value;
}

function getDownloadTypeInput(): 'local' | 'external' | undefined {
  const value = core.getInput('download_type', { required: false });
  if (!value) return undefined;
  if (value === 'local' || value === 'external') return value;
  throw new Error('download_type must be one of: local, external');
}

function getOptionalInput(name: string): string | undefined {
  return core.getInput(name, { required: false }) || undefined;
}

export function parseResourceFilesInput(input: string | undefined): ResourceFileInput[] | undefined {
  if (!input) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch {
    throw new Error('files must be a valid JSON array');
  }

  if (!Array.isArray(parsed)) throw new Error('files must be a JSON array');

  return parsed.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`files[${index}] must be an object`);
    }

    const file = item as ResourceFileInput;
    if (!file.path || typeof file.path !== 'string') {
      throw new Error(`files[${index}].path is required`);
    }
    for (const primaryField of ['isPrimary', 'isMain', 'primary']) {
      const value = file[primaryField];
      if (value !== undefined && typeof value !== 'boolean') {
        throw new Error(`files[${index}].${primaryField} must be a boolean`);
      }
    }
    return file;
  });
}

export function getResourceFileInputs(inputs: Inputs): ResourceFileInput[] {
  if (inputs.files !== undefined) return inputs.files;
  if (inputs.filePath) return [{ path: inputs.filePath, isPrimary: true }];
  return [];
}

export function filterExistingResourceFileInputs(
  fileInputs: ResourceFileInput[],
  ifNoFilesFound: IfNoFilesFound
): ResourceFileInput[] {
  const existingFiles: ResourceFileInput[] = [];
  const invalidPaths: string[] = [];

  for (const file of fileInputs) {
    try {
      if (fs.statSync(file.path).isFile()) existingFiles.push(file);
      else invalidPaths.push(file.path);
    } catch {
      invalidPaths.push(file.path);
    }
  }

  if (invalidPaths.length === 0) return existingFiles;

  const message = `Provided resource file path(s) do not exist or are not files: ${invalidPaths.join(', ')}`;
  if (ifNoFilesFound === 'error') throw new Error(message);
  if (ifNoFilesFound === 'warn') core.warning(message);
  return existingFiles;
}

export function mapUploadedResourceFiles(
  fileInputs: ResourceFileInput[],
  uploadResults: UploadResponse[]
): UploadedResourceFile[] {
  if (fileInputs.length !== uploadResults.length) {
    throw new Error(`Upload result count mismatch: expected ${fileInputs.length}, got ${uploadResults.length}`);
  }

  const uploadedFiles = fileInputs.map((fileInput, index) => {
    const { path: _path, ...fileMetadata } = fileInput;
    const primary = fileInput.isPrimary ?? fileInput.isMain ?? fileInput.primary;
    delete fileMetadata.isMain;
    delete fileMetadata.primary;
    delete fileMetadata.url;
    delete fileMetadata.fileUrl;
    delete fileMetadata.filename;
    delete fileMetadata.fileName;
    delete fileMetadata.size;
    delete fileMetadata.fileSize;
    if (primary !== undefined) fileMetadata.isPrimary = primary;
    const uploadResult = uploadResults[index];
    const uploadedFile: UploadedResourceFile = {
      ...fileMetadata,
      url: uploadResult.url,
      fileName: uploadResult.filename,
      fileSize: uploadResult.size
    };
    if (uploadResult.sha256) uploadedFile.sha256 = uploadResult.sha256;
    if (uploadResult.sha1) uploadedFile.sha1 = uploadResult.sha1;
    return uploadedFile;
  });

  const primaryFiles = uploadedFiles.filter((file) => file.isPrimary);
  if (primaryFiles.length > 1) throw new Error('Only one uploaded file may have isPrimary set to true');
  if (uploadedFiles.length > 0 && primaryFiles.length === 0) uploadedFiles[0].isPrimary = true;
  return uploadedFiles;
}

export function resolveOperation(operation: Operation, resourceId?: string): Exclude<Operation, 'auto'> {
  if (operation === 'auto') return resourceId ? 'update' : 'create';
  return operation;
}

function setDefined(target: Record<string, unknown>, key: string, value: unknown): void {
  if (value !== undefined) target[key] = value;
}

export function buildResourceMutationData(inputs: Inputs): ResourceMutationData {
  const data: ResourceMutationData = { ...(inputs.resourceData || {}) };
  setDefined(data, 'title', inputs.title);
  setDefined(data, 'description', inputs.description);
  setDefined(data, 'content', inputs.content);
  setDefined(data, 'category', inputs.category);
  setDefined(data, 'platform', inputs.platform);
  setDefined(data, 'version', inputs.version);
  setDefined(data, 'versionTag', inputs.versionTag);
  setDefined(data, 'versionTitle', inputs.versionTitle);
  setDefined(data, 'changelog', inputs.changelog);
  setDefined(data, 'publishVersion', inputs.publishVersion);
  setDefined(data, 'downloadType', inputs.downloadType);
  setDefined(data, 'isDraft', inputs.isDraft);
  setDefined(data, 'mcVersions', inputs.mcVersions);
  setDefined(data, 'tags', inputs.tags);
  setDefined(data, 'officialTags', inputs.officialTags);
  setDefined(data, 'tutorialPostIds', inputs.tutorialPostIds);
  setDefined(data, 'documentationPostRefs', inputs.documentationPostRefs);
  setDefined(data, 'documentationUrl', inputs.documentationUrl);
  setDefined(data, 'dependencies', inputs.dependencies);
  return data;
}

export function buildResourceVersionData(inputs: Inputs): ResourceVersionData {
  const data: ResourceVersionData = { ...(inputs.versionData || {}) };
  setDefined(data, 'version', inputs.version);
  setDefined(data, 'versionTag', inputs.versionTag);
  setDefined(data, 'title', inputs.versionTitle);
  setDefined(data, 'changelog', inputs.changelog);
  setDefined(data, 'downloadType', inputs.downloadType);
  setDefined(data, 'mcVersions', inputs.mcVersions);
  return data;
}

function readInputs(): Inputs {
  const chunkSizeMb = getPositiveNumberInput('chunk_size_mb', 8);
  if (chunkSizeMb > 20) throw new Error('chunk_size_mb cannot exceed the NexusMC limit of 20 MB');

  return {
    apiToken: core.getInput('api_token', { required: true }),
    operation: getOperationInput(),
    resourceId: core.getInput('resource_id', { required: false }) || undefined,
    resourceData: parseJsonObjectInput(core.getInput('resource_data', { required: false }), 'resource_data'),
    versionData: parseJsonObjectInput(core.getInput('version_data', { required: false }), 'version_data'),
    filePath: core.getInput('file_path', { required: false }) || undefined,
    files: parseResourceFilesInput(core.getInput('files', { required: false })),
    ifNoFilesFound: getIfNoFilesFoundInput(),
    uploadStrategy: getUploadStrategyInput(),
    chunkSizeBytes: Math.round(chunkSizeMb * 1024 * 1024),
    requestTimeoutMs: Math.round(getPositiveNumberInput('request_timeout_seconds', 900) * 1000),
    title: core.getInput('title', { required: false }) || undefined,
    description: core.getInput('description', { required: false }) || undefined,
    content: parseJsonOrStringInput(core.getInput('content', { required: false })),
    contentMarkdown: getOptionalInput('content_markdown'),
    contentMarkdownPath: getOptionalInput('content_markdown_path'),
    category: core.getInput('category', { required: false }) || undefined,
    platform: core.getInput('platform', { required: false }) || undefined,
    version: core.getInput('version', { required: false }) || undefined,
    versionTag: core.getInput('version_tag', { required: false }) || undefined,
    versionTitle: core.getInput('version_title', { required: false }) || undefined,
    changelog: parseJsonOrStringInput(core.getInput('changelog', { required: false })),
    changelogMarkdown: getOptionalInput('changelog_markdown'),
    changelogMarkdownPath: getOptionalInput('changelog_markdown_path'),
    markdownLinkBaseUrl: getOptionalInput('markdown_link_base_url'),
    markdownImageBaseUrl: getOptionalInput('markdown_image_base_url'),
    publishVersion: getOptionalBooleanInput('publish_version'),
    downloadType: getDownloadTypeInput(),
    mcVersions: parseJsonArrayInput(core.getInput('mc_versions', { required: false }), 'mc_versions'),
    tags: parseJsonArrayInput(core.getInput('tags', { required: false }), 'tags'),
    officialTags: parseJsonArrayInput(core.getInput('official_tags', { required: false }), 'official_tags'),
    coverImagePath: core.getInput('cover_image_path', { required: false }) || undefined,
    tutorialPostIds: parseJsonArrayInput(core.getInput('tutorial_post_ids', { required: false }), 'tutorial_post_ids'),
    documentationPostRefs: parseJsonArrayInput(
      core.getInput('documentation_post_refs', { required: false }),
      'documentation_post_refs'
    ),
    documentationUrl: core.getInput('documentation_url', { required: false }) || undefined,
    dependencies: parseJsonArrayInput(core.getInput('dependencies', { required: false }), 'dependencies'),
    isDraft: getOptionalBooleanInput('is_draft')
  };
}

function validateBaseUrl(value: string | undefined, name: string): string | undefined {
  if (!value) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} must be an absolute HTTP or HTTPS URL`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`${name} must be an absolute HTTP or HTTPS URL`);
  }
  parsed.search = '';
  parsed.hash = '';
  if (!parsed.pathname.endsWith('/')) parsed.pathname += '/';
  return parsed.toString();
}

function encodeUrlPath(value: string): string {
  return value
    .split(/[\\/]+/)
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

function githubMarkdownBaseUrls(sourcePath?: string): MarkdownConversionOptions {
  const repository = process.env.GITHUB_REPOSITORY;
  const sha = process.env.GITHUB_SHA;
  if (!repository || !sha) return {};

  const serverUrl = (process.env.GITHUB_SERVER_URL || 'https://github.com').replace(/\/$/, '');
  const workspace = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd());
  let sourceDirectory = '';
  if (sourcePath) {
    const relativeDirectory = path.relative(workspace, path.dirname(path.resolve(sourcePath)));
    if (relativeDirectory && relativeDirectory !== '.' && !relativeDirectory.startsWith('..') && !path.isAbsolute(relativeDirectory)) {
      sourceDirectory = `${encodeUrlPath(relativeDirectory)}/`;
    }
  }

  const repositoryPath = encodeUrlPath(repository);
  const revision = encodeURIComponent(sha);
  return {
    linkBaseUrl: `${serverUrl}/${repositoryPath}/blob/${revision}/${sourceDirectory}`,
    imageBaseUrl: `${serverUrl}/${repositoryPath}/raw/${revision}/${sourceDirectory}`
  };
}

function readMarkdownFile(filePath: string, inputName: string): string {
  try {
    if (!fs.statSync(filePath).isFile()) throw new Error('not a file');
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    throw new Error(`${inputName} does not exist or is not a readable file: ${filePath}`);
  }
}

async function convertMarkdownInput(
  markdown: string | undefined,
  markdownPath: string | undefined,
  options: Pick<Inputs, 'markdownLinkBaseUrl' | 'markdownImageBaseUrl'>,
  valueName: string
): Promise<unknown | undefined> {
  if (markdown !== undefined && markdownPath !== undefined) {
    throw new Error(`${valueName}_markdown and ${valueName}_markdown_path cannot be used together`);
  }
  if (markdown === undefined && markdownPath === undefined) return undefined;

  const source = markdownPath ? readMarkdownFile(markdownPath, `${valueName}_markdown_path`) : markdown || '';
  const defaults = githubMarkdownBaseUrls(markdownPath);
  const conversionOptions: MarkdownConversionOptions = {
    linkBaseUrl: validateBaseUrl(options.markdownLinkBaseUrl, 'markdown_link_base_url') || defaults.linkBaseUrl,
    imageBaseUrl: validateBaseUrl(options.markdownImageBaseUrl, 'markdown_image_base_url') || defaults.imageBaseUrl
  };
  return markdownToTiptap(source, conversionOptions);
}

export async function applyMarkdownInputs(inputs: Inputs): Promise<void> {
  if (inputs.content !== undefined && (inputs.contentMarkdown !== undefined || inputs.contentMarkdownPath !== undefined)) {
    throw new Error('content cannot be used with content_markdown or content_markdown_path');
  }
  if (inputs.changelog !== undefined && (inputs.changelogMarkdown !== undefined || inputs.changelogMarkdownPath !== undefined)) {
    throw new Error('changelog cannot be used with changelog_markdown or changelog_markdown_path');
  }

  const convertedContent = await convertMarkdownInput(
    inputs.contentMarkdown,
    inputs.contentMarkdownPath,
    inputs,
    'content'
  );
  if (convertedContent !== undefined) {
    inputs.content = convertedContent;
  }

  const convertedChangelog = await convertMarkdownInput(
    inputs.changelogMarkdown,
    inputs.changelogMarkdownPath,
    inputs,
    'changelog'
  );
  if (convertedChangelog !== undefined) {
    inputs.changelog = convertedChangelog;
  }
}

function requireResourceId(operation: string, resourceId?: string): string {
  if (!resourceId) throw new Error(`resource_id is required for operation=${operation}`);
  return resourceId;
}

function validateCreateData(data: ResourceMutationData): void {
  for (const field of ['title', 'content', 'category']) {
    if (data[field] === undefined || data[field] === null || data[field] === '') {
      throw new Error(`${field} is required when creating a resource`);
    }
  }
}

function hasOwnField(data: Record<string, unknown>, field: string): boolean {
  return Object.prototype.hasOwnProperty.call(data, field);
}

function hasNonEmptyFiles(data: Record<string, unknown>): boolean {
  return Array.isArray(data.files) && data.files.length > 0;
}

function validateCoverImagePath(coverImagePath?: string): void {
  if (!coverImagePath) return;
  try {
    if (fs.statSync(coverImagePath).isFile()) return;
  } catch {
    // Report one consistent error for missing paths and non-files.
  }
  throw new Error(`Cover image path does not exist or is not a file: ${coverImagePath}`);
}

async function validateVersionTag(data: Record<string, unknown>, options: ApiRequestOptions): Promise<void> {
  if (data.versionTag === undefined) return;
  if (typeof data.versionTag !== 'string' || !data.versionTag) {
    throw new Error('version_tag must be a non-empty string');
  }

  const tags = await getVersionTags(options);
  const enabledKeys = tags.filter((tag) => tag.enabled).map((tag) => tag.key);
  if (!enabledKeys.includes(data.versionTag)) {
    throw new Error(`version_tag must be one of the currently enabled values: ${enabledKeys.join(', ')}`);
  }
}

function setCommonOutputs(
  operation: Exclude<Operation, 'auto'>,
  resourceId: string,
  status?: string,
  versionId?: string
): void {
  core.setOutput('operation', operation);
  core.setOutput('resource_id', resourceId);
  core.setOutput('resource_url', `${SITE_BASE_URL}/resources/${resourceId}`);
  core.setOutput('status', status || '');
  core.setOutput('version_id', versionId || '');
}

export async function run(): Promise<void> {
  try {
    const inputs = readInputs();
    core.setSecret(inputs.apiToken);
    const operation = resolveOperation(inputs.operation, inputs.resourceId);
    if (
      operation === 'publish-version' &&
      (inputs.content !== undefined || inputs.contentMarkdown !== undefined || inputs.contentMarkdownPath !== undefined)
    ) {
      throw new Error('Resource content inputs are not supported by operation=publish-version');
    }
    await applyMarkdownInputs(inputs);
    const apiOptions: ApiRequestOptions = {
      timeoutMs: inputs.requestTimeoutMs,
      chunkSizeBytes: inputs.chunkSizeBytes
    };

    core.info('=== NexusMC Resource Action ===');
    core.info(`Operation: ${operation}`);
    if (inputs.resourceId) core.info(`Resource ID: ${inputs.resourceId}`);
    if (operation === 'publish-version' && inputs.coverImagePath) {
      throw new Error('cover_image_path is not supported by operation=publish-version; update the resource cover separately');
    }

    const fileInputs = filterExistingResourceFileInputs(
      getResourceFileInputs(inputs),
      inputs.ifNoFilesFound
    );
    validateCoverImagePath(inputs.coverImagePath);

    let resourceId = inputs.resourceId;
    let mutationData: ResourceMutationData | undefined;
    let versionData: ResourceVersionData | undefined;
    if (operation === 'publish-version') {
      resourceId = requireResourceId(operation, resourceId);
      versionData = buildResourceVersionData(inputs);
      if (!versionData.version || typeof versionData.version !== 'string') {
        throw new Error('version is required for operation=publish-version');
      }
      if (hasNonEmptyFiles(versionData) && versionData.downloadType === undefined) {
        versionData.downloadType = 'local';
      }
      await validateVersionTag(versionData, apiOptions);
    } else {
      mutationData = buildResourceMutationData(inputs);
      if (operation === 'create') validateCreateData(mutationData);
      else resourceId = requireResourceId(operation, resourceId);
      if (hasNonEmptyFiles(mutationData) && mutationData.downloadType === undefined) {
        mutationData.downloadType = 'local';
      }
      await validateVersionTag(mutationData, apiOptions);
    }

    let resourceFiles: UploadedResourceFile[] | undefined;
    if (fileInputs.length > 0) {
      const uploadResults = await uploadFiles(
        inputs.apiToken,
        fileInputs.map((file) => file.path),
        inputs.uploadStrategy,
        apiOptions
      );
      resourceFiles = mapUploadedResourceFiles(fileInputs, uploadResults);
      core.info(`Resource files uploaded: ${resourceFiles.map((file) => file.fileName).join(', ')}`);
    }

    let coverImageUrl: string | undefined;
    if (inputs.coverImagePath) {
      coverImageUrl = (await uploadImage(inputs.apiToken, inputs.coverImagePath, 'cover', apiOptions)).url;
      core.info(`Cover image uploaded: ${coverImageUrl}`);
    }

    if (operation === 'publish-version') {
      if (!resourceId || !versionData) throw new Error('Internal error while preparing version publication');
      if (resourceFiles) {
        versionData.files = resourceFiles;
        if (versionData.downloadType === undefined) versionData.downloadType = 'local';
      }
      const result = await createResourceVersion(inputs.apiToken, resourceId, versionData, apiOptions);
      setCommonOutputs(operation, resourceId, result.status, result.id);
      core.info(`Version published successfully: ${result.version || result.id}`);
      return;
    }

    if (!mutationData) throw new Error('Internal error while preparing resource mutation');
    if (resourceFiles) {
      mutationData.files = resourceFiles;
      if (mutationData.downloadType === undefined) mutationData.downloadType = 'local';
    }
    if (coverImageUrl) mutationData.coverImage = coverImageUrl;
    if (operation === 'update' && hasOwnField(mutationData, 'files') && mutationData.publishVersion === false) {
      core.warning('NexusMC creates a version for non-draft resources whenever files are supplied; publish_version=false cannot suppress that server behavior.');
    }

    if (operation === 'create') {
      const result = await createResource(inputs.apiToken, mutationData, apiOptions);
      if (!result?.id) throw new Error('Resource creation response did not include an id');
      setCommonOutputs(operation, result.id, result.status);
      core.info(`Resource created successfully: ${result.id}`);
      return;
    }

    if (!resourceId) throw new Error('Internal error while preparing resource update');
    if (Object.keys(mutationData).length === 0) {
      core.warning('No update fields specified. The resource was not updated.');
      return;
    }
    const result = await updateResource(inputs.apiToken, resourceId, mutationData, apiOptions);
    setCommonOutputs(operation, result.id || resourceId, result.status, result.versionId);
    core.info(`Resource updated successfully: ${result.id || resourceId}`);
  } catch (error) {
    core.setFailed(`Action failed: ${(error as Error).message}`);
  }
}

if (require.main === module) {
  void run();
}
