const fs = require('fs');
const os = require('os');
const path = require('path');
const uuid = require('uuid');
const isCI = require('is-ci');
const shell = require('shelljs');
const bytes = require('bytes');
const test = require('ava');
const nodemailer = require('nodemailer');
const Client = require('nodemailer/lib/smtp-connection');
const domains = require('disposable-email-domains');

const ForwardEmail = require('..');
const { beforeEach, afterEach } = require('./helpers');

const tls = { rejectUnauthorized: false };

test.beforeEach(beforeEach);
test.afterEach(afterEach);

test('returns itself', t => {
  t.true(new ForwardEmail() instanceof ForwardEmail);
});

test('binds context', t => {
  t.true(t.context.forwardEmail instanceof ForwardEmail);
});

test.cb('rejects auth connections', t => {
  const { port } = t.context.forwardEmail.server.address();
  const connection = new Client({ port, tls });
  connection.once('end', t.end);
  connection.connect(() => {
    connection.login({ user: 'user', pass: 'pass' }, err => {
      t.is(err.responseCode, 500);
      connection.close();
    });
  });
});

test('verifies connection', async t => {
  const { port } = t.context.forwardEmail.server.address();
  const transporter = nodemailer.createTransport({ port, tls });
  await transporter.verify();
  t.pass();
});

test('rejects forwarding a non-FQDN email', async t => {
  const transporter = nodemailer.createTransport({
    streamTransport: true
  });
  const { port } = t.context.forwardEmail.server.address();
  const connection = new Client({ port, tls });
  const info = await transporter.sendMail({
    from: 'ForwardEmail <from@forwardemail.net>',
    to: 'Niftylettuce <hello@127.0.0.1>',
    subject: 'test',
    text: 'test text',
    html: '<strong>test html</strong>',
    attachments: []
  });
  return new Promise(resolve => {
    connection.once('end', resolve);
    connection.connect(() => {
      connection.send(info.envelope, info.message, err => {
        t.is(err.responseCode, 550);
        t.regex(err.message, /is not a FQDN/);
        connection.close();
      });
    });
  });
});

// test('rejects forwarding a non-registered email domain', async t => {
//   t.regex(err.message, /does not have a valid forwardemail TXT record/);
// });

test('rejects forwarding a non-registered email address', async t => {
  const transporter = nodemailer.createTransport({
    streamTransport: true
  });
  const { port } = t.context.forwardEmail.server.address();
  const connection = new Client({ port, tls });
  const info = await transporter.sendMail({
    from: 'ForwardEmail <from@forwardemail.net>',
    to: 'Niftylettuce <fail@test.niftylettuce.com>', // "pass" works
    subject: 'test',
    text: 'test text',
    html: '<strong>test html</strong>',
    attachments: []
  });
  return new Promise(resolve => {
    connection.once('end', resolve);
    connection.connect(() => {
      connection.send(info.envelope, info.message, err => {
        t.is(err.responseCode, 550);
        t.regex(err.message, /Invalid forward-email TXT record/);
        connection.close();
      });
    });
  });
});

if (!isCI)
  test('rewrites with friendly-from for failed DMARC validation', async t => {
    // note that we have SPF but not DKIM on this email
    // and DMARC for forwardemail.net requires BOTH to pass
    const transporter = nodemailer.createTransport({
      streamTransport: true
    });
    const { port } = t.context.forwardEmail.server.address();
    const connection = new Client({ port, tls });
    const info = await transporter.sendMail({
      from: 'ForwardEmail <from@forwardemail.net>',
      to: 'Niftylettuce <hello@niftylettuce.com>',
      cc: 'cc@niftylettuce.com',
      subject: 'test',
      text: 'test text',
      html: '<strong>test html</strong>',
      attachments: []
    });
    return new Promise(resolve => {
      connection.once('end', resolve);
      connection.connect(() => {
        connection.send(info.envelope, info.message, err => {
          t.is(err, null);
          connection.close();
        });
      });
    });
  });

if (!isCI)
  test('forwards an email with DKIM and SPF', async t => {
    const transporter = nodemailer.createTransport({
      streamTransport: true
    });
    const { port } = t.context.forwardEmail.server.address();
    const connection = new Client({ port, tls });
    const info = await transporter.sendMail({
      from: 'ForwardEmail <from@forwardemail.net>',
      to: 'Niftylettuce <hello@niftylettuce.com>',
      cc: 'cc@niftylettuce.com',
      subject: 'test',
      text: 'test text',
      html: '<strong>test html</strong>',
      attachments: [],
      dkim: {
        domainName: 'forwardemail.net',
        keySelector: 'default',
        privateKey: fs.readFileSync(
          path.join(__dirname, '..', 'dkim-private.key'),
          'utf8'
        )
      }
    });
    return new Promise(resolve => {
      connection.once('end', resolve);
      connection.connect(() => {
        connection.send(info.envelope, info.message, err => {
          t.is(err, null);
          connection.close();
        });
      });
    });
  });

