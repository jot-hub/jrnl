import logger from "../logger";
import express from "express";
import proxy from "../controller/static-proxy-controller";

const router = express.Router();

const staticExt = [
  '*.js',
  '*.ico',
  '*.css',
  '*.png',
  '*.jpg',
  '*.woff2',
  '*.woff',
  '*.ttf',
  '*.svg',
];

router.get(staticExt.join('|'), (req, res, next) => {
  // cache set to one hour for artifacts.
  res.set({
    "Cache-Control": "private, max-age=3600",
    "Expires": new Date(Date.now() + 3600000).toUTCString()
  });

  return proxy.web(req, res, {
    changeOrigin: true,
    target: process.env.STATIC_SERVER
  });
});

router.get( "/app", (req,res) => {
  const indexPage = `${process.env.STATIC_SERVER}/index.html`;
  logger.info(`proxying to ${indexPage}`);
  return proxy.web(req, res, { ignorePath: true, changeOrigin: true, target: indexPage });
});

export = router;