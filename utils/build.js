// Do this as the first thing so that any code reading it knows the right env.
process.env.BABEL_ENV = 'production';
process.env.NODE_ENV = 'production';
process.env.ASSET_PATH = '/';

const { spawnSync } = require('child_process');
const webpack = require('webpack');
const config = require('../webpack.config');

const splitBuildGroups = [
  {
    chunkPrefix: 'newtab-',
    entries: ['newtab'],
  },
  {
    chunkPrefix: 'popup-',
    entries: ['popup'],
    skipClean: true,
  },
  {
    chunkPrefix: 'sandbox-',
    entries: ['sandbox'],
    skipClean: true,
  },
  {
    chunkPrefix: 'execute-',
    entries: ['execute'],
    skipClean: true,
  },
  {
    chunkPrefix: 'params-',
    entries: ['params'],
    skipClean: true,
  },
  {
    chunkPrefix: 'background-',
    entries: ['background'],
    skipClean: true,
  },
  {
    chunkPrefix: 'offscreen-',
    entries: ['offscreen'],
    skipClean: true,
  },
  {
    chunkPrefix: 'content-',
    entries: ['contentScript'],
    skipClean: true,
  },
  {
    chunkPrefix: 'record-',
    entries: ['recordWorkflow'],
    skipClean: true,
  },
  {
    chunkPrefix: 'web-',
    entries: ['webService'],
    skipClean: true,
  },
  {
    chunkPrefix: 'selector-',
    entries: ['elementSelector'],
    skipClean: true,
  },
];

if (!process.env.WEBPACK_ENTRY && process.env.AUTOMA_SPLIT_BUILD !== 'false') {
  for (const group of splitBuildGroups) {
    let result;
    const groupName = group.entries.join(',');

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      result = spawnSync(process.execPath, [__filename], {
        env: {
          ...process.env,
          WEBPACK_CHUNK_PREFIX: group.chunkPrefix,
          WEBPACK_ENTRY: groupName,
          WEBPACK_SKIP_CLEAN: group.skipClean ? 'true' : '',
        },
        stdio: 'inherit',
      });

      if (result.signal !== 'SIGSEGV') break;
      if (attempt < 3) {
        console.warn(
          `Build group "${groupName}" failed with SIGSEGV; retrying (${attempt}/3)`
        );
      }
    }

    if (result.signal) {
      console.error(
        `Build group "${groupName}" failed with signal ${result.signal}`
      );
      process.exit(1);
    }
    if (result.status !== 0) {
      console.error(
        `Build group "${groupName}" failed with exit code ${result.status}`
      );
      process.exit(result.status || 1);
    }
  }

  process.exit(0);
}

delete config.chromeExtensionBoilerplate;

config.mode = 'production';

webpack(config, function (err) {
  if (err) throw err;
});
