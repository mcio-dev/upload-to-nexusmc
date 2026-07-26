const assert = require('node:assert/strict');
const test = require('node:test');

const {
  applyMarkdownInputs,
  buildResourceMutationData,
  buildResourceVersionData,
  getResourceFileInputs,
  mapUploadedResourceFiles,
  parseResourceFilesInput,
  resolveOperation
} = require('../dist/index.js');

function baseInputs(overrides = {}) {
  return {
    apiToken: 'token',
    operation: 'auto',
    ifNoFilesFound: 'error',
    uploadStrategy: 'auto',
    chunkSizeBytes: 8 * 1024 * 1024,
    requestTimeoutMs: 1000,
    ...overrides
  };
}

test('parseResourceFilesInput validates the local path field', () => {
  assert.deepEqual(
    parseResourceFilesInput('[{"path":"build.jar","loaderIds":["fabric"]}]'),
    [{ path: 'build.jar', loaderIds: ['fabric'] }]
  );
  assert.throws(() => parseResourceFilesInput('[{"isPrimary":true}]'), /path is required/);
  assert.throws(() => parseResourceFilesInput('{}'), /JSON array/);
});

test('mapUploadedResourceFiles preserves metadata and maps upload hashes', () => {
  const files = mapUploadedResourceFiles(
    [{ path: 'build.jar', loaderIds: ['neoforge'], gameVersions: ['1.21.1'] }],
    [{
      url: '/uploads/files/random.jar',
      filename: 'build.jar',
      size: 42,
      sha256: 'sha256-value',
      sha1: 'sha1-value'
    }]
  );

  assert.deepEqual(files, [{
    url: '/uploads/files/random.jar',
    fileName: 'build.jar',
    fileSize: 42,
    isPrimary: true,
    loaderIds: ['neoforge'],
    gameVersions: ['1.21.1'],
    sha256: 'sha256-value',
    sha1: 'sha1-value'
  }]);
});

test('mapUploadedResourceFiles rejects multiple primary files', () => {
  assert.throws(() => mapUploadedResourceFiles(
    [{ path: 'a.jar', isMain: true }, { path: 'b.jar', primary: true }],
    [
      { url: '/a', filename: 'a.jar', size: 1 },
      { url: '/b', filename: 'b.jar', size: 1 }
    ]
  ), /Only one/);
});

test('an explicit files array takes precedence over legacy file_path', () => {
  assert.deepEqual(getResourceFileInputs(baseInputs({ filePath: 'legacy.jar', files: [] })), []);
});

test('resource mutation data keeps empty arrays so callers can clear fields', () => {
  const data = buildResourceMutationData(baseInputs({
    resourceData: { repositoryUrl: null },
    tags: [],
    dependencies: [],
    tutorialPostIds: []
  }));

  assert.deepEqual(data, {
    repositoryUrl: null,
    tags: [],
    dependencies: [],
    tutorialPostIds: []
  });
});

test('dedicated inputs override resource_data and version_data', () => {
  const inputs = baseInputs({
    resourceData: { version: 'old', title: 'From JSON' },
    versionData: { version: 'old', title: 'From JSON' },
    title: 'Dedicated title',
    version: '2.0.0',
    versionTitle: 'Dedicated release title'
  });

  assert.equal(buildResourceMutationData(inputs).version, '2.0.0');
  assert.equal(buildResourceMutationData(inputs).title, 'Dedicated title');
  assert.deepEqual(buildResourceVersionData(inputs), {
    version: '2.0.0',
    title: 'Dedicated release title'
  });
});

test('auto operation creates without a resource ID and updates with one', () => {
  assert.equal(resolveOperation('auto'), 'create');
  assert.equal(resolveOperation('auto', 'resource-id'), 'update');
  assert.equal(resolveOperation('publish-version', 'resource-id'), 'publish-version');
});

test('Markdown inputs become TipTap content with GitHub commit URL bases', async () => {
  const previous = {
    repository: process.env.GITHUB_REPOSITORY,
    sha: process.env.GITHUB_SHA,
    server: process.env.GITHUB_SERVER_URL,
    workspace: process.env.GITHUB_WORKSPACE
  };
  process.env.GITHUB_REPOSITORY = 'example/project';
  process.env.GITHUB_SHA = 'abc123';
  process.env.GITHUB_SERVER_URL = 'https://github.com';
  process.env.GITHUB_WORKSPACE = process.cwd();

  try {
    const inputs = baseInputs({ contentMarkdown: '# Guide\n\n![Preview](images/demo.png)' });
    await applyMarkdownInputs(inputs);
    assert.equal(inputs.content.type, 'doc');
    assert.equal(inputs.content.content[0].type, 'heading');
    assert.equal(
      inputs.content.content[1].attrs.src,
      'https://github.com/example/project/raw/abc123/images/demo.png'
    );
  } finally {
    for (const [name, value] of Object.entries({
      GITHUB_REPOSITORY: previous.repository,
      GITHUB_SHA: previous.sha,
      GITHUB_SERVER_URL: previous.server,
      GITHUB_WORKSPACE: previous.workspace
    })) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test('Markdown inputs reject ambiguous content sources', async () => {
  await assert.rejects(
    () => applyMarkdownInputs(baseInputs({ content: 'plain', contentMarkdown: '# Markdown' })),
    /content cannot be used/
  );
  await assert.rejects(
    () => applyMarkdownInputs(baseInputs({ contentMarkdown: '# One', contentMarkdownPath: 'README.md' })),
    /cannot be used together/
  );
});
