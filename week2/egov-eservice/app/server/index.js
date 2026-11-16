'use strict';
process.env.TZ = process.env.TZ || 'Asia/Bangkok';
const config = require('./lib/config');
const { createApp } = require('./app');
const { resetAll, isSeeded } = require('./reset');
const { bugMode } = require('./lib/bugs');

const { app, ctx } = createApp();
if (!isSeeded()) resetAll(ctx); // first boot: seed TEST-DATA

app.listen(config.PORT, () => {
  console.log(`[egov] listening on :${config.PORT} · TEST_MODE=${config.TEST_MODE ? 1 : 0} · BUG_MODE=${bugMode.list().join(',') || '-'} · DB_PATH=${config.DB_PATH}`);
});
