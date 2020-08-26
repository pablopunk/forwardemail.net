const path = require('path');

const ms = require('ms');

const queues = [
  {
    name: 'migration',
    options: { attempts: 1 },
    processors: [
      {
        processor: path.join(__dirname, 'migration.js'),
        concurrency: 1
      }
    ]
  },
  {
    name: 'email',
    options: {
      attempts: 2
    },
    processors: [
      {
        processor: path.join(__dirname, 'email.js'),
        concurrency: 3
      }
    ]
  },
  {
    name: 'vanity-domains',
    options: {
      attempts: 1
    },
    processors: [
      {
        processor: path.join(__dirname, 'vanity-domains.js'),
        concurrency: 1
      }
    ]
  },
  {
    name: 'translate-phrases',
    options: {
      attempts: 1,
      defaultJobOptions: {
        repeat: {
          every: ms('1hr')
        }
      }
    },
    processors: [
      {
        processor: path.join(__dirname, 'translate-phrases.js'),
        concurrency: 1
      }
    ]
  },
  {
    name: 'translate-markdown',
    options: {
      attempts: 1,
      defaultJobOptions: {
        repeat: {
          every: ms('30m')
        }
      }
    },
    processors: [
      {
        processor: path.join(__dirname, 'translate-markdown.js'),
        concurrency: 1
      }
    ]
  }
];

module.exports = queues;
