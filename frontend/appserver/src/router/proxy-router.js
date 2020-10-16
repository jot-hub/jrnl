const { Router } = require('express');
const AuthorizationCtrl = require('../controller/authorization-ctrl');
const GraphQLProxyCtrl = require('../controller/graphql-proxy-ctrl');
const router = Router();
const express = require('express');

router.post('/graphql', AuthorizationCtrl.ensureAPIAuthenticated, AuthorizationCtrl.ensureCSRF, GraphQLProxyCtrl.setAuthHeader, express.json(), GraphQLProxyCtrl.checkForSuperAdminIfAcceptingOrderForm(), GraphQLProxyCtrl.checkIfOrderFormAccepted(), GraphQLProxyCtrl.proxy);


module.exports = router;