if (!isCI && shell.which('spamassassin') && shell.which('spamc'))
  test('rejects a spam file', async t => {
    const transporter = nodemailer.createTransport({
      streamTransport: true
    });
    const { port } = t.context.forwardEmail.server.address();
    const connection = new Client({ port, tls });
    const info = await transporter.sendMail({
      from: 'foo@forwardemail.net',
      to: 'Baz <baz@forwardemail.net>',
      // taken from:
      // <https://github.com/humantech/node-spamd/blob/master/test/spamd-tests.js#L13-L14>
      subject: 'Viagra, Cialis, Vicodin: buy medicines without prescription!',
      html: 'Cheap prices on viagra, cialis, vicodin! FPA approved!',
      dkim: {
        domainName: 'forwardemail.net',
        keySelector: 'default',
        privateKey: fs.readFileSync(
          path.join(__dirname, '..', 'dkim-private.key'),
          'utf8'
        )
      }
    });
    return new Promise(resolve => {
      connection.once('end', resolve);
      connection.connect(() => {
        connection.send(info.envelope, info.message, err => {
          t.is(err.responseCode, 551);
          t.regex(err.message, /Message detected as spam/);

          connection.close();
        });
      });
    });
  });

test('rejects a file over the limit', async t => {
  const transporter = nodemailer.createTransport({
    streamTransport: true
  });
  const filePath = path.join(os.tmpdir(), uuid());
  const size = bytes('25mb');
  const { port } = t.context.forwardEmail.server.address();
  const connection = new Client({ port, tls });
  fs.writeFileSync(filePath, Buffer.from(new Array(size).fill('0')));
  const info = await transporter.sendMail({
    from: 'foo@forwardemail.net',
    to: 'Baz <baz@forwardemail.net>',
    subject: 'test',
    text: 'test text',
    html: '<strong>test text</strong>',
    attachments: [{ path: filePath }]
  });
  return new Promise(resolve => {
    connection.once('end', resolve);
    connection.connect(() => {
      connection.send(info.envelope, info.message, err => {
        t.is(err.responseCode, 450);
        t.regex(err.message, /Message size exceeds maximum/);
        fs.unlinkSync(filePath);
        connection.close();
      });
    });
  });
});

test('rejects a disposable email sender', async t => {
  const transporter = nodemailer.createTransport({
    streamTransport: true
  });
  const { port } = t.context.forwardEmail.server.address();
  const connection = new Client({ port, tls });
  const info = await transporter.sendMail({
    from: `disposable@${domains[0]}`,
    to: 'Niftylettuce <hello@niftylettuce.com>',
    subject: 'test',
    text: 'test text',
    html: '<strong>test html</strong>'
  });
  return new Promise(resolve => {
    connection.once('end', resolve);
    connection.connect(() => {
      connection.send(info.envelope, info.message, err => {
        t.is(err.responseCode, 550);
        t.regex(err.message, /Disposable email addresses are not permitted/);
        connection.close();
      });
    });
  });
});

test('rejects an email to no-reply@forwardemail.net', async t => {
  const transporter = nodemailer.createTransport({
    streamTransport: true
  });
  const { port } = t.context.forwardEmail.server.address();
  const connection = new Client({ port, tls });
  const info = await transporter.sendMail({
    from: 'foo@forwardemail.net',
    to: 'Niftylettuce <no-reply@forwardemail.net>',
    subject: 'test',
    text: 'test text',
    html: '<strong>test html</strong>'
  });
  return new Promise(resolve => {
    connection.once('end', resolve);
    connection.connect(() => {
      connection.send(info.envelope, info.message, err => {
        t.is(err.responseCode, 550);
        t.regex(
          err.message,
          /You need to reply to the "Reply-To" email address on the email; do not send messages to <no-reply@forwardemail.net>/
        );
        connection.close();
      });
    });
  });
});

/*
test.todo('rejects invalid DKIM signature');
test.todo('accepts valid DKIM signature');
test.todo('rejects invalid SPF');
test.todo('accepts valid SPF');
test.todo('supports + symbol aliased onRcptTo');
test.todo('preserves charset');

if (!isCI)
  test('prevents spam through rate limiting', async t => {
    const transporter = nodemailer.createTransport({
      streamTransport: true
    });
    const { port } = t.context.forwardEmail.server.address();

    let failed = 0;

    await Promise.all(
      Array.from(Array(200).keys()).map(() => {
        return new Promise(async (resolve, reject) => {
          try {
            const info = await transporter.sendMail({
              from: 'foo@forwardemail.net',
              to: 'Baz <baz@forwardemail.net>',
              subject: 'test',
              text: 'test text',
              html: '<strong>test html</strong>',
              dkim: {
                domainName: 'forwardemail.net',
                keySelector: 'default',
                privateKey: fs.readFileSync(
                  path.join(__dirname, '..', 'dkim-private.key'),
                  'utf8'
                )
              }
            });
            const connection = new Client({ port, tls });
            connection.once('end', resolve);
            connection.connect(() => {
              connection.send(info.envelope, info.message, err => {
                if (err && err.responseCode === 451) failed++;
                connection.close();
              });
            });
          } catch (err) {
            reject(err);
          }
        });
      })
    );

    t.is(failed, 100);
  });
*/
