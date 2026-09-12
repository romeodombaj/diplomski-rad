import { totpNow } from '../../mobile-app/src/lib/totp';

const BASE = process.env.BASE || 'http://localhost:5000';

async function main() {
  const did = `did:demo:test-${Date.now()}`;

  const enrollRes = await fetch(`${BASE}/mobile/totp/enroll`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ did }),
  });
  const enroll = await enrollRes.json();
  if (!enroll?.data?.secret) throw new Error('enroll failed: ' + JSON.stringify(enroll));
  const { secret, period, digits } = enroll.data;
  console.log('enrolled:', { did, secret, period, digits });

  const code = totpNow({ secret, period, digits });
  console.log('on-device code:', code);

  const verifyRes = await fetch(`${BASE}/mobile/verify/totp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ did, code }),
  });
  const verify = await verifyRes.json();
  console.log('verify response:', verify);

  if (verify?.data?.success) {
    console.log('\n✅ PASS — on-device TOTP matches backend');
  } else {
    console.log('\n❌ FAIL — codes did not match');
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
