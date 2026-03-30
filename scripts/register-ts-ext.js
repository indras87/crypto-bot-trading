const Module = require('module');
const path = require('path');
const originalResolve = Module._resolveFilename;
const extraExtensions = ['.ts', '.mts', '.cts'];

Module._resolveFilename = function (request, parent, isMain, options) {
  try {
    return originalResolve.call(this, request, parent, isMain, options);
  } catch (err) {
    if (
      err &&
      typeof request === 'string' &&
      err.code &&
      err.code.includes('MODULE_NOT_FOUND') &&
      !request.startsWith('node:') &&
      !path.extname(request)
    ) {
      for (const ext of extraExtensions) {
        try {
          return originalResolve.call(this, `${request}${ext}`, parent, isMain, options);
        } catch (innerErr) {
          if (!innerErr || innerErr.code !== 'MODULE_NOT_FOUND') {
            throw innerErr;
          }
        }
      }
    }
    throw err;
  }
};
