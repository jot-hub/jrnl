const {GraphQLClient} = require('graphql-request');
const FeatureToggle = require('./feature-toggle');
const logger = require('pino')({
  useLevelLabels: true
});
class GatewayClient {

  /**
   * Make a service call inside the cluster to the Federator Service to get the information needed to setup passport
   * This call makes it possible for passport to authenticate with the corresponding OIDC server directly.
   * @param queryVariables
   * @returns {Promise<GatewayClient.getAndValidateOIDCParameters|*>}
   */
   static async getAndValidateOIDCParameters(queryVariables){
    let OIDCParams;
     if(FeatureToggle.isFeatureEnabled("FEATURE_OPTIMIZE_SSO_REDIRECTS")){
       logger.info("Fetching OIDC params from", process.env.MULTIFEDERATOR_GQL_SVC_URL);

       //set to localhost:5555/query for local dev
       let federatorGqlClient = new GraphQLClient(process.env.MULTIFEDERATOR_GQL_SVC_URL);
       const query =
        `query ($redirectURI: String!, $connectorId: ConnectorId!, $c4hfAccount:String){
            getAndValidateOIDCParameters(redirectURI: $redirectURI, connectorId: $connectorId, c4hfAccount: $c4hfAccount){
                clientID,
                clientSecret,
                issuer,
                authorizationURL,
                callbackURL,
                tokenURL
            }
         }`;
      const variables = {...queryVariables};

      // spiffe needed when calling from local development environement
      if(process.env.NODE_ENV!=="production"){federatorGqlClient.setHeader('X-Forwarded-Client-Cert',`spiffe://cluster.local/ns/faros/sa/faros-cockpit`);}
      try {
         OIDCParams = federatorGqlClient.request(query,variables); // this is a promise
         return OIDCParams;
      } catch (error) {
        logger.error(`Did NOT resolve promise for Fetching OIDC params from ${process.env.MULTIFEDERATOR_GQL_SVC_URL}`,error);
        return error;
      }
    }
  };

  /**
   * Since we directly authenticate with IAS and not the federator, we need to whitelist them in ISTIO policies and gateway
   * Since this doesn't scale, we get the token resigned by the Federator
   * https://github.wdf.sap.corp/cx/c4f-cockpit-backlog/issues/441#issuecomment-2059348
   * @param queryVariables
   * @returns {Promise<any>}
   */
  static async exchangeAndValidateToken(queryVariables){
    if(FeatureToggle.isFeatureEnabled("FEATURE_OPTIMIZE_SSO_REDIRECTS")){
      logger.info("Exchange and validate token from", process.env.MULTIFEDERATOR_GQL_SVC_URL);
      let federatorGqlClient = new GraphQLClient(process.env.MULTIFEDERATOR_GQL_SVC_URL); //set to localhost:5555/query for local dev

      const query =
        `query ($idToken: String!, $ConnectorId: ConnectorId!, $c4hfAccount: String) {
            exchangeAndValidateToken (idToken: $idToken, connectorId: $ConnectorId, c4hfAccount: $c4hfAccount)
         }`;
      const variables = {...queryVariables};

      // spiffe needed when calling from local development environement
      if(process.env.NODE_ENV!=="production"){federatorGqlClient.setHeader('X-Forwarded-Client-Cert',`spiffe://cluster.local/ns/faros/sa/faros-cockpit`);}
      return federatorGqlClient.request(query,variables);
    }
  };

  static async roleIDsToGroupWithAccountID(c4hfAccountID, groups, token) {
    const graphQLClient = new GraphQLClient(process.env.GRAPHQL_GATEWAY_URL, {
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    const query =
      `query roleIDsToGroupWithAccountID($c4hfAccountID: String!, $groups: [String!]!) {
        roleIDsToGroupWithAccountID(c4hfAccountID: $c4hfAccountID, roleIDs: $groups) {
          product
          tenant
          role
        }
      }`;

    graphQLClient.setHeader('x-c4f-invoke',
    `{"operationName":"roleIDsToGroupWithAccountID","variables":{ 'c4hfAccountID': "${c4hfAccountID}", 'groups': ${JSON.stringify(groups)} }}`);

    return graphQLClient.request(query, {c4hfAccountID, groups})
  }


  static async resolveAccountIDData(groups , token){
    const graphQLClient = new GraphQLClient(process.env.GRAPHQL_GATEWAY_URL, {
      headers: {
        authorization: `Bearer ${token}`,
      },
    });
    const query =
        `query getC4Accounts {
          c4fAccounts {
            totalCount
            edges {
              cursor
              node {
                accountID
                customerName
                orderFormAccepted
              }
            }
          }
        }`;

    graphQLClient.setHeader('x-c4f-invoke',
        `{"operationName":"getC4Accounts"}`);

    return graphQLClient.request(query, {groups})
  }


  static async accountsLoginFlow(user) {
    function getHeaders(){
      if(FeatureToggle.isFeatureEnabled('FEATURE_OPTIMIZE_SSO_REDIRECTS')){
        return {
          headers: {
            authorization: `Bearer ${user.token.sapid.validatedIdToken}`,
          }
        }
      } else {
        return {
          headers: {
            authorization: `Bearer ${user.token.sapid.id_token}`,
          }
        }
      }
    };

    const graphQLClient = new GraphQLClient(process.env.GRAPHQL_GATEWAY_URL, getHeaders());

    const query = `mutation prepareUserStatus {
      prepareUserLogin { status accountIDs }
    }`;

    graphQLClient.setHeader('x-c4f-invoke', `{"operationName":"prepareUserStatus"}`);

    return graphQLClient.request(query)
  }
}

module.exports = GatewayClient;
