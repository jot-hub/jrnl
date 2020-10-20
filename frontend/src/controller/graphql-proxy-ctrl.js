
  const ACCEPT_ORDER_FORM_MUTATION = 'acceptOrderForms';
  const APIS_WITH_NO_ACCOUNTID = [
    'getproductVersionsByType', // Runtimes Overview
    'getCluster', // Runtime Details
    'createCluster',
    'getCluster',
    'clusterNameLengthMax',
    'createServiceAccountKey',
    'createApplication',
    'createXFApplicationToken',
    'deleteApplication',
    'deleteServiceAccountKey',
    'deleteCluster',
    'UsersByLoginNameQuery'
  ];

const logger = require('pino')({
    useLevelLabels: true
});
const Raven = require('raven');
const featureToggle = require('../lib/feature-toggle');

function createGraphqlProxyServer() {
  const httpProxy = require('http-proxy');
  const proxy = httpProxy.createProxyServer();
  const redisClient = require('../lib/setup-redis').redisClient;

  // Listen for the `error` event on `proxy`.
  proxy.on('error', function (err, req, res) {
    res.writeHead(500, {
      'Content-Type': 'text/plain'
    });

    //TODO
    res.end('Something went wrong while proxy to graphql gateway');
  });

  /*
    Listens for the 'proxyreq' event on proxy
   */
  proxy.on('proxyReq', function (proxyReq, req, res, options) {

    if (req.body) {
      let bodyData = JSON.stringify(req.body);
      // incase if content-type is application/x-www-form-urlencoded -> we need to change to application/json
      proxyReq.setHeader('Content-Type', 'application/json');
      proxyReq.setHeader('Content-Length', Buffer.byteLength(bodyData));

      let ip = req.ip || req.connection.remoteAddress;
      if (ip) {
        proxyReq.setHeader('x-forwarded-for', ip);
      } else {
        // very rare case that it could be undefined (more prominent when running local e2e tests)
        // if we try to set the header using an undefined value, the server will crash silently
        logger.error('ip is undefined');
      }

      delete req.body.query; // we only want the operationName and the variables
      proxyReq.setHeader('x-c4f-invoke', JSON.stringify(req.body));
      if (proxyReq.hasHeader("x-request-id"))
        logger.info("Monitoring headers set for x-request-id: " + proxyReq.getHeader("x-request-id"));

      // https://stackoverflow.com/questions/39847144/modify-request-body-and-then-proxying-in-node-js
      // issue with body parsing and http-proxy, have to stream
      proxyReq.write(bodyData);

    }
  });

  proxy.on('proxyRes', function (proxyRes, req, res) {
    // If acceptOrderForms mutation was successful then we update redis
    if (req.body && req.body.operationName === ACCEPT_ORDER_FORM_MUTATION) {
      var body = [];

      proxyRes.on('data', function (chunk) {
        body.push(chunk);
      });

      proxyRes.on('end', function () {
        body = Buffer.concat(body).toString();
        try {
          body = JSON.parse(body);
        } catch (err) {
          Raven.captureException(err);
          return res.status(500).send('Something went wrong while handling proxyRes for ' + ACCEPT_ORDER_FORM_MUTATION);
        }
        if (!(body && body.data && Array.isArray(body.data.acceptOrderForms))) {
          Raven.captureException(new Error('Something went wrong with the acceptOrderForms mutation proxyResponse.'));
          return res.status(500).send('Something went wrong while handling proxyRes for ' + ACCEPT_ORDER_FORM_MUTATION);
        }
        redisClient.get(`user-${req.user.name.toLowerCase()}-${req.user.hash}`, (err, storedUser) => {
          if (err) {
            Raven.captureException(err);
            return res.status(500).send('Something went wrong while interacting with Redis with the proxyRes event');
          }
          try {
            storedUser = JSON.parse(storedUser);
          } catch (err) {
            Raven.captureException(err);
            return res.status(500).send('Something went wrong while reading user from redis.');
          }

          // Only update the redis instance if a proper response is received from the service
          body.data.acceptOrderForms.forEach(function (acceptedOrderForm) {
            // In case it wasn't updated, update it anyways
            if (acceptedOrderForm.acceptedStatus === 'SUCCESS' || acceptedOrderForm.acceptedStatus === 'ALREADY_ACCEPTED') {
              storedUser.accounts.forEach(function (storedUserAccount, i) {
                if (storedUserAccount.tenant === acceptedOrderForm.accountID) {
                  storedUser.accounts[i].orderFormAccepted = true;
                }
              });
            }
          });

          redisClient.set(`user-${req.user.id}-${req.user.hash}`, JSON.stringify(storedUser), 'EX', 43200, function (err) {
            if (err) {
              logger.error("Error when updating user for order form");
              Raven.captureException(err);
              return res.status(500).send('Something went wrong while updatig user in redis.');
            }
          });
        });
      });
    }
  });

  return proxy;
}

