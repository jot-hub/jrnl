const helmet = require('helmet');

module.exports = app => {
  app.use(helmet.xssFilter({ setOnOldIE: true }));
  app.use(helmet.frameguard({ action: 'sameorigin' }));
  app.use(helmet.hsts({
    maxAge: 7776000000,
    includeSubDomains: true,
    preload: true
  }));
  app.use(helmet.ieNoOpen());
  app.use(helmet.noSniff());
  app.use(helmet.noCache());
  app.use(helmet.referrerPolicy({ policy: 'same-origin' }));
  app.use(helmet.dnsPrefetchControl({ allow: false }));

  app.use(helmet.contentSecurityPolicy({
    directives: {
      defaultSrc: ['\'self\''],
      scriptSrc: ['\'self\'', '\'unsafe-eval\'', '\'unsafe-inline\'' , 'webassistant.enable-now.cloud.sap'],
      styleSrc: ['\'self\'', '\'unsafe-inline\'', 'https://unpkg.com', 'webassistant.enable-now.cloud.sap'],
      imgSrc: ['\'self\'', 'data:', 'http://unpkg.com', '*.sap.com', '*.wdf.sap.corp', '*.cloudfront.net'],
      connectSrc: ['\'self\'' , 'https://demo.enable-now.cloud.sap', 'help.sap.com'],
      fontSrc: ['\'self\'', 'data:', 'https://unpkg.com', 'https://help.sap.com', 'https://webassistant.enable-now.cloud.sap'],
      objectSrc: ['\'self\''],
      frameSrc: ['*']
      // frameAncestors: ['\'none\'']
    },

    // Set to true if you only want browsers to report errors, not block them
    reportOnly: false,

    // report violations
    reportUri: '/report-violation',

    // Set to true if you want to blindly set all headers: Content-Security-Policy,
    // X-WebKit-CSP, and X-Content-Security-Policy.
    setAllHeaders: false,

    // Set to true if you want to disable CSP on Android where it can be buggy.
    disableAndroid: false,

    // Set to false if you want to completely disable any user-agent sniffing.
    // This may make the headers less compatible but it will be much faster.
    // This defaults to `true`.
    browserSniff: true
  }));

  return app;
};
