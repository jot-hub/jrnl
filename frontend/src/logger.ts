import pino from "pino";

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
export = logger;