const proxy = createGraphqlProxyServer();

function requestContainsAccountsNotAccepted(accountsNotAccepted, accountId) {
  // only check if the body of the request if the order form has not been accepted
  return accountsNotAccepted && accountsNotAccepted.some((acc) => { return acc.tenant === accountId; });
}

/*
  {
    "operationName": "acceptOrderForms",
    "query": "mutation acceptOrderForms($input: [OrderFormInput]!) { acceptOrderForms(input: $input) { accountID acceptedStatus } }",
    "variables": {
      "input": [
        {
          "accountID": "dev_cxone",
          "formURL": "",
          "accepted": false
        }
      ]
    }
  }
*/
function isUserSuperAdminForAllRequestBodyInput(user, requestBody) {
  if (user && requestBody && requestBody.variables && Array.isArray(requestBody.variables.input) && requestBody.variables.input.length) {
    return requestBody.variables.input.every(function (element) {
      return user.superAdminAccounts && user.superAdminAccounts.includes(element.accountID);
    });
  }
  return false;
}

class GraphQLProxyCtrl {
  static setAuthHeader(req, res, next) {
    const user = req.user;

    if (user && user.token) {
      let token;
      if(featureToggle.isFeatureEnabled('FEATURE_OPTIMIZE_SSO_REDIRECTS')){
          if(user.token.ycloud){
            req.headers.authorization = `Bearer ${user.token.ycloud.validatedIdToken}`;
          }
      } else { // PROD status quo
        req.headers.authorization = `Bearer ${user.token.ycloud.id_token}`;
      }
    }
    return next();
  }

  static proxy(req, res) {
    return proxy.web(req, res, {
      headers: {
        'x-request-id': req.id
      },
      ignorePath: true,
      //TODO do not do this in production
      secure: false,
      changeOrigin: true,
      target: process.env.GRAPHQL_GATEWAY_URL
    });
  }

  // We want to deny requests that are for an account that does not have their orderFormAccepted.
  // Some Mutations don't need an accountID, so we have a whitelist for those
  // Note: The express.json() function must be called in the middleware chain prior to using this function middleware
  static checkIfOrderFormAccepted() {
    return (req, res, next) => {
      let accountsNotAccepted = [];

      if (req.user && req.user.accounts) {
        accountsNotAccepted = req.user.accounts.filter(e => !e.orderFormAccepted);
      } else {
        Raven.captureException(new Error('invalid session state in checkMutationPermissions'));
        return res.status(500).send('Invalid session state');
      }

      if (!accountsNotAccepted || accountsNotAccepted.length <= 0) {
        return next();
      }

      if (req.body && !req.body.operationName) {
        return res.status(403).send('You must pass in an operationName');
      }

      // Use a whitelist because we want to control the mutations that can pass through without passing in an accountID
      if (req.body && (APIS_WITH_NO_ACCOUNTID.includes(req.body.operationName) ||
        req.body.operationName === ACCEPT_ORDER_FORM_MUTATION)) {
        return next();
      }

      // Only perform this check if there is an order form in that environment!
      const accountId = req.header('x-cockpit-account-tenant');
      if (requestContainsAccountsNotAccepted(accountsNotAccepted, accountId)) {
        logger.error('Unauthorized operation:', req.body.operationName);
        return res.status(403).send('You are not authorized to perform this action for this account');
      }

      return next();
    }
  }


  static checkForSuperAdminIfAcceptingOrderForm(){
    return (req, res, next) => {
      if (req.body && !req.body.operationName) {
        return res.status(403).send('You must pass in an operationName');
      }

      if (req.body && req.body.operationName === ACCEPT_ORDER_FORM_MUTATION) {
        if (!isUserSuperAdminForAllRequestBodyInput(req.user, req.body)) {
          logger.error('Unauthorized operation:', ACCEPT_ORDER_FORM_MUTATION);
          return res.status(403).send('You are not authorized to perform this action for at least one of the account inputs');
        }
      }
      return next();
    }
  }
}

module.exports = GraphQLProxyCtrl;
