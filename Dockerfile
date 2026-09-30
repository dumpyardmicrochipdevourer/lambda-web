FROM nginx:1.29-alpine
COPY nginx/headers.conf /etc/nginx/snippets/headers.conf
COPY nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY public /usr/share/nginx/html
ENV AUTH_UPSTREAM=auth:8081 \
    CORE_UPSTREAM=core:8080
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s \
  CMD wget -qO- http://127.0.0.1:8080/ >/dev/null || exit 1
