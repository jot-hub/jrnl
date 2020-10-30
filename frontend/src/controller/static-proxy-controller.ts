import httpProxy = require('http-proxy');

const proxy = httpProxy.createProxyServer();

export = proxy;