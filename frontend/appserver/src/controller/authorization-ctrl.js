const csrf = require('csurf');
const csrfProtection = csrf({});
const pino = require('pino');
const logger = pino({
  useLevelLabels: true
});
const Raven = require('raven');
const FeatureToggle = require('../lib/feature-toggle');

class AuthorizationCtrl {
  static ensureAuthenticated (req, res, next) {
    if (req.isAuthenticated() && (req.user && req.user.token && (req.user.token.ycloud||req.user.token.customersso))) {
      return next()
    }
    //if originalUrl exists , 'remember' by storing in the session
    if(req.originalUrl && req.originalUrl.length > 0 && req.originalUrl.startsWith('/') && req.session) {
      req.session.originalPath = req.originalUrl;
      logger.info('originalPath', req.session.originalPath);
    }
    return res.redirect('/auth');

  }

  static ensureAPIAuthenticated (req, res, next) {
    if (req.isAuthenticated() && (req.user && req.user.token && (req.user.token.ycloud||req.user.token.customersso))) {
      return next()
    } else {
      const ctx = {
        isAuthenticated: req.isAuthenticated(),
        user: req.user ? 'a user object was found' : null,
        token: req.user && req.user.token ? 'the user object found contained a token' : null,
        ycloud: req.user && req.user.token  && req.user.token.ycloud ? 'the user object found contained a ycloud token' : null,
        sap: req.user && req.user.token  && req.user.token.ycloud ? 'the user object found contained a sapid token' : null
      };
      logger.error(ctx, 'API call not authorized');
      Raven.captureMessage('API call not authorized', {
        extra: ctx
      });
      res.status(401).json({
        status: 401,
        message: 'Unauthorized'
      })
    }
  }

  static ensureCSRF (req, res, next) {
    if (process.env.NODE_ENV !== 'production') {
      return next();
    }
    return csrfProtection(req, res, next);
  }
}

module.exports = AuthorizationCtrl;
