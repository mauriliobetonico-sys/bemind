# BE MIND PROPOSALS — imagem PHP 8.2 + Apache
FROM php:8.2-apache

# extensões requeridas pelo app
RUN apt-get update && apt-get install -y --no-install-recommends \
        libpng-dev libjpeg-dev libwebp-dev libfreetype6-dev libzip-dev libonig-dev \
        unzip git \
    && docker-php-ext-configure gd --with-freetype --with-jpeg --with-webp \
    && docker-php-ext-install -j$(nproc) pdo pdo_mysql mbstring gd zip \
    && a2enmod rewrite headers expires deflate \
    && rm -rf /var/lib/apt/lists/*

# php.ini de produção com uploads maiores para logos/anexos
RUN mv "$PHP_INI_DIR/php.ini-production" "$PHP_INI_DIR/php.ini" \
    && sed -ri 's/^;?upload_max_filesize\s*=.*/upload_max_filesize = 20M/' "$PHP_INI_DIR/php.ini" \
    && sed -ri 's/^;?post_max_size\s*=.*/post_max_size = 25M/'         "$PHP_INI_DIR/php.ini" \
    && sed -ri 's/^;?date.timezone\s*=.*/date.timezone = America\/Sao_Paulo/' "$PHP_INI_DIR/php.ini"

# vhost aponta para /public
COPY docker/apache.conf /etc/apache2/sites-available/000-default.conf

# entrypoint garante que storage/ e public/uploads/ sejam graváveis pelo www-data
# (necessário porque volumes nomeados sobem como root)
COPY docker/entrypoint.sh /usr/local/bin/bemind-entrypoint
RUN chmod +x /usr/local/bin/bemind-entrypoint

WORKDIR /var/www/html
ENTRYPOINT ["/usr/local/bin/bemind-entrypoint"]
CMD ["apache2-foreground"]
