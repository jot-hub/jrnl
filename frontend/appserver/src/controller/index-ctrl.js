const path = require('path');
const bowser = require('bowser');
const promClient = require('prom-client');
const pino = require('pino');
const helpLanguage = "en-US";


const  logger = pino({
  useLevelLabels: true,
  serializers: {
    err: pino.stdSerializers.err
  }
});
const FeatureToggle = require('../lib/feature-toggle');

const uniqueVisitLandingCounter = new promClient.Counter({
  name: 'c4f_cockpit_visit_unique_landing',
  help: 'Unique Visitors of landing page'
});

const visitLandingCounter = new promClient.Counter({
  name: 'c4f_cockpit_visit_landing',
  help: 'visits of landing page'
});

const visitCockpitCounter = new promClient.Counter({
  name: 'c4f_cockpit_visit_cockpit',
  help: 'initial load of a cockpit page'
});

const uniqueVisitCockpitCounter = new promClient.Counter({
  name: 'c4f_cockpit_visit_unique_cockpit',
  help: 'Unique visit of the cockpit'
});

let queryVariables = {
  "redirectURI": `${process.env.BASE_URL}/auth/callback`,
};

const passportOptions = {
  passReqToCallback: true,
  state: true,
  skipUserProfile: true,
};

class IndexCtrl {

  static browserCheck (req, res, next) {
    // Get the browser language
    let userLang = req.i18n.language.split('-')[0];
    // If the browser language is not enabled, then default to english
    const defaultLanguage = 'en'
    const permittedLanguages = [
      defaultLanguage, // English
      'fr', // French
      'de', // German
      'ja', // Japanese
      'pt', // Portuguese
      'ru', // Russian
      'zh', // Simplified Chinese
      'es', // Spanish
    ];
    if (!permittedLanguages.includes(userLang)) userLang = defaultLanguage;
    // switch language
    req.i18n.changeLanguage(userLang);

    try {
      const uaParser = bowser.getParser(req.get('user-agent'));
      const safariNotSupported = uaParser.satisfies({
        safari: "<=12.0"
      });

      if (uaParser.getBrowser().name === 'Internet Explorer' || safariNotSupported) {
        if (safariNotSupported) {
          req.flash('safariNotSupported', true);
        } else {
          req.flash('browserNotSupported', true);
        }

        if (req.url !== '/') {
          return res.redirect('/');
        }
      }
    } catch(err) {
      logger.warn(err, 'Browser check failed');
    }

    return next();
  }

  static serve (req, res) {
    // Metric Collection
    visitCockpitCounter.inc();
    logger.info('visitCockpitCounter');
    if (req.session && req.session.id && !req.session.uniqueCockpitVisit) {
      logger.info('uniqueVisitCockpitCounter');
      req.session.uniqueCockpitVisit = true;
      uniqueVisitCockpitCounter.inc();
    }

    let featureToggles = FeatureToggle.getFeatureTogglesForClient();

    // Render Cockpit
    if (req.url.startsWith('/unavailable.html')) {
      res.render(path.resolve(__dirname, '../views/error.ejs'), {
        status: 500,
        messageKey: 'ERROR.UNAVAILABLE',
        imgSrc: '500.png'
      });
    } else if (req.url.startsWith('/cockpitapp.html')) {
      res.render(path.join(__dirname, '../../../client/dist/cockpit/cockpitapp.html'), {
        csrf_token: req.csrfToken(),
        environment: process.env.ENVIRONMENT,
        user: {
          account: req.session && req.session.selected && req.session.selected.account ? req.session.selected.account : '',
          accounts: req.user.accounts,
          superAdminAccountIds: req.user.superAdminAccounts ? req.user.superAdminAccounts : [],
          name: req.user.name,
          email: req.user.email,
          exp: req.user.exp,
          givenName: req.user.given_name,
          familyName: req.user.family_name,
          id: req.user.id
        },
        feature_toggles: featureToggles
      });
    } else {
      res.render(path.join(__dirname, '../../../static/index.html'), {
        csrf_token: req.csrfToken(),
        environment: process.env.ENVIRONMENT,
        user: {
          account: req.session && req.session.selected && req.session.selected.account ? req.session.selected.account : '',
          accounts: req.user.accounts,
          superAdminAccountIds: req.user.superAdminAccounts ? req.user.superAdminAccounts : [],
          name: req.user.name,
          email: req.user.email,
          exp: req.user.exp,
          givenName: req.user.given_name,
          familyName: req.user.family_name,
          id: req.user.id
        },
        feature_toggles: featureToggles,
        isFeatureEnabled: FeatureToggle.isFeatureEnabled
      });
    }
  }

