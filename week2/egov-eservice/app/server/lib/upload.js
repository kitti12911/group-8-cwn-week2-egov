'use strict';
// Shared multipart parser (memory). Multer limit is ABOVE 5 MB so the app — not the framework —
// answers 400 FILE_TOO_LARGE for 5,242,881 bytes (CONTRACT §0.10). Size/type checks are the
// caller's job (magic bytes, see sniff()).
//   app.post('/api/drafts/:id/files', guard.api('citizen'), upload.single('file'), handler)
const multer = require('multer');
const { sendError } = require('./errors');

const parser = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024, files: 10 } });

function wrap(mw) {
  return (req, res, next) => mw(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') return sendError(res, 'FILE_TOO_LARGE');
    if (err.code === 'LIMIT_FILE_COUNT') return sendError(res, 'FILE_COUNT');
    return sendError(res, 'BAD_REQUEST');
  });
}

/** magic bytes → mime | null (PDF %PDF · JPEG FF D8 FF · PNG 89 50 4E 47) */
function sniff(buf) {
  if (!buf || buf.length < 3) return null;
  if (buf.length >= 4 && buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46) return 'application/pdf';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 4 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  return null;
}

module.exports = {
  single: (field = 'file') => wrap(parser.single(field)),
  any: () => wrap(parser.any()),
  none: () => wrap(parser.none()),
  sniff,
};
