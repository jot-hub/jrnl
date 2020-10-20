const GatewayClient = require('../gateway-client');
const Raven = require('raven');
const promClient = require('prom-client');
const pino = require('pino');
const FeatureToggle = require('../feature-toggle');


const logger = pino({
  useLevelLabels: true,
  serializers: {
    err: pino.stdSerializers.err
  }
});

const PassportOpenIDConnect = require('passport-openidconnect/lib').Strategy;
class YCloudStrategy extends PassportOpenIDConnect {
  constructor (options, verify) {
    super(options, verify);
  }

  authorizationParams(options) {
    return {connector_id: 'ycloud'} //connector id for Multi Federator
  };


}

const verify = (redisClient, gatewayClient, featureToggle,loginSuccessCounter) => {
  return (req, iss, sub, profile, jwtClaims, accessToken, refreshToken, params, verified) => {
    if (jwtClaims.name) {
      if (req.user && req.user.name && (req.user.name.toLowerCase() === jwtClaims.name.toLowerCase())) {
        redisClient.get(`user-${jwtClaims.name.toLowerCase()}-${req.user.hash}`, (err, storedUser) => {
          let user;
          try {
            user = JSON.parse(storedUser);
          } catch (err) {
            logger.error('unable to parse stored user', err);
            return verified(err, null)
          }

          //setup a clean selected object
          req.session.selected = {};

          //assign token to user
          user.token.ycloud = params;

          //assign exp to user
          user.exp = jwtClaims.exp;

          gatewayClient.resolveAccountIDData(jwtClaims.groups, user.token.ycloud.id_token)
            .then(data => {

              if (!data || !data.c4fAccounts || !data.c4fAccounts.edges[0] || !data.c4fAccounts.edges[0].node
                  || !data.c4fAccounts.edges[0].node.accountID) {
                req.flash('unableToFindAccount', true);
                throw new Error(`Unable to get accounts for user ${user.id}`)
              }
              const c4hfAccountID = data.c4fAccounts.edges[0].node.accountID;
              return gatewayClient.roleIDsToGroupWithAccountID(c4hfAccountID, jwtClaims.groups, user.token.ycloud.id_token)
                .then(groupData => {
                    data.roleIDsToGroup = groupData.roleIDsToGroupWithAccountID;
                    return data;
                });
            })
            .then(data => {
              let accounts = [];
              let parsedAccounts = [];

              if (data && data.roleIDsToGroup) {
                parsedAccounts = data.roleIDsToGroup.filter(role => {
                  if (role.product === "c4cockpit") return true;
                });
              }

              if (parsedAccounts.length === 0) {
                req.flash('unableToFindAccount', true);
                return verified(new Error(`Unable to find any account with product type c4cockpit for ${user.id}`), null)
              }

              data.c4fAccounts.edges.forEach(edge => {
                let match;
                for (let i = parsedAccounts.length; i--;) {
                  if (edge.node.accountID === parsedAccounts[i].tenant) {
                    // consider only `admin` role if multiple roles are present
                    if (parsedAccounts[i].role === 'admin' || parsedAccounts[i].role === 'superadmin') {
                      match = parsedAccounts[i]
                    } else if (!match) {
                      match = parsedAccounts[i]
                    }
                  }
                }
                match.name = edge.node.customerName;
                match.orderFormAccepted = edge.node.orderFormAccepted;
                accounts.push(match)
              });


              if (accounts.length === 0) {
                req.flash('unableToFindC4Account', true);
                return verified(new Error(`Unable to find any c4 account for ${user.id}`), null);
              }

              logger.info('All Accounts for the user:', accounts);

              if (user.prepareUserStatus !== 'C4_SUPERADMIN') {
                accounts = accounts.filter((a) => a.orderFormAccepted);
              } else {
                accounts = accounts.filter((a) => a.orderFormAccepted || user.superAdminAccounts.includes(a.tenant));
              }


              // redirect to unauthorized page in case an account that has not been accepted
              // by a superadmin of that account is assigned to this user
              if (accounts.length === 0) {
                const ravError = new Error(`A non-superadmin user ${user.id} is trying to access cockpit when orderform is not accepted yet.`);
                Raven.captureException(ravError);
                req.flash('noaccess', true);
                req.flash('unauthorized', true);
                return verified(new Error('NOACCESS'), null);
              }


              logger.info('Accounts for the user after filtering for orderform:', accounts);

              user.accounts = accounts;
              req.session.selected.account = accounts[0];

              redisClient.set(`user-${user.id}-${req.user.hash}`, JSON.stringify(user), 'EX', 43200);
              redisClient.get(`user-${user.id}-${req.user.hash}`, (err, result) => {
                if (err) {
                  logger.error(err, 'Error while trying to persist the user');
                  req.flash('technicalErrorOccurred', true);
                  return verified(err, null)
                }
                logger.info({accountID: accounts[0].tenant, accountName: accounts[0].name, connector_id:'ycloud'},'loginSuccessCounter');
                loginSuccessCounter.labels(accounts[0].tenant, accounts[0].name, 'ycloud').inc();
                return verified(null, user)
              });
            })
            .catch(err => {
              logger.error(err, 'Error while trying to parse groups and match c4accounts');
              Raven.captureException(err);
              if (req.flash('unableToFindAccount')) {
                req.flash('unableToFindAccount', true);
              } else {
                req.flash('technicalErrorOccurred', true);
              }
              return verified(err, null)
            });
        });
      } else {
        req.flash('technicalErrorOccurred', true);
        const err = new Error('Username did not match with sapid strategy');
        Raven.captureException(err);
        return verified(err, null)
      }
    } else {
      req.flash('technicalErrorOccurred', true);
      const err = new Error('unable to find name in dex token');
      Raven.captureException(err);
      return verified(err, null)
    }
  }
};

module.exports = (passport, options, redisClient) => {
  let YCloudOptions; // Multi Federator doesn't need explicit scope to be passed.
    YCloudOptions = {
      ...options,
    }
  const loginSuccessCounter = promClient.register.getSingleMetric('c4f_cockpit_login_success');
  passport.use('ycloud-login', new YCloudStrategy(YCloudOptions, verify(redisClient, GatewayClient, FeatureToggle,loginSuccessCounter)));
};
module.exports.verify = verify;
