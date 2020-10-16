const express = require('express');
const Raven = require('raven');
const router = express.Router();
const pino = require('pino');
const gatewayClient = require('../lib/gateway-client');
const accountsOptimizedStrategy = require('../lib/passport/accountsOptimized').default;
const yCloudOptimizedStrategy = require('../lib/passport/ycloudOptimized');

const  logger = pino({
  useLevelLabels: true,
  serializers: {
    err: pino.stdSerializers.err
  }
});
const FeatureToggle = require('../lib/feature-toggle');
let OAuth2 = require('oauth').OAuth2;

/**
 *
 * @param passport
 * @return {Router}
 */
module.exports = (passport,redisClient) => {
  /**
   * SSO Flow supports three distinct providers at the moment.
   * @type {{_accounts: string, _ycloud: string, _customersso: string}}
   */
  const Providers = {
    _ycloud : 'ycloud',
    _accounts: 'accounts',
    _customersso: 'customer_sso'
  };

  /**
   * Return Connector ID(string) based on the provider
   * @param provider
   * @returns {string}
   */
  function getConnectorId(provider) {
    switch (provider) {  //current provider
      case Providers._ycloud:
        logger.info('Connector ID :', Providers._ycloud);
        return Providers._ycloud;
        break;

      case Providers._accounts:
        logger.info('Connector ID :', Providers._accounts);
        return Providers._accounts;
        break;
    }
  }

  let base64Encode = (clientId, clientSecret) => {
    const tempBuf = Buffer.from(`${clientId}:${clientSecret}`);
    return tempBuf.toString('base64');
  };

  /**
   * middleware to call the federator to set up oidc params for SAPID Flow
   * @param req
   * @param res
   * @param next
   * @returns {Promise<void>}
   */
  async function setupOptimizedFlowonlyIfToggleisSet (req,res,next) {
    logger.info("Executing Passport-Router Middleware for path", '/auth');
    // ALWAYS set up OIDC in /auth as this is a SEPARATE & ANOTHER valid entry point in PROD in addition to '/'
    if(FeatureToggle.isFeatureEnabled("FEATURE_OPTIMIZE_SSO_REDIRECTS")){
      logger.info('passport-router : Fetching OIDC params');
      // Step 1 (SAPID) flow : get OIDC params for accounts
      let queryVariables = {
        "redirectURI": `${process.env.BASE_URL}/auth/callback`,
        "connectorId": "accounts"
      };
      const passportOptions = {
        passReqToCallback: true,
        state: true,
        skipUserProfile: true
      };
      //use await to ensure that the promise resolves here.
      let data = await gatewayClient.getAndValidateOIDCParameters(queryVariables);
      let validatedOptions = {
        ...data.getAndValidateOIDCParameters, //OIDC params validated by federator
        ...passportOptions //other passport settings
      };
      logger.info("Fetched OIDC Parameters for",  data.getAndValidateOIDCParameters.issuer);
      logger.info('Inside Passport-Router Middleware: About to register', `sapid-optimized-login-${req.session.id}`);
      accountsOptimizedStrategy(req.session.id, passport, validatedOptions, redisClient);

      // Step 2 (SAPID) flow : get OIDC params for ycloud
      queryVariables.connectorId = "ycloud";
      //use await to ensure that the promise resolves here.
      data = await gatewayClient.getAndValidateOIDCParameters(queryVariables);
      validatedOptions = {
        ...data.getAndValidateOIDCParameters, //OIDC params validated by federator
        ...passportOptions //other passport settings
      };
      logger.info("Fetched OIDC Parameters for", data.getAndValidateOIDCParameters.issuer);
      validatedOptions.issuer = new URL(data.getAndValidateOIDCParameters.issuer).hostname; //Patch ycloud issuer inconsistencies
      logger.info('Inside Router Middleware: About to register', `ycloud-optimized-login-${req.session.id}`);
      yCloudOptimizedStrategy(req.session.id, passport, validatedOptions, redisClient);
    }
    next(); // do nothing - just proceed with execution.
  };

  /**
   * middleware to handle the optimized login flow
   * sapid-optimized-login(for user authentication) , followed by ycloud-optimized-login for groups
   * @param req
   * @param res
   * @param next
   * @returns {*|void}
   */
  function startOptimizedLoginFlow(req,res,next){
      if (req.isAuthenticated() && (req.user && req.user.token && req.user.token.sapid)) {
        req.session.provider = Providers._ycloud;
        logger.info(`using registered ycloud-optimized-login-${req.session.id} flow`);
        return passport.authenticate(`ycloud-optimized-login-${req.session.id}`)(req, res, next)
      } else {
        req.session.provider = Providers._accounts;
        logger.info(`using registered sapid-optimized-login-${req.session.id} flow`);
        return passport.authenticate(`sapid-optimized-login-${req.session.id}`)(req, res, next)
      }
    };

  /**
   * Middleware to Handle 'customer_sso' & non optimized SAPID Flow
   * Three Flows are possible
   * 1. Customer SSO Flow (for user auth & groups) OR
   * 2. sapid-login(for user authentication) , followed by ycloud-login for groups
   *
   * @param req
   * @param res
   * @param next
   * @returns {*|void}
   */
  function startLoginFlow(req,res,next){
    if (req.isAuthenticated() && (req.user && req.user.token && req.user.token.sapid)) {
      req.session.provider = Providers._ycloud;
      return passport.authenticate('ycloud-login')(req, res, next)
    } else {
      req.session.provider = Providers._accounts;
      return passport.authenticate('sapid-login')(req, res, next)
    }
  };

  if(FeatureToggle.isFeatureEnabled("FEATURE_OPTIMIZE_SSO_REDIRECTS")){
    router.get('/auth',setupOptimizedFlowonlyIfToggleisSet,startOptimizedLoginFlow);
  } else {
    router.get('/auth',startLoginFlow); // 'customer_sso' & 'sapid'
  }

  router.get('/auth/callback', setupOptimizedFlowonlyIfToggleisSet, (req, res, next) => {
    /**
     * We need to override the OAuth2 lib's getOauthAccessToken.
     *
     * Reason :
     * While exchanging code for accessToken in the callback and making a request to the token endpoint of a OIDC provider
     * the following params -  grant_type=authohttps://github.wdf.sap.corp/cx/c4f-cockpit-backlog/issues/364ization_code, code, redirect_uri, client_id, client_secret are expected to be passed in standard implementations.
     * However, The Multifederator expects the 'connector_id' to be sent as well.
     *
     * This is not needed when using Dex.
     */


     OAuth2.prototype.getOAuthAccessToken = function (code, params, callback) {
       let querystring = require('querystring');

       var params = params || {};

       params['client_id'] = this._clientId;
       params['client_secret'] = this._clientSecret;

       //connector_id can be one of - 'ycloud', 'accounts', 'customer_sso' depending on which authorization flow happens.
       //this should match the connector_id in the initial auth request

       params['connector_id'] =  getConnectorId(req.session.provider);

       let codeParam = (params.grant_type === 'refresh_token') ? 'refresh_token' : 'code';
       params[codeParam] = code;

       let post_data = querystring.stringify(params);

       let post_headers={};

       if(FeatureToggle.isFeatureEnabled('FEATURE_OPTIMIZE_SSO_REDIRECTS')){
         const basicAuthBody =  base64Encode(params['client_id'],  params['client_secret']);
         // We need to pass the clientId, clientSecret as basic auth headers instead of body for
         //accounts.sap.com flavor of IAS, todo verify if this works for other OIDC
          post_headers = {
            'Authorization': `Basic ${basicAuthBody}`
          };
       }

       post_headers['Content-Type'] = 'application/x-www-form-urlencoded';

       this._request("POST", this._getAccessTokenUrl(), post_headers, post_data, null, function (error, data, response) {
         if (error) callback(error);
         else {
           var results;
           try {
             // As of http://tools.ietf.org/html/draft-ietf-oauth-v2-07
             // responses should be in JSON
             results = JSON.parse(data);
           } catch (e) {
             // .... However both Facebook + Github currently use rev05 of the spec
             // and neither seem to specify a content-type correctly in their response headers :(
             // clients of these services will suffer a *minor* performance cost of the exception
             // being thrown
             results = querystring.parse(data);
           }
           var access_token = results["access_token"];
           var refresh_token = results["refresh_token"];
           delete results["refresh_token"];
           callback(null, access_token, refresh_token, results); // callback results =-=
         }
       });
     }


    const handler = (err, user, info) => {
      if (err) {

        if (err.hasOwnProperty('code') && err.code !== 'NOACCESS_FOR_SAP_I_OR_D_USER') {
          // Only capture the error for sentry if its not an I or D user.
          Raven.captureException(err);
        }

        logger.error(err, `error during ${req.session.provider}-login`);

        if (
          err.message === 'OPTOUT' ||
          err.message === 'SUPERADMIN' ||
          err.message === 'NOACCESS'
        ) {
          return res.redirect('/unauthorized');
        }

        // navigate to landing page
        // this will now render based on flash
        return res.redirect('/');
      }
      if (!user) { return res.redirect('/auth'); }
      logger.info('user: ' + user);
      logger.info('info: ' + info);

      if(req.session.provider=== Providers._accounts) {
        //this will create the real user session
        req.logIn(user, err => {
          logger.info('============ executing req.login==============',  req.session.provider);
          if (err) {
            return next(err);
          }

          let redirectTo = '/auth';
          if (process.env.LOGIN_FLOW && process.env.LOGIN_FLOW === 'BLOCK_ANONYMOUS') {
            redirectTo = '/'
          }
          logger.info('redirecting to', redirectTo);
          return res.redirect(redirectTo);
        });
      } else if (req.session.provider === Providers._ycloud) {
        // after the second login
        // the same for anonymous and blocked

        logger.info('============ executing req.login==============',  req.session.provider);
        let redirectTo = '/';

        if(req.session && req.session.originalPath && req.session.originalPath.length > 0 && req.session.originalPath.startsWith('/')) {
          redirectTo = req.session.originalPath;
        }

        logger.info('redirecting to', redirectTo);
        return res.redirect(redirectTo);

      }
    };

    if (req.session.provider === Providers._ycloud) {
      if(FeatureToggle.isFeatureEnabled('FEATURE_OPTIMIZE_SSO_REDIRECTS')){
        return passport.authenticate(`ycloud-optimized-login-${req.session.id}`,handler)(req, res, next)
      } else {
        return passport.authenticate('ycloud-login',handler)(req, res, next)
      }
    } else if (req.session.provider === Providers._accounts) {
        if(FeatureToggle.isFeatureEnabled('FEATURE_OPTIMIZE_SSO_REDIRECTS')){
          return passport.authenticate(`sapid-optimized-login-${req.session.id}`,handler)(req, res, next)
        } else {
          return passport.authenticate('sapid-login', handler)(req, res, next)
      }
    }
  });

  return router
};
