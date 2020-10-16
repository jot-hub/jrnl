const Raven = require('raven');
const path = require('path');
const pino = require('pino');
const  logger = pino({
  useLevelLabels: true,
  serializers: {
    err: pino.stdSerializers.err
  }
});

class ErrorHandler {
  static handler (err, req, res, next) {
    if (err & err.code === 'EBADCSRFTOKEN') {
      logger.error(err, 'Logging EBADCSRFTOKEN error (Invalid CSRF Token)');
      // handle CSRF token errors here
      return res.status(403).send('Invalid CSRF Token');
    }

    if (res.headersSent) {
      logger.warn(err, 'Headers already Sent');
      return res.end();
    }

    // is it an error and not a file not found
    if (err && err.code !== 'ENOENT') {
      logger.error(err, 'Error Handler:');

      let msg = {
        status: err.statusCode || 500,
        imgSrc: '500.png'
      };

      if (err.code === 'ECONNREFUSED') {
        Raven.captureException(err);
        msg.messageKey = 'ERROR.ACCESS_ERROR';
      } else {
        msg.messageKey = 'ERROR.UNKNOWN_ERROR';
      }

      if (req.isAuthenticated()) {
        msg.hideHeader = true;
      }

      return res.format({
        'application/json' () {
          res.status(msg.status).json(msg);
        },
        'text/html' () {
          res.status(msg.status).render(path.resolve(__dirname, '../views/error.ejs'), msg);
        },
      });
    }
    return next();
  }

  /**
   * Setup Last Resort Error Handler
   *
   * catch 404 and forward to error handler
   * needs to be below all other routes
   */
  static lastResort (req, res) {
    logger.info('catching unknown error/route/method', req.path);

    let msg = {
      status: 405,
      messageKey: 'ERROR.METHOD_NOT_ALLOWED'
    };

    if (req.method === 'GET') {
      msg.status = 404;
      msg.messageKey = 'ERROR.NOT_FOUND';
    } else {
      msg.imgSrc = '404.png';
    }

    if (req.isAuthenticated()) {
      msg.hideHeader = true;
    }

    return res.status(msg.status).format({
      'application/json' () {
        res.status(msg.status).json(msg);
      },
      'text/html' () {
        res.status(msg.status).render(path.resolve(__dirname, '../views/error.ejs'), msg);
      },
    });
  }
}

module.exports = ErrorHandler;
