const logger = require('pino')({
  useLevelLabels: true
});

function getFeatureDefinitions() {
  let featuresDefs = {feature:[]};
  if(process.env.NODE_ENV !== 'production') {
    logger.warn('Local feature definitions applied!');
    return loadLocalFeatureJson();
  }
  try {
    featuresDefs = JSON.parse(process.env.FEATURES_JSON);
  } catch(err){
    throw new Error('Invalid json for features json', err);
  }
  logger.info('Fetched features json from env:', featuresDefs);
  if (featuresDefs.feature && featuresDefs.feature.length && featuresDefs.feature.length > 0) {
    return featuresDefs;
  } else {
    throw new Error('Invalid Features json in env');
  }
}

function loadLocalFeatureJson() {
  let availableFeatures;
  try {
    availableFeatures = require('../../features.json');
  }catch(err){
    availableFeatures = {feature:[]};
  }
  logger.warn('Feature defs:', availableFeatures);
  return availableFeatures;
}

const featureDefinitions =  getFeatureDefinitions();

function getFeatureTogglesForClient() {
  /*
        Load the definition of feature toggles
        Send back only the relevant toggles to the front end depending on the environment.
        The features.json can have as many envs as required.
        The features json is not automatically loaded on a change. the server needs to be restarted.
        Note: if environment is undefined then "prod" one is used
              since the assumption is that prod has the least amount of new features.
       */

  // Beware: case-sensitivity of env variables across platforms: https://github.com/nodejs/node/issues/9157

  let features = [];

  if (!process.env.ENVIRONMENT) {
    process.env.ENVIRONMENT = "prod"; // prod is where number of features are the least
  }

  for (let i = 0; i < featureDefinitions.feature.length; i++) {
    featureDefinitions.feature[i].environments = featureDefinitions.feature[i].environments.filter(function (environment) {
      return environment.id === process.env.ENVIRONMENT && !!environment.enabled;
    });
    if(featureDefinitions.feature[i].environments.length > 0) {
      features.push(featureDefinitions.feature[i]);
    }
  }

  return {feature: features};
}

// Check only high level overview of toggle enabling (e.g: is this feature enabled for the current environment?)
// To be used as middleware
function isFeatureEnabledInEnvironmentMiddleware(featureId) {
  return function (req, res, next) {
    if (!featureDefinitions) {
      logger.error('The features.json file is empty');
      res.sendStatus(501); // 501 Not Implemented
    }
    var featureExists = featureDefinitions.feature.find(feature => feature.id === featureId);

    if (featureExists && featureExists.environments) {
      var environment = featureExists.environments.find(environment => environment.id === process.env.ENVIRONMENT);
      if (environment && environment.enabled) {
        return next();
      }
    }

    if (res.hasHeader("x-request-id")) {
      logger.warn("DENY x-request-id: " + res.getHeader("x-request-id") + "; featureId: " + featureId + "; environment: " + process.env.ENVIRONMENT);
    }

    res.status(403).send("Forbidden: This feature is not active for this environment");
  }
}

function isFeatureEnabledInEnvironment(featureId) {
  var featureExists = featureDefinitions.feature.find(feature => feature.id === featureId);

  if (featureExists && featureExists.environments) {
    var environment = featureExists.environments.find(environment => environment.id === process.env.ENVIRONMENT);
    if (environment && environment.enabled) {
      return true;
    }
  }

  return false;
}

function isFeatureEnabled(featureId) {
  if (!featureDefinitions) {
    logger.error('The features.json file is empty');
    return false;
  }
  var featureExists = featureDefinitions.feature.find(feature => feature.id === featureId);

  if (featureExists && featureExists.environments) {
    var environment = featureExists.environments.find(environment => environment.id === process.env.ENVIRONMENT);
    if (environment && environment.enabled) {
      return true;
    }
  }

  return false;
}

module.exports = {
  isFeatureEnabledInEnvironmentMiddleware: isFeatureEnabledInEnvironmentMiddleware,
  isFeatureEnabledInEnvironment: isFeatureEnabledInEnvironment,
  getFeatureTogglesForClient: getFeatureTogglesForClient,
  isFeatureEnabled: isFeatureEnabled
}
