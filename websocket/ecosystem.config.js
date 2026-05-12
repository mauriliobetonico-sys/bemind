module.exports = {
  apps: [{
    name:         'visaoos-ws',
    script:       'server.js',
    instances:    1,
    autorestart:  true,
    watch:        false,
    max_memory_restart: '256M',
    env: {
      NODE_ENV: 'production',
    },
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    error_file:  './logs/ws-error.log',
    out_file:    './logs/ws-out.log',
  }]
};
