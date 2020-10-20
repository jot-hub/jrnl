import * as shell from "shelljs";

// Copy all the view templates
shell.cp( "-R", "src/views", "dist/" );

// Copy expo app
shell.cp( "-R", "../app/web-build", "dist/app/" );