const promClient = require('prom-client');

class MetricCtrl {
  static register (req, res) {
    res.writeHead(200, {'Content-Type': 'text/plain'});
    res.end(promClient.register.metrics());
  }
}

module.exports = MetricCtrl;
