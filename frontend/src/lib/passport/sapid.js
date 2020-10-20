const Raven = require('raven');
const GatewayClient = require('../gateway-client');
const FeatureToggle = require('../feature-toggle');
const pino = require('pino');
const  logger = pino({
  useLevelLabels: true,
  serializers: {
    err: pino.stdSerializers.err
  }
});

const PassportOpenIDConnect = require('passport-openidconnect/lib').Strategy;
class SapIDStrategy extends PassportOpenIDConnect {
  constructor(options, verify) {
    super(options, verify);
  }

  authorizationParams(options) {
      return {connector_id: 'accounts'} //connector id for Multi Federator
  };
}

const verify = (redisClient, gatewayClient, featureToggle) => {
  return (req, iss, sub, profile, jwtClaims, accessToken, refreshToken, params, verified) => {
    const d = new Date;
    let user = {
      hash: `${jwtClaims.at_hash}-${Math.round(d.getTime() / 1000)}`,
      id: jwtClaims.name.toLowerCase(),
      name: jwtClaims.name, //check in dex for additional fields ?
      email: jwtClaims.email,
      family_name: jwtClaims.family_name,
      given_name: jwtClaims.given_name,
      groups: [],
      token: {
        sapid: params
      }
    };

    gatewayClient.accountsLoginFlow(user)
      .then(data => {
        let yCloudLoginAccess = false;

        user.prepareUserStatus = data.prepareUserLogin.status;
        let userStatus = user.prepareUserStatus.toUpperCase();

        logger.info({userId: user.id.substring(0, 4), userStatus}, 'executed prepare user');

        if (userStatus === 'C4GROUPS') {
          // Normal Login Flow
          yCloudLoginAccess = true;
        } else if (userStatus === 'C4_SUPERADMIN') {
          // TODO mark session as superadmin user
          yCloudLoginAccess = true;
          user.superAdminAccounts = data.prepareUserLogin.accountIDs;
        } else if (userStatus === 'LIMITEDACCESS') {
          // TODO create a flag in the session to inform the user about its limited access
          yCloudLoginAccess = true;
        } else if (
          userStatus === 'SUPERADMIN' ||
          userStatus === 'NOACCESS' ||
          userStatus === 'OPTOUT'
        ) {

          const err = new Error(userStatus);

          if (user.hasOwnProperty('id') && (user.id.substring(0, 1) === 'i' || user.id.substring(0, 1) === "d")) {
            /*
              Since we can not use info object without setting err and user to null
              adding code so calling function can then interpret what to do
             */
            err.code = 'NOACCESS_FOR_SAP_I_OR_D_USER';
          }
          req.flash('userId', user.id);
          req.flash('unauthorized', true);
          return verified(err, null)
        }

        if (yCloudLoginAccess) {
          redisClient.set(`user-${user.id}-${user.hash}`, JSON.stringify(user), 'EX', 43200);
          redisClient.get(`user-${user.id}-${user.hash}`, (err, result) => {
            if (err) {
              logger.error(err, 'Error while trying to persist the user');
              req.flash('technicalErrorOccurred', true);
              Raven.captureException(err);
              return verified(err, null)
            }
            return verified(null, user)
          });
        } else {
          // prepare user returned
          const err = new Error(`prepareUser is in ${userStatus} state and therefore login is not possible`);
          logger.error(err);
          return verified(err, null)
        }
      })
      .catch(err => {
        logger.error({userId: user.id.substring(0, 4), err}, 'prepareUser could not be handled');
        Raven.captureException(err);
        req.flash('technicalErrorOccurred', true);
        return verified(err, null)
      });
    }
};

module.exports.default = (passport, options, redisClient) => {
  let SapIDOptions;

    SapIDOptions = {
      ...options
    };

  passport.use('sapid-login', new SapIDStrategy(SapIDOptions, verify(redisClient, GatewayClient, FeatureToggle)));
};
module.exports.verify = verify;
module.exports.SapIDStrategy = SapIDStrategy;


