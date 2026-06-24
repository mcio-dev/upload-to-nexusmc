import * as core from '@actions/core';
import { Inputs, BASE_URL, ResourceFileInput, UploadedResourceFile, UploadResponse } from './types';
import { uploadFiles, uploadImage, updateResource, parseJsonInput } from './api';

function getOptionalBooleanInput(name: string): boolean | undefined {
  const rawValue = core.getInput(name, { required: false });
  if (!rawValue) return undefined;
  return core.getBooleanInput(name, { required: false });
}

function parseResourceFilesInput(input: string | undefined): ResourceFileInput[] | undefined {
  if (!input) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch {
    throw new Error('files must be a valid JSON array');
  }

  if (!Array.isArray(parsed)) {
    throw new Error('files must be a JSON array');
  }

  return parsed.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`files[${index}] must be an object`);
    }

    const file = item as ResourceFileInput;
    if (!file.path || typeof file.path !== 'string') {
      throw new Error(`files[${index}].path is required`);
    }

    return file;
  });
}

function getResourceFileInputs(inputs: Inputs): ResourceFileInput[] {
  if (inputs.files && inputs.files.length > 0) {
    return inputs.files;
  }

  if (inputs.filePath) {
    return [{ path: inputs.filePath, isPrimary: true }];
  }

  return [];
}

function mapUploadedResourceFiles(
  fileInputs: ResourceFileInput[],
  uploadResults: UploadResponse[]
): UploadedResourceFile[] {
  if (fileInputs.length !== uploadResults.length) {
    throw new Error(`Upload result count mismatch: expected ${fileInputs.length}, got ${uploadResults.length}`);
  }

  const uploadedFiles = fileInputs.map((fileInput, index) => {
    const { path: _path, ...fileMetadata } = fileInput;
    const uploadResult = uploadResults[index];

    return {
      ...fileMetadata,
      url: uploadResult.url,
      fileName: uploadResult.filename,
      fileSize: uploadResult.size
    };
  });

  if (uploadedFiles.length > 0 && !uploadedFiles.some((file) => file.isPrimary)) {
    uploadedFiles[0].isPrimary = true;
  }

  return uploadedFiles;
}

async function run(): Promise<void> {
  try {
    // Get input parameters
    const inputs: Inputs = {
      apiToken: core.getInput('api_token', { required: true }),
      resourceId: core.getInput('resource_id', { required: true }),
      filePath: core.getInput('file_path', { required: false }),
      files: parseResourceFilesInput(core.getInput('files', { required: false })),
      version: core.getInput('version', { required: false }),
      versionTitle: core.getInput('version_title', { required: false }),
      changelog: core.getInput('changelog', { required: false }),
      publishVersion: getOptionalBooleanInput('publish_version'),
      mcVersions: parseJsonInput(core.getInput('mc_versions', { required: false })),
      tags: parseJsonInput(core.getInput('tags', { required: false })),
      officialTags: parseJsonInput(core.getInput('official_tags', { required: false })),
      coverImagePath: core.getInput('cover_image_path', { required: false }),
      tutorialPostIds: parseJsonInput(core.getInput('tutorial_post_ids', { required: false })),
      documentationPostRefs: parseJsonInput(core.getInput('documentation_post_refs', { required: false })),
      documentationUrl: core.getInput('documentation_url', { required: false }),
      dependencies: parseJsonInput(core.getInput('dependencies', { required: false })),
      isDraft: getOptionalBooleanInput('is_draft')
    };

    // Validate required inputs
    if (!inputs.apiToken) {
      core.setFailed('api_token is required');
      return;
    }
    if (!inputs.resourceId) {
      core.setFailed('resource_id is required');
      return;
    }

    core.info('=== NexusMC Resource Update Action ===');
    core.info(`Resource ID: ${inputs.resourceId}`);

    // Prepare update data
    const updateData: Record<string, any> = {};

    // Add version info if provided
    if (inputs.version) {
      updateData.version = inputs.version;
    }
    if (inputs.versionTitle) {
      updateData.versionTitle = inputs.versionTitle;
    }
    if (inputs.changelog) {
      updateData.changelog = inputs.changelog;
    }
    if (inputs.publishVersion !== undefined) {
      updateData.publishVersion = inputs.publishVersion;
    }
    if (inputs.isDraft !== undefined) {
      updateData.isDraft = inputs.isDraft;
    }
    if (inputs.mcVersions && inputs.mcVersions.length > 0) {
      updateData.mcVersions = inputs.mcVersions;
    }
    if (inputs.tags && inputs.tags.length > 0) {
      updateData.tags = inputs.tags;
    }
    if (inputs.officialTags && inputs.officialTags.length > 0) {
      updateData.officialTags = inputs.officialTags;
    }
    if (inputs.tutorialPostIds && inputs.tutorialPostIds.length > 0) {
      updateData.tutorialPostIds = inputs.tutorialPostIds;
    }
    if (inputs.documentationPostRefs && inputs.documentationPostRefs.length > 0) {
      updateData.documentationPostRefs = inputs.documentationPostRefs;
    }
    if (inputs.documentationUrl) {
      updateData.documentationUrl = inputs.documentationUrl;
    }
    if (inputs.dependencies && inputs.dependencies.length > 0) {
      updateData.dependencies = inputs.dependencies;
    }

    // Upload resource files if provided
    const resourceFileInputs = getResourceFileInputs(inputs);
    let filesUploaded = false;
    if (resourceFileInputs.length > 0) {
      try {
        const uploadResults = await uploadFiles(inputs.apiToken, resourceFileInputs.map((file) => file.path));
        const resourceFiles = mapUploadedResourceFiles(resourceFileInputs, uploadResults);
        updateData.files = resourceFiles;
        filesUploaded = true;
        core.info(`Resource files uploaded: ${resourceFiles.map((file) => file.fileName).join(', ')}`);
      } catch (error) {
        core.setFailed(`Failed to upload resource files: ${(error as Error).message}`);
        return;
      }
    }

    // Upload cover image if provided
    if (inputs.coverImagePath) {
      try {
        const imageResult = await uploadImage(inputs.apiToken, inputs.coverImagePath);
        updateData.coverImage = imageResult.url;
        core.info(`Cover image uploaded: ${imageResult.url}`);
      } catch (error) {
        core.setFailed(`Failed to upload cover image: ${(error as Error).message}`);
        return;
      }
    }

    // If no update fields are provided, warn user
    if (Object.keys(updateData).length === 0) {
      core.warning('No update fields specified. The resource will not be updated.');
      return;
    }

    // Update resource
    try {
      const result = await updateResource(inputs.apiToken, inputs.resourceId, updateData);
      
      core.info('=== Update Successful ===');
      core.info(`Resource ID: ${result.id}`);
      core.info(`Status: ${result.status}`);
      if (result.version) {
        core.info(`Version: ${result.version}`);
      }

      // Set outputs
      core.setOutput('resource_id', result.id);
      core.setOutput('resource_url', `${BASE_URL}/resources/${result.id}`);
      core.setOutput('status', result.status);

    } catch (error) {
      core.setFailed(`Failed to update resource: ${(error as Error).message}`);
      return;
    }

  } catch (error) {
    core.setFailed(`Action failed: ${(error as Error).message}`);
  }
}

run();