  static unauthorizedCheck (req, res, next) {
    if (!!req.flash('unauthorized').toString()) {
      return next()
    } else {
      res.redirect('/')
    }
  }

  static unauthorized (req, res) {
    let flash = req.flash('userId');
    const id = flash && flash.length > 0 ? flash[0] : undefined;
    flash = req.flash('noaccess');
    const noaccess = flash && flash.length > 0 ? flash[0] : undefined;
    req.logout();
    return res.render(path.resolve(__dirname, '../views/unauthorized.ejs'), {
      id, noaccess, helpLanguage
    });
  }

  static landing (req, res, next) {
    // Metric Collection
    visitLandingCounter.inc();
    logger.info('visitLandingCounter');
    if (req.session && req.session.id && !req.session.uniqueLandingVisit) {
      logger.info('uniqueLandingVisit');
      req.session.uniqueLandingVisit = true;
      uniqueVisitLandingCounter.inc();
    }

    // process flash message flags
    let flash = {
      logoutMessage: !!req.flash('logoutMessage').toString(),
      sessionExpiredMessage: !!req.flash('sessionExpiredMessage').toString(),
      unableToFindAccount: !!req.flash('unableToFindAccount').toString(),
      unableToFindC4Account: !!req.flash('unableToFindC4Account').toString(),
      technicalErrorOccurred: !!req.flash('technicalErrorOccurred').toString(),
      browserNotSupported: !!req.flash('browserNotSupported').toString(),
      safariNotSupported: !!req.flash('safariNotSupported').toString(),
      errorCallingGetOidc: !!req.flash('errorCallingGetOidc').toString(),
      link: !!req.flash('link').toString()
    };

    // determine flash hasMessage property
    flash.hasMessage = Object.values(flash).some((value) => {
      return value === true;
    });

    //render landing or cockpit
    if (req.isAuthenticated() && (req.user && req.user.token && req.user.token.ycloud) && !flash.browserNotSupported && !flash.safariNotSupported) {
      logger.info('ycloud token obtained -- proceed')
      return next()
    } else if (
      // Feature Flag to block anonymous access to the landing page
      !(process.env.LOGIN_FLOW && process.env.LOGIN_FLOW === 'BLOCK_ANONYMOUS') || //if BA not set --> show landing page
      (req.isAuthenticated() && (req.user && req.user.token && req.user.token.sapid)) //
    ) {
      return res.render(path.resolve(__dirname, '../views/landing.ejs'), {
        flash: flash,
        helpLanguage: helpLanguage,
      });
    } else { //if BA  set  or if i don't have sapid token --> /auth first
      logger.info('redirect to auth')
      res.redirect('/auth')
    }
  }

  static logout (req, res) {
    const accountsIDP = 'https://accounts.sap.com';
    const ycloudIDP = process.env.ENVIRONMENT === 'prod' ? 'https://ycloud.accounts.ondemand.com' : 'https://ycloudtest.accounts400.ondemand.com';
    const logoutPath = '/saml2/idp/slo';

    req.logout();
    if (req.query.expired === 'true') {
      req.flash('sessionExpiredMessage', true);
    } else {
      req.flash('logoutMessage', true);
    }

    //reset or delete properties set to regulate login flow
    req.session.originalPath = '/';
    delete req.session.accountid;
    delete req.session.provider;

    // process flash message flags
    let flash = {
      logoutMessage: !!req.flash('logoutMessage').toString(),
      sessionExpiredMessage: !!req.flash('sessionExpiredMessage').toString(),
      unableToFindAccount: !!req.flash('unableToFindAccount').toString(),
      unableToFindC4Account: !!req.flash('unableToFindC4Account').toString(),
      technicalErrorOccurred: !!req.flash('technicalErrorOccurred').toString(),
      browserNotSupported: !!req.flash('browserNotSupported').toString(),
      safariNotSupported: !!req.flash('safariNotSupported').toString()
    };

    // determine flash hasMessage property
    flash.hasMessage = Object.values(flash).some((value) => {
      return value === true;
    });

    return res.render(path.resolve(__dirname, '../views/landing.ejs'), {
      flash,
      helpLanguage,
      accountsLogoutURL: accountsIDP + logoutPath,
      ycloudLogoutURL: ycloudIDP + logoutPath
    });
  }

}

module.exports = IndexCtrl;
