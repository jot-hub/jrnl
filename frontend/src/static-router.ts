import express from "express";
import path from "path";

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

  const staticPath = '../../dist/app/';
  res.sendFile(req.url, { root: path.join(__dirname, staticPath) }, err => {
    if (err) {
      return next(err)
    }
  });
});

export = router;