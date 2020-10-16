'use strict';

/**
 * Import local env
 */

if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config({
    path: './.env'
  });
}

const http = require('http');

const express = require('express');
const cookieParser = require('cookie-parser');
const compression = require('compression');
const ErrorHandler = require('./src/lib/error-handler');
const redisSetup = require('./src/lib/setup-redis').RedisAdapter;
const terminus = require('@godaddy/terminus');

const logger = pino({
  useLevelLabels: true
});

let redisClient;
redisSetup.connected().then(redis => {
  redisClient = redis;
  execute();
});

async function start() {
  /**
   * Setup Express
   */

  const app = express();

  app.set('views', path.join(__dirname, '../dist'));
  app.engine('html', ejs.renderFile);
  app.set('trust proxy', 1);

  /**
   * Setup Session
   *  If session support is enabled, be sure to use session() before passport.session()
   *  to ensure that the login session is restored in the correct order.
   */

  const session = require('express-session');
  const RedisStore = require('connect-redis')(session);

  app.use(session({
    keys: ['connect.sid'],
    store: new RedisStore({
      client: redisClient,
      ttl: 60 * 60 * 24 * 7 // a week
    }),
    cookie: {
      secure: process.env.NODE_ENV === 'production',
      httpOnly: true,
      sameSite: 'lax', // https://developer.mozilla.org/en-US/docs/Web/HTTP/Cookies#SameSite_cookies
    },
    resave: false, // don't save session if unmodified
    saveUninitialized: false, // don't create session until something stored
    secret: process.env.SESSION_SECRET
  }));

  app.use(cookieParser(process.env.SESSION_SECRET));

  const passport = require('./src/lib/setup-passport')(app, redisClient);

  app.use(compression());

  app.use(require('./src/router/passport-router')(passport,redisClient));

  require('./src/lib/security')(app);

 

  /**
   * Catch typical issues
   */
  app.use(methodOverride());
  app.use(ErrorHandler.handler);
  app.use(ErrorHandler.lastResort);

  const port = process.env.PORT || 3000;
  const server = http.createServer(app);

  /**
   *  terminus Setup used for graceful shutdown
   */

  terminus.createTerminus(server, {
    logger: (params) => {logger.error('Terminus Logger', params);},
    signals: ['SIGINT', 'SIGTERM'],
    healthChecks: {
      '/health': onHealthCheck
    },
    onSignal,
    beforeShutdown
  });

  return server.listen(port);


}

process.on('uncaughtException', pino.final(logger, (err, finalLogger) => {
  finalLogger.error(err, 'uncaughtException');
  process.exit(1);
}));

process.on('unhandledRejection', pino.final(logger, (err, finalLogger) => {
  finalLogger.error(err, 'unhandledRejection');
  process.exit(1);
}));

function execute () {
  start()
    .then(listener => {
      logger.info('Server started on', listener.address().port);
    })
    .catch(err => {
      Raven.captureException(err);
      logger.error(err);
      process.exit(1);
    });
}

function beforeShutdown () {

  logger.info('Shutting down');

  //set resolve time to kubernetes deployment * 2
  return new Promise(resolve => {
    setTimeout(resolve, 10000)
  })
}

async function onHealthCheck () {
  return redisClient.status === 'ready' ? Promise.resolve() : Promise.reject(new Error('not ready'))
}

function onSignal () {

  logger.info('received termination signal');

  return redisClient
    .quit()
    .then(() => logger.info('redis disconnected'))
    .catch(err => logger.info('error during disconnection', err.stack))
}
