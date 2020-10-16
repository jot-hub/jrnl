const FeatureToggle = require('../lib/feature-toggle');
const AuthorizationCtrl = require('../controller/authorization-ctrl');
const { Router } = require('express');
const router = Router();
const UIProxyCtrl = require('../controller/ui-proxy/ui-proxy-ctrl');

router.get('/ui/**', AuthorizationCtrl.ensureAPIAuthenticated, UIProxyCtrl.proxy);

module.exports = router;
