module.exports = {
  /**
   * Application configuration section
   * http://pm2.keymetrics.io/docs/usage/application-declaration/
   */
  apps: [
    {
      name: 'Foxy Client Extension',
      script: 'index.js',
      cron_restart: '*/10 * * * *'
    }
  ]
};
