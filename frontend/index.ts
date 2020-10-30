import dotenv from "dotenv";
import express from "express";
import path from "path";
import logger from "./src/logger";
import ejs from "ejs";
import staticrouter = require("./src/router/static-router");
import * as terminus from "@godaddy/terminus";
import * as http from "http";

// initialize configuration
dotenv.config();

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

const server = http.createServer(app);
terminus.createTerminus(server, {
    healthChecks: {
        '/health': ()=> Promise.resolve("OK")
    }
});

// start the express server
server.listen( port, () => {
    // tslint:disable-next-line:no-console
    console.log( `hey server started at http://localhost:${port}` );
} );