const path = require('path');
const proxyPaths = require(require.resolve(getUiProxyConfig()));

function getUiProxyConfig() {
  if (process.env.NODE_ENV !== 'production') {
    return './.ui-proxy.config.development';
  } else {
    return './ui-proxy.config';
  }
}

function createUiProxyServer() {
  const httpProxy = require('http-proxy');
  const proxy = httpProxy.createProxyServer();
  const redisClient = require('../../lib/setup-redis').redisClient;

  // Listen for the `error` event on `proxy`.
  proxy.on('error', function (err, req, res) {
    const msg = {
      status: 500,
      messageKey: 'ERROR.UNAVAILABLE',
      imgSrc: '500.png',
      hideHeader: true
    };
    res.status(msg.status).format({
      'application/json' () {
        res.status(msg.status).json(msg);
      },
      'text/html' () {
        res.status(msg.status).render(path.resolve(__dirname, '../../views/error.ejs'), msg);
      },
    });
  });
  return proxy;
}

const proxy = createUiProxyServer();

class UIProxyCtrl {
  static setAuthHeader(req, res, next) {
    const user = req.user;
    if (user) {
      req.headers.authorization = `Bearer ${user.token.ycloud.id_token}`;
    }
    return next();
  }

  static proxy(req, res) {
    const pathParts = req.url.split('/');
    const host = proxyPaths[pathParts[2]];
    if (host) {
      const target = `${host}/${pathParts.slice(3).join('/')}`;
      return proxy.web(req, res, {
        headers: {
          'x-request-id': req.id,
        },
        ignorePath: true,
        secure: false,
        changeOrigin: true,
        target
      });
    } else {
      const msg = {
        status: 404,
        messageKey: 'ERROR.NOT_FOUND',
        imgSrc: '404.png',
        hideHeader: true
      };

      return res.status(msg.status).format({
        'application/json' () {
          res.status(msg.status).json(msg);
        },
        'text/html' () {
          res.status(msg.status).render(path.resolve(__dirname, '../../views/error.ejs'), msg);
        },
      });
    }
  }

}

module.exports = UIProxyCtrl;
