import pino from 'pino';

const isDev = process.env.NODE_ENV !== 'production';

const logger = pino(
  {
    level: isDev ? 'debug' : 'info',
    base: undefined,
    timestamp: pino.stdTimeFunctions.isoTime,
  },
  isDev
    ? pino.transport({
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss',
          ignore: 'pid,hostname,req,res,responseTime',
          messageFormat: '{msg}',
          singleLine: true,
        },
      })
    : undefined
);

export default logger;
