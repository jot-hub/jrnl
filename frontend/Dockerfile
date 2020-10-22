FROM node:12 as builder

ARG APP_DIR=/jrnl/app

RUN mkdir -p $APP_DIR

COPY ./ $APP_DIR
WORKDIR $APP_DIR

RUN npm install
RUN npm run build

FROM node:12

ARG NODE_ENV=production
ENV NODE_ENV $NODE_ENV

ARG PORT=3000
ENV PORT $PORT
EXPOSE $PORT

ARG APP_DIR=/jrnl/app

RUN mkdir -p $APP_DIR

COPY --from=builder $APP_DIR $APP_DIR

RUN addgroup --system --gid 1001 jrnlapp && adduser --system --uid 1001 jrnlapp
USER jrnlapp

WORKDIR $APP_DIR

CMD ["node", "."]