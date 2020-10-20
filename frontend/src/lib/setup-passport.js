const passport = require('passport');
const { URL } = require('url');
const FeatureToggle = require('./feature-toggle');
const yCloudPassport = require('./passport/ycloud');
const sapIDPassport = require('./passport/sapid').default;
const promClient = require('prom-client');

module.exports = (app, redisClient) => {

  const loginSuccessCounter = new promClient.Counter({
    name: 'c4f_cockpit_login_success',
    help: 'successful login',
    labelNames: ['accountID', 'accountName', 'connector_id']
  });

  let options;
  const passportOptions = {
    passReqToCallback: true,
    state: true,
    skipUserProfile: true,
  };

  const multiFederatorOptions = {
    issuer: process.env.MULTIFEDERATOR_URL,
    authorizationURL: `${process.env.MULTIFEDERATOR_URL}/oauth2/auth`,
    tokenURL: `${process.env.MULTIFEDERATOR_URL}/oauth2/token`,
    clientID: process.env.MULTIFEDERATOR_CLIENT_ID,
    clientSecret: process.env.MULTIFEDERATOR_CLIENT_SECRET,
    callbackURL: `${process.env.BASE_URL}/auth/callback`,
    ...passportOptions
  };


  yCloudPassport(passport, multiFederatorOptions, redisClient);
  sapIDPassport(passport, multiFederatorOptions, redisClient);

  passport.serializeUser((user, cb) => cb(null, user));
  passport.deserializeUser((user, done) => {
    redisClient.get(`user-${user.id}-${user.hash}`, (err, result) => {
      try {
        const user = JSON.parse(result);
        done(null, user); //Strategy's Verify method resolves to this to persist the authenticated user.
      } catch (err) {
        done(err, null);
      }
    });
  });
  app.use(passport.initialize()); // middleware to initialize passport
  app.use(passport.session()); // middleware to persist login sessions
  return passport
};
