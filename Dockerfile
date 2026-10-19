# Статический сайт на nginx: для Amvera, Layero и любого хостинга с Docker
FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY index.html styles.css favicon.svg /usr/share/nginx/html/
COPY js /usr/share/nginx/html/js
COPY content /usr/share/nginx/html/content
EXPOSE 80
