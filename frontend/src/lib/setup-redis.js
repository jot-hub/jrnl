const Redis = require('ioredis');
const Raven = require('raven');
const pino = require('pino');
const  logger = pino({
  useLevelLabels: true,
  serializers: {
    err: pino.stdSerializers.err
  }
});

/**
 * Setup Redis
 */
let redisOpt;
let sentinels;

if (process.env.NODE_ENV === 'production' && process.env.REDIS_SENTINELS) {
  try {
    sentinels = JSON.parse(process.env.REDIS_SENTINELS)
  } catch (err) {
    logger.error(err, 'Could not parse sentinel information');
    process.exit(1);
  }
  redisOpt = {
    sentinels: sentinels,
    name: 'mymaster'
  };
} else {
  redisOpt =
    {
      port: process.env.REDIS_PORT || 6379,
      host: process.env.REDIS_ADDR || '127.0.0.1'
    }
}

redisOpt.retryStrategy = (times) => {
  return Math.min(times * 50, 2000);
};

const redisClient = new Redis(redisOpt);

redisClient.on('connect', () => {
  logger.info('Redis Connected');
});

redisClient.on('error', (err) => {
  Raven.captureException(err);
  logger.info(err, 'Redis Error')
});

redisClient.on('reconnecting', (sec) => {
  logger.info('Redis reconnecting', sec)
});

class RedisAdapter {
  static connected() {
    return new Promise((resolve, reject) => {
      redisClient.on('ready', () => {
        resolve(redisClient);
      });
    });
  }
}

module.exports = {
  RedisAdapter: RedisAdapter,
  redisClient: redisClient
}

