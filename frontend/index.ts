import dotenv from "dotenv";
import express from "express";
import path from "path";
import pino from "pino";
import ejs from "ejs";
import staticrouter = require("./src/static-router");

// initialize configuration
dotenv.config();

const logger = pino({
    formatters: {
      level: (label) => {
        return { level: label };
      },
    },
    serializers: {
        err: pino.stdSerializers.err
    }
});

// port is now available to the Node.js runtime
// as if it were an environment variable
const port = process.env.SERVER_PORT ? process.env.SERVER_PORT : 8080;

const app = express();

// Configure Express to use EJS
app.set( "views", path.join( __dirname, "views" ) );
app.set( "view engine", "ejs" );

app.engine('html', ejs.renderFile);

app.use(staticrouter);

// define a route handler for the default home page
app.get( "/", ( req, res ) => {
    // render the index template
    res.render( "index" );
} );

app.get( "/app", ( req, res ) => {
    logger.info(__dirname);
    // render the index template
    res.render(path.join(__dirname, "app/index.html"));
} );

// start the express server
app.listen( port, () => {
    // tslint:disable-next-line:no-console
    console.log( `hey server started at http://localhost:${port}` );
} );