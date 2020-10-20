const express = require('express');
const csrf = require('csurf');
const pino = require('pino');
const gatewayClient = require('../lib/gateway-client');
const yCloudOptimizedStrategy = require('../lib/passport/ycloudOptimized');
const accountsOptimizedStrategy = require('../lib/passport/accountsOptimized').default;
const AuthorizationCtrl = require('../controller/authorization-ctrl');
const IndexCtrl = require('../controller/index-ctrl');
const MetricCtrl = require('../controller/metric-ctrl');
const router = express.Router();
const  logger = pino({
  useLevelLabels: true,
  serializers: {
    err: pino.stdSerializers.err
  }
});
const FeatureToggle = require('../lib/feature-toggle');

const csrfProtection = csrf({});
module.exports = (passport,redisClient) => {

  function deletePassportStrategies(req, res, next) {
    logger.info(`Deleting passport strategies ${req.session.id}`);
    passport.unuse(`ycloud-optimized-login-${req.session.id}`);
    passport.unuse(`sapid-optimized-login-${req.session.id}`);
    next();
  }

  router.get('/metrics', MetricCtrl.register);
  router.get('/unauthorized', IndexCtrl.browserCheck, IndexCtrl.unauthorizedCheck, IndexCtrl.unauthorized);
  router.get('/logout', IndexCtrl.browserCheck, IndexCtrl.logout);
  if(FeatureToggle.isFeatureEnabled('FEATURE_OPTIMIZE_SSO_REDIRECTS')){
      router.get('/', IndexCtrl.browserCheck, async (req, res, next) => { //needs to be an async middleware to use await
      logger.info("Executing Router Middleware for path", '/');
      if (process.env.LOGIN_FLOW && process.env.LOGIN_FLOW === 'BLOCK_ANONYMOUS') {
        logger.info(`BLOCK_ANONYMOUS: ${!!(process.env.LOGIN_FLOW && process.env.LOGIN_FLOW === 'BLOCK_ANONYMOUS')} - Deferring Fetching OIDC params to /auth`);
        next();
      } else {
        const passportOptions = {
          passReqToCallback: true,
          state: true,
          skipUserProfile: true
        };

        let queryVariables = {
          "redirectURI": `${process.env.BASE_URL}/auth/callback`
        };

        //WARNING: Both accounts and ycloud optimized strategies need to be setup synchronously before rendering landing page

        // Step 1 (SAPID) flow : get OIDC params for accounts
        queryVariables.connectorId = "accounts";
        //use await to ensure that the promise resolves here.
        let data = await gatewayClient.getAndValidateOIDCParameters(queryVariables);
        let validatedOptions = {
          ...data.getAndValidateOIDCParameters, //OIDC params validated by federator
          ...passportOptions //other passport settings
        };
        logger.info("Fetched OIDC Parameters for", data.getAndValidateOIDCParameters.issuer);
        logger.info('Inside Router Middleware: About to register', `sapid-optimized-login-${req.session.id}`);
        accountsOptimizedStrategy(req.session.id, passport, validatedOptions, redisClient);

        // Step 2 (SAPID) flow : get OIDC params for ycloud
        queryVariables.connectorId = "ycloud";
        //use await to ensure that the promise resolves here.
        data = await gatewayClient.getAndValidateOIDCParameters(queryVariables);
        validatedOptions = {
          ...data.getAndValidateOIDCParameters, //OIDC params validated by federator
          ...passportOptions //other passport settings
        };
        logger.info("Fetched OIDC Parameters for",  data.getAndValidateOIDCParameters.issuer);
        validatedOptions.issuer = new URL(data.getAndValidateOIDCParameters.issuer).hostname; //Patch ycloud issuer inconsistencies
        logger.info('Inside Router Middleware: About to register', `ycloud-optimized-login-${req.session.id}`);
        yCloudOptimizedStrategy(req.session.id, passport, validatedOptions, redisClient);


        // future optimization - cache this in redis with expiry and call when expired instead of making graphql call each time
        // {
        //   accounts:
        //   ycloud:
        //   customer_sso-accountid:
        // }
        next();
      }
    }, IndexCtrl.landing);

  } else {
    router.get('/', IndexCtrl.browserCheck, IndexCtrl.landing);
  }

  router.get('*', IndexCtrl.browserCheck, AuthorizationCtrl.ensureAuthenticated, csrfProtection, deletePassportStrategies, IndexCtrl.serve);

  return router;
};
