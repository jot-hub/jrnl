const express = require('express');
const router = express.Router();
const AuthorizationCtrl = require('../controller/authorization-ctrl');
const AppCenterCtrl = require('../controller/appcenter-ctrl');
const FeatureToggle = require('../lib/feature-toggle');

router.get('/api/appcenter', AuthorizationCtrl.ensureAPIAuthenticated, AppCenterCtrl.serverCacheHandler);

module.exports = router
