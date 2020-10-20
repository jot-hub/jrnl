const Raven = require('raven');
const pino = require('pino');
const logger = pino({
  useLevelLabels: true
});

const appCenterCacheId = 'app-center-xfapps';
const appCenterCacheFallbackId = 'app-center-xfapps-fb';
let redisClient = require('../lib/setup-redis').redisClient;

const cxTags = ['crm', 'customer experience'];
const xfTags = ['extension factory'];

const appCenterUrl = 'https://www.sapappcenter.com/api/marketplace/v1/listing?pl=15&s=1769';

function sendError(res) {
  res.status(500).send('Server error in fetching app center');
}

function sendResponse(data, res) {
  res.set({
    'content-type': 'application/json; charset=utf-8',
  });
  res.write(data);
  res.end();
}

function returnFromFallbackCache(res) {
  redisClient.get(appCenterCacheFallbackId, (err, result) => {
    if (err) {
      logger.error(err, 'Appcenter: Redis? Error while trying to get appcenter apps from fallback cache');
      Raven.captureException(err);
      sendError(res);
    }
    else if (result) {
      logger.info('Appcenter: returning app center apps from fallback cache');
      sendResponse(result, res);
    } else {
      logger.error('Appcenter: fallback cache returned null for appcenter apps');
      Raven.captureException(new Error('Appcenter: fallback cache returned null for appcenter apps'));
      sendError(res);
    }
  });
}

function fallback(res) {
  triggerNextAppcenterFetch();
  // the following does not wait for the app center fetch to complete
  // it returns whatever is currently in the fallback cache
  returnFromFallbackCache(res);
};

function triggerNextAppcenterFetch() {
  var request = require('../../../authn/src/controller/node_modules/request');

  function validateAppcenterResponse(actualResponse) {

    let apps;

    try {
      apps = JSON.parse(actualResponse);
      if (!Array.isArray(apps)) return false;
    } catch (e) {
      logger.error(e, 'Appcenter: Not a valid json response from appcenter url');
      return false;
    }

    function validateApp(app) {
      function validateAppHeader() {
        return !!(app.id && app.name && app.description && app.developerName && app.vendorName && app.url);
      }
      function validateAppAttributes() {

        function lookForTags(tag) {
          return app.tags.filter((t) =>
            (t.name && t.name.toLowerCase().includes(tag)) ||
            (t.children && Array.isArray(t.children) && t.children.filter((c) => c.name && c.name.toLowerCase().includes(tag)).length > 0)
          ).length > 0;
        }

        if (app.tags && Array.isArray(app.tags)) {
          let cx = cxTags.filter((t) => lookForTags(t)).length > 0;
          let xf = xfTags.filter((t) => lookForTags(t)).length > 0;
          return cx && xf;
        }
        return false;
      }
      let hdr = validateAppHeader();
      let attr = validateAppAttributes();
      return hdr && attr;
    }

    return apps.reduce((a, c) => a && validateApp(c), true);
  }

  request(appCenterUrl, function (error, _, body) {

    if (error) {
      logger.error(error, 'Appcenter: Error in calling Appcenter');
      Raven.captureException(error, 'Appcenter: Error in calling Appcenter');
    } else if (body) {
      if (validateAppcenterResponse(body)) {
        redisClient.set(appCenterCacheId, body, 'EX', 3600);
        redisClient.set(appCenterCacheFallbackId, body);
      } else {
        logger.error('Appcenter: Validation failed for Appcenter response');
        Raven.captureException(new Error('Appcenter: Validation failed for Appcenter response'));
      }
    } else {
      logger.error('Appcenter: Empty response from app center');
      Raven.captureException(new Error('Appcenter: Empty response from app center'));
    }
  });
}

class AppCenterCtrl {

  static serverCacheHandler(req, res, next) {
    redisClient.get(appCenterCacheId, (err, result) => {
      if (err) {
        logger.error(err, 'Appcenter: Redis? - Error while trying to fetch apps from cache');
        Raven.captureException(err);
        fallback(res);
      }
      else if (result) {
        logger.info('Appcenter: returning app center apps from cache');
        sendResponse(result, res);
      } else {
        fallback(res);
      }
    });
  }
}
module.exports = AppCenterCtrl;
