export function buildDemoContext(body, environment = 'test') {
  const {amount = 1250, userKey} = body;
  if (userKey !== undefined && (typeof userKey !== 'string' || !/^synthetic-[A-Za-z0-9_-]{1,89}$/.test(userKey))) {
    throw new Error('Use a valid synthetic user key.');
  }
  return {
    key: environment === 'prod' && userKey ? userKey : `synthetic-payments-${amount}`,
    amount,
    combination: [body.paymentsV2, body.riskV2, body.notificationsV2].map(value => value ? '1' : '0').join('')
  };
}
